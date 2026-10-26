---
title: Install on Android
description: Sideload the debug APK from Releases or build a signed release yourself.
order: 14
slug: install-android
---

# Install on Android

## Requirements

- **Android 5.1** or newer  
- Permission to install apps from unknown sources / “install unknown apps” for your browser or file manager  

## Install the release APK

1. Open [Releases](https://github.com/AlfieeLawrence/Uiable-Connect/releases/latest)  
2. Download **`Uiable-Connect-…-android-debug.apk`**  
3. Open the file on the phone and install  
4. Or from a PC with USB debugging: `adb install -r path\to\the.apk`

The **`android-release-unsigned.apk`** asset must be **signed** before install; everyday users should take the debug APK from the release unless they maintain their own signing key.

## Build from source

With Node.js 20+, JDK 17, and the Android SDK (Android Studio is enough):

```bat
REM Windows
mobile\build-android.bat
```

```sh
# macOS / Linux
bash mobile/build-android.sh
```

You get `mobile/Uiable-Connect-android-debug.apk`. The script also prints `keytool` / `assembleRelease` / `apksigner` steps for a signed release.

Icons come from `build/icon.png` (`cd mobile && npm run assets` to regenerate).

## What works on Android

- Native SSH via JSch; secrets in the **Android Keystore**  
- Touch layout shared with iOS (drawer, tabs, terminal accessory keys)  
- Encrypted **.ucbackup** import/export shared with desktop and Docker  

## Tips

- Keep the app in the foreground while using port forwards if you rely on them  
- For huge file transfers, desktop SFTP is more comfortable  

## Next

[Getting started](getting-started.md) · [Connections](connections.md) · [Backup & restore](backup-restore.md)
