'use client';
import {useEffect,useState} from 'react';
import {makeLocalManualEvidence} from '../lib/lab/local-media-session.mjs';

const manualLabels=[
 ['videoObserved','我亲眼看到真实游戏画面持续变化'],
 ['audioObserved','我实际听到了游戏声音'],
 ['keyboardOrControllerObserved','我用键鼠或手柄成功控制了游戏'],
 ['successfulExitObserved','游戏已退出，我检查了进程与资源回收'],
 ['disconnectReconnectObserved','我确实经历了 ICE 断开并重新恢复画面（第三轮）'],
];
function downloadJson(name,payload){
 const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=name;a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function value(v){return v==null?'未获得真实统计':String(v)}
export default function LocalMediaEvidencePanel({sessionId,sessionState,mediaSnapshot,exportMedia}){
 const [cycle,setCycle]=useState('1');
 const [checks,setChecks]=useState({});
 const [notice,setNotice]=useState(null);
 useEffect(()=>{setChecks({});setCycle('1');setNotice(null)},[sessionId]);
 if(!sessionId)return null;
 const stats=mediaSnapshot?.stats;
 const exportRecorded=()=>{
  const report=exportMedia();
  if(!report)return setNotice('尚无本机媒体采样，请先打开嵌入式 Moonlight Web');
  downloadJson('cycle-'+cycle+'-media.json',report);
  setNotice(report.assessment?.decodedVideoObserved?'媒体采样已导出；仍需人工确认画面和声音':'已导出未通过媒体采样；未发现足够的实际视频帧增长');
 };
 const exportWitness=()=>{
  const report=makeLocalManualEvidence({sessionId,checks});
  downloadJson('cycle-'+cycle+'-manual.json',report);
  setNotice('人工观察记录已导出。请独立截取并脱敏保存 cycle-'+cycle+'.png，再运行 M1 校验器');
 };
 return <section className="panel diagnostic-panel" aria-label="M1 实际媒体采样与人工验收">
  <div className="section-title">M1 · Moonlight 真实媒体统计与证据</div>
  <p className="small-muted">只接受嵌入式、已集成诊断桥接的 Moonlight Web，通过随机会话挑战与来源校验回传的 WebRTC 计数。独立标签页无法共享统计。所有导出在本机完成，不上传凭据、SDP 或候选 IP；数值不代表实际画面可见、声音可听或输入成功。</p>
  <div className="spec-row"><span>统计状态</span><strong>{mediaSnapshot?.state||'未连接诊断桥接'}</strong></div>
  <div className="spec-row"><span>解码视频帧</span><strong>{value(stats?.video?.framesDecoded)}</strong></div>
  <div className="spec-row"><span>视频帧率</span><strong>{value(stats?.video?.framesPerSecond)}</strong></div>
  <div className="spec-row"><span>音频接收字节</span><strong>{value(stats?.audio?.bytesReceived)}</strong></div>
  <div className="spec-row"><span>ICE / Peer</span><strong>{stats?stats.iceConnectionState+' / '+stats.connectionState:'未检测'}</strong></div>
  <div className="spec-row"><span>候选对 RTT（非操作延迟）</span><strong>{value(stats?.network?.roundTripTimeMs)}{stats?.network?.roundTripTimeMs!=null?' ms':''}</strong></div>
  {mediaSnapshot?.advice&&<p className="small-muted">{mediaSnapshot.advice}</p>}
  <p className="small-muted">会话：{sessionState||'读取中'}。选择本轮编号后保存两个 JSON，并另行保存一张脱敏的游戏画面截图；每一轮必须使用不同的真实会话 ID。</p>
  <div className="player-toolbar">
   <label htmlFor="local-evidence-cycle">证据轮次</label>
   <select id="local-evidence-cycle" value={cycle} onChange={e=>setCycle(e.target.value)}>
    <option value="1">第 1 轮</option><option value="2">第 2 轮</option><option value="3">第 3 轮（断线恢复）</option>
   </select>
   <button className="btn secondary" type="button" onClick={exportRecorded}>导出 cycle-{cycle}-media.json</button>
  </div>
  <p className="small-muted">以下选项完全由操作者填写，永远不会根据视频帧或端口自动勾选。请在真实观察完成后再导出。</p>
  {manualLabels.map(([key,label])=><label key={key} style={{display:'flex',alignItems:'center',gap:9,margin:'8px 0'}}>
   <input type="checkbox" checked={checks[key]===true} onChange={e=>setChecks(prev=>({...prev,[key]:e.target.checked}))}/>{label}
  </label>)}
  <button className="btn secondary" type="button" onClick={exportWitness}>导出 cycle-{cycle}-manual.json</button>
  {notice&&<p role="status" className="small-muted">{notice}</p>}
 </section>;
}
