# 下一阶段：从 P0 手动交接升级为真正的 WebRTC StreamProvider

目前桥接方式是打开 **独立认证** 的 Moonlight Web Stream 网页（<https://github.com/MrCreativ3001/moonlight-web-stream>）。Sunshine 负责游戏桌面捕获，CloudPlay 的 Agent 只负责启动自己允许的游戏进程。Moonlight Web 具备自己的账号登录、主机 PIN 配对和媒体协商，CloudPlay 没有读取登录口令或伪造客户端接口。

## 推荐完成顺序

1. **Windows P0-03 真实验收**：Sunshine 与 Moonlight Web 配对成功，使用 Desktop 串流已运行的 SuperTuxKart，实测视频、声音、鼠标与手柄、正常退出。
2. **确定安全集成契约**：核对上游稳定版本的路由和许可。若无公开稳定嵌入协议，不应猜测私有 HTTP API；可保留独立窗口或基于许可证 fork 做同源集成。
3. **明确媒体事件边界**：`signaling_ready` → `peer_connected` → `first_video_frame` → `audio_active` → `input_verified` → `reconnecting` → `ended`。每个状态必须来自客户端实际事件，不是端口检测或 game.exe PID。
4. **公网前置条件**：用户/主机权限绑定、短期会话令牌、TURN、TLS、节点隔离、授权审查、持久化租约、计费和运维审计。
5. **跨设备体验**：移动端虚拟按键、Gamepad API、Pointer Lock、键盘锁定、画质设置和真实网络指标。

**本版没有任何真实 WebRTC 数据链路接入 CloudPlay 播放器**；/player/preview 仍是预览。拒绝把外部 Moonlight Web 的 URL 包装成已经内嵌的播放器。
