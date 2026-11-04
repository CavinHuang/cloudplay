import test from 'node:test';import assert from 'node:assert/strict';
import {GET as health} from '../app/api/v1/health/route.js';
import {GET as hosts} from '../app/api/v1/hosts/route.js';
import {POST as createSession, GET as sessions} from '../app/api/v1/sessions/route.js';
test('health reports catalog but no real GPU / auth', async()=>{const r=await health();const data=await r.json();assert.equal(r.status,200);assert.equal(data.gpu,'not_connected');assert.equal(data.auth,'not_configured')});
test('hosts and sessions are empty until real provider',async()=>{const [h,s]=await Promise.all([hosts(),sessions()]);assert.equal((await h.json()).data.length,0);assert.equal((await s.json()).meta.active,0)});
test('POST session cannot claim success without provider',async()=>{const r=await createSession(new Request('http://localhost/api/v1/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({gameId:'supertuxkart'})}));assert.equal(r.status,503);assert.equal((await r.json()).code,'SESSION_PROVIDER_NOT_CONFIGURED')});
test('reject malformed and non-json session requests',async()=>{const a=await createSession(new Request('http://localhost/api/v1/sessions',{method:'POST',body:'123'}));assert.equal(a.status,415);const b=await createSession(new Request('http://localhost/api/v1/sessions',{method:'POST',headers:{'content-type':'application/json'},body:'bad'}));assert.equal(b.status,400)});
