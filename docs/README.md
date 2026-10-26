---
title: Documentation
description: Guides for installing and using Uiable Connect on desktop, mobile, and Docker.
order: 0
slug: index
---

# Uiable Connect documentation

Uiable Connect is the desktop and mobile companion to [Uiable](https://github.com/AlfieeLawrence/uiable), the lightweight self-hosted Linux server dashboard. Use it to save SSH (and Telnet/serial) connections, open terminals, browse files over SFTP, forward ports, check health, and optionally install Uiable on a server.

**Download builds:** [GitHub Releases](https://github.com/AlfieeLawrence/Uiable-Connect/releases)  
**Source:** [AlfieeLawrence/Uiable-Connect](https://github.com/AlfieeLawrence/Uiable-Connect)  
**Server dashboard docs:** [Uiable docs](https://github.com/AlfieeLawrence/uiable/tree/main/docs) (`docs/manifest.json` for website ingest)

## Start here

1. [Getting started](getting-started.md) — what the app is and how to pick a platform
2. Install on your device:
   - [Windows](install-windows.md)
   - [macOS](install-macos.md)
   - [Linux / Docker](install-linux.md)
   - [iPhone & iPad](install-ios.md)
   - [Android](install-android.md)
3. [Connections](connections.md) — add servers, keys, network find
4. Day-to-day: [Terminal](terminal.md) · [Files](files-sftp.md) · [Port forwards](port-forwards.md) · [Docker shells](docker.md)
5. Optional: [Install Uiable on a server](install-uiable.md) · [Health & alerts](health-alerts.md) · [Backup](backup-restore.md) · [Themes](themes.md)
6. [Troubleshooting](troubleshooting.md)

## For website ingest

Pages are one topic per Markdown file with YAML frontmatter (`title`, `description`, `order`, `slug`). A machine-readable index lives in [`manifest.json`](manifest.json).

Stable paths under `/docs/` are intended to stay fetchable from the marketing site (for example raw GitHub or a docs build step).
