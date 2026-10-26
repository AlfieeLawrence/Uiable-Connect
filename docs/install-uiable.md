---
title: Install or update Uiable on a server
description: Detect Uiable, choose port and bind, optional first account, and run the installer over SSH.
order: 40
slug: install-uiable
---

# Install or update Uiable on a server

[Uiable](https://github.com/AlfieeLawrence/uiable) is the self-hosted dashboard that runs *on* the Linux server. Connect can install or update it for you over SSH.

## Detect

On a connected SSH server, Connect probes for Uiable (including via `/api/state` on candidate ports). The overview shows whether the dashboard is reachable and on which port. Actions offer **Install**, **Update to …**, or **Up to date**.

## Install configuration

Before a fresh install you can choose:

| Setting | Options | Notes |
| --- | --- | --- |
| **Port** | 1–65535 (default `8080`) | Where Uiable listens on the server |
| **Bind address** | `127.0.0.1` (localhost only) or `0.0.0.0` (all interfaces) | Localhost-only is safest when you only reach Uiable through Connect’s SSH tunnel |
| **First account username / password** | Optional | Creates the admin during install if setup is still needed. Leave blank to set the account on first open in the browser |

Updates keep existing port/bind from `/opt/uiable/.env` when present so day-to-day settings do not drift unexpectedly.

## What the job does

After you confirm, Connect runs a **detached job on the server** and streams the log live.

- Needs **root** (or sudo). Saved sudo password is used when required; otherwise you are prompted. The password goes to sudo on stdin and is **never logged**.  
- If **Docker** is missing, Connect installs it first (get.docker.com on Debian/Ubuntu/Raspbian/Fedora/CentOS/RHEL; apk on Alpine; pacman on Arch), starts the service, and adds your user to the `docker` group. Other distros stop with a message. An **existing** Docker install is never rewritten.  
- If Docker exists but **Compose** is missing, Connect stops and asks you to install the compose plugin — it will not mutate an existing Docker setup.  
- Updates preserve accounts and the `uiable-data` volume; a backup of `/opt/uiable` is written to `/opt/uiable.backup-<date>.tar.gz` first.

When Uiable listens on localhost only, open it with **Open Uiable dashboard** so the SSH tunnel reaches `127.0.0.1` on the server.

## Related

[Port forwards](port-forwards.md) · [Connections](connections.md) · [Uiable on GitHub](https://github.com/AlfieeLawrence/uiable)
