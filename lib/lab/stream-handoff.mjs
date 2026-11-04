// P0-only browser handoff. This is NOT a WebRTC signaling endpoint nor
// evidence that an authenticated video track was ever established.
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isSessionId(id) { return typeof id === 'string' && SESSION_ID.test(id); }

export function validateLocalStreamUrl(value='http://127.0.0.1:8080/') {
  const u = new URL(value);
  if (!['http:','https:'].includes(u.protocol) || !['127.0.0.1','localhost'].includes(u.hostname) ||
      !u.port || !Number.isInteger(Number(u.port)) || Number(u.port) < 1024 ||
      u.username || u.password || u.search || u.hash || u.pathname !== '/') {
    throw new Error('P0 stream URL must be a loopback http(s)://127.0.0.1:PORT/ or localhost URL');
  }
  return u.toString();
}

export function makeStreamHandoff({session,host,now=Date.now(),ttlMs=16000,streamUrl='http://127.0.0.1:8080/'}={}) {
  if (!session) return {status:404,code:'SESSION_NOT_FOUND'};
  // Never mark playable from a TCP port check: launch, host heartbeat and
  // independent media connection are separate stages.
  if (!['connecting','reconnecting'].includes(session.state)) return {
    status:409,code:'GAME_NOT_CONNECTABLE',sessionState:session.state,streamVerified:false
  };
  if (!host || now - host.receivedAt >= ttlMs || !host.webStreamPortOpen) return {
    status:409,code:'STREAM_HOST_UNAVAILABLE',streamVerified:false
  };
  let url;
  try { url=validateLocalStreamUrl(streamUrl); }
  catch { return {status:503,code:'STREAM_URL_NOT_CONFIGURED',streamVerified:false}; }
  return {
    status:200, mode:'external-moonlight-web',url,
    provider:'moonlight-web-stream',sessionId:session.id,gameId:session.gameId,
    sessionState:session.state,streamVerified:false,
    instructions:'Moonlight Web must log in and pair independently. If Agent launched the game, select the Sunshine Desktop entry to avoid launching a second copy.'
  };
}
