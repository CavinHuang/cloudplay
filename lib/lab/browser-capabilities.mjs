/** Browser-only diagnostics. An API being present never attests actual game streaming. */
export function collectBrowserCapabilities({window: win,document:doc,navigator:nav,RTCPeerConnection: Peer,RTCRtpReceiver: Receiver,VideoDecoder:Decoder}={}) {
  const codecNames=[];
  try {
    for(const c of Receiver?.getCapabilities?.('video')?.codecs||[]){
      const type=String(c?.mimeType||'').toLowerCase();
      if(type.startsWith('video/')&&!codecNames.includes(type))codecNames.push(type);
    }
  }catch{}
  let connectedGamepads=0,buttonsPressed=0,axesActive=0;
  try {
    for(const pad of nav?.getGamepads?.()||[]){
      if(!pad)continue;
      connectedGamepads++;
      buttonsPressed+=(pad.buttons||[]).filter(b=>b?.pressed).length;
      axesActive+=(pad.axes||[]).filter(v=>Math.abs(Number(v)||0)>.3).length;
    }
  }catch{}
  return {
    secureContext: win?.isSecureContext===true,
    webRTC:typeof Peer==='function',
    videoCodecs:codecNames,
    webCodecs:typeof Decoder==='function',
    gamepadAPI:typeof nav?.getGamepads==='function',
    connectedGamepads,buttonsPressed,axesActive,
    fullscreen:typeof doc?.documentElement?.requestFullscreen==='function',
    pointerLock:typeof doc?.body?.requestPointerLock==='function',
    keyboardLock:typeof nav?.keyboard?.lock==='function',
    mediaVerified:false,
    diagnosticScope:'browser-API-presence-and-local-input-only',
  };
}
export function makeBrowserCapabilityReport(capabilities,{sessionId=null,time=new Date().toISOString()}={}) {
  // Do not export fingerprinting details (Gamepad device IDs, IP addresses, raw UA).
  const {secureContext,webRTC,webCodecs,videoCodecs,gamepadAPI,connectedGamepads,buttonsPressed,axesActive,fullscreen,pointerLock,keyboardLock}=capabilities;
  return {type:'cloudplay-browser-capability-report',schema:1,capturedAt:time,sessionId,
    capabilities:{secureContext,webRTC,webCodecs,videoCodecs,gamepadAPI,connectedGamepads,buttonsPressed,axesActive,fullscreen,pointerLock,keyboardLock},
    mediaVerified:false,note:'Does not read Moonlight Web iframe, GPU media frames, RTCPeerConnection stats, audio or actual game input delivery.'};
}
