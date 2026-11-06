import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createIdentityRegistry} from '../lib/m2/identities.mjs';
import {createM2Coordinator} from '../lab/m2-coordinator.mjs';

const admin='A'.repeat(48);
const legacyHost='L'.repeat(48);
const good={gpuDetected:true,sunshineReady:true,moonlightReady:true,
 gameAvailable:true,drain:false,gameProcessBusy:false};
const body={ownerId:'ownerAlpha',gameId:'supertuxkart',idempotencyKey:'registered-0001'};
const folder=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cloudplay-m2-identity-test-'));
async function start(app){
 await new Promise((resolve,reject)=>app.server.once('error',reject).listen(0,'127.0.0.1',resolve));
 return 'http://127.0.0.1:'+app.server.address().port;
}
async function close(app){await new Promise(resolve=>app.server.close(resolve))}
function request(base,route,secret,method='GET',data,extra={}){
 return fetch(base+route,{method,headers:{Authorization:'Bearer '+secret,
  'X-CloudPlay-M2-Action':'1',...(data?{'Content-Type':'application/json'}:{}),...extra},
  ...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(3000)});
}

test('registration generates unrepeatable secrets; journal contains digests and revocation survives restart',()=>{
 const dir=folder(),statePath=path.join(dir,'m2-identities.json');
 try{
  let registry=createIdentityRegistry({statePath,legacyHostTokens:{oldHost:legacyHost}});
  const host=registry.register('host','gpuHost01');
  const owner=registry.register('owner','ownerAlpha');
  assert.equal(host.status,201);assert.equal(owner.status,201);
  assert.match(host.token,/^[0-9a-f]{64}$/);assert.notEqual(host.token,owner.token);
  assert.equal(registry.authenticate('host','gpuHost01',host.token),true);
  assert.equal(registry.authenticate('owner','ownerAlpha',host.token),false);
  assert.equal(registry.authenticate('host','oldHost',legacyHost),true);
  assert.equal(registry.register('host','oldHost').status,409);
  assert.equal(registry.register('host','gpuHost01').status,409);
  assert.equal(registry.rotate('host','oldHost').status,409);
  const disk=fs.readFileSync(statePath,'utf8');
  for(const secret of [host.token,owner.token,legacyHost,admin])assert.equal(disk.includes(secret),false);
  registry=createIdentityRegistry({statePath,legacyHostTokens:{oldHost:legacyHost}});
  assert.equal(registry.authenticate('host','gpuHost01',host.token),true);
  const rotated=registry.rotate('host','gpuHost01');
  assert.equal(rotated.status,200);
  assert.equal(registry.authenticate('host','gpuHost01',host.token),false);
  assert.equal(registry.authenticate('host','gpuHost01',rotated.token),true);
  assert.equal(registry.revoke('owner','ownerAlpha').status,200);
  assert.equal(registry.authenticate('owner','ownerAlpha',owner.token),false);
  const reloaded=createIdentityRegistry({statePath,legacyHostTokens:{oldHost:legacyHost}});
  assert.equal(reloaded.authenticate('host','gpuHost01',rotated.token),true);
  assert.equal(reloaded.authenticate('owner','ownerAlpha',owner.token),false);
  assert.equal(reloaded.list().owners.length,0);
  fs.writeFileSync(statePath,'{broken');
  assert.throws(()=>createIdentityRegistry({statePath}),/M2_IDENTITIES_READ_FAILED/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('real localhost HTTP scopes reservations to owner identity; rotate and revoke immediately invalidate capacity',async()=>{
 const dir=folder(),statePath=path.join(dir,'m2-journal.json');
 const app=createM2Coordinator({adminToken:admin,hostTokens:{},statePath,enabledGames:['supertuxkart']});
 const base=await start(app);
 let hostToken,ownerToken,otherToken;
 try{
  assert.equal((await request(base,'/internal/m2/status','unauthorized')).status,401);
  const enrolled=await request(base,'/internal/m2/hosts',admin,'POST',{hostId:'gpuHost01'});
  assert.equal(enrolled.status,201);hostToken=(await enrolled.json()).token;
  const a=await request(base,'/internal/m2/owners',admin,'POST',{ownerId:'ownerAlpha'});
  const b=await request(base,'/internal/m2/owners',admin,'POST',{ownerId:'ownerBeta'});
  assert.equal(a.status,201);assert.equal(b.status,201);
  ownerToken=(await a.json()).token;otherToken=(await b.json()).token;
  const inventory=await (await request(base,'/internal/m2/identities',admin)).json();
  assert.equal(inventory.hosts.length,1);assert.equal(inventory.owners.length,2);
  assert.equal(JSON.stringify(inventory).includes(hostToken),false);
  assert.equal((await request(base,'/internal/m2/hosts/gpuHost01/heartbeat',admin,'POST',good)).status,401);
  assert.equal((await request(base,'/internal/m2/hosts/gpuHost01/heartbeat',hostToken,'POST',good)).status,202);
  assert.equal((await request(base,'/internal/m2/reservations',otherToken,'POST',body)).status,401);
  const booked=await request(base,'/internal/m2/reservations',ownerToken,'POST',body);
  assert.equal(booked.status,201);
  const ticket=(await booked.json()).reservation;
  assert.equal(ticket.ownerId,'ownerAlpha');
  assert.equal((await request(base,'/internal/m2/owners/ownerAlpha/reservations',otherToken)).status,401);
  const mine=await (await request(base,'/internal/m2/owners/ownerAlpha/reservations',ownerToken)).json();
  assert.equal(mine.reservations.length,1);
  assert.equal(mine.reservations[0].id,ticket.id);
  assert.equal((await request(base,'/internal/m2/status',ownerToken)).status,401);
  assert.equal((await request(base,'/internal/m2/reservations/'+ticket.id,otherToken,'DELETE',{ownerId:'ownerAlpha'})).status,401);
  const rotate=await request(base,'/internal/m2/hosts/gpuHost01/rotate',admin,'POST');
  assert.equal(rotate.status,200);const rotatedHost=(await rotate.json()).token;
  assert.notEqual(rotatedHost,hostToken);
  assert.equal((await request(base,'/internal/m2/hosts/gpuHost01/heartbeat',hostToken,'POST',good)).status,401);
  const status=await (await request(base,'/internal/m2/status',admin)).json();
  assert.equal(status.hosts.length,0);
  assert.equal(status.reservations[0].state,'expired');
  assert.equal(status.reservations[0].reason,'HOST_CREDENTIAL_CHANGED');
  assert.equal((await request(base,'/internal/m2/hosts/gpuHost01/heartbeat',rotatedHost,'POST',good)).status,202);
  const again=await request(base,'/internal/m2/reservations',ownerToken,'POST',
   {...body,idempotencyKey:'registered-0002'});
  assert.equal(again.status,201);
  const second=(await again.json()).reservation;
  const revokeOwner=await request(base,'/internal/m2/owners/ownerAlpha',admin,'DELETE');
  assert.equal(revokeOwner.status,200);
  assert.equal((await request(base,'/internal/m2/owners/ownerAlpha/reservations',ownerToken)).status,401);
  assert.equal((await request(base,'/internal/m2/reservations/'+second.id,ownerToken,'DELETE',{ownerId:'ownerAlpha'})).status,401);
  const after=await (await request(base,'/internal/m2/status',admin)).json();
  assert.equal(after.reservations.find(x=>x.id===second.id).reason,'OWNER_REVOKED');
  assert.equal((await request(base,'/internal/m2/hosts/gpuHost01',admin,'DELETE')).status,200);
  assert.equal((await request(base,'/internal/m2/hosts/gpuHost01/heartbeat',rotatedHost,'POST',good)).status,401);
  const disk=fs.readFileSync(path.join(dir,'m2-identities.json'),'utf8');
  for(const secret of [hostToken,ownerToken,otherToken,rotatedHost])assert.equal(disk.includes(secret),false);
 }finally{await close(app)}
 const restarted=createM2Coordinator({adminToken:admin,hostTokens:{},statePath,enabledGames:['supertuxkart']});
 const url=await start(restarted);
 try{
  assert.equal((await request(url,'/internal/m2/hosts/gpuHost01/heartbeat',hostToken,'POST',good)).status,401);
  assert.equal((await request(url,'/internal/m2/hosts/gpuHost01/heartbeat','bad','POST',good)).status,401);
  assert.equal((await request(url,'/internal/m2/owners/ownerBeta/reservations',otherToken)).status,200);
  const s=await (await request(url,'/internal/m2/status',admin)).json();
  assert.equal(s.hosts.length,0);
  assert.equal(s.reservations.every(x=>x.state!=='reserved'),true);
 }finally{await close(restarted);fs.rmSync(dir,{recursive:true,force:true})}
});

test('registry creation rejects duplicate secrets and host enrollment cannot bypass request guards',async()=>{
 const app=createM2Coordinator({adminToken:admin,hostTokens:{hostLegacy:legacyHost}});
 const base=await start(app);
 try{
  assert.equal((await request(base,'/internal/m2/hosts',legacyHost,'POST',{hostId:'newHost'})).status,401);
  assert.equal((await request(base,'/internal/m2/hosts',admin,'POST',{hostId:'newHost'},
   {Origin:'https://untrusted.example'})).status,403);
  assert.equal((await request(base,'/internal/m2/hosts',admin,'POST',{hostId:'newHost'},
   {'X-Forwarded-Host':'public.example'})).status,403);
  assert.equal((await request(base,'/internal/m2/hosts',admin,'POST',{hostId:'hostLegacy'})).status,409);
  assert.equal((await request(base,'/internal/m2/hosts',admin,'POST',{hostId:'bad/host'})).status,422);
 }finally{await close(app)}
});
