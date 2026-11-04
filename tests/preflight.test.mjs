import test from 'node:test';import assert from 'node:assert/strict';
import {preflight} from '../lib/preflight.mjs';
test('preflight fails closed when host and streaming provider missing',()=>{const p=preflight('supertuxkart');assert.equal(p.ok,false);assert.equal(p.checks.length,5);assert.ok(p.checks.some(v=>v.key==='rights'&&!v.ok));assert.ok(p.checks.some(v=>v.key==='host'&&!v.ok))});
test('cannot bypass rights and installation by supplying healthy host',()=>{const p=preflight('supertuxkart',{hosts:[{ready:true}],streamProviderReady:true});assert.equal(p.ok,false);assert.equal(p.checks.filter(v=>!v.ok).length,2)});
test('unknown game rejected',()=>assert.equal(preflight('__unknown__').code,'GAME_NOT_FOUND'));
