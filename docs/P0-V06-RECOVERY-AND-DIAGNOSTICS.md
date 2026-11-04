# CloudPlay v0.6 · P0 本机会话恢复与浏览器诊断

> 范围：Windows 11 单机 P0 实验。不是可公网运行的多用户云游戏服务。

## 本轮实装

1. `scripts/p0/start-p0-lab.ps1` 为协调器配置 `P0_SESSION_JOURNAL`（默认 `<项目根目录>/.p0-session-journal.json`）。日志原子替换，类 UNIX 环境下权限为 0600；Windows 继承当前用户文件 ACL。
2. 会话与命令状态在本地持久化。Coordinator 重启后恢复原 Session ID；任何曾处于连接中的会话先标记为 `reconnecting`，待 Agent 心跳证明其仍持有对应游戏进程后才转成 `connecting`。完全不假定视频串流成功。
3. 丢失的启动 ACK 可由 Agent 的真实本地进程心跳修复，避免重复发起 `launch`。丢失的停止 ACK 可由同会话进程 `exited` 心跳修复，避免永久停在 `stopping`。
4. 浏览器在 `/diagnostics` 检测支持情况及本机手柄输入，记录到 JSON（只存本机，不上传）。P1 Player 的诊断面板具备同类功能。

## Windows 正常启动

```powershell
.\scripts\p0\start-p0-lab.ps1 -EnableLocalLaunch -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
```

- `http://127.0.0.1:7788/monitor`：启动、结束游戏以及查看真实会话状态。
- `http://127.0.0.1:7788/diagnostics`：浏览器、视频解码 API、手柄输入测试。
- `http://127.0.0.1:8080/`：Moonlight Web 独立登录、PIN 配对和媒体串流测试。
- `https://127.0.0.1:47990/`：Sunshine 管理页面（本机自签名证书可能需手动信任）。

## 协调器意外重启时的预期行为

- 在 Agent 45 秒租约到期之前，重新以**相同 Token、相同日志路径**启动 Coordinator：会话应先显示为 `reconnecting`，收到 Agent 的游戏进程心跳才恢复为 `connecting`。WebRTC 连接可能仍需在 Moonlight Web 重新建立。
- 协调器停止超过 45 秒，Agent 为避免游戏残留会尝试关闭其持有的本地游戏进程；此时会话不会虚假恢复“可玩”，可见 `HOST_PROCESS_MISSING` 等终止原因。
- 如果重启期间已经执行停止操作，下一条进程 `exited` 心跳能把正在停止的会话更新为 `finished`。
- 日志 JSON 无法解析或结构异常时协调器**拒绝启动**；请保留文件以调查原因，确保原 Agent 已停止游戏后再备份日志并重新启动实验。**不要在游戏运行时删日志强行重置。**
- 正常停止请使用 `./scripts/p0/stop-p0-lab.ps1`；脚本会要求游戏进程清理确认。

## 实测：成功条件与不可代替的证据

| 能力 | 自动化能确认的内容 | 必须在 Windows 实机确认的内容 |
|---|---|---|
| 控制链路 | Coordinator 与 Agent 心跳、启动与停止命令、会话恢复 | `supertuxkart.exe` 的实际进程、退出与清理 |
| 浏览器诊断 | 浏览器可声明的 WebRTC、编解码、手柄 API/即时输入 | Moonlight Web 收到并正确映射输入 |
| 媒体 | 只检查被允许的 Moonlight Web 入口是否可交接 | 真正变化的视频帧、声音、鼠标手柄响应、网络损耗与延迟 |
| 恢复 | 会话 ID 和停止指令能经 Coordinator 重启保留 | Moonlight Web 断线后的实际媒体重连、游戏内状态连续性 |

### 为什么播放器不能自动显示 Moonlight 的 WebRTC FPS/RTT？

当前采用外部 Moonlight Web 客户端（有自己登录、PIN 配对与 PeerConnection）。由于浏览器跨源隔离，CloudPlay 没有权访问其独立 `RTCPeerConnection.getStats()`。数据必须在 Moonlight Web 自己提供的监控、DevTools 或未来受支持的集成 SDK 中采集。不能用本地端口、浏览器 API 存在、页面加载速度代替媒体性能。

## 实际验证记录

本轮 Node 测试覆盖日志原子写入、损坏拒绝启动、恢复中不重复启动、失联超时、停止 ACK 恢复、真实本地进程跨 Coordinator 重启后回收、浏览器能力数据隐私处理及独立诊断 HTTP 页面。PowerShell 脚本和 Next.js 生产构建未在当前 Linux 容器完成执行。
