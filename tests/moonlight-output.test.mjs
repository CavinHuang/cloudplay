import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyMoonlightFrontend} from '../scripts/p0/check-moonlight-output.mjs';

test('compiled Moonlight frontend must include telemetry bridge, not just patched source',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cloudplay-compiled-moonlight-'));
 try{
  mkdirSync(join(dir,'assets'));
  writeFileSync(join(dir,'index.html'),'<html><script src="/assets/app.js"></script></html>');
  const asset=join(dir,'assets/app.js');
  writeFileSync(asset,'console.log("upstream")');
  assert.throws(()=>verifyMoonlightFrontend(dir),/TELEMETRY_MISSING/);
  writeFileSync(asset,'function stats(){return "cloudplay.p0.media.v1"+"framesDecoded"}');
  assert.equal(verifyMoonlightFrontend(dir).compiledBridgeDetected,true);
  const cli=spawnSync(process.execPath,['scripts/p0/check-moonlight-output.mjs',dir],{encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);assert.match(cli.stdout,/compiledBridgeDetected/);
  rmSync(join(dir,'index.html'));
  assert.throws(()=>verifyMoonlightFrontend(dir),/FRONTEND_INCOMPLETE/);
 }finally{rmSync(dir,{force:true,recursive:true});}
});

test('Windows runner supports separate frontend-only build and checks compiled output',async()=>{
 const {readFileSync}=await import('node:fs');
 const ps=readFileSync(new URL('../scripts/p0/build-moonlight-web.ps1',import.meta.url),'utf8');
 assert.match(ps,/\[switch\]\$FrontendOnly/);
 assert.match(ps,/check-moonlight-output\.mjs/);
 assert.match(ps,/if\(\$FrontendOnly\)/);
 assert.match(ps,/x86_64-pc-windows-gnu/);
});
