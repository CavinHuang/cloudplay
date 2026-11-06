import test from 'node:test';
import assert from 'node:assert/strict';
import {createM2Coordinator} from '../lab/m2-coordinator.mjs';

const admin='A'.repeat(48);
const good={gpuDetected:true,sunshineReady:true,moonlightReady:true,gameAvailable:true,
 drain:false,gameProcessBusy:false};
const reservation={ownerId:'ownerAlpha',gameId:'supertuxkart',idempotencyKey:'lease-http-0001'};
async function setup(app){
 await new Promise((resolve,reject)=>app.server.once('error',reject).listen(0,'127.0.0.1',resolve));
 return 'http://127.0.0.1:'+app.server.address().port;
}
async function shutdown(app){await new Promise(resolve=>app.server.close(resolve))}
function req(url,route,token,method='GET',body,headers={}){
 return fetch(url+route,{method,headers:{Authorization:'Bearer '+token,'X-CloudPlay-M2-Action':'1',
  ...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},
  ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(3000)});
}

test('M2 real HTTP renewal is owner-authenticated and fenced to one current expiry',async()=>{
 let now=Date.parse('2026-11-06T09:00:00.000Z');
 const app=createM2Coordinator({adminToken:admin,hostTokens:{},
  enabledGames:['supertuxkart'],clock:()=>now,
  manager:null});
 // Default 120s leases and 16s host heartbeat; clock jumps are deterministic.
 const url=await setup(app);
 try{
  const enrolledHost=await req(url,'/internal/m2/hosts',admin,'POST',{hostId:'gpuHost01'});
  const hostToken=(await enrolledHost.json()).token;
  const enrolledOwner=await req(url,'/internal/m2/owners',admin,'POST',{ownerId:'ownerAlpha'});
  const ownerToken=(await enrolledOwner.json()).token;
  const otherOwner=await req(url,'/internal/m2/owners',admin,'POST',{ownerId:'ownerBeta'});
  const otherToken=(await otherOwner.json()).token;
  assert.equal((await req(url,'/internal/m2/hosts/gpuHost01/heartbeat',hostToken,'POST',good)).status,202);
  const created=await req(url,'/internal/m2/reservations',ownerToken,'POST',reservation);
  assert.equal(created.status,201);
  const ticket=(await created.json()).reservation;
  const route='/internal/m2/reservations/'+ticket.id+'/renew';
  const original={ownerId:'ownerAlpha',expectedExpiresAt:ticket.expiresAt};
  assert.equal((await req(url,route,otherToken,'POST',original)).status,401);
  assert.equal((await req(url,route,hostToken,'POST',original)).status,401);
  assert.equal((await req(url,route,ownerToken,'POST',original,{'Origin':'https://invalid.example'})).status,403);
  assert.equal((await req(url,route,ownerToken,'GET')).status,405);
  assert.equal((await req(url,route,ownerToken,'POST',original,{'X-CloudPlay-M2-Action':'0'})).status,403);
  assert.equal((await req(url,route,ownerToken,'POST',original)).status,409); // too early
  now+=61000;
  // A 16s heartbeat must be refreshed before a lease may be prolonged.
  assert.equal((await (await req(url,route,ownerToken,'POST',original)).json()).code,'HOST_NOT_READY_FOR_RENEWAL');
  assert.equal((await req(url,'/internal/m2/hosts/gpuHost01/heartbeat',hostToken,'POST',{...good,drain:true})).status,202);
  assert.equal((await (await req(url,route,ownerToken,'POST',original)).json()).code,'HOST_NOT_READY_FOR_RENEWAL');
  assert.equal((await req(url,'/internal/m2/hosts/gpuHost01/heartbeat',hostToken,'POST',good)).status,202);
  const renewed=await req(url,route,ownerToken,'POST',original);
  assert.equal(renewed.status,200);
  const next=(await renewed.json()).reservation;
  assert.equal(next.expiresAt,now+120000);
  assert.equal((await (await req(url,route,ownerToken,'POST',original)).json()).code,'LEASE_FENCE_CONFLICT');
  const mine=await (await req(url,'/internal/m2/owners/ownerAlpha/reservations',ownerToken)).json();
  assert.equal(mine.reservations[0].expiresAt,next.expiresAt);
  // Revocation fences future lease extensions even when the caller copied
  // the latest expiration timestamp before the credential was revoked.
  assert.equal((await req(url,'/internal/m2/owners/ownerAlpha',admin,'DELETE')).status,200);
  assert.equal((await req(url,route,ownerToken,'POST',{ownerId:'ownerAlpha',expectedExpiresAt:next.expiresAt})).status,401);
  const after=await (await req(url,'/internal/m2/status',admin)).json();
  assert.equal(after.reservations[0].reason,'OWNER_REVOKED');
 }finally{await shutdown(app)}
});
