import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import net from 'node:net';
import {isAbsolute} from 'node:path';
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
export function getGpu({run=execFileSync}={}) {
  try {
    const output = run('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {encoding:'utf8', timeout:2500, windowsHide:true, stdio:['ignore','pipe','ignore']});
    const model = String(output).split(/\r?\n/).map(v=>v.trim()).find(Boolean);
    return {detected: Boolean(model), model: model?.slice(0,100) || null};
  } catch { return {detected:false,model:null}; }
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
