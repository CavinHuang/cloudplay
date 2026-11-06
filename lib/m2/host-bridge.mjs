/** Local P0 -> private M2 heartbeat adapter; never forwards private host details. */
export function sanitizeP0ForM2(status,{drain=false}={}) {
 const disabled={gpuDetected:false,sunshineReady:false,moonlightReady:false,
   gameAvailable:false,drain:true,gameProcessBusy:true};
 if(!status||status.connected!==true||!Array.isArray(status.hosts)||status.hosts.length!==1)return disabled;
 const host=status.hosts[0];
 if(!host||typeof host!=='object'||host.infrastructureReady!==true)return disabled;
 // An owned game may survive a Coordinator restart even before its session
 // journal has reattached. Host Agent activeGame is an independent busy signal.
 // Never report it as idle simply because the session list is empty.
 const ownedGameRunning=host.activeGame?.state==='running';
 const busy=ownedGameRunning||(!Array.isArray(status.sessions))||status.sessions.some(s=>
   ['starting','connecting','reconnecting','stopping'].includes(s?.state));
 return {gpuDetected:host.gpu?.detected===true,sunshineReady:host.sunshinePortOpen===true,
   moonlightReady:host.webStreamPortOpen===true,gameAvailable:host.gameFilePresent===true,
   drain:drain===true,gameProcessBusy:busy};
}
export async function sendP0Heartbeat({hostId,labToken,m2HostToken,labPort=7788,m2Port=7790,
  drain=false,connection=null,fetcher=fetch}={}) {
 if(!/^[A-Za-z0-9_-]{3,64}$/.test(hostId||'')||typeof labToken!=='string'||labToken.length<32||
   typeof m2HostToken!=='string'||m2HostToken.length<32||!Number.isInteger(labPort)||!Number.isInteger(m2Port)||
   labPort<1024||labPort>65535||m2Port<1024||m2Port>65535)throw Error('M2_BRIDGE_NOT_CONFIGURED');
 if(connection!==null){
  if(typeof connection!=='object'||Array.isArray(connection)||connection.fenced===true)
   throw Error('M2_BRIDGE_CONNECTION_FENCED_RESTART_REQUIRED');
  if(!connection.connectionId){
   // Claim a new host process generation on bridge startup. A later process
   // invalidates this generation and any prior leases; never auto-reclaim a
   // generation that was explicitly fenced by another process.
   const connected=await fetcher('http://127.0.0.1:'+m2Port+'/internal/m2/hosts/'+hostId+'/connect',{
    method:'POST',headers:{Authorization:'Bearer '+m2HostToken,
     'X-CloudPlay-M2-Action':'1','Content-Type':'application/json'},
    cache:'no-store',body:JSON.stringify({protocol:'cloudplay.m2.host-connection.v1'}),
    signal:AbortSignal.timeout(1800)
   });
   if(connected.status!==201)throw Error('M2_BRIDGE_CONNECT_REJECTED');
   const receipt=await connected.json();
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt?.connectionId||'')||
     receipt?.nextSequence!==1)throw Error('M2_BRIDGE_INVALID_CONNECT_RECEIPT');
   connection.connectionId=receipt.connectionId;
   connection.sequence=0;
  }
 }
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
  cache:'no-store',body:JSON.stringify(connection?{
   ...report,connectionId:connection.connectionId,sequence:connection.sequence+1}:report),
  signal:AbortSignal.timeout(1800)});
 if(result.status!==202){
  if(connection&&result.status===409){
   let code='';
   try{code=(await result.json())?.code||''}catch{}
   if(['HOST_CONNECTION_FENCED','HOST_CONNECTION_REQUIRED','HOST_HEARTBEAT_REPLAYED'].includes(code))
    connection.fenced=true;
  }
  throw Error(connection?.fenced?'M2_BRIDGE_CONNECTION_FENCED_RESTART_REQUIRED':'M2_BRIDGE_HEARTBEAT_REJECTED');
 }
 if(connection)connection.sequence+=1;
 return {accepted:true,selfReportedEligible:report.gpuDetected&&report.sunshineReady&&report.moonlightReady&&
    report.gameAvailable&&!report.drain&&!report.gameProcessBusy,streamVerified:false};
}
