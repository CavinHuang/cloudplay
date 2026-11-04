'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {collectBrowserCapabilities,makeBrowserCapabilityReport} from '../lib/lab/browser-capabilities.mjs';

export default function PlayerView({sessionId}) {
 const stage=useRef(null);
 const p0Id=/^p0-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(sessionId)?.[1];
 const [diagnostics,setDiagnostics]=useState(false),[browser,setBrowser]=useState(null);
 const [lab,setLab]=useState(null),[labError,setLabError]=useState(null);
 const updateLab=useCallback(async()=>{
  if(!p0Id)return;
  try {
   const response=await fetch('/api/v1/p0/sessions/'+p0Id,{cache:'no-store'});
   const body=await response.json();
   if(!response.ok)throw Error(body.code||'LAB_UNAVAILABLE');
   setLab(body.session);setLabError(null);
  }catch(e){setLab(null);setLabError(e.message)}
 },[p0Id]);
 useEffect(()=>{
  const inspect=()=>setBrowser(collectBrowserCapabilities({window,document,navigator,
    RTCPeerConnection:window.RTCPeerConnection,RTCRtpReceiver:window.RTCRtpReceiver,VideoDecoder:window.VideoDecoder}));
  inspect();const interval=setInterval(inspect,1200);
  window.addEventListener('gamepadconnected',inspect);window.addEventListener('gamepaddisconnected',inspect);
  return()=>{clearInterval(interval);window.removeEventListener('gamepadconnected',inspect);window.removeEventListener('gamepaddisconnected',inspect)};
 },[]);
 const exportBrowserReport=()=>{
  if(!browser)return;
  const report=makeBrowserCapabilityReport(browser,{sessionId:p0Id});
  const blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='cloudplay-browser-capabilities.json';
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 useEffect(()=>{if(!p0Id)return;updateLab();const timer=setInterval(updateLab,5000);return()=>clearInterval(timer)},[p0Id,updateLab]);
 const canOpen=lab&&['connecting','reconnecting'].includes(lab.state);
 const localPlayerUrl=p0Id?`/api/v1/p0/sessions/${p0Id}/open`:null;
 return <main className="player-page">
  <div className="player-top"><Link href="/library">← 返回游戏库</Link><strong>CLOUDPLAY <span className="muted-text">/ PLAYER</span></strong><span className="status pending">{p0Id?(lab?.state||'P0 状态未取得'):'布局预览'}</span></div>
  <section ref={stage} className="player-stage"><div className="player-center">
   <div className="big-icon">▣</div>
   <h1>{p0Id?'P0 本机游戏播放入口':'等待真实云游戏会话'}</h1>
   <p>{p0Id?'本页只查询实际会话状态，视频由 Moonlight Web 独立客户端接收。游戏进程启动不代表 WebRTC 串流成功。':'当前没有 GPU 视频流。这里只展示播放器布局与浏览器能力，不会显示伪造画面。'}</p>
   {lab&&<p className="small-muted">会话：{lab.state}{lab.reason?' · '+lab.reason:''}。未自动检测视频、音频和输入。</p>}
   {labError&&<p className="warn-text">会话读取失败：{labError}</p>}
   {p0Id&&canOpen&&<a className="btn primary" target="_blank" rel="noopener noreferrer" href={localPlayerUrl}>连接 Moonlight Web ↗</a>}
   {p0Id&&!canOpen&&<span className="status pending">等待会话可连接</span>}
   <span className="status pending">NO VERIFIED MEDIA STREAM</span>
  </div></section>
  <div className="player-toolbar"><button className="btn secondary" onClick={()=>stage.current?.requestFullscreen?.()}>⛶ 全屏</button><button className="btn secondary" onClick={()=>setDiagnostics(v=>!v)}>◉ 浏览器诊断</button><Link className="btn secondary" href="/p0">查看 P0 主机连接步骤</Link>{p0Id&&<a className="btn secondary" target="_blank" rel="noopener noreferrer" href={`http://127.0.0.1:7788/play/${p0Id}`}>本机媒体诊断播放器 ↗</a>}<span className="toolbar-spacer"/><span className="muted-text">画质 / FPS / 延迟：尚无真实数据</span></div>
  {p0Id&&<div className="panel diagnostic-panel"><div className="section-title">本机实验说明</div><p className="small-muted">现在由 P1 服务端校验会话后直接跳转 Moonlight Web，不再要求在中间控制页重复输入 P0 Token。仅限同一 Windows 主机的本地实验；浏览器中的 localhost 指向当前电脑。Moonlight Web 仍需独立登录、PIN 配对，不保证 WebRTC 连接成功。</p></div>}
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
