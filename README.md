# CloudPlay

Browser-based PC cloud-gaming platform (work in progress).

## Current status

CloudPlay v0.12 has been developed locally with a Next.js game library, a guarded P0 coordinator/host agent, Sunshine + Moonlight Web integration tooling, media diagnostics, and Windows offline installer/rollback scripts.

**This GitHub repository has been initialized, but the complete v0.12 source tree has not yet been imported.** Do not treat a green repository page as a working deployment. The local source archive and Git bundle remain the authoritative development snapshot until the import is verified.

- Local automated tests: 112/112 passed in the development environment (not yet GitHub CI).
- Next.js production build: not yet verified.
- Moonlight Web patched native build: not yet verified.
- Windows GPU video/audio/input end-to-end: not yet verified.

## Security and licensing

This repository is **public**. Do not commit local tokens, .env files, Sunshine pairing information, session journals, Windows installers without redistribution review, or commercial-game cover images from the design mockups.

Only games and assets with the appropriate streaming/redistribution rights can be offered to players. Keep P0 local game-launch endpoints bound to trusted local interfaces until a production authentication and isolation layer exists.

## Target architecture

- **Web:** Next.js / React — library, game details, preflight, player and admin.
- **Control:** local coordinator and Windows host agent — single-session scheduling and lifecycle.
- **Media:** Sunshine on the Windows host, modified Moonlight Web Stream in the browser.
- **Distribution:** build-time bundling, signed/checksummed offline artifacts, external persistent state and rollback slots.

## Milestones

1. Import and verify the complete sanitized source tree and all required CI workflows.
2. Run real Next.js and Moonlight Web production builds on GitHub Actions.
3. Validate one genuine SuperTuxKart game session on Windows GPU: video, audio, input, stop and cleanup.
4. Verify clean Windows offline installation, upgrade and rollback.

The upstream Moonlight Web project is GPL-3.0-or-later; modified versions must meet its license obligations and include corresponding source.
