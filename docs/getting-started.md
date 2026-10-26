---
title: Getting started
description: What Uiable Connect does, which platform to use, and your first connection.
order: 1
slug: getting-started
---

# Getting started

Uiable Connect talks to your Linux (and similar) servers over SSH. You do **not** need [Uiable](https://github.com/AlfieeLawrence/uiable) installed on the server for terminals, files, forwards, health, or alerts. If Uiable *is* running, Connect can detect it and open the dashboard through an SSH tunnel.

## Choose how to run it

| Platform | Best for | Notes |
| --- | --- | --- |
| [Windows](install-windows.md) | Everyday desktop use | Portable zip, Setup installer, or run from source |
| [macOS](install-macos.md) | Mac desktop | `.dmg` / `.zip` (Intel + Apple Silicon); Gatekeeper steps required |
| [Linux / Docker](install-linux.md) | Browser UI on a PC or NAS | Official image on GHCR; also `npm start` from source |
| [Android](install-android.md) | Phones and tablets | Sideload the debug APK from Releases |
| [iPhone / iPad](install-ios.md) | iOS 17+ | Unsigned IPA — sideload (not on the App Store yet) |

Releases ship from GitHub Actions on each version tag: [Releases](https://github.com/AlfieeLawrence/Uiable-Connect/releases).

## First connection (quick path)

1. Install Connect for your platform and open the app.
2. Click **+ Add connection**.
3. Fill in **name**, **host**, **port** (usually `22`), and **username**.
4. Choose auth: **password**, **SSH key** (paste or pick a file, optional passphrase), or **Key + password** (key first, password as fallback).
5. Optionally save a **sudo password** for installs and admin commands on that server.
6. Tap **Test**, then save.
7. Open the server — you get tabs such as Home (overview), Terminal, Files, Ports, Health, Alerts, and History (SSH). Telnet/serial connections focus on the terminal.

On desktop you can also use **Find on my network** while adding a connection, or **Import ~/.ssh/config** on the desktop app.

Secrets are stored encrypted: Windows DPAPI / Electron safeStorage on desktop, Keystore / Keychain on mobile, and a volume key (or `UC_SECRET`) in Docker.

## What you can do next

- Open several **terminal** tabs, attach to **tmux**, or jump into a running **Docker** container shell — see [Terminal](terminal.md) and [Docker](docker.md).
- Browse and edit files over **SFTP** — [Files](files-sftp.md).
- Forward ports (including the built-in Uiable dashboard forward) — [Port forwards](port-forwards.md).
- Install or update Uiable on the server from Connect — [Install Uiable](install-uiable.md).
- Export an encrypted **.ucbackup** before you switch devices — [Backup & restore](backup-restore.md).

## Companion project

Uiable itself is the web dashboard that runs *on* the server: [github.com/AlfieeLawrence/uiable](https://github.com/AlfieeLawrence/uiable). Connect is the client that reaches that server from your PC or phone.
