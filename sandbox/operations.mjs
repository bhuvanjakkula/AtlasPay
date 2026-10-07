import { randomUUID } from 'node:crypto';
import { Fault, currencies } from './engine.mjs';
export function beneficiary(state,input) {
  if(typeof input.name!=='string'||input.name.trim().length<2||input.name.length>100||typeof input.currency!=='string'||!Object.hasOwn(currencies,input.currency)||typeof input.country!=='string'||!/^[A-Z]{2}$/.test(input.country))throw new Fault('Name, supported currency and two-letter country are required');
  state.beneficiaries??=[];if(state.beneficiaries.some(b=>b.name.toLowerCase()===input.name.trim().toLowerCase()&&b.currency===input.currency))throw new Fault('Recipient already exists',409);
  const b={id:randomUUID(),name:input.name.trim(),currency:input.currency,country:input.country,createdAt:new Date().toISOString()};state.beneficiaries.unshift(b);return b;
}
export function reconcileStatement(state,rows) {
  if(!Array.isArray(rows)||rows.length>500)throw new Fault('Provide up to 500 statement rows');
  const seen=new Set(),matched=new Set(),results=[];
  for(const r of rows){if(!r||typeof r.reference!=='string'||r.reference.length>100||typeof r.currency!=='string'||!Object.hasOwn(currencies,r.currency)||typeof r.amountMinor!=='string'||!/^\d{1,12}$/.test(r.amountMinor))throw new Fault('Each row needs reference, currency and integer amountMinor');
    const p=state.payments.find(p=>p.id===r.reference&&p.status==='completed');let status;
    if(seen.has(r.reference))status='duplicate';else if(!p)status='unexpected';else if(p.quote.sourceCurrency!==r.currency||BigInt(p.quote.totalMinor)!==BigInt(r.amountMinor))status='mismatch';else{status='matched';matched.add(p.id);}seen.add(r.reference);results.push({...r,status});
  }
  for(const p of state.payments.filter(p=>p.status==='completed'))if(!matched.has(p.id)&&!seen.has(p.id))results.push({reference:p.id,currency:p.quote.sourceCurrency,amountMinor:p.quote.totalMinor,status:'missing'});
  return {id:randomUUID(),at:new Date().toISOString(),results,counts:results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{})};
}
