# CloudPlay M1｜Windows GPU 真实游戏验收（不能用 CI 代替）

CloudPlay 的 Windows **离线编译、启动、安装、升级/回滚**均已在 GitHub Actions Windows Runner 验证。下一道关卡是**真实 NVIDIA GPU + Sunshine + 浏览器 + SuperTuxKart**。本仓库内提供 M1 主机预检、三次会话证据索引和一致性校验，不模拟实际游戏画面，也不自动声称玩家真的听到声音或操作了游戏。

## 一次性准备

从 [main 的 Windows 发行流程](https://github.com/CavinHuang/cloudplay/actions/workflows/offline-windows-release.yml) 取得包含 `runtime/node.exe`、`deploy/`、`services/p0/`、`services/moonlight/` 和 `manifest.json` 的完整 Artifact。Sunshine、显卡驱动、游戏必须**合法安装**在本机；首次 Moonlight Web PIN 配对需要在本机交互完成。不要公开 7788 调试接口、Sunshine 管理页、Token 或账号配对数据。

在已解压完整发行包目录执行（修改游戏安装路径）：

```powershell
.\deploy\install-cloudplay.ps1 -InstallRoot 'D:\CloudPlay'
& 'D:\CloudPlay\start-active.ps1' -EnableLocalLaunch -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
```

在另一个 PowerShell 窗口运行以下命令。**工具完全内置于发行包，无需再安装 npm/Rust/Git。**

```powershell
$active = Get-Content 'D:\CloudPlay\active.json' -Raw | ConvertFrom-Json
$release = Join-Path 'D:\CloudPlay\releases' $active.active
$evidence = 'D:\CloudPlay-M1-Evidence'
& "$release\runtime\node.exe" "$release\services\p0\scripts\p0\create-m1-index.mjs" $evidence
& "$release\services\p0\scripts\p0\m1-host-preflight.ps1" `
   -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe' `
   -StateRoot 'D:\CloudPlay\state' `
   -OutFile "$evidence\host-preflight.json"
```

可以打开 `http://127.0.0.1:7788/monitor` 查看主机报告，从游戏会话进入 `/play/<id>`。在嵌入式 Moonlight Web 中按正常流程登录、PIN 配对，选择 Sunshine 的 Desktop 流，启动和操作 SuperTuxKart。控制链路的开放端口/健康并不代表媒体流成功。

## 三次真实游戏会话

每次从本机控制台启动一条**新的真实会话**，并保存：

1. `/play/<id>` 页面「导出实际媒体采样证据 JSON」→ 重命名为 `cycle-1-media.json`（依次 2、3）。要求持续增长的 `framesDecoded` 与音频接收字节；未接入媒体诊断桥接的浏览器不会通过。
2. 对游戏画面截图并经本机脱敏裁剪 → `cycle-1.png`。不要截图密码、配对凭据、IP、Windows 桌面私人信息。
3. 在真正操作游戏、听到声音、从本机结束游戏并检查无残留进程后勾选播放器内的人工验收项，导出 `cycle-1-manual.json`（依次 2、3）。**导出时不得提前勾选未观察的事项。**
4. 第三次会话中进行一次真实断网/ICE 中断恢复测试，在媒体采样中保留「连接正常 → 断开 → 恢复并新增至少两次视频帧」的序列；人工 JSON 中 `disconnectReconnectObserved` 必须为 `true`。仅点击「重新加载媒体」不能作为 WebRTC 网络断连恢复证据。若客户端不能捕获断连期间的统计样本，报告会保持未通过；不要手动伪造。

播放器现有导出文件里的 `screenshotPath` 字段无需处理；统一校验以 `m1-index.json` 中同文件夹的 `screenshot` 为准。`m1-index.json` 会预先指定全部 3 组文件名。第三次的 `disconnectReconnectObserved` 可在人工 JSON 中按实际观察填写；没有观察到就保持 `false`。

最后执行：

```powershell
& "$release\runtime\node.exe" "$release\services\p0\scripts\p0\verify-m1-acceptance.mjs" "$evidence\m1-index.json"
& 'D:\CloudPlay\stop-active.ps1'
```

结果 `readyForIndependentReview: true` 仅表示以下材料齐全、格式一致：主机预检、3 个不同会话、连续视频帧、音频接收字节、人工视觉/听觉/输入/退出观察、截图和第三次断线恢复的原始统计。**它仍不能独立证明视频内容、可听声音、输入到达游戏或主机资源隔离；最终应由实际操作者核对，不能把其写作自动视频验收成功。**

## 异常处理

- `HOST_CHECKS_INCOMPLETE`：检查 `host-preflight.json` 中 false 项（无敏感详情），例如 Sunshine/47990、Moonlight/8080、协调器/7788、网站/3000、游戏文件和 Agent heartbeat。必须保持 P0 绑定 loopback。
- `TRANSPORT_EVIDENCE_INCOMPLETE`：未看到连续真实 WebRTC 解码帧或音频字节。不要用连接上或静态封面替代。
- `DUPLICATE_OR_INVALID_SESSION`：三次验收错误地复用了同一个会话。
- `RECONNECT_NOT_PROVEN_BY_STATS_AND_OPERATOR`：网络恢复没有统计证据或缺少真实人工观察。检查 WebRTC/ICE 事件采样。
- `EVIDENCE_FILE_INVALID`：文件缺失、过大、路径越界/软链接，截图不是有效 PNG/JPEG/WebP 文件格式。

不要把原始配对数据、`.p0-lab-token`、`state/`、协调器日志上传到公开 GitHub Issue。可共享处理后的总结果、无私人信息的游戏截图和 CI 链接。源码包括所有必要工具，部署机无需下载额外项目。
