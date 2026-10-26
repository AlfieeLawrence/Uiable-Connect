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
