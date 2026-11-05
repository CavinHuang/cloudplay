import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import net from 'node:net';
import {isAbsolute,join} from 'node:path';
import os from 'node:os';

export async function portOpen(port, {timeoutMs=1000, connect = (p, done) => net.createConnection({host:'127.0.0.1',port:p},done)}={}) {
  return new Promise(resolve => {
    let settled = false;
    const socket = connect(port, () => finish(true));
    const finish = value => { if (settled) return; settled = true; socket.destroy(); resolve(value); };
    socket.on('error', () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}
/** Windows NVIDIA driver bundles can install nvidia-smi outside PATH.
 * Same search roots used by M1 PowerShell host preflight. No shell or network.
 */
export function nvidiaSmiCandidates({platform=process.platform,env=process.env}={}){
 const paths=['nvidia-smi'];
 if(platform==='win32'){
   for(const root of [env.SystemRoot,env.WINDIR]){
     if(root)paths.push(join(root,'System32','nvidia-smi.exe'));
   }
   if(env.ProgramFiles)paths.push(join(env.ProgramFiles,'NVIDIA Corporation','NVSMI','nvidia-smi.exe'));
 }
 return [...new Set(paths)];
}
export function getGpu({run=execFileSync,platform=process.platform,env=process.env}={}) {
 for(const executable of nvidiaSmiCandidates({platform,env})){
   try {
     const output=run(executable,['--query-gpu=name','--format=csv,noheader'],{
       encoding:'utf8',timeout:2500,windowsHide:true,stdio:['ignore','pipe','ignore']
     });
     const model=String(output).split(/\r?\n/).map(v=>v.trim()).find(Boolean);
     if(model)return {detected:true,model:model.slice(0,100)};
   }catch{ /* Try the next standard driver install directory. */ }
 }
 return {detected:false,model:null};
}
export async function getHostHeartbeat({hostId=os.hostname().replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,64), gamePath=process.env.CLOUDPLAY_GAME_PATH, gpu=getGpu(), portProbe=portOpen, activeGame=null}={}) {
  if (!hostId || hostId.length < 3) hostId='local-host';
  const [sunshinePortOpen,webStreamPortOpen]=await Promise.all([portProbe(47990),portProbe(8080)]);
  return {
    hostId, gpu, sunshinePortOpen, webStreamPortOpen, activeGame,
    gameFilePresent: Boolean(gamePath && isAbsolute(gamePath) && existsSync(gamePath)),
    agentVersion:'0.5.0-lab',
  };
}
export function validateLabEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('P0 endpoint must be loopback http://127.0.0.1:PORT with no credentials/path/query');
  }
  return url;
}
