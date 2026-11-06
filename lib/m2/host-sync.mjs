/**
 * M2 host-initiated observation-only synchronization.
 * Hosts can see whether their capacity has an active reservation, then ack
 * having observed it. Neither pull nor ack can launch, stop, or control a game.
 *
 * No owner identity, credentials, filesystem paths, network locations or
 * streaming information are emitted to a host. Acks are ephemeral hints;
 * durable authority is always the reservation journal and connection fence.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const error=(status,code)=>({status,code});

export function createHostSync({admission,connections,clock=Date.now}={}){
 if(!admission||!connections)throw Error('M2_HOST_SYNC_DEPENDENCIES_REQUIRED');
 const observed=new Map();
 function assignment(hostId){
  const state=admission.status(); // reaps expired leases with durable journal
  if(state.status!==200)return error(503,'M2_JOURNAL_UNAVAILABLE');
  const live=state.reservations.filter(t=>t.hostId===hostId&&t.state==='reserved');
  if(live.length>1)return error(503,'M2_HOST_CAPACITY_INVARIANT_FAILED');
  const found=live[0];
  return {status:200,assignment:found?{
   reservationId:found.id,gameId:found.gameId,expiresAt:found.expiresAt
  }:null};
 }
 function pull(hostId,body){
  if(!exact(body,['connectionId','sequence']))return error(422,'INVALID_HOST_SYNC_REQUEST');
  const current=assignment(hostId);
  if(current.status!==200)return current;
  const accepted=connections.advanceSync(hostId,body);
  if(accepted.status!==200)return accepted;
  const latest=current.assignment;
  const ack=observed.get(hostId);
  const acknowledged=Boolean(latest&&ack?.connectionId===body.connectionId&&
    ack?.reservationId===latest.reservationId&&ack?.expiresAt===latest.expiresAt);
  if(!latest)observed.delete(hostId);
  return {status:200,kind:'cloudplay.m2.host-sync.v1',
   action:latest?'OBSERVE_RESERVATION':'CAPACITY_IDLE',
   assignment:latest,acknowledged,
   gameLaunchEnabled:false,streamVerified:false,
   note:'Observation-only state. No game or streaming action is authorized.'};
 }
 function ack(hostId,body){
  if(!exact(body,['connectionId','sequence','reservationId','expiresAt']))
   return error(422,'INVALID_HOST_ACK_REQUEST');
  if(!UUID.test(body.reservationId))return error(422,'INVALID_HOST_ACK_RESERVATION_ID');
  if(!Number.isSafeInteger(body.expiresAt)||body.expiresAt<0)
   return error(422,'INVALID_HOST_ACK_EXPIRY');
  const current=assignment(hostId);
  if(current.status!==200)return current;
  if(!current.assignment||current.assignment.reservationId!==body.reservationId||
    current.assignment.expiresAt!==body.expiresAt)return error(409,'HOST_ASSIGNMENT_STALE');
  const accepted=connections.advanceSync(hostId,{connectionId:body.connectionId,sequence:body.sequence});
  if(accepted.status!==200)return accepted;
  observed.set(hostId,{connectionId:body.connectionId,reservationId:body.reservationId,
   expiresAt:body.expiresAt,observedAt:clock()});
  return {status:202,acknowledged:true,gameLaunchEnabled:false,streamVerified:false};
 }
 function forget(hostId){observed.delete(hostId)}
 return {pull,ack,forget};
}
