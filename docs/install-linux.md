---
title: Install on Linux (Docker and from source)
description: Run the official Docker image or start Connect from source on Linux.
order: 12
slug: install-linux
---

# Install on Linux (Docker and from source)

There is no separate packaged `.deb` / AppImage in the current release pipeline. On Linux you typically run the **Docker (web) version** in a browser, or **`npm start`** from source on a machine with a desktop.

## One-line Docker installer (recommended)

```sh
curl -fsSL https://raw.githubusercontent.com/AlfieeLawrence/uiable-connect/main/install.sh | sh
```

The script prefers **host networking** so forwards can use any PC port. If the daemon refuses host networking, it falls back to a **published port pool** (commonly 8000–8099). Open:

**http://localhost:8484**

## Docker Compose

```sh
curl -O https://raw.githubusercontent.com/AlfieeLawrence/uiable-connect/main/docker-compose.yml
docker compose up -d
```

Or plain Docker (amd64 + arm64 images):

```sh
docker run -d \
  -p 127.0.0.1:8484:8484 \
  -p 127.0.0.1:8080-8090:8080-8090 \
  -v uc-data:/data \
  ghcr.io/alfieelawrence/uiable-connect:latest
```

Pull updates with:

```sh
docker compose pull && docker compose up -d
```

### Important Docker settings

- **Data** lives in the `/data` volume. Secrets use `/data/secret.key` unless you set `UC_SECRET`.
- Set **`UC_PASSWORD`** if anything other than localhost can reach the UI. Without a password, prefer binding to `127.0.0.1` only.
- Hostnames other than localhost are refused (DNS-rebinding protection) unless `UC_PASSWORD` is set or the host is listed in `UC_ALLOWED_HOSTS`.
- **Forwards:** without host networking, each PC port must be published on the container. Extend mappings and set `UC_FWD_PORTS` (for example `8000-8099,9000-9010`) so the Forwards tab knows the pool. See also `docker-compose.hostnet.yml` for host-network mode.
- Encrypted backup and related crypto need a **secure context**: `http://localhost` / `127.0.0.1` or HTTPS — not plain `http://LAN-IP`.

## Run from source (desktop Electron)

```sh
git clone https://github.com/AlfieeLawrence/Uiable-Connect.git
cd Uiable-Connect
npm install
npm start
```

Requires Node.js 20+. This is the full desktop shell (including serial ports), not the browser container.

## Next

[Connections](connections.md) · [Port forwards](port-forwards.md) · [Troubleshooting](troubleshooting.md)
