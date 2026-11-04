import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createCoordinator} from '../lib/lab/coordinator.mjs';
import {createGameRunner} from '../lib/lab/game-runner.mjs';
import {createSessionControl} from '../lib/lab/session-control.mjs';

const TOKEN='local-tests-token-12345678901234567890';
const heartbeat={hostId:'gpu-win-1',gpu:{detected:true,model:'NVIDIA mock'},sunshinePortOpen:true,webStreamPortOpen:true,gameFilePresent:true};
async function server(opts={}){
 const c=createCoordinator({token:TOKEN,launchEnabled:true,...opts});
 await new Promise(r=>c.server.listen(0,'127.0.0.1',r));
 return {...c,base:`http://127.0.0.1:${c.server.address().port}`,close:()=>new Promise(r=>c.server.close(r))};
}
async function call(s,path,{method='GET',body,token=TOKEN}={}){
 const r=await fetch(s.base+path,{method,headers:{Authorization:'Bearer '+token,...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,body:await r.json()};
}
async function beat(s,activeGame){return call(s,'/internal/heartbeat',{method:'POST',body:{...heartbeat,activeGame}})}
async function start(s){return call(s,'/internal/lab/sessions',{method:'POST',body:{gameId:'supertuxkart',hostId:heartbeat.hostId}})}
async function commands(s){return call(s,'/internal/commands?hostId='+heartbeat.hostId)}
async function report(s,cmd,outcome){return call(s,'/internal/command-results',{method:'POST',body:{...cmd,hostId:heartbeat.hostId,outcome}})}

test('session launch is opt-in and restricted to one local game',async t=>{
 const off=await server({launchEnabled:false});t.after(()=>off.close());
 await beat(off);
 assert.equal((await start(off)).body.code,'LOCAL_LAUNCH_DISABLED');
 assert.equal((await call(off,'/internal/lab/sessions',{method:'POST',body:{gameId:'fortnite',hostId:heartbeat.hostId}})).status,403);
 const on=await server();t.after(()=>on.close());await beat(on);
 assert.equal((await call(on,'/internal/lab/sessions',{method:'POST',body:{gameId:'fortnite',hostId:heartbeat.hostId}})).body.code,'GAME_NOT_ALLOWLISTED');
 assert.equal((await call(on,'/internal/lab/sessions',{method:'POST',body:{gameId:'supertuxkart',hostId:'offline-host'}})).body.code,'HOST_OFFLINE');
});
test('authenticated command handoff starts process state but does NOT mark media verified',async t=>{
 const s=await server();t.after(()=>s.close());await beat(s);
 const created=await start(s);assert.equal(created.status,202);assert.equal(created.body.session.state,'starting');
 const conflict=await start(s);assert.equal(conflict.status,409);
 const polled=await commands(s);assert.equal(polled.body.commands.length,1);const command=polled.body.commands[0];
 assert.deepEqual({kind:command.kind,gameId:command.gameId},{kind:'launch',gameId:'supertuxkart'});
 assert.equal((await report(s,command,'launched')).body.session.state,'connecting');
 assert.equal((await report(s,command,'launched')).body.duplicate,true);
 await beat(s,{sessionId:created.body.session.id,state:'running'});
 const status=(await call(s,'/internal/status')).body;
 assert.equal(status.streamVerified,false);assert.equal(status.sessions[0].playbackVerified,false);
 assert.equal(status.hosts[0].activeGame.state,'running');
 const stop=await call(s,`/internal/lab/sessions/${created.body.session.id}`,{method:'DELETE'});
 assert.equal(stop.body.session.state,'stopping');
 const stopCmd=(await commands(s)).body.commands[0];assert.equal(stopCmd.kind,'stop');
 assert.equal((await report(s,stopCmd,'stopped')).body.session.state,'finished');
 assert.equal((await start(s)).body.code,'HOST_PROCESS_BUSY'); // still reported as running until next heartbeat
 await beat(s,{sessionId:created.body.session.id,state:'exited'});
 assert.equal((await start(s)).status,202);
});
test('pending launch can be cancelled without ever reaching an agent',async t=>{
 const s=await server();t.after(()=>s.close());await beat(s);
 const x=await start(s);const stopped=await call(s,`/internal/lab/sessions/${x.body.session.id}`,{method:'DELETE'});
 assert.equal(stopped.body.session.state,'cancelled');assert.equal((await commands(s)).body.commands.length,0);
});
test('stale heartbeat triggers reconnecting then bounded failure, never false streaming',async t=>{
 let now=Date.now();const s=await server({clock:()=>now,ttlMs:2000,reconnectGraceMs:3000});t.after(()=>s.close());
 await beat(s);const x=await start(s);const cmd=(await commands(s)).body.commands[0];await report(s,cmd,'launched');
 now+=2001;
 assert.equal((await call(s,`/internal/lab/sessions/${x.body.session.id}`)).body.session.state,'reconnecting');
 now+=3001;
 const result=(await call(s,`/internal/lab/sessions/${x.body.session.id}`)).body.session;
 assert.equal(result.state,'failed');assert.equal(result.reason,'HOST_RECONNECT_TIMEOUT');assert.equal(result.playbackVerified,false);
});
test('host heartbeat recovery restores connecting but never streaming',async t=>{
 let now=Date.now();const s=await server({clock:()=>now,ttlMs:2000,reconnectGraceMs:9000});t.after(()=>s.close());
 await beat(s);const x=await start(s);const cmd=(await commands(s)).body.commands[0];await report(s,cmd,'launched');
 now+=2001;assert.equal((await call(s,'/internal/status')).body.sessions[0].state,'reconnecting');
 await beat(s,{sessionId:x.body.session.id,state:'running'});
 assert.equal((await call(s,'/internal/status')).body.sessions[0].state,'connecting');
});
test('command reports require authentication, correct ownership and allowed outcomes',async t=>{
 const s=await server();t.after(()=>s.close());await beat(s);const x=await start(s);const c=(await commands(s)).body.commands[0];
 assert.equal((await call(s,'/internal/command-results',{method:'POST',token:'bad',body:{...c,hostId:heartbeat.hostId,outcome:'launched'}})).status,401);
 assert.equal((await report(s,c,'stopped')).body.code,'INVALID_COMMAND_OUTCOME');
 assert.equal((await call(s,'/internal/command-results',{method:'POST',body:{...c,hostId:'other-host',outcome:'launched'}})).status,404);
 assert.equal((await call(s,`/internal/lab/sessions/${x.body.session.id}`)).body.session.state,'starting');
});
test('fake host with missing GPU or game cannot create session',async t=>{
 const s=await server();t.after(()=>s.close());await call(s,'/internal/heartbeat',{method:'POST',body:{...heartbeat,gpu:{detected:false}}});
 assert.equal((await start(s)).body.code,'HOST_NOT_READY');
});
test('game runner launches exact allowlisted path; idempotent; owns only its process',async()=>{
 const mockPath=process.execPath;let calls=0;
 const spawn=(_cmd,args,options)=>{
  calls++;assert.equal(_cmd,mockPath);assert.deepEqual(args,[]);assert.equal(options.shell,false);
  const child=new EventEmitter();child.pid=5001;child.exitCode=null;child.signalCode=null;
  child.kill=()=>{queueMicrotask(()=>{child.exitCode=0;child.emit('exit',0,null)});return true};
  queueMicrotask(()=>child.emit('spawn'));return child;
 };
 const runner=createGameRunner({gamePath:mockPath,spawn,platform:'linux'});
 const sid='f9a8234e-f80f-4e84-abcd-67ddae002101';
 await assert.rejects(()=>runner.launch(sid,'fortnite'),/ALLOWLISTED/);
 await runner.launch(sid,'supertuxkart');await runner.launch(sid,'supertuxkart');assert.equal(calls,1);
 await assert.rejects(()=>runner.stop('wrong-id'),/OWN_PROCESS/);
 assert.equal((await runner.stop(sid)).stopped,true);assert.equal(runner.snapshot().state,'exited');
});
test('agent runner never executes missing paths or arbitrary shell expressions',async()=>{
 const r=createGameRunner({gamePath:'/unlikely/path/file.exe',exists:()=>false,spawn:()=>{throw Error('MUST_NOT_RUN')}});
 await assert.rejects(()=>r.launch('session','supertuxkart'),/NOT_FOUND/);
});
test('agent restart without owned game fails the old connecting session',async t=>{
 let now=Date.now();const s=await server({clock:()=>now});t.after(()=>s.close());await beat(s);
 const x=await start(s);const c=(await commands(s)).body.commands[0];await report(s,c,'launched');
 now+=6000;await beat(s,null);
 const result=(await call(s,`/internal/lab/sessions/${x.body.session.id}`)).body.session;
 assert.equal(result.state,'failed');assert.equal(result.reason,'HOST_PROCESS_MISSING');
});
test('unreported launch retries same command rather than allocating second process',async t=>{
 let now=Date.now();const s=await server({clock:()=>now});t.after(()=>s.close());await beat(s);await start(s);
 const first=(await commands(s)).body.commands[0];assert.equal((await commands(s)).body.commands.length,0);
 now+=3100;
 const second=(await commands(s)).body.commands[0];assert.equal(second.commandId,first.commandId);
});
test('failed session can recover by stopping a still-running owned game',async t=>{
 let now=Date.now();const s=await server({clock:()=>now,ttlMs:2000,reconnectGraceMs:3000});t.after(()=>s.close());
 await beat(s);const x=await start(s);const c=(await commands(s)).body.commands[0];await report(s,c,'launched');
 now+=2001;await call(s,'/internal/status');now+=3001;await call(s,'/internal/status');
 await beat(s,{sessionId:x.body.session.id,state:'running'});
 const r=await call(s,`/internal/lab/sessions/${x.body.session.id}`,{method:'DELETE'});
 assert.equal(r.status,202);assert.equal(r.body.session.reason,'RECOVERY_STOP_REQUESTED');
 const stop=(await commands(s)).body.commands[0];assert.equal(stop.kind,'stop');
 assert.equal((await report(s,stop,'stopped')).body.session.state,'finished');
});
test('Windows runner refuses local executable that is not named SuperTuxKart',async()=>{
 const runner=createGameRunner({gamePath:'/tmp/not-a-game.exe',exists:()=>true,platform:'win32',spawn:()=>{throw Error('MUST_NOT_EXECUTE')}});
 await assert.rejects(()=>runner.launch('session','supertuxkart'),/UNEXPECTED_GAME_EXECUTABLE/);
});
