import {isSessionId} from './stream-handoff.mjs';

// Client telemetry is advisory and exists only inside an explicitly instrumented
// Moonlight Web client. A frame counter is NOT proof of on-screen pixels, audio
// audibility, a successful gamepad command, or commercial streaming readiness.
export const MEDIA_PROTOCOL = 'cloudplay.p0.media.v1';
const CONNECTION_STATES = new Set(['new','connecting','connected','disconnected','failed','closed','unknown']);
const ICE_STATES = new Set(['new','checking','connected','completed','disconnected','failed','closed','unknown']);
const integer = (value, max=1e12) => Number.isSafeInteger(value)&&value>=0&&value<=max?value:null;
const nonNegative = (value,max) => Number.isFinite(value)&&value>=0&&value<=max?Math.round(value*100)/100:null;
const state = (value, allowed) => allowed.has(value)?value:'unknown';
const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);

export function sanitizeMediaSample(raw) {
  if(!raw || typeof raw!=='object'||Array.isArray(raw))return null;
  const video=raw.video, audio=raw.audio;
  if(!video||typeof video!=='object'||Array.isArray(video)||!audio||typeof audio!=='object'||Array.isArray(audio))return null;
  const framesDecoded=integer(video.framesDecoded);
  const videoBytes=integer(video.bytesReceived);
  const audioBytes=integer(audio.bytesReceived);
  if(framesDecoded===null||videoBytes===null||audioBytes===null)return null;
  return {
    connectionState:state(raw.connectionState,CONNECTION_STATES),
    iceConnectionState:state(raw.iceConnectionState,ICE_STATES),
    video:{framesDecoded,bytesReceived:videoBytes,framesPerSecond:nonNegative(video.framesPerSecond,240),
      width:integer(video.width,16384),height:integer(video.height,16384),packetsLost:integer(video.packetsLost,1e9)},
    audio:{bytesReceived:audioBytes,packetsLost:integer(audio.packetsLost,1e9)},
    network:{roundTripTimeMs:nonNegative(raw.network?.roundTripTimeMs,60000)},
  };
}

/** Strict source + origin + per-page challenge checks; not remote attestation. */
export function createMediaObserver({sessionId,origin,source,nonce,clock=Date.now,stallMs=8000,staleMs=12000}={}) {
  if(!isSessionId(sessionId))throw new Error('INVALID_MEDIA_SESSION');
  if(!origin || !/^https?:\/\//.test(origin)||new URL(origin).origin!==origin)throw new Error('INVALID_MEDIA_ORIGIN');
  if(!source||typeof nonce!=='string'||!(/^[a-f0-9]{32,128}$/i).test(nonce))throw new Error('INVALID_MEDIA_CHALLENGE');
  let acknowledged=false,receivedAt=null,waitingSince=null,lastProgressAt=null,firstProgressAt=null,lastSample=null,priorFrames=null,priorAudioBytes=null;
  let videoSamples=0,audioProgress=false,videoProgress=false;
  const checkMessage=event=>event?.source===source&&event?.origin===origin&&
    event.data?.protocol===MEDIA_PROTOCOL&&event.data?.sessionId===sessionId&&event.data?.challenge===nonce;
  return {
    observe(event){
      if(!checkMessage(event))return false;
      if(event.data.type==='hello_ack') {acknowledged=true;return true;}
      if(event.data.type!=='stats'||!acknowledged)return false;
      const sample=sanitizeMediaSample(event.data.stats);
      if(!sample)return false;
      const now=clock();
      waitingSince??=now;
      // A PC renegotiation may reset inbound frame counters; treat it as a new
      // stream generation, not as successful frame progress.
      if(priorFrames!==null&&sample.video.framesDecoded<priorFrames){
        lastProgressAt=null;firstProgressAt=null;videoSamples=0;waitingSince=now;
      }
      videoProgress=priorFrames!==null&&sample.video.framesDecoded>priorFrames;
      if(videoProgress){lastProgressAt=now;firstProgressAt??=now;videoSamples++;}
      audioProgress=priorAudioBytes!==null&&sample.audio.bytesReceived>priorAudioBytes;
      priorFrames=sample.video.framesDecoded;priorAudioBytes=sample.audio.bytesReceived;
      lastSample=sample;receivedAt=now;
      return true;
    },
    snapshot(){
      const now=clock();const elapsed=receivedAt===null?null:Math.max(0,now-receivedAt);
      let stateName='bridge-not-connected';
      if(acknowledged) stateName='awaiting-media-stats';
      if(lastSample){
        if(elapsed>staleMs)stateName='telemetry-stale';
        else if(['failed','closed','disconnected'].includes(lastSample.connectionState)||
          ['failed','closed','disconnected'].includes(lastSample.iceConnectionState))stateName='transport-disconnected';
        else if(lastProgressAt!==null){stateName=now-lastProgressAt>stallMs?'video-stalled':'video-frames-received';}
        else stateName=now-waitingSince>stallMs?'no-decoded-video':'awaiting-video-frames';
      }
      const diagnostic={
        'bridge-not-connected':'The embedded client has not reported any media stats. Use an instrumented build, or open Moonlight Web separately.',
        'awaiting-media-stats':'The client replied, but RTCPeerConnection statistics have not been received.',
        'awaiting-video-frames':'No increase in decoded video frames has been measured yet. Finish Sunshine pairing and start the stream.',
        'no-decoded-video':'Video frame counters have not increased; check Moonlight stream selection, ICE/TURN and the selected codec.',
        'video-stalled':'Decoded video frame counter has stopped advancing. Check host encoding, packet loss, bandwidth or window backgrounding.',
        'video-frames-received':'Decoded frame count advanced in the instrumented client; actual on-screen content still requires visual confirmation.',
        'transport-disconnected':'WebRTC connection/ICE is disconnected, closed or failed. Try reconnecting from Moonlight Web.',
        'telemetry-stale':'Client statistics stopped arriving. Verify the iframe and the browser tab are still running.',
      }[stateName];
      return {state:stateName,advice:diagnostic,source:acknowledged?'cooperative-moonlight-client':'none',
        lastSampleAt:receivedAt===null?null:new Date(receivedAt).toISOString(),
        lastDecodedFrameAt:lastProgressAt===null?null:new Date(lastProgressAt).toISOString(),
        framesObservedIncreasing:videoSamples>0,audioBytesObservedIncreasing:audioProgress,
        stats:lastSample,mediaVerified:false,notes:'Cooperative WebRTC stats only; no proof of displayed game image, audible audio, input delivery or content rights.'};
    },
    reset(){acknowledged=false;receivedAt=null;waitingSince=null;lastProgressAt=null;firstProgressAt=null;lastSample=null;
      priorFrames=null;priorAudioBytes=null;videoSamples=0;videoProgress=false;audioProgress=false;},
  };
}

/** Aggregate ONLY safe inbound counters from a real peer connection's getStats(). */
export function summarizePeerConnectionStats(pc, report) {
  const video={framesDecoded:0,bytesReceived:0,framesPerSecond:null,width:null,height:null,packetsLost:null};
  const audio={bytesReceived:0,packetsLost:null};
  const stats=[...report.values()];
  for(const s of stats){
    if(s.type!=='inbound-rtp'||s.isRemote===true)continue;
    const kind=s.kind||s.mediaType;
    if(kind==='video'){
      video.framesDecoded+=integer(s.framesDecoded)??0;
      video.bytesReceived+=integer(s.bytesReceived)??0;
      if(s.framesPerSecond!==undefined)video.framesPerSecond=nonNegative(s.framesPerSecond,240);
      if(s.frameWidth!==undefined)video.width=integer(s.frameWidth,16384);
      if(s.frameHeight!==undefined)video.height=integer(s.frameHeight,16384);
      if(s.packetsLost!==undefined)video.packetsLost=Math.max(0,(video.packetsLost??0)+(integer(s.packetsLost,1e9)??0));
    }else if(kind==='audio'){
      audio.bytesReceived+=integer(s.bytesReceived)??0;
      if(s.packetsLost!==undefined)audio.packetsLost=Math.max(0,(audio.packetsLost??0)+(integer(s.packetsLost,1e9)??0));
    }
  }
  // Only use the selected candidate pair, never emit local/remote IP/SDP.
  const selectedId=stats.find(s=>s.type==='transport'&&s.selectedCandidatePairId)?.selectedCandidatePairId;
  const candidate=stats.find(s=>s.type==='candidate-pair'&&s.id===selectedId&&s.state==='succeeded') ||
    stats.find(s=>s.type==='candidate-pair'&&s.selected&&s.state==='succeeded');
  const rtt=candidate?.currentRoundTripTime;
  return sanitizeMediaSample({connectionState:pc.connectionState,iceConnectionState:pc.iceConnectionState,
    video,audio,network:{roundTripTimeMs:Number.isFinite(rtt)?rtt*1000:null}});
}
