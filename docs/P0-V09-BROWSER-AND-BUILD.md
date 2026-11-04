# CloudPlay v0.9 — Browser/WebRTC diagnostics + pinned upstream build

Status: **engineering integration, not playable cloud gaming**. Revision: 2026-11-04.

## What changed

1. `tests/browser-real-webrtc-smoke.py` runs Chromium with an actual local `RTCPeerConnection`, generated canvas video, and the **compiled v0.8 Moonlight Web diagnostic adapter**. This is a *synthetic-video browser test*, not a game test. In a normal browser/OS it launches two localhost HTTP origins (7788 and 18080), exchanges WebRTC SDP/ICE, and verifies the protocol, the observer's actual inbound-frame counters, and that IP/candidate information isn't shared with the parent.
2. If an execution environment blocks every Chrome HTTP/HTTPS navigation, `--mode auto` falls back to `about:srcdoc` opaque origins. It modifies the diagnostic adapter's **origin constants in the temporary test copy only**. This allows protocol and `getStats` runtime integration tests. **It does not verify cross-origin HTTP security or video decoding.** The committed production adapter is unchanged.
3. `--require-frames` makes the smoke test fail if actual inbound decoded frames are not increasing. Use it on a developer Windows machine with permissive local ICE; never infer video success from an ACK or a sample with 0 frames.
4. `scripts/p0/check-moonlight-toolchain.mjs` validates the **pinned Moonlight Web** minimum Node 26.4.0 and npm 11.17.0, independent of CloudPlay's own Node >=22 requirement. Checks are exact and fail early.
5. `scripts/p0/build-moonlight-web.ps1` validates the pinned checkout, preflight checks, and (with `-Build`) applies the patch and runs npm/Rust compilation using the Windows GNU target. It checks that it will not overwrite a pre-existing `static/` output folder. **This PowerShell workflow was not executed on Windows in this environment.**
6. `scripts/check-source-syntax.mjs` parses local JS/JSX/TS sources using TypeScript (installed locally or globally). This is **not** a Next.js production build, since it does not resolve dependencies or execute Next.js.

## Local use

```powershell
# 1. CloudPlay Node 22 is sufficient for local control plane/tests:
npm test
node scripts/check-source-syntax.mjs

# 2. Use a SEPARATE terminal/toolchain with Node 26.4.x/npm 11.17.x for upstream:
git clone https://github.com/MrCreativ3001/moonlight-web-stream.git
git -C moonlight-web-stream checkout 7b9821430e07087f459db3db9aac550e1e9c9bff
.\scripts\p0\build-moonlight-web.ps1 -MoonlightPath .\moonlight-web-stream

# 3. After installing Rust GNU / MinGW and wasm-bindgen-cli:
.\scripts\p0\build-moonlight-web.ps1 -MoonlightPath .\moonlight-web-stream -Build

# 4. Optional browser smoke: stop other apps using 7788 or 18080 first
python -m pip install playwright
python tests/browser-real-webrtc-smoke.py --browser "C:\Program Files\Google\Chrome\Application\chrome.exe" --mode http --require-frames
```

**Path note**: The above paths are examples. When the Moonlight checkout and CloudPlay checkout are siblings, call the PowerShell runner from CloudPlay's root and pass `..\moonlight-web-stream` as `-MoonlightPath`. The pinned upstream requires `npm run build` frontend bindings as well as `cargo build --release` backend. Read the exact pinned `package.json`, not the latest master docs.

### Hard acceptance criteria: four separate gates

| Gate | Required proof | This runtime |
|---|---|---|
| A. Transport instrumentation | Real Chrome `RTCPeerConnection.getStats()` + origin/nonce protocol | **Partially tested** — real API, opaque-origin fallback; reported frames=0 |
| B. Third-party upstream build | Pinned checkout, patched TS, frontend + native Rust build | **Not run** (network toolchain unavailable) |
| C. Sunshine game | Windows GPU image actually displayed and changing; audio audible | **Not run** (no host) |
| D. Game input + exit | Mouse/controller works in the game; process and GPU slot recovered | **Not run** (no host) |

Avoid falsely marking an experiment passed if any of the requested capabilities were not physically tested. A fully green Node test suite is **not** proof of C or D.

### Current sandbox findings

The Python browser smoke in `--mode opaque` returned:

```json
{"result":"PASS_BRIDGE_ONLY_MEDIA_NOT_VERIFIED","mode":"OPAQUE_ORIGIN_DOM_FALLBACK",
 "ackCount":1,"connection":"new","ice":"new","firstFrames":0,"lastFrames":0,
 "decodedFrameProgress":false,"httpCrossOriginVerified":false,"gpuVerified":false}
```

This browser environment blocks all navigation with `ERR_BLOCKED_BY_ADMINISTRATOR` (including ordinary and loopback URLs). The genuine peer was created and called `getStats`, but local ICE did not establish a media connection; no decoded frame proof exists. The second iframe forged a telemetry message; the parent rejected it based on `event.source`.

### Current build limitation

The sandbox cannot resolve `registry.npmjs.org` (`EAI_AGAIN`), so Next.js production build and Moonlight upstream source/dependencies remain unavailable here. `npm test` and offline TypeScript source parsing are only partial checks.

### Next engineering task after Windows host run

1. Record real video, audible audio, gamepad/mouse actions, and independent process exit evidence.
2. Capture ICE/connection logs and the **instrumented** decoded-frame deltas. Redact network addresses/secrets.
3. If cross-origin embedding is blocked by Moonlight Web headers, retain its authentication and iframe defenses: use external-window playback; don't disable security headers to obtain stats.
4. Fix only the actual integration failures identified by the host run, then promote a verified StreamProvider to the production P1 player.
