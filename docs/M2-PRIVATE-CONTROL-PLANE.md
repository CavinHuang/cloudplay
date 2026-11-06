# CloudPlay M2 · Private GPU admission control (reservation-only)

**Runnable Node.js control-plane prototype.** It handles per-host authentication, local P0 heartbeat ingestion, independent admin authentication, one reservation per host/owner, idempotency, lease timeout, crash-safe journaling and restart expiry. It runs **only on 127.0.0.1:7790** and never executes games, sends a Sunshine credential, opens remote stream access, or asserts GPU/video/audio/input has been proven. Existing public `POST /api/v1/sessions` remains disabled. All host readiness values are **self-reported claims**.

## Optional encrypted private cross-machine host transport

M2 now supports a **separate, explicit opt-in mutual-TLS host gateway** for private LAN/VPN use, while its underlying admission coordinator remains restricted to `127.0.0.1`. The gateway accepts only the four authenticated host-process endpoints and demands a CA-signed client certificate whose CN matches the host ID **plus** that host's independent Bearer token. It does not expose the admin, owner, public session, Sunshine or game-streaming endpoints. TLS 1.3 with a validated server IP SAN and separately pinned CA is mandatory. The Host Bridge may select the gateway with explicit `CLOUDPLAY_M2_GATEWAY_URL` and certificate paths; its P0 status request still stays local.

See [the complete private mTLS gateway setup, certificate issuance and firewall runbook](M2-PRIVATE-MTLS-GATEWAY.md). This is not a public cloud-gaming product or verified multi-machine GPU streaming; physical remote-host integration is still an independent acceptance milestone.

## Start from source (Node.js 22+, no npm install required for M2)

Set these private environment variables through your terminal's secure environment configuration:

- `CLOUDPLAY_M2_STATE_DIR`: absolute private writable directory **outside** any immutable release.
- `CLOUDPLAY_M2_ADMIN_TOKEN`: fresh random secret, at least 32 characters.
- `CLOUDPLAY_M2_HOST_TOKENS`: **optional legacy** static JSON host-key map, e.g. `{"win-local-host":"<independent-secret>"}`. New installations can omit it and enroll hosts through the authenticated admin API; legacy static IDs cannot be rotated or revoked through that API (remove them from environment configuration and restart instead).
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
| `POST /internal/m2/hosts/{hostId}/connect` | Matching host secret | Start a new ephemeral host-process generation; body `{\"protocol\":\"cloudplay.m2.host-connection.v1\"}` |
| `POST /internal/m2/hosts/{hostId}/heartbeat` | Matching host secret | Registered hosts: six booleans plus the active `connectionId` and strictly increasing integer `sequence`; legacy env hosts may still report only six booleans until opting in |
| `POST /internal/m2/hosts/{hostId}/sync` | Matching host secret | Current-process pull of only the host's active reservation metadata (or idle state) |
| `POST /internal/m2/hosts/{hostId}/ack` | Matching host secret | Confirm observation of that exact reservation ID and expiry, without starting anything |
| `GET /internal/m2/status` | Admin secret | Private host freshness, reservation and occupancy |
| `POST /internal/m2/reservations` | Admin secret | `{"ownerId":"operator01","gameId":"supertuxkart","idempotencyKey":"request_0001"}` |
| `DELETE /internal/m2/reservations/{uuid}` | Admin secret | `{"ownerId":"operator01"}`; matching owner required |

An eligible host is one with a fresh (16-second) signed-by-its-key heartbeat declaring all prerequisites, no running game and no drain, with no existing reservation. These are not verified GPU proofs. Capacity is **one per host and one per owner**, never a fabricated multi-GPU number. Reservation TTL defaults to 120 seconds, with fenced refresh in the final half and a hard 10-minute lifetime. Retries with the same owner/idempotency key return the same active reservation; after release or expiry, the same key cannot silently book another host. A corrupted journal blocks startup. On coordinator restart, all old reservations become `expired` and fresh host heartbeats are required. Only accepted reservations are written to a private atomic JSON journal; no secret is persisted.

## M2 registered host credentials and owner-bound private reservations

The private operator can now enroll new hosts and reservation owners using the **admin** Bearer token, without restarting the M2 process or editing the legacy host-token JSON. All endpoints below are loopback-only and every mutation requires `X-CloudPlay-M2-Action: 1`; registration requires JSON containing exactly the ID field.

| Endpoint | Who may call | Description |
|---|---|---|
| `POST /internal/m2/hosts` | Admin | `{"hostId":"gpuHost01"}` registers one private host |
| `POST /internal/m2/owners` | Admin | `{"ownerId":"operator01"}` registers one private owner |
| `POST /internal/m2/hosts/{id}/rotate` | Admin | Rotate host token; invalidate its heartbeat and active reservations |
| `POST /internal/m2/owners/{id}/rotate` | Admin | Rotate owner token and expire owned reservations |
| `DELETE /internal/m2/hosts/{id}` or `/owners/{id}` | Admin | Revoke a registered credential and expire matching reservations |
| `GET /internal/m2/identities` | Admin | List host/owner IDs and creation timestamps, never secrets |
| `GET /internal/m2/owners/{id}/reservations` | Matching owner token or admin | Only that owner's reservation metadata |
| `POST /internal/m2/reservations` | Matching owner token or admin | Exclusive host capacity reservation with matching `ownerId` |
| `POST /internal/m2/reservations/{uuid}/renew` | Matching owner token or admin | `{"ownerId":"operator01","expectedExpiresAt":<current UNIX timestamp in milliseconds>}`; compare-and-swap lease extension |
| `DELETE /internal/m2/reservations/{uuid}` | Matching owner token or admin | Release with matching `ownerId` |

**Example (PowerShell, trusted operator machine only):** With the M2 service already running, set `$admin` securely to `CLOUDPLAY_M2_ADMIN_TOKEN`, then enroll identities:

```powershell
$base = 'http://127.0.0.1:7790'
$headers = @{ Authorization = "Bearer $admin"; 'X-CloudPlay-M2-Action' = '1' }
$hostKey = Invoke-RestMethod -Uri "$base/internal/m2/hosts" -Method Post -Headers $headers -ContentType 'application/json' -Body '{"hostId":"gpuHost01"}'
$ownerKey = Invoke-RestMethod -Uri "$base/internal/m2/owners" -Method Post -Headers $headers -ContentType 'application/json' -Body '{"ownerId":"operator01"}'
# Place $hostKey.token and $ownerKey.token in private secret configuration
# (for the P0 bridge use CLOUDPLAY_M2_HOST_ID and CLOUDPLAY_M2_HOST_TOKEN).
# Do not echo or paste these values into logs or public issues.
```

Each `token` is a new random 256-bit secret, returned **once** on enrollment/rotation. Only its SHA-256 digest is stored in the separately persisted `m2-identities.json` under `CLOUDPLAY_M2_STATE_DIR` (outside the immutable release; restrictive file permissions). The admin credential and plaintext host/owner secrets are not written to this journal. Corruption or unsafe symlinks fail closed at startup. Keep both `m2-journal.json` and `m2-identities.json` private and protected by filesystem ACLs.

Registered host keys can send only their own host heartbeat. Registered owner keys can reserve/release/read **only their own** capacity; they cannot read global status, manage hosts or act as another owner. The admin key remains an explicit, trusted operator override. A rotated or revoked key immediately loses authorization; associated reservations expire and host capacity requires a fresh authenticated heartbeat. On restart, prior reservations expire regardless of whether identities persist. **Enrollment here is private operator registration, NOT internet-facing host authentication or public customer signup.**

## Fenced host-process connections and anti-replay heartbeats

Registered M2 host keys now identify a host, but **a process must also establish its current connection generation** before its heartbeat can make that host eligible. The local `scripts/m2/bridge-local-p0.mjs --watch` manages this automatically; operators do not need to paste connection IDs or manually increment counters. The controller still accepts only loopback HTTP and never contacts any remote host itself.

1. The Host Bridge sends an authenticated `POST /internal/m2/hosts/{id}/connect` with JSON `{"protocol":"cloudplay.m2.host-connection.v1"}`. The response contains a fresh unpredictable UUID `connectionId` and `nextSequence: 1`.
2. The bridge transmits only the six allowlisted boolean readiness flags, the current `connectionId`, and an integer `sequence` starting at 1 and strictly increasing for each accepted heartbeat. Raw GPU model, file paths, hostnames, private network data and P0 secrets are not forwarded.
3. Duplicate or lower sequence numbers return `HOST_HEARTBEAT_REPLAYED` (409); an older process generation returns `HOST_CONNECTION_FENCED` (409); a registered host without an active generation returns `HOST_CONNECTION_REQUIRED` (409). Malformed or extra fields are rejected.
4. A newly connected process replaces any older generation **only after** the control plane can durably expire previous reservations with `HOST_CONNECTION_REPLACED`; it also clears the old host readiness. The new process must produce a valid fresh heartbeat before anyone can reserve capacity.
5. The old bridge treats a fenced/replayed generation as terminal and must be **explicitly restarted**, rather than automatically reconnecting and fighting the new process for host ownership. A control-plane restart also discards every in-memory connection and every old host claim, so any surviving bridge must restart to establish a new generation.

**Compatibility:** Existing hosts provisioned solely by `CLOUDPLAY_M2_HOST_TOKENS` may still post the original six-boolean heartbeat until they explicitly start using `/connect`; once a connection generation is active, old-format heartbeats are rejected for that process lifetime. **Newly enrolled hosts require the connection step**. Host tokens remain operator-managed local credentials, and a valid *stolen* host token could register a newer process generation. This protocol prevents stale instances and accidental replay, **not** bearer credential theft, network interception, secure remote transport, or fraudulent GPU self-reports. Do not expose these routes on a public listener or reverse proxy.

## Host-initiated reservation synchronization (observation-only)

The private Host Bridge now performs a pull **after** each authenticated heartbeat. The controller does not push commands to hosts and does not create network sockets outside the existing localhost control plane. This is the application-level protocol to be carried by a separately authenticated and encrypted private transport in a future stage; **it is not yet a cross-machine deployment**.

| Endpoint | Host body and authorization | Result |
|---|---|---|
| `POST /internal/m2/hosts/{hostId}/sync` | Matching host Bearer token, `{"connectionId":"<current-UUID>","sequence":1}` | `CAPACITY_IDLE` or `OBSERVE_RESERVATION`; only `reservationId`, fixed `gameId` and `expiresAt` |
| `POST /internal/m2/hosts/{hostId}/ack` | Matching host token, `{"connectionId":"<current-UUID>","sequence":2,"reservationId":"<current-UUID>","expiresAt":<current-ms>}` | `202` acknowledging **receipt of metadata only**, never gameplay readiness or launch permission |

The sync cursor is independent of the readiness heartbeat cursor but strictly increases across both pull and ack requests. A duplicate or earlier sequence is rejected as `HOST_SYNC_REPLAYED`; using the old connection generation is rejected as `HOST_CONNECTION_FENCED`. A confirmation for a different host's reservation, a finalized ticket, or an outdated expiry is rejected as `HOST_ASSIGNMENT_STALE`. The host cannot see reservation owners, other hosts' assignments, credentials, paths, network endpoints or executable instructions. The response always explicitly carries `gameLaunchEnabled:false` and `streamVerified:false`.

Host acknowledgments are **ephemeral observations**, not a second source of authority: the existing private reservation journal remains definitive. A lease extension changes its `expiresAt`, so the host must observe and acknowledge the new snapshot; release/expiry changes the next response to `CAPACITY_IDLE`. A new host process generation clears previous observations and invalidates any former reservation, and a controller restart discards all observations and requires a fresh connection. The bridge automatically handles this while running with `--watch`, without executing any command.

This is **not** remote command execution, Sunshine pairing, remote network transport, an allocation guarantee, or proof of video/audio/input. Never expose the loopback API via an HTTP proxy or tunnel; future private cross-machine connectivity requires an independently validated secure channel and host credentials.

## Fenced reservation lifecycle (no game process launched)

Each reservation is initially a **120-second capacity lease**, not a game session. A registered owner (or trusted local administrator) can extend it through `POST /internal/m2/reservations/{uuid}/renew` with the exact `expiresAt` from the latest reservation result and the matching `ownerId`. A successful renewal returns the new `expiresAt`; the previous timestamp can **never** be replayed to renew the same lease again. The mutation requires `X-CloudPlay-M2-Action: 1` and a valid bearer credential, like all other state-changing operations.

Renewal is rejected when the reservation has expired/released/revoked, the host heartbeat is over 16 seconds old, the reported host is draining/busy or no longer meets local readiness, the request is too early (more than halfway before expiry), or the lease has reached its **10-minute maximum lifetime measured from initial creation**. Stale `expectedExpiresAt` returns `LEASE_FENCE_CONFLICT` (409); missing/unready host returns `HOST_NOT_READY_FOR_RENEWAL` (409). Journal write errors return 503 and preserve the previous lease timestamp. After expiry the same idempotency key remains finalized; a fresh request must use a new key and a newly eligible host heartbeat.

Example using a previously returned `$reservation` and privately configured `$ownerToken`:

```powershell
$headers = @{ Authorization = "Bearer $ownerToken"; 'X-CloudPlay-M2-Action' = '1' }
$renewBody = @{ ownerId = $reservation.ownerId; expectedExpiresAt = $reservation.expiresAt } | ConvertTo-Json
$renewed = Invoke-RestMethod -Uri "http://127.0.0.1:7790/internal/m2/reservations/$($reservation.id)/renew" -Method Post -Headers $headers -ContentType 'application/json' -Body $renewBody
$reservation = $renewed.reservation
```

Do not renew leases on a timer without checking real host readiness; the control plane checks the **self-reported** boolean heartbeat, not independent proof of GPU or streaming. A lease does not authorize launching a process, connecting Sunshine or opening an external listener.

## Hard safety and next milestone

This is an **M2 control-plane foundation**, not a deployable multi-user cloud game service. It has no customer accounts, independently verified entitlements, game instance isolation, billing, trusted remote host registration, cross-network media transport, or GPU attestation. Do **not** publish 7790, 7788, 8080, Sunshine admin, or the local Operator through Traefik/Dokploy/Nginx/tunnels. Do not grant internet access based on these credentials.

Physical GPU acceptance of Sunshine + Moonlight + SuperTuxKart with real changing frames, audible sound, controls and reconnect remains [Issue #3](https://github.com/CavinHuang/cloudplay/issues/3). Public /api/v1/sessions remains 503 until proper identity, rights, isolation and secure remote transport exist.

## Verification

```bash
node --test tests/m2-*.test.mjs
npm test
npm run build
```

CI validates real localhost HTTP requests, authentication, idempotency, exclusive reservations, persistence/restart, authorization rejection and P0 bridge failure modes. Windows **offline startup smoke** also invokes `deploy/smoke-m2-offline.mjs` with the **bundled `runtime/node.exe`** and zero global Node/npm/Rust dependencies. That smoke launches the real M2 process, checks local Host/Origin/proxy and token rejection, verifies no-GPU reservation refusal, uses explicitly synthetic boolean host claims to test exclusive capacity, then restarts against its private journal to ensure the old reservation expires and host claims are discarded. Synthetic host claims are never a physical GPU attestation and do not start games. The P0 bridge now establishes an ephemeral host connection and sends monotonically sequenced readiness reports, refusing to reclaim a fenced generation. A live P0 bridge also refuses new M2 capacity reservations if Host Agent still reports an owned running game during Coordinator recovery, even if the session list is empty. Green CI proves only software logic, **not** hardware streaming.
