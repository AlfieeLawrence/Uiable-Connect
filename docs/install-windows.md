---
title: Install on Windows
description: Download the portable build or Setup installer, SmartScreen notes, and running from source.
order: 10
slug: install-windows
---

# Install on Windows

## Download

Get the latest Windows build from [Releases](https://github.com/AlfieeLawrence/Uiable-Connect/releases/latest). Typical assets:

- **`Uiable Connect x.y.z.exe`** — portable single executable  
- **`…-win.zip` / `Uiable-Connect-win-x64.zip`** — unzip and run `Uiable Connect.exe`  
- **`Uiable-Connect-Setup-x.y.z.exe`** — NSIS installer (Start Menu + desktop shortcut; faster cold start than portable)

## First launch and SmartScreen

Builds are often **unsigned**. Windows SmartScreen may say Windows protected your PC:

1. Click **More info**
2. Click **Run anyway**

That is expected until official code signing is configured for the project.

## Portable zip (no install)

1. Unzip anywhere, for example `C:\Users\you\Apps\Uiable Connect`
2. Double-click **Uiable Connect.exe**

Server secrets land under `%APPDATA%\uiable-connect\` (encrypted).

## Setup installer

Run `Uiable-Connect-Setup-x.y.z.exe`, choose an install folder, and finish. Use the Start Menu or desktop shortcut afterwards.

## Run from source

1. Install [Node.js 20 LTS](https://nodejs.org/) or newer  
2. In the repo folder: `npm install` then `npm start`  
3. Optional local build: `npm run dist` (output in `dist\`) or double-click `build-windows.bat`

## Docker on Windows

Prefer the desktop app when you can. If you want the browser UI, see [Linux / Docker](install-linux.md) — the one-line installer (`install.ps1`) can enable host networking on Docker Desktop when possible.

```powershell
irm https://raw.githubusercontent.com/AlfieeLawrence/uiable-connect/main/install.ps1 | iex
```

Then open http://localhost:8484

## Next

[Getting started](getting-started.md) · [Connections](connections.md) · [Troubleshooting](troubleshooting.md)
