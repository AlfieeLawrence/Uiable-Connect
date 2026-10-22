# Uiable Connect

> Desktop companion to [Uiable](https://github.com/AlfieeLawrence/uiable), the lightweight self-hosted Linux server dashboard. **Download:** [latest release](https://github.com/AlfieeLawrence/uiable-connect/releases/latest).

Windows app for your servers: saved logins, terminal tabs, SFTP file manager, live stats and SSH port forwards.
It works whether or not Uiable is installed on the server. If Uiable is running on the server (port 8080),
an **Open Uiable dashboard** button appears and starts the tunnel to localhost:8080 for you.

## Run the ready-made build (no install)
1. Unzip `Uiable-Connect-win-x64.zip` anywhere, e.g. `C:\Users\you\Apps\Uiable Connect`.
2. Double-click `Uiable Connect.exe`. Windows SmartScreen may warn because it isn't signed: More info â†’ Run anyway.

## Run from source
1. Install Node.js 20 LTS or newer from nodejs.org.
2. In this folder: `npm install`, then `npm start`.
3. To build your own Windows app: `npm run dist`. The output goes in `dist\`.

## Features
- **Servers:** name, host, port, user, and a password or SSH key (paste it or choose the file, with an optional passphrase). Use **Test** to check before saving.
  Secrets are encrypted with Windows DPAPI (Electron safeStorage) in `%APPDATA%\uiable-connect\servers.json`.
- **Overview:** CPU, RAM, swap, load, uptime and disks. It runs one cheap command every 3 s, and only while that tab is open.
- **Terminal:** multiple xterm tabs per server. It's a real login shell, so `.bashrc` and `.profile` load.
- **Files:** browse, drag and drop files or folders from Explorer to upload, Download (files or folders), New folder or file, Rename, Delete, and double-click to edit text files (Ctrl+S saves).
- **Forwards:** a built-in "Uiable dashboard" forward (PC 8080 â†’ server 127.0.0.1:8080), plus your own (server host and port â†’ PC port).
  You can start or stop each one, or set it to start automatically on connect. If a PC port is already in use, you're warned instead of it failing silently.
- You can connect to several servers at once.

## Build it yourself
- **Windows:** double-click `build-windows.bat`. The app lands in `dist\`.
- **macOS:** on a Mac with Node.js 20+, run `bash build-mac.sh`. You get a `.dmg` and `.zip` for Intel and Apple Silicon in `dist/`. It isn't signed, so right-click the app and choose Open the first time.

