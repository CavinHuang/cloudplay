# CloudPlay P0/P1 开发架构

## 已实现（工程代码）

- Next.js App Router 路由：`/my-games`、`/library`、`/games/[slug]`、`/install`、`/admin`、`/player/preview`、`/p0`。
- 使用用户提供的 V2 设计稿作为视觉基准；深色固定工具栏、方形封面网格、平台角标、Free/待接入标签、游戏详情及预检弹窗。
- 目录模块 `lib/catalog.mjs`：21 个**商业游戏设计展示条目**和 4 个开源游戏候选（不代表许可完成）。
- `lib/preflight.mjs`：许可、安装、GPU、串流提供方全部符合才可启动；P1 默认全部未就绪。
- `lib/session-machine.mjs`：请求 → 分配 → 启动 → 连接 → 串流 → 重连 → 结束的合法状态转换规则。
- API：GET `/api/v1/games`、`/api/v1/games/[slug]`、`/api/v1/preflight?gameId=`、`/api/v1/hosts`、`/api/v1/sessions`、`/api/v1/health`；POST `/api/v1/sessions` **返回 503**。
- 浏览器检测：Player 浏览器能力预览、独立 `scripts/p0/browser-preflight.html`；Windows 上有只读 PowerShell 主机诊断脚本。

## 当前缺口（未实现，不得包装成已完成）

1. Next.js 生产编译和实际服务运行需要 `npm install`，本环境的 npm registry DNS 不可达；不能声明 Build Passed。
2. 真实 GPU：需要 Windows 设备访问权限；本容器没有 NVIDIA GPU 设备，也没有远端 Sunshine/Moonlight Web 实例。
3. 实际账户、数据库和会话调度没有接入：My Games 的收藏仅存储在当前浏览器 localStorage。
4. 正式游戏版权/授权、素材许可证未完成审核；游戏库封面来自设计参考截图，仅用于**本地设计开发**，公开上线前应替换。
5. `/admin` 是只读演示控制台，没有管理员身份认证，不能当作正式生产后台。
6. 尚未实现真正的 WebRTC Viewer / StreamProvider / Host Agent / Session Orchestrator，不存在可播放的真实会话。

## 下一层后端契约（准备开发）

```
Browser Next.js
   | GET /api/v1/games -> catalog
   | GET /api/v1/preflight -> rights + installed + node + provider
   | POST /api/v1/sessions -> auth + idempotency + queue (P1 fail-closed)
   | GET /api/v1/sessions/:id -> state + one-time connection info
   v
Control Service
   | PostgreSQL (games, users, rights_reviews, game_releases, sessions)
   | Redis (GPU slot leases, session heartbeat)
   | GPU Host Agent <-> Sunshine <-> Moonlight Web Stream <-> Browser
```

真实服务器签发短期会话凭证必须与用户和游戏绑定，且使用防重放机制。存档隔离、节点心跳、清理补偿、错误复核属于 P2 工作，绝不能直接放通生产会话。

## 优先工程拆分

- PR-01 `app-shell-game-library`: 页面、游戏模型、筛选、单测。
- PR-02 `game-detail-rights-preflight`: 详情、前端预检和后端 fail-closed。
- PR-03 `p0-windows-smoke-harness`: Windows GPU 诊断与浏览器报告、真实测试记录。
- PR-04 `session-state-contract`: 会话状态机和 API 接口；暂不连真实 GPU。
- PR-05 `real-stream-integration`: **以 P0 实测通过为前置条件**，补上受认证 StreamProvider + Host Agent。


## v0.3.0 P0 实际控制链路（仅限本机）

```
Monitor (127.0.0.1:7788, operator token)
  POST /internal/lab/sessions  [gameId=supertuxkart, hostId] --default OFF-->
Coordinator / SessionControl  [one process per host, command lease]
  GET /internal/commands?hostId=...  <--- Agent polling
Agent / GameRunner  [strict local executable allowlist; spawn without shell]
  POST /internal/command-results --- launched / stopped / failed ---> Coordinator
Agent / heartbeat  --- running/exited PID ownership ----> Coordinator
Moonlight Web user login/PIN/desktop capture  (manual step; NO AUTOMATED MEDIA API)
```

`state=connecting` **不是** WebRTC connected。`playbackVerified` 始终为 false。
HTTP P0 control 默认只监听 loopback，并要求强 Token，启动必须显式 `-EnableLocalLaunch`。
浏览器用户身份认证、生产数据库、远端节点、正式授权、用户隔离、WebRTC 视频流统计仍未实现。

详细见 [本地进程会话手册](P0-REAL-SESSION-RUNBOOK.md)。
