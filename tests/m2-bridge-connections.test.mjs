import test from 'node:test';
import assert from 'node:assert/strict';
import {sendP0Heartbeat} from '../lib/m2/host-bridge.mjs';

const credentials={hostId:'gpuHost01',labToken:'L'.repeat(48),m2HostToken:'H'.repeat(48)};
const connectionId='00000000-0000-4000-8000-000000000123';
const host={infrastructureReady:true,gpu:{detected:true,model:'SECRET'},
 sunshinePortOpen:true,webStreamPortOpen:true,gameFilePresent:true};
const ready={connected:true,hosts:[host],sessions:[]};
test('P0 bridge claims one host connection and increments heartbeat sequence without forwarding private host metadata',async()=>{
 const calls=[],connection={};
 const fetcher=async(url,opts)=>{
  calls.push({url,opts});
  if(url.endsWith('/connect'))return {status:201,json:async()=>({connectionId,nextSequence:1})};
  if(url.endsWith('/internal/status'))return {ok:true,json:async()=>ready};
  if(url.endsWith('/heartbeat'))return {status:202};
  throw Error('unexpected route');
 };
 const first=await sendP0Heartbeat({...credentials,connection,fetcher});
 const second=await sendP0Heartbeat({...credentials,connection,fetcher});
 assert.equal(first.accepted,true);assert.equal(second.accepted,true);
 assert.equal(connection.connectionId,connectionId);
 assert.equal(connection.sequence,2);
 assert.equal(calls.filter(x=>x.url.endsWith('/connect')).length,1);
 const reports=calls.filter(x=>x.url.endsWith('/heartbeat'))
  .map(x=>JSON.parse(x.opts.body));
 assert.deepEqual(reports.map(x=>x.sequence),[1,2]);
 assert.equal(reports.every(x=>x.connectionId===connectionId),true);
 assert.equal(reports.every(x=>x.gpuDetected===true),true);
 assert.equal(JSON.stringify(reports).includes('SECRET'),false);
 assert.equal(JSON.stringify(reports).includes(credentials.labToken),false);
});
test('fenced old process fails terminally and cannot automatically reclaim the host',async()=>{
 const connection={connectionId,sequence:3};
 let calls=0;
 const fetcher=async(url)=>{
  calls++;
  if(url.endsWith('/internal/status'))return {ok:true,json:async()=>ready};
  if(url.endsWith('/heartbeat'))return {status:409,json:async()=>({code:'HOST_CONNECTION_FENCED'})};
  throw Error('no new connect permitted');
 };
 await assert.rejects(()=>sendP0Heartbeat({...credentials,connection,fetcher}),
  /M2_BRIDGE_CONNECTION_FENCED_RESTART_REQUIRED/);
 assert.equal(connection.fenced,true);
 const oldCalls=calls;
 await assert.rejects(()=>sendP0Heartbeat({...credentials,connection,fetcher}),
  /M2_BRIDGE_CONNECTION_FENCED_RESTART_REQUIRED/);
 assert.equal(calls,oldCalls);
});
test('a failed HTTP attempt does not consume a heartbeat sequence',async()=>{
 const connection={connectionId,sequence:8};
 let fail=true;const reports=[];
 const fetcher=async(url,opts)=>{
  if(url.endsWith('/internal/status'))return {ok:true,json:async()=>ready};
  reports.push(JSON.parse(opts.body));
  return {status:fail?503:202};
 };
 await assert.rejects(()=>sendP0Heartbeat({...credentials,connection,fetcher}),/M2_BRIDGE_HEARTBEAT_REJECTED/);
 assert.equal(connection.sequence,8);
 fail=false;
 assert.equal((await sendP0Heartbeat({...credentials,connection,fetcher})).accepted,true);
 assert.deepEqual(reports.map(r=>r.sequence),[9,9]);
 assert.equal(connection.sequence,9);
});
