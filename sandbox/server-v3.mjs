import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { initialState, quote, pay, review, Fault, available, reserved } from './engine.mjs';
import { newKeys, publicKeys, attest, checkPayments, seal, unseal, signReceipt, verifyReceipt } from './pqc.mjs';
import { beneficiary, reconcileStatement } from './operations.mjs';
import { recordReference } from './external.mjs';
const data = process.env.ATLAS_DATA_DIR ? pathToFileURL(resolve(process.env.ATLAS_DATA_DIR)+sep) : new URL('../.sandbox/', import.meta.url); await mkdir(data,{recursive:true});
const db = new URL('state.json',data); let state; try { state = JSON.parse(await readFile(db,'utf8')); } catch(e) { if(e.code !== 'ENOENT') throw e; state = initialState(); }
const keyFile=new URL('keyring.json',data);let keyring;
try {keyring=JSON.parse(await readFile(keyFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;if(state.payments.some(p=>p.receipt))throw Error('PQC keyring missing: restore original keys before startup');keyring={active:0,keys:[newKeys()]};await writeFile(keyFile,JSON.stringify(keyring),{mode:0o600,flag:'wx'});}
const activeKey=()=>keyring.keys[keyring.active];
const security=()=>({mode:'Local sandbox',runtime:process.version,signature:'ML-DSA-65 + Ed25519 (both required)',encryption:'ML-KEM-768 / HKDF-SHA384 / AES-256-GCM',activeKeyId:activeKey().id,keys:keyring.keys.map(publicKeys),receipts:checkPayments(state,keyring.keys),transport:'Loopback HTTP; no PQC transport claim',keyStorage:'Local keyring file; no HSM/KMS',stateStorage:'Local JSON; plaintext'});
const token = randomBytes(32).toString('hex');
async function save(next) { attest(next,activeKey());const temp = new URL('state.tmp',data); await writeFile(temp,JSON.stringify(next,null,2)); await rename(temp,db); state = next; }
await save(structuredClone(state));
let queue = Promise.resolve(); const limits = new Map();
const server = http.createServer(async(req,res) => {
  const host = req.headers.host; if(!/^127\.0\.0\.1:\d+$/.test(host || '')) { res.writeHead(403); return res.end('Loopback host required'); }
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Cache-Control','no-store'); res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const url = new URL(req.url, `http://${host}`);
  const json = (status,body) => { res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(body)); };
  try {
    if(req.method === 'GET') {
      if(url.pathname === '/health') return json(200,{ok:true,mode:'sandbox'});
      if(url.pathname === '/api/state') return json(200,{...state,keys:undefined,quotes:undefined,token,available:Object.fromEntries(Object.keys(state.wallets).map(c=>[c,available(state,c).toString()])),reserved:Object.fromEntries(Object.keys(state.wallets).map(c=>[c,reserved(state,c).toString()]))});
      if(url.pathname === '/api/security') return json(200,security());
      const assets = { '/':'dashboard.html','/app.js':'app.js','/features.js':'features.js','/external.js':'external.js','/style.css':'style.css' };
      if(Object.hasOwn(assets,url.pathname)) { res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html'); return res.end(await readFile(new URL('../apps/web/'+assets[url.pathname],import.meta.url))); }
      return json(404,{error:'Not found'});
    }
    if(req.method !== 'POST') return json(405,{error:'Method not allowed'});
    if(req.headers.origin !== `http://${host}` || req.headers['x-sandbox-token'] !== token) throw new Fault('Invalid session or origin',403);
    const minute = Math.floor(Date.now()/60000), count = limits.get(minute) || 0; if(count >= 60) throw new Fault('Too many requests',429); limits.clear(); limits.set(minute,count+1);
    if(!req.headers['content-type']?.startsWith('application/json')) throw new Fault('JSON required',415);
    let body = ''; for await(const chunk of req) { body += chunk; if(Buffer.byteLength(body) > 16384) throw new Fault('Request too large',413); }
    let input; try { input=JSON.parse(body); } catch { throw new Fault('Invalid JSON'); } if(!input || typeof input !== 'object' || Array.isArray(input)) throw new Fault('Invalid request');
    const action = async() => { const next=structuredClone(state); let result;
      if(url.pathname === '/api/quotes') result=quote(next,input);
      else if(url.pathname === '/api/payments') result=pay(next,input,req.headers['idempotency-key']);
      else if(url.pathname === '/api/review') result=review(next,input.id,input.decision);
      else if(url.pathname === '/api/external/reference') result=recordReference(next,input);
      else if(url.pathname === '/api/beneficiaries') result=beneficiary(next,input);
      else if(url.pathname === '/api/reconcile') {result=reconcileStatement(next,input.rows);next.reconciliation=result;}
      else if(url.pathname === '/api/security/verify') return security();
      else if(url.pathname === '/api/security/self-test') {const probe={challenge:randomBytes(32).toString('hex')};const envelope=seal(probe,activeKey());const receipt=signReceipt(probe,activeKey());return {kemRoundTrip:unseal(envelope,activeKey()).challenge===probe.challenge,dualSignature:verifyReceipt(receipt,publicKeys(activeKey())),at:new Date().toISOString()};}
      else if(url.pathname === '/api/security/export') {const payload={mode:'sandbox',at:new Date().toISOString(),wallets:next.wallets,payments:next.payments,journals:next.journals,audit:next.audit,beneficiaries:next.beneficiaries||[]};const envelope=seal(payload,activeKey());return {envelope,attestation:signReceipt(envelope,activeKey()),publicKey:publicKeys(activeKey())};}
      else if(url.pathname === '/api/security/rotate') {const nextRing=structuredClone(keyring);nextRing.keys.push(newKeys());nextRing.active=nextRing.keys.length-1;const tmp=new URL('keyring.tmp',data);await writeFile(tmp,JSON.stringify(nextRing),{mode:0o600});await rename(tmp,keyFile);keyring=nextRing;next.audit.unshift({id:randomBytes(16).toString('hex'),action:'PQC key rotated; prior keys retained',reference:activeKey().id,at:new Date().toISOString(),actor:'Sandbox operator'});result={activeKeyId:activeKey().id};}
      else throw new Fault('Not found',404);
      await save(next); return result;
    };
    const pending=queue.then(action); queue=pending.catch(()=>{}); return json(200,await pending);
  } catch(e) { if(!(e instanceof Fault)) console.error(e); json(e.status || 500,{error:e instanceof Fault ? e.message : 'Internal server error'}); }
});
server.listen(Number(process.env.PORT || 8080),'127.0.0.1',()=>console.log('AtlasPay sandbox: http://127.0.0.1:'+server.address().port));
