import {getHostHeartbeat,validateLabEndpoint} from '../lib/lab/agent.mjs';
import {createGameRunner} from '../lib/lab/game-runner.mjs';

const token=process.env.CLOUDPLAY_LAB_TOKEN;
if (!token || token.length < 32) {console.error('Missing CLOUDPLAY_LAB_TOKEN (minimum 32 characters).');process.exit(1);}
const endpoint=validateLabEndpoint(process.env.CLOUDPLAY_LAB_ENDPOINT||'http://127.0.0.1:7788');
const runner=createGameRunner({gamePath:process.env.CLOUDPLAY_GAME_PATH});
const completed=new Map();
let busyBeat=false,busyPoll=false,stopping=false,lastCoordinatorOk=Date.now();
async function request(path,options={}) {
  const r=await fetch(new URL(path,endpoint),{...options,headers:{Authorization:`Bearer ${token}`,...(options.headers||{})},signal:AbortSignal.timeout(3500)});
  if(!r.ok)throw Error(`Coordinator HTTP ${r.status}`);
  lastCoordinatorOk=Date.now();return r.json();
}
const initial=await getHostHeartbeat({hostId:process.env.CLOUDPLAY_HOST_ID,activeGame:runner.snapshot()});
const hostId=initial.hostId;
async function beat() {
  if(busyBeat||stopping)return;busyBeat=true;
  try {
    const payload=await getHostHeartbeat({hostId,activeGame:runner.snapshot()});
    await request('/internal/heartbeat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  }catch(e){console.error('Heartbeat failed:',e.message);}finally{busyBeat=false;}
}
async function perform(command) {
  if(command.gameId!=='supertuxkart'||!['launch','stop'].includes(command.kind))return {outcome:'failed',reason:'COMMAND_NOT_ALLOWLISTED'};
  try {
    if(command.kind==='launch') await runner.launch(command.sessionId,command.gameId);
    else await runner.stop(command.sessionId);
    return {outcome:command.kind==='launch'?'launched':'stopped'};
  } catch(error){return {outcome:'failed',reason:String(error.message||'ACTION_FAILED').slice(0,120)};}
}
async function poll() {
  if(busyPoll||stopping)return;busyPoll=true;
  try{
    const data=await request(`/internal/commands?hostId=${encodeURIComponent(hostId)}`);
    for(const command of data.commands||[]) {
      if(!completed.has(command.commandId)) {
        const result=await perform(command);
        completed.set(command.commandId,{commandId:command.commandId,sessionId:command.sessionId,hostId,...result});
        console.log(`[${new Date().toISOString()}] local ${command.kind}: ${result.outcome}. This is NOT media playback proof.`);
      }
      await request('/internal/command-results',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(completed.get(command.commandId))});
      completed.delete(command.commandId);
    }
  }catch(e){console.error('Command poll/report failed:',e.message);}finally{busyPoll=false;}
}
async function leaseCheck(){
  if(stopping)return;
  if(Date.now()-lastCoordinatorOk>45000&&runner.snapshot()?.state==='running') {
    console.error('Coordinator unreachable for >45s; stopping only the game started by this agent.');
    try{await runner.stop(runner.snapshot().sessionId);}catch(e){console.error('Lease cleanup failed:',e.message);}
  }
}
await beat();await poll();
const beatTimer=setInterval(beat,5000),pollTimer=setInterval(poll,1600),leaseTimer=setInterval(leaseCheck,4000);
async function shutdown(){if(stopping)return;stopping=true;clearInterval(beatTimer);clearInterval(pollTimer);clearInterval(leaseTimer);
  if(runner.snapshot()?.state==='running')try{await runner.stop(runner.snapshot().sessionId)}catch(e){console.error('Shutdown cleanup failed:',e.message)}
  process.exit(0);
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,shutdown);
