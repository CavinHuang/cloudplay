// Read-only local input mapping; NEVER forwards commands to Moonlight or the game.
// 'standard' follows the W3C Gamepad mapping, not an arbitrary vendor layout.
const BUTTONS=['A / Cross','B / Circle','X / Square','Y / Triangle','LB','RB','LT','RT',
  'Back','Start','L3','R3','D-Pad Up','D-Pad Down','D-Pad Left','D-Pad Right','Home'];
const scalar=(value)=>Number.isFinite(value)?Math.round(Math.max(-1,Math.min(1,value))*100)/100:0;
export function safeGamepadInput(gamepad,{deadzone=0.16}={}){
 if(!gamepad||typeof gamepad!=='object')return null;
 const standard=gamepad.mapping==='standard';
 const buttons=Array.from(gamepad.buttons||[]).slice(0,32);
 const axes=Array.from(gamepad.axes||[]).slice(0,16);
 const activeButtons=buttons.flatMap((button,i)=>button?.pressed||Number(button?.value)>=0.5?
   [{index:i,label:standard&&i<BUTTONS.length?BUTTONS[i]:`Button ${i}`}]:[]);
 const stick=arr=>arr.map(x=>Math.abs(scalar(x))>=deadzone?scalar(x):0);
 return {mapping:standard?'standard':'other',buttonCount:buttons.length,axisCount:axes.length,
   activeButtons:activeButtons.slice(0,20),leftStick:standard?stick([axes[0],axes[1]]):null,
   rightStick:standard?stick([axes[2],axes[3]]):null,
   // Never emit gamepad.id, index, timestamp, vibration or vendor/manufacturer info.
   inputDeliveredToGame:false,source:'local-gamepad-api-only'};
}
export function safeConnectedGamepads(navigatorLike){
 let pads=[];try{pads=Array.from(navigatorLike?.getGamepads?.()||[]).filter(Boolean)}catch{}
 return pads.slice(0,4).map(p=>safeGamepadInput(p));
}
