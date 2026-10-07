import { randomUUID } from 'node:crypto';
import { Fault } from './engine.mjs';
export function providerDetails(input) {
  if(typeof input.providerName!=='string'||input.providerName.trim().length<2||input.providerName.length>80||typeof input.providerUrl!=='string'||input.providerUrl.length>500)throw new Fault('Enter your payment provider name and official HTTPS website');
  let url;try{url=new URL(input.providerUrl);}catch{throw new Fault('Invalid provider website');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname)||url.hostname.endsWith('.localhost')||url.hostname.endsWith('.local'))throw new Fault('Use a public HTTPS provider website without credentials, query parameters or fragments');
  return {name:input.providerName.trim(),url:url.href,verification:'User-selected website; provider authorization not verified by AtlasPay'};
}
export function handoffChecks(input){const fields=['recipient','invoice','amount','currency'];if(input.checks!==undefined&&(!input.checks||fields.some(k=>typeof input.checks[k]!=='boolean')))throw new Fault('Provide all payment checklist decisions');return Object.fromEntries(fields.map(k=>[k,input.checks?.[k]||false]));}
export function lifecycle(state,input,actor){const p=state.payments.find(p=>p.id===input.id&&p.mode==='external');if(!p)throw new Fault('External plan not found',404);if(input.action==='cancel'){if(p.status!=='awaiting_external_payment'||p.external.reference||p.providerConfirmation)throw new Fault('Only an unreferenced, unchecked awaiting plan can be cancelled locally. Manage provider payments through the provider.',409);p.status='plan_cancelled';p.cancelledAt=new Date().toISOString();}else if(input.action==='archive'){p.archivedAt=new Date().toISOString();}else if(input.action==='unarchive'){delete p.archivedAt;}else throw new Fault('Invalid plan action');state.audit.unshift({id:randomUUID(),action:'Local plan '+input.action+'; no provider payment changed',reference:p.id,at:new Date().toISOString(),actor});return p;}
export function recordReference(state,input) {
  const p=state.payments.find(p=>p.id===input.id&&p.mode==='external');if(!p)throw new Fault('External payment not found',404);
  if(typeof input.reference!=='string'||input.reference.trim().length<3||input.reference.length>120)throw new Fault('Enter a provider reference between 3 and 120 characters');
  p.external.reference=input.reference.trim();p.external.referenceRecordedAt=new Date().toISOString();if(!p.providerConfirmation)p.external.confirmation='User reported reference; settlement unverified';
  state.audit.unshift({id:randomUUID(),action:'External provider reference recorded; settlement unverified',reference:p.id,at:new Date().toISOString(),actor:'Sandbox operator'});return p;
}
