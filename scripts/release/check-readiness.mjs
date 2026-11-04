#!/usr/bin/env node
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
const check=(label,p)=>({label,ready:existsSync(resolve(p)),path:p});
const tests=[check('Web standalone server','.next/standalone/server.js'),check('Web standalone deps','.next/standalone/node_modules'),
  check('Web static assets','.next/static'),check('P0 Coordinator','lab/coordinator.mjs'),
  check('Windows distribution builder','scripts/release/build-windows-offline.ps1'),
  check('Moonlight telemetry patch','integrations/moonlight-web/cloudplay-p0-telemetry.ts')];
console.log(JSON.stringify({releaseVersion:'0.12.0',mode:'BUILD_READINESS_NOT_RUNTIME_VALIDATION',
 tests,webPrebuiltReady:tests.slice(0,3).every(x=>x.ready),
 note:'Windows Moonlight binary, modified corresponding source and a licensed Node Windows runtime must be supplied before an offline bundle can be created. Real GPU/AV/playability requires Windows host verification.'},null,2));
