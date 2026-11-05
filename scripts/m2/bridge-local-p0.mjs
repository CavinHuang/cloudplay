#!/usr/bin/env node
// Opt-in heartbeat bridge for the already configured local P0 lab.
import {sendP0Heartbeat} from '../../lib/m2/host-bridge.mjs';
const params={hostId:process.env.CLOUDPLAY_M2_HOST_ID,
 labToken:process.env.CLOUDPLAY_LAB_TOKEN,
 m2HostToken:process.env.CLOUDPLAY_M2_HOST_TOKEN,
 drain:process.env.CLOUDPLAY_M2_HOST_DRAIN==='1'};
async function run(){
 try{
  const result=await sendP0Heartbeat(params);
  console.log(result.selfReportedEligible?'M2: host claims eligible (NOT gameplay proof)':'M2: host not eligible; no reservation possible');
 }catch(e){console.error('M2 local bridge failed:',e.message);process.exitCode=1}
}
await run();
if(process.argv.includes('--watch')){
 const interval=setInterval(run,5000);
 const stop=()=>{clearInterval(interval);process.exit(0)};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
