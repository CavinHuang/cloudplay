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

/**
 * Pull ONLY capacity-assignment metadata from the private M2 controller.
 * The host then acknowledges having OBSERVED a matching current lease.
 * Never execute a game or forward player/owner details; do not persist the
 * ephemeral process generation or expose connection secrets to the browser.
 */
export async function syncHostReservation({hostId,m2HostToken,m2Port=7790,
  connection,fetcher=fetch}={}){
 if(!/^[A-Za-z0-9_-]{3,64}$/.test(hostId||'')||
   typeof m2HostToken!=='string'||m2HostToken.length<32||
   !Number.isInteger(m2Port)||m2Port<1024||m2Port>65535||
   !connection||typeof connection!=='object'||connection.fenced||
   !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(connection.connectionId||''))
   throw Error('M2_BRIDGE_SYNC_NOT_CONFIGURED');
 const next=async(suffix,payload)=>{
  const previous=connection.syncSequence??0;
  if(!Number.isSafeInteger(previous)||previous<0||previous>=Number.MAX_SAFE_INTEGER)
   throw Error('M2_BRIDGE_SYNC_SEQUENCE_EXHAUSTED');
  // Advance before send: a timeout might occur AFTER the controller commits,
  // so retry using a fresh sequence. Gaps are allowed, replay isn't.
  const sequence=previous+1;
  connection.syncSequence=sequence;
  const reply=await fetcher('http://127.0.0.1:'+m2Port+'/internal/m2/hosts/'+hostId+'/'+suffix,{
   method:'POST',headers:{Authorization:'Bearer '+m2HostToken,
    'X-CloudPlay-M2-Action':'1','Content-Type':'application/json'},
   cache:'no-store',body:JSON.stringify({...payload,connectionId:connection.connectionId,sequence}),
   signal:AbortSignal.timeout(1800)
  });
  if(reply.status===409){
   let code='';
   try{code=(await reply.json())?.code||''}catch{}
   if(['HOST_CONNECTION_FENCED','HOST_CONNECTION_REQUIRED','HOST_SYNC_REPLAYED'].includes(code))
    connection.fenced=true;
   if(connection.fenced)throw Error('M2_BRIDGE_CONNECTION_FENCED_RESTART_REQUIRED');
   throw Error('M2_BRIDGE_SYNC_CONFLICT');
  }
  if(reply.status!==(suffix==='sync'?200:202))throw Error('M2_BRIDGE_SYNC_REJECTED');
  return reply.json();
 };
 const snapshot=await next('sync',{});
 if(snapshot?.kind!=='cloudplay.m2.host-sync.v1'||
   snapshot?.gameLaunchEnabled!==false||snapshot?.streamVerified!==false||
   typeof snapshot?.acknowledged!=='boolean'||
   !['CAPACITY_IDLE','OBSERVE_RESERVATION'].includes(snapshot.action))
   throw Error('M2_BRIDGE_INVALID_SYNC_RESPONSE');
 if(snapshot.action==='CAPACITY_IDLE'){
  if(snapshot.assignment!==null||snapshot.acknowledged)throw Error('M2_BRIDGE_INVALID_SYNC_RESPONSE');
  return {assigned:false,acknowledged:false,streamVerified:false};
 }
 const assignment=snapshot.assignment;
 if(!assignment||Object.keys(assignment).sort().join(',')!=='expiresAt,gameId,reservationId'||
   !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assignment.reservationId||'')||
   assignment.gameId!=='supertuxkart'||
   !Number.isSafeInteger(assignment.expiresAt)||assignment.expiresAt<0)
  throw Error('M2_BRIDGE_INVALID_SYNC_RESPONSE');
 if(!snapshot.acknowledged){
  const receipt=await next('ack',{reservationId:assignment.reservationId,expiresAt:assignment.expiresAt});
  if(receipt?.acknowledged!==true||receipt?.gameLaunchEnabled!==false||
    receipt?.streamVerified!==false)throw Error('M2_BRIDGE_INVALID_ACK_RESPONSE');
 }
 return {assigned:true,acknowledged:true,streamVerified:false};
}
