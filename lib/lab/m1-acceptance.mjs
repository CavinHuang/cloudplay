/** CloudPlay M1 real-host acceptance evidence merger.
 * Pure host/operator data and cooperative WebRTC stats are NEVER a cryptographic
 * attestation of GPU game playback. This module checks consistency and reports
 * whether the evidence is ready for external, independent human review.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assessMediaEvidence,hasMinimalMediaEvidenceShape} from './media-evidence.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
export const REQUIRED_HOST_CHECKS=Object.freeze([
 'nvidiaGpuDetected','sunshineProcess','sunshineListening','moonlightListening',
 'coordinatorListening','agentHeartbeat','gameFilePresent','webHealthy',
 'debugApiLoopbackOnly','localLaunchEnabled'
]);
const MANUAL_CHECKS=['videoObserved','audioObserved','keyboardOrControllerObserved','successfulExitObserved'];
const isoTime=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)&&Number.isFinite(Date.parse(s))?Date.parse(s):null;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const isObject=v=>v&&typeof v==='object'&&!Array.isArray(v);
const hasOnly=(o,keys)=>isObject(o)&&Object.keys(o).every(k=>keys.includes(k));

export function assessHostPreflight(report){
 if(!hasOnly(report,['kind','schemaVersion','observedAt','checks','ready','note'])||
  report.kind!=='cloudplay-m1-host-preflight'||report.schemaVersion!==1||
  isoTime(report.observedAt)===null||!hasOnly(report.checks,REQUIRED_HOST_CHECKS)||
  REQUIRED_HOST_CHECKS.some(k=>typeof report.checks[k]!=='boolean'))
  return {valid:false,ready:false,failedChecks:['INVALID_PREFLIGHT_SCHEMA']};
 const failedChecks=REQUIRED_HOST_CHECKS.filter(k=>report.checks[k]!==true);
 return {valid:true,ready:failedChecks.length===0,failedChecks};
}

/** Recovery requires actual disconnected ICE/peer samples BETWEEN two connected
 * periods, followed by at least two sequential frame-counter increases. */
export function assessRecovery(report){
 if(!hasMinimalMediaEvidenceShape(report)||!assessMediaEvidence(report).valid)return false;
 let wasConnected=false,wentDown=false,backUp=false,progress=0,lastFrames=null;
 for(const {stats} of report.samples){
  const connected=stats.connectionState==='connected'&&['connected','completed'].includes(stats.iceConnectionState);
  const down=['disconnected','failed'].includes(stats.connectionState)||['disconnected','failed'].includes(stats.iceConnectionState);
  if(!wentDown){if(connected)wasConnected=true;if(wasConnected&&down)wentDown=true;continue;}
  if(connected){
   if(!backUp){backUp=true;lastFrames=stats.video.framesDecoded;continue;}
   if(stats.video.framesDecoded>lastFrames)progress++;
   lastFrames=stats.video.framesDecoded;
  }else{backUp=false;lastFrames=null;progress=0;}
 }
 return wentDown&&backUp&&progress>=2;
}

function safeRead(root,name,limit=1_000_000){
 if(typeof name!=='string'||!SAFE_NAME.test(name)||name==='.'||name==='..')throw Error('UNSAFE_EVIDENCE_NAME');
 const filename=path.join(root,name);
 let st;
 try{st=fs.lstatSync(filename);}catch{throw Error('EVIDENCE_FILE_NOT_FOUND');}
 if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>limit)throw Error('INVALID_EVIDENCE_FILE');
 try{return fs.readFileSync(filename);}catch{throw Error('EVIDENCE_FILE_UNREADABLE');}
}
function readJSON(root,name){
 const bytes=safeRead(root,name);
 let value;
 try{value=JSON.parse(bytes.toString('utf8'));}catch{throw Error('INVALID_JSON');}
 return value;
}
function inspectScreenshot(root,name){
 const bytes=safeRead(root,name,20_000_000);
 const ext=path.extname(name).toLowerCase();
 const png=bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const jpeg=bytes.length>=12&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes.at(-2)===0xff&&bytes.at(-1)===0xd9;
 const webp=bytes.length>=16&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!((ext==='.png'&&png)||(ext==='.jpg'&&jpeg)||(ext==='.jpeg'&&jpeg)||(ext==='.webp'&&webp)))throw Error('UNSUPPORTED_SCREENSHOT_FORMAT');
 return sha256(bytes);
}

/** Reads ONLY allowlisted same-directory files. Never copy potentially sensitive
 * raw media, token, IP, candidate, screenshot path or user-entered notes into output. */
export function verifyM1Index(filename){
 const full=path.resolve(filename),root=path.dirname(full);
 const index=readJSON(root,path.basename(full));
 if(!hasOnly(index,['kind','schemaVersion','game','hostPreflight','sessions'])||
  index.kind!=='cloudplay-m1-acceptance'||index.schemaVersion!==1||index.game!=='supertuxkart'||
  !Array.isArray(index.sessions)||index.sessions.length!==3||
  !index.sessions.every(s=>hasOnly(s,['media','manual','screenshot','reconnectExercise'])&&typeof s.reconnectExercise==='boolean')||
  index.sessions.filter(s=>s.reconnectExercise).length!==1)
  throw Error('INVALID_M1_INDEX');
 const host=readJSON(root,index.hostPreflight);
 const hostAssessment=assessHostPreflight(host);
 const failures=[];
 if(!hostAssessment.valid)failures.push('HOST_SCHEMA_INVALID');
 if(!hostAssessment.ready)failures.push('HOST_CHECKS_INCOMPLETE');
 let previousStart=-1;
 const usedIds=new Set(),files=new Set([path.basename(full),index.hostPreflight]);
 const cycles=[];
 for(let i=0;i<index.sessions.length;i++){
  const row=index.sessions[i],issues=[];
  for(const key of ['media','manual','screenshot']){
   if(typeof row[key]!=='string'||!SAFE_NAME.test(row[key])||files.has(row[key]))issues.push('REUSED_OR_INVALID_FILENAME');
   else files.add(row[key]);
  }
  let media,manual,photoHash;
  if(issues.length===0){
   try {media=readJSON(root,row.media);manual=readJSON(root,row.manual);photoHash=inspectScreenshot(root,row.screenshot);}
   catch {issues.push('EVIDENCE_FILE_INVALID');}
  }
  if(media&&manual){
   const assessed=assessMediaEvidence(media);
   if(!hasMinimalMediaEvidenceShape(media)||!assessed.valid||!assessed.decodedVideoObserved||!assessed.audioBytesIncreasing)issues.push('TRANSPORT_EVIDENCE_INCOMPLETE');
   if(!UUID.test(media.sessionId)||usedIds.has(media.sessionId))issues.push('DUPLICATE_OR_INVALID_SESSION');
   else usedIds.add(media.sessionId);
   if(!isObject(manual)||manual.sessionId!==media.sessionId||manual.game!=='supertuxkart'||
      MANUAL_CHECKS.some(k=>manual[k]!==true))issues.push('MANUAL_OBSERVATION_INCOMPLETE');
   const start=media.samples?.length?isoTime(media.samples[0].at):null;
   const end=media.samples?.length?isoTime(media.samples.at(-1).at):null;
   const observed=isoTime(manual.observedAt),collected=isoTime(media.collectedAt);
   if(start===null||end===null||observed===null||collected===null||start<=previousStart||
      observed<start||observed>end+90*60_000||collected<end||collected>end+30*60_000)
      issues.push('INVALID_EVIDENCE_TIMELINE');
   if(start!==null)previousStart=start;
   if(row.reconnectExercise&&(!assessRecovery(media)||manual.disconnectReconnectObserved!==true))issues.push('RECONNECT_NOT_PROVEN_BY_STATS_AND_OPERATOR');
   if(i===0&&isoTime(host.observedAt)!==null&&start!==null&&
      (Date.parse(host.observedAt)>start+5*60_000||Date.parse(host.observedAt)<start-24*3600_000))
      issues.push('HOST_PREFLIGHT_NOT_RECENT');
  }
  if(issues.length)failures.push(...issues.map(code=>'CYCLE_'+(i+1)+'_'+code));
  cycles.push({cycle:i+1,consistent:issues.length===0,decodedFramesObserved:media&&assessMediaEvidence(media).decodedVideoObserved===true,
   audioBytesObserved:media&&assessMediaEvidence(media).audioBytesIncreasing===true,
   operatorAttested:manual?MANUAL_CHECKS.every(k=>manual[k]===true):false,
   recoveryStatsObserved:row.reconnectExercise?!!(media&&assessRecovery(media)):null,
   screenshotSha256:photoHash||null,issues});
 }
 return {
  kind:'cloudplay-m1-review-result',schemaVersion:1,
  readyForIndependentReview:failures.length===0,
  hardwarePreflight:hostAssessment,
  cycles,failures:[...new Set(failures)],
  assurance:'LOCAL OPERATOR ATTESTATION + UNTRUSTED WEBRTC COUNTERS ONLY. Not independent proof of visible gameplay, audible sound, real input, or GPU isolation. Do not publicly expose P0 lab endpoints.'
 };
}
