'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {collectBrowserCapabilities,makeBrowserCapabilityReport} from '../lib/lab/browser-capabilities.mjs';

export default function PlayerView({sessionId}) {
 const stage=useRef(null);
 const p0Id=/^p0-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(sessionId)?.[1];
 const localId=/^local-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(sessionId)?.[1];
 const controlId=p0Id||localId,localMode=Boolean(localId);
 const apiBase=localMode?'/api/v1/local':'/api/v1/p0';
 const [stopBusy,setStopBusy]=useState(false),[stopError,setStopError]=useState(null);
 const [embedMoonlight,setEmbedMoonlight]=useState(localMode);
 const [diagnostics,setDiagnostics]=useState(false),[browser,setBrowser]=useState(null);
 const [lab,setLab]=useState(null),[labError,setLabError]=useState(null);
 const updateLab=useCallback(async()=>{
  if(!controlId)return;
  try {
   const response=await fetch(apiBase+'/sessions/'+controlId,{cache:'no-store'});
   const body=await response.json();
   if(!response.ok)throw Error(body.code||'LAB_UNAVAILABLE');
   setLab(body.session);setLabError(null);
  }catch(e){setLab(null);setLabError(e.message)}
 },[controlId,apiBase]);
 useEffect(()=>{
  const inspect=()=>setBrowser(collectBrowserCapabilities({window,document,navigator,
    RTCPeerConnection:window.RTCPeerConnection,RTCRtpReceiver:window.RTCRtpReceiver,VideoDecoder:window.VideoDecoder}));
  inspect();const interval=setInterval(inspect,1200);
  window.addEventListener('gamepadconnected',inspect);window.addEventListener('gamepaddisconnected',inspect);
  return()=>{clearInterval(interval);window.removeEventListener('gamepadconnected',inspect);window.removeEventListener('gamepaddisconnected',inspect)};
 },[]);
 const exportBrowserReport=()=>{
  if(!browser)return;
  const report=makeBrowserCapabilityReport(browser,{sessionId:controlId});
  const blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='cloudplay-browser-capabilities.json';
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 useEffect(()=>{if(!controlId)return;updateLab();const timer=setInterval(updateLab,5000);return()=>clearInterval(timer)},[controlId,updateLab]);
 const canOpen=lab&&['connecting','reconnecting'].includes(lab.state);
 async function stopLocal(){
  if(!localId||stopBusy)return;
  setStopBusy(true);setStopError(null);
  try{
   const r=await fetch(apiBase+'/sessions/'+localId,{
    method:'DELETE',cache:'no-store',headers:{'X-CloudPlay-Local-Action':'1'}
   });
   const data=await r.json();
   if(!r.ok)throw Error(data.code||'GAME_STOP_FAILED');
   await updateLab();
  }catch(e){setStopError(e.message)}
  finally{setStopBusy(false)}
 }
 const localPlayerUrl=controlId?`${apiBase}/sessions/${controlId}/open`:null;
 return <main className="player-page">
  <div className="player-top"><Link href="/library">← 返回游戏库</Link><strong>CLOUDPLAY <span className="muted-text">/ PLAYER</span></strong><span className="status pending">{controlId?(lab?.state||'会话状态未取得'):'布局预览'}</span></div>
  <section ref={stage} className="player-stage">{localMode&&canOpen&&embedMoonlight?
   <iframe title="Moonlight Web 独立串流客户端" src={localPlayerUrl}
    allow="autoplay; fullscreen; gamepad; microphone; clipboard-read"
    allowFullScreen referrerPolicy="no-referrer"
    style={{display:'block',width:'100%',height:'100%',minHeight:430,border:0,background:'#080d18'}}/>
   :<div className="player-center">
   <div className="big-icon">▣</div>
   <h1>{localMode?'SuperTuxKart 本机游戏会话':p0Id?'P0 本机游戏播放入口':'等待真实云游戏会话'}</h1>
   <p>{controlId?'游戏已由本机 Agent 管理；视频由 Moonlight Web 独立客户端接收。首次需要登录并完成 Sunshine PIN 配对。启动游戏不代表视频已建立。':'当前没有 GPU 视频流。这里只展示播放器布局与浏览器能力，不会显示伪造画面。'}</p>
   {lab&&<p className="small-muted">会话：{lab.state}{lab.reason?' · '+lab.reason:''}。未自动检测视频、音频和输入。</p>}
   {labError&&<p className="warn-text">会话读取失败：{labError}</p>}
   {controlId&&canOpen&&<a className="btn primary" target="_blank" rel="noopener noreferrer" href={localPlayerUrl}>连接 Moonlight Web ↗</a>}
   {controlId&&!canOpen&&<span className="status pending">等待会话可连接</span>}{localMode&&lab&&!['finished','cancelled'].includes(lab.state)&&<button className="btn secondary" disabled={stopBusy} onClick={stopLocal}>{stopBusy?'正在请求结束…':'停止本机游戏'}</button>}
   {stopError&&<p className="warn-text" role="alert">停止失败：{stopError}</p>}
   <span className="status pending">NO VERIFIED MEDIA STREAM</span>
  </div>}</section>
  <div className="player-toolbar"><button className="btn secondary" onClick={()=>stage.current?.requestFullscreen?.()}>⛶ 全屏</button>{localMode&&canOpen&&<button className="btn secondary" onClick={()=>setEmbedMoonlight(v=>!v)}>{embedMoonlight?'显示连接说明':'在页面内打开 Moonlight'}</button>}
  {localMode&&canOpen&&<a className="btn secondary" href={localPlayerUrl} target="_blank" rel="noopener noreferrer">在独立标签页打开串流 ↗</a>}<button className="btn secondary" onClick={()=>setDiagnostics(v=>!v)}>◉ 浏览器诊断</button><Link className="btn secondary" href="/p0">查看 P0 主机连接步骤</Link>{controlId&&<a className="btn secondary" target="_blank" rel="noopener noreferrer" href={`http://127.0.0.1:7788/play/${controlId}`}>本机媒体诊断播放器 ↗</a>}<span className="toolbar-spacer"/><span className="muted-text">画质 / FPS / 延迟：尚无真实数据</span></div>
  {controlId&&<div className="panel diagnostic-panel"><div className="section-title">本机实验说明</div><p className="small-muted">现在由 P1 服务端校验会话后直接跳转 Moonlight Web，不再要求在中间控制页重复输入 P0 Token。仅限同一 Windows 主机的本地实验；浏览器中的 localhost 指向当前电脑。Moonlight Web 仍需独立登录、PIN 配对，不保证 WebRTC 连接成功。嵌入模式若被浏览器第三方 Cookie 或独立客户端安全策略阻止，请改为新标签页打开。</p></div>}
  {diagnostics&&<div className="panel diagnostic-panel">
    <div className="section-title">浏览器与输入诊断（不读取 Moonlight 实际媒体）</div>
    <p className="small-muted">这些是浏览器支持能力和本机手柄即时输入，不是 WebRTC 视频帧、音频、真实延迟或游戏是否收到输入的证据。独立 Moonlight Web 页面拥有自己的媒体连接，本站无法跨源获取它的统计。</p>
    {browser&&<>
      {[["安全上下文",browser.secureContext],["WebRTC API",browser.webRTC],["WebCodecs",browser.webCodecs],["Gamepad API",browser.gamepadAPI],["全屏",browser.fullscreen],["Pointer Lock",browser.pointerLock],["Keyboard Lock",browser.keyboardLock]].map(([name,ok])=><div key={name} className="spec-row"><span>{name}</span><strong className={ok?'success-text':'warn-text'}>{ok?'可用':'不可用 / 受限'}</strong></div>)}
      <div className="spec-row"><span>浏览器申报的视频编解码格式</span><strong>{browser.videoCodecs.length?browser.videoCodecs.join(', '):'未获得'}</strong></div>
      <div className="spec-row"><span>已识别本机手柄</span><strong>{browser.connectedGamepads} 个</strong></div>
      <div className="spec-row"><span>当前按键 / 摇杆活动</span><strong>{browser.buttonsPressed} / {browser.axesActive}</strong></div>
      <button className="btn secondary" onClick={exportBrowserReport}>下载浏览器诊断 JSON</button>
    </>}
  </div>}
 </main>;
}
