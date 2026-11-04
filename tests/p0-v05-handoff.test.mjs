import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createCoordinator} from '../lib/lab/coordinator.mjs';
import {readLabHandoff} from '../lib/lab/status-client.mjs';
import {isP0UiEnabled} from '../lib/lab/ui-access.mjs';
import {GET as handoffRoute} from '../app/api/v1/p0/sessions/[sessionId]/handoff/route.js';
import {GET as openRoute} from '../app/api/v1/p0/sessions/[sessionId]/open/route.js';
import {GET as statusRoute} from '../app/api/v1/p0/status/route.js';
import {createGameRunner} from '../lib/lab/game-runner.mjs';

const token='v05-lab-token-for-tests-12345678901234567890';
const hostId='v05-lab-host';
const heartbeat={hostId,gpu:{detected:true,model:'Test GPU'},sunshinePortOpen:true,webStreamPortOpen:true,gameFilePresent:true};

const envKeys=['NODE_ENV','CLOUDPLAY_P0_UI_ENABLED','CLOUDPLAY_LAB_ENDPOINT','CLOUDPLAY_LAB_TOKEN'];
function setEnv(t,changes){
 const original=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
 for(const [k,v] of Object.entries(changes)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 t.after(()=>{for(const [k,v] of Object.entries(original)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
}
async function lab(t){
 const control=createCoordinator({token,launchEnabled:true});
 await new Promise(resolve=>control.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>control.server.close(resolve)));
 const endpoint=`http://127.0.0.1:${control.server.address().port}`;
 const request=async(path,method='GET',data)=>{
  const r=await fetch(endpoint+path,{method,headers:{Authorization:`Bearer ${token}`,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  return {status:r.status,result:await r.json()};
 };
 return {endpoint,request};
}
test('P0 UI is opt-in and never enabled in production',()=>{
 assert.equal(isP0UiEnabled({nodeEnv:'production',flag:'1'}),false);
 assert.equal(isP0UiEnabled({nodeEnv:'development',flag:'0'}),false);
 assert.equal(isP0UiEnabled({nodeEnv:'development',flag:'1'}),true);
 assert.equal(isP0UiEnabled({nodeEnv:'test',flag:'1'}),true);
});
test('P1 endpoints hide all session details when lab is not explicitly enabled',async t=>{
 setEnv(t,{NODE_ENV:'test',CLOUDPLAY_P0_UI_ENABLED:undefined});
 for(const route of [statusRoute,()=>handoffRoute({}, {params:Promise.resolve({sessionId:'invalid'})}),
  ()=>openRoute({}, {params:Promise.resolve({sessionId:'invalid'})})]){
  const r=await route();assert.equal(r.status,404);assert.equal((await r.json()).code,'P0_LOCAL_LAB_DISABLED');
 }
});
test('P1 handoff redirects only after active authorized local session',async t=>{
 const s=await lab(t);
 setEnv(t,{NODE_ENV:'test',CLOUDPLAY_P0_UI_ENABLED:'1',CLOUDPLAY_LAB_ENDPOINT:s.endpoint,CLOUDPLAY_LAB_TOKEN:token});
 const hb=await s.request('/internal/heartbeat','POST',heartbeat);assert.equal(hb.status,202);
 const start=await s.request('/internal/lab/sessions','POST',{gameId:'supertuxkart',hostId});
 assert.equal(start.status,202);
 const id=start.result.session.id;
 const params={params:Promise.resolve({sessionId:id})};
 const before=await openRoute({},params);assert.equal(before.status,409);
 assert.equal((await before.json()).code,'GAME_NOT_CONNECTABLE');
 const commands=await s.request('/internal/commands?hostId='+hostId);
 const command=commands.result.commands[0];
 const ack=await s.request('/internal/command-results','POST',{...command,hostId,outcome:'launched'});
 assert.equal(ack.result.session.state,'connecting');
 const h=await handoffRoute({},params);
 assert.equal(h.status,200);const hbody=await h.json();
 assert.equal(hbody.url,'http://127.0.0.1:8080/');assert.equal(hbody.streamVerified,false);
 assert.equal(JSON.stringify(hbody).includes(token),false);
 const opened=await openRoute({},params);
 assert.equal(opened.status,302);assert.equal(opened.headers.get('location'),'http://127.0.0.1:8080/');
 assert.equal(opened.headers.get('cache-control'),'no-store');
 const stop=await s.request(`/internal/lab/sessions/${id}`,'DELETE');assert.equal(stop.result.session.state,'stopping');
 assert.equal((await openRoute({},params)).status,409);
});
test('P1 rejects malicious coordinator URLs and mismatched session IDs',async()=>{
 const id='11111111-2222-4333-8444-555555555555';
 const base={sessionId:id,gameId:'supertuxkart',provider:'moonlight-web-stream',sessionState:'connecting',streamVerified:false,url:'http://127.0.0.1:8080/'};
 const mock=(body)=>async()=>({ok:true,json:async()=>body});
 const options={endpoint:'http://127.0.0.1:7788',token,fetcher:mock({...base,url:'http://attacker.example:8080/'})};
 assert.equal((await readLabHandoff(id,options)).code,'INVALID_LAB_HANDOFF_URL');
 assert.equal((await readLabHandoff(id,{...options,fetcher:mock({...base,sessionId:'99999999-2222-4333-8444-555555555555'})})).code,'INVALID_LAB_HANDOFF');
 assert.equal((await readLabHandoff(id,{...options,fetcher:mock({...base,url:'http://127.0.0.1:8080/admin'})})).code,'INVALID_LAB_HANDOFF_URL');
 assert.equal((await readLabHandoff('bad',options)).code,'INVALID_SESSION_ID');
});
function mockChild(){
 const child=new EventEmitter();child.pid=54321;child.exitCode=null;child.signalCode=null;
 return child;
}
test('Windows game runner requests graceful close without /F before stopping',async()=>{
 const child=mockChild(),seen=[];
 const spawn=()=>{queueMicrotask(()=>child.emit('spawn'));return child};
 const execFile=(cmd,args,_opts,callback)=>{
  seen.push(args);
  queueMicrotask(()=>{child.exitCode=0;child.emit('exit',0,null);callback(null)});
 };
 // Linux test environment's path.isAbsolute() is POSIX; simulate win32 with an
 // actual POSIX path ending in the canonical allowlisted Windows executable.
 const winRunner=createGameRunner({gamePath:'/tmp/supertuxkart.exe',exists:()=>true,platform:'win32',spawn,execFile});
 const id='11111111-2222-4333-8444-555555555555';
 await winRunner.launch(id,'supertuxkart');
 const result=await winRunner.stop(id);
 assert.equal(result.forced,false);assert.deepEqual(seen[0],['/PID','54321','/T']);
});
test('Windows game runner force fallback runs only after bounded grace period',async()=>{
 const child=mockChild(),seen=[];
 const spawn=()=>{queueMicrotask(()=>child.emit('spawn'));return child};
 const execFile=(_cmd,args,_opts,callback)=>{
  seen.push(args);
  queueMicrotask(()=>{if(args.includes('/F')){child.exitCode=0;child.emit('exit',0,null);}callback(null);});
 };
 const runner=createGameRunner({gamePath:'/tmp/supertuxkart.exe',exists:()=>true,platform:'win32',spawn,execFile,graceTimeoutMs:10,forceTimeoutMs:100});
 const id='11111111-2222-4333-8444-555555555555';
 await runner.launch(id,'supertuxkart');
 const result=await runner.stop(id);
 assert.equal(result.forced,true);assert.deepEqual(seen.map(a=>a.includes('/F')),[false,true]);
});
