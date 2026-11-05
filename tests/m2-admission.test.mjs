import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdmissionManager,sanitizeHostHeartbeat} from '../lib/m2/admission.mjs';
const stamp='2026-11-05T08:00:00Z';
const UUIDS=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
const good={gpuDetected:true,sunshineReady:true,moonlightReady:true,gameAvailable:true,drain:false,gameProcessBusy:false};
const params=(owner='tester-one',key='request_0001')=>({ownerId:owner,gameId:'supertuxkart',idempotencyKey:key});

test('M2 default denies reservations; unknown games and unsafe host claims rejected',()=>{
 const m=createAdmissionManager();
 assert.equal(m.heartbeat('host1',{...good,gpuModel:'secret'}).status,422);
 assert.equal(m.heartbeat('host1',good).status,202);
 assert.equal(m.reserve(params()).code,'GAME_RESERVATIONS_DISABLED');
 assert.equal(m.reserve({...params(),gameId:'commercial-game'}).status,422);
 assert.equal(m.reserve({...params(),command:'powershell'}).status,422);
 assert.equal(sanitizeHostHeartbeat({...good,sdp:'secret'}),null);
 assert.throws(()=>createAdmissionManager({enabledGames:['commercial-game']}));
});
test('M2 real host placement is exclusive and idempotent per owner/request',()=>{
 let now=Date.parse(stamp),i=0,writeCount=0;
 const m=createAdmissionManager({clock:()=>now,id:()=>UUIDS[i++],enabledGames:['supertuxkart'],onChange:()=>writeCount++});
 assert.equal(m.reserve(params()).code,'NO_IDLE_ELIGIBLE_HOST');
 m.heartbeat('hostB',good);m.heartbeat('hostA',good);
 const first=m.reserve(params());assert.equal(first.status,201);
 assert.equal(first.reservation.hostId,'hostA');
 assert.equal(first.streamVerified,false);
 const retry=m.reserve(params());assert.equal(retry.status,200);assert.equal(retry.idempotent,true);
 assert.equal(retry.reservation.id,first.reservation.id);assert.equal(writeCount,1);
 assert.equal(m.reserve(params('tester-one','request_0002')).code,'OWNER_ALREADY_RESERVED');
 const second=m.reserve(params('tester-two','request_0002'));assert.equal(second.status,201);
 assert.equal(second.reservation.hostId,'hostB');
 assert.equal(m.reserve(params('tester-3','request_0003')).code,'NO_IDLE_ELIGIBLE_HOST');
 assert.equal(m.release(first.reservation.id,{ownerId:'tester-two'}).status,404);
 assert.equal(m.release(first.reservation.id,{ownerId:'tester-one'}).status,200);
 assert.equal(m.release(first.reservation.id,{ownerId:'tester-one'}).idempotent,true);
 assert.equal(m.reserve(params()).code,'REQUEST_ALREADY_FINALIZED');
});
test('M2 never allocates stale, draining or busy hosts',()=>{
 let now=10_000;
 const m=createAdmissionManager({clock:()=>now,enabledGames:['supertuxkart'],hostTtlMs:5000});
 m.heartbeat('hostX',{...good,gameProcessBusy:true});assert.equal(m.reserve(params()).code,'NO_IDLE_ELIGIBLE_HOST');
 m.heartbeat('hostX',{...good,drain:true});assert.equal(m.reserve(params()).code,'NO_IDLE_ELIGIBLE_HOST');
 m.heartbeat('hostX',good);now+=5001;
 assert.equal(m.reserve(params()).code,'NO_IDLE_ELIGIBLE_HOST');
 assert.equal(m.status().hosts[0].heartbeatFresh,false);
});
test('M2 lease TTL frees capacity but finalized request remains finalized',()=>{
 let now=Date.parse(stamp),i=0;
 const m=createAdmissionManager({clock:()=>now,id:()=>UUIDS[i++],enabledGames:['supertuxkart'],leaseTtlMs:2000});
 m.heartbeat('hostA',good);
 const one=m.reserve(params());assert.equal(one.status,201);
 now+=2001;m.heartbeat('hostA',good);
 assert.equal(m.status().reservations[0].state,'expired');
 assert.equal(m.reserve(params()).code,'REQUEST_ALREADY_FINALIZED');
 const two=m.reserve(params('tester-one','request_0002'));
 assert.equal(two.status,201);assert.notEqual(one.reservation.id,two.reservation.id);
});
test('M2 journal commit errors roll back writes and refuse false capacity',()=>{
 let fail=true;
 const m=createAdmissionManager({enabledGames:['supertuxkart'],id:()=>UUIDS[0],onChange:()=>{if(fail)throw Error('disk full')}});
 m.heartbeat('hostA',good);
 assert.equal(m.reserve(params()).code,'M2_JOURNAL_UNAVAILABLE');
 assert.equal(m.status().reservations.length,0);
 fail=false;assert.equal(m.reserve(params()).status,201);
 fail=true;assert.equal(m.release(UUIDS[0],{ownerId:'tester-one'}).code,'M2_JOURNAL_UNAVAILABLE');
 assert.equal(m.status().reservations[0].state,'reserved');
});
test('M2 restart discards live host claims and expires orphan reservations',()=>{
 let i=0;const m=createAdmissionManager({enabledGames:['supertuxkart'],id:()=>UUIDS[i++]});
 m.heartbeat('hostA',good);assert.equal(m.reserve(params()).status,201);
 const saved=m.snapshot(),restarted=createAdmissionManager({enabledGames:['supertuxkart']});
 restarted.restore(saved);
 const after=restarted.status();
 assert.equal(after.hosts.length,0);
 assert.equal(after.reservations[0].state,'expired');
 assert.equal(after.reservations[0].reason,'CONTROL_PLANE_RESTART');
 assert.equal(restarted.reserve(params()).code,'REQUEST_ALREADY_FINALIZED');
 assert.throws(()=>restarted.restore(saved));
 assert.throws(()=>createAdmissionManager().restore({...saved,reservations:[saved.reservations[0],saved.reservations[0]]}));
});


test('M2 prunes aged journal history and does not overwrite a duplicate reservation UUID',()=>{
 const now=Date.parse('2026-11-05T08:00:00Z'),old=now-3*86400000;
 const id='55555555-5555-4555-8555-555555555555';
 const m=createAdmissionManager({clock:()=>now,enabledGames:['supertuxkart'],id:()=>id});
 const history=Array.from({length:500},(_,n)=>({
  id:`00000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,
  ownerId:'operator'+n,gameId:'supertuxkart',hostId:'hostA',
  idempotencyKey:'request_'+String(n).padStart(8,'0'),state:'released',
  createdAt:old,expiresAt:old+120000,reason:'OPERATOR_RELEASED'
 }));
 m.restore({schema:'cloudplay.m2.reservations.v1',reservations:history});
 m.heartbeat('hostA',good);
 assert.equal(m.reserve(params()).status,201);
 assert.ok(m.status().reservations.length<=500);
 assert.equal(m.release(id,{ownerId:'tester-one'}).status,200);
 assert.equal(m.reserve(params('tester-two','request_0002')).code,'RESERVATION_ID_COLLISION');
 assert.equal(m.status().reservations.find(t=>t.id===id).state,'released');
});
