import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
test('source-only build clearly identifies missing standalone web output',()=>{
  const result=JSON.parse(execFileSync(process.execPath,['scripts/release/check-readiness.mjs'],{cwd:root,encoding:'utf8'}));
  assert.equal(result.mode,'BUILD_READINESS_NOT_RUNTIME_VALIDATION');
  assert.equal(result.webPrebuiltReady,false);
});
test('production deployment is configured not to pull images or expose P0',()=>{
 const compose=fs.readFileSync(path.join(root,'docker-compose.yaml'),'utf8');
 assert.match(compose,/pull_policy:\s*never/);
 assert.match(compose,/CLOUDPLAY_P0_UI_ENABLED:\s*'0'/);
 assert.doesNotMatch(compose,/build:\s*\./);
});
test('one-project Windows start/stop scripts and build instructions remain bundled',()=>{
 for(const p of ['deploy/windows/start-cloudplay.ps1','deploy/windows/stop-cloudplay.ps1','scripts/release/build-windows-offline.ps1','docs/OFFLINE-DEPLOYMENT.md'])assert.ok(fs.statSync(path.join(root,p)).size>100);
 const src=fs.readFileSync(path.join(root,'deploy/windows/start-cloudplay.ps1'),'utf8');
 assert.match(src,/verify-offline\.mjs/);
 assert.match(src,/CLOUDPLAY_P0_UI_ENABLED='0'/);
});
