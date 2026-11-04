'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
const checks=[
 ['gpuDetected','GPU 已识别'],
 ['sunshinePortOpen','Sunshine 47990 端口'],
 ['webStreamPortOpen','Web Stream 8080 端口'],
 ['gameFilePresent','SuperTuxKart 可执行文件'],
];
export default function P0StatusPanel(){
 const [status,setStatus]=useState(null),[loading,setLoading]=useState(true);
 const refresh=useCallback(async()=>{
  setLoading(true);
  try{const response=await fetch('/api/v1/p0/status',{cache:'no-store'});setStatus(await response.json())}
  catch{setStatus({connected:false,hosts:[],streamVerified:false,message:'无法读取本地联调状态'})}
  finally{setLoading(false)}
 },[]);
 useEffect(()=>{refresh();const timer=setInterval(refresh,12000);return ()=>clearInterval(timer)},[refresh]);
 const host=status?.hosts?.[0];
 const sessions=status?.sessions||[];
 return <section className="panel p0-live-status" aria-live="polite">
  <div className="p0-status-heading"><div><div className="section-title">P0 主机实时上报 <span>每 12 秒刷新</span></div><p className="small-muted">以下是本地主机 Agent 的端口/文件检查，<strong>不是</strong>已经建立视频连接的证明。</p></div><button type="button" className="btn secondary" onClick={refresh} disabled={loading}>刷新状态</button></div>
  <div className="p0-check-grid">{checks.map(([key,label])=><div key={key} className="p0-check"><span>{label}</span><strong className={host?.[key]?'success-text':'warn-text'}>{!status?'读取中':!status.connected?'未上报':host?.[key]?'已检测':'未就绪'}</strong></div>)}</div>
  {sessions.length>0&&<div className="panel" style={{marginTop:16}}><div className="section-title">本地 P0 会话（非已验证的视频流）</div>{sessions.map(s=><div className="spec-row" key={s.id}><span>{s.gameId} · {s.id.slice(0,8)} · <Link href={'/player/p0-'+s.id}>查看会话 / Web 播放入口</Link></span><strong>{s.state}{s.reason?' · '+s.reason:''}</strong></div>)}</div>}
  <div className="notice notice-warning" style={{marginTop:16}}>
   <strong>实时串流：</strong>{status?.streamVerified?'已验证':'尚未验证'}。{status?.message||'正在查询本地协调器。'}
   {host?.lastSeenAt&&<div className="small-muted">最后心跳：{new Date(host.lastSeenAt).toLocaleString()}</div>}
  </div>
 </section>
}
