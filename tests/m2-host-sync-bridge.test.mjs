import test from 'node:test';
import assert from 'node:assert/strict';
import {syncHostReservation} from '../lib/m2/host-bridge.mjs';
const connectionId='00000000-0000-4000-8000-00000000cafe';
const ticketId='00000000-0000-4000-8000-00000000beef';
const options={hostId:'hostAlpha',m2HostToken:'H'.repeat(48)};
const assigned={
 kind:'cloudplay.m2.host-sync.v1',action:'OBSERVE_RESERVATION',
 assignment:{reservationId:ticketId,gameId:'supertuxkart',expiresAt:1900000000000},
 acknowledged:false,gameLaunchEnabled:false,streamVerified:false
};
const idle={kind:'cloudplay.m2.host-sync.v1',action:'CAPACITY_IDLE',
 assignment:null,acknowledged:false,gameLaunchEnabled:false,streamVerified:false};

test('M2 P0 host bridge pulls then acknowledges only reservation metadata with strictly increasing sync sequence',async()=>{
 const connection={connectionId};
 const calls=[];
 const fetcher=async(url,opts)=>{
  calls.push({url,body:JSON.parse(opts.body),headers:opts.headers});
  if(url.endsWith('/sync'))return {status:200,json:async()=>assigned};
  if(url.endsWith('/ack'))return {status:202,json:async()=>({
   status:202,acknowledged:true,gameLaunchEnabled:false,streamVerified:false
  })};
  throw Error('unexpected route');
 };
 const result=await syncHostReservation({...options,connection,fetcher});
 assert.deepEqual(result,{assigned:true,acknowledged:true,streamVerified:false});
 assert.deepEqual(calls.map(x=>x.body.sequence),[1,2]);
 assert.equal(calls[0].body.connectionId,connectionId);
 assert.equal(calls[1].body.reservationId,ticketId);
 assert.equal(calls[1].body.expiresAt,assigned.assignment.expiresAt);
 assert.equal(calls.every(x=>x.headers.Authorization==='Bearer '+options.m2HostToken),true);
 assert.equal(calls.every(x=>!JSON.stringify(x.body).includes('ownerAlpha')),true);
 assert.equal(connection.syncSequence,2);
});

test('synced and idle snapshots do not issue any executable commands or redundant acks',async()=>{
 const connection={connectionId};
 const paths=[];
 let current={...assigned,acknowledged:true};
 const fetcher=async(url)=>{
  paths.push(url);
  if(url.endsWith('/sync'))return {status:200,json:async()=>current};
  throw Error('unexpected ack');
 };
 assert.equal((await syncHostReservation({...options,connection,fetcher})).assigned,true);
 current=idle;
 assert.equal((await syncHostReservation({...options,connection,fetcher})).assigned,false);
 assert.equal(paths.length,2);
 assert.equal(connection.syncSequence,2);
});

test('sync timeouts advance sequence and stale process fences further polling',async()=>{
 const connection={connectionId};
 const sequences=[];
 let attempt=0;
 const fetcher=async(url,opts)=>{
  sequences.push(JSON.parse(opts.body).sequence);
  if(attempt++===0)throw Error('timeout after server commit');
  return {status:200,json:async()=>idle};
 };
 await assert.rejects(()=>syncHostReservation({...options,connection,fetcher}),/timeout after server commit/);
 assert.deepEqual(await syncHostReservation({...options,connection,fetcher}),
  {assigned:false,acknowledged:false,streamVerified:false});
 assert.deepEqual(sequences,[1,2]);
 const fenced=async()=>({status:409,json:async()=>({code:'HOST_CONNECTION_FENCED'})});
 await assert.rejects(()=>syncHostReservation({...options,connection,fetcher:fenced}),
  /M2_BRIDGE_CONNECTION_FENCED_RESTART_REQUIRED/);
 assert.equal(connection.fenced,true);
 await assert.rejects(()=>syncHostReservation({...options,connection,fetcher}),
  /M2_BRIDGE_SYNC_NOT_CONFIGURED/);
});
