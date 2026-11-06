/**
 * Host-side HTTPS+mutual TLS adapter for the existing P0 -> M2 bridge.
 * Only M2 host-process routes are allowed over the remote channel.
 * P0 /internal/status is always queried from the LOCAL game host.
 */
import https from 'node:https';
import {isPrivateGatewayAddress} from './tls-host-gateway.mjs';

const HOST_ROUTE=/^\/internal\/m2\/hosts\/[A-Za-z0-9_-]{3,64}\/(connect|heartbeat|sync|ack)$/;
const MAX_BODY=4096,MAX_REPLY=16384;

export function createHostGatewayFetcher({gatewayUrl,clientCert,clientKey,serverCa,
 coordinatorPort=7790,baseFetch=fetch}={}){
 let endpoint;
 try{endpoint=new URL(gatewayUrl)}catch{throw Error('M2_REMOTE_TLS_URL_REQUIRED')}
 if(endpoint.protocol!=='https:'||!isPrivateGatewayAddress(endpoint.hostname)||
   !endpoint.port||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||
   endpoint.pathname!=='/'||!Number.isInteger(Number(endpoint.port))||
   Number(endpoint.port)<1024||Number(endpoint.port)>65535)
   throw Error('M2_REMOTE_PRIVATE_HTTPS_ENDPOINT_REQUIRED');
 if(!clientCert||!clientKey||!serverCa||
   !Number.isInteger(coordinatorPort)||coordinatorPort<1024||coordinatorPort>65535)
   throw Error('M2_REMOTE_TLS_CERTIFICATES_REQUIRED');
 const origin='http://127.0.0.1:'+coordinatorPort;
 const remote=new URL(endpoint.href);
 return async(url,options={})=>{
  // The local P0 host status MUST never leave the game host, even over TLS.
  if(typeof url==='string'&&url.startsWith('http://127.0.0.1:')&&
    new URL(url).pathname==='/internal/status')return baseFetch(url,options);
  let source;
  try{source=new URL(url)}catch{throw Error('M2_REMOTE_UNEXPECTED_TARGET')}
  if(source.origin!==origin||source.search||source.hash||!HOST_ROUTE.test(source.pathname)||
    options.method!=='POST'||typeof options.body!=='string'||
    Buffer.byteLength(options.body)>MAX_BODY)
   throw Error('M2_REMOTE_UNEXPECTED_TARGET');
  const hdr=options.headers||{};
  if(typeof hdr.Authorization!=='string'||!hdr.Authorization.startsWith('Bearer ')||
    hdr['X-CloudPlay-M2-Action']!=='1'||hdr['Content-Type']!=='application/json')
   throw Error('M2_REMOTE_INVALID_REQUEST');
  remote.pathname=source.pathname;
  return new Promise((resolve,reject)=>{
   const req=https.request(remote,{
    method:'POST',cert:clientCert,key:clientKey,ca:serverCa,
    rejectUnauthorized:true,minVersion:'TLSv1.3',maxVersion:'TLSv1.3',
    headers:{Authorization:hdr.Authorization,'X-CloudPlay-M2-Action':'1',
     'Content-Type':'application/json','Content-Length':Buffer.byteLength(options.body)},
    timeout:2500,
    signal:options.signal,
   },res=>{
    const chunks=[];let size=0;
    res.on('data',chunk=>{
     size+=chunk.length;
     if(size>MAX_REPLY){res.destroy(Error('M2_REMOTE_REPLY_TOO_LARGE'));return}
     chunks.push(chunk);
    });
    res.on('end',()=>{
     if(res.statusCode<100||res.statusCode>599||
       !res.headers['content-type']?.startsWith('application/json'))
      return reject(Error('M2_REMOTE_INVALID_RESPONSE'));
     resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,
      headers:{'Content-Type':'application/json'}}));
    });
    res.on('error',reject);
   });
   req.on('timeout',()=>req.destroy(Error('M2_REMOTE_TLS_TIMEOUT')));
   req.on('error',reject);
   req.end(options.body);
  });
 };
}
