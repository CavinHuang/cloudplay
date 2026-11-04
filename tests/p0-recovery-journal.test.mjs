import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCoordinator} from '../lib/lab/coordinator.mjs';
import {createSessionJournal} from '../lib/lab/session-journal.mjs';

const token='journal-test-secret-with-more-than-32-chars';
const hostId='windows-gpu-test';
const heartbeat={hostId,gpu:{detected:true,model:'GPU'},sunshinePortOpen:true,webStreamPortOpen:true,gameFilePresent:true};
const makeDir=t=>{const dir=mkdtempSync(join(tmpdir(),'cloudplay-journal-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir};
async function start(t,path,clock=()=>Date.now()) {
 const c=createCoordinator({token,launchEnabled:true,journalPath:path,clock,ttlMs:2000,reconnectGraceMs:9000});
 await new Promise(done=>c.server.listen(0,'127.0.0.1',done));
 const base=`http://127.0.0.1:${c.server.address().port}`;
 const call=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()}};
 return {c,call,close:()=>new Promise(done=>c.server.close(done))};
}
const beat=(x,activeGame)=>x.call('/internal/heartbeat','POST',{...heartbeat,activeGame});
const create=x=>x.call('/internal/lab/sessions','POST',{hostId,gameId:'supertuxkart'});
const commands=x=>x.call(`/internal/commands?hostId=${hostId}`);
const report=(x,command,outcome)=>x.call('/internal/command-results','POST',{...command,hostId,outcome});

test('coordinator restart preserves session identity and verifies host ownership before reconnect',async t=>{
 const path=join(makeDir(t),'sessions.json');let now=Date.now();const clock=()=>now;
 const first=await start(t,path,clock);
 await beat(first);
 const made=await create(first);const sid=made.body.session.id;
 const command=(await commands(first)).body.commands[0];await report(first,command,'launched');
 await beat(first,{sessionId:sid,state:'running'});
 await first.close();
 const second=await start(t,path,clock);
 const restored=(await second.call(`/internal/lab/sessions/${sid}`)).body.session;
 assert.equal(restored.id,sid);assert.equal(restored.state,'reconnecting');assert.equal(restored.reason,'COORDINATOR_RESTART_AWAITING_HOST');
 assert.equal((await commands(second)).body.commands.length,0);
 await beat(second,{sessionId:sid,state:'running'});
 assert.equal((await second.call(`/internal/lab/sessions/${sid}`)).body.session.state,'connecting');
 const stopped=await second.call(`/internal/lab/sessions/${sid}`,'DELETE');assert.equal(stopped.body.session.state,'stopping');
 const stop=(await commands(second)).body.commands[0];assert.equal(stop.kind,'stop');
 assert.equal((await report(second,stop,'stopped')).body.session.state,'finished');
 await second.close();
 const third=await start(t,path,clock);
 assert.equal((await third.call(`/internal/lab/sessions/${sid}`)).body.session.state,'finished');
 await third.close();
});

test('delivered launch report lost across restart is recovered from Agent heartbeat without duplicate launch',async t=>{
 const path=join(makeDir(t),'sessions.json');const first=await start(t,path);await beat(first);
 const sid=(await create(first)).body.session.id;
 const delivered=(await commands(first)).body.commands[0];assert.equal(delivered.kind,'launch');
 await first.close();
 const second=await start(t,path);
 await beat(second,{sessionId:sid,state:'running'});
 assert.equal((await second.call(`/internal/lab/sessions/${sid}`)).body.session.state,'connecting');
 assert.equal((await commands(second)).body.commands.length,0);
 await second.close();
});

test('restored reconnect state expires when no host heartbeat is received',async t=>{
 const path=join(makeDir(t),'sessions.json');let now=Date.now(),clock=()=>now;
 const first=await start(t,path,clock);await beat(first);
 const sid=(await create(first)).body.session.id;
 const launch=(await commands(first)).body.commands[0];await report(first,launch,'launched');await first.close();
 const second=await start(t,path,clock);
 assert.equal((await second.call(`/internal/lab/sessions/${sid}`)).body.session.state,'reconnecting');
 now+=9001;
 const expired=(await second.call(`/internal/lab/sessions/${sid}`)).body.session;
 assert.equal(expired.state,'failed');assert.equal(expired.reason,'HOST_RECONNECT_TIMEOUT');
 await second.close();
});

test('journal file is strict JSON, atomically saved and excludes tokens',t=>{
 const path=join(makeDir(t),'journal.json');const journal=createSessionJournal(path);
 assert.equal(journal.load(),null);
 journal.save({schema:1,sessions:[],commands:[]});
 const file=readFileSync(path,'utf8');assert.equal(file.includes(token),false);
 assert.equal(journal.load().schema,1);
 if(process.platform!=='win32')assert.equal(statSync(path).mode&0o077,0);
 writeFileSync(path,'broken-json');assert.throws(()=>journal.load(),/CORRUPT/);
 assert.throws(()=>createSessionJournal('relative.json'),/absolute/);
});

test('corrupt or forged restart journal refuses coordinator startup',t=>{
 const path=join(makeDir(t),'bad.json');
 writeFileSync(path,JSON.stringify({schema:1,sessions:[{id:'not-a-real-session'}],commands:[]}));
 assert.throws(()=>createCoordinator({token,journalPath:path}),/INVALID_SESSION_JOURNAL/);
});

test('lost stop acknowledgement after restart reconciles from owned exited process',async t=>{
 const path=join(makeDir(t),'sessions.json');const first=await start(t,path);await beat(first);
 const sid=(await create(first)).body.session.id;
 const launch=(await commands(first)).body.commands[0];await report(first,launch,'launched');
 await beat(first,{sessionId:sid,state:'running'});
 await first.call(`/internal/lab/sessions/${sid}`,'DELETE');
 const stop=(await commands(first)).body.commands[0];assert.equal(stop.kind,'stop');
 await first.close();
 const second=await start(t,path);
 await beat(second,{sessionId:sid,state:'exited'});
 const state=(await second.call(`/internal/lab/sessions/${sid}`)).body.session;
 assert.equal(state.state,'finished');assert.equal(state.reason,'HOST_CONFIRMED_GAME_EXIT_AFTER_RECOVERY');
 assert.equal((await commands(second)).body.commands.length,0);
 await second.close();
});

test('real local OS process survives coordinator restart and is stopped under same recovered session', {skip:process.platform==='win32'},async t=>{
 const {chmodSync}=await import('node:fs');
 const {createGameRunner}=await import('../lib/lab/game-runner.mjs');
 const dir=makeDir(t),path=join(dir,'sessions.json'),executable=join(dir,'test-game.sh');
 writeFileSync(executable,'#!/bin/sh\nexec sleep 30\n');chmodSync(executable,0o700);
 const runner=createGameRunner({gamePath:executable});
 t.after(async()=>{const running=runner.snapshot();if(running?.state==='running')await runner.stop(running.sessionId)});
 const first=await start(t,path);await beat(first);
 const sid=(await create(first)).body.session.id;
 const launch=(await commands(first)).body.commands[0];
 const proc=await runner.launch(launch.sessionId,launch.gameId);assert.ok(proc.pid>0);
 await report(first,launch,'launched');await beat(first,runner.snapshot());
 await first.close();
 const second=await start(t,path);
 assert.equal((await second.call(`/internal/lab/sessions/${sid}`)).body.session.state,'reconnecting');
 await beat(second,runner.snapshot());
 assert.equal((await second.call(`/internal/lab/sessions/${sid}`)).body.session.state,'connecting');
 await second.call(`/internal/lab/sessions/${sid}`,'DELETE');
 const stop=(await commands(second)).body.commands[0];assert.equal(stop.kind,'stop');
 await runner.stop(stop.sessionId);await report(second,stop,'stopped');
 assert.equal(runner.snapshot().state,'exited');
 assert.equal((await second.call(`/internal/lab/sessions/${sid}`)).body.session.state,'finished');
 await second.close();
});
