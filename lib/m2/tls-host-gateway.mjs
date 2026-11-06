/**
 * Explicitly opt-in M2 PRIVATE mTLS host ingress.
 * The existing admission coordinator remains on 127.0.0.1 only.
 *
 * A client certificate issued by the pinned host CA AND the host's separate
 * Bearer token are required. A certificate CN must match the route's hostId.
 * Only the four host-process routes may be proxied to the private coordinator.
 * No owner/admin/public-session route, WebSocket or game stream is forwarded.
 */
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';

const HOST_ID=/^[A-Za-z0-9_-]{3,64}$/;
const HOST_ROUTE=/^\/internal\/m2\/hosts\/([A-Za-z0-9_-]{3,64})\/(connect|heartbeat|sync|ack)$/;
const TOKEN=/^Bearer [A-Za-z0-9._~+\/=-]{32,256}$/;
const MAX_BODY=4096;
const MAX_REPLY=16384;
const headers={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const fail=(res,status,code)=>{
 if(res.headersSent){res.destroy();return}
 res.writeHead(status,headers);res.end(JSON.stringify({code})+'\n');
};
export function isPrivateGatewayAddress(ip){
 if(net.isIP(ip)!==4)return false;
 const v=ip.split('.').map(Number);
 return v[0]===127||v[0]===10||(v[0]===172&&v[1]>=16&&v[1]<=31)||
   (v[0]===192&&v[1]===168);
}
export function createM2TlsGateway({bindHost,controlPort=7790,key,cert,clientCa}={}){
 if(!isPrivateGatewayAddress(bindHost)||!Number.isInteger(controlPort)||
   controlPort<1024||controlPort>65535||!key||!cert||!clientCa)
   throw Error('M2_TLS_GATEWAY_CONFIG_REQUIRED');
 const server=https.createServer({
  key,cert,ca:clientCa,requestCert:true,rejectUnauthorized:true,
  minVersion:'TLSv1.3',maxVersion:'TLSv1.3',
  honorCipherOrder:true,
 },async(req,res)=>{
  if(!req.socket.authorized)return fail(res,401,'CLIENT_CERT_REQUIRED');
  if(req.method!=='POST'||req.url?.includes('?')||req.url?.includes('#'))
   return fail(res,404,'M2_GATEWAY_HOST_ROUTE_ONLY');
  const match=HOST_ROUTE.exec(req.url||'');
  if(!match)return fail(res,404,'M2_GATEWAY_HOST_ROUTE_ONLY');
  const hostId=match[1];
  const certName=req.socket.getPeerCertificate()?.subject?.CN;
  if(typeof certName!=='string'||certName!==hostId||!HOST_ID.test(certName))
   return fail(res,403,'M2_GATEWAY_CERT_ID_MISMATCH');
  if(typeof req.headers.authorization!=='string'||!TOKEN.test(req.headers.authorization))
   return fail(res,401,'HOST_BEARER_REQUIRED');
  if(req.headers['x-cloudplay-m2-action']!=='1'||
    req.headers['content-type']?.toLowerCase().split(';')[0].trim()!=='application/json')
   return fail(res,415,'M2_GATEWAY_JSON_ACTION_REQUIRED');
  if(req.headers.origin||req.headers['x-forwarded-for']||req.headers.forwarded||
    req.headers['x-forwarded-host'])
   return fail(res,403,'M2_GATEWAY_PROXY_OR_ORIGIN_FORBIDDEN');
  if(Number(req.headers['content-length']||0)>MAX_BODY)
   return fail(res,413,'M2_GATEWAY_BODY_TOO_LARGE');
  let body;
  try{
   const chunks=[];let total=0;
   for await(const chunk of req){
    total+=chunk.length;
    if(total>MAX_BODY)throw Error('BODY_TOO_LARGE');
    chunks.push(chunk);
   }
   body=Buffer.concat(chunks);
   const parsed=JSON.parse(body.toString('utf8'));
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return fail(res,422,'INVALID_BODY');
  }catch(e){return fail(res,e.message==='BODY_TOO_LARGE'?413:400,'INVALID_JSON_OR_SIZE')}
  // Fixed localhost authority and a tiny safe header allowlist. Never pass
  // client-supplied Host/Origin/proxy headers or arbitrary request paths.
  const forwarded=http.request({
   hostname:'127.0.0.1',port:controlPort,path:req.url,method:'POST',
   headers:{'Content-Type':'application/json','Content-Length':body.length,
    'Authorization':req.headers.authorization,'X-CloudPlay-M2-Action':'1'},
   timeout:2000,
  },upstream=>{
   const chunks=[];let size=0;
   upstream.on('data',piece=>{
    size+=piece.length;
    if(size>MAX_REPLY){upstream.destroy(Error('UPSTREAM_REPLY_TOO_LARGE'));return}
    chunks.push(piece);
   });
   upstream.on('end',()=>{
    if(res.writableEnded||res.destroyed)return;
    const out=Buffer.concat(chunks);
    if(!Number.isInteger(upstream.statusCode)||upstream.statusCode<100||upstream.statusCode>599)
     return fail(res,502,'M2_UPSTREAM_INVALID_STATUS');
    if(!upstream.headers['content-type']?.startsWith('application/json'))
     return fail(res,502,'M2_UPSTREAM_NOT_JSON');
    res.writeHead(upstream.statusCode,headers);res.end(out);
   });
   upstream.on('error',()=>fail(res,502,'M2_UPSTREAM_UNAVAILABLE'));
  });
  forwarded.on('error',()=>fail(res,502,'M2_UPSTREAM_UNAVAILABLE'));
  forwarded.on('timeout',()=>forwarded.destroy(Error('M2_UPSTREAM_TIMEOUT')));
  forwarded.end(body);
 });
 server.on('tlsClientError',()=>{/* Do not log certificates or credentials. */});
 return server;
}
