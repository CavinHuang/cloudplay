#!/usr/bin/env node
/**
 * M2 installed Windows offline runtime acceptance.
 * Executes the REAL packaged Node and packaged M2 service through localhost.
 * No GPU, Sunshine, game process, external download or synthetic video involved.
 * Synthetic heartbeat flags check reservation policy only (never GPU proof).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const token=()=>randomBytes(40).toString('hex');
async function availablePort(){
 const srv=net.createServer();
 await new Promise((resolve,reject)=>srv.once('error',reject).listen(0,'127.0.0.1',resolve));
 const port=srv.address().port;
 await new Promise(resolve=>srv.close(resolve));
 return port;
}
async function main(){
 const source=process.argv[2];
 if(!source)throw Error('USAGE: smoke-m2-offline.mjs <verified-windows-bundle>');
 const root=path.resolve(source);
 const node=path.join(root,'runtime','node.exe');
 const entry=path.join(root,'services','m2','scripts','m2','start-control.mjs');
 for(const name of [node,entry]){
  if(!fs.existsSync(name)||!fs.statSync(name).isFile())throw Error('M2_BUNDLED_ENTRYPOINT_MISSING');
 }
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'cloudplay-m2-offline-'));
 const stateDir=path.join(temp,'state');
 const admin=token(),hostToken=token(),hostId='offline-test-host';
 const port=await availablePort();
 const base='http://127.0.0.1:'+port;
 let child=null;
 async function stop(){
  if(!child)return;
  const current=child;child=null;
  if(current.exitCode===null&&current.signalCode===null){
   current.kill();
   await Promise.race([
    new Promise(resolve=>current.once('exit',resolve)),
    delay(3000)
   ]);
   if(current.exitCode===null&&current.signalCode===null){
    current.kill('SIGKILL');
    await Promise.race([new Promise(resolve=>current.once('exit',resolve)),delay(1500)]);
   }
  }
  if(current.exitCode===null&&current.signalCode===null)throw Error('M2_OFFLINE_CHILD_CLEANUP_FAILED');
 }
 async function start(allowReservations){
  const env={...process.env,CLOUDPLAY_M2_STATE_DIR:stateDir,CLOUDPLAY_M2_PORT:String(port),
   CLOUDPLAY_M2_ADMIN_TOKEN:admin,CLOUDPLAY_M2_HOST_TOKENS:JSON.stringify({[hostId]:hostToken}),
   CLOUDPLAY_M2_ALLOW_SUPERTUXKART_RESERVATION:allowReservations?'1':'0'};
  child=spawn(node,[entry],{cwd:root,env,windowsHide:true,stdio:'ignore'});
  for(let n=0;n<65;n++){
   if(child.exitCode!==null)throw Error('M2_BUNDLED_SERVICE_DID_NOT_START');
   try{
    const health=await fetch(base+'/health',{signal:AbortSignal.timeout(700)});
    if(health.status===200){
     const body=await health.json();
     assert.equal(body.status,'ok');assert.equal(body.streamVerified,false);
     assert.equal(body.gameLaunchEnabled,false);
     return;
    }
   }catch{/* not ready yet */}
   await delay(125);
  }
  throw Error('M2_BUNDLED_SERVICE_HEALTH_TIMEOUT');
 }
 const request=(method,urlPath,secret,body,extra={})=>fetch(base+urlPath,{
  method,headers:{Authorization:'Bearer '+secret,'X-CloudPlay-M2-Action':'1',
   ...(body!==undefined?{'Content-Type':'application/json'}:{}),...extra},
  ...(body!==undefined?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(2500)
 });
 const good={gpuDetected:true,sunshineReady:true,moonlightReady:true,
  gameAvailable:true,drain:false,gameProcessBusy:false};
 const unavailable={...good,gpuDetected:false};
 const reservation={ownerId:'local-operator',gameId:'supertuxkart',idempotencyKey:'offline-smoke-00001'};
 try{
  await start(true);
  assert.equal((await request('GET','/internal/m2/status','wrong-token')).status,401);
  assert.equal((await request('GET','/internal/m2/status',hostToken)).status,401);
  assert.equal((await request('POST','/internal/m2/hosts/'+hostId+'/heartbeat',admin,unavailable)).status,401);
  assert.equal((await request('POST','/internal/m2/hosts/'+hostId+'/heartbeat',hostToken,unavailable)).status,202);
  assert.equal((await request('POST','/internal/m2/reservations',admin,reservation)).status,409);
  assert.equal((await request('POST','/internal/m2/hosts/'+hostId+'/heartbeat',hostToken,good,
   {'X-Forwarded-Host':'public.example'})).status,403);
  assert.equal((await request('POST','/internal/m2/hosts/'+hostId+'/heartbeat',hostToken,good,
   {Origin:'https://outside.example'})).status,403);
  assert.equal((await request('POST','/internal/m2/hosts/'+hostId+'/heartbeat',hostToken,good)).status,202);
  // This is only a CONTROL-PLANE fixture; no GPU/game/stream is started.
  const booking=await request('POST','/internal/m2/reservations',admin,reservation);
  assert.equal(booking.status,201);
  const ticket=(await booking.json()).reservation;
  assert.equal(ticket.ownerId,'local-operator');
  assert.equal(ticket.hostId,hostId);
  assert.equal((await request('POST','/internal/m2/reservations',admin,reservation)).status,200);
  assert.equal((await request('POST','/internal/m2/reservations',admin,
   {...reservation,ownerId:'another-owner',idempotencyKey:'offline-smoke-00002'})).status,409);
  const journal=fs.readFileSync(path.join(stateDir,'m2-journal.json'),'utf8');
  assert.ok(journal.includes(ticket.id));
  assert.ok(!journal.includes(admin)&&!journal.includes(hostToken));
  // Admin-only enrollment issues scoped private identities with credentials
  // returned exactly once. Keep existing env-configured legacy host separate.
  const enrolledHost=await request('POST','/internal/m2/hosts',admin,{hostId:'newOfflineHost'});
  assert.equal(enrolledHost.status,201);
  const enrolledHostToken=(await enrolledHost.json()).token;
  const enrolledOwner=await request('POST','/internal/m2/owners',admin,{ownerId:'offlineOwner'});
  assert.equal(enrolledOwner.status,201);
  const enrolledOwnerToken=(await enrolledOwner.json()).token;
  assert.equal((await request('POST','/internal/m2/hosts/newOfflineHost/heartbeat',enrolledHostToken,good)).status,202);
  const ownerRequest={ownerId:'offlineOwner',gameId:'supertuxkart',idempotencyKey:'offline-owner-0001'};
  assert.equal((await request('POST','/internal/m2/reservations',hostToken,ownerRequest)).status,401);
  const ownerBooking=await request('POST','/internal/m2/reservations',enrolledOwnerToken,ownerRequest);
  assert.equal(ownerBooking.status,201);
  const ownerTicket=(await ownerBooking.json()).reservation;
  assert.equal(ownerTicket.hostId,'newOfflineHost');
  assert.equal((await request('GET','/internal/m2/status',enrolledOwnerToken)).status,401);
  const rotated=await request('POST','/internal/m2/hosts/newOfflineHost/rotate',admin);
  assert.equal(rotated.status,200);
  assert.equal((await request('POST','/internal/m2/hosts/newOfflineHost/heartbeat',enrolledHostToken,good)).status,401);
  assert.equal((await request('DELETE','/internal/m2/owners/offlineOwner',admin)).status,200);
  assert.equal((await request('GET','/internal/m2/owners/offlineOwner/reservations',enrolledOwnerToken)).status,401);
  const recorded=await (await request('GET','/internal/m2/status',admin)).json();
  assert.equal(recorded.reservations.find(x=>x.id===ownerTicket.id).reason,'HOST_CREDENTIAL_CHANGED');
  const identitiesDisk=fs.readFileSync(path.join(stateDir,'m2-identities.json'),'utf8');
  assert.ok(!identitiesDisk.includes(enrolledHostToken)&&!identitiesDisk.includes(enrolledOwnerToken));
  // A controlled service restart expires the reservation and clears all
  // unverified host presence; it must not silently restore active capacity.
  await stop();
  await start(false);
  const statusReply=await request('GET','/internal/m2/status',admin);
  assert.equal(statusReply.status,200);
  const status=await statusReply.json();
  assert.equal(status.hosts.length,0);
  assert.equal(status.reservations.length,1);
  assert.equal(status.reservations[0].id,ticket.id);
  assert.equal(status.reservations[0].state,'expired');
  assert.equal(status.reservations[0].reason,'CONTROL_PLANE_RESTART');
  assert.equal((await request('POST','/internal/m2/hosts/'+hostId+'/heartbeat',hostToken,good)).status,202);
  assert.equal((await request('POST','/internal/m2/reservations',admin,
   {...reservation,idempotencyKey:'offline-smoke-00003'})).status,403);
  console.log('PASS: packaged M2 Node service, loopback HTTP, token/Origin/proxy denial, no-GPU refusal, capacity exclusivity, journal restart expiry and default-off policy.');
  console.log('NOT CHECKED: actual physical GPU, real game process, remote networking or video/audio/input.');
 }finally{
  try{await stop()}finally{fs.rmSync(temp,{recursive:true,force:true})}
 }
}
main().catch(e=>{console.error('M2_OFFLINE_SMOKE_FAILED:',e.message);process.exitCode=1});
