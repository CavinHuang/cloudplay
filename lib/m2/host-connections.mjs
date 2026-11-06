/**
 * Host process connection fencing for private M2 control.
 * A host token authorizes a process to connect, but every subsequent report
 * must bind to its current unpredictable connection ID and growing sequence.
 * Connection state is intentionally ephemeral: controller restart requires a
 * fresh connection and discards all old heartbeats/leases.
 *
 * This is replay/old-instance fencing, NOT remote client authentication,
 * media verification, or protection against theft of a valid host Bearer key.
 */
import {randomUUID} from 'node:crypto';
import {sanitizeHostHeartbeat} from './admission.mjs';

const HOST_ID=/^[A-Za-z0-9_-]{3,64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROTOCOL='cloudplay.m2.host-connection.v1';
const error=(status,code)=>({status,code});
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));

export function createHostConnections({id=randomUUID,onConnect=()=>{}}={}){
 const connections=new Map();
 function connect(hostId,body){
  if(!HOST_ID.test(hostId)||!exact(body,['protocol'])||body.protocol!==PROTOCOL)
   return error(422,'INVALID_HOST_CONNECT_REQUEST');
  const connectionId=id();
  if(!UUID.test(connectionId))return error(503,'INVALID_HOST_CONNECTION_ID');
  if(connections.get(hostId)?.connectionId===connectionId)return error(503,'HOST_CONNECTION_ID_COLLISION');
  // Expire previous leases in the durable journal FIRST; never fence a
  // process successfully if cleanup could not be committed to disk.
  try{onConnect(hostId)}catch{return error(503,'M2_JOURNAL_UNAVAILABLE')}
  connections.set(hostId,{connectionId,lastSequence:0});
  return {status:201,hostId,connectionId,nextSequence:1,protocol:PROTOCOL,
   streamVerified:false,gameLaunchEnabled:false};
 }
 function heartbeat(hostId,data,{allowLegacy=false}={}){
  if(!HOST_ID.test(hostId))return error(422,'INVALID_HOST_ID');
  const current=connections.get(hostId);
  if(!current){
   if(allowLegacy){
    const legacy=sanitizeHostHeartbeat(data);
    if(legacy)return {status:202,report:legacy,mode:'legacy'};
   }
   return error(409,'HOST_CONNECTION_REQUIRED');
  }
  if(!data||typeof data!=='object'||Array.isArray(data))return error(422,'INVALID_HOST_REPORT');
  if(!UUID.test(data.connectionId||'')||!Number.isSafeInteger(data.sequence)||
    data.sequence<1||data.sequence>Number.MAX_SAFE_INTEGER)
   return error(422,'INVALID_HOST_REPORT');
  if(data.connectionId!==current.connectionId)return error(409,'HOST_CONNECTION_FENCED');
  if(data.sequence<=current.lastSequence)return error(409,'HOST_HEARTBEAT_REPLAYED');
  const {connectionId,sequence,...flags}=data;
  const report=sanitizeHostHeartbeat(flags);
  if(!report)return error(422,'INVALID_HOST_REPORT');
  current.lastSequence=sequence;
  return {status:202,report,mode:'connected'};
 }
 function forget(hostId){connections.delete(hostId)}
 return {connect,heartbeat,forget};
}
