# CloudPlay P0-03 · Browser Streaming Handoff / Windows Lab

> Version 0.4.0 · 2026-11-04. This runbook intentionally distinguishes verified control-plane behavior from unverified media behavior.

## What the new player **does**

- Local Coordinator serves `/play/<session-uuid>`, a real browser page that can load the independently authenticated Moonlight Web Stream site at a fixed **loopback** origin.
- Coordinator returns `/internal/lab/sessions/<session-uuid>/stream-handoff` **only after** an authenticated, allowlisted game session has been acknowledged by the Agent and the host heartbeat is fresh with Web Stream port detectable.
- Open Moonlight Web in an embedded iframe as an optional test; if frame protection, cookies, fullscreen or gamepad support prevent playback, **open a separate browser tab**. No embedded integration is guaranteed.
- The Web page also displays the actual control-plane state and provides a stop button. The operator may export **manual** video/audio/input/exit observations.
- Next.js `/p0` lists the P0 sessions and links to `/player/p0-<uuid>`; this reads a sanitized P0 session API. The final local playback experience remains hosted by the P0 Coordinator (no production authorization system is present).

## What it deliberately **does not** do

- It does not implement GameStream protocol, WebRTC signaling or bypass Moonlight's own login / PIN pairing.
- It cannot inspect media data from an independent cross-origin iframe: **no fake FPS, audio, video or latency proof**.
- It cannot provide remote users with a multi-tenant cloud gaming session. The local URLs refer to **the browser user's own device**, so they must not be published as public streaming links.
- It does not obtain/authorize proprietary games. Use only your own legally obtained game for local tests.

## On the same Windows 11 PC (with Node.js 22+ and NVIDIA GPU)

1. Install Sunshine from its official release, create an admin login at `https://localhost:47990`, and confirm NVIDIA hardware encoding works. Do not publish the admin endpoint.
2. Install a legitimate SuperTuxKart build, locate `supertuxkart.exe`.
3. Install Moonlight Web Stream from its official releases and start the **web-server**. Visit `http://127.0.0.1:8080/`, create its first user and pair Sunshine using the displayed PIN. Note: first-user behavior and exact options may vary by Moonlight Web version.
4. From the project root, run in PowerShell:

   ```powershell
   .\scripts\p0\start-p0-lab.ps1 -EnableLocalLaunch -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
   ```

5. Navigate to `http://127.0.0.1:7788/monitor`; copy the locally generated `.p0-lab-token` into the page. Start a session. Its ID will appear, then click **进入 Web 播放器** to navigate to `/play/<uuid>`.
6. On the new page, enter the same local token and wait until the coordinator reports `connecting`. Click **在此打开 Moonlight Web**, or use the new-tab option (recommended if iframe fails).
7. In Moonlight Web, select the Sunshine **Desktop** entry to connect to the game already launched by the Agent. **Do not click a game-specific Sunshine app that launches a second SuperTuxKart process**. If Sunshine does not have a Desktop app entry, add one or, for a manual standalone test, don't use the Agent launch and let Sunshine launch the game itself.
8. Verify real moving video, game audio, keyboard/gamepad control, and that closing the session stops the game process; record outcomes only after observation.
9. Export the manual JSON record, set `screenshotPath` to a real local screenshot absolute path, and run:

   ```powershell
   node scripts/p0/verify-evidence.mjs 'C:\Users\<you>\Downloads\cloudplay-p0-manual-evidence.json'
   ```

10. Stop the lab with `scripts/p0/stop-p0-lab.ps1` and verify the game is no longer running.

## Common failures

| Symptom | Diagnosis | Action |
| --- | --- | --- |
| `GAME_NOT_CONNECTABLE` | Agent has not confirmed process start, or session stopped/failed | Check `/monitor` reason and Agent output |
| `STREAM_HOST_UNAVAILABLE` | Agent offline, heartbeat stale, or port 8080 is not reachable | Start Web Stream and check it in the same Windows session |
| Blank iframe / blocked frame | Moonlight Web disallows framing, browser blocked third-party cookies, or permissions | Use **在新标签页打开**; don't weaken browser security headers indiscriminately |
| Gamepad does not work | Secure context / Gamepad API limitations | Use HTTPS with a trusted cert for remote playback; try a compatible browser, use new tab |
| Black screen | Sunshine capture / permissions / wrong display or GPU | Verify Sunshine desktop streaming independently before blaming CloudPlay |
| No keyboard input | Focus / Pointer Lock / OS-reserved keys | Focus Moonlight tab and test full screen; check its documented controls |
| Outside LAN fails | ICE/NAT issues | Use appropriately configured STUN/TURN and valid HTTPS; public deployment needs full authentication |

Moonlight Web upstream reference: https://github.com/MrCreativ3001/moonlight-web-stream

## Verification evidence boundaries

The test suite covers: local HTTP authorization, session state gates, host heartbeat freshness, safe stream URL whitelist, sanitized Next API output, and **real OS process start/stop** on Linux. It does **not** cover real NVIDIA GPU capture, actual Windows executable, Moonlight PIN pairing, or a WebRTC decoded frame. An exported checklist reflects a human claim and is never elevated to a machine-verified `streamVerified=true` state.
