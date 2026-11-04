# CloudPlay third-party distribution notice

- **Moonlight Web Stream**: `MrCreativ3001/moonlight-web-stream`, pinned to upstream commit `7b9821430e07087f459db3db9aac550e1e9c9bff`, GPL-3.0-or-later. Any redistributed modified build must ship the complete corresponding source, modification details and license. The offline packer enforces a source snapshot and license alongside the compiled Windows client.
- **Sunshine**: LizardByte/Sunshine is an external host application. Only include a genuine official installer after confirming redistribution rights and copying its relevant notices and source-offer obligations. CloudPlay does not bypass pairing or change Sunshine's licenses.
- **Node.js**: Windows runtime node.exe requires the accompanying Node license and license notices; the packer requires `--node-license`.
- **SuperTuxKart**: optional game payload. Code and artwork/sound may have different licenses; do not assume one LICENSE covers all assets. Users must check license and source obligations before redistribution.
- **Next.js, React and transitive packages**: when distributing the standalone web build, provide its installed third-party notices/attributions from the package lock or SBOM (build operator responsibility; release not approved until completed).

Do not distribute cracked games, unlicensed game art, or vendor secrets. Official source snapshots may be bundled **during release preparation**, so deployed machines need no network retrieval. The source-only CloudPlay archive is not a ready-to-run offline release.
