# CloudPlay M1：本机一键启动 SuperTuxKart（非公网服务）

本阶段把安装后四项服务正常运行的 Windows 实验环境，连接到 **游戏详情页 → 发起真实游戏进程 → Moonlight Web 串流 → 结束进程** 的本机链路。

**边界：** 这是同一台 Windows NVIDIA GPU 电脑上的单人、Loopback 测试模式，不是正式商用云游戏产品；没有公网登录、分布式 GPU 调度、多租户隔离或游戏托管授权。当前真实视频/音频/控制器还必须按 M1 实机验收单独确认。

## 运行环境

- 已完成 Windows NVIDIA 驱动安装；`nvidia-smi` 可用。
- 已安装并配置 Sunshine；管理控制台 `https://localhost:47990` 只供本机管理。
- 已合法安装 SuperTuxKart，可执行文件必须名为 `supertuxkart.exe`。
- 使用 GitHub Actions **Windows full offline** 发行包，不要使用只有源码的 ZIP。
- Moonlight Web 首次登录、Sunshine PIN 配对仍要在 `http://127.0.0.1:8080/` 完成一次。

## 安装和启动

PowerShell 进入已经从真实 GitHub 发行 Artifact 安装好的 CloudPlay 目录，运行：

```powershell
# 首次安装（从已解压的发行包目录）
.\deploy\install-cloudplay.ps1 -InstallRoot 'D:\CloudPlay'

# 后续从安装根目录运行用户入口
& 'D:\CloudPlay\start-active.ps1' -EnableLocalLaunch -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
```

将 `-GamePath` 换成游戏实际所在路径。绝不能使用其他 EXE、命令行参数或远程下载地址。无需部署时安装 Node、npm、Rust 或 MinGW，代码运行在发行包内置 Node 和 Windows 原生 Moonlight 服务上。

然后使用 **同一台 Windows 电脑上的浏览器** 打开：

**`http://127.0.0.1:3000/games/supertuxkart`**

- 页面从本机 Agent 的真实心跳显示 GPU、Sunshine、Moonlight 和游戏文件的状态。未达到全部条件时不能启动。
- 点击 **本机启动游戏**，Next 服务端从持久化状态读取 Coordinator Token（不会发给浏览器），选择唯一满足条件的本机 Host，并发送受限制的 SuperTuxKart 启动命令。
- 成功取得会话后跳转 `/player/local-<session-id>`。这里可以查看会话状态、打开真实 Moonlight Web，或请求 Agent 安全停止游戏。已有会话时详情页显示“继续本机游戏”而不是重复启动。
- Moonlight Web 首次配对完成后，选择 Sunshine 的 **Desktop** 条目连接已经启动的游戏，避免重复从 Sunshine 再启动一个游戏进程。必须亲眼确认持续变化的真实画面、音频与键鼠/手柄，不能用“已启动进程”或 TCP 端口状态代替。
- 游戏结束后点击玩家页 **停止本机游戏**，并观察会话进入 `finished`；停止指令发出不代表立即完成。最后在安装目录执行：

```powershell
& 'D:\CloudPlay\stop-active.ps1'
```

## 默认关闭的安全边界

`-EnableLocalLaunch` 会同时开启本机 Agent 单游戏执行权限和仅本机的 Web Operator。缺少任何一个运行条件，Local API 返回 404 或 403：

- `NODE_ENV=production`、`CLOUDPLAY_LOCAL_OPERATOR_ENABLED=1`、`CLOUDPLAY_ENABLE_LOCAL_LAUNCH=1`。
- Next **必须**绑定 `HOSTNAME=127.0.0.1`，访问 Host 必须是 `127.0.0.1:3000`，Coordinator 必须是 `http://127.0.0.1:7788`。
- 写操作强制同源 `Origin: http://127.0.0.1:3000` 与 `X-CloudPlay-Local-Action: 1`，防止其他网站发送跨站启动请求；拒绝恶意或跨站 `Host` 与 Fetch Metadata。
- 只允许创建 `supertuxkart` 会话；浏览器不能指定真实 Host ID、可执行路径、参数、脚本或密钥。
- HTTPS 公网、多用户共享主机和远端浏览器均未支持，**不要通过 Nginx/Traefik/Dokploy 对公网代理这些本地调试端口**。

该方案没有建立正式的用户账户鉴权体系。它只适用于**受信任的单用户 Windows 主机本机 Loopback**。同一台 Windows PC 上不受信任的本地软件仍然需要由操作系统安全策略隔离。

## 实机验收与错误诊断

初次验收请先执行发行包提供的 `deploy\smoke-windows-installed-runtime.ps1 -BundlePath .`（在没有已运行服务的测试主机上），然后再进行真实 GPU 测试。

常见状态：

- `LOCAL_OPERATOR_DISABLED`：请确认是已安装发行包、显式 `-EnableLocalLaunch`，并通过 `127.0.0.1` 而非机器 IP/域名访问。
- `LOCAL_HOST_NOT_READY`：检查显卡检测、Sunshine 47990、Moonlight Web 8080、游戏 EXE 及 Agent 心跳。
- `HOST_PROCESS_BUSY` / `HOST_SESSION_BUSY`：已有运行中会话，请在详情页选择继续，或等待上一会话安全停止。
- `GAME_NOT_CONNECTABLE`：Agent 尚未确认游戏启动，不能提前进入串流。
- 游戏看似启动但无画面/声音：在 Moonlight Web 登录、PIN 配对并连接 Desktop；检查真实媒体统计，不要把 UI 显示“connecting”当作成功。
- 停止卡住：不要直接删除会话或杀掉不属于 Agent 的进程；检查 `state\logs` 和实际游戏状态。

全部 GPU 画面、音频、输入、三次启动/退出和断线恢复验收要求见 `M1-ACCEPTANCE.md`（发行包根目录）以及 GitHub Issue #3。不要上传配对数据、真实 Token 和私有原始日志。
