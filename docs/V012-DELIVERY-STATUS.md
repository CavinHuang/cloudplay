# CloudPlay v0.12.0 · 实际交付状态（2026-11-04）

## 已实现并自动验证

- 单仓库 Windows `windows-full` / `windows-p0` / `docker-web` 发行包格式保留。
- 通过 `deploy/install-cloudplay.ps1` 使用发行包自带 Node 安装，部署机器不再安装 Git/npm/Rust。
- 版本槽位 `releases/<version>-<manifest-hash>`，`active.json` 控制激活和上一版本；通过 `start-active.ps1`/`stop-active.ps1` 启停；回滚不覆盖 `state` 目录。
- 对目标包进行完整 SHA-256、必要服务/许可文件、x64 PE32+ 格式检查；创建和复制采用 staging → 校验 → 重命名流程。
- 主程序运行状态、P0 Token、会话日志、Moonlight 用户账号与 Sunshine 配对、日志移出校验包，保存在安装根目录 `state/`。
- 测试包含：重复安装、版本切换、回滚、数据不丢失、篡改拒绝、运行中拒绝升级、错误二进制拒绝、离线 CLI 完整调用。
- `npm test`: 112/112 pass；`npm run check:source`: 80 files, 0 syntax errors。以上不等于 Windows PowerShell 实机运行成功。

## 当前未能完成的硬门槛

- Next.js 生产构建：`npm run build` 返回 `sh: next: not found`；当前环境无法从 npm registry 下载依赖，无法生成 standalone 网站产物。
- Moonlight Web Rust/Node 上游完整构建：未执行，本环境没有受支持的 Windows GNU 构建工具链和固定版本全部依赖。
- 未获得真实的 Node Windows 发行二进制、Moonlight patched `web-server.exe` 和已编译的静态资源；因此此源码包 **不是已完成的 Windows 离线发行包**。
- 未在 PowerShell/Windows 运行或进行 Sunshine PIN 配对、WebRTC 视频帧增长、音频、手柄/键鼠、游戏进程退出的实机验收。
- 尚未部署或推送 GitHub 远端；本地已提交完整代码历史并制作 Git Bundle。

## 仍须关注的风险

- SHA-256 清单和 PE 头检查不保证软件发行身份或可信来源；正式分发需要签名与来源审查。
- Moonlight 的 `static/` 和 `server/` 采用独立工作目录，需在固定上游编译后通过 Windows 实机验证其相对路径读取行为。
- 当前仍属于单机 P0 工程。公网付费云游戏所需用户授权、GPU 多租户隔离、真实游戏授权和会话计费尚未实现。
- `state` 中包含敏感 Token、配对及账户信息，备份和迁移时必须单独保护。
