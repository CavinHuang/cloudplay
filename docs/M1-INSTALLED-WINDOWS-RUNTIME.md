# CloudPlay M1：安装后真实启动 / 停止验证

本关卡保证的是 **Windows 离线程序的服务生命周期**，不代表 Sunshine 已配对、GPU 编码、游戏画面、声音或输入通过验收。

## 为什么需要这一关

发行包以前已经验证了 Moonlight、Coordinator、Agent 和 Next.js 可以独立启动，也验证了安装器升级回滚。2026-11-05 的实际 Windows 安装版测试首次发现：`start-active.ps1` 能正常启动四项服务，但在空会话状态下，`stop-active.ps1` 进入 `stop-p0-lab.ps1` 时会解引用空的 `state`，导致安全停机中断。见 [失败证据](https://github.com/CavinHuang/cloudplay/actions/runs/41957136188)。

修复后的脚本会忽略空会话，并在读取主机 `activeGame.state` 前检查 `activeGame` 是否存在。**对真正存在的未结束游戏，仍必须经过 Agent 确认停止；不能跳过安全清理或随意强制杀进程。**

## 正式 Windows 发行验收

发行包内提供 `deploy/smoke-windows-installed-runtime.ps1`。在仅用于验收、没有运行中的 CloudPlay 服务的 Windows 主机上，执行：

```powershell
.\deploy\smoke-windows-installed-runtime.ps1 -BundlePath .
```

脚本会在临时目录内新装一份发行包，使用内置 Node 和真实 `start-active.ps1` / `stop-active.ps1` 连续完成两次启动/停止，并检查：

1. Moonlight `/config.js`、P0 `/health`、Next `/api/v1/health` 和 Agent 认证心跳。
2. 7788、8080、3000 端口只监听 Loopback，停止后监听消失。
3. 服务 PID 文件在运行时存在、停机后清除。
4. 本地认证 Token 在重启前后保持一致。
5. 程序版本槽位不变，启动和停机没有改写经过 SHA-256 验证的发行包。

此脚本不启动游戏，不下载任何项目，不应上传原始本地日志或凭证。若机器已有 CloudPlay 服务，请先使用安装目录的 `stop-active.ps1` 正常关闭，再执行此隔离验收。

CI 在同一次 Windows 原生构建后下载该次 Artifact，按顺序验证文件完整性、独立启动、安装回滚、四服务联合启动和本次安装版生命周期测试。必须全部成功才能认为 **Windows 离线部署与服务管理关卡通过**。

## 与实际 GPU 游戏验收的区别

本关卡只验证服务。真正的 M1 游戏游玩还需要实体 NVIDIA GPU Windows 主机、Sunshine 和合法安装的 SuperTuxKart，完成 PIN 配对、真实解码帧、可听音频、键鼠操作、三次启动/停止及断线恢复。详见 `docs/M1-WINDOWS-GPU-ACCEPTANCE.md` 和 GitHub [Issue #3](https://github.com/CavinHuang/cloudplay/issues/3)。
