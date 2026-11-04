import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoordinator} from '../lib/lab/coordinator.mjs';

const token='diagnostic-test-token-123456789012345';
test('P0 diagnostics is a standalone local page with strict CSP, no fake real-media metrics',async t=>{
 const c=createCoordinator({token});
 await new Promise(r=>c.server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>c.server.close(r)));
 const port=c.server.address().port;
 const res=await fetch(`http://127.0.0.1:${port}/diagnostics`);
 assert.equal(res.status,200);
 assert.equal(res.headers.get('cache-control'),'no-store');
 assert.match(res.headers.get('content-security-policy'),/default-src 'none'/);
 const html=await res.text();assert.match(html,/getGamepads/);assert.match(html,/mediaVerified:false/);
 assert.match(html,/视频编解码格式/);
 assert.equal(html.includes('CLOUDPLAY_LAB_TOKEN'),false);
});
