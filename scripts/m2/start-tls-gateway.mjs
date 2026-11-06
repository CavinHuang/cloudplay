#!/usr/bin/env node
/**
 * Optional private host ingress, not a reverse proxy for the player website.
 * Provision server and per-host client certificates outside the release.
 * Do not bind to a public/wildcard interface.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createM2TlsGateway,isPrivateGatewayAddress} from '../../lib/m2/tls-host-gateway.mjs';

export function readM2TlsFile(filename){
 if(typeof filename!=='string'||!path.isAbsolute(filename))throw Error('M2_TLS_ABSOLUTE_CERT_PATH_REQUIRED');
 const info=fs.lstatSync(filename);
 if(!info.isFile()||info.isSymbolicLink()||info.size<100||info.size>131072)
  throw Error('M2_TLS_CERT_FILE_INVALID');
 return fs.readFileSync(filename);
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
 try{
  if(process.env.CLOUDPLAY_M2_TLS_GATEWAY_ENABLE!=='1')
   throw Error('M2_TLS_GATEWAY_EXPLICIT_OPT_IN_REQUIRED');
  const bindHost=process.env.CLOUDPLAY_M2_TLS_BIND;
  if(!isPrivateGatewayAddress(bindHost))throw Error('M2_TLS_PRIVATE_IPV4_BIND_REQUIRED');
  const port=Number(process.env.CLOUDPLAY_M2_TLS_PORT||7791);
  const controlPort=Number(process.env.CLOUDPLAY_M2_PORT||7790);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('M2_TLS_PORT_INVALID');
  const server=createM2TlsGateway({
   bindHost,controlPort,
   cert:readM2TlsFile(process.env.CLOUDPLAY_M2_TLS_SERVER_CERT),
   key:readM2TlsFile(process.env.CLOUDPLAY_M2_TLS_SERVER_KEY),
   clientCa:readM2TlsFile(process.env.CLOUDPLAY_M2_TLS_CLIENT_CA)
  });
  server.on('error',err=>{console.error('M2 TLS gateway bind failed:',err.code||'UNKNOWN');process.exitCode=1});
  server.listen(port,bindHost,()=>{
   console.log('CloudPlay M2 mTLS HOST-ONLY private gateway active. No admin, public or stream routes exposed.');
  });
 }catch(e){console.error('M2 TLS gateway disabled:',e.message);process.exitCode=1}
}
