import {validateLabEndpoint} from './agent.mjs';
import {isSessionId, validateLocalStreamUrl} from './stream-handoff.mjs';

export async function readLabStatus({endpoint=process.env.CLOUDPLAY_LAB_ENDPOINT,token=process.env.CLOUDPLAY_LAB_TOKEN,fetcher=fetch}={}) {
  const disconnected={connected:false,hosts:[],streamVerified:false,source:'none',message:'P0 本地主机检查服务尚未配置或无法访问'};
  if (!endpoint || !token || token.length < 32) return disconnected;
  try {
    const url=validateLabEndpoint(endpoint);
    const response=await fetcher(new URL('/internal/status',url), {
      headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(1600)
    });
    if (!response.ok) return {...disconnected,message:`P0 协调器返回 HTTP ${response.status}`};
    const result=await response.json();
    if (!result || !Array.isArray(result.hosts) || typeof result.connected !== 'boolean') return disconnected;
    // Never leak host identifier or GPU model to a public page; show only coarse boolean availability.
    return {
      connected:result.connected,streamVerified:false,localLaunchEnabled:result.localLaunchEnabled===true,source:'authenticated-host-agent-heartbeat',
      sessions:(Array.isArray(result.sessions)?result.sessions:[]).map(s=>({id:s.id,gameId:s.gameId,state:s.state,updatedAt:s.updatedAt,reason:s.reason,playbackVerified:false})).slice(-5),
      hosts:result.hosts.map(h=>({gpuDetected:h.gpu?.detected===true,sunshinePortOpen:h.sunshinePortOpen===true,webStreamPortOpen:h.webStreamPortOpen===true,gameFilePresent:h.gameFilePresent===true, infrastructureReady:h.infrastructureReady===true,lastSeenAt:h.lastSeenAt})),
      message:result.message || '主机连接状态已采集，但尚无游戏画面证据',
    };
  } catch { return disconnected; }
}

/** Read one P0-only lab session through the server-to-loopback authenticated channel.
 * Never returns a launcher token, executable path, GPU model or private host ID.
 */
export async function readLabSession(sessionId,{endpoint=process.env.CLOUDPLAY_LAB_ENDPOINT,
  token=process.env.CLOUDPLAY_LAB_TOKEN,fetcher=fetch}={}) {
  if(!isSessionId(sessionId))return {code:'INVALID_SESSION_ID',status:400};
  if(!endpoint||!token||token.length<32)return {code:'LAB_NOT_CONFIGURED',status:503};
  try{
    const origin=validateLabEndpoint(endpoint);
    const result=await fetcher(new URL(`/internal/lab/sessions/${sessionId}`,origin),{
      headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(1600)
    });
    if(!result.ok)return {code:result.status===404?'SESSION_NOT_FOUND':'LAB_UNAVAILABLE',status:result.status===404?404:503};
    const body=await result.json();
    const s=body?.session;
    if(!s || s.id!==sessionId || s.gameId!=='supertuxkart')return {code:'INVALID_LAB_RESPONSE',status:502};
    const allowed=new Set(['starting','connecting','reconnecting','stopping','finished','cancelled','failed']);
    if(!allowed.has(s.state))return {code:'INVALID_LAB_RESPONSE',status:502};
    return {status:200,session:{id:s.id,gameId:s.gameId,state:s.state,
      reason:typeof s.reason==='string'?s.reason.slice(0,160):null,
      updatedAt:s.updatedAt,streamVerified:false,
      provider:'moonlight-web-stream',mode:'local-manual-handoff'}};
  }catch{return {code:'LAB_UNAVAILABLE',status:503};}
}


/** Request a one-time browser handoff decision from the authenticated local
 * coordinator. This never implements WebRTC signaling or verifies media.
 * The browser only receives the independently authenticated Moonlight Web URL.
 */
export async function readLabHandoff(sessionId,{endpoint=process.env.CLOUDPLAY_LAB_ENDPOINT,
  token=process.env.CLOUDPLAY_LAB_TOKEN,fetcher=fetch}={}) {
  if(!isSessionId(sessionId))return {status:400,code:'INVALID_SESSION_ID'};
  if(!endpoint||!token||token.length<32)return {status:503,code:'LAB_NOT_CONFIGURED'};
  try {
    const origin=validateLabEndpoint(endpoint);
    const response=await fetcher(new URL(`/internal/lab/sessions/${sessionId}/stream-handoff`,origin),{
      headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(1600)
    });
    const body=await response.json();
    if(!response.ok){
      const allowed=new Set(['SESSION_NOT_FOUND','GAME_NOT_CONNECTABLE','STREAM_HOST_UNAVAILABLE','STREAM_URL_NOT_CONFIGURED']);
      const code=allowed.has(body?.code)?body.code:'LAB_UNAVAILABLE';
      return {status:response.status===404?404:response.status===409?409:503,code};
    }
    if(body?.sessionId!==sessionId || body?.gameId!=='supertuxkart' ||
      body?.provider!=='moonlight-web-stream' || body?.streamVerified!==false ||
      !['connecting','reconnecting'].includes(body?.sessionState)) {
      return {status:502,code:'INVALID_LAB_HANDOFF'};
    }
    // Reject credentials, arbitrary hosts, path/query redirects and public URLs.
    let url;
    try { url=validateLocalStreamUrl(body.url); }
    catch {return {status:502,code:'INVALID_LAB_HANDOFF_URL'};}
    return {status:200,sessionId,gameId:'supertuxkart',url,provider:'moonlight-web-stream',
      state:body.sessionState,streamVerified:false,mode:'local-browser-handoff'};
  }catch{return {status:503,code:'LAB_UNAVAILABLE'};}
}
