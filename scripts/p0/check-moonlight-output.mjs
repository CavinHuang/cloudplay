#!/usr/bin/env node
// Check that the *compiled* Moonlight browser output actually contains the
// CloudPlay bridge. A successful source edit alone is insufficient.
import {readdirSync,readFileSync,statSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const MARKER='cloudplay.p0.media.v1';
export function verifyMoonlightFrontend(dist){
  const dir=resolve(dist);
  if(!existsSync(dir)||!statSync(dir).isDirectory())throw Error('MOONLIGHT_DIST_NOT_FOUND');
  let total=0,jsCount=0,found=false,html=false;
  const queue=[dir];
  while(queue.length){
    const current=queue.pop();
    for(const item of readdirSync(current,{withFileTypes:true})){
      const file=join(current,item.name);
      if(item.isSymbolicLink())throw Error('DIST_CONTAINS_SYMLINK');
      if(item.isDirectory()){queue.push(file);continue;}
      if(!item.isFile())continue;
      const size=statSync(file).size;
      total+=size;if(total>90_000_000)throw Error('MOONLIGHT_OUTPUT_TOO_LARGE');
      if(item.name==='index.html')html=true;
      if(/\.(?:js|mjs)$/.test(item.name)){
        jsCount++;
        const src=readFileSync(file,'utf8');
        if(src.includes(MARKER)&&src.includes('framesDecoded'))found=true;
      }
    }
  }
  if(!html||!jsCount)throw Error('MOONLIGHT_WEB_FRONTEND_INCOMPLETE');
  if(!found)throw Error('CLOUDPLAY_TELEMETRY_MISSING_FROM_COMPILED_BUNDLE');
  return {compiledBridgeDetected:true,htmlPresent:html,jsFiles:jsCount,bytes:total,
    warning:'Compiled instrumentation present; video, audio and games still require real Windows GPU verification.'};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(!process.argv[2])throw Error('Usage: node check-moonlight-output.mjs <moonlight-dist-folder>');
    console.log(JSON.stringify(verifyMoonlightFrontend(process.argv[2]),null,2));
  }catch(error){console.error('Moonlight compiled bundle check:',error.message);process.exitCode=1;}
}
