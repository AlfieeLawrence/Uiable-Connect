---
title: Install on iPhone and iPad
description: Sideload the unsigned IPA with AltStore or Sideloadly. App Store status and device requirements.
order: 13
slug: install-ios
---

# Install on iPhone and iPad

## App Store status

Uiable Connect is **not on the App Store** today. Releases ship an **unsigned `.ipa`** built for sideloading. Distribution options depend on your region and tools (AltStore, Sideloadly, a paid Apple Developer account, or EU alternative distribution when available). Treat this as a **sideload / TestFlight-style** install, not a store download.

## Requirements

- **iOS / iPadOS 17** or newer  
- A Mac with Xcode 15+ *if* you build yourself, **or** a Windows/Mac sideload tool for the release IPA  
- Network access to your servers (SSH)

## Install from a GitHub Release (sideload)

1. Open [Releases](https://github.com/AlfieeLawrence/Uiable-Connect/releases/latest)  
2. Download **`Uiable-Connect.ipa`** (unsigned)  
3. Sideload with a tool such as **Sideloadly** or **AltStore** (resign with your Apple ID)  
4. Trust the developer profile on the device if iOS asks (**Settings → General → VPN & Device Management**)  
5. Open **Uiable Connect**

Free Apple ID sideloads typically expire after a short period and need refreshing; a paid Developer account lasts longer.

## Build from source (Mac + Xcode)

```sh
bash mobile/build-ios.sh
```

Xcode opens — set your **Team** under Signing (a free Apple ID works), select your device, and press **Run**.

Unsigned IPA without running on device:

```sh
bash mobile/build-ios.sh --unsigned-ipa
```

## What works on iOS

- Native SSH (SwiftNIO SSH / Citadel); secrets in the **Keychain**  
- Same UI as desktop with a touch layout (drawer, bottom tabs, terminal key row)  
- **Open Uiable dashboard** starts a forward and opens it in an in-app browser  
- Prefer **ed25519** keys or a password. Modern OpenSSH often refuses RSA on this stack; convert PEM keys with `ssh-keygen -p -f key` when needed  

## Limitations to know

- **Forwards pause** while the app is backgrounded — keep Connect open while using a forwarded port  
- Host-key UX matches the mobile product behaviour (see [Troubleshooting](troubleshooting.md) if something looks off)  
- Very large downloads are awkward on-device; prefer desktop for hundreds of MB  

## Blank black screen after an older build?

Version **1.4.3** fixed an iOS viewport-height bug that could leave a blank dark screen after launch. Update to 1.4.3 or newer from Releases if you hit that.

## Next

[Getting started](getting-started.md) · [Connections](connections.md) · [Backup & restore](backup-restore.md)
