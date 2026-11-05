import test from 'node:test';
import assert from 'node:assert/strict';
import {getGpu,nvidiaSmiCandidates} from '../lib/lab/agent.mjs';

test('NVIDIA detection searches standard Windows driver directories when nvidia-smi is absent from PATH',()=>{
 const env={SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',ProgramFiles:'C:\\Program Files'};
 const names=nvidiaSmiCandidates({platform:'win32',env});
 assert.equal(names.length,3);
 assert.equal(names[0],'nvidia-smi');
 assert.match(names[1],/System32[\\/]nvidia-smi.exe$/i);
 assert.match(names[2],/NVIDIA Corporation[\\/]NVSMI[\\/]nvidia-smi.exe$/i);
 const attempted=[];
 const gpu=getGpu({platform:'win32',env,run:(cmd,args,opts)=>{
   attempted.push(cmd);
   assert.deepEqual(args,['--query-gpu=name','--format=csv,noheader']);
   assert.equal(opts.windowsHide,true);
   if(attempted.length<3)throw Error('ENOENT');
   return 'NVIDIA GeForce RTX 4070 Ti SUPER\\r\\n';
 }});
 assert.deepEqual(gpu,{detected:true,model:'NVIDIA GeForce RTX 4070 Ti SUPER'});
 assert.equal(attempted.length,3);
});

test('NVIDIA diagnostic fails closed and never passes raw system paths to agent heartbeat',()=>{
 const env={ProgramFiles:'C:\\Program Files'};
 const attempted=[];
 const gpu=getGpu({platform:'win32',env,run:(cmd)=>{
   attempted.push(cmd);
   if(attempted.length===1)return '\\n\\r\\n';
   throw Error('no driver');
 }});
 assert.deepEqual(gpu,{detected:false,model:null});
 assert.equal(nvidiaSmiCandidates({platform:'linux',env}).length,1);
});
