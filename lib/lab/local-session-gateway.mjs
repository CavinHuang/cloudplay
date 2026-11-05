import {validateLabEndpoint} from './agent.mjs';
import {isSessionId} from './stream-handoff.mjs';

// Server-to-loopback gateway. Browser never chooses a host, command, token,
// executable, arguments, or arbitrary game ID.
const AUTH_TIMEOUT_MS=2000;
const safeStates=new Set(['starting','connecting','reconnecting','stopping','finished','failed','cancelled']);
function reply(status,code){return {status,code};}
function publicSession(session){
  if(!session || !isSessionId(session.id) || session.gameId!=='supertuxkart' ||
      !safeStates.has(session.state))return null;
  return {id:session.id,gameId:'supertuxkart',state:session.state,
    streamVerified:false,updatedAt:session.updatedAt??null};
}
async function coordinatorFetch({endpoint,token,fetcher,method='GET',path,body}){
  const url=validateLabEndpoint(endpoint);
  return fetcher(new URL(path,url),{method,
    headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
    cache:'no-store',signal:AbortSignal.timeout(AUTH_TIMEOUT_MS)});
}
const failureCodes=new Set(['LOCAL_LAUNCH_DISABLED','GAME_NOT_ALLOWLISTED','HOST_OFFLINE','HOST_NOT_READY','HOST_PROCESS_BUSY','HOST_SESSION_BUSY','SESSION_NOT_FOUND','GAME_STOP_NOT_CONFIRMED']);
export async function createLocalLabSession({gameId='supertuxkart',
  endpoint=process.env.CLOUDPLAY_LAB_ENDPOINT,token=process.env.CLOUDPLAY_LAB_TOKEN,fetcher=fetch}={}){
  if(gameId!=='supertuxkart')return reply(422,'GAME_NOT_ALLOWLISTED');
  if(!token || token.length<32 || !endpoint)return reply(503,'LAB_NOT_CONFIGURED');
  try{
    const statusResponse=await coordinatorFetch({endpoint,token,fetcher,path:'/internal/status'});
    if(!statusResponse.ok)return reply(503,'LAB_UNAVAILABLE');
    const status=await statusResponse.json();
    if(!status?.localLaunchEnabled || !Array.isArray(status.hosts))return reply(403,'LOCAL_LAUNCH_DISABLED');
    const hosts=status.hosts.filter(h=>h.infrastructureReady===true &&
      typeof h.hostId==='string' && /^[A-Za-z0-9_-]{3,64}$/.test(h.hostId));
    if(hosts.length===0)return reply(409,'LOCAL_HOST_NOT_READY');
    if(hosts.length>1)return reply(409,'MULTIPLE_LOCAL_HOSTS');
    const response=await coordinatorFetch({endpoint,token,fetcher,method:'POST',path:'/internal/lab/sessions',
      body:{gameId:'supertuxkart',hostId:hosts[0].hostId}});
    const result=await response.json();
    if(!response.ok)return reply([403,409,422].includes(response.status)?response.status:503,
      failureCodes.has(result?.code)?result.code:'LAB_UNAVAILABLE');
    const session=publicSession(result?.session);
    if(response.status!==202 || !session)return reply(502,'INVALID_LAB_RESPONSE');
    return {status:202,session};
  }catch{return reply(503,'LAB_UNAVAILABLE');}
}
export async function stopLocalLabSession(sessionId,{endpoint=process.env.CLOUDPLAY_LAB_ENDPOINT,
  token=process.env.CLOUDPLAY_LAB_TOKEN,fetcher=fetch}={}){
  if(!isSessionId(sessionId))return reply(400,'INVALID_SESSION_ID');
  if(!token || token.length<32 || !endpoint)return reply(503,'LAB_NOT_CONFIGURED');
  try{
    const response=await coordinatorFetch({endpoint,token,fetcher,method:'DELETE',
      path:'/internal/lab/sessions/'+sessionId});
    const result=await response.json();
    if(!response.ok)return reply(response.status===404?404:503,
      failureCodes.has(result?.code)?result.code:'LAB_UNAVAILABLE');
    const session=publicSession(result?.session);
    if(!session || session.id!==sessionId)return reply(502,'INVALID_LAB_RESPONSE');
    return {status:response.status===202?202:200,session};
  }catch{return reply(503,'LAB_UNAVAILABLE');}
}
