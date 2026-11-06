import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {execFileSync,spawnSync} from 'node:child_process';
import {createM2Coordinator} from '../lab/m2-coordinator.mjs';
import {createM2TlsGateway,isPrivateGatewayAddress} from '../lib/m2/tls-host-gateway.mjs';
import {createHostGatewayFetcher} from '../lib/m2/tls-host-client.mjs';
import {sendP0Heartbeat,syncHostReservation} from '../lib/m2/host-bridge.mjs';
const hasOpenSSL=spawnSync('openssl',['version'],{stdio:'ignore'}).status===0;
const admin='A'.repeat(48),keyA='H'.repeat(48),keyB='J'.repeat(48);
const good={connected:true,hosts:[{infrastructureReady:true,gpu:{detected:true,model:'PRIVATE_MODEL'},
 sunshinePortOpen:true,webStreamPortOpen:true,gameFilePresent:true}],sessions:[]};
async function listen(server){await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));return server.address().port}
async function close(server){await new Promise(resolve=>server.close(resolve))}
const req=(url,route,key,method='POST',body,headers={})=>fetch(url+route,{method,
 headers:{Authorization:'Bearer '+key,'X-CloudPlay-M2-Action':'1','Content-Type':'application/json',...headers},
 ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(3500)});
function certificates(dir){
 const run=(...args)=>execFileSync('openssl',args,{cwd:dir,stdio:'ignore',timeout:15000});
 run('req','-x509','-newkey','rsa:2048','-nodes','-sha256','-keyout','ca.key',
  '-out','ca.crt','-days','2','-subj','/CN=CloudPlay-Test-Only-CA',
  '-addext','basicConstraints=critical,CA:TRUE');
 const make=(name,cn,type)=>{
  run('req','-newkey','rsa:2048','-nodes','-sha256','-keyout',name+'.key',
   '-out',name+'.csr','-subj','/CN='+cn);
  fs.writeFileSync(path.join(dir,name+'.ext'),
   type==='server'?'subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n':
     'extendedKeyUsage=clientAuth\n');
  run('x509','-req','-in',name+'.csr','-CA','ca.crt','-CAkey','ca.key',
   '-CAcreateserial','-out',name+'.crt','-days','2','-sha256','-extfile',name+'.ext');
 };
 make('server','127.0.0.1','server');make('alpha','hostAlpha','client');
 make('beta','hostBeta','client');
 const read=n=>fs.readFileSync(path.join(dir,n));
 return {serverCert:read('server.crt'),serverKey:read('server.key'),ca:read('ca.crt'),
  clientA:read('alpha.crt'),clientKeyA:read('alpha.key'),
  clientB:read('beta.crt'),clientKeyB:read('beta.key')};
}

test('TLS gateway explicitly rejects public/wildcard binds and untrusted transport URLs',()=>{
 for(const ip of ['0.0.0.0','8.8.8.8','169.254.0.1','::','127.0.0.1.evil','localhost'])
  assert.equal(isPrivateGatewayAddress(ip),false);
 for(const ip of ['127.0.0.1','10.1.2.3','172.16.2.3','172.31.255.5','192.168.20.10'])
  assert.equal(isPrivateGatewayAddress(ip),true);
 assert.throws(()=>createM2TlsGateway({bindHost:'0.0.0.0',key:'a',cert:'b',clientCa:'c'}),
  /M2_TLS_GATEWAY_CONFIG_REQUIRED/);
 const inputs=['http://10.0.0.1:7791/','https://8.8.8.8:7791/',
  'https://0.0.0.0:7791/','https://10.0.0.1:7791/admin','https://10.0.0.1:7791/?token=abc'];
 for(const gatewayUrl of inputs)assert.throws(()=>createHostGatewayFetcher({
  gatewayUrl,clientCert:'a',clientKey:'b',serverCa:'c'}),/M2_REMOTE_PRIVATE_HTTPS_ENDPOINT_REQUIRED/);
});

test('real TLS1.3 mutual-auth gateway forwards ONLY host endpoints and P0 bridge stays local', {skip:!hasOpenSSL},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cloudplay-m2-mtls-test-'));
 let app,gateway;
 try{
  const keys=certificates(dir);
  app=createM2Coordinator({adminToken:admin,hostTokens:{hostAlpha:keyA,hostBeta:keyB},
   enabledGames:['supertuxkart']});
  const controlPort=await listen(app.server);
  gateway=createM2TlsGateway({bindHost:'127.0.0.1',controlPort,
   key:keys.serverKey,cert:keys.serverCert,clientCa:keys.ca});
  const remotePort=await listen(gateway);
  const gatewayUrl='https://127.0.0.1:'+remotePort+'/';
  let p0Reads=0;
  const fetcher=createHostGatewayFetcher({gatewayUrl,clientCert:keys.clientA,
   clientKey:keys.clientKeyA,serverCa:keys.ca,coordinatorPort:controlPort,
   baseFetch:async(url)=>{
    assert.equal(url,'http://127.0.0.1:7788/internal/status');
    p0Reads++;
    return {ok:true,json:async()=>good};
   }});
  const conn={};
  const report=await sendP0Heartbeat({hostId:'hostAlpha',labToken:'L'.repeat(48),
   m2HostToken:keyA,m2Port:controlPort,connection:conn,fetcher});
  assert.equal(report.accepted,true);
  assert.equal(p0Reads,1);
  assert.equal((await syncHostReservation({hostId:'hostAlpha',m2HostToken:keyA,
   m2Port:controlPort,connection:conn,fetcher})).assigned,false);
  const control='http://127.0.0.1:'+controlPort;
  const booked=await req(control,'/internal/m2/reservations',admin,'POST',
   {ownerId:'operator01',gameId:'supertuxkart',idempotencyKey:'mtls-bridge-test-001'});
  assert.equal(booked.status,201);
  const ticket=(await booked.json()).reservation;
  assert.equal(ticket.hostId,'hostAlpha');
  assert.deepEqual(await syncHostReservation({hostId:'hostAlpha',m2HostToken:keyA,
   m2Port:controlPort,connection:conn,fetcher}),{
    assigned:true,acknowledged:true,streamVerified:false
  });
  // The remote client may not escape its private host endpoint allowlist.
  await assert.rejects(()=>fetcher(control+'/internal/m2/reservations',
   {method:'POST',headers:{Authorization:'Bearer '+admin,'X-CloudPlay-M2-Action':'1',
    'Content-Type':'application/json'},body:'{}'}),/M2_REMOTE_UNEXPECTED_TARGET/);
  const httpsCall=(route,{cert=keys.clientA,key=keys.clientKeyA,
   token=keyA,body={},headers={}}={})=>new Promise((resolve,reject)=>{
   const raw=JSON.stringify(body);
   const request=https.request(gatewayUrl.slice(0,-1)+route,{
    method:'POST',cert,key,ca:keys.ca,rejectUnauthorized:true,minVersion:'TLSv1.3',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',
     'X-CloudPlay-M2-Action':'1',...headers}
   },res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));
     res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}))});
   request.on('error',reject);request.end(raw);
  });
  assert.equal((await httpsCall('/internal/m2/hosts/hostBeta/connect',
   {token:keyB,body:{protocol:'cloudplay.m2.host-connection.v1'}})).status,403);
  assert.equal((await httpsCall('/internal/m2/owners')).status,404);
  assert.equal((await httpsCall('/internal/m2/status')).status,404);
  assert.equal((await httpsCall('/internal/m2/hosts/hostAlpha/connect',{token:'bad'})).status,401);
  assert.equal((await httpsCall('/internal/m2/hosts/hostAlpha/connect',
   {headers:{Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await httpsCall('/internal/m2/hosts/hostAlpha/connect',
   {headers:{'X-Forwarded-Host':'public.example'}})).status,403);
  assert.equal((await httpsCall('/internal/m2/hosts/hostAlpha/connect?surprise=1')).status,404);
  // Client certificate AND matching host credential are both required.
  await assert.rejects(()=>new Promise((resolve,reject)=>{
   const request=https.request(gatewayUrl+'internal/m2/hosts/hostAlpha/connect',{
    method:'POST',ca:keys.ca,rejectUnauthorized:true,timeout:1200
   },res=>resolve(res.statusCode));
   request.on('error',reject);request.end();
  }));
  await assert.rejects(()=>createHostGatewayFetcher({gatewayUrl,
   clientCert:keys.clientA,clientKey:keys.clientKeyA,serverCa:keys.clientA,
   coordinatorPort:controlPort})(control+'/internal/m2/hosts/hostAlpha/sync',{
    method:'POST',body:JSON.stringify({connectionId:conn.connectionId,sequence:99}),
    headers:{Authorization:'Bearer '+keyA,'X-CloudPlay-M2-Action':'1','Content-Type':'application/json'}
   }));
  const status=await (await req(control,'/internal/m2/status',admin,'GET')).json();
  assert.equal(status.reservations.length,1);
  assert.equal(status.reservations[0].state,'reserved');
 }finally{
  if(gateway)await close(gateway);
  if(app)await close(app.server);
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
