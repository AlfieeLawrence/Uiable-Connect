---
title: Docker on the server
description: Open a shell inside a running container from the Terminal tab.
order: 33
slug: docker
---

# Docker on the server

This page is about **Docker on the remote SSH host**, not the [Connect Docker image](install-linux.md).

## Open a container shell

In the **Terminal** tab on an SSH server, use the **Docker** control. Connect lists **running** containers (`docker ps`). Pick one to open a new tab that runs roughly:

```sh
docker exec -it <container> bash 2>/dev/null || docker exec -it <container> sh
```

If nothing is running, you get a clear toast.

## Requirements on the server

- Docker installed and reachable for your SSH user (often membership in the `docker` group)  
- Permission to exec into the container  

Installing [Uiable](install-uiable.md) from Connect can install Docker first when needed (official get.docker.com / distro packages) — that path is separate from day-to-day exec.

## Related

[Terminal](terminal.md) · [Health & alerts](health-alerts.md)

## Root Docker via terminal Use sudo

If `docker` on the server requires sudo (user not in the `docker` group), tick **Use sudo** on the Terminal tab before opening a Docker shell. New tabs run as root with the saved sudo password, so `docker ps` / `docker exec` work without typing sudo each time.

