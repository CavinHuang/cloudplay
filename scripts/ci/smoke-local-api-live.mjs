// Actual built Next.js standalone + authenticated P0 Coordinator integration.
// Runs *after* npm run build; no synthetic gameplay or GPU is ever claimed.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {createCoordinator} from '../../lib/lab/coordinator.mjs';

const token='ci-local-api-acceptance-token-1234567890abcdef1234567890abcdef';
const hostId='ci-no-gpu-host';
const origin='http://127.0.0.1:3000';
const launchPath='/api/v1/local/sessions';
const gameBody=JSON.stringify({gameId:'supertuxkart'});
const app=createCoordinator({token,launchEnabled:true});
let child=null;
function sleep(ms){return new Promise(done=>setTimeout(done,ms));}
async function waitUntil(check,label){
 for(let i=0;i<65;i++){
  if(child?.exitCode!==null)throw Error(label+' child exited early');
  try{if(await check())return;}catch{}
  await sleep(180);
 }
 throw Error(label+' not ready');
}
async function ask(path,{method='GET',originHeader,action,body}={}){
 return fetch(origin+path,{method,headers:{
  ...(originHeader?{'Origin':originHeader}:{}),
  ...(action?{'X-CloudPlay-Local-Action':action}:{}),
  ...(body?{'Content-Type':'application/json'}:{})
 },body,signal:AbortSignal.timeout(4500),cache:'no-store'});
}
async function startWeb(flag){
 const cwd=resolve('.next/standalone');
 const env={...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',
  PORT:'3000',CLOUDPLAY_LAB_TOKEN:token,
  CLOUDPLAY_LAB_ENDPOINT:'http://127.0.0.1:7788',
  CLOUDPLAY_ENABLE_LOCAL_LAUNCH:'1',CLOUDPLAY_LOCAL_OPERATOR_ENABLED:flag};
 child=spawn(process.execPath,['server.js'],{cwd,env,stdio:['ignore','pipe','pipe']});
 // Consume outputs without forwarding potentially sensitive runtime details.
 child.stdout.on('data',()=>{});
 child.stderr.on('data',()=>{});
 await waitUntil(async()=>{
  const response=await ask('/api/v1/health');
  return response.ok;
 },'Next production');
}
async function stopWeb(){
 if(!child)return;
 const p=child;child=null;
 if(p.exitCode===null)p.kill('SIGTERM');
 await Promise.race([new Promise(resolve=>p.once('exit',resolve)),sleep(4000)]);
 if(p.exitCode===null)p.kill('SIGKILL');
}
async function run(){
 await new Promise((resolve,reject)=>{
  app.server.once('error',reject);
  app.server.listen(7788,'127.0.0.1',resolve);
 });
 try{
  const hb=await fetch('http://127.0.0.1:7788/internal/heartbeat',{method:'POST',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({hostId,gpu:{detected:false},sunshinePortOpen:false,
    webStreamPortOpen:false,gameFilePresent:false})});
  assert.equal(hb.status,202);
  await startWeb('1');
  const status=await ask('/api/v1/local/status');
  if(status.status!==200){const rejected=await status.json();throw Error('Local status rejected HTTP '+status.status+' ('+(rejected.code||'no-code')+')');}
  const state=await status.json();
  assert.equal(state.localLaunchEnabled,true);
  assert.equal(state.hosts[0].infrastructureReady,false);
  assert.equal(JSON.stringify(state).includes(token),false);
  const post=(originHeader,action,body=gameBody)=>ask(launchPath,{method:'POST',originHeader,action,body});
  assert.equal((await post(undefined,'1')).status,403);
  assert.equal((await post('https://evil.example','1')).status,403);
  assert.equal((await post(origin,undefined)).status,403);
  assert.equal((await post(origin,'1',JSON.stringify({gameId:'other'}))).status,422);
  assert.equal((await post(origin,'1')).status,409);
  assert.equal((await ask('/api/v1/p0/status')).status,404);
  await stopWeb();
  await startWeb('0');
  assert.equal((await ask('/api/v1/local/status')).status,404);
  assert.equal((await post(origin,'1')).status,404);
  console.log('PASS: built Next + local Coordinator: default-off, strict Origin/Host, game allowlist and no-GPU rejection.');
  console.log('NOT CHECKED: actual Sunshine, GPU, playable video/audio or input.');
 }finally{
  await stopWeb();
  await new Promise(resolve=>app.server.close(resolve));
 }
}
run().catch(error=>{console.error('M1 local API contract failed:',error.message);process.exitCode=1;});
