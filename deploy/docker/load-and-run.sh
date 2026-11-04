#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'Docker Engine is required on the target host' >&2; exit 1; }
command -v sha256sum >/dev/null || { echo 'sha256sum required for offline integrity verification' >&2; exit 1; }
sha256sum -c SHA256SUMS
docker load -i images/cloudplay-web.tar
docker compose -f deploy/docker-compose.yaml up -d --pull never
echo 'CloudPlay web catalog is available locally on 127.0.0.1:3000; no P0 GPU service is exposed.'
