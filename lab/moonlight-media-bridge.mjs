import {MEDIA_PROTOCOL,summarizePeerConnectionStats} from '../lib/lab/media-telemetry.mjs';

/**
 * OPTIONAL ADAPTER FOR A MODIFIED Moonlight Web CLIENT (not its stock binary).
 * Call when the streaming code owns its live RTCPeerConnection instance:
 * attachMoonlightMediaBridge({getPeerConnection:()=>currentPeerConnection,
 *   expectedParentOrigin:'http://127.0.0.1:7788'}).
 * Must be mounted INSIDE the actual Moonlight client origin. Does not intercept
 * cross-origin iframes, send credentials, spoof stats or control the game.
 */
export function attachMoonlightMediaBridge({getPeerConnection,expectedParentOrigin,window:win=globalThis.window,
  pollIntervalMs=1500}={}) {
  if(typeof getPeerConnection!=='function')throw new Error('LIVE_PEER_CONNECTION_GETTER_REQUIRED');
  let parentUrl;try{parentUrl=new URL(expectedParentOrigin)}catch{throw new Error('UNTRUSTED_PARENT_ORIGIN')}
  if(parentUrl.protocol!=='http:'||!['127.0.0.1','localhost'].includes(parentUrl.hostname)||
    !parentUrl.port||Number(parentUrl.port)<1024||Number(parentUrl.port)>65535||
    parentUrl.origin!==expectedParentOrigin)throw new Error('UNTRUSTED_PARENT_ORIGIN');
  if(!Number.isSafeInteger(pollIntervalMs)||pollIntervalMs<750)throw new Error('INVALID_SAMPLE_INTERVAL');
  const parent=win.parent;
  if(!parent||parent===win)throw new Error('BRIDGE_REQUIRES_EMBEDDED_CLIENT');
  let timer=null,channel=null,inFlight=false;
  function send(type,details={}){if(channel)parent.postMessage({protocol:MEDIA_PROTOCOL,sessionId:channel.sessionId,challenge:channel.challenge,type,...details},expectedParentOrigin);}
  async function sample(){
    if(!channel||inFlight)return;
    const pc=getPeerConnection();
    if(!pc||typeof pc.getStats!=='function')return;
    inFlight=true;
    try{
      const stats=summarizePeerConnectionStats(pc,await pc.getStats());
      if(stats)send('stats',{stats});
    }catch{/* A closed / restarting peer must not crash the actual streamer. */}
    finally{inFlight=false;}
  }
  function receive(event){
    if(event.source!==parent||event.origin!==expectedParentOrigin)return;
    const d=event.data;
    if(!d||d.protocol!==MEDIA_PROTOCOL||d.type!=='hello'||
      !/^[0-9a-f-]{36}$/i.test(d.sessionId||'')||!/^[a-f0-9]{32,128}$/i.test(d.challenge||''))return;
    channel={sessionId:d.sessionId,challenge:d.challenge};
    send('hello_ack');
    if(timer===null)timer=win.setInterval(sample,pollIntervalMs);
    void sample();
  }
  win.addEventListener('message',receive);
  return {dispose(){win.removeEventListener('message',receive);if(timer!==null)win.clearInterval(timer);channel=null;timer=null;},sample};
}
