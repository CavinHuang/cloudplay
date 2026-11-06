import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readM2TlsFile} from '../scripts/m2/start-tls-gateway.mjs';
const script=fileURLToPath(new URL('../scripts/m2/start-tls-gateway.mjs',import.meta.url));

test('TLS certificate loading fails closed on nonabsolute paths, symlinks and absent data',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cloudplay-m2-tls-config-'));
 try{
  const cert=path.join(dir,'client.crt');
  fs.writeFileSync(cert,'a'.repeat(200));
  assert.equal(readM2TlsFile(cert).length,200);
  assert.throws(()=>readM2TlsFile('relative/cert.crt'),/M2_TLS_ABSOLUTE_CERT_PATH_REQUIRED/);
  assert.throws(()=>readM2TlsFile(undefined),/M2_TLS_ABSOLUTE_CERT_PATH_REQUIRED/);
  assert.throws(()=>readM2TlsFile(path.join(dir,'missing.crt')));
  fs.writeFileSync(path.join(dir,'empty.crt'),'');
  assert.throws(()=>readM2TlsFile(path.join(dir,'empty.crt')),/M2_TLS_CERT_FILE_INVALID/);
  const symlink=path.join(dir,'linked.crt');
  try{
   fs.symlinkSync(cert,symlink);
   assert.throws(()=>readM2TlsFile(symlink),/M2_TLS_CERT_FILE_INVALID/);
  }catch(e){if(e.code!=='EPERM'&&e.code!=='EACCES')throw e}
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('gateway startup remains opt-in and never binds a wildcard address',()=>{
 const noOpt=spawnSync(process.execPath,[script],{
  env:{...process.env,CLOUDPLAY_M2_TLS_GATEWAY_ENABLE:'0'},encoding:'utf8',timeout:3000});
 assert.notEqual(noOpt.status,0);
 assert.match(noOpt.stderr,/M2_TLS_GATEWAY_EXPLICIT_OPT_IN_REQUIRED/);
 const publicBind=spawnSync(process.execPath,[script],{
  env:{...process.env,CLOUDPLAY_M2_TLS_GATEWAY_ENABLE:'1',CLOUDPLAY_M2_TLS_BIND:'0.0.0.0'},
  encoding:'utf8',timeout:3000});
 assert.notEqual(publicBind.status,0);
 assert.match(publicBind.stderr,/M2_TLS_PRIVATE_IPV4_BIND_REQUIRED/);
});
