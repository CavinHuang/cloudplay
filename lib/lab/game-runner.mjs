import {spawn as nodeSpawn, execFile as nodeExecFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname,isAbsolute,basename} from 'node:path';

// Only launch the operator-provided local executable. No remote commands,
// arguments, URL-supplied paths, auto-downloads or privilege escalation.
export function createGameRunner({gamePath,spawn=nodeSpawn,exists=existsSync,platform=process.platform,clock=()=>Date.now(),
  execFile=nodeExecFile,afterExit=()=>{},graceTimeoutMs=2800,forceTimeoutMs=5000}={}) {
  let active=null,lastExit=null,stopping=null;
  function snapshot(){return active?{sessionId:active.sessionId,state:'running',pid:active.child.pid||null}:
    (lastExit?{sessionId:lastExit.sessionId,state:'exited'}:null);}
  async function launch(sessionId,gameId) {
    if(gameId!=='supertuxkart') throw new Error('GAME_NOT_ALLOWLISTED');
    if(!gamePath||!isAbsolute(gamePath)||!exists(gamePath)) throw new Error('GAME_EXECUTABLE_NOT_FOUND');
    if(platform==='win32'&&basename(gamePath).toLowerCase()!=='supertuxkart.exe')throw new Error('UNEXPECTED_GAME_EXECUTABLE');
    if(active){if(active.sessionId===sessionId)return snapshot();throw new Error('GAME_ALREADY_RUNNING');}
    const child=spawn(gamePath,[],{cwd:dirname(gamePath),shell:false,windowsHide:false,detached:false,stdio:'ignore'});
    active={sessionId,child,startedAt:clock()};lastExit=null;
    child.once('exit',(code,signal)=>{
      if(active?.child===child){active=null;lastExit={sessionId,code,signal,at:clock()};afterExit(lastExit);}
    });
    try{
      await new Promise((resolve,reject)=>{
        child.once('spawn',resolve);child.once('error',reject);
      });
    }catch(error){if(active?.child===child)active=null;throw error;}
    return snapshot();
  }
  function alreadyExited(child){return child.exitCode!==null||child.signalCode!==null;}
  function waitForExit(child,ms){
    if(alreadyExited(child))return Promise.resolve(true);
    return new Promise(resolve=>{
      const done=()=>{clearTimeout(timer);child.off('exit',done);resolve(true)};
      const timer=setTimeout(()=>{child.off('exit',done);resolve(alreadyExited(child))},ms);
      child.once('exit',done);
    });
  }
  function taskkill(pid,force=false){
    return new Promise((resolve,reject)=>execFile('taskkill',
      ['/PID',String(pid),'/T',...(force?['/F']:[])],
      {windowsHide:true,timeout:5000},error=>error?reject(error):resolve()));
  }
  async function stop(sessionId){
    if(!active){if(lastExit?.sessionId===sessionId)return {stopped:true,alreadyExited:true};return {stopped:true,wasRunning:false};}
    if(active.sessionId!==sessionId)throw new Error('SESSION_DOES_NOT_OWN_PROCESS');
    if(stopping)return stopping;
    const child=active.child;
    stopping=(async()=>{
      // First allow the application to save state and close naturally. Windows
      // taskkill without /F requests a normal window close; SIGTERM on Linux.
      if(platform==='win32'&&child.pid){
        try{await taskkill(child.pid,false)}catch{if(!alreadyExited(child)){
          // Some games refuse the close request. Continue to bounded cleanup.
        }}
      }else if(!alreadyExited(child))child.kill('SIGTERM');
      if(await waitForExit(child,graceTimeoutMs))return {stopped:true,forced:false};
      // Fallback is restricted to the child PID created by THIS Agent.
      if(platform==='win32'&&child.pid){
        try{await taskkill(child.pid,true)}catch(error){if(!alreadyExited(child))throw error;}
      }else if(!alreadyExited(child))child.kill('SIGKILL');
      if(!await waitForExit(child,forceTimeoutMs))throw new Error('PROCESS_EXIT_TIMEOUT');
      return {stopped:true,forced:true};
    })();
    try{return await stopping;}finally{stopping=null;}
  }
  return {launch,stop,snapshot};
}
