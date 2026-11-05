import test from 'node:test';
import assert from 'node:assert/strict';
import {assessLocalReadiness} from '../lib/lab/local-readiness.mjs';

const host={gpuDetected:true,sunshinePortOpen:true,webStreamPortOpen:true,
  gameFilePresent:true,infrastructureReady:true};

test('M1 local readiness is false without a real host heartbeat',()=>{
 const result=assessLocalReadiness(null);
 assert.equal(result.ready,false);
 assert.equal(result.passing,0);
 assert.equal(result.total,6);
 assert.match(result.warning,/心跳/);
});
test('local UI becomes ready for one complete host and explicit launch authorization',()=>{
 const result=assessLocalReadiness({connected:true,localLaunchEnabled:true,hosts:[host]});
 assert.equal(result.ready,true);
 assert.equal(result.passing,6);
 assert.equal(result.warning,null);
});
test('local UI reports concrete missing GPU, Sunshine, Moonlight and game dependencies',()=>{
 for(const property of ['gpuDetected','sunshinePortOpen','webStreamPortOpen','gameFilePresent']){
  const result=assessLocalReadiness({connected:true,localLaunchEnabled:true,
    hosts:[{...host,[property]:false,infrastructureReady:false}]});
  assert.equal(result.ready,false,property);
  assert.equal(result.checks.find(c=>c.key===({
    gpuDetected:'gpu',sunshinePortOpen:'sunshine',
    webStreamPortOpen:'moonlight',gameFilePresent:'game'})[property]).ok,false);
 }
});
test('local UI refuses launch with operator flag missing or unverified infrastructure',()=>{
 assert.equal(assessLocalReadiness({connected:true,localLaunchEnabled:false,hosts:[host]}).ready,false);
 assert.equal(assessLocalReadiness({connected:true,localLaunchEnabled:true,
  hosts:[{...host,infrastructureReady:false}]}).ready,false);
});
test('single-host UI follows gateway: rejects multiple eligible hosts but allows one eligible host',()=>{
 const duplicate=assessLocalReadiness({connected:true,localLaunchEnabled:true,hosts:[host,host]});
 assert.equal(duplicate.ready,false);
 assert.match(duplicate.warning,/多台/);
 const one=assessLocalReadiness({connected:true,localLaunchEnabled:true,
  hosts:[host,{...host,gameFilePresent:false,infrastructureReady:false}]});
 assert.equal(one.ready,true);
});
test('readiness never exposes raw host identifiers, paths or model names',()=>{
 const result=assessLocalReadiness({connected:true,localLaunchEnabled:true,
  hosts:[{...host,hostId:'private-host-id',gpuModel:'private-model',gamePath:'C:/private/path'}]});
 const serialized=JSON.stringify(result);
 for(const secret of ['private-host-id','private-model','C:/private/path'])assert.equal(serialized.includes(secret),false);
});
