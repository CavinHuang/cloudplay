#!/usr/bin/env node
import {readFileSync,statSync,existsSync,readdirSync,lstatSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectWindowsExecutable} from './windows-pe.mjs';
import {fileURLToPath} from 'node:url';

export function verify(root){
 root=resolve(root);
 const path=join(root,'manifest.json');
 if(!existsSync(path))throw new Error('manifest.json missing');
 const m=JSON.parse(readFileSync(path,'utf8'));
 if(m.schema!=='cloudplay.offline.v1'||m.deploymentNetworkDownloads!==false)throw new Error('Unsupported or incomplete offline manifest');
 if(!['windows-p0','windows-full','docker-web'].includes(m.mode))throw new Error('Invalid offline release mode');
 const required=m.mode==='docker-web'?
   ['images/cloudplay-web.tar','deploy/docker-compose.yaml','deploy/load-and-run.sh','THIRD-PARTY-NOTICE.md']:
   ['runtime/node.exe','runtime/NODE-LICENSE.txt','services/moonlight/web-server.exe',
    'services/p0/lab/coordinator.mjs','services/p0/lab/agent.mjs',
    'source/moonlight-web/LICENSE','source/moonlight-web/web/stream/transport/webrtc.ts',
    'deploy/start-cloudplay.ps1','deploy/stop-cloudplay.ps1','deploy/install-offline.mjs',
    'deploy/verify-offline.mjs','deploy/smoke-windows-offline.ps1','deploy/smoke-windows-services.ps1','deploy/smoke-windows-installed-runtime.ps1','deploy/smoke-windows-local-operator.ps1','deploy/install-cloudplay.ps1',
    'deploy/start-active.ps1','deploy/stop-active.ps1','deploy/m1-accept.ps1','deploy/smoke-m2-offline.mjs','THIRD-PARTY-NOTICE.md',
    'M1-ACCEPTANCE.md','LOCAL-QUICK-PLAY.md',
    'services/p0/lib/lab/m1-acceptance.mjs',
    'services/p0/scripts/p0/m1-host-preflight.ps1',
    'services/p0/scripts/p0/create-m1-index.mjs',
    'services/p0/scripts/p0/verify-m1-acceptance.mjs',
    'services/m2/lib/m2/admission.mjs',
    'services/m2/lib/m2/identities.mjs',
    'services/m2/lib/m2/host-bridge.mjs',
    'services/m2/lab/m2-coordinator.mjs',
    'services/m2/scripts/m2/start-control.mjs',
    'services/m2/scripts/m2/bridge-local-p0.mjs',
    'M2-CONTROL-PLANE.md'];
 if(m.mode==='windows-full')required.push('services/web/server.js','source/web-DEPENDENCIES.txt');
 const declared=new Set(m.files.map(x=>x.path));
 for(const filename of required)if(!declared.has(filename))throw new Error(`Offline release missing required component: ${filename}`);
 const found=new Set();
 const bad=[];
 for(const f of m.files){
   if(typeof f.path!=='string'||!f.path||f.path.includes('\\')||f.path.split('/').includes('..')||isAbsolute(f.path))throw new Error('Manifest traversal detected');
   if(found.has(f.path))throw new Error('Duplicate manifest entry');found.add(f.path);
   const target=resolve(root,f.path);
   if(!target.startsWith(root+sep)||!existsSync(target)||lstatSync(target).isSymbolicLink()||!statSync(target).isFile()){bad.push(`${f.path}: absent or unsafe`);continue;}
   if(statSync(target).size!==f.bytes||createHash('sha256').update(readFileSync(target)).digest('hex')!==f.sha256)bad.push(`${f.path}: integrity mismatch`);
 }
 const walk=(dir)=>{for(const n of readdirSync(dir,{withFileTypes:true})){
   const p=join(dir,n.name), rel=relative(root,p).split(sep).join('/');
   if(n.isSymbolicLink())throw new Error(`Unexpected symlink ${rel}`);
   if(n.isDirectory())walk(p);else if(n.isFile()&&rel!=='manifest.json'&&!found.has(rel))bad.push(`${rel}: not declared in manifest`);
 }};
 walk(root);
 if(bad.length)throw new Error(bad.slice(0,10).join('\n'));
 if(m.mode.startsWith('windows-')){
   inspectWindowsExecutable(join(root,'runtime','node.exe'));
   inspectWindowsExecutable(join(root,'services','moonlight','web-server.exe'));
   const files=Array.from(found);
   if(!files.some(x=>x.startsWith('services/moonlight/static/')&&x.endsWith('.js')))
     throw new Error('Missing compiled Moonlight browser JS');
   if(m.mode==='windows-full'&&!files.some(x=>x.startsWith('services/web/node_modules/')))
     throw new Error('Missing Next standalone bundled dependencies');
 }

 return {mode:m.mode,files:found.size,networkDownloads:m.deploymentNetworkDownloads};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=verify(process.argv[2]||'');console.log('OFFLINE BUNDLE VERIFIED',JSON.stringify(result))}catch(e){console.error('OFFLINE VERIFY FAILED:',e.message);process.exitCode=1;}
}
