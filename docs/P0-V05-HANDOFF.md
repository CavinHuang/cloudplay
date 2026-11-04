# CloudPlay P0 v0.5 · P1 直连 Moonlight Web 验证手册

## 目标与边界

通过 P1 的 `/player/p0-<uuid>` 无缝打开 Moonlight Web Stream，同时**不**通过前端向浏览器传输 P0 Bearer Token。P0 Coordinator、Agent 与 Next.js 必须运行在**同一台 Windows GPU 主机**的 `127.0.0.1` 上。这是单人 P0 测试，不是公网云游戏服务。

官方上游文档：https://github.com/MrCreativ3001/moonlight-web-stream

## 操作流程

1. Windows 11 安装 Node.js 22+、Sunshine、Moonlight Web Stream 和正版 SuperTuxKart。先单独确认 Sunshine 在 `https://localhost:47990` 可配置，Moonlight Web 在 `http://127.0.0.1:8080/` 可登录和配对。
2. 解压本工程，按实际安装路径运行：

   ```powershell
   .\scripts\p0\start-p0-lab.ps1 -EnableLocalLaunch -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
   ```

3. 脚本将生成/同步 `.env.local` 中的 `CLOUDPLAY_LAB_TOKEN`、`CLOUDPLAY_LAB_ENDPOINT`、`P0_STREAM_URL`、`CLOUDPLAY_P0_UI_ENABLED=1`，不修改其他已存在的配置。
4. `npm install; npm test; npm run dev` 后打开 `http://127.0.0.1:3000/p0`。如果首次进入网站，检查对应状态为真；**端口开放不代表可玩**。
5. 访问 `http://127.0.0.1:7788/monitor`，凭本地 `.p0-lab-token` 创建 SuperTuxKart 会话。回到网站 `/p0`，点击对应会话进入 `/player/p0-<uuid>`。
6. 会话到 `connecting` 且主机心跳/8080 端口正常后，点击 **连接 Moonlight Web**：浏览器会打开 `/api/v1/p0/sessions/<uuid>/open`，服务端再次校验并 `302` 重定向到 Moonlight Web 本机页面。已失效、正在停止或未知会话**必须拒绝**。
7. Moonlight Web 登录、与 Sunshine PIN 配对，选择 **Desktop** 连接 Agent 已启动的游戏，**不要**再次点击启动同一游戏程序的 Sunshine App 项。
8. 人工验收视频帧变化、游戏音频、键鼠/手柄输入、退出回收和断线重连；只有实测通过才能记录。
9. `./scripts/p0/stop-p0-lab.ps1` 正常结束，核对进程已结束。

## 按状态排错

| 现象 | 要检查的项 |
|---|---|
| `/p0` 显示不存在 | 确认 `.env.local` 的 `CLOUDPLAY_P0_UI_ENABLED=1`、Next 正在 development 模式并重启 `npm run dev` |
| `LAB_NOT_CONFIGURED` | Next.js Server 端能否访问 `127.0.0.1:7788`，Token 是否同步 |
| `GAME_NOT_CONNECTABLE` | 本机游戏启动是否被 Agent 确认，会话是否已停止、失败或取消 |
| `STREAM_HOST_UNAVAILABLE` | Agent 心跳、8080 端口及 Moonlight Web 启动状态 |
| 302 后找不到页面 | 浏览器是否在**同一台 Windows 电脑**；Moonlight Web 是否实际响应 8080 |
| Moonlight Web 打不开游戏 | 完成其自身登录和 Sunshine PIN 配对；先在独立应用确认可用；不要混淆进程启动与视频已连接 |
| 黑屏/无声/手柄失效 | Sunshine 捕获设备、NVENC、浏览器权限、Moonlight Web WebRTC/ICE、HTTPS 安全上下文 |

## 验证边界

已经由 Node HTTP 集成测试覆盖：路由 302、状态门禁、无令牌返回、恶意外部 URL 拒绝、会话停止后不允许交接、生产 P0 关闭，以及 Windows 模拟执行器先优雅后强制回收。**没有**在本容器中验证 Windows 游戏或实际 WebRTC 音视频。实际运行前须确认 Moonlight Web 的版本与部署方式、上游客户端独立认证设置。不要把 8080、47990 或 7788 直接映射到公网。
