import http from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {createSessionControl} from './session-control.mjs';
import {createSessionJournal} from './session-journal.mjs';
import {makeStreamHandoff,validateLocalStreamUrl,isSessionId} from './stream-handoff.mjs';

const MAX_BODY_BYTES = 12 * 1024;
const MONITOR_HTML = readFileSync(fileURLToPath(new URL('../../lab/monitor.html',import.meta.url)),'utf8');
const PLAYER_HTML = readFileSync(fileURLToPath(new URL('../../lab/player.html',import.meta.url)),'utf8');
const GAMEPAD_MAPPING_MODULE = readFileSync(fileURLToPath(new URL('./gamepad-mapping.mjs',import.meta.url)),'utf8');
const MEDIA_TELEMETRY_MODULE = readFileSync(fileURLToPath(new URL('./media-telemetry.mjs',import.meta.url)),'utf8');
const MEDIA_EVIDENCE_MODULE = readFileSync(fileURLToPath(new URL('./media-evidence.mjs',import.meta.url)),'utf8');
const MEDIA_HANDOFF_MODULE = readFileSync(fileURLToPath(new URL('./stream-handoff.mjs',import.meta.url)),'utf8');
const DIAGNOSTICS_HTML = readFileSync(fileURLToPath(new URL('../../scripts/p0/browser-preflight.html',import.meta.url)),'utf8');
const HOST_ID_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

function constantTimeToken(expected, candidate) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(candidate));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function validateHeartbeat(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (typeof payload.hostId !== 'string' || !HOST_ID_PATTERN.test(payload.hostId)) return null;
  if (!payload.gpu || typeof payload.gpu !== 'object' || typeof payload.gpu.detected !== 'boolean') return null;
  for (const name of ['sunshinePortOpen', 'webStreamPortOpen', 'gameFilePresent']) {
    if (typeof payload[name] !== 'boolean') return null;
  }
  const activeGame = payload.activeGame && typeof payload.activeGame === 'object' &&
    /^[a-f0-9-]{36}$/i.test(payload.activeGame.sessionId || '') &&
    ['running','exited'].includes(payload.activeGame.state) ? {sessionId:payload.activeGame.sessionId,state:payload.activeGame.state} : null;
  return {
    activeGame, hostId: payload.hostId,
    gpu: {
      detected: payload.gpu.detected,
      // Only store coarse model name; never persist a full diagnostic command output.
      model: typeof payload.gpu.model === 'string' ? payload.gpu.model.slice(0, 100) : null,
    },
    sunshinePortOpen: payload.sunshinePortOpen,
    webStreamPortOpen: payload.webStreamPortOpen,
    gameFilePresent: payload.gameFilePresent,
    agentVersion: typeof payload.agentVersion === 'string' ? payload.agentVersion.slice(0, 40) : 'unknown',
  };
}

export function createCoordinator({ token, clock = () => Date.now(), ttlMs = 16000, launchEnabled = false, reconnectGraceMs = 30000, streamUrl = 'http://127.0.0.1:8080/', journalPath = null } = {}) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('CLOUDPLAY_LAB_TOKEN must be at least 32 characters');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 2000) throw new Error('Invalid TTL');
  // Resolve P0 stream origin on server startup, never from browser input.
  const localStreamUrl = validateLocalStreamUrl(streamUrl);
  const hosts = new Map();
  const journal = journalPath ? createSessionJournal(journalPath) : null;
  const control = createSessionControl({clock, ttlMs, reconnectGraceMs, onChange: snapshot => journal?.save(snapshot)});
  if(journal){const saved=journal.load();if(saved)control.restoreState(saved);}
  const authorization = value => typeof value === 'string' && value.startsWith('Bearer ') && constantTimeToken(token, value.slice(7));
  const getStatus = () => {
    const now = clock();
    const active = Array.from(hosts.values()).filter(x => now - x.receivedAt < ttlMs)
      .map(x => ({
        hostId: x.hostId,
        lastSeenAt: new Date(x.receivedAt).toISOString(),
        ageMs: Math.max(0, now - x.receivedAt),
        gpu: x.gpu,
        sunshinePortOpen: x.sunshinePortOpen,
        webStreamPortOpen: x.webStreamPortOpen,
        gameFilePresent: x.gameFilePresent,
        agentVersion: x.agentVersion,
        activeGame: x.activeGame,
        // Port status only. Not proof of successful PIN pairing, playback or playable game.
        infrastructureReady: x.gpu.detected && x.sunshinePortOpen && x.webStreamPortOpen && x.gameFilePresent,
      }));
    return { connected: active.length > 0, hosts: active, sessions:control.list(hosts), localLaunchEnabled:launchEnabled,
      coordinatorRecovery:journal?'persistent-session-journal':'in-memory-only',
      source: 'authenticated-host-agent-heartbeat', ttlMs, streamVerified: false, message: active.length ? '主机检查已上报；尚未验证真实视频流' : '未收到有效主机心跳' };
  };
  const reply = (res, code, body) => {
    res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(JSON.stringify(body));
  };
  async function readJson(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) return {error:{status:415,code:'JSON_REQUIRED'}};
    const chunks=[];let count=0;
    try {for await(const chunk of req){count+=chunk.length;if(count>MAX_BODY_BYTES)return {error:{status:413,code:'BODY_TOO_LARGE'}};chunks.push(chunk);}
      return {body:JSON.parse(Buffer.concat(chunks).toString('utf8'))};
    } catch {return {error:{status:400,code:'INVALID_JSON'}};}
  }
  const listener = async (req, res) => {
    // Reject DNS rebinding hostnames. P0 is a localhost-only lab, not a service
    // behind public reverse proxies. The Agent uses 127.0.0.1 explicitly.
    if (!/^127\.0\.0\.1:\d{2,5}$/.test(req.headers.host || ''))
      return reply(res,403,{code:'INVALID_LOCAL_HOST'});
    if (['POST','PUT','PATCH','DELETE'].includes(req.method) && req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}`)
      return reply(res,403,{code:'INVALID_ORIGIN'});
    if (req.url === '/health' && req.method === 'GET') return reply(res, 200, { service: 'cloudplay-p0-lab', status: 'running', streamVerified: false });
    if (req.method === 'GET' && ['/assets/media-telemetry.mjs','/assets/media-evidence.mjs','/assets/stream-handoff.mjs','/assets/gamepad-mapping.mjs'].includes(req.url)) {
      res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
      return res.end(req.url==='/assets/media-telemetry.mjs'?MEDIA_TELEMETRY_MODULE:req.url==='/assets/media-evidence.mjs'?MEDIA_EVIDENCE_MODULE:req.url==='/assets/gamepad-mapping.mjs'?GAMEPAD_MAPPING_MODULE:MEDIA_HANDOFF_MODULE);
    }
    if (req.url === '/diagnostics' && req.method === 'GET') {
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'Content-Security-Policy':"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"});
      return res.end(DIAGNOSTICS_HTML);
    }
    if (req.url === '/monitor' && req.method === 'GET') {res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'"});return res.end(MONITOR_HTML);}
    const playMatch = /^\/play\/([0-9a-f-]{36})$/i.exec(req.url || '');
    if (playMatch && req.method === 'GET' && isSessionId(playMatch[1])) {
      res.writeHead(200, {
        'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'X-Frame-Options':'DENY',
        'Content-Security-Policy': `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src ${new URL(localStreamUrl).origin}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
      });
      return res.end(PLAYER_HTML.replaceAll('__SESSION_ID__', playMatch[1]));
    }
    if (!authorization(req.headers.authorization)) return reply(res, 401, {code: 'UNAUTHORIZED'});
    if (req.url === '/internal/status' && req.method === 'GET') return reply(res, 200, getStatus());
    if (req.url === '/internal/heartbeat' && req.method === 'POST') {
      const {body,error}=await readJson(req);
      if(error)return reply(res,error.status,{code:error.code});
      const payload=validateHeartbeat(body);
      if(!payload)return reply(res,422,{code:'INVALID_HEARTBEAT'});
      hosts.set(payload.hostId,{...payload,receivedAt:clock()});
      control.heartbeat(payload.hostId,payload.activeGame,hosts);
      return reply(res,202,{accepted:true,streamVerified:false});
    }
    if(req.url?.startsWith('/internal/commands?')&&req.method==='GET') {
      const u=new URL(req.url,'http://127.0.0.1');
      const hostId=u.searchParams.get('hostId');
      if(!hostId||!HOST_ID_PATTERN.test(hostId))return reply(res,400,{code:'INVALID_HOST_ID'});
      return reply(res,200,{commands:control.nextCommands(hostId,hosts)});
    }
    if(req.url==='/internal/command-results'&&req.method==='POST') {
      const {body,error}=await readJson(req);if(error)return reply(res,error.status,{code:error.code});
      const result=control.report(body);return reply(res,result.status,result);
    }
    if(req.url==='/internal/lab/sessions'&&req.method==='GET')return reply(res,200,{sessions:control.list(hosts),streamVerified:false,localLaunchEnabled:launchEnabled});
    if(req.url==='/internal/lab/sessions'&&req.method==='POST') {
      const {body,error}=await readJson(req);if(error)return reply(res,error.status,{code:error.code});
      if(!body||typeof body!=='object'||typeof body.hostId!=='string'||typeof body.gameId!=='string')return reply(res,422,{code:'INVALID_SESSION_REQUEST'});
      const result=control.create({gameId:body.gameId,hostId:body.hostId,hosts,enabled:launchEnabled});
      return reply(res,result.status,result);
    }
    const match=/^\/internal\/lab\/sessions\/([a-f0-9-]{36})$/i.exec(req.url||'');
    if(match&&req.method==='GET') {
      const session=control.get(match[1],hosts);
      return session?reply(res,200,{session}):reply(res,404,{code:'SESSION_NOT_FOUND'});
    }
    const streamMatch = /^\/internal\/lab\/sessions\/([0-9a-f-]{36})\/stream-handoff$/i.exec(req.url||'');
    if(streamMatch&&req.method==='GET'&&isSessionId(streamMatch[1])) {
      const session=control.get(streamMatch[1],hosts);
      const host=session && hosts.get(session.hostId);
      const handoff=makeStreamHandoff({session,host,now:clock(),ttlMs,streamUrl:localStreamUrl});
      const {status,...safe}=handoff;return reply(res,status,safe);
    }
    if(match&&req.method==='DELETE') {
      const result=control.stop(match[1],hosts);return reply(res,result.status,result);
    }
    return reply(res, 404, {code: 'NOT_FOUND'});
  };
  return {listener, getStatus, control, server: http.createServer(listener)};
}
