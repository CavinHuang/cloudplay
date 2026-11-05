#!/usr/bin/env node
// Explicit private M2 reservation service; no public transport or game launch.
import path from 'node:path';
import {createM2Coordinator} from '../../lab/m2-coordinator.mjs';
try{
 const root=process.env.CLOUDPLAY_M2_STATE_DIR;
 if(!root||!path.isAbsolute(root))throw Error('CLOUDPLAY_M2_STATE_DIR absolute private path required');
 let hostTokens;
 try{hostTokens=JSON.parse(process.env.CLOUDPLAY_M2_HOST_TOKENS||'{}')}catch{throw Error('CLOUDPLAY_M2_HOST_TOKENS must be a JSON map')}
 const enabledGames=process.env.CLOUDPLAY_M2_ALLOW_SUPERTUXKART_RESERVATION==='1'?['supertuxkart']:[];
 const app=createM2Coordinator({adminToken:process.env.CLOUDPLAY_M2_ADMIN_TOKEN,
  hostTokens,enabledGames,statePath:path.join(root,'m2-journal.json')});
 const port=Number(process.env.CLOUDPLAY_M2_PORT||7790);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('M2 port must be between 1024 and 65535');
 app.server.listen(port,'127.0.0.1',()=>{
  console.log('CloudPlay M2 PRIVATE reservation control on 127.0.0.1:'+port+' (no game launch or public stream).');
 });
 app.server.on('error',e=>{console.error('M2 bind failure:',e.code||'UNKNOWN');process.exitCode=1});
}catch(e){console.error('M2 not started:',e.message);process.exitCode=1}
