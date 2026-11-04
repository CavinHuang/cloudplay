/**
 * P0 cooperative media evidence. Stores only whitelisted counters from an
 * instrumented Moonlight Web peer; never an SDP, candidate, address or token.
 * Counters demonstrate a transport-level event, NOT the content of the game.
 */
import {sanitizeMediaSample} from './media-telemetry.mjs';

const SESSION_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const MAX_SAMPLES=180;
const STATES=new Set(['connected','completed']);
const safeTime=x=>typeof x==='string'&&ISO.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):null;

export function sanitizeMediaEvidenceSample(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const at=safeTime(value.at);
  const stats=sanitizeMediaSample(value.stats);
  if(at===null||!stats)return null;
  return {at:new Date(at).toISOString(),stats};
}

/** Reject unexpected fields so evidence files cannot accidentally carry credentials,
 * SDP or candidate IPs. The attestation summary is informational only. */
export function hasMinimalMediaEvidenceShape(report){
  if(!report || typeof report!=='object' || Array.isArray(report) || !Array.isArray(report.samples))return false;
  const subset=(item,allowed)=>item&&typeof item==='object'&&!Array.isArray(item)&&Object.keys(item).every(x=>allowed.includes(x));
  if(!subset(report,['schemaVersion','kind','sessionId','collectedAt','samples','assessment']))return false;
  for(const sample of report.samples){
    if(!subset(sample,['at','stats'])||!sample.stats)return false;
    const stats=sample.stats;
    if(!subset(stats,['connectionState','iceConnectionState','video','audio','network'])||
      !subset(stats.video,['framesDecoded','bytesReceived','framesPerSecond','width','height','packetsLost'])||
      !subset(stats.audio,['bytesReceived','packetsLost'])||
      !subset(stats.network,['roundTripTimeMs']))return false;
  }
  return true;
}

/** Pure and deterministic; does not trust a report's claimed success field. */
export function assessMediaEvidence(report){
  if(!report||report.schemaVersion!==1||report.kind!=='cloudplay-p0-media-observation'||
    typeof report.sessionId!=='string'||!SESSION_ID.test(report.sessionId)||
    !Array.isArray(report.samples)||report.samples.length>MAX_SAMPLES)
    return {valid:false,reason:'INVALID_MEDIA_EVIDENCE',transportObserved:false};
  let lastAt=-1,firstAt=null,audioProgress=false;
  let videoProgress=false,connectedSamples=0,framesInWindow=0,iceDisconnects=0,consecutive=0,largestConsecutive=0;
  let lastVideo=null,lastAudio=null,previousConnected=false;
  for(const raw of report.samples){
    const entry=sanitizeMediaEvidenceSample(raw);
    if(!entry)return {valid:false,reason:'INVALID_MEDIA_SAMPLE',transportObserved:false};
    const at=Date.parse(entry.at);
    if(at<=lastAt)return {valid:false,reason:'NON_MONOTONIC_SAMPLE_TIME',transportObserved:false};
    lastAt=at;firstAt??=at;
    const {video,audio,connectionState,iceConnectionState}=entry.stats;
    const connected=connectionState==='connected'&&STATES.has(iceConnectionState);
    if(connected)connectedSamples++;else if(['failed','disconnected','closed'].includes(connectionState)||
      ['failed','disconnected','closed'].includes(iceConnectionState))iceDisconnects++;
    if(connected&&previousConnected&&lastVideo!==null&&video.framesDecoded>lastVideo){
      videoProgress=true;framesInWindow+=video.framesDecoded-lastVideo;
      consecutive++;largestConsecutive=Math.max(largestConsecutive,consecutive);
    }else{consecutive=0;}
    if(connected&&previousConnected&&lastAudio!==null&&audio.bytesReceived>lastAudio)audioProgress=true;
    // A renegotiation/counter reset never counts as frame progress.
    lastVideo=video.framesDecoded;lastAudio=audio.bytesReceived;previousConnected=connected;
  }
  const spanMs=firstAt===null?0:lastAt-firstAt;
  const decodedVideoObserved=videoProgress&&spanMs>=1500&&largestConsecutive>=2&&framesInWindow>=2;
  const result={valid:true,reason:null,source:'cooperative-moonlight-web-stats',sampleCount:report.samples.length,
    durationMs:spanMs,connectedSamples,decodedVideoObserved,decodedFrameDelta:framesInWindow,
    audioBytesIncreasing:audioProgress,iceDisconnects,
    transportObserved:decodedVideoObserved,
    gameImageVerified:false,audibleAudioVerified:false,gameInputVerified:false,
    note:'Untrusted client-side WebRTC counters; requires independent Windows host, visual/audio/input and exit verification.'};
  return result;
}

export function createMediaEvidenceRecorder({sessionId,clock=()=>Date.now()}={}){
  if(typeof sessionId!=='string'||!SESSION_ID.test(sessionId))throw new Error('INVALID_MEDIA_SESSION');
  const samples=[];let lastAt=-1;
  return {
    add(stats){
      const at=clock();if(!Number.isSafeInteger(at)||at<=lastAt)return false;
      const entry=sanitizeMediaEvidenceSample({at:new Date(at).toISOString(),stats});if(!entry)return false;
      samples.push(entry);lastAt=at;
      if(samples.length>MAX_SAMPLES)samples.shift();
      return true;
    },
    clear(){samples.length=0;lastAt=-1;},
    export(){
      const result={schemaVersion:1,kind:'cloudplay-p0-media-observation',sessionId,
        collectedAt:new Date(clock()).toISOString(),samples:samples.map(x=>({at:x.at,stats:x.stats}))};
      return {...result,assessment:assessMediaEvidence(result)};
    }
  };
}
