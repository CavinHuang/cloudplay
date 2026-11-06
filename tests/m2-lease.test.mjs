import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdmissionManager} from '../lib/m2/admission.mjs';

const good={gpuDetected:true,sunshineReady:true,moonlightReady:true,gameAvailable:true,
 drain:false,gameProcessBusy:false};
const request={ownerId:'ownerAlpha',gameId:'supertuxkart',idempotencyKey:'fencekey0001'};
const uuid='00000000-0000-4000-8000-00000000aaaa';

test('fenced M2 lease renewal requires a fresh idle heartbeat, advances expiry only once, and has hard lifetime',()=>{
 let now=Date.parse('2026-11-06T00:00:00.000Z'),persisted=0,seq=0;
 const manager=createAdmissionManager({clock:()=>now,id:()=>seq++===0?uuid:'00000000-0000-4000-8000-00000000aaab',
  enabledGames:['supertuxkart'],hostTtlMs:1500,leaseTtlMs:4000,maxLeaseAgeMs:10000,
  onChange:()=>{persisted++}});
 manager.heartbeat('gpu01',good);
 const created=manager.reserve(request);
 assert.equal(created.status,201);
 const start=created.reservation.expiresAt;
 assert.equal(start,now+4000);
 const renew=(expectedExpiresAt,ownerId='ownerAlpha')=>manager.renew(uuid,{ownerId,expectedExpiresAt});
 assert.equal(renew(start).code,'LEASE_RENEW_TOO_EARLY');
 assert.equal(manager.snapshot().reservations[0].expiresAt,start);
 now+=2500;manager.heartbeat('gpu01',good);
 const one=renew(start);assert.equal(one.status,200);
 assert.equal(one.reservation.expiresAt,now+4000);
 assert.equal(persisted,2);
 assert.equal(renew(start).code,'LEASE_FENCE_CONFLICT');
 assert.equal(renew(one.reservation.expiresAt,'anotherOwner').status,404);
 assert.equal(manager.renew(uuid,{ownerId:'ownerAlpha',expectedExpiresAt:String(start)}).status,422);
 now+=2100;
 assert.equal(renew(one.reservation.expiresAt).code,'HOST_NOT_READY_FOR_RENEWAL');
 manager.heartbeat('gpu01',{...good,drain:true});
 assert.equal(renew(one.reservation.expiresAt).code,'HOST_NOT_READY_FOR_RENEWAL');
 manager.heartbeat('gpu01',good);
 const two=renew(one.reservation.expiresAt);
 assert.equal(two.status,200);
 assert.equal(two.reservation.expiresAt,now+4000);
 now+=2100;
 manager.heartbeat('gpu01',{...good,gameProcessBusy:true});
 assert.equal(renew(two.reservation.expiresAt).code,'HOST_NOT_READY_FOR_RENEWAL');
 manager.heartbeat('gpu01',good);
 const three=renew(two.reservation.expiresAt);
 assert.equal(three.status,200);
 assert.equal(three.reservation.expiresAt,created.reservation.createdAt+10000);
 now+=2100;
 manager.heartbeat('gpu01',good);
 assert.equal(renew(three.reservation.expiresAt).code,'LEASE_MAX_LIFETIME_REACHED');
 now+=1300;
 assert.equal(renew(three.reservation.expiresAt).code,'LEASE_NOT_ACTIVE');
 assert.equal(manager.status().reservations[0].reason,'LEASE_TTL_EXPIRED');
 assert.equal(manager.reserve({...request,idempotencyKey:'fencekey0002'}).status,201);
});

test('journal write failure prevents renewal and retains previous fencing timestamp',()=>{
 let now=100000,fail=false;
 const manager=createAdmissionManager({clock:()=>now,id:()=>uuid,
  enabledGames:['supertuxkart'],leaseTtlMs:4000,maxLeaseAgeMs:12000,
  onChange:()=>{if(fail)throw Error('disk full')}});
 manager.heartbeat('gpu01',good);
 const created=manager.reserve(request);
 now+=2500;manager.heartbeat('gpu01',good);
 fail=true;
 assert.equal(manager.renew(uuid,{ownerId:'ownerAlpha',expectedExpiresAt:created.reservation.expiresAt}).code,
  'M2_JOURNAL_UNAVAILABLE');
 assert.equal(manager.snapshot().reservations[0].expiresAt,created.reservation.expiresAt);
 fail=false;
 assert.equal(manager.renew(uuid,{ownerId:'ownerAlpha',expectedExpiresAt:created.reservation.expiresAt}).status,200);
});

test('renew validation and hard limit are explicit; finalized tickets cannot renew',()=>{
 assert.throws(()=>createAdmissionManager({leaseTtlMs:10000,maxLeaseAgeMs:9000}),/INVALID_ADMISSION_TTLS/);
 const manager=createAdmissionManager({id:()=>uuid,enabledGames:['supertuxkart']});
 manager.heartbeat('gpu01',good);
 const created=manager.reserve(request);
 assert.equal(manager.renew(uuid,{ownerId:'ownerAlpha'}).status,422);
 assert.equal(manager.renew('bad',{ownerId:'ownerAlpha',expectedExpiresAt:1}).status,422);
 assert.equal(manager.release(uuid,{ownerId:'ownerAlpha'}).status,200);
 assert.equal(manager.renew(uuid,{ownerId:'ownerAlpha',expectedExpiresAt:created.reservation.expiresAt}).code,'LEASE_NOT_ACTIVE');
});
