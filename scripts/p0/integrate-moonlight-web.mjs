#!/usr/bin/env node
import {readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Audited against the indexed Moonlight Web `master` source as of 2026-11-04.
// The exact upstream commit is required: never patch an unreviewed release.
export const PINNED_UPSTREAM = '7b9821430e07087f459db3db9aac550e1e9c9bff';
const SOURCE = 'web/stream/transport/webrtc.ts';
const TELEMETRY_FILE = 'web/stream/transport/cloudplay-p0-telemetry.ts';
const IMPORT = 'import { attachCloudPlayP0Telemetry } from "./cloudplay-p0-telemetry"';

export function patchUpstream(source) {
  if(source.includes(IMPORT)) {
    const required=['private cloudPlayP0Telemetry: { dispose(): void } | null = null',
      'this.cloudPlayP0Telemetry = attachCloudPlayP0Telemetry(this.peer)',
      'this.cloudPlayP0Telemetry?.dispose()'];
    if(!required.every(text=>source.includes(text)))throw new Error('PARTIALLY_PATCHED_UPSTREAM_SOURCE');
    return {code:source,changed:false};
  }
  const anchors = [
    ['import { Api, fetchApi, WebRTCAnswer } from "../../api"', s=>`${s}\n${IMPORT}`],
    ['    private peer: RTCPeerConnection', s=>`${s}\n    private cloudPlayP0Telemetry: { dispose(): void } | null = null`],
    ['        this.peer = new RTCPeerConnection(configuration)',s=>`${s}\n        this.cloudPlayP0Telemetry = attachCloudPlayP0Telemetry(this.peer)`],
    ['    async close(): Promise<void> {',s=>`${s}\n        this.cloudPlayP0Telemetry?.dispose()`],
  ];
  for(const [anchor] of anchors)if(source.split(anchor).length !== 2)throw new Error(`UNSUPPORTED_UPSTREAM_SOURCE: ${anchor}`);
  let output=source;for(const [anchor,replace] of anchors)output=output.replace(anchor,replace(anchor));
  return {code:output,changed:true};
}

export function installMoonlightBridge(repoDir,{dryRun=false}={}) {
  const root=resolve(repoDir);
  const file=join(root,SOURCE);
  if(!existsSync(join(root,'.git'))||!existsSync(file))throw new Error('NOT_A_MOONLIGHT_WEB_CHECKOUT');
  let rev;
  try{rev=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();}
  catch{throw new Error('UPSTREAM_GIT_REVISION_UNKNOWN')}
  if(rev!==PINNED_UPSTREAM)throw new Error(`UPSTREAM_REVISION_MISMATCH: expected ${PINNED_UPSTREAM}; got ${rev}`);
  const source=readFileSync(file,'utf8');
  const {code,changed}=patchUpstream(source);
  // Keep any local upstream edits intact: only patch a clean pinned checkout.
  if(changed && execFileSync('git',['-C',root,'status','--porcelain','--',SOURCE],{encoding:'utf8'}).trim())
    throw new Error('UPSTREAM_SOURCE_HAS_LOCAL_MODIFICATIONS');
  const dest=join(root,TELEMETRY_FILE);
  const own=resolve(dirname(fileURLToPath(import.meta.url)),'../../integrations/moonlight-web/cloudplay-p0-telemetry.ts');
  if(!existsSync(own))throw new Error('CLOUDPLAY_INSTRUMENTATION_FILE_MISSING');
  if(!dryRun){
    if(existsSync(dest)&&readFileSync(dest,'utf8')!==readFileSync(own,'utf8'))throw new Error('TELEMETRY_FILE_CONFLICT');
    if(changed)writeFileSync(file,code);
    if(!existsSync(dest))copyFileSync(own,dest);
  }
  return {upstreamRevision:rev,changed,dryRun,sourceFile:SOURCE,telemetryFile:TELEMETRY_FILE};
}

const invoked=process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  const folder=process.argv[2];
  if(!folder){console.error('Usage: node scripts/p0/integrate-moonlight-web.mjs <upstream-checkout> [--dry-run]');process.exitCode=2;}
  else try{console.log(JSON.stringify(installMoonlightBridge(folder,{dryRun:process.argv.includes('--dry-run')}),null,2))}
  catch(e){console.error(e.message);process.exitCode=1}
}
