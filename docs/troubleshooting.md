---
title: Troubleshooting
description: SmartScreen, Gatekeeper, Docker forwards, iOS blank screen, keys, and common fixes.
order: 90
slug: troubleshooting
---

# Troubleshooting

## Windows: SmartScreen blocks the app

Unsigned builds trigger SmartScreen. Use **More info → Run anyway**. See [Install on Windows](install-windows.md).

## macOS: “damaged” or “can’t be opened”

Ad-hoc signed, not notarized. Run:

```sh
xattr -cr "/Applications/Uiable Connect.app"
```

Or **System Settings → Privacy & Security → Open Anyway**. See [Install on macOS](install-macos.md).

## iPhone: blank black screen

Fixed in **v1.4.3** (viewport height cascade in WKWebView). Install a build **1.4.3 or newer** from [Releases](https://github.com/AlfieeLawrence/Uiable-Connect/releases).

## iOS: RSA keys / PEM

Prefer **ed25519** or password auth. Convert awkward PEM keys with `ssh-keygen -p -f key` before importing.

## iOS: forwarded site stops working in the background

iOS pauses forwards when Connect is backgrounded. Keep the app open while you use the local port.

## Host key changed

Desktop blocks the connection and offers **Trust new key** after you verify the new fingerprint out of band.

## Docker: forwards only work on some ports

Without **host networking**, only published ports work. Enable host networking (Docker Desktop → Settings → Resources → Network) or widen `-p` mappings and `UC_FWD_PORTS`. See [Install on Linux](install-linux.md) and [Port forwards](port-forwards.md).

## Docker: backup buttons fail on a LAN IP

Use `http://127.0.0.1:8484` or HTTPS. WebCrypto backup needs a secure context.

## Uiable install stopped: Compose missing

Install the Docker **Compose plugin** on the server. Connect will not modify an existing Docker engine to add it for you.

## Nothing on network scan

**Find on my network** only runs on desktop and only lists hosts with SSH open from your current LAN perspective. VPNs and guest Wi‑Fi isolation often hide devices.

## Still stuck?

- Confirm you are on the latest [release](https://github.com/AlfieeLawrence/Uiable-Connect/releases)  
- Try a [backup export](backup-restore.md) before wiping local data  
- Open an issue on [Uiable-Connect](https://github.com/AlfieeLawrence/Uiable-Connect/issues) with platform, version, and steps (no passwords or private keys)
