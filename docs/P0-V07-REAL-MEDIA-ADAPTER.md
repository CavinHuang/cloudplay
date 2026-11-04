# CloudPlay v0.7 | 真实媒体统计桥接与故障诊断

适用范围：Windows 单机、本地 P0 实验。**没有完成 NVIDIA GPU/Sunshine/Moonlight Web 的实机串流验收**。v0.7 的目标是让真实客户端的 `RTCPeerConnection.getStats()` 可以在获得允许的情况下传给本地 CloudPlay 诊断播放器；不是通过抓取跨源 iframe、代理视频或伪造帧率来绕过浏览器限制。

## 1. 已实现的边界

- `lab/player.html`：本机播放器新增连接状态、解码帧累计、解码器报告的 FPS、音频接收字节、ICE/PeerConnection 状态、选中候选对 RTT；仅在可选客户端桥接成功时展示。独立标签页不自动采集。
- `lib/lab/media-telemetry.mjs`：协议、来源校验、统计字段白名单、帧停滞与断开诊断；无原始 SDP、IP 地址、候选对象、账户信息、主机密码。
- `lab/moonlight-media-bridge.mjs`：可选的 **Moonlight Web 客户端侧** SDK。必须复制并从实际 WebRTC 客户端代码调用，传入正在使用的 `RTCPeerConnection` 引用。**未修改的 Moonlight Web 官方发行版不提供此桥接，直接安装 CloudPlay 不会凭空出现媒体数据。**
- `lib/lab/gamepad-mapping.mjs`：仅观察当前浏览器的标准手柄按钮与轴值，不假设任何非标准布局，不向云游戏发送输入。
- `/diagnostics`：展示标准布局按钮、左/右摇杆活动；可导出不含设备 ID 的报告。
- 游戏详情 `/games/supertuxkart`：仅在 P0 本机开发模式启用、且已有真实可连接的测试会话时，出现“继续本机测试会话”。不创建新的公开游戏会话。

## 2. 在本机启动 P0

Windows PowerShell（先安装 Node 22+、Sunshine、Moonlight Web Stream、SuperTuxKart）：

```powershell
.\scripts\p0\start-p0-lab.ps1 -EnableLocalLaunch -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
```

在 `http://127.0.0.1:7788/monitor` 输入本机生成的 `.p0-lab-token`，创建本机测试会话，再点击进入 `/play/<session-id>`。完成 Sunshine PIN 配对后，默认使用 **在新标签页打开** 的独立 Moonlight Web。内嵌模式可能被 Moonlight Web 的 `X-Frame-Options` / `frame-ancestors` 拒绝，优先相信独立客户端实际是否能玩。

## 3. 将统计接入修改过的 Moonlight Web 客户端（可选）

当前仅提供适配器和测试，**没有对第三方 Moonlight Web 项目提交代码或完成真实联调**。

1. 将 `lab/moonlight-media-bridge.mjs`、`lib/lab/media-telemetry.mjs` 和 `lib/lab/stream-handoff.mjs` 放入 Moonlight Web 前端代码，确保模块的相对 import 可解析。
2. 在该客户端**持有正在播放的 RTCPeerConnection 实例**的组件内调用适配器。例如下方的 `activePeerConnection` 必须换成目标 Moonlight Web 当前版本的实际变量/引用：

```js
import {attachMoonlightMediaBridge} from './lab/moonlight-media-bridge.mjs';
const bridge = attachMoonlightMediaBridge({
  expectedParentOrigin:'http://127.0.0.1:7788',
  getPeerConnection:()=>activePeerConnection,
});
// 卸载对应视图时 bridge.dispose()
```

3. 构建修改后的客户端，**在本地可信环境中**以 iframe 模式从 CloudPlay `/play/<id>` 加载。只有客户端与 iframe 双向握手成功后才会采样统计。如果第三方客户端不允许 iframe 嵌入，应使用其自带监控/DevTools；不要关闭安全头来强行嵌入外部网站。
4. 诊断页每 1.5 秒尝试取当前 PeerConnection 的 `getStats()`：视频 `inbound-rtp.framesDecoded`、音频 `inbound-rtp.bytesReceived`、ICE 与连接状态、当前被选中的 candidate pair RTT。父页面只接受**源窗口、来源 origin、Session ID 和 128-bit 一次性 challenge** 同时匹配的统计消息。
5. 断线后使用播放器的 **重新加载媒体页面** 可重新建立诊断 iframe，不重新启动游戏进程；如果游戏进程已终止，须回到本机监控页，不能强行继续会话。

**安全说明：**这是同源及 challenge 校验过的*协作客户端报告*，不是加密远程证明；被修改的客户端本身仍可虚报统计。不得把它直接写入后端的正式 `playable`、商业计费或 P0 验收通过字段。

## 4. 故障诊断判定（不等于黑屏图像检测）

| CloudPlay 显示 | 观测含义 | 排查方向 |
|---|---|---|
| `bridge-not-connected` | 客户端没有回应诊断握手 | 是否采用修改版、是否允许嵌入、地址 origin 是否一致 |
| `awaiting-media-stats` | 已握手，但客户端没有返回 getStats | RTCPeerConnection 是否已经创建、客户端是否仍在登录/配对 |
| `awaiting-video-frames` | 已收到统计，尚未观察到解码帧递增 | Sunshine Desktop 是否连接、是否开始推送视频 |
| `no-decoded-video` | 连续采样超过阈值仍无新解码帧 | ICE/TURN、编码格式、宿主帧采集 |
| `video-frames-received` | 客户端的解码帧计数增加 | 仍需看屏幕，确认是实际游戏而非黑画面 |
| `video-stalled` | 曾有新解码帧，但计数超过阈值不再增加 | 是否在后台、网络抖动、GPU 编码器、游戏冻结 |
| `transport-disconnected` | ICE/Peer 状态为 disconnected、failed 或 closed | 重新连接、NAT/STUN/TURN/防火墙 |
| `telemetry-stale` | 客户端统计超过时效未到达 | iframe 关闭、客户端崩溃、后台限速 |

- `getStats()` 的 `framesDecoded` 增加不等于图像像素不是纯黑；无法读取跨源像素，更不能通过页内视频统计确认游戏内容。真正“黑屏”必须结合实机截图与游戏内画面检查。
- 音频字节增量不等于扬声器可听见声音；需要操作者试听。
- RTT 是 WebRTC 网络候选对往返时间，不是键盘到画面的端到端输入延迟。
- Gamepad API 识别按键不代表 Moonlight 已映射、更不代表云端游戏收到。

## 5. 真实 P0-03 验收清单

- [ ] Windows 主机 `nvidia-smi` 可识别 GPU，Sunshine 已授权捕获桌面。
- [ ] SuperTuxKart 由 Agent 启动，并以 Sunshine Desktop 模式连接，避免双重启动。
- [ ] Moonlight Web 显示持续变化的实际游戏画面（附真实截图）。
- [ ] 亲耳确认游戏声音与游戏内操作响应（键鼠或手柄）。
- [ ] 真实网络断开后可重连同一进程，或明确显示终止原因。
- [ ] 退出后 Agent 回报进程已经结束，GPU 资源释放。
- [ ] 导出人工验收记录、填写截图路径，运行 `npm run p0:verify -- evidence.json`；该脚本只验证人工声明及本地证据文件，不是自动影音验收。

## 6. 本轮自动化验证及限制

- 可运行 Node 测试：协议来源挑战校验、统计字段清洗、冻结/重连/超时状态、Gamepad 标准映射、HTTP 模块与 CSP 返回、持久化会话以及原有进程启动回收测试。
- `tests/fixtures/v07-browser-smoke.mjs` 和 `synthetic-moonlight-client.html` **只用于构造虚拟媒体计数，严禁将其标记为真实游戏串流**。
- Chromium 可以通过 `set_content` 对桌面、390px 移动端进行静态布局渲染检查，但本执行环境策略禁止浏览器导航到 localhost/file URL，无法完成跨窗口浏览器端到端验收。
- npm registry 解析仍为 `EAI_AGAIN`，未验证 Next.js 生产构建。
- 没有操作 Windows 显卡主机、Sunshine PIN 配对或者视频/音频/输入真实媒体验收。
