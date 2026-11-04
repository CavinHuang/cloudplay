import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoordinator,validateHeartbeat} from '../lib/lab/coordinator.mjs';
import {getGpu,getHostHeartbeat,validateLabEndpoint} from '../lib/lab/agent.mjs';
import {readLabStatus} from '../lib/lab/status-client.mjs';
const TOKEN='some-very-long-private-token-for-tests-0001';
const valid={hostId:'win-test-gpu',gpu:{detected:true,model:'NVIDIA test stub'},sunshinePortOpen:true,webStreamPortOpen:true,gameFilePresent:true};
function localServer(options={}) {
 const coordinator=createCoordinator({token:TOKEN,...options});
 return new Promise(resolve=>coordinator.server.listen(0,'127.0.0.1',()=>resolve({
  ...coordinator, url:`http://127.0.0.1:${coordinator.server.address().port}`, stop:()=>new Promise(done=>coordinator.server.close(done))
 })));
}
async function call(server,path,{auth=TOKEN,method='GET',body}={}){
 return fetch(server.url+path,{method,headers:{...(auth===null?{}:{Authorization:'Bearer '+auth}),...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
}
test('coordinator requires a strong token',()=>assert.throws(()=>createCoordinator({token:'short'})));
test('heartbeat validates types; cannot set streamVerified in payload',()=>{
 assert.equal(validateHeartbeat({...valid,webStreamPortOpen:'true'}),null);
 const data=validateHeartbeat({...valid,streamVerified:true,privateInfo:'SECRET'});
 assert.equal(data.streamVerified,undefined);
 assert.equal(data.privateInfo,undefined);
});
test('coordinator denies anonymous or incorrect token',async t=>{
 const srv=await localServer();t.after(()=>srv.stop());
 assert.equal((await call(srv,'/internal/status',{auth:null})).status,401);
 assert.equal((await call(srv,'/internal/heartbeat',{auth:'wrong',method:'POST',body:valid})).status,401);
});
test('coordinator accepts real agent heartbeat but never marks stream verified',async t=>{
 const srv=await localServer();t.after(()=>srv.stop());
 const heartbeat=await call(srv,'/internal/heartbeat',{method:'POST',body:{...valid,streamVerified:true}});
 assert.equal(heartbeat.status,202);
 const status=await (await call(srv,'/internal/status')).json();
 assert.equal(status.connected,true);
 assert.equal(status.hosts[0].infrastructureReady,true);
 assert.equal(status.streamVerified,false);
 assert.equal(status.hosts[0].streamVerified,undefined);
});
test('stale heartbeats expire and no stale host is reported',async t=>{
 let now=100000;const srv=await localServer({clock:()=>now,ttlMs:2000});t.after(()=>srv.stop());
 await call(srv,'/internal/heartbeat',{method:'POST',body:valid});
 now+=2001;
 assert.deepEqual((await (await call(srv,'/internal/status')).json()).hosts,[]);
});
test('missing game, GPU or Sunshine yields incomplete infrastructure',async t=>{
 const srv=await localServer();t.after(()=>srv.stop());
 await call(srv,'/internal/heartbeat',{method:'POST',body:{...valid,gameFilePresent:false}});
 assert.equal((await (await call(srv,'/internal/status')).json()).hosts[0].infrastructureReady,false);
});
test('Next status client strips host identifiers and model',async t=>{
 const srv=await localServer();t.after(()=>srv.stop());
 await call(srv,'/internal/heartbeat',{method:'POST',body:valid});
 const status=await readLabStatus({endpoint:srv.url,token:TOKEN});
 assert.equal(status.connected,true);
 assert.equal(status.hosts[0].gpuDetected,true);
 assert.equal(JSON.stringify(status).includes('win-test-gpu'),false);
 assert.equal(JSON.stringify(status).includes('NVIDIA test stub'),false);
 assert.equal(status.streamVerified,false);
});
test('status client fails closed for missing coordinator',async()=>{
 const data=await readLabStatus({endpoint:undefined,token:undefined});
 assert.equal(data.connected,false);
 assert.equal(data.streamVerified,false);
});
test('host agent only accepts 127.0.0.1 lab coordinator',()=>{
 for (const uri of ['http://evil.test:7788','https://127.0.0.1:7788','http://127.0.0.1:7788/other','http://127.0.0.1:7788/?x=1','http://localhost:7788']) assert.throws(()=>validateLabEndpoint(uri));
 assert.equal(validateLabEndpoint('http://127.0.0.1:7788').hostname,'127.0.0.1');
});
test('agent local diagnostic handles missing nvidia-smi without crashing',async()=>{
 assert.deepEqual(getGpu({run:()=>{throw Error('not installed')}}),{detected:false,model:null});
 const beat=await getHostHeartbeat({hostId:'test-host',gamePath:'/does-not-exist',gpu:{detected:false,model:null},portProbe:async()=>false});
 assert.equal(beat.gameFilePresent,false);assert.equal(beat.sunshinePortOpen,false);assert.equal(beat.webStreamPortOpen,false);
});
test('malformed heartbeat fails with stable error',async t=>{
 const srv=await localServer();t.after(()=>srv.stop());
 assert.equal((await call(srv,'/internal/heartbeat',{method:'POST',body:{hostId:'bad'}})).status,422);
});
test('standalone P0 monitor is served but state remains authenticated',async t=>{
 const srv=await localServer();t.after(()=>srv.stop());
 const r=await fetch(srv.url+'/monitor');
 assert.equal(r.status,200);assert.match(await r.text(),/本地主机与串流检查/);
 assert.equal((await fetch(srv.url+'/internal/status')).status,401);
});
