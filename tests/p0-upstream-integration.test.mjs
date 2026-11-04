import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {patchUpstream,installMoonlightBridge,PINNED_UPSTREAM} from '../scripts/p0/integrate-moonlight-web.mjs';

const fixture = `import { Api, fetchApi, WebRTCAnswer } from "../../api"
export class WebRTCTransport implements Transport {
    private peer: RTCPeerConnection
    constructor(configuration: RTCConfiguration) {
        this.peer = new RTCPeerConnection(configuration)
    }
    async close(): Promise<void> {
        this.peer.close()
    }
}
`;

test('pinned upstream WebRTCTransport patch installs at real peer constructor and close lifecycle',()=>{
 const {code,changed}=patchUpstream(fixture);
 assert.equal(changed,true);
 assert.match(code,/import \{ attachCloudPlayP0Telemetry \} from "\.\/cloudplay-p0-telemetry"/);
 assert.match(code,/attachCloudPlayP0Telemetry\(this\.peer\)/);
 assert.match(code,/this\.cloudPlayP0Telemetry\?\.dispose\(\)/);
 assert.equal(patchUpstream(code).changed,false);
 assert.throws(()=>patchUpstream(code.replace('this.cloudPlayP0Telemetry?.dispose()', '')),/PARTIALLY_PATCHED_UPSTREAM_SOURCE/);
 for(const broken of [fixture.replace('new RTCPeerConnection','createRTCPeerConnection'),fixture.replace('async close()', 'async shutdown()')])
   assert.throws(()=>patchUpstream(broken),/UNSUPPORTED_UPSTREAM_SOURCE/);
});

test('refuses unreviewed upstream revision and never changes source',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cloudplay-upstream-'));
 try{
  const rel='web/stream/transport',sub=join(dir,rel);
  mkdirSync(sub,{recursive:true});
  const path=join(sub,'webrtc.ts');writeFileSync(path,fixture);
  execFileSync('git',['init','-q',dir]);
  execFileSync('git',['-C',dir,'config','user.email','test@example.invalid']);
  execFileSync('git',['-C',dir,'config','user.name','CloudPlay Test']);
  execFileSync('git',['-C',dir,'add','.']);
  execFileSync('git',['-C',dir,'commit','-qm','upstream fixture']);
  assert.throws(()=>installMoonlightBridge(dir),/UPSTREAM_REVISION_MISMATCH/);
  assert.equal(readFileSync(path,'utf8'),fixture);
  assert.equal(existsSync(join(sub,'cloudplay-p0-telemetry.ts')),false);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('actual upstream addon passes TypeScript 5.x compile and strict local postMessage handshake',async(t)=>{
 const tsCheck=spawnSync('tsc',['--version'],{encoding:'utf8'});
 if(tsCheck.error?.code==='ENOENT')return t.skip('TypeScript CLI not installed; use npx tsc in Moonlight Web checkout');
 const root=resolve('integrations/moonlight-web/cloudplay-p0-telemetry.ts');
 const dir=mkdtempSync(join(tmpdir(),'cloudplay-ts-'));
 try{
  const result=spawnSync('tsc',['--target','es2022','--module','esnext','--lib','es2022,dom','--skipLibCheck','--outDir',dir,root],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const js=join(dir,'cloudplay-p0-telemetry.js');
  const bridgeModule=await import(pathToFileURL(js).href+'?test='+Date.now());
  const outbound=[];let handler=null,ticker=null;
  const parent={postMessage:(data,target)=>outbound.push({data,target})};
  const fakeWindow={parent,addEventListener:(event,fn)=>{if(event==='message')handler=fn},removeEventListener:(event,fn)=>{if(handler===fn)handler=null},
    setInterval:(fn)=>{ticker=fn;return 17},clearInterval:()=>{ticker=null}};
  const old=globalThis.window;globalThis.window=fakeWindow;
  const peer={connectionState:'connected',iceConnectionState:'connected',getStats:async()=>new Map([
    ['video',{type:'inbound-rtp',kind:'video',framesDecoded:42,bytesReceived:88888,framesPerSecond:59.8,frameWidth:1920,frameHeight:1080}],
    ['audio',{type:'inbound-rtp',kind:'audio',bytesReceived:777}],
    ['transport',{type:'transport',selectedCandidatePairId:'pair'}],
    ['pair',{id:'pair',type:'candidate-pair',state:'succeeded',currentRoundTripTime:.022,remoteCandidateId:'private'}],
    ['secret',{type:'remote-candidate',address:'192.0.2.10',port:4444,usernameFragment:'SECRET'}],
  ])};
  try{
   const connection=bridgeModule.attachCloudPlayP0Telemetry(peer);
   const hello={protocol:'cloudplay.p0.media.v1',type:'hello',sessionId:'11111111-2222-4333-8444-555555555555',challenge:'a'.repeat(32)};
   handler({source:parent,origin:'http://evil.invalid',data:hello});
   handler({source:{},origin:'http://127.0.0.1:7788',data:hello});
   assert.equal(outbound.length,0);
   handler({source:parent,origin:'http://127.0.0.1:7788',data:hello});
   await new Promise(r=>setImmediate(r));
   assert.equal(outbound[0].data.type,'hello_ack');
   assert.equal(outbound[1].data.type,'stats');
   assert.equal(outbound[1].data.stats.video.framesDecoded,42);
   assert.equal(outbound[1].data.stats.audio.bytesReceived,777);
   assert.equal(outbound[1].data.stats.network.roundTripTimeMs,22);
   assert.ok(outbound.every(({target})=>target==='http://127.0.0.1:7788'));
   assert.equal(JSON.stringify(outbound).includes('192.0.2.10'),false);
   assert.equal(JSON.stringify(outbound).includes('SECRET'),false);
   assert.equal(typeof ticker,'function');
   connection.dispose();assert.equal(handler,null);assert.equal(ticker,null);
   const count=outbound.length;await connection.dispose();assert.equal(outbound.length,count);
  }finally{globalThis.window=old}
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('upstream snapshot used for integration is immutable and explicitly known',()=>{
 assert.equal(PINNED_UPSTREAM,'7b9821430e07087f459db3db9aac550e1e9c9bff');
});
