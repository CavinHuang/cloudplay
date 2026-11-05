'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
function statusText(v){return v==='unverified'?'未核验':v==='pending-review'?'待人工审核':v==='approved'?'审核通过':v}
export default function GameDetail({game,p0LocalLab=false,localOperator=false}){
 const [preflight,setPreflight]=useState(null),[loading,setLoading]=useState(false);
 const [p0Session,setP0Session]=useState(null);
 const [localStatus,setLocalStatus]=useState(null);
 const [localBusy,setLocalBusy]=useState(false);
 const [localError,setLocalError]=useState(null);
 const localReady=Boolean(localStatus?.localLaunchEnabled &&
   localStatus?.hosts?.some(host=>host.infrastructureReady===true));
 useEffect(()=>{
  if(!localOperator)return;
  let mounted=true;
  const refresh=async()=>{
   try{
    const r=await fetch('/api/v1/local/status',{cache:'no-store'});
    if(!r.ok)throw Error('LOCAL_OPERATOR_UNAVAILABLE');
    const status=await r.json();
    if(mounted)setLocalStatus(status);
   }catch{if(mounted)setLocalStatus(null)}
  };
  refresh();const timer=setInterval(refresh,5000);
  return ()=>{mounted=false;clearInterval(timer)};
 },[localOperator]);
 async function startLocal(){
  if(!localOperator||!localReady||localBusy)return;
  setLocalBusy(true);setLocalError(null);
  try {
   const r=await fetch('/api/v1/local/sessions',{
    method:'POST',cache:'no-store',
    headers:{'Content-Type':'application/json','X-CloudPlay-Local-Action':'1'},
    body:JSON.stringify({gameId:'supertuxkart'})
   });
   const result=await r.json();
   if(!r.ok||!result?.session?.id||!/^[0-9a-f-]{36}$/i.test(result.session.id))
    throw Error(result?.code||'LOCAL_LAUNCH_FAILED');
   window.location.assign('/player/local-'+result.session.id);
  }catch(e){setLocalError(e.message);setLocalBusy(false)}
 }

 useEffect(()=>{
  if(!p0LocalLab)return;
  let active=true;
  const read=async()=>{try{
   const response=await fetch('/api/v1/p0/status',{cache:'no-store'});
   if(!response.ok)return;
   const status=await response.json();
   const matching=(status.sessions||[]).find(s=>s.gameId===game.id&&['connecting','reconnecting'].includes(s.state));
   if(active)setP0Session(matching||null);
  }catch{if(active)setP0Session(null)}};
  read();const interval=setInterval(read,6000);
  return()=>{active=false;clearInterval(interval)};
 },[p0LocalLab,game.id]);
 async function check(){setLoading(true);try{const res=await fetch(`/api/v1/preflight?gameId=${encodeURIComponent(game.id)}`,{cache:'no-store'});setPreflight(await res.json());}catch{setPreflight({ok:false,checks:[],code:'API_UNAVAILABLE'})}finally{setLoading(false)}}
 return <div className="page-stack"><div className="breadcrumb"><Link href="/library">LIBRARY</Link><span>›</span>{game.title}</div><section className="detail-hero"><div className="detail-background" style={{backgroundImage:`url(${game.coverUrl})`}}/><img className="poster" src={game.coverUrl} alt={`${game.title} 封面`}/><div className="detail-copy"><div className="eyebrow">GAME OVERVIEW · {game.platform.toUpperCase()}</div><h1>{game.title}</h1><div className="chips"><span>{game.genre}</span><span>{game.controller?'Controller':'Keyboard / Mouse'}</span><span>Browser Cloud Gaming</span></div><p>{game.description}</p><div className="detail-actions">{localOperator&&<button className="btn primary" onClick={startLocal} disabled={!localReady||localBusy}>{localBusy?'正在启动游戏…':localReady?'▶ 本机启动游戏':'等待 GPU 主机就绪'}</button>}<button className="btn primary" onClick={check} disabled={loading}>{loading?'正在检查…':'检查启动条件'}</button><Link href="/library" className="btn secondary">返回游戏库</Link>
 {p0LocalLab&&<Link href="/p0" className="btn secondary">P0 本机实验控制台</Link>}
 {p0LocalLab&&p0Session&&<Link href={`/player/p0-${p0Session.id}`} className="btn primary">继续本机测试会话 →</Link>}
 </div>{localOperator&&<p role="status" className={localError?'warn-text':'small-muted'}>{localError?'本机启动失败：'+localError:localReady?'GPU 主机已完成端口和游戏文件预检；点击启动后仍需使用 Moonlight Web 配对并验证实际画面。':'本机 Operator 已启用；等待 NVIDIA GPU、Sunshine、Moonlight Web 和 SuperTuxKart 的真实心跳。'}</p>}</div></section><div className="detail-bottom"><div className="panel"><div className="section-title">游戏简介</div><p>{game.collection==='candidate'?'已登记官方来源。此游戏尚未进入公共可玩游戏池，必须首先完成权利审查、节点安装、功能测试。':'本条目仅供还原原型中的视觉信息架构。我们尚未获取该商业游戏的云游戏托管许可，也没有将其装入云游戏节点。'}</p><div className="spec-row"><span>控制方式</span><strong>{game.controller?'支持手柄 / 键鼠':'键鼠（待实际验证）'}</strong></div><div className="spec-row"><span>目录性质</span><strong>{game.collection==='candidate'?'开源接入候选':'设计展示条目'}</strong></div>{game.officialUrl&&<a href={game.officialUrl} target="_blank" rel="noopener noreferrer" className="btn secondary">官方游戏资源</a>}</div><div className="panel"><div className="section-title">云游戏可用性</div><div className="spec-row"><span>托管许可</span><strong className="warn-text">{statusText(game.hostingRights)}</strong></div><div className="spec-row"><span>云端部署</span><strong>未安装</strong></div><div className="spec-row"><span>可用 GPU</span><strong>未接入</strong></div><div className="spec-row"><span>可启动状态</span><strong className="warn-text">不可启动</strong></div></div></div>{preflight&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setPreflight(null)}}><div className="modal" role="dialog" aria-modal="true" aria-label="启动预检"><div className="eyebrow">SESSION PREFLIGHT</div><h2>{preflight.ok?'可以启动':'暂时无法启动游戏'}</h2><p>以下为后端真实状态检查；不会把演示数据伪装成可玩状态。</p>{(preflight.checks||[]).map(c=><div className="spec-row" key={c.key}><span>{c.label}</span><strong className={c.ok?'success-text':'warn-text'}>{c.ok?'通过':'未通过'} · {c.detail}</strong></div>)}<div className="modal-actions"><button className="btn secondary" onClick={()=>setPreflight(null)}>关闭</button><Link href={`/player/preview?gameId=${game.id}`} className="btn secondary">仅预览播放器</Link></div></div></div>}</div>
}
