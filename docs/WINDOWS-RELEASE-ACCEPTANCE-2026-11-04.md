# CloudPlay Windows offline acceptance — 2026-11-04

This is evidence for the **offline deployment system**, **not** a claim that cloud gaming has passed real Windows GPU testing.

## Verifiable CI results

| Gate | Result | Evidence |
| --- | --- | --- |
| Next.js production build + 113 Node tests | Passed | [CI run 41813650817](https://github.com/CavinHuang/cloudplay/actions/runs/41813650817) |
| Pinned Moonlight Web frontend + telemetry patch | Passed | [Upstream build 41808849737](https://github.com/CavinHuang/cloudplay/actions/runs/41808849737) |
| Windows Moonlight GNU native build | Passed | [Windows build 41813650824](https://github.com/CavinHuang/cloudplay/actions/runs/41813650824) |
| 2,286-file offline manifest and SHA-256 check | Passed | Same Windows build |
| Separate clean-Windows downloaded-artifact startup | Passed | Same Windows build, job `Clean Windows offline startup verification` |
| Actual Windows install, repeat install, test-version switch, rollback, pairing/token persistence, running-session refusal, and corrupt-slot rejection | Passed | [Windows installation run 41816633203](https://github.com/CavinHuang/cloudplay/actions/runs/41816633203) |
| Sunshine -> browser video/audio/input on real GPU | **Not yet tested** | Requires Windows GPU host and actual game |
| Publisher digital signature | **Not implemented** | SHA-256 detects corruption, not malicious replacement |

### Proven artifact

[Windows offline build 41813650824](https://github.com/CavinHuang/cloudplay/actions/runs/41813650824), **Artifacts** section, `CloudPlay-Windows-Offline-v0.12.0`.

- GitHub artifact ID: `13314134026`.
- Compressed archive size: `58,595,357` bytes.
- Artifact archive SHA-256 logged by Actions: `7bb39d21da58a07cd3a3663bca6ea3d67950a227714aa3097c5fd666c714c49e`.
- Built contents include `node.exe`, Next.js standalone server/dependencies, patched Moonlight native `web-server.exe`, frontend assets, corresponding Moonlight source/license, P0 coordinator/agent, installer and verification scripts.
- Artifacts are retained for 14 days, not permanent public release assets.

## Operator instructions (trusted Windows GPU host)

Unpack the downloaded **artifact**, not the source ZIP, to a standalone folder.

```powershell
# Run PowerShell in the extracted artifact folder (contains deploy/, runtime/, manifest.json)
.\deploy\smoke-windows-offline.ps1 -BundlePath .
.\deploy\install-cloudplay.ps1 -InstallRoot 'D:\CloudPlay'
& 'D:\CloudPlay\start-active.ps1' -EnableLocalLaunch -GamePath 'C:\Games\SuperTuxKart\supertuxkart.exe'
# Operator: http://127.0.0.1:7788/monitor
# Catalog: http://127.0.0.1:3000/
# Modified Moonlight Web: http://127.0.0.1:8080/
& 'D:\CloudPlay\stop-active.ps1'
```

For an upgrade, first stop all CloudPlay services. Extract the newer verified artifact outside the installation root and run its `deploy/install-cloudplay.ps1 -InstallRoot 'D:\CloudPlay'`. To undo a problematic upgrade, run the installer from a trusted release with `-Rollback` and then `start-active.ps1`.

The `D:\CloudPlay\state` directory survives release installation and rollback. The installer rejects switching versions while it detects a recorded running process.

## Limits and safety

1. Sunshine and compatible GPU drivers must be installed/configured on the host, and the user must legally install any game. They are **not embedded** in this build.
2. The first real Sunshine PIN pairing is interactive; the test did not validate a live stream, gamepad, real decoded frames or audible audio.
3. The current P0 operator is loopback only; public multi-user authentication, host scheduling, billing, permissions and production game-launch APIs are not ready.
4. Verification uses checksums from the bundle's own manifest; verify the **archive origin** using the GitHub Actions run and published digest before installation. A developer with a GPU host must complete the real media acceptance separately.
5. The pinned Moonlight Web implementation is GPL-3.0-or-later; the corresponding modified source and license are included in the release, including the CloudPlay bridge.

The full Windows release workflow now includes three sequential gates: **assemble & hash → clean-host process start → clean-host install/upgrade/rollback**. A future GitHub tag or manual dispatch builds a fresh release and runs all gates again.
