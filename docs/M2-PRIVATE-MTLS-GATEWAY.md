# CloudPlay M2 — Private mutual-TLS host gateway

## Scope and security boundary

This is an **opt-in, mutually authenticated, outbound host-control connection** over a trusted private IPv4 network/VPN. The coordinator still listens **only on 127.0.0.1:7790**. The additional gateway can bind **only to an explicitly provided RFC1918 or loopback IPv4 address**, never `0.0.0.0`, public IPv4, hostname or IPv6. Restrict its TCP port with a host firewall/VPN ACL to known host addresses. There is no Internet listener, public user session API, browser proxy, Sunshine password, game process command, or media streaming in this gateway.

The gateway authenticates **two independent credentials on each request**: (1) a client certificate signed by your pinned host CA, whose certificate subject CN must match the requested `hostId`; (2) that same M2 host's privately enrolled Bearer token, independently verified by the loopback coordinator. TLS 1.3 and the server's IP Subject Alternative Name are verified. Only these four host-process POST routes are accepted:
- `/internal/m2/hosts/{hostId}/connect`
- `/internal/m2/hosts/{hostId}/heartbeat`
- `/internal/m2/hosts/{hostId}/sync`
- `/internal/m2/hosts/{hostId}/ack`

A host **cannot** use this gateway to reach admin/owner endpoints, change reservation policy, run a game or receive a game stream. The P0 Agent and `CLOUDPLAY_LAB_TOKEN` stay exclusively on the GPU machine. The gateway forwards only bounded JSON and the minimal authenticated host headers to the coordinator's loopback address; all browser Origin, forwarded/proxy headers, query strings and unknown paths are rejected. There is no redirect fallback.

## Certificate provisioning (operator, off the gaming hosts)

The runtime depends only on the **bundled Node executable** and operator-provided PEM files. Certificate issuance may use OpenSSL on a separate trusted admin machine; it is **not** downloaded or required by the deployed Windows bundle. Use a separately protected CA and individual certificates with a client-auth Extended Key Usage for each host. Example issuance outline (replace IDs/IPs with real private values):

```bash
# Offline admin computer only. Keep CA private key offline.
openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 365 \
  -subj '/CN=CloudPlay Private Host CA' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -keyout ca.key -out ca.crt

# Server private IPv4 address, with matching IP SAN.
openssl req -newkey rsa:3072 -nodes -sha256 \
  -subj '/CN=10.0.0.5' -keyout gateway.key -out gateway.csr
printf 'subjectAltName=IP:10.0.0.5\nextendedKeyUsage=serverAuth\n' > gateway.ext
openssl x509 -req -in gateway.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -days 365 -sha256 -extfile gateway.ext -out gateway.crt

# Each GPU host gets a distinct key and cert with CN EXACTLY equal to
# the host ID enrolled through POST /internal/m2/hosts (example: gpuHost01).
openssl req -newkey rsa:3072 -nodes -sha256 \
  -subj '/CN=gpuHost01' -keyout gpuHost01.key -out gpuHost01.csr
printf 'extendedKeyUsage=clientAuth\n' > host.ext
openssl x509 -req -in gpuHost01.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -days 365 -sha256 -extfile host.ext -out gpuHost01.crt
```

Protect `ca.key` and all private keys with secure filesystem access/secret provisioning; do not commit them, put them in the public web root, embed them in the release, or print them in diagnostics. Prefer encrypted keys unlocked by an external secret manager where supported by your runtime. A host cert identifies **one** host ID only. Use a new certificate and Bearer token for each host; rotate both on suspected compromise. The Bearer token remains a separate control from the mTLS client certificate. Keep CA trust and host certificate issuance restricted to authorized operators.

## Coordinator-side startup

First start M2 on coordinator (as already documented) with a private state directory and admin credential. **Then**, only when a private network/VPN and firewall ACL are ready, explicitly start the gateway from the same self-contained release. On Windows PowerShell, set:

```powershell
$env:CLOUDPLAY_M2_TLS_GATEWAY_ENABLE = '1'
$env:CLOUDPLAY_M2_TLS_BIND = '10.0.0.5' # Actual IP of the PRIVATE management interface
$env:CLOUDPLAY_M2_TLS_PORT = '7791'
$env:CLOUDPLAY_M2_PORT = '7790' # LOCAL M2 coordinator
$env:CLOUDPLAY_M2_TLS_SERVER_CERT = 'D:\CloudPlay-Secrets\gateway.crt'
$env:CLOUDPLAY_M2_TLS_SERVER_KEY = 'D:\CloudPlay-Secrets\gateway.key'
$env:CLOUDPLAY_M2_TLS_CLIENT_CA = 'D:\CloudPlay-Secrets\ca.crt'
& $node "$release\services\m2\scripts\m2\start-tls-gateway.mjs"
```

The gateway fails to start if the opt-in flag, private bind address or certificate files are absent/invalid. It does **not** change the existing M2 localhost coordinator or existing M1 launch scripts. The gateway uses TLS v1.3 only and does not accept plaintext HTTP. The server certificate must contain an IP SAN matching `CLOUDPLAY_M2_TLS_BIND` (and host-side URL).

## Remote GPU-host startup

On the actual GPU host, keep the local P0 Coordinator/Agent on its own 127.0.0.1 ports, and run the bundled M2 Host Bridge. Configure the existing `CLOUDPLAY_M2_HOST_ID`, `CLOUDPLAY_M2_HOST_TOKEN` (issued once by M2 admin enrollment), and `CLOUDPLAY_LAB_TOKEN` locally. Add these **all-or-nothing** variables:

```powershell
$env:CLOUDPLAY_M2_GATEWAY_URL = 'https://10.0.0.5:7791/'
$env:CLOUDPLAY_M2_GATEWAY_CA = 'D:\CloudPlay-Secrets\ca.crt'
$env:CLOUDPLAY_M2_CLIENT_CERT = 'D:\CloudPlay-Secrets\gpuHost01.crt'
$env:CLOUDPLAY_M2_CLIENT_KEY = 'D:\CloudPlay-Secrets\gpuHost01.key'
& $node "$release\services\m2\scripts\m2\bridge-local-p0.mjs" --watch
```

The Host Bridge continues reading local P0 status; it sends only six approved readiness flags plus fenced connection/sequence IDs, and pulls observation-only reservation metadata using the mTLS channel. TLS server verification is mandatory and pinned to the explicit CA; the client refuses an untrusted server, a public/wildcard URL, HTTP URL, credentials in the URL, unexpected route or redirect. No owner/admin route is allowed across this client. The gateway doesn't accept an invalid host certificate or a certificate whose CN is another host's ID.

**No TLS keys, CA private keys, admin credentials or test certificates are bundled.** Use independently provisioned private secrets. The automated tests generate short-lived throwaway certificates with OpenSSL when available; these are never suitable for real deployments.

## Acceptance and limitations

```bash
node --test tests/m2-tls-gateway.test.mjs
npm test
npm run build
```

Windows offline CI checks the packaged gateway and client modules and verifies that the gateway does **not** autostart without opt-in. On test runners with OpenSSL, the Node suite starts the **real** loopback M2 server, a real TLS 1.3 mutual-auth gateway and a Host Bridge using pinned CA/client certs. It exercises reservation sync and rejects wrong client identity, missing cert, untrusted CA, host ID mismatch, admin paths and untrusted headers.

This does not establish that a physical remote GPU is available or streaming. Tests execute on local TCP interfaces, not on actual deployed VPN hosts. A true multi-machine acceptance requires two separate machines, a private/VPN link, protected provisioning, host firewall verification, bearer/cert rotation and separate physical video/audio/input/gameplay evidence. The public `POST /api/v1/sessions` remains disabled.
