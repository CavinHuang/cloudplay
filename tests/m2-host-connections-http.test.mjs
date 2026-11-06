import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createM2Coordinator} from '../lab/m2-coordinator.mjs';

const admin='A'.repeat(48);
const hello={protocol:'cloudplay.m2.host-connection.v1'};
const good={gpuDetected:true,sunshineReady:true,moonlightReady:true,gameAvailable:true,
 drain:false,gameProcessBusy:false};
const body={ownerId:'ownerAlpha',gameId:'supertuxkart',idempotencyKey:'host-generation-0001'};
async function start(app){
 await new Promise((resolve,reject)=>app.server.once('error',reject).listen(0,'127.0.0.1',resolve));
 return 'http://127.0.0.1:'+app.server.address().port;
}
async function stop(app){await new Promise(resolve=>app.server.close(resolve))}
function request(base,route,key,method='GET',payload,extra={}){
 return fetch(base+route,{method,headers:{Authorization:'Bearer '+key,'X-CloudPlay-M2-Action':'1',
  ...(payload!==undefined?{'Content-Type':'application/json'}:{}),...extra},
  ...(payload!==undefined?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(3000)});
}

test('real M2 HTTP fences old host process, drops its capacity and denies replay even after restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cloudplay-m2-connection-'));
 const statePath=path.join(dir,'m2-journal.json');
 const app=createM2Coordinator({adminToken:admin,hostTokens:{},enabledGames:['supertuxkart'],statePath});
 const base=await start(app);
 let hostToken,ownerToken,oldConnection,secondConnection,firstId,secondId;
 const hostPath='/internal/m2/hosts/gpuHost01';
 try{
  const enrolled=await request(base,'/internal/m2/hosts',admin,'POST',{hostId:'gpuHost01'});
  assert.equal(enrolled.status,201);hostToken=(await enrolled.json()).token;
  const owner=await request(base,'/internal/m2/owners',admin,'POST',{ownerId:'ownerAlpha'});
  assert.equal(owner.status,201);ownerToken=(await owner.json()).token;
  assert.equal((await request(base,hostPath+'/heartbeat',hostToken,'POST',good)).status,409);
  assert.equal((await request(base,hostPath+'/connect',admin,'POST',hello)).status,401);
  assert.equal((await request(base,hostPath+'/connect',hostToken,'POST',{protocol:'not-supported'})).status,422);
  assert.equal((await request(base,hostPath+'/connect',hostToken,'POST',hello,
   {Origin:'https://outside.example'})).status,403);
  assert.equal((await request(base,hostPath+'/connect',hostToken,'POST',hello,
   {'X-CloudPlay-M2-Action':'0'})).status,403);
  const first=await request(base,hostPath+'/connect',hostToken,'POST',hello);
  assert.equal(first.status,201);oldConnection=(await first.json()).connectionId;
  const report={...good,connectionId:oldConnection,sequence:1};
  assert.equal((await request(base,hostPath+'/heartbeat',hostToken,'POST',report)).status,202);
  assert.equal((await (await request(base,hostPath+'/heartbeat',hostToken,'POST',report)).json()).code,
   'HOST_HEARTBEAT_REPLAYED');
  assert.equal((await request(base,hostPath+'/heartbeat',hostToken,'POST',
   {...good,connectionId:oldConnection,sequence:2,unexpected:'secret'})).status,422);
  const firstBooking=await request(base,'/internal/m2/reservations',ownerToken,'POST',body);
  assert.equal(firstBooking.status,201);
  firstId=(await firstBooking.json()).reservation.id;
  // A newer process with the same host credential must fence the old process,
  // invalidate its persisted reservation and remove its prior readiness claim.
  const newConnection=await request(base,hostPath+'/connect',hostToken,'POST',hello);
  assert.equal(newConnection.status,201);
  secondConnection=(await newConnection.json()).connectionId;
  assert.notEqual(oldConnection,secondConnection);
  const after=await (await request(base,'/internal/m2/status',admin)).json();
  assert.equal(after.hosts.length,0);
  assert.equal(after.reservations.find(t=>t.id===firstId).state,'expired');
  assert.equal(after.reservations.find(t=>t.id===firstId).reason,'HOST_CONNECTION_REPLACED');
  assert.equal((await request(base,'/internal/m2/reservations',ownerToken,'POST',
   {...body,idempotencyKey:'host-generation-0002'})).status,409);
  const stale=await request(base,hostPath+'/heartbeat',hostToken,'POST',
   {...good,connectionId:oldConnection,sequence:2});
  assert.equal(stale.status,409);
  assert.equal((await stale.json()).code,'HOST_CONNECTION_FENCED');
  assert.equal((await request(base,hostPath+'/heartbeat',hostToken,'POST',
   {...good,connectionId:secondConnection,sequence:1})).status,202);
  const booked=await request(base,'/internal/m2/reservations',ownerToken,'POST',
   {...body,idempotencyKey:'host-generation-0002'});
  assert.equal(booked.status,201);secondId=(await booked.json()).reservation.id;
  const disk=fs.readFileSync(statePath,'utf8');
  assert.equal(disk.includes(oldConnection),false);
  assert.equal(disk.includes(secondConnection),false);
 }finally{await stop(app)}
 const restarted=createM2Coordinator({adminToken:admin,hostTokens:{},
  enabledGames:['supertuxkart'],statePath});
 const url=await start(restarted);
 try{
  const stale=await request(url,'/internal/m2/hosts/gpuHost01/heartbeat',hostToken,
   'POST',{...good,connectionId:secondConnection,sequence:2});
  assert.equal(stale.status,409);
  assert.equal((await stale.json()).code,'HOST_CONNECTION_REQUIRED');
  const status=await (await request(url,'/internal/m2/status',admin)).json();
  assert.equal(status.hosts.length,0);
  assert.equal(status.reservations.find(t=>t.id===firstId).reason,'HOST_CONNECTION_REPLACED');
  assert.equal(status.reservations.find(t=>t.id===secondId).reason,'CONTROL_PLANE_RESTART');
  assert.equal((await request(url,'/internal/m2/hosts/gpuHost01/connect',hostToken,'POST',hello)).status,201);
 }finally{await stop(restarted);fs.rmSync(dir,{recursive:true,force:true})}
});

test('legacy static hosts accept v1 until explicit connection opts them into replay fencing',async()=>{
 const host='H'.repeat(48);
 const app=createM2Coordinator({adminToken:admin,hostTokens:{legacy01:host}});
 const url=await start(app);
 try{
  const route='/internal/m2/hosts/legacy01';
  assert.equal((await request(url,route+'/heartbeat',host,'POST',good)).status,202);
  const connected=await request(url,route+'/connect',host,'POST',hello);
  assert.equal(connected.status,201);
  const connectionId=(await connected.json()).connectionId;
  assert.equal((await request(url,route+'/heartbeat',host,'POST',good)).status,422);
  assert.equal((await request(url,route+'/heartbeat',host,'POST',
   {...good,connectionId,sequence:1})).status,202);
 }finally{await stop(app)}
});
