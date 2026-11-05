import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createMediaEvidenceRecorder} from '../lib/lab/media-evidence.mjs';
import {assessHostPreflight,assessRecovery,verifyM1Index,REQUIRED_HOST_CHECKS} from '../lib/lab/m1-acceptance.mjs';

const base=Date.parse('2026-11-05T02:00:00.000Z');
const sid=i=>`0000000${i}-2222-4333-8444-555555555555`;
const sample=(f,a,conn='connected')=>({connectionState:conn,iceConnectionState:conn,
 video:{framesDecoded:f,bytesReceived:f*1000,framesPerSecond:30,width:1280,height:720,packetsLost:0},
 audio:{bytesReceived:a,packetsLost:0},network:{roundTripTimeMs:25}});
const plain=[[0,0],[8,100],[20,230],[32,380]];
const reconnect=[[0,0],[8,100],[8,100,'disconnected'],[8,100],[12,150],[20,240]];
const report=(i,recovery=false)=>{
 let now=base+(i-1)*150_000;
 const r=createMediaEvidenceRecorder({sessionId:sid(i),clock:()=>now});
 for(const [f,a,state] of recovery?reconnect:plain){assert.ok(r.add(sample(f,a,state)));now+=1500;}
 return r.export();
};
const png=()=>{const b=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.write('IHDR',12,'ascii');return b;};
const write=(dir,p,data)=>fs.writeFileSync(path.join(dir,p),typeof data==='object'&&!Buffer.isBuffer(data)?JSON.stringify(data):data);
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cloudplay-m1-test-'));
 const host={kind:'cloudplay-m1-host-preflight',schemaVersion:1,observedAt:new Date(base-60000).toISOString(),
 checks:Object.fromEntries(REQUIRED_HOST_CHECKS.map(k=>[k,true])),ready:true};
 write(dir,'host-preflight.json',host);
 const index={kind:'cloudplay-m1-acceptance',schemaVersion:1,game:'supertuxkart',hostPreflight:'host-preflight.json',
 sessions:[1,2,3].map(i=>({media:`cycle-${i}-media.json`,manual:`cycle-${i}-manual.json`,screenshot:`cycle-${i}.png`,reconnectExercise:i===3}))};
 for(let i=1;i<=3;i++){
  const media=report(i,i===3);
  write(dir,`cycle-${i}-media.json`,media);
  write(dir,`cycle-${i}-manual.json`,{game:'supertuxkart',sessionId:media.sessionId,
   observedAt:new Date(Date.parse(media.collectedAt)+1000).toISOString(),videoObserved:true,audioObserved:true,
   keyboardOrControllerObserved:true,successfulExitObserved:true,disconnectReconnectObserved:i===3,
   notes:'PEER_IP=192.0.2.10 TEST_ONLY; NOT FOR OUTPUT'});
  write(dir,`cycle-${i}.png`,png());
 }
 write(dir,'m1-index.json',index);
 return {dir,index,host};
}
const withFixture=cb=>{const f=fixture();try{return cb(f)}finally{fs.rmSync(f.dir,{recursive:true,force:true})}};
const run=f=>verifyM1Index(path.join(f.dir,'m1-index.json'));

test('three unique actual-shape sessions, host checks, media, screenshot and reconnect yield review-ready only',()=>withFixture(f=>{
 const r=run(f);assert.equal(r.readyForIndependentReview,true);assert.equal(r.cycles.length,3);
 assert.equal(r.cycles[2].recoveryStatsObserved,true);
 assert.equal(r.hardwarePreflight.ready,true);
 assert.equal(r.assurance.includes('Not independent proof'),true);
 assert.equal(JSON.stringify(r).includes('192.0.2.10'),false);
 assert.equal(JSON.stringify(r).includes('PEER_IP'),false);
 assert.match(r.cycles[0].screenshotSha256,/^[a-f0-9]{64}$/);
 const result=spawnSync(process.execPath,['scripts/p0/verify-m1-acceptance.mjs',path.join(f.dir,'m1-index.json')],{cwd:path.resolve('.'),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/readyForIndependentReview/);
}));

test('untrusted forged assessment fields cannot produce progress',()=>withFixture(f=>{
 const p=path.join(f.dir,'cycle-2-media.json'),r=JSON.parse(fs.readFileSync(p));
 for(const s of r.samples){s.stats.video.framesDecoded=0;s.stats.audio.bytesReceived=0;}
 r.assessment={valid:true,decodedVideoObserved:true,audioBytesIncreasing:true};write(f.dir,'cycle-2-media.json',r);
 const v=run(f);assert.equal(v.readyForIndependentReview,false);
 assert.ok(v.failures.includes('CYCLE_2_TRANSPORT_EVIDENCE_INCOMPLETE'));
}));

test('reuse of session UUID or evidence filename fails closed',()=>withFixture(f=>{
 const m=JSON.parse(fs.readFileSync(path.join(f.dir,'cycle-2-media.json')));m.sessionId=sid(1);write(f.dir,'cycle-2-media.json',m);
 assert.ok(run(f).failures.includes('CYCLE_2_DUPLICATE_OR_INVALID_SESSION'));
 const index={...f.index,sessions:[...f.index.sessions]};index.sessions[1]={...index.sessions[1],screenshot:index.sessions[0].screenshot};write(f.dir,'m1-index.json',index);
 assert.ok(run(f).failures.includes('CYCLE_2_REUSED_OR_INVALID_FILENAME'));
}));

test('reconnect must contain disconnected ICE, recovered frames and operator observation',()=>withFixture(f=>{
 const name='cycle-3-media.json',m=JSON.parse(fs.readFileSync(path.join(f.dir,name)));
 assert.equal(assessRecovery(m),true);
 m.samples[2].stats.connectionState='connected';m.samples[2].stats.iceConnectionState='connected';write(f.dir,name,m);
 assert.equal(assessRecovery(m),false);
 assert.ok(run(f).failures.includes('CYCLE_3_RECONNECT_NOT_PROVEN_BY_STATS_AND_OPERATOR'));
 write(f.dir,name,report(3,true));
 const human=JSON.parse(fs.readFileSync(path.join(f.dir,'cycle-3-manual.json')));
 human.disconnectReconnectObserved=false;write(f.dir,'cycle-3-manual.json',human);
 assert.ok(run(f).failures.includes('CYCLE_3_RECONNECT_NOT_PROVEN_BY_STATS_AND_OPERATOR'));
}));

test('missing audio/input, fake screenshot and host failure are not review-ready',()=>withFixture(f=>{
 const human=JSON.parse(fs.readFileSync(path.join(f.dir,'cycle-1-manual.json')));
 human.audioObserved=false;write(f.dir,'cycle-1-manual.json',human);
 write(f.dir,'cycle-2.png','not a real image');
 f.host.checks.nvidiaGpuDetected=false;f.host.ready=true;write(f.dir,'host-preflight.json',f.host);
 const r=run(f);
 assert.equal(r.readyForIndependentReview,false);
 assert.ok(r.failures.includes('HOST_CHECKS_INCOMPLETE'));
 assert.ok(r.failures.includes('CYCLE_1_MANUAL_OBSERVATION_INCOMPLETE'));
 assert.ok(r.failures.includes('CYCLE_2_EVIDENCE_FILE_INVALID'));
}));

test('path traversal, missing raw file and fake timeline are rejected',()=>withFixture(f=>{
 f.index.sessions[0].screenshot='../private.txt';write(f.dir,'m1-index.json',f.index);
 assert.ok(run(f).failures.includes('CYCLE_1_REUSED_OR_INVALID_FILENAME'));
 f.index.sessions[0].screenshot='cycle-1.png';write(f.dir,'m1-index.json',f.index);
 const m=JSON.parse(fs.readFileSync(path.join(f.dir,'cycle-1-manual.json')));
 m.observedAt='2020-01-01T00:00:00.000Z';write(f.dir,'cycle-1-manual.json',m);
 assert.ok(run(f).failures.includes('CYCLE_1_INVALID_EVIDENCE_TIMELINE'));
 fs.unlinkSync(path.join(f.dir,'cycle-3-media.json'));
 assert.ok(run(f).failures.includes('CYCLE_3_EVIDENCE_FILE_INVALID'));
}));

test('host preflight cannot declare itself ready when GPU or services fail',()=>{
 const h={kind:'cloudplay-m1-host-preflight',schemaVersion:1,observedAt:new Date(base).toISOString(),
  checks:Object.fromEntries(REQUIRED_HOST_CHECKS.map(k=>[k,true])),ready:true};
 h.checks.agentHeartbeat=false;
 assert.deepEqual(assessHostPreflight(h).failedChecks,['agentHeartbeat']);
 h.checks.sessionToken='SECRET';assert.equal(assessHostPreflight(h).valid,false);
});
