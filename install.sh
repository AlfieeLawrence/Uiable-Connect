#!/bin/sh
# Uiable Connect — one-line Docker install.
#   curl -fsSL https://raw.githubusercontent.com/AlfieeLawrence/uiable-connect/main/install.sh | sh
# Tries host networking first (forwards get ANY PC port). If the daemon doesn't allow it
# (Docker Desktop without "Enable host networking"), installs with the 8000-8099 port pool.
set -e
IMG=ghcr.io/alfieelawrence/uiable-connect:latest
docker pull "$IMG"
docker rm -f uiable-connect >/dev/null 2>&1 || true
if docker run -d --name uiable-connect --restart unless-stopped --network host \
    -e UC_HOST_NET=1 -e UC_FWD_BIND=127.0.0.1 \
    -v uiable-connect-data:/data "$IMG" 2>/dev/null; then
  echo "Installed (host networking) — open http://localhost:8484 · forwards can use any PC port"
else
  docker run -d --name uiable-connect --restart unless-stopped \
    -p 127.0.0.1:8484:8484 -p "127.0.0.1:8000-8099:8000-8099" \
    -v uiable-connect-data:/data "$IMG"
  echo "Installed (port pool) — open http://localhost:8484 · forwards can use PC ports 8000-8099"
  echo "Tip: enable Docker Desktop 'host networking' (or use docker-compose.hostnet.yml) for any port."
fi
