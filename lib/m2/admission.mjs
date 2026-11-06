/**
 * M2 reservation-only admission core. This is NOT a game launcher or a remotely
 * accessible stream scheduler. It never treats untrusted heartbeats as proof of
 * GPU presence, license ownership, video playback, or isolation.
 */
import {randomUUID} from 'node:crypto';
const HOST_ID=/^[A-Za-z0-9_-]{3,64}$/;
const OWNER_ID=/^[A-Za-z0-9_-]{3,80}$/;
const REQUEST_KEY=/^[A-Za-z0-9_-]{8,96}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_HISTORY=500;
const LIVE=new Set(['reserved']);
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(value,keys)=>isObject(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const error=(status,code)=>({status,code});
export function sanitizeHostHeartbeat(data) {
 const keys=['gpuDetected','sunshineReady','moonlightReady','gameAvailable','drain','gameProcessBusy'];
 if(!exact(data,keys)||keys.some(k=>typeof data[k]!=='boolean'))return null;
 return Object.fromEntries(keys.map(k=>[k,data[k]]));
}
export function createAdmissionManager({clock=Date.now,id=randomUUID,hostTtlMs=16000,leaseTtlMs=120000,
  enabledGames=[],onChange=()=>{}}={}) {
 if(!Number.isSafeInteger(hostTtlMs)||hostTtlMs<1000||!Number.isSafeInteger(leaseTtlMs)||leaseTtlMs<1000)throw Error('INVALID_ADMISSION_TTLS');
 const games=new Set(enabledGames);
 if([...games].some(x=>x!=='supertuxkart'))throw Error('UNREVIEWED_GAME_ALLOWLIST');
 const hosts=new Map(),tickets=new Map();
 const active=t=>LIVE.has(t.state);
 const eligible=h=>h&&clock()-h.receivedAt>=0&&clock()-h.receivedAt<hostTtlMs&&
   h.gpuDetected&&h.sunshineReady&&h.moonlightReady&&h.gameAvailable&&!h.drain&&!h.gameProcessBusy;
 const reservedOn=id=>[...tickets.values()].some(t=>t.hostId===id&&active(t));
 const publicTicket=t=>({id:t.id,ownerId:t.ownerId,gameId:t.gameId,hostId:t.hostId,
   state:t.state,createdAt:t.createdAt,expiresAt:t.expiresAt,reason:t.reason});
 const snapshot=()=>({schema:'cloudplay.m2.reservations.v1',reservations:[...tickets.values()].map(t=>({...t}))});
 function commit(ticket,previous=null){
  tickets.set(ticket.id,ticket);
  try {onChange(snapshot());}
  catch {if(previous)tickets.set(previous.id,previous);else tickets.delete(ticket.id);return false;}
  return true;
 }
 function reap(){
  const now=clock();
  for(const original of tickets.values()) {
   if(original.state==='reserved'&&now>=original.expiresAt){
    if(!commit({...original,state:'expired',reason:'LEASE_TTL_EXPIRED'},original))throw Error('M2_JOURNAL_UNAVAILABLE');
   }
  }
  // Bound archived metadata; never remove active reservations to make capacity.
  if(tickets.size>=MAX_HISTORY){
   const toDelete=[...tickets.values()].filter(t=>!active(t)&&now-t.createdAt>86400000)
    .sort((a,b)=>a.createdAt-b.createdAt).slice(0,tickets.size-MAX_HISTORY+1);
   if(toDelete.length){
    for(const t of toDelete)tickets.delete(t.id);
    try{onChange(snapshot())}catch{for(const t of toDelete)tickets.set(t.id,t);throw Error('M2_JOURNAL_UNAVAILABLE')}
   }
  }
 }
 function heartbeat(hostId,raw){
  const value=sanitizeHostHeartbeat(raw);
  if(!HOST_ID.test(hostId)||!value)return error(422,'INVALID_HOST_REPORT');
  const receivedAt=clock();
  hosts.set(hostId,{id:hostId,receivedAt,...value});
  return {status:202,hostId,admissionEligible:eligible(hosts.get(hostId)),streamVerified:false,
    note:'Self-reported infrastructure claims only; no GPU/gameplay attestation'};
 }
 function reserve(body){
  if(!exact(body,['ownerId','gameId','idempotencyKey'])||!OWNER_ID.test(body.ownerId)||
    body.gameId!=='supertuxkart'||!REQUEST_KEY.test(body.idempotencyKey))return error(422,'INVALID_RESERVATION_REQUEST');
  try{reap()}catch{return error(503,'M2_JOURNAL_UNAVAILABLE')}
  if(!games.has(body.gameId))return error(403,'GAME_RESERVATIONS_DISABLED');
  const matches=[...tickets.values()].filter(t=>t.ownerId===body.ownerId&&t.idempotencyKey===body.idempotencyKey);
  if(matches.length){
   const found=matches[0];
   if(found.gameId!==body.gameId)return error(409,'IDEMPOTENCY_KEY_REUSED');
   return {status:found.state==='reserved'?200:409,code:found.state==='reserved'?undefined:'REQUEST_ALREADY_FINALIZED',
     ...(found.state==='reserved'?{reservation:publicTicket(found),idempotent:true}:{})};
  }
  if([...tickets.values()].some(t=>active(t)&&t.ownerId===body.ownerId))return error(409,'OWNER_ALREADY_RESERVED');
  if(tickets.size>=MAX_HISTORY)return error(503,'RESERVATION_JOURNAL_FULL');
  const host=[...hosts.values()].filter(h=>eligible(h)&&!reservedOn(h.id)).sort((a,b)=>a.id.localeCompare(b.id))[0];
  if(!host)return error(409,'NO_IDLE_ELIGIBLE_HOST');
  const now=clock(),ticket={id:id(),ownerId:body.ownerId,gameId:body.gameId,hostId:host.id,
    idempotencyKey:body.idempotencyKey,state:'reserved',createdAt:now,expiresAt:now+leaseTtlMs,reason:null};
  if(!UUID.test(ticket.id))return error(503,'INVALID_RESERVATION_ID');
  if(tickets.has(ticket.id))return error(503,'RESERVATION_ID_COLLISION');
  if(!commit(ticket))return error(503,'M2_JOURNAL_UNAVAILABLE');
  return {status:201,reservation:publicTicket(ticket),streamVerified:false,
    note:'Capacity reserved, NOT game process launched or stream connected'};
 }
 function release(reservationId,body){
  if(!UUID.test(reservationId)||!exact(body,['ownerId'])||!OWNER_ID.test(body.ownerId))return error(422,'INVALID_RELEASE_REQUEST');
  try{reap()}catch{return error(503,'M2_JOURNAL_UNAVAILABLE')}
  const original=tickets.get(reservationId);
  if(!original||original.ownerId!==body.ownerId)return error(404,'RESERVATION_NOT_FOUND');
  if(original.state!=='reserved')return {status:200,reservation:publicTicket(original),idempotent:true};
  const updated={...original,state:'released',reason:'OPERATOR_RELEASED'};
  if(!commit(updated,original))return error(503,'M2_JOURNAL_UNAVAILABLE');
  return {status:200,reservation:publicTicket(updated)};
 }
 function status(){
  try{reap()}catch{return error(503,'M2_JOURNAL_UNAVAILABLE')}
  return {status:200,mode:'reservation-only',streamVerified:false,gameLaunchEnabled:false,
    hosts:[...hosts.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(h=>({id:h.id,heartbeatFresh:clock()-h.receivedAt>=0&&clock()-h.receivedAt<hostTtlMs,
      selfReportedEligible:eligible(h),reserved:reservedOn(h.id),draining:h.drain})),
    reservations:[...tickets.values()].map(publicTicket)};
 }
 /** Disable an identity without freeing a live host accidentally: after host
  * revocation no further heartbeat can refresh it, and live reservations are
  * expired in the durable journal. Storage failure keeps capacity blocked. */
 function invalidateIdentity(kind,identityId,reason){
  if(kind==='host')hosts.delete(identityId);
  for(const t of tickets.values()){
   if(t.state!=='reserved'||(kind==='host'?t.hostId!==identityId:t.ownerId!==identityId))continue;
   if(!commit({...t,state:'expired',reason},t))throw Error('M2_JOURNAL_UNAVAILABLE');
  }
 }
 function ownerReservations(ownerId){
  if(!OWNER_ID.test(ownerId))return error(422,'INVALID_OWNER_ID');
  try{reap()}catch{return error(503,'M2_JOURNAL_UNAVAILABLE')}
  return {status:200,ownerId,reservations:[...tickets.values()].filter(t=>t.ownerId===ownerId).map(publicTicket),
   streamVerified:false,gameLaunchEnabled:false};
 }
 function restore(data){
  if(tickets.size||hosts.size)throw Error('RESTORE_REQUIRES_EMPTY_MANAGER');
  if(!exact(data,['schema','reservations'])||data.schema!=='cloudplay.m2.reservations.v1'||
    !Array.isArray(data.reservations)||data.reservations.length>MAX_HISTORY)throw Error('M2_INVALID_JOURNAL');
  const ids=new Set(),keys=new Set(),perHost=new Set(),perOwner=new Set();
  const restored=[];
  for(const t of data.reservations){
   if(!exact(t,['id','ownerId','gameId','hostId','idempotencyKey','state','createdAt','expiresAt','reason'])||
     !UUID.test(t.id)||ids.has(t.id)||!OWNER_ID.test(t.ownerId)||t.gameId!=='supertuxkart'||
     !HOST_ID.test(t.hostId)||!REQUEST_KEY.test(t.idempotencyKey)||
     !['reserved','released','expired'].includes(t.state)||!Number.isSafeInteger(t.createdAt)||
     !Number.isSafeInteger(t.expiresAt)||t.expiresAt<=t.createdAt||
     !(t.reason===null||['LEASE_TTL_EXPIRED','OPERATOR_RELEASED','CONTROL_PLANE_RESTART','HOST_CREDENTIAL_CHANGED','OWNER_CREDENTIAL_CHANGED','HOST_REVOKED','OWNER_REVOKED'].includes(t.reason)))throw Error('M2_INVALID_JOURNAL');
   const key=t.ownerId+'\u0000'+t.idempotencyKey;
   if(keys.has(key))throw Error('M2_DUPLICATE_REQUEST_IN_JOURNAL');
   ids.add(t.id);keys.add(key);
   if(t.state==='reserved'){
    if(perHost.has(t.hostId)||perOwner.has(t.ownerId))throw Error('M2_DUPLICATE_LIVE_RESERVATION');
    perHost.add(t.hostId);perOwner.add(t.ownerId);
   }
   // On restart the former host and reservation cannot be assumed alive.
   restored.push({...t,...(t.state==='reserved'?{state:'expired',reason:'CONTROL_PLANE_RESTART'}:{})});
  }
  for(const t of restored)tickets.set(t.id,t);
  try{onChange(snapshot())}catch{tickets.clear();throw Error('M2_JOURNAL_UNAVAILABLE')}
 }
 return {heartbeat,reserve,release,status,restore,snapshot,invalidateIdentity,ownerReservations};
}
