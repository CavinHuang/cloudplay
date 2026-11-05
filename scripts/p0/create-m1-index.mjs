#!/usr/bin/env node
// Generates an empty file map, never fabricated media or success attestations.
import fs from 'node:fs';
import path from 'node:path';
const folder=process.argv[2];
if(!folder){console.error('Usage: node scripts/p0/create-m1-index.mjs <empty-evidence-directory>');process.exitCode=2;}
else try{
 const root=path.resolve(folder);
 fs.mkdirSync(root,{recursive:true});
 const filename=path.join(root,'m1-index.json');
 const index={kind:'cloudplay-m1-acceptance',schemaVersion:1,game:'supertuxkart',hostPreflight:'host-preflight.json',
  sessions:[1,2,3].map(i=>({media:`cycle-${i}-media.json`,manual:`cycle-${i}-manual.json`,screenshot:`cycle-${i}.png`,reconnectExercise:i===3}))};
 fs.writeFileSync(filename,JSON.stringify(index,null,2)+'\n',{flag:'wx'});
 console.log('Created empty M1 index (no test observations or successful sessions have been created): '+filename);
}catch(e){console.error('Cannot create M1 index:',e.message);process.exitCode=1;}
