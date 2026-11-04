import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaObserver,sanitizeMediaSample,summarizePeerConnectionStats,MEDIA_PROTOCOL} from '../lib/lab/media-telemetry.mjs';
import {attachMoonlightMediaBridge} from '../lab/moonlight-media-bridge.mjs';
import {createCoordinator} from '../lib/lab/coordinator.mjs';
const sessionId='11111111-2222-4333-8444-555555555555';
const challenge='fedcba9876543210fedcba9876543210';
const origin='http://127.0.0.1:8080';
const frame={name:'expected moonlight iframe'};
const payload=(frames=0,bytes=0,audio=0,cs='connected')=>({connectionState:cs,iceConnectionState:cs==='connected'?'connected':cs,
  video:{framesDecoded:frames,bytesReceived:bytes,framesPerSecond:60,width:1920,height:1080,packetsLost:2},
  audio:{bytesReceived:audio,packetsLost:0},network:{roundTripTimeMs:17.5}});
const message=(type,stats,overrides={})=>({source:frame,origin,data:{protocol:MEDIA_PROTOCOL,sessionId,challenge,type,stats,...overrides}});

test('media observer requires correct iframe source, URL origin, nonce, session ID and explicit hello',()=>{
 let now=100000;
 const observer=createMediaObserver({sessionId,nonce:challenge,origin,source:frame,clock:()=>now});
 assert.equal(observer.observe({...message('hello_ack'),origin:'http://attacker.example'}),false);
 assert.equal(observer.observe({...message('hello_ack'),source:{}}),false);
 assert.equal(observer.observe(message('stats',payload(3))),false);
 assert.equal(observer.observe(message('hello_ack',undefined,{challenge:'0'.repeat(32)})),false);
 assert.equal(observer.snapshot().state,'bridge-not-connected');
 assert.equal(observer.observe(message('hello_ack')),true);
 assert.equal(observer.observe(message('stats',payload(0))),true);
 assert.equal(observer.snapshot().state,'awaiting-video-frames');
 now+=1000;observer.observe(message('stats',payload(3,45000,1000)));
 assert.equal(observer.snapshot().state,'video-frames-received');
 assert.equal(observer.snapshot().framesObservedIncreasing,true);
 assert.equal(observer.snapshot().mediaVerified,false);
 now+=8100;assert.equal(observer.snapshot().state,'video-stalled');
 now+=5000;assert.equal(observer.snapshot().state,'telemetry-stale');
});

test('continuous zero-frame samples diagnose no video, even when telemetry keeps arriving',()=>{
 let now=100000;const o=createMediaObserver({sessionId,nonce:challenge,origin,source:frame,clock:()=>now,stallMs:4000,staleMs:11000});
 o.observe(message('hello_ack'));
 for(let i=0;i<5;i++){o.observe(message('stats',payload(0,0)));now+=1500;}
 assert.equal(o.snapshot().state,'no-decoded-video');
});

test('renegotiation resets video generation; source disconnect and stale do not mean resumed gameplay',()=>{
 let now=100000;const o=createMediaObserver({sessionId,nonce:challenge,origin,source:frame,clock:()=>now,stallMs:2000});
 o.observe(message('hello_ack'));
 o.observe(message('stats',payload(100,20000,1000)));
 now+=500;o.observe(message('stats',payload(130,30000,1500)));
 assert.equal(o.snapshot().state,'video-frames-received');
 now+=500;o.observe(message('stats',payload(0,0,0,'connecting')));
 assert.equal(o.snapshot().state,'awaiting-video-frames');
 assert.equal(o.snapshot().framesObservedIncreasing,false);
 now+=1000;o.observe(message('stats',payload(4,1000,0,'disconnected')));
 assert.equal(o.snapshot().state,'transport-disconnected');
 o.reset();assert.equal(o.snapshot().state,'bridge-not-connected');
});

test('sanitize drops malformed samples and never returns candidate IP, raw browser details or credentials',()=>{
 for(const sample of [null,{},payload(-1,100),payload(1,-2),{...payload(1,200),audio:{bytesReceived:'secret'}}])
   assert.equal(sanitizeMediaSample(sample),null);
 const s=sanitizeMediaSample({...payload(10,18000,300),token:'SECRET',ip:'192.168.1.22',sdp:'secret'});
 assert.equal(s.video.framesDecoded,10);
 assert.equal(s.network.roundTripTimeMs,17.5);
 assert.equal(JSON.stringify(s).includes('SECRET'),false);
 assert.equal(JSON.stringify(s).includes('192.168'),false);
 assert.throws(()=>createMediaObserver({sessionId,nonce:'short',origin,source:frame}));
});

test('getStats summary uses actual inbound RTP and selected candidate pair, does not expose ICE addresses',()=>{
 const pc={connectionState:'connected',iceConnectionState:'connected'};
 const report=new Map([
  ['v',{id:'v',type:'inbound-rtp',kind:'video',framesDecoded:19,bytesReceived:8000,framesPerSecond:55.2,frameWidth:1280,frameHeight:720,packetsLost:3}],
  ['a',{id:'a',type:'inbound-rtp',kind:'audio',bytesReceived:3000,packetsLost:1}],
  ['t',{id:'t',type:'transport',selectedCandidatePairId:'p'}],
  ['p',{id:'p',type:'candidate-pair',state:'succeeded',currentRoundTripTime:0.021,remoteCandidateId:'r'}],
  ['r',{id:'r',type:'remote-candidate',address:'10.0.0.8',port:5555}],
 ]);
 const result=summarizePeerConnectionStats(pc,report);
 assert.equal(result.video.framesDecoded,19);
 assert.equal(result.network.roundTripTimeMs,21);
 assert.equal(result.audio.bytesReceived,3000);
 assert.equal(result.video.framesPerSecond,55.2);
 assert.equal(JSON.stringify(result).includes('10.0.0.8'),false);
});

test('optional client bridge only accepts trusted iframe parent and sends real collected stats',async()=>{
 let handler,timer;const outbound=[];
 const parent={postMessage:(payload,target)=>outbound.push({payload,target})};
 const win={parent,addEventListener:(name,fn)=>{if(name==='message')handler=fn;},removeEventListener:(name,fn)=>{if(handler===fn)handler=null;},
   setInterval:(fn)=>{timer=fn;return 1},clearInterval:()=>{timer=null}};
 const pc={connectionState:'connected',iceConnectionState:'connected',getStats:async()=>new Map([
   ['v',{type:'inbound-rtp',kind:'video',framesDecoded:15,bytesReceived:555}],
   ['a',{type:'inbound-rtp',kind:'audio',bytesReceived:444}],
 ])};
 const bridge=attachMoonlightMediaBridge({window:win,getPeerConnection:()=>pc,expectedParentOrigin:'http://127.0.0.1:7788'});
 const hello={protocol:MEDIA_PROTOCOL,type:'hello',sessionId,challenge};
 handler({source:parent,origin:'http://attacker.example',data:hello});assert.equal(outbound.length,0);
 handler({source:{},origin:'http://127.0.0.1:7788',data:hello});assert.equal(outbound.length,0);
 handler({source:parent,origin:'http://127.0.0.1:7788',data:hello});
 await new Promise(r=>setImmediate(r));
 assert.equal(outbound[0].payload.type,'hello_ack');
 assert.equal(outbound[1].payload.type,'stats');
 assert.equal(outbound[1].payload.stats.video.framesDecoded,15);
 assert.ok(outbound.every(x=>x.target==='http://127.0.0.1:7788'));
 assert.equal(typeof timer,'function');
 bridge.dispose();assert.equal(timer,null);assert.equal(handler,null);
 assert.throws(()=>attachMoonlightMediaBridge({window:win,getPeerConnection:()=>pc,expectedParentOrigin:'https://attacker.example'}));
});

test('local playback serves media observation module with safe CSP and no secret inclusion',async t=>{
 const token='lab-secret-for-telemetry-123456789101112';
 const c=createCoordinator({token});
 await new Promise(resolve=>c.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>c.server.close(resolve)));
 const base=`http://127.0.0.1:${c.server.address().port}`;
 const playback=await fetch(`${base}/play/${sessionId}`);const html=await playback.text();
 assert.equal(playback.status,200);
 assert.match(html,/media-telemetry\.mjs/);
 assert.match(html,/media-state/);
 assert.match(playback.headers.get('content-security-policy'),/script-src 'self'/);
 assert.equal(html.includes(token),false);
 const module=await fetch(`${base}/assets/media-telemetry.mjs`);
 assert.equal(module.status,200);assert.match(await module.text(),/createMediaObserver/);
 const dep=await fetch(`${base}/assets/stream-handoff.mjs`);
 assert.equal(dep.status,200);assert.match(await dep.text(),/isSessionId/);
});
