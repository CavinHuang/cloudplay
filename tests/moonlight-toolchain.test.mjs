import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {versionTuple,compareVersions,checkMoonlightVersions} from '../lib/lab/moonlight-toolchain.mjs';

test('Moonlight pinned source has a separate >=26.4 Node and npm >=11.17 build gate',()=>{
 assert.deepEqual(versionTuple('v26.4.0'),[26,4,0]);
 assert.equal(compareVersions('26.4.0','26.3.9'),1);
 for(const [node,npm] of [['22.16.0','10.9.2'],['26.3.9','11.17.0'],['26.4.0','11.16.9'],['27.0.0','11.17.0'],['26.4.0','12.0.0']]){
  assert.equal(checkMoonlightVersions({node,npm}).ok,false,`${node}/${npm}`);
 }
 assert.equal(checkMoonlightVersions({node:'26.4.0',npm:'11.17.0'}).ok,true);
 assert.equal(checkMoonlightVersions({node:'26.9.1',npm:'11.99.1'}).ok,true);
 assert.equal(versionTuple('not-a-version'),null);
 assert.equal(versionTuple('26.4.0-rc.1'),null);
});
test('PowerShell upstream runner is pinned, dry-runs before modification and gates build',()=>{
 const script=readFileSync(new URL('../scripts/p0/build-moonlight-web.ps1',import.meta.url),'utf8');
 for(const essential of ['-dry-run','check-moonlight-toolchain.mjs','x86_64-pc-windows-gnu','cargo',"@('run','build')",'dist','--no-audit','--no-fund']){
  // `--dry-run` is passed to patcher verbatim.
  assert.ok(script.includes(essential),essential);
 }
 assert.match(script,/if\(-not \$Build\)/);
});
