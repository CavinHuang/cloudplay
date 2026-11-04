# CloudPlay P0-04｜本机实际游戏进程与串流交接验证

## 当前已实现与尚未实现

- **已实现**：本机 loopback 控制器的认证会话 API、单主机独占、仅允许 `supertuxkart`、Agent 启动指定本地 EXE、报告进程状态、手动停止、超时、心跳恢复、进程租约、Web 状态查看。
- **已验证**：Node API 集成、状态机、真实 Linux 测试进程启动/终止。它验证的是 OS 进程调度，不是 Windows GPU/WebRTC。
- **尚未实现**：从 CloudPlay 自己的页面直接解码视频，自动控制 Moonlight Web 帐号/应用启动，自动 PIN 配对，真实流播放证明，多用户会话授权。不要把“connecting”当成视频连接成功。

## Windows 运行

1. Windows 11、Node.js 22+、NVIDIA GPU 驱动。安装 Sunshine（<https://github.com/LizardByte/Sunshine>）和 Moonlight Web Stream（<https://github.com/MrCreativ3001/moonlight-web-stream>），先按上游说明完成身份登录与 PIN 配对，验证 Moonlight Web 可以打开 Sunshine 桌面。
2. 从 <https://supertuxkart.net/Download> 安装 SuperTuxKart，并确认本机手动双击游戏能正常运行。
3. 在 CloudPlay 项目根目录 PowerShell 执行（替换游戏 EXE 路径）：

   ```powershell
   .\scripts\p0\start-p0-lab.ps1 -EnableLocalLaunch -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
   ```

   默认不带 `-EnableLocalLaunch` 时，启动能力保持关闭。
4. 打开 <http://127.0.0.1:7788/monitor>，粘贴 `.p0-lab-token` 文件内容。页面四项检查均通过后，点击 **启动本机游戏进程**。
5. 监控页状态应从 `starting` → `connecting`。`connecting` **只表示游戏进程已启动，等待 Moonlight Web 的媒体连接**。浏览器打开 <http://localhost:8080/>，登录并在已配对的 Sunshine 主机下选择 Desktop 捕获运行中的游戏。不要同时从 Sunshine 再次启动同一游戏，避免双开。
6. 人工观察视频、音频、键盘/鼠标/手柄、全屏和断线恢复；将实际记录写入 `docs/P0-EVIDENCE-TEMPLATE.json` 的副本。没有录屏/日志证据不能勾选流通过。
7. 回到监控页点击 **停止当前会话**，等待 `finished` 后再运行：

   ```powershell
   .\scripts\p0\stop-p0-lab.ps1
   ```

   停止脚本会先通知 Agent 结束游戏，确认主机不再报告游戏运行，然后结束 Node 进程。无法确认时默认拒绝强制关闭。只有手动结束游戏后，才考虑 `-Force` 参数。

## 故障与恢复

| 现象 | 处理 |
|---|---|
| LOCAL_LAUNCH_DISABLED | 用 `-EnableLocalLaunch` 重新启动；默认故意关闭 |
| HOST_NOT_READY | 检查 GPU、Sunshine、Moonlight Web 端口、游戏 EXE；端口开放不证明对应服务正确 |
| HOST_PROCESS_BUSY | Agent 已报告有游戏进程，先停止再启动 |
| HOST_SESSION_BUSY | 当前主机已有启动、连接或停止中的会话 |
| GAME_EXECUTABLE_NOT_FOUND | `-GamePath` 必须是允许使用的 SuperTuxKart EXE 的绝对路径 |
| GAME_START_TIMEOUT | Agent 未在 45 秒内确认启动；检查 Node 和游戏文件 |
| HOST_HEARTBEAT_LOST | 约 16 秒没有主机心跳；进入 `reconnecting`，并等待恢复 |
| HOST_RECONNECT_TIMEOUT | 额外约 30 秒未恢复，标记失败；Agent 在协调器失联 45 秒后尽力停止自己启动的进程 |
| PROCESS_EXIT_TIMEOUT / AGENT_STOPPED_GAME | 退出流程未确认或已确认；若失败，先手动查验是否有遗留游戏进程 |
| 视频黑屏/无音频 | 不属于控制器可自行判定的故障；查看 Sunshine、Web Stream 日志、浏览器 console/ICE 和显示器捕获条件 |

## 关键安全界限

- 该 API **只绑定 127.0.0.1**，使用长度不少于 32 的实验 token。不要配置公网反向代理、隧道或共享账户。
- Agent **不执行网页传入的可执行路径、参数、PowerShell 或 shell 命令**。路径仅由本机启动脚本/环境变量指定。
- 当前数据只在进程内保存，重启后会话状态丢失；它不是正式云游戏平台的数据库/可靠队列。
- Moonlight Web 自有账号和配对，CloudPlay 不代理其认证，也不声称已获得视频解码成功的测量值。
- 公开/商业游戏仍需单独做版权、素材许可和公开托管审核；P0 仅用于操作者自己的本地测试。
