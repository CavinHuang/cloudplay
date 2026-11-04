# CloudPlay v0.10.0 — 交付状态（2026-11-04）

**本轮在 v0.9 基线上继续开发，并非公共上线版本。**

- `lib/lab/media-evidence.mjs`：本机 WebRTC 合作式诊断采样与连续解码帧/音频增长判定，至多 180 条白名单记录；新增采样导出和 `scripts/p0/verify-media-evidence.mjs` 离线验证器。严格区分媒体统计与真实游戏内容及用户操作证据。
- `lab/player.html`：新增媒体采样证据导出按钮，重开嵌入式客户端时重置采样，输入本地 Token 不写入文件。
- `scripts/p0/build-moonlight-web.ps1`：新增 `-Build -FrontendOnly` 快速构建流程；`check-moonlight-output.mjs` 检查实际生成的 `dist/` bundle 是否包含 CloudPlay Bridge，拒绝仅靠源码补丁宣布成功。Windows 脚本本身尚未在 Windows 执行。
- `.github/workflows/cloudplay-upstream-build.yml`：手动触发的固定上游编译工作流；尚未推送 GitHub，也未实际运行。
- **90 / 90 Node 自动化测试通过**。**71 个源码文件语法解析通过**。P0 Player 内嵌脚本通过 Node `--check`。
- 完整 Moonlight Web 上游构建**未通过验收**（此环境无法下载上游完整依赖）。Windows GNU 工具链和实际 GPU 未在此执行。
- Next.js 生产构建**未通过**（`next: not found`，当前环境 npm registry DNS 不可解析）。
- Windows 的 Sunshine → SuperTuxKart → Moonlight Web 实际视频/音频/输入/退出**未验证**。本地代码不能直接替代用户真实硬件。
- GitHub 远端推送**未执行**，没有对应可写 CloudPlay 仓库。

详情：[v0.10 媒体采样、构建与 CI 手册](P0-V010-MEDIA-EVIDENCE-AND-CI.md)。

---

# CloudPlay v0.9.0 — Delivery status (2026-11-04)

- Added optional Chromium browser smoke testing a real `RTCPeerConnection.getStats()` with synthetic canvas media; the restricted environment permitted handshake and real stats samples but **not ICE connection or decoded frame progress**. Result is explicitly `PASS_BRIDGE_ONLY_MEDIA_NOT_VERIFIED`. Cross-origin HTTP scenario was blocked by browser navigation policy.
- Added pinned Moonlight Web Node/npm toolchain guard (Node >=26.4 <27, npm >=11.17 <12) and Windows compile runner; guard was tested here with Node 22/npm 10 and rejected as expected. The PowerShell runner and upstream build have **not** been executed on Windows.
- Added offline syntax validation for 66 JS/JSX/TS source files; **not** a production build.
- Node suite: **82/82 passed**. Diagnostic bridge TypeScript typecheck passed.
- `npm view` failed due to DNS `EAI_AGAIN`. Next.js full install/build **not verified**. No real Windows GPU host run, video, audio, input or cloud gaming sessions verified; no GitHub remote push.

See [P0 v0.9 browser/toolchain runbook](P0-V09-BROWSER-AND-BUILD.md) and previous [v0.8 upstream integration guide](P0-V08-UPSTREAM-INTEGRATION.md).

---

# CloudPlay v0.8.0 · 开发交付与实证边界（2026-11-04）

## 本轮新增完成

- 针对公开上游的**真实** `WebRTCTransport` 代码结构定位了浏览器 `RTCPeerConnection`：`MrCreativ3001/moonlight-web-stream`, commit `7b9821430e07087f459db3db9aac550e1e9c9bff`, `web/stream/transport/webrtc.ts`。
- `scripts/p0/integrate-moonlight-web.mjs`：可反复运行的上游严格版本补丁安装器；校验 SHA、文件清洁状态和注入锚点，拒绝未经审查版本、冲突或不兼容源码。
- `integrations/moonlight-web/cloudplay-p0-telemetry.ts`：独立 TypeScript P0 诊断适配器，可从**真实上游 `this.peer`**读取 `getStats`，客户端关闭时清理监听与计时器。
- 父窗口来源、消息来源、Session ID 和 128-bit challenge 约束；仅回传不含 IP/SDP/Token 的统计数据；无 iframe 时适配器不采集。
- `tests/p0-upstream-integration.test.mjs`：覆盖上游补丁插入、版本拒绝、不兼容结构拒绝、TypeScript 编译、客户端模拟 PeerConnection 与安全消息协议。
- `docs/P0-V08-UPSTREAM-INTEGRATION.md`：含 Windows PowerShell 安装、编译、运行、回滚步骤及真实验收矩阵。

## 仍然保留的 v0.7 功能

- Coordinator/Agent 本地进程控制、独占会话、持久化重启恢复和安全终止。
- P0 `/monitor`、`/diagnostics` 和 `/play/:id` 页面。
- 游戏库与 P1 API 的本地实验会话交接，生产模式默认关闭。
- 旧的通用 `lab/moonlight-media-bridge.mjs` 保持可用于独立代码实验；真实上游首选 v0.8 TypeScript 文件。

- P1 26 个 JS/JSX 页面/组件静态语法解析为 0 错误；由于缺少 Next.js 依赖，**不等同于生产构建通过**。

## 验证定义

| 检查项 | 状态 |
|---|---|
| 本仓库 Node 自动化测试 | **80/80 通过**，结果见 `docs/tests-v0.8.0-2026-11-04.txt` |
| 独立桥接 TypeScript 编译 | 已在当前环境使用 `tsc` 通过 |
| 模拟 PeerConnection `getStats` 与父窗口协议 | 已通过 |
| 版本检查失败时绝不覆盖未经验证的上游文件 | 已通过 |
| 完整 Moonlight Web 上游构建 | **未执行**，此环境无法获取其完整依赖 |
| 真实 Moonlight Web 配对/ICE/音视频/输入 | **未执行**，缺 Windows GPU 主机 |
| Next.js 生产构建 | **未通过**，npm registry DNS `EAI_AGAIN`，缺依赖；执行 `npm run build` 为 `next: not found` |
| GitHub 远端 PR/推送 | **未执行**，尚无确定的可写 CloudPlay 仓库 |

### 严格边界

**集成点和补丁已实现，并不等于上游完整程序编译或实际 WebRTC 串流已经跑通。**

P0 仍监听 `127.0.0.1`；部署公网、多租户隔离、商业游戏版权授权、用户计费仍不在本轮范围内。Cooperative `getStats` 指标不代表玩家实际看到非黑画面、不代表音频可听、控制输入到达游戏或可用作计费凭据。上游独立客户端如果拒绝 iframe，CloudPlay 无法跨域读取其统计；仍可以使用独立窗口游玩进行实机验收。

## 后续硬性门槛

在 Windows GPU 主机按 [P0 v0.8 上游集成手册](P0-V08-UPSTREAM-INTEGRATION.md) 安装与编译带补丁的 Moonlight Web，完成 Sunshine PIN 配对，记录 SuperTuxKart 实际图像、声音、键鼠/手柄、断线恢复及进程退出。将**人工可视实测**与**真实浏览器 `getStats`**分开记录，之后再决定是否把这段底层能力迁移为产品级 StreamProvider。
