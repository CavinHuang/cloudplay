## M1 本机启动 SuperTuxKart（实验功能）

CloudPlay **Windows full 离线安装包**现在支持在受信任的单台 NVIDIA Windows 主机上，通过游戏详情页点击 Play 发起真实、受控的 SuperTuxKart 本机游戏进程，并在 Player 页面通过 Moonlight Web 登录、配对及连接该进程，或停止该会话。仍需真实 GPU 验证画面/音频/控制器；不代表公共云游戏平台已经可用。

```powershell
& 'D:\CloudPlay\start-active.ps1' -EnableLocalLaunch -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
```

随后在**同一台电脑**打开 `http://127.0.0.1:3000/games/supertuxkart`；首次使用 Moonlight Web 请连接 Sunshine Desktop 并配对。**不通过局域网或公网暴露该 Operator**，不要复制开发 Token 到浏览器。完整部署与安全限制见 [M1 Local Quick Play](docs/M1-LOCAL-QUICK-PLAY.md)，[GPU 真实验收](docs/M1-WINDOWS-GPU-ACCEPTANCE.md)。

# CloudPlay 当前交付状态（2026-11-05）

**已经真实通过：** [GitHub main 的 Windows 完整离线发行](https://github.com/CavinHuang/cloudplay/actions/runs/41817727133)（Windows 原生 Moonlight、Next.js、内置 Node、校验/安装/升级回滚）；在 [PR #4](https://github.com/CavinHuang/cloudplay/pull/4) 的 M1 开发中，新增了 GPU 主机预检、三次实机游玩证据包和 ICE 断线恢复采样，普通 CI **121 项测试及 Next.js 构建通过**。

**尚未通过：** 真实 NVIDIA + Sunshine + 浏览器视频内容、可听声音、键盘/手柄输入、游戏退出回收与断线重连。GitHub-hosted Windows Runner 无 GPU，无法代替这个环节；勿将“离线安装通过”宣传为“游戏已可玩”。

- [M1 Windows GPU 实机验收操作手册](docs/M1-WINDOWS-GPU-ACCEPTANCE.md)（相关命令均打包进 Windows 发行包；部署机无需下载 npm/Rust/额外源码）
- [M1 GPU 实测问题单 #3](https://github.com/CavinHuang/cloudplay/issues/3)
- [Windows 发行真实验收记录](docs/WINDOWS-RELEASE-ACCEPTANCE-2026-11-04.md)
- [离线发行 GitHub Actions](https://github.com/CavinHuang/cloudplay/actions/workflows/offline-windows-release.yml)

---

# CloudPlay v0.12.0 — 离线一体化安装、升级与回滚

> **GitHub CI 验证（2026-11-04）：** [首次真实构建](https://github.com/CavinHuang/cloudplay/actions/runs/41806874819) 已成功：依赖安装、112 项 Node 测试和 Next.js 生产构建全部通过。此结果不等于 Moonlight Web 原生构建、离线 Windows 安装包或 GPU 游戏串流已通过。

本仓库已将 **Next.js 游戏库、P0 Coordinator/Host Agent、Moonlight Web 真实上游补丁、编译工具链检查、离线打包器、Windows 一键启动脚本、Docker 镜像离线导入**统一管理。

**关键交付原则：构建期一次准备，部署期零 Git/npm/cargo 下载。** 在可联网的构建机上生成 `windows-full` 完整发行目录或 `docker-web` 镜像包，迁移到目标服务器后直接校验并启动。打包工具对缺失的 Moonlight 已编译组件、对应修改源码、Node 运行时、Next.js standalone 和许可证会报错，不交付假离线包。

- **v0.12 新增：[无需重新下载的 Windows 安装、升级与回滚手册](docs/V012-DEPLOYMENT-AND-ROLLBACK.md)**
- [离线版本槽位安装管理器](scripts/release/install-offline.mjs)，[Windows 一键安装](deploy/windows/install-cloudplay.ps1)
- [版本入口启动/停止](deploy/windows/start-active.ps1) / [停止](deploy/windows/stop-active.ps1)
- **用户数据分离：** 程序统一在 `releases/<version-hash>/`，凭证、Moonlight 配对、日志和会话在 `state/`，升级时不覆盖。
- [v0.12 真实交付状态、测试与限制](docs/V012-DELIVERY-STATUS.md)
- [一体化离线部署手册](docs/OFFLINE-DEPLOYMENT.md)
- [Windows 一键准备脚本](scripts/release/build-windows-offline.ps1)
- [离线成品打包器](scripts/release/pack-offline.mjs) 与 [完整性校验器](scripts/release/verify-offline.mjs)
- [Windows 本机启动脚本](deploy/windows/start-cloudplay.ps1) 和 [关闭脚本](deploy/windows/stop-cloudplay.ps1)
- [Linux 网站镜像离线导入](deploy/docker/load-and-run.sh)
- [固定 Moonlight 上游清单与许可](third_party/manifest.json)
- [手动触发 Windows 完整构建工作流](.github/workflows/offline-windows-release.yml)

**v0.12 当前状态（2026-11-04）**：112 项自动化测试通过，80 个源码文件语法检查通过。完整 Windows 构建、GPU/视频/音频/输入实测、Next.js 生产构建未能在当前无 npm/GitHub 网络及 Windows GPU 的容器中执行；本项目源码 ZIP **不是**一份已编译的零依赖二进制安装包。站点生产环境继续关闭实验性 P0 操作；公开云游戏平台的多用户认证、游戏授权和资源隔离仍未完成。

---

> **v0.10 开发更新（2026-11-04）：** P0 本机播放器新增 WebRTC 帧/音频采样导出与独立校验；Moonlight Web 的 Windows 构建脚本新增前端单独编译、产物桥接校验；新增手动触发的固定上游 GitHub CI。Node 90 项测试通过、71 个源码文件完成语法解析；**Windows GPU 游戏、完整 Moonlight 构建及 Next.js 生产构建尚未通过。** 参见 [v0.10 运行与证据手册](docs/P0-V010-MEDIA-EVIDENCE-AND-CI.md)。

> **v0.9 development update (2026-11-04):** Optional real-Chromium WebRTC diagnostics harness and pinned Moonlight build preflight added. The local browser handshake passed but ICE stayed `new` (zero decoded frames). **No Windows GPU, Sunshine, real game streaming or Next.js production build is verified.** See [v0.9 runbook](docs/P0-V09-BROWSER-AND-BUILD.md).

# CloudPlay v0.6.0 · P0 持久化恢复与浏览器输入诊断

纯 Web 云游戏平台工程。**目前不是已可用的在线游戏服务**。产品采用用户选定的深色、高密度 Boosteroid 风格 UI；P0 用 Windows GPU + Sunshine + Moonlight Web Stream 验证真实游戏串流，P1 采用 Next.js App Router 实现游戏库、详情、预检与管理框架。

## 本次最直接可运行的交付：P0 诊断服务（完全免 npm 安装）

在 Windows 11 + Node.js 22+ 的目标机器上，在项目根目录运行（默认**只诊断，不启动游戏**）：

```powershell
.\scripts\p0\start-p0-lab.ps1 -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
```

请用你真正安装游戏后的 EXE 绝对路径替换示例路径。随后访问 `http://127.0.0.1:7788/monitor`，打开本地 `.p0-lab-token`，复制 token 到页面进行身份验证。页面展示 Windows Agent 每 5 秒报告的检测结果。所有诊断端点仅绑定 localhost。

如果已安装 Sunshine、Moonlight Web Stream、SuperTuxKart 并完成配对，可显式开启单机进程会话：

```powershell
.\scripts\p0\start-p0-lab.ps1 -EnableLocalLaunch -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
```

本机控制页可以创建 `supertuxkart` 会话、让 Agent 启动指定 EXE、停止/回收进程；Moonlight Web 中的真实视频仍需独立连接。详见 [P0 真正启动与交接手册](docs/P0-REAL-SESSION-RUNBOOK.md)。

**四个检测项都通过不等于游戏可玩**，必须另行在 Moonlight Web Stream 中完成 Sunshine 配对、游戏画面、声音、输入和退出实测。

结束测试运行：

```powershell
.\scripts\p0\stop-p0-lab.ps1
```

详见 [P0 Windows 联调手册](docs/P0-LAB-RUNBOOK.md)，包含失败排查、授权边界和实测证据记录。

## P1 Next.js 工程

网络能够访问 npm 注册表时（Node 22+）：

```bash
npm install
npm test
npm run dev
# http://localhost:3000/library
# http://localhost:3000/p0
```

页面包括 `/my-games`、`/library`、`/games/supertuxkart`、`/install`、`/admin`、`/player/preview`、`/p0`。

`/p0` 页面从 Node Lab Coordinator 读取服务器端脱敏信息；Windows `start-p0-lab.ps1` 初次启动会建立 `.env.local`，供 Next.js 读取相同的 Bearer token。启动脚本会同步 `.env.local` 内的四项 P0 配置（保留其他设置），避免旧 Token 导致 401；请勿将该文件提交 Git 或部署到公网。

`GET /api/v1/p0/status` 和 `GET /api/v1/hosts` 仅展示诊断状态。`POST /api/v1/sessions` 依然返回 503，因为还没有真实权限审核、游戏运行调度及独占资源管理。不提供伪造的“正在游玩”会话。

Docker `docker compose up --build` 仍作为 Next.js 本机验证可选项，默认仅在 `127.0.0.1:3000` 监听；**P0 Lab Coordinator 的 localhost 指向自身进程所在机器**，因此初始验证建议直接把 P0 和 P1 跑在 Windows 同一宿主系统，勿用 Docker 容器的 loopback 连接 Windows 宿主机误判状态。

## 仓库与文件

- `lab/coordinator.mjs`：真实 Node HTTP 心跳服务（强认证、loopback、TTL）。
- `lab/agent.mjs`：Windows 主机只读诊断上报。
- `lab/monitor.html`：独立浏览器监控页，不依赖 Next.js。
- `app/api/v1/p0/status/route.js`：P1 脱敏主机状态 API。
- `components/P0StatusPanel.jsx`：P1 主机状态 UI。
- `scripts/p0/start-p0-lab.ps1` / `stop-p0-lab.ps1`：Windows 联调启动与清理。
- `scripts/p0/verify-evidence.mjs` / `docs/P0-EVIDENCE-TEMPLATE.json`：真实 P0 测试记录辅助工具。
- `docs/DELIVERY-STATUS.md`：证据、已通过项目与阻塞说明。

## 许可证与公开部署

商业游戏封面仅作为从用户参考图衍生的**本地 UI 占位素材**，不可据此认定拥有分发权。SuperTuxKart 等开源游戏仍应核查完整的代码、音乐、美术素材与商业云托管许可。尚未建立公共用户认证、支付或权限隔离，**不得直接公开提供游戏启动服务或暴露 Sunshine 管理界面**。

## 实际验证结果

截至 v0.6 已运行 66 项 Node 自动化测试（以本次交付时的记录为准），包括实际 OS 进程启停、协调器重启后从持久化日志恢复会话。这**不代表**用户 Windows 显卡或实际 WebRTC 游戏已通过。当前容器访问 npm registry 返回 `EAI_AGAIN`，因此 Next.js 生产构建尚未验证。查看 [交付状态说明](docs/DELIVERY-STATUS.md)。

## v0.4.0 增量开发说明

- `lib/lab/session-control.mjs`：本机游戏会话、命令租约、独占与故障恢复。
- `lib/lab/game-runner.mjs`：Agent 白名单进程执行器（不接受远端路径/命令）。
- `lab/agent.mjs`：接收授权命令、回报进程状态、协调器断联清理。
- `lab/monitor.html`：凭 Token 创建/停止本机会话并查看状态。
- `tests/p0-process-e2e.test.mjs`：在 Linux 上实际启动与停止测试 OS 进程，不依赖真实 GPU；Windows 游戏需在目标机器实测。
- **正式 P1 `/api/v1/sessions` 仍返回 503**：未配置生产用户鉴权、游戏托管许可和资源调度，不能开放公网启动。


### v0.4.0 P0-03 Web Player Handoff

- `/monitor` 创建本地会话后，点击 **进入 Web 播放器** 打开 `/play/<session-id>`。
- `/play/<session-id>` 有独立的 P0 Token 输入、会话状态轮询、可选 Moonlight Web iframe、独立窗口备用入口及安全停止。
- 校验型 `/internal/lab/sessions/<id>/stream-handoff` 只返回**认证后、游戏已启动且主机在线**的 loopback URL；这不是媒体数据通道。
- P1 `/p0` 显示真实会话入口，`/player/p0-<id>` 查询经过脱敏的 `/api/v1/p0/sessions/<id>`。
- 修复 P1 状态组件中的未定义 `sessions` 引用；单元与集成测试 49/49 通过。
- 真实 Windows GPU/WebRTC 媒体验收仍是 P0-03 的必需外部步骤。见 [完整播放验收手册](docs/P0-PLAYBACK-RUNBOOK.md)。


## v0.5.0 增量（本地安全串流交接）

- `P1 /player/p0-<sessionId>` 的 **连接 Moonlight Web** 按钮现在通过同源 `/api/v1/p0/sessions/<id>/open` 由 Next.js 服务端向本机 P0 Coordinator 验证会话，并返回 `302` 到严格限制的 `http://127.0.0.1:8080/`。用户**不需要在中间跳转页再次输入 P0 Token**；Moonlight Web 的用户登录和 Sunshine PIN 配对仍必须独立完成。
- `GET /api/v1/p0/sessions/<id>/handoff` 提供无令牌、脱敏的连接诊断。非 `connecting/reconnecting` 状态、失效心跳、端口不可达，均拒绝连接。
- **安全默认关闭**：仅当 `NODE_ENV !== production` 且 `CLOUDPLAY_P0_UI_ENABLED=1` 时，P1 才允许访问 P0 状态、会话、handoff 和页面。生产镜像即使误装了 Lab Token 也无法开放本地会话入口。
- 本地 `npm run dev` 默认绑定 `127.0.0.1`，不再无意开放到局域网。
- Windows Agent 停止进程优先尝试正常关闭（`taskkill /PID /T`），等待后才使用 `/F` 兜底；限制为本 Agent 创建的 PID。
- PowerShell 启动脚本自动同步 `.env.local` 中的 P0 变量，保留其他键。
- **限制**：该交接只用于同一台 Windows 机器上的本地实验；不是直接嵌入 WebRTC 播放器，不证明 1080p/60 FPS 或游戏真实可玩。必须在实际 GPU 主机实测。

参考：[P0-05 本地浏览器交接与验收](docs/P0-V05-HANDOFF.md)。


## v0.6.0 增量（持久化恢复、浏览器诊断）

- `P0_SESSION_JOURNAL`：Windows `start-p0-lab.ps1` 自动设置私有、绝对路径 `.p0-session-journal.json`。协调器在本机原子写入会话/命令元数据，不记录 Token、游戏 EXE 路径或媒体帧。文件已加入 `.gitignore` 和 `.dockerignore`。**不要在游戏运行时删除日志。**
- Coordinator 重启后恢复同一会话 ID 并标记为 `reconnecting`，只有 Agent 重新上报同一已运行游戏进程，才回到 `connecting`；日志损坏会拒绝启动，不会静默重置、重发启动命令。断线超时仍以 `failed` 结束。
- Agent 确认游戏实际退出时，可把重启前的 `stopping` 会话推进到 `finished`，避免“已停进程但永远显示正在停止”。
- 新增无需 npm 的 `http://127.0.0.1:7788/diagnostics`：浏览器安全上下文、WebRTC/WebCodecs、H.264 等声明的编解码能力、手柄数与当前按键/摇杆活动、JSON 导出。Next.js `/player/p0-<uuid>` 也提供相同维度的浏览器诊断。
- **诊断不读取 Moonlight Web iframe 的媒体数据**，也不会把浏览器 API 能力当作真正的游戏帧率、RTT、延迟、音频和操作响应。
- 当前环境 npm registry DNS `EAI_AGAIN`，没有构建 Next.js；Windows PowerShell 与 NVIDIA GPU 无法在本容器执行。提交前需在 Windows 本机运行实测并在可访问 npm 的环境运行 `npm install && npm run build`。

详细说明：[v0.6.0 验收与故障恢复](docs/P0-V06-RECOVERY-AND-DIAGNOSTICS.md)。


## v0.7.0 增量（协作 WebRTC 媒体诊断与手柄映射）

- 本机 `/play/<session-id>` 新增可选客户端侧 WebRTC 统计桥接状态及解码帧 / 音频字节 / ICE / RTT 诊断。**未修改的 Moonlight Web 无法向 CloudPlay 共享内部 RTCPeerConnection**，因此默认显示无数据；没有使用假帧率。
- 通过严格限定 iframe `origin`、窗口来源、会话 ID 和随机 challenge 限制跨窗口统计消息。媒体数据在本机客户端内采集，只有匿名计数通过消息通道，不导出 SDP/IP/设备序列号。
- 仅重载内嵌 Moonlight Web 页，不重发游戏启动命令；包括帧停滞、统计过期、ICE 断开诊断。实际黑屏/声音/输入体验仍需操作员在 Windows 主机观察。
- `/diagnostics` 新增标准手柄按键与双摇杆的只读映射检查，非标准布局不猜测按钮意义；不将本机输入冒充为游戏端输入。
- SuperTuxKart 游戏详情页在 P0 开发模式下可链接至已有本机会话，公众游戏目录和 `/api/v1/sessions` 仍不可启动。
- 参见 [v0.7 媒体统计适配与实机验收指南](docs/P0-V07-REAL-MEDIA-ADAPTER.md)。


## v0.8: 实际 Moonlight Web WebRTCTransport 集成点

`docs/P0-V08-UPSTREAM-INTEGRATION.md` 包含对上游具体 Git 提交的严格补丁、`RTCPeerConnection` 真实创建点、PowerShell 操作、编译测试及回滚步骤。只提供有权限的自建 Moonlight Web P0 测试客户端；不得将诊断事件当成游戏画面已通过验收。

```bash
node scripts/p0/integrate-moonlight-web.mjs /path/to/moonlight-web-stream --dry-run
node scripts/p0/integrate-moonlight-web.mjs /path/to/moonlight-web-stream
```

补丁文件位于 `integrations/moonlight-web/cloudplay-p0-telemetry.ts`；要求上游 HEAD 严格等于已审查的 `7b9821430e07087f459db3db9aac550e1e9c9bff`。当前环境无法下载 Next.js 依赖，因此 Next.js 构建和 Windows GPU 实测仍待现场执行。
