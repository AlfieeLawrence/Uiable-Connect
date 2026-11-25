---
title: Terminal
description: Tabs, tmux, scripts, search, copy/paste, and split view.
order: 30
slug: terminal
---

# Terminal

Open a server and choose the **Terminal** tab (labelled **Term** on smaller screens).

## Tabs

- **+ Tab** (Ctrl+T) opens another login shell on the same SSH session path. Shells are real login shells, so `.bashrc` / `.profile` load.  
- Each tab keeps its own scrollback (xterm.js).  
- On phones, use the accessory key row for Esc, Tab, Ctrl, arrows, and Ctrl+C.

## tmux

**+ tmux** opens a tab attached to a **persistent tmux session on the server**. Work keeps running if you disconnect. Ideal for long jobs and reconnecting from another device later (on the server side).

## Scripts (saved commands)

**Scripts** opens your library of saved commands — global or per server. You can:

- Type a snippet into the open terminal  
- Run it once and view the output  
- Run **with sudo** using the saved sudo password or a one-off prompt (never logged)

## Search and copy/paste

- **Find** in the terminal (Ctrl+F) searches scrollback.  
- **macOS:** Cmd+C / Cmd+V in the terminal.  
- **Windows / Linux:** Ctrl+Shift+C / Ctrl+Shift+V (or Ctrl+Insert / Shift+Insert).  
- Right-click for Copy, Paste, Select all, and Clear.

## Split view

Use **Split** to show two panes side by side — any mix of servers and tabs (for example a terminal next to files on another host). Close a pane when you are done; layout remembers up to two panes.

## Themes

Terminal colours follow **Settings → Terminal theme**, and can track the app theme. See [Themes](themes.md).

## Related

[Docker shells](docker.md) · [Files](files-sftp.md) · [Connections](connections.md)

## Tabs and split

- Up to **12** terminal tabs per connection. The **+ Tab** / **+ tmux** / **Docker** buttons grey out and disable at 12 (a soft counter appears from 10).
- Desktop: **⇄ Split** shows two terminals side by side (click a pane, then a tab to assign it to that side). Same idea as Files → Two panes.

## Use sudo

On SSH sessions, tick **Use sudo** in the terminal toolbar. New tabs then open a root shell that **keeps your own environment** (`sudo -E -s`, or `sudo -s` where the server's sudo policy refuses `-E`): your home folder, current folder, PATH and shell setup stay, so your usual commands and aliases work, just as root. It uses the password saved for that connection (sudo password, or login password if that is what you use with sudo). The password is handed to sudo through a deleted temp file on a file descriptor — it is never typed into the terminal, so it never appears on screen, in scrollback or in shell history. Works on desktop, Docker, iOS and Android.

### Use root

Hover over **Use sudo** (or press the ▾ next to it; tap or long-press on touch screens) and tick **Use root** for a full root login (`sudo -i`): root's home folder, PATH, profile and starting folder. Prefer this when you will create files, because programs run under Use sudo can leave root-owned files in your home folder.

- The toolbar label turns **green** for Use sudo and **red** for Use root, and each tab shows a matching **sudo** / **root** pill.
- **Use sudo and Use root switch off every time you connect, disconnect, reconnect or reload** (terminal and Files). Your saved sudo password stays saved.
- Docker actions that need root (for example `docker exec` when your user is not in the `docker` group) work in those tabs because the shell is already root.
- Untick to open normal user shells again. Existing tabs are unchanged; only new tabs follow the checkbox.

