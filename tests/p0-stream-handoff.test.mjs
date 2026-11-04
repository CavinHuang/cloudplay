import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoordinator} from '../lib/lab/coordinator.mjs';
import {isSessionId,makeStreamHandoff,validateLocalStreamUrl} from '../lib/lab/stream-handoff.mjs';
import {readLabSession} from '../lib/lab/status-client.mjs';
import {GET as labSessionRoute} from '../app/api/v1/p0/sessions/[sessionId]/route.js';
import http from 'node:http';

const token='long-local-only-p0-token-for-testing-123456';
const hostId='test-game-host';
const heartbeat={hostId,gpu:{detected:true,model:'SECRET GPU 4090'},sunshinePortOpen:true,webStreamPortOpen:true,gameFilePresent:true};
const uuid='11111111-2222-4333-8444-555555555555';

async function lab(t,options={}){
 const c=createCoordinator({token,launchEnabled:true,...options});
 await new Promise(r=>c.server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>c.server.close(r)));
 const base=`http://127.0.0.1:${c.server.address().port}`;
 const call=async(path,method='GET',body)=>{
  const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 };
 return {c,base,call};
}

test('P0 web player path is a safe canonical UUID with no token included',async t=>{
 const s=await lab(t);
 assert.equal((await fetch(s.base+'/play/'+uuid)).status,200);
 const html=await (await fetch(s.base+'/play/'+uuid)).text();
 assert.match(html,/Moonlight Web/);assert.match(html,/人工验收/);
 assert.match(html,new RegExp(uuid));assert.equal(html.includes(token),false);
 assert.equal((await fetch(s.base+'/internal/status')).status,401);
 assert.equal((await fetch(s.base+'/play/../../internal/status')).status,401);
});

test('P0 handoff refuses missing session and missing credentials',async t=>{
 const s=await lab(t);
 assert.equal((await s.call(`/internal/lab/sessions/${uuid}/stream-handoff`)).status,404);
 assert.equal((await fetch(s.base+`/internal/lab/sessions/${uuid}/stream-handoff`)).status,401);
});

test('P0 handoff only enabled after launch acknowledged, still unverified media',async t=>{
 const s=await lab(t);
 await s.call('/internal/heartbeat','POST',heartbeat);
 const created=await s.call('/internal/lab/sessions','POST',{gameId:'supertuxkart',hostId});
 assert.equal(created.status,202);const id=created.body.session.id;
 assert.equal((await s.call(`/internal/lab/sessions/${id}/stream-handoff`)).body.code,'GAME_NOT_CONNECTABLE');
 const command=(await s.call('/internal/commands?hostId='+hostId)).body.commands[0];
 await s.call('/internal/command-results','POST',{...command,hostId,outcome:'launched'});
 const handoff=await s.call(`/internal/lab/sessions/${id}/stream-handoff`);
 assert.equal(handoff.status,200);assert.equal(handoff.body.url,'http://127.0.0.1:8080/');
 assert.equal(handoff.body.mode,'external-moonlight-web');assert.equal(handoff.body.streamVerified,false);
 assert.equal(handoff.body.sessionState,'connecting');
 assert.equal('token' in handoff.body,false);
 const privateSession=await readLabSession(id,{endpoint:s.base,token});
 assert.equal(privateSession.status,200);assert.equal(privateSession.session.streamVerified,false);
 assert.equal(JSON.stringify(privateSession).includes('SECRET GPU'),false);
 assert.equal(JSON.stringify(privateSession).includes(hostId),false);
});

test('P0 handoff fails closed after host heartbeat expires',async t=>{
 let now=200000;const s=await lab(t,{clock:()=>now,ttlMs:2000});
 await s.call('/internal/heartbeat','POST',heartbeat);
 const created=await s.call('/internal/lab/sessions','POST',{gameId:'supertuxkart',hostId});
 const id=created.body.session.id;
 const command=(await s.call('/internal/commands?hostId='+hostId)).body.commands[0];
 await s.call('/internal/command-results','POST',{...command,hostId,outcome:'launched'});
 now+=2500;
 const handoff=await s.call(`/internal/lab/sessions/${id}/stream-handoff`);
 assert.equal(handoff.status,409);assert.equal(handoff.body.code,'STREAM_HOST_UNAVAILABLE');
});

test('P0 stream endpoint must be a safe local absolute URL, never arbitrary URL',()=>{
 assert.equal(validateLocalStreamUrl('http://localhost:8080/'),'http://localhost:8080/');
 for(const bad of ['http://example.com:8080/','http://127.0.0.1:8080/admin','http://127.0.0.1:8080/?user=x','http://foo@127.0.0.1:8080/','file:///etc/passwd','javascript:alert(1)','http://127.0.0.1:2/'])assert.throws(()=>validateLocalStreamUrl(bad));
 assert.equal(isSessionId(uuid),true);assert.equal(isSessionId('../bad'),false);
 assert.equal(makeStreamHandoff({session:null}).status,404);
});

test('P1 P0 session endpoint rejects malformed ids without contacting coordinator',async()=>{
 const original=process.env.CLOUDPLAY_P0_UI_ENABLED;process.env.CLOUDPLAY_P0_UI_ENABLED='1';
 try {
 const r=await labSessionRoute(new Request('http://localhost:3000/api/v1/p0/sessions/nope'),{params:Promise.resolve({sessionId:'nope'})});
 assert.equal(r.status,400);assert.equal((await r.json()).code,'INVALID_SESSION_ID');
 } finally {if(original===undefined)delete process.env.CLOUDPLAY_P0_UI_ENABLED;else process.env.CLOUDPLAY_P0_UI_ENABLED=original;}
});

test('P1 status UI references a defined sessions array',async()=>{
 const {readFileSync}=await import('node:fs');
 const ui=readFileSync(new URL('../components/P0StatusPanel.jsx',import.meta.url),'utf8');
 assert.match(ui,/const sessions=status\?\.sessions\|\|\[\]/);
 assert.match(ui,/player\/p0-/);
});

test('P0 localhost service rejects alternate Host and cross-origin browser mutations',async t=>{
 const s=await lab(t);
 const url=new URL(s.base);
 const rebinding=await new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:Number(url.port),path:'/health',headers:{Host:'attacker.example:7799'}},res=>{let text='';res.on('data',v=>text+=v);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}))});req.on('error',reject);req.end();
 });
 assert.equal(rebinding.status,403);assert.equal(rebinding.body.code,'INVALID_LOCAL_HOST');
 const crossOrigin=await fetch(s.base+'/internal/heartbeat',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Origin:'https://attacker.example'},body:JSON.stringify(heartbeat)});
 assert.equal(crossOrigin.status,403);
 assert.equal((await crossOrigin.json()).code,'INVALID_ORIGIN');
 const validOrigin=await fetch(s.base+'/internal/heartbeat',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Origin:s.base},body:JSON.stringify(heartbeat)});
 assert.equal(validOrigin.status,202);
});
