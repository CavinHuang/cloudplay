/**
 * Cooperative Moonlight Web diagnostics for the trusted local Next player.
 * No control-plane credential, SDP, peer address, or game content crosses this
 * bridge. WebRTC counters cannot independently prove playable media.
 */
import {createMediaObserver,MEDIA_PROTOCOL} from './media-telemetry.mjs';
import {createMediaEvidenceRecorder} from './media-evidence.mjs';
import {isSessionId} from './stream-handoff.mjs';

export const LOCAL_MOONLIGHT_ORIGIN='http://127.0.0.1:8080';
export {MEDIA_PROTOCOL};

export function createLocalMediaSession({sessionId,source,nonce,clock=Date.now,recorder}={}){
 if(!isSessionId(sessionId))throw Error('INVALID_LOCAL_MEDIA_SESSION');
 const observer=createMediaObserver({sessionId,source,nonce,origin:LOCAL_MOONLIGHT_ORIGIN,clock});
 const evidence=recorder ?? createMediaEvidenceRecorder({sessionId,clock});
 return {
  hello(){return {protocol:MEDIA_PROTOCOL,type:'hello',sessionId,challenge:nonce}},
  origin:LOCAL_MOONLIGHT_ORIGIN,
  observe(event){
   if(!observer.observe(event))return false;
   if(event.data?.type==='stats')evidence.add(observer.snapshot().stats);
   return true;
  },
  snapshot(){return observer.snapshot()},
  exportMedia(){return evidence.export()},
 };
}

/** Only explicit operator checkboxes, never telemetry or an API response,
 * can populate the human witness record. Incomplete records remain incomplete.
 */
export function makeLocalManualEvidence({sessionId,checks={},clock=Date.now}={}){
 if(!isSessionId(sessionId))throw Error('INVALID_LOCAL_MEDIA_SESSION');
 const yes=key=>checks[key]===true;
 return {
  game:'supertuxkart',sessionId,observedAt:new Date(clock()).toISOString(),
  videoObserved:yes('videoObserved'),
  audioObserved:yes('audioObserved'),
  keyboardOrControllerObserved:yes('keyboardOrControllerObserved'),
  successfulExitObserved:yes('successfulExitObserved'),
  disconnectReconnectObserved:yes('disconnectReconnectObserved'),
 };
}
