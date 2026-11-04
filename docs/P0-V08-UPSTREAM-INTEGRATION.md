# CloudPlay v0.8 | Moonlight Web 真正 PeerConnection 诊断集成

> 范围：**Windows 单机 P0 实验**。本轮交付了针对上游准确文件和提交的可安装补丁，完成 TypeScript 编译、校验消息来源、统计字段以及自动化测试。**未在本执行环境部署或编译完整的 Moonlight Web Stream 上游，也未运行 Windows GPU/Sunshine 真实串流**。合作客户端返回解码帧不等于实际游戏画面或用户体验已验收。

## 1. 本轮最关键的突破

我们核查了 `MrCreativ3001/moonlight-web-stream` 上游的**真实代码**：

- 仓库：https://github.com/MrCreativ3001/moonlight-web-stream
- 本轮审查固定提交：`7b9821430e07087f459db3db9aac550e1e9c9bff`
- 文件：[`web/stream/transport/webrtc.ts`](https://github.com/MrCreativ3001/moonlight-web-stream/blob/7b9821430e07087f459db3db9aac550e1e9c9bff/web/stream/transport/webrtc.ts)
- 类：`WebRTCTransport`
- 真实 PeerConnection 创建点：`this.peer = new RTCPeerConnection(configuration)`
- 生命周期：`async close(): Promise<void>`，原实现中 `this.peer.close()` 负责关闭媒体连接。

v0.7 的 `getPeerConnection:()=>activePeerConnection` 是示意变量；**v0.8 已不需要猜测这个变量**。通过 `scripts/p0/integrate-moonlight-web.mjs`，补丁直接装到 `WebRTCTransport` 的实际创建与关闭路径。

## 2. 如何安装补丁（单独的上游工作树）

在 Windows PowerShell 中：

```powershell
# 将 CloudPlay v0.8 源码解压到 C:\dev\cloudplay
cd C:\dev

git clone https://github.com/MrCreativ3001/moonlight-web-stream.git
git -C .\moonlight-web-stream checkout 7b9821430e07087f459db3db9aac550e1e9c9bff

# 先检查。它会拒绝未审查版本、污染的上游文件或不兼容的类结构。
node .\cloudplay\scripts\p0\integrate-moonlight-web.mjs .\moonlight-web-stream --dry-run

# 安装两个受控变更：向 WebRTCTransport 注入桥接，并创建一个自包含的 TS 模块。
node .\cloudplay\scripts\p0\integrate-moonlight-web.mjs .\moonlight-web-stream

git -C .\moonlight-web-stream diff -- web/stream/transport/webrtc.ts
```

安装器的**安全约束**：

1. 必须是 Git 工作树，`HEAD` 必须精确匹配上面的上游 SHA；不同版本直接拒绝修改。
2. 原 `webrtc.ts` 不能有本地未提交修改，否则拒绝覆盖。
3. 四个插入锚点必须全部唯一存在，局部损坏或部分安装直接报错。
4. 不修改登录、配对、Sunshine 凭据、控制数据通道、视频传输逻辑、认证规则和上游服务器代码。
5. 可以重复运行，已完整安装时不会重复注入。对目标遥测文件存在不同内容时拒绝覆盖。
6. 无网络下载、无执行第三方代码，除了读取 Git 修订、复制本仓库模板与修改指定 TypeScript 文件。

**注意：**如果后续选择其他 Moonlight Web 版本或 v2 release，必须重新核查上游，**不允许跳过版本检查盲目套补丁**。

## 3. 编译与运行

该桥接是一个纯 TypeScript 文件 `cloudplay-p0-telemetry.ts`，在 CloudPlay 仓库执行（需要 `tsc`）：

```powershell
tsc --noEmit --target es2022 --module esnext --lib es2022,dom --skipLibCheck .\integrations\moonlight-web\cloudplay-p0-telemetry.ts
npm test
```

Moonlight Web 本身的构建必须按其**对应提交**的 README 进行，可能需要 Rust、wasm-bindgen、Node.js 和系统编译工具链。客户端中 `web/stream/transport/webrtc.ts` 改动后，要重新构建和部署 Moonlight Web；仅复制 JS 到 CloudPlay 服务不会让未修改的客户端突然提供统计。

搭建 P0 本机协调器并启动 SuperTuxKart 游戏进程：

```powershell
cd C:\dev\cloudplay
.\scripts\p0\start-p0-lab.ps1 -EnableLocalLaunch -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
```

打开 `http://127.0.0.1:7788/monitor`，输入本机 Token，启动已授权的本地测试会话并选择嵌入模式。被修改的 Moonlight Web 如果允许跨源 iframe，就会在浏览器本地回传脱敏诊断统计。**登录、PIN 配对仍必须在 Moonlight Web 自己的页面完成。**

如果 Moonlight Web 的 `X-Frame-Options` 或 CSP 拒绝嵌入，CloudPlay 仍能独立打开它来游玩，但不会收到跨窗口诊断：这属于**受上游安全策略限制的已知降级**，不可自行禁用其认证或安全头来绕过。

## 4. 诊断协议与安全边界

- 协议：`cloudplay.p0.media.v1`
- 父页面来源：精确的 `http://127.0.0.1:7788`，不接受任意远程地址。
- 仅响应父页面消息；使用每个页面随机生成的 128-bit challenge 和 UUID 会话 ID 建立绑定。
- 每 1500ms 查询当前 `RTCPeerConnection.getStats()`。
- 仅回传解码帧计数、字节接收、FPS、宽高、包丢失、ICE/Peer 状态和选中候选对的 RTT。
- **不会**上报 SDP、ICE candidate 字符串、IP 地址、Token、Cookie、会话密码或主机账户信息。
- `WebRTCTransport.close()` 会卸载事件监听并清除统计定时器，不干扰 Moonlight 的原有关闭逻辑。
- WebSocket/WebCodecs 降级传输不经过此 WebRTC 类；其统计不适用，界面应显示未检测。
- 来源校验只能防误接，不能证明经过修改的客户端可信。严禁将合作端统计作为计费凭据或自动媒体验收。

## 5. 验收级别必须区分

| 验收级别 | 证据 | 本轮状态 |
|---|---|---|
| 纯 TS 模块可编译 | `tsc --noEmit` | 已通过 |
| 上游补丁插入点有效 | 针对实际源结构的安装器自动测试 | 已通过（上游完整构建未执行） |
| 桥接消息来源与数据脱敏 | Node + 编译后模块的模拟 PeerConnection | 已通过 |
| Moonlight Web 完整源码编译 | 上游 `npm run build` + Rust 构建 | **待 Windows 或网络环境执行** |
| 真实 RTC 统计来自 Moonlight Web | 已运行的浏览器和真实 PeerConnection | **待执行** |
| Sunshine 真实游戏画面和声音 | 实际 GPU 截图与人工体验证据 | **待执行** |
| 键鼠/手柄发送到游戏、资源清理 | 人工实机测试与 Host Agent 状态 | **待执行** |

## 6. 故障与撤销

若上游构建失败，优先检查 Node/Rust 构建依赖和 `tsc` 类型错误；不要直接升级上游后绕过安装器的固定提交校验。

如果确认补丁造成问题，在**仅改动本补丁的工作树**中执行：

```powershell
git -C C:\dev\moonlight-web-stream restore -- web/stream/transport/webrtc.ts
Remove-Item C:\dev\moonlight-web-stream\web\stream\transport\cloudplay-p0-telemetry.ts
```

撤销前先 `git status --short`，确认未覆盖其他开发者在该文件的本地修改。

## 7. 下一项真正的 P0-03 实测

在具有 Windows NVIDIA GPU 的主机上，构建带桥接的 Moonlight Web，完成 Sunshine 配对并启动 SuperTuxKart。记录是否看到**持续变化的真实游戏画面**、听到声音、能够控制游戏；同时记录真实 `framesDecoded` 变化和网络断开/恢复。两类证据需要并列保存，不能相互替代。
