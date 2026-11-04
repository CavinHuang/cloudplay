import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createMediaEvidenceRecorder,assessMediaEvidence} from '../lib/lab/media-evidence.mjs';
import {createCoordinator} from '../lib/lab/coordinator.mjs';

const sid='11111111-2222-4333-8444-555555555555';
const sample=(frames,audio,connection='connected')=>({
  connectionState:connection,iceConnectionState:connection,
  video:{framesDecoded:frames,bytesReceived:frames*2000,framesPerSecond:60,frameWidth:1280,frameHeight:720,packetsLost:0},
  audio:{bytesReceived:audio,packetsLost:0},network:{roundTripTimeMs:18},
  candidates:[{ip:'192.0.2.12',password:'should-never-leak'}],sdp:'SECRET'
});
const build=()=>{let now=Date.parse('2026-11-04T00:00:00Z');const r=createMediaEvidenceRecorder({sessionId:sid,clock:()=>now});
  for(const [f,a] of [[0,0],[12,300],[23,600],[35,900]]){assert.equal(r.add(sample(f,a)),true);now+=1500;}
  return r.export();};

test('collects only local whitelisted counters and identifies real decoded-frame deltas',()=>{
  const result=build();assert.equal(result.samples.length,4);
  assert.equal(result.assessment.valid,true);
  assert.equal(result.assessment.decodedVideoObserved,true);
  assert.equal(result.assessment.audioBytesIncreasing,true);
  assert.equal(result.assessment.gameImageVerified,false);
  assert.equal(result.assessment.audibleAudioVerified,false);
  assert.equal(result.assessment.gameInputVerified,false);
  assert.equal(JSON.stringify(result).includes('192.0.2.12'),false);
  assert.equal(JSON.stringify(result).includes('SECRET'),false);
});

test('does not treat unchanged counters, ICE failures or a forged summary as proof',()=>{
  for(const raws of [
    [sample(0,0),sample(0,0),sample(0,0),sample(0,0)],
    [sample(0,0),sample(10,20,'failed'),sample(20,30,'failed'),sample(30,40,'failed')],
    [sample(100,0),sample(10,10),sample(10,20),sample(10,30)],
  ]){
    let t=Date.parse('2026-11-04T00:00:00Z');const recorder=createMediaEvidenceRecorder({sessionId:sid,clock:()=>t});
    for(const raw of raws){recorder.add(raw);t+=1500;}
    const result=recorder.export();result.assessment={transportObserved:true,decodedVideoObserved:true};
    assert.equal(assessMediaEvidence(result).transportObserved,false);
  }
});

test('rejects invalid order, excess samples, malformed UUID and duplicate clock ticks',()=>{
  const valid=build();
  assert.equal(assessMediaEvidence({...valid,samples:[valid.samples[1],valid.samples[0]]}).valid,false);
  assert.equal(assessMediaEvidence({...valid,samples:[valid.samples[0],valid.samples[0]]}).valid,false);
  assert.equal(assessMediaEvidence({...valid,sessionId:'invalid'}).valid,false);
  assert.equal(assessMediaEvidence({...valid,samples:Array(181).fill(valid.samples[0])}).valid,false);
  let time=Date.parse('2026-11-04T00:00:00Z');const recorder=createMediaEvidenceRecorder({sessionId:sid,clock:()=>time});
  assert.equal(recorder.add(sample(1,1)),true);assert.equal(recorder.add(sample(2,2)),false);
});

test('CLI independently verifies the trace and rejects insufficient and sensitive reports',()=>{
  const dir=mkdtempSync(join(tmpdir(),'cloudplay-media-proof-'));
  try{
    const f=join(dir,'proof.json'),good=build();
    writeFileSync(f,JSON.stringify(good));
    const cli=()=>spawnSync(process.execPath,['scripts/p0/verify-media-evidence.mjs',f],{encoding:'utf8'});
    const pass=cli();assert.equal(pass.status,0,pass.stderr);assert.match(pass.stdout,/"decodedVideoObserved": true/);
    const noVideo={...good,samples:good.samples.map(x=>({...x,stats:{...x.stats,video:{...x.stats.video,framesDecoded:0}}}))};
    writeFileSync(f,JSON.stringify(noVideo));assert.equal(cli().status,1);
    writeFileSync(f,JSON.stringify({...good,samples:[{...good.samples[0],sdp:'SENSITIVE'}]}));
    assert.equal(cli().status,1);
    writeFileSync(f,JSON.stringify({...good,secret:'unwanted'}));
    assert.equal(cli().status,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('standalone P0 player serves media evidence collector from local loopback origin',async(t)=>{
  const c=createCoordinator({token:'test-acceptance-token-1234567890'});
  await new Promise(r=>c.server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>c.server.close(r)));
  const port=c.server.address().port;
  const res=await fetch(`http://127.0.0.1:${port}/assets/media-evidence.mjs`);
  assert.equal(res.status,200);
  assert.match(await res.text(),/createMediaEvidenceRecorder/);
  const page=await fetch(`http://127.0.0.1:${port}/play/${sid}`);
  assert.equal(page.status,200);
  const html=await page.text();assert.match(html,/export-media/);
  assert.match(html,/createMediaEvidenceRecorder/);
  assert.equal(html.includes('CLOUDPLAY_LAB_TOKEN'),false);
});

test('real P0 embedded player module parses with Node, including media export handler',async()=>{
 const {readFileSync}=await import('node:fs');
 const {spawnSync}=await import('node:child_process');
 const html=readFileSync(new URL('../lab/player.html',import.meta.url),'utf8');
 const match=html.match(/<script type="module">([\s\S]*?)<\/script>/);
 assert.ok(match,'P0 browser player must include module');
 const parsed=spawnSync(process.execPath,['--check','--input-type=module'],{input:match[1],encoding:'utf8'});
 assert.equal(parsed.status,0,parsed.stderr);
});
