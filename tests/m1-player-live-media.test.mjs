import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLocalMediaSession,makeLocalManualEvidence,LOCAL_MOONLIGHT_ORIGIN,MEDIA_PROTOCOL} from '../lib/lab/local-media-session.mjs';
import {assessMediaEvidence} from '../lib/lab/media-evidence.mjs';

const sessionId='12345678-1234-4234-8234-123456789012';
const nonce='a1'.repeat(16);
const iframe={window:'only-this-frame'};
const sample=(frames,audio,state='connected')=>({
 connectionState:state,iceConnectionState:state,
 video:{framesDecoded:frames,bytesReceived:frames*100,framesPerSecond:60},
 audio:{bytesReceived:audio},network:{roundTripTimeMs:24},
 sdp:'secret-should-never-appear',candidate:'192.0.2.88'
});
const event=(type,stats,overrides={})=>({
 source:iframe,origin:LOCAL_MOONLIGHT_ORIGIN,
 data:{type,protocol:MEDIA_PROTOCOL,sessionId,challenge:nonce,...(stats?{stats}:{}),...overrides}
});

test('M1 Next player accepts only same iframe, Moonlight origin and challenge',()=>{
 let now=Date.parse('2026-11-05T04:00:00.000Z');
 const s=createLocalMediaSession({sessionId,source:iframe,nonce,clock:()=>now});
 assert.equal(s.hello().sessionId,sessionId);
 assert.equal(s.observe({...event('hello_ack'),origin:'https://evil.invalid'}),false);
 assert.equal(s.observe({...event('hello_ack'),source:{}}),false);
 assert.equal(s.observe(event('hello_ack',undefined,{challenge:'b'.repeat(32)})),false);
 assert.equal(s.observe(event('stats',sample(1,1))),false);
 assert.equal(s.observe(event('hello_ack')),true);
 for(const [frames,bytes] of [[0,0],[10,500],[20,900],[30,1400]]){
  assert.equal(s.observe(event('stats',sample(frames,bytes))),true);
  now+=1500;
 }
 const report=s.exportMedia();
 assert.equal(report.samples.length,4);
 assert.equal(assessMediaEvidence(report).decodedVideoObserved,true);
 assert.equal(assessMediaEvidence(report).audioBytesIncreasing,true);
 assert.equal(report.assessment.gameImageVerified,false);
 assert.equal(JSON.stringify(report).includes('192.0.2.88'),false);
 assert.equal(JSON.stringify(report).includes('secret-should-never-appear'),false);
});

test('empty and disconnected sessions do not create false evidence',()=>{
 let now=Date.parse('2026-11-05T04:00:00.000Z');
 const s=createLocalMediaSession({sessionId,source:iframe,nonce,clock:()=>now});
 assert.equal(s.exportMedia().assessment.decodedVideoObserved,false);
 s.observe(event('hello_ack'));
 for(let i=0;i<4;i++){s.observe(event('stats',sample(0,0,'disconnected')));now+=1500;}
 const report=s.exportMedia();
 assert.equal(report.assessment.decodedVideoObserved,false);
 assert.equal(report.assessment.audioBytesIncreasing,false);
});

test('manual record is never auto-filled from WebRTC counters',()=>{
 const t=Date.parse('2026-11-05T04:00:00.000Z');
 const record=makeLocalManualEvidence({sessionId,clock:()=>t,checks:{videoObserved:true,token:'SHOULD_NOT_EXPORT'}});
 assert.equal(record.videoObserved,true);
 for(const key of ['audioObserved','keyboardOrControllerObserved','successfulExitObserved','disconnectReconnectObserved'])
  assert.equal(record[key],false);
 assert.equal(record.observedAt,'2026-11-05T04:00:00.000Z');
 assert.equal(JSON.stringify(record).includes('SHOULD_NOT_EXPORT'),false);
 assert.throws(()=>makeLocalManualEvidence({sessionId:'bogus'}));
});

test('Moonlight telemetry parent origin allowlist is exactly the two trusted loopback players',()=>{
 const ts=readFileSync(new URL('../integrations/moonlight-web/cloudplay-p0-telemetry.ts',import.meta.url),'utf8');
 assert.match(ts,/http:\/\/127\.0\.0\.1:7788/);
 assert.match(ts,/http:\/\/127\.0\.0\.1:3000/);
 assert.match(ts,/PARENT_ORIGINS\.has\(event\.origin\)/);
 assert.match(ts,/origin: event\.origin/);
 assert.match(ts,/\}, channel\.origin\)/);
 assert.doesNotMatch(ts,/postMessage\([^\n]+['"]\*['"]\)/);
 assert.equal(LOCAL_MOONLIGHT_ORIGIN,'http://127.0.0.1:8080');
});
