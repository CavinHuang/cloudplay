#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {version} from 'node:process';
import {checkMoonlightVersions} from '../../lib/lab/moonlight-toolchain.mjs';
import {PINNED_UPSTREAM} from './integrate-moonlight-web.mjs';
let npmVersion=null;
try {npmVersion=execFileSync('npm',['--version'],{encoding:'utf8',timeout:7000}).trim();}
catch { /* clear missing-tool error in report */ }
const result=checkMoonlightVersions({node:version,npm:npmVersion});
console.log(JSON.stringify({tool:'Moonlight Web P0 build preflight',pinnedUpstream:PINNED_UPSTREAM,
  ...result,installed:{node:version,npm:npmVersion},
  warning:'CloudPlay Node >=22 is NOT the Moonlight Web pinned toolchain. Native Windows server requires Rust GNU target.'},null,2));
if(!result.ok)process.exitCode=1;
