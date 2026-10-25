# Uiable Connect

> Desktop companion to [Uiable](https://github.com/AlfieeLawrence/uiable), the lightweight self-hosted Linux server dashboard. **Download:** [latest release](https://github.com/AlfieeLawrence/uiable-connect/releases/latest).

Windows, macOS, iPhone/iPad and Android app for your servers: saved logins (SSH, Telnet and serial), terminal tabs, SFTP file manager, live stats and SSH port forwards.
It works whether or not Uiable is installed on the server. If Uiable is running on the server — on **any** port, detected via its `/api/state` endpoint —
an **Open Uiable dashboard** button appears and starts the tunnel for you.

## Run the ready-made build (no install)
1. Unzip `Uiable-Connect-win-x64.zip` anywhere, e.g. `C:\Users\you\Apps\Uiable Connect`.
2. Double-click `Uiable Connect.exe`. Windows SmartScreen may warn because it isn't signed: More info → Run anyway.

## Run from source
1. Install Node.js 20 LTS or newer from nodejs.org.
2. In this folder: `npm install`, then `npm start`.
3. To build your own Windows app: `npm run dist`. The output goes in `dist\`.

## Features
- **Servers:** name, host, port, user, and a password, SSH key (paste it or choose the file, with an optional passphrase), **or both** — with "Key + password" the key is tried first and the password is the fallback. You can also save a **sudo password** used for installs and admin commands. Use **Test** to check before saving.
  Secrets are encrypted with Windows DPAPI (Electron safeStorage) in `%APPDATA%\uiable-connect\servers.json`.
- **Telnet and serial:** besides SSH you can add Telnet servers, and serial devices over USB or paired Bluetooth (they show up as COM/serial ports). Serial needs the desktop app; Docker and phones can't reach hardware ports.
- **Overview:** CPU, RAM, swap, load, uptime and disks. It runs one cheap command every 3 s, and only while that tab is open.
- **Terminal:** multiple xterm tabs per server. It's a real login shell, so `.bashrc` and `.profile` load. **+ tmux** opens a tab attached to a persistent tmux session on the server — it keeps running if you disconnect.
- **Files:** browse, drag and drop files or folders from Explorer to upload, Download (files or folders), New folder or file, Rename, Delete, and double-click to edit text files (Ctrl+S saves). **⇄ Two panes** opens a second pane for another connected server so you can drag files between them (the copy is relayed through the app, nothing touches disk).
- **Split view:** the ⿻ Split button shows two panes side by side — any mix of servers and tabs (a terminal on one server next to files on another, say).
- **Forwards:** a built-in "Uiable dashboard" forward (PC 8080 → server 127.0.0.1:8080, updated automatically to the detected port), plus your own (server host and port → PC port).
  You can start or stop each one, or set it to start automatically on connect. If a PC port is already in use, you're warned instead of it failing silently. Stopping a forward drops its connections immediately — nothing lingers behind.
- **Editor:** a small built-in editor for text files up to 2 MB (binary files are refused), with line numbers, Ctrl/Cmd+S to save and a warning about unsaved changes. Full screen on phones.
- **Copy and paste:** on Mac, Cmd+C/Cmd+V work in the terminal. On Windows and Linux use Ctrl+Shift+C/V (or Ctrl+Insert/Shift+Insert). Right-click the terminal for Copy, Paste, Select all and Clear.
- **Alerts:** rules for CPU, RAM, disk, load, swap and disconnects, each with a threshold, a "for N seconds" duration and a cooldown. Rules are saved per server. They're only checked while the app is running and connected, and they show a system notification plus an in-app message.
- **Health:** read-only checks for open ports, firewall, pending updates, reboot required, Docker images, SSH config, disk and inodes, and failed services. Nothing changes on the server. Missing tools or no sudo show as "?". **Refresh package lists** runs `apt update` (or the dnf/apk equivalent) only when you tap it, and it needs sudo.
- **Host keys:** on first connect you see the server's SHA256 fingerprint and confirm it. If the key changes later, the connection is blocked with a warning and a **Trust new key** option.
- **Scripts:** saved commands, global or per server. Type one into the open terminal, run it once with the output shown, or run it **with sudo** (saved sudo password, or a one-off prompt — never stored, never logged).
- **Activity log:** the History tab records connections, forwards, file operations and commands — events only. It can never contain passwords, keys, file contents or terminal input/output, and you can turn it off or clear it any time.
- **Encrypted backup:** export servers, forwards, alerts, snippets and secrets to a password-protected `.ucbackup` file (AES-256-GCM, PBKDF2 with 600k iterations). Import it on any desktop, mobile or Docker copy, and choose Merge or Replace.
- **Install / Update Uiable:** detects whether Uiable is installed (on any port), which version is running and the latest release. It then offers Install, Update to X or Up to date. After you confirm, it runs as a detached job on the server and streams the log live. Root access is needed. If your user needs a sudo password, your saved one is used or you're asked for it in the app: it goes to sudo on stdin and is never logged. Updates keep accounts and data volumes, and a backup of `/opt/uiable` is written to `/opt/uiable.backup-<date>.tar.gz` first.
  If Docker isn't installed, it's installed first, and the confirmation says so. This uses get.docker.com on Debian, Ubuntu, Raspbian, Fedora, CentOS and RHEL, apk on Alpine, or pacman on Arch. The service is then started and your user is added to the docker group. Other systems stop with a message. An existing Docker install is never changed.
- **Self-update:** when a new release is out, the banner's **Update** button downloads it and restarts the app (Windows), or downloads the matching dmg for you to swap in (macOS).
- You can connect to several servers at once.

## macOS: "app is damaged" or "can't be opened"
The Mac build is ad-hoc signed but **not notarized** by Apple, so Gatekeeper blocks it the first time. Do one of these once:
- In Terminal, run `xattr -cr "/Applications/Uiable Connect.app"`, then open the app normally. Or:
- Try to open the app, then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**.

## Docker (web version in your browser)
This is the same app, served by a small Node container. Your SSH connections run inside the container.
```sh
curl -O https://raw.githubusercontent.com/AlfieeLawrence/uiable-connect/main/docker-compose.yml
docker compose up -d     # then open http://127.0.0.1:8484
```
Or with plain Docker: `docker run -d -p 127.0.0.1:8484:8484 -p 127.0.0.1:8080-8090:8080-8090 -v uc-data:/data ghcr.io/alfieelawrence/uiable-connect:latest` (images for amd64 and arm64).
- **Data:** everything is stored in the `/data` volume. Passwords and keys are encrypted with a key kept in that volume (`/data/secret.key`), or with your own key from `UC_SECRET`.
- **Login:** set `UC_PASSWORD` to require a password. If it isn't set, the container prints a warning, and the compose file only listens on 127.0.0.1 for that reason. Don't publish it to the network without a password, and preferably put it behind HTTPS.
- **Other hostnames:** requests for any host except localhost are refused (this protects against DNS rebinding) unless `UC_PASSWORD` is set or the host is listed in `UC_ALLOWED_HOSTS=uc.example.com,192.168.1.5`.
- **Forwards:** a container can't open arbitrary ports on your PC — each forward's PC port must be published at run/compose time (the compose file publishes 8080–8090). Publish more ports and tell the app about them with `UC_FWD_PORTS="8080-8090,9000-9010"` so the Forwards tab can check them. Open a forward at `http://127.0.0.1:<port>`.
- **Alerts** use browser notifications (allow them when asked).
- **Backups and other crypto features need a secure context.** That means `http://localhost`/`127.0.0.1`, or HTTPS. A plain `http://LAN-IP` won't work for those.
- **Updating:** `docker compose pull && docker compose up -d`. Your data stays in the volume.

## Build it yourself
- **Windows:** double-click `build-windows.bat`. The app lands in `dist\`.
- **macOS:** on a Mac with Node.js 20+, run `bash build-mac.sh`. You get a `.dmg` and `.zip` for Intel and Apple Silicon in `dist/`. It's ad-hoc signed but not notarized, so right-click the app and choose Open the first time. If macOS still says it's damaged, run `xattr -cr "/Applications/Uiable Connect.app"`.

## Mobile: iPhone, iPad and Android
`mobile/` is the same app for phones and tablets, built with [Capacitor](https://capacitorjs.com). It reuses `src/` with a touch layout: a server drawer, bottom tabs on phones, safe-area padding, and a terminal key row (Esc, Tab, Ctrl, arrows, ^C).
SSH runs natively: JSch on Android and SwiftNIO SSH (Citadel) on iOS. Passwords and keys live in the Android Keystore or the iOS Keychain.
**Open Uiable dashboard** starts the forward and opens `http://127.0.0.1:8080` in an in-app browser. Stats only poll while the app is on screen.

- **Android:** with Node.js 20+, JDK 17 and the Android SDK (Android Studio brings both), run `mobile/build-android.bat` on Windows or `bash mobile/build-android.sh` on macOS/Linux.
  You get `mobile/Uiable-Connect-android-debug.apk`. Copy it to the phone and open it, or run `adb install -r` on it. Android 5.1 or newer.
  For a signed release build, `build-android.sh` prints the `keytool`, `assembleRelease` and `apksigner` steps.
- **iPhone/iPad:** on a Mac with Xcode 15+, run `bash mobile/build-ios.sh`. Xcode opens; pick your Team under Signing (a free Apple ID works), choose your device and press Run.
  `bash mobile/build-ios.sh --unsigned-ipa` makes an unsigned `.ipa` instead, which you can sideload with Sideloadly or AltStore. Needs iOS/iPadOS 17 or newer.
- **Icons:** generated from `build/icon.png`. To regenerate them, run `cd mobile && npm run assets`.

Mobile limitations:
- Host keys are accepted without checking, the same as on desktop.
- iOS pauses forwards while the app is in the background, so keep it open while you use a forwarded port.
- On iOS, use ed25519 keys or a password. RSA keys are refused by modern OpenSSH servers there, and PEM keys must be converted first with `ssh-keygen -p -f key`.
- Downloads are held in memory before the share sheet opens, so very large files (hundreds of MB) are better fetched on desktop.

## Releases
GitHub Actions (`.github/workflows/release.yml`) builds Windows (portable + zip), macOS (dmg + zip, Intel + Apple Silicon), Android (debug APK + unsigned release APK) and iOS (unsigned `.ipa`, iPhone + iPad). It then attaches them all to the GitHub release.
To cut a release, bump `"version"` in `package.json` (and `mobile/package.json`), commit, then run:

```
git tag v1.1.0 && git push --tags
```

You can also start it from the Actions tab with **Run workflow**. Leave the tag empty to only build, and download the files from the run's artifacts.

