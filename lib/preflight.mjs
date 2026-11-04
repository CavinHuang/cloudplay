import {getGame} from './catalog.mjs';
export function preflight(gameId, {hosts=[],streamProviderReady=false}={}) {
  const game=getGame(gameId);
  if(!game) return {ok:false,gameId,checks:[],code:'GAME_NOT_FOUND'};
  const checks=[
    {key:'catalog',label:'游戏目录',ok:true,detail:'已登记'},
    {key:'rights',label:'托管权利审核',ok:game.hostingRights==='approved',detail:game.hostingRights},
    {key:'install',label:'主机游戏安装',ok:game.nodeInstalled,detail:game.nodeInstalled?'已安装':'未安装'},
    {key:'host',label:'可用 GPU 节点',ok:hosts.some(h=>h.ready===true),detail:hosts.some(h=>h.ready===true)?'有可用主机':'没有已连接主机'},
    {key:'stream',label:'串流适配器',ok:streamProviderReady,detail:streamProviderReady?'已配置':'未接入'}
  ];
  return {ok:checks.every(c=>c.ok),gameId,checks,code:checks.every(c=>c.ok)?'READY':'NOT_READY'};
}
