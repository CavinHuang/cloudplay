import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assemble} from '../scripts/release/pack-offline.mjs';
import {verify} from '../scripts/release/verify-offline.mjs';
const write=(base,p,data)=>{const a=path.join(base,p);fs.mkdirSync(path.dirname(a),{recursive:true});fs.writeFileSync(a,data);return a};
const fakePE=()=>{const b=Buffer.alloc(512);b.write('MZ');b.writeUInt32LE(0x80,0x3c);b.write('PE\0\0',0x80,'binary');b.writeUInt16LE(0x8664,0x84);b.writeUInt16LE(0x20b,0x98);return b};
test('nested asset manifest.json files remain in offline file ledger and are tamper checked',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cloudplay-nested-manifest-'));
 try{
  const src=path.join(root,'src'),out=path.join(root,'release');
  const opts={mode:'windows-p0',out,node:write(src,'node.exe',fakePE()),'node-license':write(src,'node-license.txt','Node license'),
   'moonlight-server':write(src,'moon.exe',fakePE()),'moonlight-static':path.join(src,'static'),
   'moonlight-source':path.join(src,'moonlight')};
  write(opts['moonlight-static'],'manifest.json','{"name":"moonlight"}');
  write(opts['moonlight-static'],'compiled.js','cloudplay.p0.media.v1 framesDecoded');
  write(opts['moonlight-source'],'LICENSE','GPL-3.0-or-later');
  write(opts['moonlight-source'],'web/stream/transport/webrtc.ts','// cloudplay patch');
  write(opts['moonlight-source'],'web/manifest.json','{"name":"moonlight-web"}');
  const result=assemble(opts);
  for(const filename of ['services/moonlight/static/manifest.json','source/moonlight-web/web/manifest.json']){
   assert.ok(result.manifest.files.some(x=>x.path===filename),'missing signed ledger item: '+filename);
  }
  assert.equal(verify(out).files,result.manifest.files.length);
  fs.appendFileSync(path.join(out,'source','moonlight-web','web','manifest.json'),'tamper');
  assert.throws(()=>verify(out),/integrity mismatch/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
