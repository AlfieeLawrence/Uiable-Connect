---
title: Health and alerts
description: Read-only health checks and threshold alerts with system notifications.
order: 41
slug: health-alerts
---

# Health and alerts

Available on **SSH** connections.

## Overview (Home)

While the overview tab is open, Connect polls inexpensive stats about every **3 seconds** (slower when the window is hidden): CPU, RAM, swap, load, uptime, and disks. Stats pause when you leave the tab.

## Health tab

Read-only checks such as:

- Listening ports and firewall hints  
- Pending updates / reboot required  
- Docker images  
- SSH config  
- Disk and inodes  
- Failed services  

Nothing on this tab changes the server by itself. Missing tools or lack of sudo show as unknown / “?” style results. **Refresh package lists** runs `apt update` (or dnf/apk equivalent) **only when you tap it**, and needs sudo.

## Alerts tab

Define rules per server for CPU, RAM, disk, load, swap, and disconnects:

- Threshold  
- “For N seconds” duration  
- Cooldown between notifications  

Rules are saved per server. They are evaluated **only while Connect is running and connected**. You get a **system notification** plus an in-app message. In the Docker web UI, allow **browser notifications** when prompted.

## History

The **History** tab records connection, forward, file, and command **events**. It never stores passwords, keys, file contents, or terminal I/O. You can turn it off or clear it anytime.

## Related

[Terminal](terminal.md) · [Install Uiable](install-uiable.md)
