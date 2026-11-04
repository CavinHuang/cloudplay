import test from 'node:test';
import assert from 'node:assert/strict';
import {collectBrowserCapabilities,makeBrowserCapabilityReport} from '../lib/lab/browser-capabilities.mjs';

test('browser capability collection handles unavailable APIs, no synthetic media proof',()=>{
 const data=collectBrowserCapabilities();
 assert.equal(data.webRTC,false);assert.equal(data.connectedGamepads,0);assert.equal(data.mediaVerified,false);
 assert.deepEqual(data.videoCodecs,[]);
});
test('browser detects supported codecs and physical gamepad activity without exporting identifiers',()=>{
 const context={window:{isSecureContext:true},document:{documentElement:{requestFullscreen(){}},body:{requestPointerLock(){}}},
   navigator:{getGamepads:()=>[{id:'secret-device-id',buttons:[{pressed:true},{pressed:false}],axes:[0.5,0,0.11]}],keyboard:{lock(){}}},
   RTCPeerConnection:class{},VideoDecoder:class{},RTCRtpReceiver:{getCapabilities:()=>({codecs:[{mimeType:'video/H264'},{mimeType:'video/H264'},{mimeType:'video/VP9'},{mimeType:'audio/OPUS'}]})}};
 const result=collectBrowserCapabilities(context);
 assert.deepEqual(result.videoCodecs,['video/h264','video/vp9']);
 assert.equal(result.connectedGamepads,1);assert.equal(result.buttonsPressed,1);assert.equal(result.axesActive,1);
 const report=makeBrowserCapabilityReport(result,{sessionId:'123',time:'2026-11-04T00:00:00Z'});
 assert.equal(report.mediaVerified,false);
 assert.equal(report.sessionId,'123');assert.equal(report.capabilities.gamepadAPI,true);
 assert.equal(JSON.stringify(report).includes('secret-device-id'),false);
});
test('unsupported or buggy browser getCapabilities / Gamepad API fails safe',()=>{
 const result=collectBrowserCapabilities({navigator:{getGamepads:()=>{throw Error('denied')}},RTCRtpReceiver:{getCapabilities:()=>{throw Error('not supported')}}});
 assert.equal(result.gamepadAPI,true);assert.deepEqual(result.videoCodecs,[]);assert.equal(result.connectedGamepads,0);
});
