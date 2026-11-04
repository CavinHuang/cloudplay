# CloudPlay v0.12 · 一体化项目与离线部署手册

## v0.12 新增：部署机免下载升级 + 自动回滚入口

此文档保留发行包构建细节。实际 Windows 部署推荐使用
[V012-DEPLOYMENT-AND-ROLLBACK.md](V012-DEPLOYMENT-AND-ROLLBACK.md)：
`deploy/install-cloudplay.ps1` 把经过校验的离线包安装到版本槽位，`start-active.ps1`/`stop-active.ps1` 运行当前版本；`-Rollback` 选回上一个完整版本。所有用户凭据、Moonlight 配对和日志独立保存在 `state` 文件夹，不进入程序包或升级覆盖范围。

**安全限制：** SHA-256 校验保证自洽性，不证明发行者身份；升级前确认发行包来自可信渠道。实际 Windows GPU 音视频联调仍是独立验收环节。

## 1. 当前能交付和不能交付的内容

CloudPlay 仓库内已经统一包含网站源码、P0 Coordinator/Agent、Moonlight Web 的固定版本补丁、构建脚本、运行脚本、完整性校验和部署配置。**部署时不应再通过 Git 下载 Moonlight Web，也不应运行 `npm install` 或 `cargo build`。** 所有这些动作都在构建/发布机器上完成一次。

本仓库的**源码归档不是已构建的离线安装包**。真正的离线发布必须包含：Next.js standalone 产物、相应 Node Windows 可执行文件、已打补丁的 Moonlight Web `web-server.exe` + `static/`、对应的完整修改后源码与许可证。如果缺少这些，打包工具会拒绝生成 `windows-full` 发行版。本会话环境无法从 npm / GitHub 下载依赖，也不能执行 Windows/Rust 编译，因此不能提供或宣称已通过 Windows 的一键离线运行包。

## 2. 分离构建环境和部署环境

| 目标 | 构建机（需要网络） | 部署机（离线） |
| --- | --- | --- |
| CloudPlay Web | Node 24，npm，`npm run build` 生成 `.next/standalone` | 已内置 Node.exe + standalone，直接运行 `server.js` |
| Moonlight Web | 固定上游源码、Node 26.4+ / npm 11.17+、Rust GNU、MinGW、wasm-bindgen、CloudPlay 补丁 | `web-server.exe` + `static/`，无需编译器和 npm |
| P0 Host Agent | 仓库内纯 Node 源码 | 已内置 Node.exe，开箱运行；GPU、Sunshine 和游戏仍需真实环境 |
| Windows/显卡 | 无法通过 npm 打包 | Windows 11、兼容的显卡驱动与可用 GPU（主机前提） |
| Sunshine | 官方安装包（可选纳入发布包，需许可审查） | 首次本地安装、配置 PIN/配对；管理页只能本地访问 |
| 游戏内容 | 仅加入有合法分发权的游戏素材和许可说明 | 已合法安装的游戏，或审核通过的内置游戏包 |

## 3. 一次性在线准备（Windows 构建机）

安装 Node 24、Node 26.4+/npm 11.17+、Rust GNU/MinGW 与 wasm-bindgen。保持两套 Node 在不同 PATH 或通过版本管理器切换，不得混用。构建过程可使用 Windows 专用脚本：

```powershell
# CloudPlay 源码根目录；Node 24 环境
npm install --package-lock-only --no-audit --no-fund   # 初次补 lock，保存并提交 lock
npm ci --no-audit --no-fund
npm test
npm run build
node scripts/release/generate-notices.mjs > .\web-DEPENDENCIES.txt

# 切换到 Node 26.4+/npm 11.17+ 后；固定 Moonlight 源码目录
.\scripts\p0\build-moonlight-web.ps1 -MoonlightPath 'C:\build\moonlight-web-stream' -Build
# 必须获得构建成功的 native web-server.exe、static/ 和已补丁的完整源代码。
```

实际 Windows GNU 构建依赖因上游变化而可能调整。已存在的手工/上游构建资产需确认来自**相同提交**和**同一次补丁修改**，不得将未经补丁处理的官方发行包伪装成 CloudPlay 版本。

然后执行打包（以下为路径示例，需根据构建产物调整）：

```powershell
node scripts/release/pack-offline.mjs `
  --mode windows-full `
  --out .\dist\CloudPlay-Windows-Offline `
  --node 'C:\node24\node.exe' `
  --node-license 'C:\node24\LICENSE' `
  --next-standalone '.\.next\standalone' `
  --next-static '.\.next\static' `
  --web-notices '.\web-DEPENDENCIES.txt' `
  --public '.\public' `
  --moonlight-server 'C:\build\moonlight-web-stream\target\x86_64-pc-windows-gnu\release\web-server.exe' `
  --moonlight-static 'C:\build\moonlight-web-stream\static' `
  --moonlight-source 'C:\build\moonlight-web-stream'

node scripts/release/verify-offline.mjs .\dist\CloudPlay-Windows-Offline
```

**发行包中已含 P0 服务、Node 运行时、已编译 Moonlight 和完整对应源码。** ZIP 可直接复制到无网络的 Windows 主机，前提是平台驱动、Sunshine 和合法游戏已安装。`--mode windows-p0` 可仅交付本地 P0 实验套件，暂不要求 Next.js 构建完成。

若许可核查允许并准备好了官方 Sunshine 安装器和真实游戏素材，可以额外用 `--include-sunshine --sunshine <path> --sunshine-license <path>`、`--include-game --game <dir> --game-license <path>` 纳入发行包。此操作**不会自动安装或绕过使用许可**。SuperTuxKart 的素材许可不一定等同代码许可，务必单独审查。

## 4. Windows 部署机：无网络安装和运行

1. 从构建机复制**完整的发行包**，不要只复制源码 ZIP；解压到固定路径。
2. Windows PowerShell：`& .\deploy\start-cloudplay.ps1 -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe' -EnableLocalLaunch`
3. 控制台：`http://127.0.0.1:7788/monitor`；Moonlight Web：`http://127.0.0.1:8080/`；完整模式还提供本地产品网站 `http://127.0.0.1:3000/`。
4. 初次运行仍需要 Moonlight Web 登录、Sunshine PIN 配对与实际游戏进程/声音/控制实测。
5. 使用 `& .\deploy\stop-cloudplay.ps1` 关闭；需要保留运行数据时不要删除 `services/p0/.p0-session-journal.json`。

运行脚本不下载依赖、不开放防火墙、不自动将 P0 调试端点开放公网。生产环境下 Next.js P0 API 仍默认关闭，P0 控制台只在本机提供。**本发行方式目前是单主机开发/体验实验，不是可供公众用户共享的商业云游戏平台。**

## 5. Linux Docker 网站离线交付

在构建机运行：

```bash
docker build -t cloudplay-web:0.12.0 .
docker save -o cloudplay-web.tar cloudplay-web:0.12.0
node scripts/release/pack-offline.mjs --mode docker-web --out ./dist/cloudplay-docker-offline --image ./cloudplay-web.tar
node scripts/release/verify-offline.mjs ./dist/cloudplay-docker-offline
```

复制到部署机（需要事先安装 Docker Engine/Compose）：

```bash
cd cloudplay-docker-offline
sh deploy/load-and-run.sh
```

`pull_policy: never` 及 `docker compose --pull never` 保证不自动拉镜像。这个 Compose **只启动产品网站**，不包含 Windows GPU 主机或公开游戏会话调度。初期建议 Windows 实机和 P0 Agent 同宿主，不要将 `127.0.0.1` 错当跨主机地址。

## 6. 上线前安全/授权门槛

- 用户登录、游戏许可审查、多租户会话隔离、按用户计费、远程 GPU Agent 身份认证均尚未完成。不可直接发布面向公众的 `Start Game`。
- 不把本地 P0 Token、`.env.local`、Sunshine 密码、任何证书私钥、会话日志纳入发行包。
- 修改并再分发 GPL Moonlight 发行物时需提供完整对应源码与相关许可信息；版本、产物与源代码要匹配。
- 真实“能玩”的验收必须包含 Windows GPU 上实际画面连续解码、可听音频和可操作的游戏，以及退出清理证据；自动化测试无法代替这些。
