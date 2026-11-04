import test from 'node:test';import assert from 'node:assert/strict';
import {createSessionRequest,transition} from '../lib/session-machine.mjs';
test('state machine supports a complete lifecycle',()=>{let s=createSessionRequest('supertuxkart');for(const state of ['allocating','starting','connecting','streaming','stopping','finished'])s=transition(s,state);assert.equal(s.state,'finished');assert.equal(s.events.length,6)});
test('cannot jump directly into streaming or restart a finished session',()=>{const s=createSessionRequest('supertuxkart');assert.throws(()=>transition(s,'streaming'),/Invalid session transition/);const f=transition(s,'failed');assert.throws(()=>transition(f,'requested'))});
test('reconnection path returns to streaming',()=>{let s=createSessionRequest('supertuxkart');for(const to of ['allocating','starting','connecting','streaming','reconnecting','streaming'])s=transition(s,to);assert.equal(s.state,'streaming')});
