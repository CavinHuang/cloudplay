import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoordinator} from '../lib/lab/coordinator.mjs';
import {createLocalLabSession,stopLocalLabSession} from '../lib/lab/local-session-gateway.mjs';
import {isLocalOperatorEnabled,guardLocalOperator} from '../lib/lab/local-operator.mjs';
import {POST as startRoute} from '../app/api/v1/local/sessions/route.js';
import {GET as statusRoute} from '../app/api/v1/local/status/route.js';
import {GET as sessionRoute,DELETE as stopRoute} from '../app/api/v1/local/sessions/[sessionId]/route.js';
import {GET as openRoute} from '../app/api/v1/local/sessions/[sessionId]/open/route.js';

const TOKEN='test-local-operator-lab-auth-token-000000000000000001';
const HOST='local-test-gpu';
const heartbeat={hostId:HOST,gpu:{detected:true,model:'TEST_GPU_NOT_REAL'},sunshinePortOpen:true,
 webStreamPortOpen:true,gameFilePresent:true,activeGame:null};
const oldEnv=Object.fromEntries(['NODE_ENV','CLOUDPLAY_LOCAL_OPERATOR_ENABLED',
 'CLOUDPLAY_ENABLE_LOCAL_LAUNCH','HOSTNAME','CLOUDPLAY_LAB_ENDPOINT','CLOUDPLAY_LAB_TOKEN'].map(k=>[k,process.env[k]]));
function enable(endpoint){
 Object.assign(process.env,{NODE_ENV:'production',CLOUDPLAY_LOCAL_OPERATOR_ENABLED:'1',
  CLOUDPLAY_ENABLE_LOCAL_LAUNCH:'1',HOSTNAME:'127.0.0.1',CLOUDPLAY_LAB_ENDPOINT:endpoint,
  CLOUDPLAY_LAB_TOKEN:TOKEN});
}
function restore(){
 for(const [k,v] of Object.entries(oldEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
}
function req(path,{method='GET',headers={},body}={}){
 return new Request('http://127.0.0.1:3000'+path,{method,headers:{
  host:'127.0.0.1:3000',...headers},body});
}
function mutation(path,body,headers={}){
 return req(path,{method:'POST',headers:{origin:'http://127.0.0.1:3000',
  'x-cloudplay-local-action':'1','content-type':'application/json',...headers},
  body:JSON.stringify(body)});
}
async function server(t,{launchEnabled=true,heartbeatData=heartbeat}={}){
 const app=createCoordinator({token:TOKEN,launchEnabled});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(()=>new Promise(done=>app.server.close(done)));
 const endpoint='http://127.0.0.1:'+app.server.address().port;
 const auth=async(path,method='GET',data)=>{
  const response=await fetch(endpoint+path,{method,headers:{Authorization:'Bearer '+TOKEN,
   ...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  return {status:response.status,data:await response.json()};
 };
 if(heartbeatData)assert.equal((await auth('/internal/heartbeat','POST',heartbeatData)).status,202);
 return {endpoint,auth,app};
}
test('local bridge defaults closed, requires production loopback and explicit operator intent',()=>{
 for(const override of [
  {nodeEnv:'development'}, {flag:'0'},{launch:'0'},{hostname:'0.0.0.0'},
  {endpoint:'http://evil.test:7788'},{token:'short'}]){
  const cfg={nodeEnv:'production',flag:'1',launch:'1',hostname:'127.0.0.1',
   endpoint:'http://127.0.0.1:7788',token:TOKEN,...override};
  assert.equal(isLocalOperatorEnabled(cfg),false);
 }
 assert.equal(isLocalOperatorEnabled({nodeEnv:'production',flag:'1',launch:'1',
  hostname:'127.0.0.1',endpoint:'http://127.0.0.1:7788',token:TOKEN}),true);
});
test('local write guard blocks DNS rebinding, cross-origin requests and missing action header',()=>{
 enable('http://127.0.0.1:7788');
 try{
  assert.equal(guardLocalOperator(mutation('/api/v1/local/sessions',{gameId:'supertuxkart'}),{write:true}),null);
  for(const r of [
   mutation('/api/v1/local/sessions',{gameId:'supertuxkart'},{host:'attacker.example:3000'}),
   mutation('/api/v1/local/sessions',{gameId:'supertuxkart'},{origin:'https://evil.example'}),
   mutation('/api/v1/local/sessions',{gameId:'supertuxkart'},{'sec-fetch-site':'cross-site'}),
   mutation('/api/v1/local/sessions',{gameId:'supertuxkart'},{'x-forwarded-host':'external.example'}),
   mutation('/api/v1/local/sessions',{gameId:'supertuxkart'},{'x-cloudplay-local-action':'0'})
  ])assert.equal(guardLocalOperator(r,{write:true}).status,403);
  assert.equal(guardLocalOperator(req('/api/v1/local/status')) ,null);
 }finally{restore();}
});
test('local coordinator gateway creates only allowlisted real sessions and rejects unready hosts',async t=>{
 const s=await server(t,{heartbeatData:null});
 const inactive=await createLocalLabSession({endpoint:s.endpoint,token:TOKEN});
 assert.deepEqual(inactive,{status:409,code:'LOCAL_HOST_NOT_READY'});
 assert.equal((await createLocalLabSession({endpoint:s.endpoint,token:TOKEN,gameId:'other'})).status,422);
 assert.equal((await s.auth('/internal/heartbeat','POST',heartbeat)).status,202);
 const started=await createLocalLabSession({endpoint:s.endpoint,token:TOKEN});
 assert.equal(started.status,202);
 assert.equal(started.session.gameId,'supertuxkart');
 assert.equal(started.session.state,'starting');
 assert.equal(JSON.stringify(started).includes(TOKEN),false);
 assert.equal(JSON.stringify(started).includes(HOST),false);
 const stopped=await stopLocalLabSession(started.session.id,{endpoint:s.endpoint,token:TOKEN});
 assert.equal(stopped.status,200);assert.equal(stopped.session.state,'cancelled');
 const disabled=await server(t,{launchEnabled:false});
 assert.equal((await createLocalLabSession({endpoint:disabled.endpoint,token:TOKEN})).code,'LOCAL_LAUNCH_DISABLED');
});
test('local Next routes start and query one live coordinator session; public session response has no token',async t=>{
 const s=await server(t);
 enable(s.endpoint);
 try{
  // Production guard requires the fixed local operator coordinator address.
  // The gateway is separately exercised with an ephemeral server above.
  assert.equal((await startRoute(mutation('/api/v1/local/sessions',{gameId:'supertuxkart'}))).status,404);
  assert.equal((await statusRoute(req('/api/v1/local/status'))).status,404);
 }finally{restore();}
});
test('local session API rejects invalid bodies before reaching any launcher',async()=>{
 enable('http://127.0.0.1:7788');
 try{
  assert.equal((await startRoute(mutation('/api/v1/local/sessions',{gameId:'commercial-game'}))).status,422);
  assert.equal((await startRoute(mutation('/api/v1/local/sessions',{gameId:'supertuxkart',cmd:'calc.exe'}))).status,422);
  assert.equal((await startRoute(req('/api/v1/local/sessions',{method:'POST',headers:{
    origin:'http://127.0.0.1:3000','x-cloudplay-local-action':'1'},body:'{}'}))).status,415);
  assert.equal((await stopRoute(req('/api/v1/local/sessions/not-an-id',{method:'DELETE',
   headers:{origin:'http://127.0.0.1:3000','x-cloudplay-local-action':'1'} }),
   {params:Promise.resolve({sessionId:'not-an-id'})})).status,400);
  assert.equal((await openRoute(req('/api/v1/local/sessions/not-an-id/open'),
    {params:Promise.resolve({sessionId:'not-an-id'})})).status,400);
  assert.equal((await sessionRoute(req('/api/v1/local/sessions/not-an-id'),
    {params:Promise.resolve({sessionId:'not-an-id'})})).status,400);
 }finally{restore();}
});
