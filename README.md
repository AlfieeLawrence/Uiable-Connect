# Uiable Connect

> Desktop companion to [Uiable](https://github.com/AlfieeLawrence/uiable), the lightweight self-hosted Linux server dashboard. **Download:** [latest release](https://github.com/AlfieeLawrence/uiable-connect/releases/latest).

Windows, macOS, iPhone/iPad and Android app for your servers: saved logins, terminal tabs, SFTP file manager, live stats and SSH port forwards.
It works whether or not Uiable is installed on the server. If Uiable is running on the server (port 8080),
an **Open Uiable dashboard** button appears and starts the tunnel to localhost:8080 for you.

## Run the ready-made build (no install)
1. Unzip `Uiable-Connect-win-x64.zip` anywhere, e.g. `C:\Users\you\Apps\Uiable Connect`.
2. Double-click `Uiable Connect.exe`. Windows SmartScreen may warn because it isn't signed: More info → Run anyway.

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
- **Forwards:** a built-in "Uiable dashboard" forward (PC 8080 → server 127.0.0.1:8080), plus your own (server host and port → PC port).
  You can start or stop each one, or set it to start automatically on connect. If a PC port is already in use, you're warned instead of it failing silently.
- **Editor:** a small built-in editor for text files up to 2 MB (binary files are refused), with line numbers, Ctrl/Cmd+S to save and a warning about unsaved changes. Full screen on phones.
- **Copy and paste:** on Mac, Cmd+C/Cmd+V work in the terminal. On Windows and Linux use Ctrl+Shift+C/V (or Ctrl+Insert/Shift+Insert). Right-click the terminal for Copy, Paste, Select all and Clear.
- **Alerts:** rules for CPU, RAM, disk, load, swap and disconnects, each with a threshold, a "for N seconds" duration and a cooldown. Rules are saved per server. They're only checked while the app is running and connected, and they show a system notification plus an in-app message.
- **Health:** read-only checks for open ports, firewall, pending updates, reboot required, Docker images, SSH config, disk and inodes, and failed services. Nothing changes on the server. Missing tools or no sudo show as "?". **Refresh package lists** runs `apt update` (or the dnf/apk equivalent) only when you tap it, and it needs sudo.
- **Host keys:** on first connect you see the server's SHA256 fingerprint and confirm it. If the key changes later, the connection is blocked with a warning and a **Trust new key** option.
- **Snippets:** saved commands, global or per server. Run one in the open terminal, or as a one-off with the output shown.
- **Encrypted backup:** export servers, forwards, alerts, snippets and secrets to a password-protected `.ucbackup` file (AES-256-GCM, PBKDF2 with 600k iterations). Import it on any desktop, mobile or Docker copy, and choose Merge or Replace.
- **Install / Update Uiable:** detects whether Uiable is installed, which version is running and the latest release. It then offers Install, Update to X or Up to date. After you confirm, it runs as a detached job on the server and streams the log live. Root access is needed. If your user needs a sudo password, you're asked for it in the app: it goes to sudo on stdin and is never logged or saved. Updates keep accounts and data volumes, and a backup of `/opt/uiable` is written to `/opt/uiable.backup-<date>.tar.gz` first.
  If Docker isn't installed, it's installed first, and the confirmation says so. This uses get.docker.com on Debian, Ubuntu, Raspbian, Fedora, CentOS and RHEL, apk on Alpine, or pacman on Arch. The service is then started and your user is added to the docker group. Other systems stop with a message. An existing Docker install is never changed.
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
- **Forwards:** a forward's local port has to be inside the published range 8080-8090, so the Uiable dashboard forward on 8080 works as is. Open it at `http://127.0.0.1:<port>`.
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

