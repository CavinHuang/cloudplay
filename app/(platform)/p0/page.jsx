import {notFound} from 'next/navigation';
import {isP0UiEnabled} from '../../../lib/lab/ui-access.mjs';
import P0StatusPanel from '@/components/P0StatusPanel';
export const metadata={title:'P0 Stream Validation · CloudPlay'};
export const dynamic='force-dynamic';
export default function P0(){
 if(!isP0UiEnabled())notFound();
 let streamUrl=null;
 try {
  const u=new URL(process.env.P0_STREAM_URL||'');
  if((u.protocol==='https:' || ((u.hostname==='localhost'||u.hostname==='127.0.0.1') && u.protocol==='http:')) && !u.username && !u.password) streamUrl=u.toString();
 } catch {}
 return <div className="page-stack">
   <div className="eyebrow">P0 / HOST INTEGRATION</div>
   <div className="page-title"><h1>真实串流验证</h1><p>从 Windows GPU 主机采集实际状态，再通过 Moonlight Web Stream 检查游戏画面。</p></div>
   <P0StatusPanel/>
   <div className="panel"><div className="section-title">本机实验会话控制</div><p className="small-muted">游戏启动/停止只允许在本机受 Token 保护的 P0 控制页执行，默认禁用。即使游戏进程已启动，CloudPlay 也不会显示虚假的 WebRTC 连接状态。</p><a className="btn secondary" href="http://127.0.0.1:7788/monitor" target="_blank" rel="noopener noreferrer">打开本机 P0 会话控制台 ↗</a></div>
   <div className="panel"><div className="section-title">四步启动验证</div><ol className="steps">
     <li>在 Windows 上运行 <code>scripts/p0/start-p0-lab.ps1</code>，启动本地控制服务与诊断 Agent。</li>
     <li>安装并启动 Sunshine，访问 <code>https://localhost:47990</code> 完成管理员设置。</li>
     <li>安装 SuperTuxKart，并在 Sunshine 的 Applications 页面添加游戏启动项。</li>
     <li>启动 Moonlight Web Stream，打开 <code>http://localhost:8080</code>；登录、配对，然后启动游戏、测试真实视频/声音/输入。</li>
   </ol><p className="small-muted">详细配置、错误排查与验收命令：docs/P0-LAB-RUNBOOK.md。不要将 47990 管理端口暴露到公网。</p>
   {streamUrl&&<a className="btn primary" href={streamUrl} rel="noopener noreferrer" target="_blank">打开独立认证的串流客户端 ↗</a>}
   </div>
   <div className="notice">P0 的 Windows 主机心跳不会自动使游戏变成“Playable”。只有在实际记录画面、音频、操作与关闭证据后，才能人工标记该主机测试通过；公开游戏库仍受权利许可和会话管理约束。</div>
 </div>;
}
