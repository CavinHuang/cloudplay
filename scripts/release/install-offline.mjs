#!/usr/bin/env node
// Deployment host release manager: no network, npm, cargo, Git or external modules.
// Install verified, immutable release slots; keep all credentials and Moonlight
// pairing data outside them. Stop CloudPlay services before switching slots.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verify} from './verify-offline.mjs';

const SLOT=/^[A-Za-z0-9][A-Za-z0-9._-]{1,100}$/;
function dir(root){ return path.resolve(root); }
function validateRoot(root){
  if (!root || typeof root!=='string')throw new Error('--root is required');
  const r=dir(root);
  if(r===path.parse(r).root)throw new Error('Cannot use a filesystem root as install directory');
  if(fs.existsSync(r) && fs.lstatSync(r).isSymbolicLink())throw new Error('Installation root may not be a symlink');
  return r;
}
function slotPath(root,id){
  if(!SLOT.test(id))throw new Error('Invalid release slot identifier');
  return path.join(root,'releases',id);
}
function readPointer(root){
  const p=path.join(root,'active.json');
  if(!fs.existsSync(p))return null;
  const o=JSON.parse(fs.readFileSync(p,'utf8'));
  if(o.schema!=='cloudplay.slots.v1'||!SLOT.test(o.active)||(o.previous!==null&&!SLOT.test(o.previous)))throw new Error('Invalid active.json; refusing to choose release');
  return o;
}
function writePointer(root,point){
  const temp=path.join(root,`.active-${randomUUID()}.tmp`);
  try{
    fs.writeFileSync(temp,JSON.stringify({schema:'cloudplay.slots.v1',...point,updatedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
    fs.renameSync(temp,path.join(root,'active.json'));
  }finally{fs.rmSync(temp,{force:true});}
}
function lock(root,fn){
  fs.mkdirSync(root,{recursive:true});
  const file=path.join(root,'.install.lock');let fd;
  try {fd=fs.openSync(file,'wx',0o600);}catch{throw new Error('Another operation has the installer lock. Confirm it is stopped before clearing .install.lock');}
  try{return fn();}finally{fs.closeSync(fd);fs.rmSync(file,{force:true});}
}
function assertStopped(root){
  if(fs.existsSync(path.join(root,'state','service-pids.json')))throw new Error('CloudPlay may still be running; stop it before changing releases');
}
function ensureVerifiedSlot(root,id){
  const p=slotPath(root,id);
  if(!fs.existsSync(p)||fs.lstatSync(p).isSymbolicLink()||!fs.statSync(p).isDirectory())throw new Error(`Release slot missing or unsafe: ${id}`);
  return verify(p);
}
function installManagerScripts(root,candidate){
  for(const n of ['start-active.ps1','stop-active.ps1','m1-accept.ps1']) {
    const from=path.join(candidate,'deploy',n);
    if(!fs.existsSync(from))throw new Error(`Installer companion script missing: deploy/${n}`);
    // Trusted only after entire candidate verification.
    const dest=path.join(root,n),temp=path.join(root,`.${n}-${randomUUID()}.tmp`);
    try{fs.copyFileSync(from,temp);fs.renameSync(temp,dest)}finally{fs.rmSync(temp,{force:true})}
  }
}
export function status(root){
  root=validateRoot(root);
  const point=readPointer(root);
  if(!point)return {installed:false,root};
  const validation=ensureVerifiedSlot(root,point.active);
  return {installed:true,root,active:point.active,previous:point.previous,...validation,
    servicesPidFilePresent:fs.existsSync(path.join(root,'state','service-pids.json'))};
}
export function install({root,candidate}){
  root=validateRoot(root);
  if(!candidate)throw new Error('--candidate is required');
  const from=path.resolve(candidate);
  if(!fs.existsSync(from)||!fs.statSync(from).isDirectory())throw new Error('Candidate directory missing');
  if(from===root||from.startsWith(root+path.sep)||root.startsWith(from+path.sep))throw new Error('Candidate must be outside installation root');
  const validated=verify(from);
  if(!['windows-p0','windows-full'].includes(validated.mode))throw new Error('Windows slot installer requires a Windows offline release');
  const manifest=fs.readFileSync(path.join(from,'manifest.json'));
  const version=JSON.parse(manifest).cloudplayVersion;
  if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Invalid version in candidate');
  const id=`v${version}-${createHash('sha256').update(manifest).digest('hex').slice(0,12)}`;
  return lock(root,()=>{
    assertStopped(root);
    const before=readPointer(root);
    if(before)ensureVerifiedSlot(root,before.active);
    const target=slotPath(root,id);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    if(fs.existsSync(target)){
      ensureVerifiedSlot(root,id);
    } else {
      const staged=path.join(root,'releases',`.stage-${randomUUID()}`);
      try{
        fs.cpSync(from,staged,{recursive:true,errorOnExist:true,force:false});
        verify(staged);
        fs.renameSync(staged,target);
      }finally{fs.rmSync(staged,{recursive:true,force:true});}
    }
    // Keep runtime state independent from the executable release slots.
    fs.mkdirSync(path.join(root,'state'),{recursive:true});
    installManagerScripts(root,target);
    if(before?.active!==id)writePointer(root,{active:id,previous:before?.active??null});
    return {root,active:id,previous:before?.active===id?before.previous:before?.active??null,mode:validated.mode};
  });
}
export function rollback(root){
  root=validateRoot(root);
  return lock(root,()=>{
    assertStopped(root);
    const p=readPointer(root);
    if(!p?.previous)throw new Error('No previous release available for rollback');
    ensureVerifiedSlot(root,p.active);ensureVerifiedSlot(root,p.previous);
    writePointer(root,{active:p.previous,previous:p.active});
    // Companion scripts can evolve with releases: install the rollback version's scripts.
    installManagerScripts(root,slotPath(root,p.previous));
    return {root,active:p.previous,previous:p.active};
  });
}
export function activate(root,id){
  root=validateRoot(root);
  return lock(root,()=>{
    assertStopped(root);ensureVerifiedSlot(root,id);
    const current=readPointer(root);
    if(current)ensureVerifiedSlot(root,current.active);
    installManagerScripts(root,slotPath(root,id));
    if(current?.active!==id)writePointer(root,{active:id,previous:current?.active??null});
    return {root,active:id,previous:current?.active??null};
  });
}
export function parseCli(args){
  const [command,...rest]=args;const o={};
  for(let i=0;i<rest.length;i++){
    if(!['--root','--candidate','--id'].includes(rest[i]))throw new Error(`Unexpected argument ${rest[i]}`);
    const k=rest[i++].slice(2);if(!rest[i])throw new Error(`Missing --${k} value`);o[k]=rest[i];
  }
  return {command,...o};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const o=parseCli(process.argv.slice(2));let result;
    if(o.command==='install')result=install(o);
    else if(o.command==='rollback')result=rollback(o.root);
    else if(o.command==='activate')result=activate(o.root,o.id);
    else if(o.command==='status')result=status(o.root);
    else throw new Error('Usage: install|rollback|activate|status --root <install-dir> [--candidate <release-dir>|--id <slot-id>]');
    console.log(JSON.stringify(result,null,2));
  }catch(e){console.error('CLOUDPLAY OFFLINE INSTALL:',e.message);process.exitCode=1;}
}
