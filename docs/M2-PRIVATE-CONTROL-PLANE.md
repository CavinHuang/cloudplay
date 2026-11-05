# CloudPlay M2 · Private GPU admission control (reservation-only)

**Runnable Node.js control-plane prototype.** It handles per-host authentication, local P0 heartbeat ingestion, independent admin authentication, one reservation per host/owner, idempotency, lease timeout, crash-safe journaling and restart expiry. It runs **only on 127.0.0.1:7790** and never executes games, sends a Sunshine credential, opens remote stream access, or asserts GPU/video/audio/input has been proven. Existing public `POST /api/v1/sessions` remains disabled. All host readiness values are **self-reported claims**.

## Start from source (Node.js 22+, no npm install required for M2)

Set these private environment variables through your terminal's secure environment configuration:

- `CLOUDPLAY_M2_STATE_DIR`: absolute private writable directory **outside** any immutable release.
- `CLOUDPLAY_M2_ADMIN_TOKEN`: fresh random secret, at least 32 characters.
- `CLOUDPLAY_M2_HOST_TOKENS`: JSON mapping fixed host IDs to separately generated secrets of at least 32 characters; e.g. `{"win-local-host":"<independent-secret>"}`.
- `CLOUDPLAY_M2_HOST_ID` / `CLOUDPLAY_M2_HOST_TOKEN`: local bridge's host name and matching secret.
- `CLOUDPLAY_LAB_TOKEN`: secret from existing local P0 Coordinator, used only to read `http://127.0.0.1:7788/internal/status`.
- `CLOUDPLAY_M2_ALLOW_SUPERTUXKART_RESERVATION=1`: optional, explicitly permits **capacity reservations only** for the fixed open-source game ID; default is off. No commercial content license is implied.
- `CLOUDPLAY_M2_HOST_DRAIN=1`: optional, prevent new reservations.
- `CLOUDPLAY_M2_PORT`: optional local port (default 7790).

Start the service and optional bridge in separate trusted terminal sessions with the necessary credentials:

```bash
node scripts/m2/start-control.mjs
node scripts/m2/bridge-local-p0.mjs --watch
```

**Windows complete offline bundle:** use its internal Node and M2 entrypoints; no Node/npm/Rust download on the deployment host:

```powershell
$root='D:\CloudPlay'
$slot=Get-Content "$root\active.json" -Raw | ConvertFrom-Json
$release=Join-Path "$root\releases" $slot.active
$node=Join-Path $release 'runtime\node.exe'
& $node "$release\services\m2\scripts\m2\start-control.mjs"
# In a separate, securely configured environment:
& $node "$release\services\m2\scripts\m2\bridge-local-p0.mjs" --watch
```

Only start the P0 bridge **after** P0 is running normally. The bridge forwards only six boolean fields; if P0 is offline or reports more than one host, it sends a deliberately unready report. Host Agent identities, paths, GPU models, private network details and secrets never appear in the M2 heartbeat. The bridge does not launch games and a host claim does not attest to GPU availability.

## Private HTTP contract

All private routes require `Authorization: Bearer <token>`; writes additionally require `X-CloudPlay-M2-Action: 1` and `Content-Type: application/json`. The HTTP server rejects non-loopback peer addresses, unexpected Host, forwarded-proxy headers, browser Origin and excessive bodies. Admin and host credentials must be distinct.

| Endpoint | Authorization | Meaning |
|---|---|---|
| `GET /health` | None | Loopback process status only; stream and launch explicitly off |
| `POST /internal/m2/hosts/{hostId}/heartbeat` | Matching host secret | Boolean-only report `gpuDetected,sunshineReady,moonlightReady,gameAvailable,drain,gameProcessBusy` |
| `GET /internal/m2/status` | Admin secret | Private host freshness, reservation and occupancy |
| `POST /internal/m2/reservations` | Admin secret | `{"ownerId":"operator01","gameId":"supertuxkart","idempotencyKey":"request_0001"}` |
| `DELETE /internal/m2/reservations/{uuid}` | Admin secret | `{"ownerId":"operator01"}`; matching owner required |

An eligible host is one with a fresh (16-second) signed-by-its-key heartbeat declaring all prerequisites, no running game and no drain, with no existing reservation. These are not verified GPU proofs. Capacity is **one per host and one per owner**, never a fabricated multi-GPU number. Reservation TTL defaults to 120 seconds. Retries with the same owner/idempotency key return the same active reservation; after release or expiry, the same key cannot silently book another host. A corrupted journal blocks startup. On coordinator restart, all old reservations become `expired` and fresh host heartbeats are required. Only accepted reservations are written to a private atomic JSON journal; no secret is persisted.

## Hard safety and next milestone

This is an **M2 control-plane foundation**, not a deployable multi-user cloud game service. It has no customer accounts, independently verified entitlements, game instance isolation, billing, trusted remote host registration, cross-network media transport, or GPU attestation. Do **not** publish 7790, 7788, 8080, Sunshine admin, or the local Operator through Traefik/Dokploy/Nginx/tunnels. Do not grant internet access based on these credentials.

Physical GPU acceptance of Sunshine + Moonlight + SuperTuxKart with real changing frames, audible sound, controls and reconnect remains [Issue #3](https://github.com/CavinHuang/cloudplay/issues/3). Public /api/v1/sessions remains 503 until proper identity, rights, isolation and secure remote transport exist.

## Verification

```bash
node --test tests/m2-*.test.mjs
npm test
npm run build
```

CI validates real localhost HTTP requests, authentication, idempotency, exclusive reservations, persistence/restart, authorization rejection and P0 bridge failure modes. Green CI proves only software logic, **not** hardware streaming.
