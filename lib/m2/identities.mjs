/**
 * Private, operator-issued M2 identities. Secrets are returned ONCE on
 * register/rotate; only SHA-256 digests of 256-bit random tokens are persisted.
 * This is deliberately localhost-only administration, NOT public user signup.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';

const HOST=/^[A-Za-z0-9_-]{3,64}$/;
const OWNER=/^[A-Za-z0-9_-]{3,80}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const SCHEMA='cloudplay.m2.identities.v1';
const LIMITS={host:32,owner:128};
const valid=(kind,id)=>typeof id==='string'&&(kind==='host'?HOST.test(id):kind==='owner'?OWNER.test(id):false);
const key=(kind,id)=>kind+':'+id;
const hash=(kind,secret)=>createHash('sha256').update(kind+':'+secret).digest('hex');
const same=(a,b)=>timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(o,keys)=>isObj(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const reply=(status,code)=>({status,code});

export function createIdentityRegistry({statePath=null,legacyHostTokens={},clock=Date.now,onDisable=()=>{}}={}){
 if(statePath&&(!path.isAbsolute(statePath)||path.basename(statePath)!=='m2-identities.json'))
  throw Error('M2_INVALID_IDENTITIES_PATH');
 if(!isObj(legacyHostTokens)||Object.keys(legacyHostTokens).some(id=>!valid('host',id)))
  throw Error('M2_INVALID_LEGACY_HOSTS');
 const entries=new Map();
 const load=()=>{
  if(!statePath)return;
  let data;
  try{
   const stat=fs.lstatSync(statePath);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size<2||stat.size>100000)
    throw Error('M2_INVALID_IDENTITIES_FILE');
   data=JSON.parse(fs.readFileSync(statePath,'utf8'));
  }catch(e){if(e.code==='ENOENT')return;throw Error('M2_IDENTITIES_READ_FAILED')}
  if(!exact(data,['schema','entries'])||data.schema!==SCHEMA||!Array.isArray(data.entries)||
    data.entries.length>LIMITS.host+LIMITS.owner)throw Error('M2_INVALID_IDENTITIES_JOURNAL');
  const counts={host:0,owner:0};
  for(const e of data.entries){
   if(!exact(e,['kind','id','hash','createdAt'])||!valid(e.kind,e.id)||!DIGEST.test(e.hash)||
     !Number.isSafeInteger(e.createdAt)||e.createdAt<0||entries.has(key(e.kind,e.id))||
     (e.kind==='host'&&Object.hasOwn(legacyHostTokens,e.id)))throw Error('M2_INVALID_IDENTITIES_JOURNAL');
   if(++counts[e.kind]>LIMITS[e.kind])throw Error('M2_INVALID_IDENTITIES_JOURNAL');
   entries.set(key(e.kind,e.id),e);
  }
 };
 const persist=next=>{
  if(!statePath)return;
  const root=path.dirname(statePath);
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const tmp=path.join(root,'.m2-identities-'+randomUUID()+'.tmp');
  try{
   fs.writeFileSync(tmp,JSON.stringify({schema:SCHEMA,entries:[...next.values()]})+'\n',{flag:'wx',mode:0o600});
   fs.renameSync(tmp,statePath);
  }finally{try{fs.unlinkSync(tmp)}catch(e){if(e.code!=='ENOENT')throw e}}
 };
 load();
 const counts=kind=>[...entries.values()].filter(e=>e.kind===kind).length;
 const list=()=>({hosts:[...entries.values()].filter(e=>e.kind==='host').map(e=>({id:e.id,createdAt:e.createdAt})),
  owners:[...entries.values()].filter(e=>e.kind==='owner').map(e=>({id:e.id,createdAt:e.createdAt})),
  legacyHostIds:Object.keys(legacyHostTokens).sort()});
 function issue(kind,id,rotation=false){
  if(!valid(kind,id))return reply(422,'INVALID_IDENTITY_ID');
  if(kind==='host'&&Object.hasOwn(legacyHostTokens,id))return reply(409,'LEGACY_HOST_CONFIGURED');
  const old=entries.get(key(kind,id));
  if(rotation?!old:!!old)return reply(rotation?404:409,rotation?'IDENTITY_NOT_FOUND':'IDENTITY_EXISTS');
  if(!rotation&&counts(kind)>=LIMITS[kind])return reply(409,'IDENTITY_LIMIT_REACHED');
  const secret=randomBytes(32).toString('hex');
  const next=new Map(entries);
  next.set(key(kind,id),{kind,id,hash:hash(kind,secret),createdAt:old?.createdAt??clock()});
  try{persist(next)}catch{return reply(503,'IDENTITIES_PERSIST_FAILED')}
  entries.clear();for(const [k,v] of next)entries.set(k,v);
  if(rotation){onDisable(kind,id,kind==='host'?'HOST_CREDENTIAL_CHANGED':'OWNER_CREDENTIAL_CHANGED');}
  return {status:rotation?200:201,kind,id,token:secret,
   note:'Copy the token once into a private secret store. It will never be returned again.'};
 }
 function revoke(kind,id){
  if(!valid(kind,id))return reply(422,'INVALID_IDENTITY_ID');
  if(!entries.has(key(kind,id)))return reply(404,'IDENTITY_NOT_FOUND');
  const next=new Map(entries);next.delete(key(kind,id));
  try{persist(next)}catch{return reply(503,'IDENTITIES_PERSIST_FAILED')}
  entries.delete(key(kind,id));
  onDisable(kind,id,kind==='host'?'HOST_REVOKED':'OWNER_REVOKED');
  return {status:200,kind,id,revoked:true};
 }
 function authenticate(kind,id,token){
  if(!valid(kind,id)||typeof token!=='string')return false;
  if(kind==='host'&&Object.hasOwn(legacyHostTokens,id)){
   const expected=legacyHostTokens[id];
   if(typeof expected!=='string'||expected.length<32)return false;
   const a=Buffer.from(token),b=Buffer.from(expected);
   return a.length===b.length&&timingSafeEqual(a,b);
  }
  const found=entries.get(key(kind,id));
  return Boolean(found&&DIGEST.test(token)&&same(hash(kind,token),found.hash));
 }
 return {register:(kind,id)=>issue(kind,id,false),rotate:(kind,id)=>issue(kind,id,true),
  revoke,authenticate,list};
}
