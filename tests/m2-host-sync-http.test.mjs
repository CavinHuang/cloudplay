import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createM2Coordinator} from '../lab/m2-coordinator.mjs';

const admin='A'.repeat(48);
const hello={protocol:'cloudplay.m2.host-connection.v1'};
const ready={gpuDetected:true,sunshineReady:true,moonlightReady:true,gameAvailable:true,drain:false,gameProcessBusy:false};
const uuid='00000000-0000-4000-8000-000000000001';
const req=(url,route,token,method='GET',body,extra={})=>fetch(url+route,{
 method,headers:{Authorization:'Bearer '+token,'X-CloudPlay-M2-Action':'1',
  ...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},
 ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(3000)});
async function start(app){
 await new Promise((resolve,reject)=>app.server.once('error',reject).listen(0,'127.0.0.1',resolve));
 return 'http://127.0.0.1:'+app.server.address().port;
}
const stop=app=>new Promise(resolve=>app.server.close(resolve));

test('registered hosts pull owner-redacted assignment snapshots and ack only the current lease',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cloudplay-host-sync-'));
 const statePath=path.join(dir,'m2-journal.json');
 const app=createM2Coordinator({adminToken:admin,hostTokens:{},statePath,enabledGames:['supertuxkart']});
 const url=await start(app);
 let hostToken,ownerToken,otherHostToken,connectionId;
 try{
  const a=await req(url,'/internal/m2/hosts',admin,'POST',{hostId:'hostAlpha'});
  hostToken=(await a.json()).token;
  const b=await req(url,'/internal/m2/hosts',admin,'POST',{hostId:'hostBeta'});
  otherHostToken=(await b.json()).token;
  ownerToken=(await (await req(url,'/internal/m2/owners',admin,'POST',{ownerId:'ownerAlpha'})).json()).token;
  const hostPath='/internal/m2/hosts/hostAlpha';
  const otherPath='/internal/m2/hosts/hostBeta';
  const connected=await req(url,hostPath+'/connect',hostToken,'POST',hello);
  connectionId=(await connected.json()).connectionId;
  const otherConn=(await (await req(url,otherPath+'/connect',otherHostToken,'POST',hello)).json()).connectionId;
  assert.equal((await req(url,hostPath+'/heartbeat',hostToken,'POST',{...ready,connectionId,sequence:1})).status,202);
  assert.equal((await req(url,otherPath+'/heartbeat',otherHostToken,'POST',
   {...ready,connectionId:otherConn,sequence:1})).status,202);

  const syncPath=hostPath+'/sync',ackPath=hostPath+'/ack';
  const first=await req(url,syncPath,hostToken,'POST',{connectionId,sequence:1});
  assert.equal(first.status,200);
  const idle=await first.json();
  assert.equal(idle.action,'CAPACITY_IDLE');
  assert.equal(idle.assignment,null);
  assert.equal(idle.acknowledged,false);
  assert.equal(idle.gameLaunchEnabled,false);
  assert.equal((await req(url,syncPath,hostToken,'POST',{connectionId,sequence:1})).status,409);
  assert.equal((await req(url,syncPath,otherHostToken,'POST',{connectionId,sequence:2})).status,401);
  assert.equal((await req(url,syncPath,hostToken,'POST',{connectionId,sequence:2},
   {Origin:'https://evil.example'})).status,403);
  assert.equal((await req(url,syncPath,hostToken,'GET')).status,405);
  assert.equal((await req(url,syncPath,hostToken,'POST',{connectionId,sequence:2},
   {'X-CloudPlay-M2-Action':'0'})).status,403);

  const book=await req(url,'/internal/m2/reservations',ownerToken,'POST',
   {ownerId:'ownerAlpha',gameId:'supertuxkart',idempotencyKey:'host-sync-key-01'});
  assert.equal(book.status,201);
  const ticket=(await book.json()).reservation;
  assert.equal(ticket.hostId,'hostAlpha');
  const second=await req(url,syncPath,hostToken,'POST',{connectionId,sequence:2});
  assert.equal(second.status,200);
  const snapshot=await second.json();
  assert.equal(snapshot.action,'OBSERVE_RESERVATION');
  assert.deepEqual(snapshot.assignment,{reservationId:ticket.id,gameId:'supertuxkart',expiresAt:ticket.expiresAt});
  assert.equal(snapshot.acknowledged,false);
  assert.equal(JSON.stringify(snapshot).includes('ownerAlpha'),false);
  assert.equal(JSON.stringify(snapshot).includes(hostToken),false);
  assert.equal(JSON.stringify(snapshot).includes('localhost'),false);
  assert.equal((await (await req(url,otherPath+'/sync',otherHostToken,'POST',
   {connectionId:otherConn,sequence:1})).json()).action,'CAPACITY_IDLE');

  const observed={connectionId,sequence:3,reservationId:ticket.id,expiresAt:ticket.expiresAt};
  assert.equal((await req(url,ackPath,otherHostToken,'POST',observed)).status,401);
  assert.equal((await (await req(url,ackPath,hostToken,'POST',
   {...observed,reservationId:uuid})).json()).code,'HOST_ASSIGNMENT_STALE');
  assert.equal((await (await req(url,ackPath,hostToken,'POST',
   {...observed,expiresAt:ticket.expiresAt+1})).json()).code,'HOST_ASSIGNMENT_STALE');
  const ack=await req(url,ackPath,hostToken,'POST',observed);
  assert.equal(ack.status,202);
  assert.deepEqual(await ack.json(),{status:202,acknowledged:true,gameLaunchEnabled:false,streamVerified:false});
  assert.equal((await (await req(url,ackPath,hostToken,'POST',observed)).json()).code,'HOST_SYNC_REPLAYED');
  const again=await (await req(url,syncPath,hostToken,'POST',{connectionId,sequence:4})).json();
  assert.equal(again.acknowledged,true);

  assert.equal((await req(url,'/internal/m2/reservations/'+ticket.id,ownerToken,'DELETE',
   {ownerId:'ownerAlpha'})).status,200);
  const cleared=await (await req(url,syncPath,hostToken,'POST',{connectionId,sequence:5})).json();
  assert.equal(cleared.action,'CAPACITY_IDLE');
  assert.equal(cleared.acknowledged,false);
  assert.equal((await (await req(url,ackPath,hostToken,'POST',
   {...observed,sequence:6})).json()).code,'HOST_ASSIGNMENT_STALE');
  const newBook=await req(url,'/internal/m2/reservations',ownerToken,'POST',
   {ownerId:'ownerAlpha',gameId:'supertuxkart',idempotencyKey:'host-sync-key-02'});
  assert.equal(newBook.status,201);
  const newTicket=(await newBook.json()).reservation;
  assert.equal((await (await req(url,ackPath,hostToken,'POST',
   {...observed,sequence:6})).json()).code,'HOST_ASSIGNMENT_STALE');
  const replaced=await req(url,hostPath+'/connect',hostToken,'POST',hello);
  assert.equal(replaced.status,201);
  const freshId=(await replaced.json()).connectionId;
  assert.notEqual(connectionId,freshId);
  assert.equal((await (await req(url,syncPath,hostToken,'POST',
   {connectionId,sequence:6})).json()).code,'HOST_CONNECTION_FENCED');
  const newSync=await (await req(url,syncPath,hostToken,'POST',
   {connectionId:freshId,sequence:1})).json();
  assert.equal(newSync.action,'CAPACITY_IDLE');
  const state=await (await req(url,'/internal/m2/status',admin)).json();
  assert.equal(state.reservations.find(x=>x.id===newTicket.id).reason,'HOST_CONNECTION_REPLACED');
  const disk=fs.readFileSync(statePath,'utf8');
  assert.equal(disk.includes(connectionId),false);
  assert.equal(disk.includes(freshId),false);
 }finally{await stop(app)}
 const restarted=createM2Coordinator({adminToken:admin,hostTokens:{},statePath,enabledGames:['supertuxkart']});
 const base=await start(restarted);
 try{
  assert.equal((await (await req(base,'/internal/m2/hosts/hostAlpha/sync',hostToken,
   'POST',{connectionId,sequence:100})).json()).code,'HOST_CONNECTION_REQUIRED');
  assert.equal((await req(base,'/internal/m2/hosts/hostAlpha/connect',hostToken,'POST',hello)).status,201);
 }finally{await stop(restarted);fs.rmSync(dir,{recursive:true,force:true})}
});

test('host sync refuses a missing/currently unconfirmed connection without authorizing play',async()=>{
 const app=createM2Coordinator({adminToken:admin,hostTokens:{oldHost:'H'.repeat(48)},enabledGames:['supertuxkart']});
 const url=await start(app);
 try{
  const token='H'.repeat(48);
  assert.equal((await req(url,'/internal/m2/hosts/oldHost/heartbeat',token,'POST',ready)).status,202);
  assert.equal((await (await req(url,'/internal/m2/hosts/oldHost/sync',token,'POST',
   {connectionId:uuid,sequence:1})).json()).code,'HOST_CONNECTION_REQUIRED');
 }finally{await stop(app)}
});

test('lease renewal changes the observed snapshot and forces re-ack; expiry clears it',async()=>{
 let now=1000000;
 const hostToken='H'.repeat(48);
 const app=createM2Coordinator({adminToken:admin,hostTokens:{hostGamma:hostToken},
  enabledGames:['supertuxkart'],clock:()=>now});
 const url=await start(app);
 const route='/internal/m2/hosts/hostGamma';
 try{
  const connected=await req(url,route+'/connect',hostToken,'POST',hello);
  assert.equal(connected.status,201);
  const connectionId=(await connected.json()).connectionId;
  assert.equal((await req(url,route+'/heartbeat',hostToken,'POST',
   {...ready,connectionId,sequence:1})).status,202);
  const created=await req(url,'/internal/m2/reservations',admin,'POST',{
   ownerId:'operator01',gameId:'supertuxkart',idempotencyKey:'renew-sync-key-001'
  });
  assert.equal(created.status,201);
  const first=(await created.json()).reservation;
  const snap1=(await req(url,route+'/sync',hostToken,'POST',{connectionId,sequence:1})).json();
  const s1=await snap1;
  assert.equal(s1.assignment.expiresAt,first.expiresAt);
  const ack1={connectionId,sequence:2,reservationId:first.id,expiresAt:first.expiresAt};
  assert.equal((await req(url,route+'/ack',hostToken,'POST',ack1)).status,202);
  assert.equal((await (await req(url,route+'/sync',hostToken,'POST',
   {connectionId,sequence:3})).json()).acknowledged,true);
  now+=61000;
  assert.equal((await req(url,route+'/heartbeat',hostToken,'POST',
   {...ready,connectionId,sequence:2})).status,202);
  const renewed=await req(url,'/internal/m2/reservations/'+first.id+'/renew',admin,'POST',{
   ownerId:'operator01',expectedExpiresAt:first.expiresAt
  });
  assert.equal(renewed.status,200);
  const next=(await renewed.json()).reservation;
  assert.ok(next.expiresAt>first.expiresAt);
  const s2=await (await req(url,route+'/sync',hostToken,'POST',
   {connectionId,sequence:4})).json();
  assert.equal(s2.assignment.expiresAt,next.expiresAt);
  assert.equal(s2.acknowledged,false);
  assert.equal((await (await req(url,route+'/ack',hostToken,'POST',
   {...ack1,sequence:5})).json()).code,'HOST_ASSIGNMENT_STALE');
  assert.equal((await req(url,route+'/ack',hostToken,'POST',
   {...ack1,sequence:5,expiresAt:next.expiresAt})).status,202);
  now=next.expiresAt+1;
  const expired=await (await req(url,route+'/sync',hostToken,'POST',
   {connectionId,sequence:6})).json();
  assert.equal(expired.action,'CAPACITY_IDLE');
  assert.equal(expired.acknowledged,false);
 }finally{await stop(app)}
});
