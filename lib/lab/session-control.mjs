import {randomUUID} from 'node:crypto';

// P0 single-PC experiment ONLY. No customer login, payments, or commercial game rights.
// Command payload never contains an executable path, arguments or shell text.
const GAME_ID = 'supertuxkart';
const SESSION_STATES = new Set(['starting', 'connecting', 'reconnecting', 'stopping']);
const ALL_STATES = new Set([...SESSION_STATES, 'failed', 'finished', 'cancelled']);
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

export function validateCommandReport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (!/^[a-f0-9-]{36}$/i.test(body.commandId || '') || !/^[a-f0-9-]{36}$/i.test(body.sessionId || '')) return null;
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(body.hostId || '')) return null;
  if (!['launched','stopped','failed'].includes(body.outcome)) return null;
  return {commandId:body.commandId,sessionId:body.sessionId,hostId:body.hostId,outcome:body.outcome,
    reason:typeof body.reason==='string'?body.reason.slice(0,160):undefined};
}

export function createSessionControl({clock=()=>Date.now(),id=()=>randomUUID(),ttlMs=16000,reconnectGraceMs=30000,commandRetryMs=3000,onChange=()=>{}}={}) {
  const sessions = new Map(), commands = new Map();
  const nowIso=()=>new Date(clock()).toISOString();
  let restoring=false;
  const changed=()=>{if(!restoring)onChange(exportState());};
  function exportState(){
    const retained=[...sessions.values()].slice(-100);
    const retainedIds=new Set(retained.map(s=>s.id));
    return {schema:1,sessions:retained.map(s=>({...s,events:s.events.slice(-32)})),
      commands:[...commands.values()].filter(c=>retainedIds.has(c.sessionId)).slice(-200).map(c=>({...c}))};
  }
  function restoreState(data){
    if(!data||data.schema!==1||!Array.isArray(data.sessions)||!Array.isArray(data.commands)||data.sessions.length>100||data.commands.length>200)throw Error('INVALID_SESSION_JOURNAL');
    if(sessions.size||commands.size)throw Error('RESTORE_REQUIRES_EMPTY_CONTROL');
    const ids=new Set();restoring=true;
    try {
      for(const raw of data.sessions){
        if(!raw||!ID_PATTERN.test(raw.id||'')||ids.has(raw.id)||!HOST_PATTERN.test(raw.hostId||'')||raw.gameId!==GAME_ID||!ALL_STATES.has(raw.state)||
          !Number.isFinite(Date.parse(raw.createdAt))||!Number.isFinite(Date.parse(raw.updatedAt))||!Array.isArray(raw.events)||raw.events.length>32)throw Error('INVALID_SESSION_JOURNAL');
        ids.add(raw.id);
        const s={id:raw.id,hostId:raw.hostId,gameId:GAME_ID,state:raw.state,createdAt:raw.createdAt,updatedAt:raw.updatedAt,
          reason:typeof raw.reason==='string'?raw.reason.slice(0,160):null,disconnectedAt:Number.isFinite(raw.disconnectedAt)?raw.disconnectedAt:null,
          playbackVerified:false,events:raw.events.map(e=>({state:e.state,at:e.at,reason:e.reason})).slice(-32)};
        sessions.set(s.id,s);
      }
      for(const raw of data.commands){
        if(!raw||!ID_PATTERN.test(raw.commandId||'')||!ids.has(raw.sessionId)||raw.hostId!==sessions.get(raw.sessionId).hostId||
           raw.gameId!==GAME_ID||!['launch','stop'].includes(raw.kind)||typeof raw.createdAt!=='number'||typeof raw.completed!=='boolean'||
           !(raw.lastDeliveryAt===null||typeof raw.lastDeliveryAt==='number')||commands.has(raw.commandId))throw Error('INVALID_SESSION_JOURNAL');
        commands.set(raw.commandId,{commandId:raw.commandId,hostId:raw.hostId,sessionId:raw.sessionId,gameId:GAME_ID,
          kind:raw.kind,createdAt:raw.createdAt,lastDeliveryAt:raw.lastDeliveryAt,completed:raw.completed});
      }
      // Never claim a recovered live session is healthy before a new Agent heartbeat.
      for(const s of sessions.values())if(['connecting','reconnecting'].includes(s.state)){
        s.disconnectedAt=clock();update(s,'reconnecting','COORDINATOR_RESTART_AWAITING_HOST');
      }
    }catch(error){sessions.clear();commands.clear();throw error;}
    finally{restoring=false;}
    changed();
  }
  function update(session, state, reason=null) {
    session.state=state; session.updatedAt=nowIso(); session.reason=reason;
    session.events.push({state,at:session.updatedAt,reason});
    if(session.events.length>32)session.events.shift();
    changed();
  }
  function enqueue(session, kind) {
    const command={commandId:id(),hostId:session.hostId,sessionId:session.id,gameId:GAME_ID,kind,createdAt:clock(),lastDeliveryAt:null,completed:false};
    commands.set(command.commandId,command);changed(); return command;
  }
  function expireHosts(hosts) {
    for(const session of sessions.values()) {
      if(session.state==='starting'&&clock()-Date.parse(session.updatedAt)>45000) {update(session,'failed','GAME_START_TIMEOUT');continue;}
      if(session.state==='stopping'&&clock()-Date.parse(session.updatedAt)>45000) {update(session,'failed','GAME_STOP_NOT_CONFIRMED');continue;}
      if (session.state==='connecting') {
        const host=hosts.get(session.hostId);
        if(!host || clock()-host.receivedAt>=ttlMs) {session.disconnectedAt=clock();update(session,'reconnecting','HOST_HEARTBEAT_LOST');}
      } else if(session.state==='reconnecting' && clock()-(session.disconnectedAt??clock())>reconnectGraceMs) {
        update(session,'failed','HOST_RECONNECT_TIMEOUT');
        // A stale host might still be running the game. The agent also enforces an
        // independent lease timeout and cleans up if the coordinator vanishes.
      }
    }
  }
  function create({gameId,hostId,hosts,enabled=false}) {
    expireHosts(hosts);
    if (!enabled) return {code:'LOCAL_LAUNCH_DISABLED',status:403};
    if (gameId!==GAME_ID) return {code:'GAME_NOT_ALLOWLISTED',status:422};
    const host=hosts.get(hostId);
    if (!host || clock()-host.receivedAt>=ttlMs) return {code:'HOST_OFFLINE',status:409};
    if (!host.gpu.detected || !host.sunshinePortOpen || !host.webStreamPortOpen || !host.gameFilePresent) return {code:'HOST_NOT_READY',status:409};
    if (host.activeGame?.state==='running') return {code:'HOST_PROCESS_BUSY',status:409};
    if ([...sessions.values()].some(s=>s.hostId===hostId&&SESSION_STATES.has(s.state))) return {code:'HOST_SESSION_BUSY',status:409};
    const session={id:id(),gameId,hostId,state:'starting',createdAt:nowIso(),updatedAt:nowIso(),events:[],reason:null,disconnectedAt:null,playbackVerified:false};
    sessions.set(session.id,session);update(session,'starting');enqueue(session,'launch');
    return {status:202,session:publicSession(session)};
  }
  function publicSession(s) {
    return {id:s.id,gameId:s.gameId,hostId:s.hostId,state:s.state,createdAt:s.createdAt,updatedAt:s.updatedAt,reason:s.reason,
      playbackVerified:false,streamProvider:'moonlight-web-manual-handoff',events:s.events.slice(-12)};
  }
  function get(sessionId,hosts) {expireHosts(hosts);const s=sessions.get(sessionId);return s?publicSession(s):null;}
  function list(hosts) {expireHosts(hosts);return [...sessions.values()].map(publicSession);}
  function stop(sessionId,hosts) {
    expireHosts(hosts);const s=sessions.get(sessionId);
    if(!s) return {status:404,code:'SESSION_NOT_FOUND'};
    if(s.state==='failed'&&hosts.get(s.hostId)?.activeGame?.sessionId===s.id&&hosts.get(s.hostId)?.activeGame?.state==='running') {
      update(s,'stopping','RECOVERY_STOP_REQUESTED');enqueue(s,'stop');return {status:202,session:publicSession(s)};
    }
    if(['finished','cancelled','failed'].includes(s.state)) return {status:200,session:publicSession(s)};
    if(s.state==='stopping') return {status:202,session:publicSession(s)};
    const launch=[...commands.values()].find(c=>c.sessionId===s.id&&c.kind==='launch'&&!c.completed);
    if (launch && launch.lastDeliveryAt===null) {
      commands.delete(launch.commandId);update(s,'cancelled','CANCELLED_BEFORE_LAUNCH');return {status:200,session:publicSession(s)};
    }
    update(s,'stopping');enqueue(s,'stop');return {status:202,session:publicSession(s)};
  }
  function nextCommands(hostId,hosts) {
    expireHosts(hosts);
    const host=hosts.get(hostId);
    if(!host || clock()-host.receivedAt>=ttlMs) return [];
    return [...commands.values()].filter(c=>c.hostId===hostId&&!c.completed&&!(c.kind==='launch'&&['finished','failed','cancelled'].includes(sessions.get(c.sessionId)?.state))&&(c.lastDeliveryAt===null||clock()-c.lastDeliveryAt>=commandRetryMs))
      .sort((a,b)=>a.createdAt-b.createdAt).slice(0,1).map(c=>{
        c.lastDeliveryAt=clock();changed();return {commandId:c.commandId,sessionId:c.sessionId,kind:c.kind,gameId:c.gameId};
      });
  }
  function report(input) {
    const data=validateCommandReport(input);
    if(!data) return {status:422,code:'INVALID_COMMAND_REPORT'};
    const c=commands.get(data.commandId),s=sessions.get(data.sessionId);
    if(!c||!s||c.sessionId!==data.sessionId||c.hostId!==data.hostId) return {status:404,code:'UNKNOWN_COMMAND'};
    if(c.completed) return {status:200,accepted:true,duplicate:true};
    if((c.kind==='launch'&&!['launched','failed'].includes(data.outcome))||(c.kind==='stop'&&!['stopped','failed'].includes(data.outcome))) return {status:422,code:'INVALID_COMMAND_OUTCOME'};
    c.completed=true;changed();
    if(data.outcome==='failed') update(s,'failed',data.reason||'AGENT_COMMAND_FAILED');
    else if(c.kind==='launch'&&s.state==='starting') update(s,'connecting','WAITING_FOR_MOONLIGHT_WEB_PAIRING_AND_MEDIA');
    else if(c.kind==='stop'&&s.state==='stopping') update(s,'finished','AGENT_STOPPED_GAME');
    return {status:200,accepted:true,session:publicSession(s)};
  }
  function heartbeat(hostId,activeGame,hosts) {
    for(const s of sessions.values()){
      if(s.hostId!==hostId||!SESSION_STATES.has(s.state))continue;
      if(s.state==='stopping'&&activeGame?.sessionId===s.id&&activeGame.state==='exited') {
        for(const c of commands.values())if(c.sessionId===s.id&&c.kind==='stop')c.completed=true;
        update(s,'finished','HOST_CONFIRMED_GAME_EXIT_AFTER_RECOVERY');
        continue;
      }
      if(activeGame?.sessionId===s.id&&activeGame.state==='running') {
        if(s.state==='starting') {
          // The launch may have completed before Coordinator restarted. The
          // Agent-reported owned process is stronger evidence than replaying a launch.
          for(const c of commands.values())if(c.sessionId===s.id&&c.kind==='launch')c.completed=true;
          update(s,'connecting','HOST_CONFIRMED_GAME_PROCESS_MEDIA_NOT_VERIFIED');
        }
        if(s.state==='reconnecting') {s.disconnectedAt=null;update(s,'connecting','HOST_RECONNECTED_MEDIA_NOT_VERIFIED');}
      } else if(s.state==='connecting'||s.state==='reconnecting') {
        if(s.state==='connecting'&&clock()-Date.parse(s.updatedAt)<5000)continue; // in-flight launch/heartbeat race
        update(s,'failed',activeGame?.state==='exited'&&activeGame.sessionId===s.id?'GAME_PROCESS_EXITED':'HOST_PROCESS_MISSING');
      }
    }
    expireHosts(hosts);
  }
  return {create,get,list,stop,nextCommands,report,heartbeat,expireHosts,exportState,restoreState};
}
