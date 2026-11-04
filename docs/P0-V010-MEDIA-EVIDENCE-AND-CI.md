# CloudPlay v0.10 — P0 Media Evidence and Verified Build Gates

Date: 2026-11-04. **Not a declaration of successful Windows game streaming.**

## Purpose

The previous P0 player could export a human checklist, but it could not
independently distinguish an instrumented video connection from someone
checking a box. v0.10 adds bounded, sanitized, short-term media samples and
an offline verifier. The collection is local and runs only when the
instrumented Moonlight Web is embedded inside the loopback CloudPlay player.

### The actual P0 use path

1. Check the computer has Sunshine, SuperTuxKart and Moonlight Web. Use a
   legitimate open-source installation; do not provision unlicensed games.
2. Build Moonlight Web from the **pinned commit** with Node **26.4.x**,
   npm **11.17.x**, Rust and wasm-bindgen-cli. It is separate from
   CloudPlay's Node >=22 toolchain.
3. To test JS/WebRTC instrumentation first, run:

   ```powershell
   .\scripts\p0\build-moonlight-web.ps1 -MoonlightPath C:\dev\moonlight-web-stream -Build -FrontendOnly
   ```

   The command must find the `cloudplay.p0.media.v1` marker and
   `framesDecoded` in the *compiled* `dist/` bundle. **This does not create a
   runnable Moonlight Web server.**
4. For a complete Windows server, use the same script with `-Build` only,
   after installing the Windows Rust GNU target and MinGW GCC. Always check
   the upstream repo README and the script's preflight output.
5. Start Sunshine and the built Moonlight Web, complete login and PIN pairing;
   choose the Sunshine **Desktop** stream after the Agent has launched the
   allowed SuperTuxKart process. Never assume one is paired from an open port.
6. Start the lab in a local-only PowerShell session:

   ```powershell
   .\scripts\p0\start-p0-lab.ps1 -EnableLocalLaunch -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
   ```

   Open `http://127.0.0.1:7788/monitor` to start a single test session. In
   the corresponding `/play/<session-id>` page, load the instrumented
   Moonlight Web via the embedded-mode button. If the upstream security
   headers block embedding, do not disable browser security to fabricate
   instrumentation. Use a separate tab and record the media limitation.
7. After several seconds of real video, press **导出实际媒体采样证据 JSON**. Save
   the JSON locally and run:

   ```powershell
   node scripts/p0/verify-media-evidence.mjs .\cloudplay-p0-XXXXXXXX-media-evidence.json
   ```

   The verifier returns nonzero if too few video frames or no audio
   bytes advanced. **Counters are cooperative/untrusted browser evidence;
   passing does not establish the image showed SuperTuxKart, audio was
   audible, the controls reached the game, or the GPU process exited.**
8. Separately export the human checklist, attach a real screenshot, confirm
   gamepad/keyboard interaction and graceful exit on the host. Run:

   ```powershell
   node scripts/p0/verify-evidence.mjs .\cloudplay-p0-XXXXXXXX-manual-evidence.json
   ```

## Exactly what v0.10 validates

| Check | Required signal | What it means |
|---|---|---|
| Compiled bridge | marker present in compiled JS + HTML | the Moonlight browser bundle includes instrumentation |
| Media samples | allowed source + challenge + session, bounded collection | stats originated from cooperating iframe messaging, not trusted attestation |
| Video transport | connected ICE + 2 consecutive frame increases over 1.5s | frames were decoded in the instrumented browser instance |
| Audio transport | received audio bytes increased | incoming audio data was observed, NOT proof sound was audible |
| Game content | real video / photo of gameplay | must be independently observed on Windows |
| Game input | physical interaction in game | must be independently observed on Windows |
| Exit/cleanup | actual game process gone, session released | verify on Windows with Agent and OS process data |

### CI option (no local toolchain)

`.github/workflows/cloudplay-upstream-build.yml` is a **manually triggered**
workflow that checks out the exact upstream commit, patches it, compiles
its frontend and Rust bindings, and verifies the compiled telemetry marker.
Optionally it builds the Linux native server. It has **no real GPU** and
cannot pass the game-streaming gate. It will only run after this repository
is pushed to a writable GitHub repository. Its first execution is still
pending; do not describe it as a green CI build.

### Current limitations

- This environment cannot resolve the npm registry. Next.js `npm run build`
  and complete Moonlight source compilation cannot be marked passed here.
- The browser environment forbids HTTP navigation and local ICE; there are
  no actual decoded video frames from a game here.
- Windows PowerShell and Windows GPU executions are **not** performed in this
  environment.
- No GitHub writable CloudPlay remote is linked to this local repository.
- The instrumented client sends only allowlisted numeric counters. The
  collector stores at most 180 samples in memory, avoids addresses and SDP,
  and clears the trace when a new embedded stream or local disconnect begins.
