# CloudPlay v0.11.0 release and deployment status (2026-11-04)

## What is committed to the unified source project

- Next.js P1 source, game library and V2-style pages; existing safety gate prevents public P0 game launch.
- Local P0 Coordinator/Agent, Windows game process lifecycle, Moonlight Web telemetry patch at fixed upstream SHA.
- `scripts/release/pack-offline.mjs` packs an **already-built** native Moonlight Web, patched full corresponding source, Node runtime, and Next.js standalone into one portable Windows release directory; fails closed on missing artifacts.
- `scripts/release/verify-offline.mjs` verifies all packaged files using SHA-256 and rejects unexpected files.
- Windows release launch/stop commands and optional bundled Sunshine installer / audited game payload (never auto-install or bypass legal licenses).
- Offline Docker web image export/import workflow using `docker save`/`docker load` + `pull_policy: never`.
- Manual GitHub Actions Windows bundle builder; not yet run because no dedicated writable CloudPlay GitHub repository has been provided.

## Validation matrix

| Item | Status |
| --- | --- |
| Existing 90 automated P0/P1 tests | Passed on restored v0.10 baseline |
| Offline bundling and tamper rejection tests | Passed in container |
| JS/JSX/TS source parser | Passed (syntax only) |
| Windows PowerShell startup script execution | NOT TESTED on Windows |
| CloudPlay Next.js npm install/build | BLOCKED: network DNS / Next.js dependencies not available in current runner |
| Patched Moonlight Rust native Windows build | NOT TESTED (requires Windows, Rust GNU, Node 26.4 and npm 11.17) |
| Complete Windows all-in-one binary release | NOT GENERATED in current runner; source project contains build/pack scripts only |
| Actual Sunshine GPU game video/audio/input | NOT TESTED on user's Windows host |
| Online-public multi-tenant cloud game deployment | NOT READY, out of P0 scope |

## What is needed once on an online build runner

1. `npm install`, `npm run build` for P1 standalone output.
2. Fetch audited Moonlight upstream pinned commit *on the builder only*, inject the patch, compile Rust/TypeScript output.
3. Supply licensed Windows Node runtime and corresponding Node/Moonlight source and legal notices.
4. Run `scripts/release/build-windows-offline.ps1` or `pack-offline.mjs`; then run the offline verifier.
5. Copy the complete release directory to Windows GPU host **without Git, npm, or cargo downloads on that host**.
6. First-time Sunshine installation, PIN pairing and real game input/video/audio verification remain genuine host-specific prerequisites.

No hosted service has been deployed, no GitHub PR/push has occurred, and no real video-frame evidence is claimed.
