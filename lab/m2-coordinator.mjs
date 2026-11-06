/**
 * Private loopback-only M2 admission/control-plane service.
 * Never exposes remote game execution, public user auth or stream handoff.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {createAdmissionManager} from '../lib/m2/admission.mjs';
import {createIdentityRegistry} from '../lib/m2/identities.mjs';
const HOST_ID=/^[A-Za-z0-9_-]{3,64}$/;
const PRIVATE_HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const tokenOk=(provided,expected)=>{
 if(typeof provided!=='string'||typeof expected!=='string'||expected.length<32)return false;
 const a=Buffer.from(provided),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
};
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...PRIVATE_HEADERS});res.end(JSON.stringify(body)+'\n')}
async function readJson(req){
 if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw {status:415,code:'JSON_REQUIRED'};
 let total=0;const bytes=[];
 for await(const piece of req){total+=piece.length;if(total>4096)throw {status:413,code:'BODY_TOO_LARGE'};bytes.push(piece)}
 let body;try{body=JSON.parse(Buffer.concat(bytes).toString('utf8'))}catch{throw {status:400,code:'INVALID_JSON'}}
 if(!body||typeof body!=='object'||Array.isArray(body))throw {status:422,code:'INVALID_BODY'};
 return body;
}
function readJournal(filename){
 if(!filename)return null;
 try{
  const stat=fs.lstatSync(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1000000||stat.size<2)throw Error('M2_INVALID_JOURNAL_FILE');
  return JSON.parse(fs.readFileSync(filename,'utf8'));
 }catch(e){if(e.code==='ENOENT')return null;throw Error('M2_JOURNAL_READ_FAILED')}
}
function persistJournal(filename,state){
 if(!filename)return;
 const root=path.dirname(filename);
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const tmp=path.join(root,'.m2-journal-'+randomUUID()+'.tmp');
 try{
  fs.writeFileSync(tmp,JSON.stringify(state)+'\n',{flag:'wx',mode:0o600});
  fs.renameSync(tmp,filename);
 }finally{try{fs.unlinkSync(tmp)}catch(e){if(e.code!=='ENOENT')throw e}}
}
export function createM2Coordinator({adminToken,hostTokens={},enabledGames=[],statePath=null,clock=Date.now,manager=null}={}){
 if(typeof adminToken!=='string'||adminToken.length<32||!hostTokens||typeof hostTokens!=='object'||Array.isArray(hostTokens)||
   Object.keys(hostTokens).length>32)throw Error('M2_CREDENTIALS_REQUIRED');
 const secrets=[adminToken,...Object.values(hostTokens)];
 if(secrets.some(x=>typeof x!=='string'||x.length<32)||new Set(secrets).size!==secrets.length||
   Object.keys(hostTokens).some(x=>!HOST_ID.test(x)))throw Error('M2_INVALID_HOST_CREDENTIALS');
 if(statePath&&(!path.isAbsolute(statePath)||path.basename(statePath)!=='m2-journal.json'))throw Error('M2_INVALID_STATE_PATH');
 const admission=manager??createAdmissionManager({clock,enabledGames,onChange:s=>persistJournal(statePath,s)});
 if(statePath){
  const journal=readJournal(statePath);
  if(journal)admission.restore(journal);
 }
 const identities=createIdentityRegistry({
  statePath:statePath?path.join(path.dirname(statePath),'m2-identities.json'):null,
  legacyHostTokens:hostTokens,clock,
  onDisable:(kind,id,reason)=>admission.invalidateIdentity(kind,id,reason)
 });
 const server=http.createServer(async(req,res)=>{
  if(req.socket.remoteAddress!=='127.0.0.1'&&req.socket.remoteAddress!=='::1')return json(res,403,{code:'LOOPBACK_ONLY'});
  const expectedHost='127.0.0.1:'+server.address()?.port;
  if(req.headers.host!==expectedHost||req.headers['x-forwarded-host']||req.headers['x-forwarded-for']||req.headers['forwarded'])return json(res,403,{code:'LOOPBACK_AUTHORITY_REQUIRED'});
  if(req.headers.origin||req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return json(res,403,{code:'BROWSER_ORIGIN_FORBIDDEN'});
  const pathname=req.url?.split('?')[0];
  if(req.url?.includes('?'))return json(res,400,{code:'QUERY_NOT_SUPPORTED'});
  if(req.method==='GET'&&pathname==='/health')return json(res,200,{status:'ok',mode:'m2-private-reservation',streamVerified:false,gameLaunchEnabled:false});
  const auth=req.headers.authorization;
  const supplied=typeof auth==='string'&&auth.startsWith('Bearer ')?auth.slice(7):'';
  const isAdmin=tokenOk(supplied,adminToken);
  const hostMatch=/^\/internal\/m2\/hosts\/([A-Za-z0-9_-]{3,64})\/heartbeat$/.exec(pathname||'');
  if(hostMatch){
   if(req.method!=='POST')return json(res,405,{code:'METHOD_NOT_ALLOWED'});
   if(req.headers['x-cloudplay-m2-action']!=='1')return json(res,403,{code:'ACTION_HEADER_REQUIRED'});
   try{
    const body=await readJson(req);
    // Authorization happens AFTER reading a bounded body, so token rotation
    // cannot allow an already-in-flight old request to recreate an old heartbeat.
    if(!identities.authenticate('host',hostMatch[1],supplied))return json(res,401,{code:'UNAUTHORIZED'});
    const reply=admission.heartbeat(hostMatch[1],body);return json(res,reply.status,reply);
   }catch(e){return json(res,e.status||400,{code:e.code||'INVALID_BODY'})}
  }
  const collection=/^\/internal\/m2\/(hosts|owners)$/.exec(pathname||'');
  if(collection&&req.method==='POST'){
   if(!isAdmin)return json(res,401,{code:'UNAUTHORIZED'});
   if(req.headers['x-cloudplay-m2-action']!=='1')return json(res,403,{code:'ACTION_HEADER_REQUIRED'});
   try{
    const body=await readJson(req),kind=collection[1]==='hosts'?'host':'owner';
    if(!body||Object.keys(body).length!==1||!Object.hasOwn(body,kind+'Id'))
     return json(res,422,{code:'INVALID_IDENTITY_REQUEST'});
    const result=identities.register(kind,body[kind+'Id']);
    return json(res,result.status,result);
   }catch(e){return json(res,e.status||400,{code:e.code||'INVALID_BODY'})}
  }
  const identityAction=/^\/internal\/m2\/(hosts|owners)\/([A-Za-z0-9_-]{3,80})(\/rotate)?$/.exec(pathname||'');
  if(identityAction&&(req.method==='DELETE'||req.method==='POST')){
   if(!isAdmin)return json(res,401,{code:'UNAUTHORIZED'});
   if(req.headers['x-cloudplay-m2-action']!=='1')return json(res,403,{code:'ACTION_HEADER_REQUIRED'});
   const kind=identityAction[1]==='hosts'?'host':'owner',id=identityAction[2];
   if((req.method==='POST')!==Boolean(identityAction[3]))return json(res,405,{code:'METHOD_NOT_ALLOWED'});
   try{
    const result=req.method==='DELETE'?identities.revoke(kind,id):identities.rotate(kind,id);
    return json(res,result.status,result);
   }catch{return json(res,503,{code:'IDENTITY_CHANGE_INCOMPLETE'})}
  }
  if(req.method==='GET'&&pathname==='/internal/m2/identities'){
   if(!isAdmin)return json(res,401,{code:'UNAUTHORIZED'});
   return json(res,200,identities.list());
  }
  const ownMatch=/^\/internal\/m2\/owners\/([A-Za-z0-9_-]{3,80})\/reservations$/.exec(pathname||'');
  if(req.method==='GET'&&ownMatch){
   if(!isAdmin&&!identities.authenticate('owner',ownMatch[1],supplied))
    return json(res,401,{code:'UNAUTHORIZED'});
   const result=admission.ownerReservations(ownMatch[1]);
   return json(res,result.status,result);
  }
  if(!isAdmin&&pathname==='/internal/m2/status')return json(res,401,{code:'UNAUTHORIZED'});
  if(req.method==='GET'&&pathname==='/internal/m2/status'){
   const r=admission.status();return json(res,r.status,r);
  }
  if(req.method==='POST'&&pathname==='/internal/m2/reservations'){
   if(req.headers['x-cloudplay-m2-action']!=='1')return json(res,403,{code:'ACTION_HEADER_REQUIRED'});
   try{
    const body=await readJson(req);
    if(!isAdmin&&!identities.authenticate('owner',body?.ownerId,supplied))return json(res,401,{code:'UNAUTHORIZED'});
    const reply=admission.reserve(body);return json(res,reply.status,reply);
   }catch(e){return json(res,e.status||400,{code:e.code||'INVALID_BODY'})}
  }
  const renewMatch=/^\/internal\/m2\/reservations\/([0-9a-f-]{36})\/renew$/i.exec(pathname||'');
  if(renewMatch){
   if(req.method!=='POST')return json(res,405,{code:'METHOD_NOT_ALLOWED'});
   if(req.headers['x-cloudplay-m2-action']!=='1')return json(res,403,{code:'ACTION_HEADER_REQUIRED'});
   try{
    const body=await readJson(req);
    if(!isAdmin&&!identities.authenticate('owner',body?.ownerId,supplied))return json(res,401,{code:'UNAUTHORIZED'});
    const reply=admission.renew(renewMatch[1],body);
    return json(res,reply.status,reply);
   }catch(e){return json(res,e.status||400,{code:e.code||'INVALID_BODY'})}
  }
  const releaseMatch=/^\/internal\/m2\/reservations\/([0-9a-f-]{36})$/i.exec(pathname||'');
  if(req.method==='DELETE'&&releaseMatch){
   if(req.headers['x-cloudplay-m2-action']!=='1')return json(res,403,{code:'ACTION_HEADER_REQUIRED'});
   try{
    const body=await readJson(req);
    if(!isAdmin&&!identities.authenticate('owner',body?.ownerId,supplied))return json(res,401,{code:'UNAUTHORIZED'});
    const reply=admission.release(releaseMatch[1],body);return json(res,reply.status,reply);
   }catch(e){return json(res,e.status||400,{code:e.code||'INVALID_BODY'})}
  }
  if(!isAdmin)return json(res,401,{code:'UNAUTHORIZED'});
  return json(res,404,{code:'M2_ROUTE_NOT_FOUND'});
 });
 return {server,admission,identities};
}
