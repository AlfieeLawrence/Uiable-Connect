---
title: Backup and restore
description: Export and import encrypted .ucbackup files across desktop, mobile, and Docker.
order: 42
slug: backup-restore
---

# Backup and restore

Use an encrypted **`.ucbackup`** file to move or protect your Connect data.

## What is included

Servers (including passwords and keys), forwards, alerts, trusted host keys, and snippets / scripts — the same format on **Windows, macOS, iPhone/iPad, Android, and Docker**.

Crypto: **AES-256-GCM** with a password; key derivation via **PBKDF2** (600k iterations) using WebCrypto.

## Export

1. Open the backup UI from the sidebar / backup control.  
2. Enter a strong password.  
3. **Export backup** — you get a file like `uiable-connect-YYYY-MM-DD.ucbackup`.

Store the file and remember the password; without the password the archive cannot be opened.

## Import

1. Choose **Merge** or **Replace all**.  
   - **Merge** adds servers from the file and updates ones with the same id.  
   - **Replace** removes every saved server and snippet here first (confirm).  
2. Pick the `.ucbackup` file and enter the password.  
3. Connect reports how many servers were imported.

## Docker / browser note

Backup crypto needs a **secure context**: `http://localhost`, `http://127.0.0.1`, or **HTTPS**. A plain `http://LAN-IP` page cannot use these features.

## Related

[Connections](connections.md) · [Getting started](getting-started.md)
