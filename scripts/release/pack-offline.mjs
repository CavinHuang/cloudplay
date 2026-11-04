#!/usr/bin/env node
// CloudPlay: offline distribution assembler. Runs on an ONLINE BUILD MACHINE,
// never silently downloads dependencies. Incomplete bundles fail closed.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inspectWindowsExecutable} from './windows-pe.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const parse = (args) => {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (!k.startsWith('--')) throw new Error(`Unknown positional argument: ${k}`);
    if (['--include-game','--include-sunshine'].includes(k)) {o[k.slice(2)] = true;continue;}
    if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`Missing value for ${k}`);
    o[k.slice(2)] = args[++i];
  }
  return o;
};
export function inspectOptions(opts) {
  if (!['windows-full','windows-p0','docker-web'].includes(opts.mode)) throw new Error('Expected --mode windows-full | windows-p0 | docker-web');
  if (!opts.out) throw new Error('Expected --out <empty-directory>');
  const need=opts.mode==='docker-web'?['image']:['node','node-license','moonlight-server','moonlight-static','moonlight-source'];
  if(opts.mode==='windows-full')need.push('next-standalone','next-static','web-notices');
  for (const key of need) if (!opts[key])throw new Error(`Offline bundle incomplete: --${key} is required for ${opts.mode}`);
  return need;
}
const F = {exists: p => fs.existsSync(p),file: p => fs.statSync(p).isFile(),dir: p => fs.statSync(p).isDirectory()};
function requirePath(p, kind, label) {
  if(!F.exists(p)||!(kind==='file'?F.file(p):F.dir(p)))throw new Error(`${label}: ${kind} does not exist: ${p}`);
}
function assertInside(src, root) { const rel=path.relative(root,src);if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Unexpected traversal'); }
function copyTree(source, dest, {exclude = [], allowNodeModules = false}={}) {
  requirePath(source,'dir','Source directory');
  fs.mkdirSync(dest,{recursive:true});
  for(const entry of fs.readdirSync(source,{withFileTypes:true})) {
    if(exclude.includes(entry.name)||['.git','.env','.env.local','.p0-lab-token','.p0-lab-pids.json','.p0-session-journal.json'].includes(entry.name)||(!allowNodeModules&&entry.name==='node_modules')||(!allowNodeModules&&entry.name==='.next'))continue;
    const from=path.join(source,entry.name),to=path.join(dest,entry.name);
    if(entry.isSymbolicLink())throw new Error(`Symlink not allowed in offline bundle: ${from}`);
    if(entry.isDirectory())copyTree(from,to,{exclude,allowNodeModules});
    else if(entry.isFile()){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
    else throw new Error(`Unsupported asset: ${from}`);
  }
}
function copyFile(src,dst,label){requirePath(src,'file',label);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);}
function listFiles(root,cur=root,out=[]) {
  for(const entry of fs.readdirSync(cur,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const absolute=path.join(cur,entry.name);
    if(entry.isSymbolicLink())throw new Error(`Symlink forbidden: ${absolute}`);
    if(entry.isDirectory())listFiles(root,absolute,out);
    else if(entry.isFile()) {assertInside(absolute,root);out.push(absolute);} else throw new Error(`Unsupported asset: ${absolute}`);
  }
  return out;
}
const hash = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function atomicManifest(out,mode,metadata={}) {
  const files=listFiles(out).filter(f=>path.basename(f)!=='manifest.json').map(f=>({
    path:path.relative(out,f).split(path.sep).join('/'), bytes:fs.statSync(f).size, sha256:hash(f)
  }));
  const manifest={schema:'cloudplay.offline.v1',cloudplayVersion:'0.12.0',mode,createdAt:new Date().toISOString(),
    requiredServices:mode==='docker-web'?['docker-web-image']:mode==='windows-full'?['p0-coordinator','moonlight-web','cloudplay-next-web']:['p0-coordinator','moonlight-web'],
    deploymentNetworkDownloads:false, gameIncluded:!!metadata.game, sunshineInstallerIncluded:!!metadata.sunshine,
    caveats:['GPU display driver and compatible Windows must exist','Sunshine must be installed and paired with Moonlight','Commercial game licenses are not included','No real GPU stream test is implied'],
    provenance:metadata.provenance??{},files};
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
function assembleUnsafe(opts) {
  inspectOptions(opts);
  const out=path.resolve(opts.out);
  if(out===repo||repo.startsWith(out+path.sep))throw new Error('Refusing to overwrite source repository');
  if(fs.existsSync(out) && fs.readdirSync(out).length)throw new Error('Output directory must be empty (safe/no overwrite)');
  fs.mkdirSync(out,{recursive:true});
  const provenance={};
  if(opts.mode==='docker-web') {
    copyFile(opts.image,path.join(out,'images','cloudplay-web.tar'),'Docker image');
    copyTree(path.join(repo,'deploy','docker'),path.join(out,'deploy'));
    copyFile(path.join(repo,'third_party','NOTICE.md'),path.join(out,'THIRD-PARTY-NOTICE.md'),'Notices');
    if(opts['web-notices'])copyFile(opts['web-notices'],path.join(out,'web-DEPENDENCIES.txt'),'Web license notices');
  } else {
    requirePath(opts.node,'file','Windows Node executable');
    requirePath(opts['moonlight-server'],'file','Moonlight Windows executable');
    inspectWindowsExecutable(opts.node);
    inspectWindowsExecutable(opts['moonlight-server']);
    copyFile(opts.node,path.join(out,'runtime','node.exe'),'Windows node.exe');
    copyFile(opts['node-license'],path.join(out,'runtime','NODE-LICENSE.txt'),'Node license');
    copyTree(path.join(repo,'lab'),path.join(out,'services','p0','lab'));
    copyTree(path.join(repo,'lib','lab'),path.join(out,'services','p0','lib','lab'));
    copyFile(path.join(repo,'lib','session-machine.mjs'),path.join(out,'services','p0','lib','session-machine.mjs'),'Session machine');
    copyTree(path.join(repo,'scripts','p0'),path.join(out,'services','p0','scripts','p0'));
    copyTree(path.join(repo,'deploy','windows'),path.join(out,'deploy'));
    copyFile(path.join(repo,'scripts','release','verify-offline.mjs'),path.join(out,'deploy','verify-offline.mjs'),'Integrity verifier');
    copyFile(path.join(repo,'scripts','release','install-offline.mjs'),path.join(out,'deploy','install-offline.mjs'),'Offline release manager');
    copyFile(path.join(repo,'scripts','release','windows-pe.mjs'),path.join(out,'deploy','windows-pe.mjs'),'Windows binary gate');
    copyFile(path.join(repo,'scripts','release','smoke-windows-offline.ps1'),path.join(out,'deploy','smoke-windows-offline.ps1'),'Offline Windows startup smoke');
    copyFile(opts['moonlight-server'],path.join(out,'services','moonlight','web-server.exe'),'Moonlight Windows executable');
    copyTree(opts['moonlight-static'],path.join(out,'services','moonlight','static'));
    // The complete corresponding patched Moonlight source is included in the
    // offline distribution for GPL compliance, not just a binary and patch.
    copyTree(opts['moonlight-source'],path.join(out,'source','moonlight-web'),{exclude:['dist','static','target','.cache']});
    const licence=path.join(out,'source','moonlight-web','LICENSE');
    requirePath(licence,'file','Moonlight license');
    const manifestSource=path.join(out,'source','moonlight-web','web','stream','transport','webrtc.ts');
    requirePath(manifestSource,'file','Patched Moonlight source');
    if(!fs.readFileSync(manifestSource,'utf8').includes('cloudplay'))throw new Error('Moonlight corresponding source must include CloudPlay bridge patch');
    const jsFiles=listFiles(path.join(out,'services','moonlight','static')).filter(p=>/\.js$/i.test(p));
    if(!jsFiles.some(p=>fs.readFileSync(p,'utf8').includes('cloudplay.p0.media.v1')&&fs.readFileSync(p,'utf8').includes('framesDecoded')))throw new Error('Moonlight compiled static assets missing CloudPlay media bridge; refusing non-playable bundle');
    provenance.moonlight={repo:'MrCreativ3001/moonlight-web-stream',upstreamCommit:'7b9821430e07087f459db3db9aac550e1e9c9bff',patchedSourceIncluded:true,compiledBridgeVerified:true};
    if(opts.mode==='windows-full') {
      const standalone=path.resolve(opts['next-standalone']);
      requirePath(path.join(standalone,'server.js'),'file','Next standalone server.js');
      copyTree(standalone,path.join(out,'services','web'),{allowNodeModules:true});
      copyTree(opts['next-static'],path.join(out,'services','web','.next','static'));
      if(!fs.existsSync(path.join(out,'services','web','node_modules')))throw new Error('Next standalone output has no node_modules; check standalone build output');
      if(opts.public)copyTree(opts.public,path.join(out,'services','web','public'));
      copyFile(opts['web-notices'],path.join(out,'source','web-DEPENDENCIES.txt'),'Web dependency notices');
    }
    if(opts['include-game']) {
      if(!opts.game||!opts['game-license'])throw new Error('--include-game requires --game and --game-license (verify redistribution rights)');
      copyTree(opts.game,path.join(out,'games','supertuxkart'));
      copyFile(opts['game-license'],path.join(out,'games','supertuxkart-LICENSE.txt'),'Game license');
    }
    if(opts['include-sunshine']) {
      if(!opts.sunshine||!opts['sunshine-license'])throw new Error('--include-sunshine requires --sunshine and --sunshine-license (review redistribution rights)');
      copyFile(opts.sunshine,path.join(out,'installers',path.basename(opts.sunshine)),'Sunshine installer');
      copyFile(opts['sunshine-license'],path.join(out,'installers','sunshine-LICENSE.txt'),'Sunshine license');
    }
    copyFile(path.join(repo,'third_party','NOTICE.md'),path.join(out,'THIRD-PARTY-NOTICE.md'),'Notices');
    copyFile(path.join(repo,'docs','OFFLINE-DEPLOYMENT.md'),path.join(out,'DEPLOYMENT.md'),'Deployment instructions');
  }
  const sums=listFiles(out).map(f=>`${hash(f)}  ${path.relative(out,f).split(path.sep).join('/')}`).join('\n')+'\n';
  fs.writeFileSync(path.join(out,'SHA256SUMS'),sums);
  return {out,manifest:atomicManifest(out,opts.mode,{provenance,game:opts['include-game'],sunshine:opts['include-sunshine']})};
}
// Only publish a bundle directory after every required component and checksum
// was verified. A failed build never leaves an apparently usable partial bundle.
export function assemble(opts){
  inspectOptions(opts);
  const target=path.resolve(opts.out);
  if(fs.existsSync(target)){
    if(!fs.statSync(target).isDirectory()||fs.readdirSync(target).length)throw new Error('Output directory must be empty (safe/no overwrite)');
    fs.rmdirSync(target);
  }
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const staged=fs.mkdtempSync(path.join(path.dirname(target),`.cloudplay-stage-${process.pid}-`));
  try {
    const result=assembleUnsafe({...opts,out:staged});
    fs.renameSync(staged,target);
    return {...result,out:target};
  }catch(err){fs.rmSync(staged,{recursive:true,force:true});throw err;}
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const {out,manifest}=assemble(parse(process.argv.slice(2)));console.log(`Created ${manifest.mode} offline bundle at ${out}: ${manifest.files.length} files`);}catch(e){console.error('OFFLINE PACK ERROR:',e.message);process.exitCode=1;}
}
