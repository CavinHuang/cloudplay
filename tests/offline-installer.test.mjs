import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {assemble} from '../scripts/release/pack-offline.mjs';
import {verify} from '../scripts/release/verify-offline.mjs';
import {install,rollback,activate,status} from '../scripts/release/install-offline.mjs';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cloudplay-slots-'));
const write=(dir,p,data='fixture')=>{const f=path.join(dir,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,data);return f};
const mockPE=()=>{const b=Buffer.alloc(512);b.write('MZ');b.writeUInt32LE(0x80,0x3c);b.write('PE\\0\\0'.replaceAll('\\0','\0'),0x80,'binary');b.writeUInt16LE(0x8664,0x84);b.writeUInt16LE(0x20b,0x98);return b;};
const createCandidate=(base,label)=>{
  const src=path.join(base,`build-${label}`),out=path.join(base,`candidate-${label}`);
  const node=write(src,'node.exe',mockPE()),license=write(src,'NODE-LICENSE.txt','license');
  const moonlight=write(src,'web-server.exe',mockPE());
  const staticDir=path.join(src,'static'),sourceDir=path.join(src,'moonlight');
  write(staticDir,'index.html','<!doctype html>');
  write(staticDir,'app.js',`cloudplay.p0.media.v1 framesDecoded ${label}`);
  write(sourceDir,'LICENSE','GNU GPLv3');
  write(sourceDir,'web/stream/transport/webrtc.ts','// cloudplay patch');
  assemble({mode:'windows-p0',out,node,'node-license':license,'moonlight-server':moonlight,'moonlight-static':staticDir,'moonlight-source':sourceDir});
  return out;
};
test('installs a verified Windows release into an immutable slot and keeps state outside it',()=>{
  const base=temp();try{
    const candidate=createCandidate(base,'alpha'), root=path.join(base,'installed');
    const a=install({root,candidate});
    assert.match(a.active,/^v0\.12\.0-[a-f0-9]{12}$/);
    assert.equal(status(root).active,a.active);
    assert.ok(fs.existsSync(path.join(root,'state')));
    assert.ok(fs.existsSync(path.join(root,'start-active.ps1')));
    assert.ok(fs.existsSync(path.join(root,'stop-active.ps1')));
    assert.ok(fs.existsSync(path.join(root,'releases',a.active,'deploy','install-offline.mjs')));
    assert.ok(verify(path.join(root,'releases',a.active)));
    assert.equal(install({root,candidate}).active,a.active,'reinstall is idempotent');
    assert.equal(status(root).previous,null);
  }finally{fs.rmSync(base,{recursive:true,force:true});}
});
test('upgrades and rolls back code while retaining runtime credentials and config',()=>{
  const base=temp();try{
    const root=path.join(base,'installed');const first=createCandidate(base,'alpha');
    const a=install({root,candidate:first});
    write(path.join(root,'state'),'.p0-lab-token','persistent-secret');
    write(path.join(root,'state'),'moonlight/server/data.json','{"paired":true}');
    const second=createCandidate(base,'beta'); const b=install({root,candidate:second});
    assert.notEqual(b.active,a.active); assert.equal(b.previous,a.active);
    assert.equal(status(root).active,b.active);
    assert.equal(fs.readFileSync(path.join(root,'state','.p0-lab-token'),'utf8'),'persistent-secret');
    assert.equal(fs.readFileSync(path.join(root,'state','moonlight/server/data.json'),'utf8'),'{"paired":true}');
    assert.equal(rollback(root).active,a.active);
    assert.equal(status(root).previous,b.active);
    assert.equal(activate(root,b.active).active,b.active);
    assert.equal(status(root).active,b.active);
    assert.equal(verify(path.join(root,'releases',a.active)).mode,'windows-p0');
    assert.equal(verify(path.join(root,'releases',b.active)).mode,'windows-p0');
  }finally{fs.rmSync(base,{recursive:true,force:true});}
});
test('refuses upgrade while PID marker indicates active services',()=>{
  const base=temp();try{
    const root=path.join(base,'installed');install({root,candidate:createCandidate(base,'one')});
    write(path.join(root,'state'),'service-pids.json','{}');
    assert.throws(()=>install({root,candidate:createCandidate(base,'two')}),/may still be running/);
    assert.throws(()=>rollback(root),/may still be running/);
    assert.equal(status(root).servicesPidFilePresent,true);
    assert.equal(fs.existsSync(path.join(root,'.install.lock')),false);
  }finally{fs.rmSync(base,{recursive:true,force:true});}
});
test('refuses to install or activate tampered releases and preserves old active pointer',()=>{
  const base=temp();try{
    const root=path.join(base,'installed');const a=install({root,candidate:createCandidate(base,'one')});
    const corrupt=createCandidate(base,'two');fs.appendFileSync(path.join(corrupt,'services/moonlight/static/app.js'),'malicious');
    assert.throws(()=>install({root,candidate:corrupt}),/integrity mismatch/);
    assert.equal(status(root).active,a.active);
    fs.appendFileSync(path.join(root,'releases',a.active,'services/moonlight/static/app.js'),'tampered');
    assert.throws(()=>status(root),/integrity mismatch/);
    assert.throws(()=>activate(root,a.active),/integrity mismatch/);
  }finally{fs.rmSync(base,{recursive:true,force:true});}
});
test('does not accept a source candidate nested inside installation root or install into filesystem root',()=>{
  const base=temp();try{
    const candidate=createCandidate(base,'test');const root=path.join(base,'installed');
    assert.throws(()=>install({root:path.parse(base).root,candidate}),/filesystem root/);
    fs.mkdirSync(root);const inside=path.join(root,'candidate');fs.cpSync(candidate,inside,{recursive:true});
    assert.throws(()=>install({root,candidate:inside}),/outside installation root/);
    assert.equal(fs.existsSync(path.join(root,'active.json')),false);
  }finally{fs.rmSync(base,{recursive:true,force:true});}
});
test('scripts use persistent external state; never write runtime credentials inside verified slot',()=>{
  const root=path.resolve(import.meta.dirname,'..');
  for(const p of ['deploy/windows/start-cloudplay.ps1','deploy/windows/stop-cloudplay.ps1','scripts/p0/start-p0-lab.ps1','scripts/p0/stop-p0-lab.ps1']){
    const source=fs.readFileSync(path.join(root,p),'utf8');assert.match(source,/CLOUDPLAY_STATE_DIR/);
  }
  const launch=fs.readFileSync(path.join(root,'deploy/windows/start-cloudplay.ps1'),'utf8');
  assert.match(launch,/\$moonDir=Join-Path \$stateRoot 'moonlight'/);
  assert.match(launch,/Copy-Item -LiteralPath \$staticSource/);
  assert.match(launch,/service-pids\.json/);
  const stop=fs.readFileSync(path.join(root,'deploy/windows/stop-cloudplay.ps1'),'utf8');
  assert.match(stop,/Join-Path \$stateRoot 'service-pids\.json'/);
});

test('installed package contains a working no-download command-line slot manager',()=>{
  const base=temp();try{
    const candidate=createCandidate(base,'cli'), root=path.join(base,'installed');
    const cmd=path.join(candidate,'deploy','install-offline.mjs');
    const output=JSON.parse(execFileSync(process.execPath,[cmd,'install','--root',root,'--candidate',candidate],{encoding:'utf8'}));
    assert.ok(output.active);
    const statusFromCLI=JSON.parse(execFileSync(process.execPath,[cmd,'status','--root',root],{encoding:'utf8'}));
    assert.equal(output.active,statusFromCLI.active);
    assert.equal(fs.existsSync(path.join(root,'state')),true);
  }finally{fs.rmSync(base,{recursive:true,force:true});}
});
