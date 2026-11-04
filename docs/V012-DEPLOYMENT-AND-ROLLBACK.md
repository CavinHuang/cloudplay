# CloudPlay v0.12 · Windows 离线安装、升级和回滚

## 目标与边界

**把同一套 CloudPlay 网站、P0 Coordinator/Agent、Moonlight 补丁编译产物和 Node.js 运行时作为一个发行包部署；部署机永不 npm install、cargo build 或 git clone。** Windows GPU 驱动、Sunshine 和你有权使用的游戏需要在目标主机预先存在（或经许可单独准备）。

这里的“零下载”是针对 *CloudPlay 发行与运行依赖*，不是绕过版权、安装操作系统或跳过显卡驱动。真正的 Moonlight/Sunshine 音视频性能验收仍须真实 Windows GPU。

本次交付的是统一源码、版本安装器和自动化测试。**当前不能提供已编译的 Windows 全量离线发行包**：构建机仍需要正确的 Node 24/26、Rust GNU 和网络访问上游资源；当前容器无 Windows GPU，npm registry 无法访问。

## 1. 构建机一次性生成完整发行包

在有网络的 Windows 构建机运行仓库内手动触发的 `.github/workflows/offline-windows-release.yml`，或使用 `scripts/release/build-windows-offline.ps1`。成品必须通过：

- `manifest.json` 逐文件 SHA-256 验证、不可缺少的服务组件检查。
- 内置 x64 Windows Node 和 Moonlight PE32+ 可执行文件的格式检查。
- Moonlight Web 编译 JS 包含诊断适配器；对应 GPL 源码和许可说明入包。
- 完整网站模式包含 Next.js standalone 服务器、静态资源和运行依赖。
- 原始构建不包含 Token、证书私钥、Moonlight 用户数据或游戏会话。

**仅拿到 GitHub 源码 ZIP 并不能执行下面的离线安装步骤。必须使用构建后的 `windows-full`/`windows-p0` 成品目录。**

## 2. 目标 Windows 机器：第一次安装

1. 解压完整离线发行包，例如 `D:\Packages\CloudPlay-Windows-Offline`。
2. 在这个目录中运行 PowerShell（无需开发工具或 npm）：

```powershell
& '.\deploy\install-cloudplay.ps1' -InstallRoot 'D:\CloudPlay'
```

安装器使用发行包内自带的 `runtime/node.exe`：检查发行清单、逐文件校验、PE 架构与必要服务，复制到 `D:\CloudPlay\releases\v0.12.0-<hash>`，然后原子更新 `D:\CloudPlay\active.json`。第一次安装还会建立 `D:\CloudPlay\state`。不会启动服务或下载依赖。

3. 安装并配置好 GPU 驱动、Sunshine 和合法的 SuperTuxKart 后，运行：

```powershell
& 'D:\CloudPlay\start-active.ps1' -EnableLocalLaunch `
  -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
```

检查本地 `127.0.0.1:7788/monitor`、`127.0.0.1:8080`；full 包另检查 `127.0.0.1:3000`。**端口开放只是启动检查，不意味着游戏已正常解码。** Moonlight 登录、配对、真实游戏视频/声音/按键仍要实测。

关闭时：

```powershell
& 'D:\CloudPlay\stop-active.ps1'
```

## 3. 升级与回滚

必须先停止 CloudPlay：

```powershell
& 'D:\CloudPlay\stop-active.ps1'
& 'D:\Packages\CloudPlay-New\deploy\install-cloudplay.ps1' -InstallRoot 'D:\CloudPlay'
& 'D:\CloudPlay\start-active.ps1' -EnableLocalLaunch `
  -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
```

新包会写入一个全新的 `releases/` 槽位，老版本保留。若实际启动、Sunshine 媒体或输入出现问题，停止服务后执行：

```powershell
& 'D:\CloudPlay\stop-active.ps1'
& 'D:\Packages\CloudPlay-New\deploy\install-cloudplay.ps1' -InstallRoot 'D:\CloudPlay' -Rollback
& 'D:\CloudPlay\start-active.ps1' -EnableLocalLaunch `
  -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
```

安装器在检测到 `state/service-pids.json` 时拒绝版本切换；请不要直接删除这个文件绕过检查，先确认旧服务和游戏进程均已停止。`rollback` 只切换程序槽位，**不会回滚或删除用户数据**。如果未来发生数据格式迁移，还需要单独设计兼容迁移和备份。

## 4. 文件布局

```text
D:\CloudPlay\
  active.json                # 当前版本、上一版本的槽位 ID
  start-active.ps1           # 永久入口（由离线安装器维护）
  stop-active.ps1
  releases\
    v0.12.0-abcdef123456\   # 校验过的完整只读发行包
    v0.13.0-...\             # 升级后保留的其他版本
  state\                     # 不随版本切换的用户数据
    .p0-lab-token
    .env.local
    .p0-session-journal.json
    .p0-lab-pids.json
    service-pids.json
    moonlight\
      static\                # 启动时同步当前版本 Web 静态资源
      server\                # 用户账号、Sunshine 配对持久化
    logs\
```

账号和配对信息由 Moonlight Web 维护。`state` 含敏感信息，请限制 Windows 文件系统访问权限，不要上传 GitHub、分享整个状态目录或公开端口。

## 5. 安全、测试和已知限制

- 发行包 SHA-256 和本地 PE 头检查只检测损坏/结构不匹配；**不证明二进制可信或供应链安全**。通过可信渠道获取发行包，有条件时使用签名发行和防病毒扫描。
- 当前 PowerShell 启动与配对状态尚未在真实 Windows GPU 主机上验收；Moonlight 原生构建仍需 Windows GNU 工具链。
- 生产 Next.js 默认不开放本机 P0 游戏启动 API，公网多用户云游戏功能尚未完成。
- `state/moonlight/static` 会在服务停止后的下次启动同步当前程序版本资源；`server/` 账户和配对记录保持不变。
- 再次运行 `node deploy/verify-offline.mjs <release-slot>`，可以确认发行文件在首次启动后未被意外写入。
- Docker/Dokploy 网站镜像离线交付仍用原有 `docker load` 路径，不包含 Windows GPU Agent。
