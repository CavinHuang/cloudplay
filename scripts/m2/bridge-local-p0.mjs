#!/usr/bin/env node
// Opt-in heartbeat bridge for the already configured local P0 lab.
import {sendP0Heartbeat,syncHostReservation} from '../../lib/m2/host-bridge.mjs';
import {createHostGatewayFetcher} from '../../lib/m2/tls-host-client.mjs';
import {readM2TlsFile} from './start-tls-gateway.mjs';
// The connection ID is scoped to THIS bridge process; it is never persisted
// or reused after restart. A competing process fences old heartbeats.
const connection={};
const params={hostId:process.env.CLOUDPLAY_M2_HOST_ID,
 labToken:process.env.CLOUDPLAY_LAB_TOKEN,
 m2HostToken:process.env.CLOUDPLAY_M2_HOST_TOKEN,
 m2Port:Number(process.env.CLOUDPLAY_M2_PORT||7790),
 drain:process.env.CLOUDPLAY_M2_HOST_DRAIN==='1',connection};
const remoteSettings=['CLOUDPLAY_M2_GATEWAY_URL','CLOUDPLAY_M2_CLIENT_CERT',
 'CLOUDPLAY_M2_CLIENT_KEY','CLOUDPLAY_M2_GATEWAY_CA'];
if(remoteSettings.some(k=>process.env[k])){
 try{
  params.fetcher=createHostGatewayFetcher({
   gatewayUrl:process.env.CLOUDPLAY_M2_GATEWAY_URL,
   clientCert:readM2TlsFile(process.env.CLOUDPLAY_M2_CLIENT_CERT),
   clientKey:readM2TlsFile(process.env.CLOUDPLAY_M2_CLIENT_KEY),
   serverCa:readM2TlsFile(process.env.CLOUDPLAY_M2_GATEWAY_CA),
   coordinatorPort:Number(process.env.CLOUDPLAY_M2_PORT||7790),
  });
 }catch(e){console.error('M2 bridge TLS configuration rejected:',e.message);process.exit(1)}
}
let inFlight=false;
async function run(){
 if(inFlight||connection.fenced)return;
 inFlight=true;
 try{
  const result=await sendP0Heartbeat(params);
  const snapshot=await syncHostReservation(params);
  console.log(result.selfReportedEligible?'M2: host claims eligible (NOT gameplay proof)':'M2: host not eligible; no reservation possible');
  if(snapshot.assigned)console.log('M2: private capacity assignment observed (NO game or stream started)');
 }catch(e){
  console.error('M2 local bridge failed:',e.message);
  process.exitCode=1;
  if(connection.fenced)process.exit(1);
 }finally{inFlight=false}
}
await run();
if(process.argv.includes('--watch')&&!connection.fenced){
 const interval=setInterval(run,5000);
 const stop=()=>{clearInterval(interval);process.exit(0)};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
