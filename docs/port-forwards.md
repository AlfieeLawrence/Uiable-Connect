---
title: Port forwards
description: Built-in Uiable dashboard tunnel and custom SSH local forwards.
order: 32
slug: port-forwards
---

# Port forwards

On an SSH connection, open the **Ports** (Forwards) tab.

## Built-in: Uiable dashboard

Connect adds a built-in forward named **Uiable dashboard** (default PC `8080` → server `127.0.0.1:8080`). When Uiable is detected on another port via `/api/state`, the remote side updates to match.

Use **Open Uiable dashboard** from the overview / pill controls: Connect starts the tunnel and opens the local URL (in-app browser on mobile).

## Custom forwards

Add your own: remote host + port → local (PC) port. You can:

- Start / stop each forward  
- Mark one to **start automatically** when you connect  
- Get a warning if the local port is already in use (instead of a silent failure)

Stopping a forward drops its connections immediately.

## Docker / web version limits

Inside the Docker image, the container cannot open arbitrary host ports unless you use **host networking**. Otherwise only ports published on the container (see `UC_FWD_PORTS` and compose mappings) work. The UI shows a banner when you are in pool mode and how to unlock host networking. Details: [Linux / Docker install](install-linux.md).

## Mobile limits

On **iOS**, forwards pause while the app is in the background — keep Connect open while you use the local port.

## Related

[Install Uiable](install-uiable.md) · [Getting started](getting-started.md)

## Uiable dashboard

Opening Uiable from the overview or the **Uiable** tab reuses the same SSH port-forward id (`uiable`). **open** on a forward row still launches your system browser; the Uiable tab can embed or detach instead.

