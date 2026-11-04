import test from 'node:test';import assert from 'node:assert/strict';
import {getGame,listGames} from '../lib/catalog.mjs';
test('catalog returns free games with accurate metadata',()=>{const items=listGames({free:true});assert.ok(items.length>0);assert.ok(items.every(v=>v.isFree));assert.ok(items.every(v=>v.playable===false))});
test('only native candidates in candidate filter',()=>{const items=listGames({collection:'candidate'});assert.equal(items.length,4);assert.ok(items.every(v=>v.hostingRights==='pending-review'))});
test('text filtering, genre and controller compose',()=>{const items=listGames({query:'kart',genre:'Racing',controller:true});assert.equal(items.length,1);assert.equal(items[0].slug,'supertuxkart')});
test('no unknown title is auto available',()=>assert.equal(getGame('fake'),null));
test('all cloud games are gated',()=>assert.ok(listGames().every(g=>!g.playable && !g.nodeInstalled)));
