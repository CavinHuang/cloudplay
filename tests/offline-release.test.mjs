import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assemble,inspectOptions} from '../scripts/release/pack-offline.mjs';
import {verify} from '../scripts/release/verify-offline.mjs';

const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cloudplay-bundle-test-'));
const f=(root,name,data='data')=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);return file};
const dir=(root,name)=>{const folder=path.join(root,name);fs.mkdirSync(folder,{recursive:true});return folder};
const mockPE=()=>{const b=Buffer.alloc(512);b.write('MZ');b.writeUInt32LE(0x80,0x3c);b.write('PE\\0\\0'.replaceAll('\\0','\0'),0x80,'binary');b.writeUInt16LE(0x8664,0x84);b.writeUInt16LE(0x20b,0x98);return b;};
const fixture=()=>{
 const root=temp();const src=dir(root,'src');const out=path.join(root,'release');
 const options={mode:'windows-p0',out,node:f(src,'node.exe',mockPE()),
  'node-license':f(src,'NODE-LICENSE.txt','Node.js license placeholder'),
  'moonlight-server':f(src,'web-server.exe',mockPE()),
  'moonlight-static':dir(src,'static'), 'moonlight-source':dir(src,'moonlight')};
 f(options['moonlight-static'],'index.html','<html></html>');
 f(options['moonlight-static'],'app.js','cloudplay.p0.media.v1 framesDecoded');
 f(options['moonlight-source'],'LICENSE','GPL-3.0-or-later example');
 f(options['moonlight-source'],'web/stream/transport/webrtc.ts','// cloudplay patch enabled');
 f(options['moonlight-source'],'.env.local','secret=should-not-copy');
 f(options['moonlight-source'],'node_modules/x.txt','ignored');
 return {root,options,out};
};
test('rejects incomplete offline release instead of fetching at deploy time',()=>{
 assert.throws(()=>inspectOptions({mode:'windows-full',out:'/tmp/output'}),/--node/);
 assert.throws(()=>inspectOptions({mode:'windows-p0',out:'/tmp/output',node:'/tmp/what'}),/--node-license/);
});
test('packages offline Windows P0 including license + corresponding patched source',()=>{
 const {root,options,out}=fixture();
 try {const {manifest}=assemble(options); assert.equal(manifest.mode,'windows-p0');
   assert.equal(manifest.deploymentNetworkDownloads,false);
   assert.ok(manifest.files.some(f=>f.path==='source/moonlight-web/LICENSE'));
   assert.ok(manifest.files.some(f=>f.path==='services/moonlight/static/app.js'));
   assert.ok(manifest.files.some(f=>f.path==='deploy/start-cloudplay.ps1'));
   assert.ok(!fs.existsSync(path.join(out,'source','moonlight-web','.env.local')));
   assert.ok(!fs.existsSync(path.join(out,'source','moonlight-web','node_modules')));
   assert.deepEqual(verify(out),{mode:'windows-p0',files:manifest.files.length,networkDownloads:false});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('detects any modified file in an offline Windows package',()=>{
 const {root,options,out}=fixture();
 try{assemble(options);fs.appendFileSync(path.join(out,'services','moonlight','static','app.js'),'TAMPERED');
 assert.throws(()=>verify(out),/integrity mismatch/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('rejects missing or wrong Moonlight compiled media bridge',()=>{
 const {root,options}=fixture();
 try{fs.writeFileSync(path.join(options['moonlight-static'],'app.js'),'NOT_BRIDGED');
 assert.throws(()=>assemble(options),/media bridge/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('rejects unpatched Moonlight corresponding source',()=>{
 const {root,options}=fixture();
 try{fs.writeFileSync(path.join(options['moonlight-source'],'web/stream/transport/webrtc.ts'),'plain vanilla');
 assert.throws(()=>assemble(options),/CloudPlay bridge patch/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('web full bundle requires standalone server and retains its runtime node_modules',()=>{
 const {root,options,out}=fixture();
 try {
   options.mode='windows-full';
   options['next-standalone']=dir(root,'standalone');options['next-static']=dir(root,'next-static');options['web-notices']=f(root,'web-DEPENDENCIES.txt','Next and React license notices');
   f(options['next-standalone'],'server.js','console.log("web")');
   f(options['next-standalone'],'node_modules/next/package.json','{"name":"next"}');
   f(options['next-standalone'],'.next/server/route.js','ok');
   f(options['next-static'],'chunks/app.js','console.log("app")');
   const {manifest}=assemble(options);
   assert.ok(fs.existsSync(path.join(out,'services','web','node_modules','next','package.json')));
   assert.ok(fs.existsSync(path.join(out,'services','web','.next','server','route.js')));
   assert.ok(fs.existsSync(path.join(out,'services','web','.next','static','chunks','app.js')));
   assert.equal(verify(out).files,manifest.files.length);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('docker image packaging supports offline `docker load` deployment and integrity checking',()=>{
 const root=temp();
 try{
   const out=path.join(root,'release');const image=f(root,'cloudplay-web.tar','dummy OCI image data');
   const {manifest}=assemble({mode:'docker-web',out,image});
   assert.ok(fs.readFileSync(path.join(out,'deploy','docker-compose.yaml'),'utf8').includes('pull_policy: never'));
   assert.ok(fs.readFileSync(path.join(out,'deploy','load-and-run.sh'),'utf8').includes('sha256sum -c'));
   assert.equal(verify(out).files,manifest.files.length);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('detects unexpected added binary in offline bundle',()=>{
 const {root,options,out}=fixture();
 try{assemble(options);f(out,'payload/unknown.exe','unknown');assert.throws(()=>verify(out),/not declared/);}
 finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('refuses non-empty release directory to prevent partially overwritten deployments',()=>{
 const {root,options,out}=fixture();
 try{f(out,'existing.txt','keep');assert.throws(()=>assemble(options),/must be empty/);}
 finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('failed packaging does not leave a partial release tree',()=>{
 const {root,options,out}=fixture();
 try{fs.unlinkSync(path.join(options['moonlight-static'],'app.js'));
  assert.throws(()=>assemble(options),/media bridge/);
  assert.equal(fs.existsSync(out),false);
  assert.equal(fs.readdirSync(root).some(f=>f.startsWith('.cloudplay-stage-')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('rejects a fake executable even when filename and Moonlight payload are present',()=>{
 const {root,options,out}=fixture();
 try{fs.writeFileSync(options.node,'MZ-only-not-a-PE');
  assert.throws(()=>assemble(options),/Windows PE executable/);
  assert.equal(fs.existsSync(out),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('rejects a PE for the wrong CPU architecture',()=>{
 const {root,options}=fixture();
 try{const b=fs.readFileSync(options.node);b.writeUInt16LE(0x14c,0x84);
  fs.writeFileSync(options.node,b);assert.throws(()=>assemble(options),/x64 Windows PE32/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
