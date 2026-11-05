/** Local P0 -> private M2 heartbeat adapter; never forwards private host details. */
export function sanitizeP0ForM2(status,{drain=false}={}) {
 const disabled={gpuDetected:false,sunshineReady:false,moonlightReady:false,
   gameAvailable:false,drain:true,gameProcessBusy:true};
 if(!status||status.connected!==true||!Array.isArray(status.hosts)||status.hosts.length!==1)return disabled;
 const host=status.hosts[0];
 if(!host||typeof host!=='object'||host.infrastructureReady!==true)return disabled;
 const busy=Array.isArray(status.sessions)?status.sessions.some(s=>
   ['starting','connecting','reconnecting','stopping'].includes(s?.state)):true;
 return {gpuDetected:host.gpu?.detected===true,sunshineReady:host.sunshinePortOpen===true,
   moonlightReady:host.webStreamPortOpen===true,gameAvailable:host.gameFilePresent===true,
   drain:drain===true,gameProcessBusy:busy};
}
export async function sendP0Heartbeat({hostId,labToken,m2HostToken,labPort=7788,m2Port=7790,
  drain=false,fetcher=fetch}={}) {
 if(!/^[A-Za-z0-9_-]{3,64}$/.test(hostId||'')||typeof labToken!=='string'||labToken.length<32||
   typeof m2HostToken!=='string'||m2HostToken.length<32||!Number.isInteger(labPort)||!Number.isInteger(m2Port)||
   labPort<1024||labPort>65535||m2Port<1024||m2Port>65535)throw Error('M2_BRIDGE_NOT_CONFIGURED');
 let status=null;
 try{
  const response=await fetcher('http://127.0.0.1:'+labPort+'/internal/status',{
   headers:{Authorization:'Bearer '+labToken},cache:'no-store',signal:AbortSignal.timeout(1800)});
  if(response.ok)status=await response.json();
 }catch{/* Local Coordinator missing: transmit an explicit NOT-ready report. */}
 const report=sanitizeP0ForM2(status,{drain});
 const result=await fetcher('http://127.0.0.1:'+m2Port+'/internal/m2/hosts/'+hostId+'/heartbeat',{
  method:'POST',headers:{Authorization:'Bearer '+m2HostToken,
   'X-CloudPlay-M2-Action':'1','Content-Type':'application/json'},
  cache:'no-store',body:JSON.stringify(report),signal:AbortSignal.timeout(1800)});
 if(result.status!==202)throw Error('M2_BRIDGE_HEARTBEAT_REJECTED');
 return {accepted:true,selfReportedEligible:report.gpuDetected&&report.sunshineReady&&report.moonlightReady&&
    report.gameAvailable&&!report.drain&&!report.gameProcessBusy,streamVerified:false};
}
