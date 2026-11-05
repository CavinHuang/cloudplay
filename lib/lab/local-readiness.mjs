// Privacy-preserving local operator readiness model for the single-machine M1 UI.
// Matches the Coordinator gateway's "exactly one infrastructure-ready host" rule.
// These are preflight observations, never proof of playable video/audio/input.
export function assessLocalReadiness(status){
  const hosts=Array.isArray(status?.hosts)?status.hosts.filter(h=>h&&typeof h==='object'):[];
  const eligible=hosts.filter(h=>h.infrastructureReady===true);
  const host=eligible.length===1?eligible[0]:hosts.length===1?hosts[0]:null;
  const checks=[
    {key:'operator',label:'本机启动授权',ok:status?.localLaunchEnabled===true,
      hint:'使用 start-active.ps1 -EnableLocalLaunch -GamePath 启动'},
    {key:'agent',label:'Host Agent 心跳',ok:status?.connected===true&&hosts.length>0,
      hint:'检查 Coordinator 7788 与 Host Agent 是否正常启动'},
    {key:'gpu',label:'NVIDIA GPU',ok:host?.gpuDetected===true,
      hint:'检查 NVIDIA 驱动及 nvidia-smi'},
    {key:'sunshine',label:'Sunshine',ok:host?.sunshinePortOpen===true,
      hint:'启动 Sunshine，并确认本机服务可访问'},
    {key:'moonlight',label:'Moonlight Web',ok:host?.webStreamPortOpen===true,
      hint:'检查本机 8080 端口上的 Moonlight Web'},
    {key:'game',label:'SuperTuxKart',ok:host?.gameFilePresent===true,
      hint:'通过 -GamePath 指向合法安装的 supertuxkart.exe'}
  ];
  const ready=eligible.length===1&&checks.every(c=>c.ok);
  const warning=eligible.length>1?'有多台主机满足条件，本机模式拒绝自动选择':
    hosts.length===0?'尚未收到可用 Host Agent 心跳':null;
  return {checks,ready,warning,passing:checks.filter(c=>c.ok).length,total:checks.length};
}
