# CloudPlay P0 — 本地联调：Host Agent + Sunshine + Moonlight Web Stream

> 对应版本 v0.2.0。仅限自己的 Windows GPU 主机、自己的合法游戏、私有局域网/本机。
> 该方案的 Node Host Agent **只检查状态，不修改任何系统设置、不安装软件、不开启游戏会话**。

## 1. 目标与不能越过的边界

- `P0-LAB-01`：由真实 Windows 主机报告 GPU 是否可被 `nvidia-smi` 检测、Sunshine 管理端口 47990 是否监听、Moonlight Web Stream 端口 8080 是否监听、游戏 EXE 是否存在。
- `P0-LAB-02`：Next.js 的 `/p0` 页面可查询 12 秒内的 Agent 心跳，超过 16 秒没有心跳即显示离线。
- `P0-03`：**用户从 Moonlight Web Stream 启动 SuperTuxKart，看到会变化的实时视频、听到音频、手柄/键鼠能改变游戏，并正常退出。** 只有真正进行了这个测试才填入测试报告。
- 上报端口打开 **不等于** PIN 配对成功、编码器可用或 WebRTC 连接成功。
- P1 `POST /api/v1/sessions` 仍返回 503，防止没有授权/认证/独占调度的服务被公开启动。

## 2. 必备条件

- Windows 11 + NVIDIA GPU（NVIDIA 驱动和 `nvidia-smi` 可用）；Node.js 22+
- 从 Sunshine 官方发布页安装 Windows MSI：https://github.com/LizardByte/Sunshine/releases
- 官方 SuperTuxKart：https://supertuxkart.net/Download ，确认可在本机运行。
- Moonlight Web Stream 发布页：https://github.com/MrCreativ3001/moonlight-web-stream/releases
- 固定首轮为同机浏览器，保持 Sunshine Web UI、Moonlight Web 仅在可信网络访问；不暴露公网端口。

## 3. 一次启动本地联调层（Windows PowerShell）

进入项目根目录，在 PowerShell 运行：

```powershell
# -GamePath 换成你实际安装的 SuperTuxKart 可执行文件绝对路径
.\scripts\p0\start-p0-lab.ps1 -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
```

脚本自动生成一个只用于本机的随机 token（文件 `.p0-lab-token`）并建立 `.env.local`（如果尚不存在），启动 **Coordinator**（127.0.0.1:7788）和 **Host Agent**（每 5 秒上报）。启动过程不会改变 Windows 防火墙、不会尝试管理员权限、不会联网安装软件。结束测试可运行 `.\scripts\p0\stop-p0-lab.ps1` 安全停止相关进程。

如果已有 `.env.local`，它不会被覆盖：需手动把 token 与本机 endpoint 写入该文件。

**无需安装 npm 依赖的诊断页面：** 浏览器打开 `http://127.0.0.1:7788/monitor`，粘贴 `.p0-lab-token` 中的 Token 即可看到真实 Agent 心跳（只在页面内存保存，不向其他服务发送）。

另开终端执行：

```powershell
npm install
npm test
npm run dev
# 浏览 http://localhost:3000/p0
```

如想手动启动两个进程：设置相同 `CLOUDPLAY_LAB_TOKEN`（>=32 字符）、`CLOUDPLAY_LAB_ENDPOINT=http://127.0.0.1:7788`、`CLOUDPLAY_GAME_PATH=<EXE绝对路径>` 后，分别执行 `npm run p0:coordinator` 和 `npm run p0:agent`。

> 注意：如果你的 Node 环境无法从 npm registry 下载依赖，仍能独立运行 coordinator + agent 和全部 Node 测试，但 Next.js 页面需要完成安装才能查看。

## 4. 真实串流（不可跳过）

1. 打开 `https://localhost:47990`，创建 Sunshine 管理员帐号，添加 SuperTuxKart 应用启动项。
2. 运行 Moonlight Web Stream 的 `web-server`，通过 `http://localhost:8080` 创建 Web Stream 账户。
3. 添加 Sunshine 主机（两者同机时使用 `localhost`），完成 PIN 配对。
4. 在 Moonlight Web 页面点游戏，观察**真实动态画面**，键盘/控制器操作与游戏音频，并进行退出和重连测试。
5. 将 `docs/P0-EVIDENCE-TEMPLATE.json` 复制到 `.p0-evidence/real-test.json`，填写真实观察结果与截图绝对路径。
6. `node scripts/p0/verify-evidence.mjs .p0-evidence/real-test.json`：该工具只检查**用户观察记录及截图文件是否存在**，不可能独立证明视频/音频正常。

## 5. 端口和权限

| 地址 | 作用 | 暴露范围 |
| --- | --- | --- |
| `127.0.0.1:7788` | 本地联调 coordinator | **仅本机**，所有诊断 API 使用 Bearer token |
| `localhost:47990` | Sunshine 管理 UI | **不要公开暴露** |
| `localhost:8080` | Moonlight Web Stream 的 Web 入口 | 本机首轮验证；公网需专门 HTTPS、认证和 TURN 设计 |
| `localhost:3000/p0` | P1 Next.js 主机状态页面 | 原型阶段不要公开部署；页面只展示脱敏检测结果 |

本地 Agent 仅上报：GPU 检测情况、Sunshine/Web 端口是否开放、游戏文件是否存在。它**不能**证明会话实际玩通，也不会让商业游戏自动获得托管权利。

## 6. 诊断与失败恢复

- GPU 不识别：先运行 `nvidia-smi` 并检查显卡驱动，再排查 Agent。
- Sunshine false：确认 Sunshine 已安装并启动，尝试本机 `https://localhost:47990`。
- Web false：确认 `web-server` 运行并在 8080 提供服务。
- 游戏 EXE false：确认 `-GamePath` 是真实、绝对路径，且可在 Windows 本机运行。
- Host 全 false：检查 Coordinator/Agent 两个 Node 进程，以及 `.env.local` 中 token 是否匹配；状态超过 TTL 会自动变离线。
- 视频不出现：先看 Sunshine 是否可以通过标准 Moonlight 客户端串流，再查 Web Stream WebRTC、ICE、UDP，不能通过单纯打开端口证明问题解决。

## 7. 参考资料

- Sunshine 起步：https://docs.lizardbyte.dev/projects/sunshine/master/md_docs_2getting__started.html
- Moonlight Web Stream：https://github.com/MrCreativ3001/moonlight-web-stream
- SuperTuxKart 官方下载：https://supertuxkart.net/Download
