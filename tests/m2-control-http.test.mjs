import test from 'node:test';
import assert from 'node:assert/strict';
import {createM2Coordinator} from '../lab/m2-coordinator.mjs';
const admin='A'.repeat(48),host='B'.repeat(48);
const heartbeat={gpuDetected:true,sunshineReady:true,moonlightReady:true,gameAvailable:true,drain:false,gameProcessBusy:false};
const requestBody={ownerId:'operator01',gameId:'supertuxkart',idempotencyKey:'samplekey001'};
async function start(app){await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+app.server.address().port}
async function stop(app){await new Promise(r=>app.server.close(r))}
const request=(url,path,token,method='GET',body)=>fetch(url+path,{method,headers:{Authorization:'Bearer '+token,'X-CloudPlay-M2-Action':'1',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
test('M2 actual HTTP creates an authenticated exclusive reservation, then releases it',async()=>{
 const app=createM2Coordinator({adminToken:admin,hostTokens:{hostA:host},enabledGames:['supertuxkart']});
 const url=await start(app);
 try{
  assert.equal((await request(url,'/internal/m2/status','WRONG')).status,401);
  assert.equal((await request(url,'/internal/m2/hosts/hostA/heartbeat',admin,'POST',heartbeat)).status,401);
  assert.equal((await request(url,'/internal/m2/hosts/hostA/heartbeat',host,'POST',heartbeat)).status,202);
  const booked=await request(url,'/internal/m2/reservations',admin,'POST',requestBody);
  assert.equal(booked.status,201);
  const ticket=(await booked.json()).reservation;
  assert.equal(ticket.hostId,'hostA');
  const retry=await request(url,'/internal/m2/reservations',admin,'POST',requestBody);
  assert.equal(retry.status,200);
  assert.equal((await retry.json()).reservation.id,ticket.id);
  assert.equal((await request(url,'/internal/m2/reservations',admin,'POST',{...requestBody,idempotencyKey:'samplekey002'})).status,409);
  assert.equal((await request(url,'/internal/m2/reservations/'+ticket.id,admin,'DELETE',{ownerId:'wrongOwner'})).status,404);
  assert.equal((await request(url,'/internal/m2/reservations/'+ticket.id,admin,'DELETE',{ownerId:'operator01'})).status,200);
  const state=JSON.stringify(await (await request(url,'/internal/m2/status',admin)).json());
  assert.equal(state.includes(admin),false);assert.equal(state.includes(host),false);
 }finally{await stop(app)}
});
test('M2 does not reserve even with heartbeat when game opt-in is off',async()=>{
 const app=createM2Coordinator({adminToken:admin,hostTokens:{hostA:host}});const url=await start(app);
 try{
  await request(url,'/internal/m2/hosts/hostA/heartbeat',host,'POST',heartbeat);
  const r=await request(url,'/internal/m2/reservations',admin,'POST',requestBody);
  assert.equal(r.status,403);
 }finally{await stop(app)}
});
