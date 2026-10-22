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
- You can connect to several servers at once.

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

