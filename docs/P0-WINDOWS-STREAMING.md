# P0｜Windows GPU → Sunshine → Moonlight Web Stream → Browser

本指南用于**真实串流验证**。开发工作容器没有用户的 Windows GPU 主机权限，因此没有声称 P0 已经跑通。

## 范围和安全约束

- 第一轮仅在**你自己的 Windows 主机和局域网**进行，且只运行你有权使用的游戏。
- 不修改系统防火墙规则，不自动从非官方站点下载软件，不直接暴露 Sunshine 管理界面到公网。
- 对外访问必须有 HTTPS、独立认证，并评估 NAT/ICE/TURN；不要将 `localhost`、自签名证书或 Demo 账户直接用于公网服务。
- 单 GPU 单用户独占会话；第一轮不承担多租户隔离目标。

## A. 主机准备

1. 查看显卡与驱动状态（如有 NVIDIA 工具）：`nvidia-smi`。
2. 从官方 [Sunshine Releases](https://github.com/LizardByte/Sunshine/releases) 下载 Windows 安装包并安装。
3. 启动 Sunshine，访问 `https://localhost:47990`，建立**强密码**，参考 [官方文档](https://docs.lizardbyte.dev/projects/sunshine/latest/)。
4. 配置一个有合法使用权的测试游戏。首选 [SuperTuxKart 官方下载](https://supertuxkart.net/Download)。先在本机打开，确认显卡渲染、画面和声音正常。
5. Sunshine 管理服务仅保留本地/可信局域网访问。先使用默认设置验证，再调整编码分辨率。

## B. 浏览器串流端准备

1. 从 [moonlight-web-stream GitHub Releases](https://github.com/MrCreativ3001/moonlight-web-stream/releases) 获取与你的 Windows 架构匹配的已发布构建。请以目标 Release 分支的 README 为准，**不要混用 master 分支的开发版配置**。
2. 解压并按发布包说明启动 `web-server`。如果自编译，仓库 README 提到了 Rust 和前端构建步骤；非必要不建议首轮自编译。
3. 在测试主机访问 `http://localhost:8080`；创建初始账户（首个账户通常获得管理员身份），添加 Sunshine 主机 `localhost`（两者同机）。
4. 在页面发起配对，进入 Sunshine UI 的 PIN 页面输入代码；再从 Web 页面选择配置的游戏。
5. 查看浏览器是否真的收到动态画面、声音与键鼠/手柄响应；这一阶段属于 **P0 的真正成功条件**。

> 注意：浏览器手柄和 Keyboard Lock 等特性通常要求 HTTPS 或 localhost 这类安全上下文。非同机局域网 HTTP 访问时，不能假设它们全部可用。

## C. 只读诊断

用 PowerShell 在项目目录执行：

```powershell
Set-Location .\scripts\p0
powershell -NoProfile -ExecutionPolicy Bypass -File .\diagnose-windows.ps1 -OutputPath .\host-report.json
```

脚本记录主机 GPU、驱动以及 `47990`（Sunshine UI）和 `8080`（Web Stream）是否在本地监听。**端口可通不代表视频已经连通**。

打开 `scripts/p0/browser-preflight.html`，点击“执行预检”，导出浏览器能力 JSON。真实的 WebRTC/游戏帧率与输入延迟仍需在实际串流中测试。

## D. 实际测试矩阵（不填假成绩）

| 测试编号 | 场景 | 验收动作 | 结果 |
| --- | --- | --- | --- |
| P0-01 | Sunshine 管理页面 | 本机 HTTPS 可登录 | 待用户主机运行 |
| P0-02 | Moonlight Web | 浏览器登录、PIN 配对成功 | 待用户主机运行 |
| P0-03 | 真实视频 | SuperTuxKart 实时画面持续更新 | 待用户主机运行 |
| P0-04 | 输入 | 键盘/手柄操作能改变游戏状态 | 待用户主机运行 |
| P0-05 | 音频 | 游戏声音能持续播放 | 待用户主机运行 |
| P0-06 | 退出 | 结束游戏后主机资源释放 | 待用户主机运行 |
| P0-07 | 重连 | 断网/切换页面后能明确重连或终止 | 待用户主机运行 |
| P0-08 | 网络范围 | 非同机浏览器经 HTTPS 并正确认证 | 待用户主机运行 |
| P0-09 | 真实指标 | 记录分辨率、帧率、丢帧、RTT 与采样时间 | 待用户主机运行 |

## E. 失败分析路线

- Sunshine UI 未启动：先检查进程、驱动/屏幕状态，不要先排查网页域名。
- Web Stream 8080 不通：检查 web-server 进程和本地监听端口。
- PIN 不通过：核对 Sunshine 主机地址、配对流程和服务版本。
- 网页有 UI 但无视频：检查 GPU 编码器可用性、浏览器 WebRTC 与 ICE candidate，不要将 UI 200 视为成功。
- 局域网成功而公网失败：检查 NAT/UDP、防火墙、HTTPS、安全上下文和 TURN；可以考虑 WebSocket 兼容传输，但需实际测量延迟。
- 能看视频但不能控制：检查 Gamepad API、Pointer Lock、键盘输入焦点和 Web Stream 控制映射。

## F. P0 → P1 集成门槛

确认 P0-01 至 P0-06 成功后，才开始开发真正的 `StreamProvider` 适配层：

1. Host Agent 上报节点身份、游戏安装和进程状态（需要服务认证）。
2. 控制 API 分配独占会话租约，后端调用串流适配器创建受限入口。
3. 网页 Player 获得**短期一次性连接凭证**，不能拿到主机管理员密码。
4. 会话超时和错误中断可以停止游戏、释放锁、处理存档。
5. 对游戏发行商/平台和源代码/素材的商用云托管许可单独审批。

**当前 P1 为 UI + API 安全占位工程，绝不能在没有这些门槛时把 `/api/v1/sessions` 改成“成功”。**

### 参考

- Sunshine: https://docs.lizardbyte.dev/projects/sunshine/latest/
- Moonlight Web Stream: https://github.com/MrCreativ3001/moonlight-web-stream
- 官方 README 包含 STUN/TURN、WebRTC UDP 端口范围、HTTPS 安全上下文等说明。
