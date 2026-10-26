---
title: Connections
description: Add and edit SSH, Telnet, and serial connections, test auth, and find hosts on your network.
order: 20
slug: connections
---

# Connections

Everything starts with a saved connection in the sidebar.

## Add a connection

1. Click **+ Add connection** (or the empty-state button).  
2. Choose the type your platform supports:
   - **SSH** — full feature set (overview, files, forwards, health, alerts, history)  
   - **Telnet** — desktop / Docker web (not on mobile)  
   - **Serial** — USB or paired Bluetooth COM/serial ports; **desktop only** (phones and Docker cannot reach hardware ports)  
   - **Local terminal** — desktop: a shell on this device (commands only; not a full TTY for apps like vim)  
3. Fill in name, host, port, and username as needed.  
4. Auth for SSH:
   - Password  
   - SSH private key (paste or choose a file) with optional passphrase  
   - **Key + password** — key tried first, password as fallback  
5. Optional **sudo password** for installs, admin commands, and **Files → Use sudo** / **Save as sudo** on that server.  
6. **Test**, then save.

On first SSH connect, desktop shows the server’s **SHA256 host key fingerprint** for you to confirm. If the key changes later, Connect blocks the session until you **Trust new key**.

## Find hosts on your network

On desktop (not mobile), the add-connection dialog includes **Find on my network**. It scans for hosts with SSH open and lets you pick one. Nothing found → toast explaining the scan came up empty.

## Import OpenSSH config

On the **desktop** app, when adding a connection you can **Import ~/.ssh/config** to pull host entries into Connect.

## Edit, reconnect, multiple servers

- Open a server from the sidebar; Connect keeps several servers usable at once.  
- Edit saved details from the server’s settings/edit controls in the UI.  
- Secrets stay encrypted at rest (platform-specific store). Never paste production passwords into the activity History — that log stores **events only**, not secrets or terminal I/O.

## Related

[Terminal](terminal.md) · [Port forwards](port-forwards.md) · [Install Uiable](install-uiable.md) · [Backup](backup-restore.md)

## Serial (USB / Bluetooth) on Windows

1. Plug in a USB serial adapter (or pair a Bluetooth SPP device in Windows Settings — it appears as a COM port).
2. Close other apps that may hold the port (Arduino IDE, PuTTY, etc.).
3. Add connection → **Serial** → pick `COMx` → baud → **Test**. You should see “Serial port opened”.
4. Save and Connect to open a terminal on that port.

Serial is desktop-only (not in the Docker/web or mobile builds).
