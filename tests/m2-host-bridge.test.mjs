import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeP0ForM2,sendP0Heartbeat} from '../lib/m2/host-bridge.mjs';
const host={infrastructureReady:true,gpu:{detected:true,model:'PRIVATE_MODEL'},
 sunshinePortOpen:true,webStreamPortOpen:true,gameFilePresent:true,hostId:'PRIVATE_ID'};
const raw={connected:true,hosts:[host],sessions:[],token:'PRIVATE_DATA'};
const tokens={labToken:'L'.repeat(48),m2HostToken:'H'.repeat(48),hostId:'hostA'};
test('M2 private P0 bridge never declares missing, multiple or occupied hosts eligible',()=>{
 for(const report of [null,{}, {...raw,connected:false},{...raw,hosts:[host,host]},
  {...raw,hosts:[{...host,infrastructureReady:false}]}]){
  const val=sanitizeP0ForM2(report);assert.equal(val.gpuDetected,false);
  assert.equal(val.drain,true);assert.equal(val.gameProcessBusy,true);
 }
 const ok=sanitizeP0ForM2(raw);assert.equal(ok.gpuDetected,true);
 assert.equal(ok.gameProcessBusy,false);assert.equal(ok.drain,false);
 assert.equal(JSON.stringify(ok).includes('PRIVATE_MODEL'),false);
 assert.equal(sanitizeP0ForM2({...raw,sessions:[{state:'connecting'}]}).gameProcessBusy,true);
 // Coordinator recovery may not yet list the live game session even when
 // Host Agent still reports an owned game process. Never double-reserve it.
 assert.equal(sanitizeP0ForM2({...raw,hosts:[{...host,activeGame:{sessionId:'a',state:'running'}}]}).gameProcessBusy,true);
 assert.equal(sanitizeP0ForM2({...raw,hosts:[{...host,activeGame:{state:'exited'}}]}).gameProcessBusy,false);
});
test('M2 bridge sends only allowlisted flags to exact loopback ports',async()=>{
 const calls=[],fetcher=async(url,options)=>{
  calls.push({url,options});return url.includes('/internal/status')?{ok:true,json:async()=>raw}:{status:202}
 };
 const result=await sendP0Heartbeat({...tokens,fetcher});
 assert.equal(result.accepted,true);assert.equal(result.streamVerified,false);
 assert.equal(calls[0].url,'http://127.0.0.1:7788/internal/status');
 assert.equal(calls[1].url,'http://127.0.0.1:7790/internal/m2/hosts/hostA/heartbeat');
 const payload=JSON.parse(calls[1].options.body);
 assert.equal(payload.gpuDetected,true);
 assert.equal(JSON.stringify(payload).includes('PRIVATE_MODEL'),false);
 assert.equal(JSON.stringify(payload).includes('PRIVATE_DATA'),false);
});
test('M2 bridge reports unavailable P0 as unready and rejects malformed host IDs',async()=>{
 let report;
 const fetcher=async(url,options)=>{
  if(url.includes('/internal/status'))throw Error('P0 disconnected');
  report=JSON.parse(options.body);return {status:202}
 };
 const result=await sendP0Heartbeat({...tokens,fetcher});
 assert.equal(result.selfReportedEligible,false);
 assert.equal(report.drain,true);assert.equal(report.gameProcessBusy,true);
 await assert.rejects(()=>sendP0Heartbeat({...tokens,hostId:'bad/host',fetcher}),/M2_BRIDGE_NOT_CONFIGURED/);
});
