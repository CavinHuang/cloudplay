import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostConnections} from '../lib/m2/host-connections.mjs';

const good={gpuDetected:true,sunshineReady:true,moonlightReady:true,
 gameAvailable:true,drain:false,gameProcessBusy:false};
const hello={protocol:'cloudplay.m2.host-connection.v1'};
test('host connection generations fence old process heartbeats and repeated sequences',()=>{
 const replacements=[];
 const connections=createHostConnections({onConnect:host=>replacements.push(host)});
 const missing=connections.heartbeat('registered01',good);
 assert.deepEqual(missing,{status:409,code:'HOST_CONNECTION_REQUIRED'});
 const first=connections.connect('registered01',hello);
 assert.equal(first.status,201);
 assert.equal(first.nextSequence,1);
 assert.equal(first.gameLaunchEnabled,false);
 assert.deepEqual(replacements,['registered01']);
 const send=(id,sequence,flags=good)=>connections.heartbeat('registered01',
  {...flags,connectionId:id,sequence});
 const accepted=send(first.connectionId,1);
 assert.equal(accepted.status,202);
 assert.deepEqual(accepted.report,good);
 assert.equal(send(first.connectionId,1).code,'HOST_HEARTBEAT_REPLAYED');
 assert.equal(send(first.connectionId,0).status,422);
 assert.equal(send(first.connectionId,2,{...good,gpuModel:'not-allowed'}).status,422);
 assert.equal(send(first.connectionId,2).status,202);
 assert.equal(send(first.connectionId,1).code,'HOST_HEARTBEAT_REPLAYED');
 const second=connections.connect('registered01',hello);
 assert.equal(second.status,201);
 assert.notEqual(first.connectionId,second.connectionId);
 assert.equal(send(first.connectionId,3).code,'HOST_CONNECTION_FENCED');
 assert.equal(send(second.connectionId,1).status,202);
 assert.equal(connections.heartbeat('registered01',good,{allowLegacy:true}).status,422);
 assert.deepEqual(replacements,['registered01','registered01']);
 connections.forget('registered01');
 assert.equal(send(second.connectionId,2).code,'HOST_CONNECTION_REQUIRED');
});
test('legacy static hosts stay backwards compatible until opting into fenced connection',()=>{
 const connections=createHostConnections();
 assert.equal(connections.heartbeat('legacy01',good,{allowLegacy:true}).status,202);
 assert.equal(connections.heartbeat('registered01',good,{allowLegacy:false}).code,'HOST_CONNECTION_REQUIRED');
 const conn=connections.connect('legacy01',hello);
 assert.equal(conn.status,201);
 assert.equal(connections.heartbeat('legacy01',good,{allowLegacy:true}).status,422);
 assert.equal(connections.heartbeat('legacy01',{...good,connectionId:conn.connectionId,sequence:1},{allowLegacy:true}).status,202);
});
test('failed durable cleanup must not fence the active host process',()=>{
 let fail=false;
 const connections=createHostConnections({onConnect:()=>{
  if(fail)throw Error('disk full');
 }});
 const first=connections.connect('hostAlpha',hello);
 assert.equal(first.status,201);
 fail=true;
 assert.equal(connections.connect('hostAlpha',hello).code,'M2_JOURNAL_UNAVAILABLE');
 assert.equal(connections.heartbeat('hostAlpha',{...good,
  connectionId:first.connectionId,sequence:1}).status,202);
 assert.equal(connections.connect('hostAlpha',{protocol:'wrong'}).status,422);
 assert.equal(connections.connect('hostAlpha',{...hello,unexpected:true}).status,422);
 assert.equal(connections.connect('bad/host',hello).status,422);
});
