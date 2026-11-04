import test from 'node:test';
import assert from 'node:assert/strict';
import {safeGamepadInput,safeConnectedGamepads} from '../lib/lab/gamepad-mapping.mjs';
const buttons=Array.from({length:17},(_,i)=>({pressed:i===0||i===7,value:i===7?0.9:i===0?1:0}));
test('standard mapping labels A/RT and applies stick deadzone without identifying hardware',()=>{
 const s=safeGamepadInput({id:'PRIVATE-DEVICE-IDENTIFIER',mapping:'standard',buttons,axes:[.08,-.5,0,.8],index:1,timestamp:123456});
 assert.deepEqual(s.activeButtons.map(x=>x.label),['A / Cross','RT']);
 assert.deepEqual(s.leftStick,[0,-.5]);assert.deepEqual(s.rightStick,[0,.8]);
 assert.equal(s.inputDeliveredToGame,false);
 assert.ok(!JSON.stringify(s).includes('PRIVATE'));
});
test('unknown gamepad layout never assumes Xbox face-button layout',()=>{
 const s=safeGamepadInput({id:'PRIVATE',mapping:'',buttons,axes:[1,1]});
 assert.equal(s.mapping,'other');assert.equal(s.leftStick,null);
 assert.deepEqual(s.activeButtons.map(x=>x.label),['Button 0','Button 7']);
});
test('gamepad list is bounded and safely handles browsers without API',()=>{
 assert.deepEqual(safeConnectedGamepads({}),[]);
 assert.equal(safeConnectedGamepads({getGamepads:()=>Array.from({length:8},()=>({mapping:'standard',buttons:[],axes:[]}))}).length,4);
});
