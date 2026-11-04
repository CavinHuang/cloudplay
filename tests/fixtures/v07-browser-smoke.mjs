// Synthetic browser integration fixture: NOT A CLOUD STREAM.
import {createCoordinator} from '../../lib/lab/coordinator.mjs';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
const token='synthetic-browser-smoke-only-token-1234567890';
const base='http://127.0.0.1:7789';
const coordinator=createCoordinator({token,launchEnabled:true,streamUrl:'http://127.0.0.1:18080/'});
const read=(path)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8');
const files=new Map([
 ['/',[read('./synthetic-moonlight-client.html'),'text/html']],
 ['/lab/moonlight-media-bridge.mjs',[read('../../lab/moonlight-media-bridge.mjs'),'text/javascript']],
 ['/lib/lab/media-telemetry.mjs',[read('../../lib/lab/media-telemetry.mjs'),'text/javascript']],
 ['/lib/lab/stream-handoff.mjs',[read('../../lib/lab/stream-handoff.mjs'),'text/javascript']],
]);
const fake=http.createServer((req,res)=>{const hit=files.get(req.url);res.setHeader('Cache-Control','no-store');
 if(!hit){res.writeHead(404);return res.end('Not found')}
 res.setHeader('Content-Type',hit[1]);res.writeHead(200);return res.end(hit[0]);});
async function start(server,port){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)})}
await start(coordinator.server,7789);
await start(fake,18080);
const api=async(path,method='GET',body)=>{
 const r=await fetch(base+path,{method,headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json()};
const beat={hostId:'synthetic-host',gpu:{detected:true,model:'SYNTHETIC'},sunshinePortOpen:true,webStreamPortOpen:true,gameFilePresent:true};
await api('/internal/heartbeat','POST',beat);
const created=await api('/internal/lab/sessions','POST',{hostId:beat.hostId,gameId:'supertuxkart'});
const command=(await api('/internal/commands?hostId='+beat.hostId)).commands[0];
await api('/internal/command-results','POST',{...command,hostId:beat.hostId,outcome:'launched'});
setInterval(()=>api('/internal/heartbeat','POST',beat).catch(()=>{}),4000);
console.log(JSON.stringify({type:'SYNTHETIC_ONLY',player:`${base}/play/${created.session.id}`,token},null,2));
