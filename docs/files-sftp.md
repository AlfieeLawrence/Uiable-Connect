---
title: Files (SFTP)
description: Browse, upload, download, edit, and copy between servers over SFTP — with optional sudo.
order: 31
slug: files-sftp
---

# Files (SFTP)

On an SSH connection, open the **Files** tab for an SFTP browser on that server.

## Basics

- Browse folders; double-click a **text** file to open the built-in editor (up to about **2 MB**; binary files are refused).  
- **Ctrl/Cmd+S** saves. You get a warning if you leave with unsaved changes. The editor goes full screen on phones.  
- **New folder** / **New file**, **Rename**, **Delete**.  
- **Download** files or folders.  
- **Upload** by dragging from Explorer / Finder onto the pane (desktop).

## Use sudo / Save as sudo

SFTP runs as your SSH user. Paths only root can touch (for example under `/etc`) need elevation.

1. Save a **sudo password** on the connection (Edit connection → optional sudo password), or enter one when prompted the first time you use sudo in Files.  
2. Tick **Use sudo** in the Files toolbar. **Every** file action in that pane then runs as root using that saved password (login password is used as a fallback if no dedicated sudo password is set): list, open/view, **Save / Ctrl+S**, new file, new folder, rename, delete, upload, download, drag to *This device*, and copies (same-server or server → server). Nothing falls back to plain SFTP while it is ticked — on desktop, Docker, iOS and Android.  
3. With **Use sudo** off you can still choose **Save ▾ → Save as sudo** in the editor for a one-off root write.
4. If **Use sudo** is off and the server refuses access, Connect says *Permission denied — tick “Use sudo”* instead of a raw SFTP error.

Downloads and server → server copies of root-only paths are copied as root into a private `~/.uiable-connect` staging folder owned by the SSH user, transferred, then removed.

The sudo password is never put on the command line and is never written to History. Prefer a dedicated sudo password over reusing the login password when you can.

## Two panes (between servers)

**Two panes** opens a second file pane for another connected server. Drag files between them; Connect relays the copy through the app (nothing needs a temporary file on disk for the relay path). With **Use sudo** on either pane, the copy reads (source) and/or writes (destination) as root.

## Mobile notes

Downloads are held in memory before the share sheet opens. Prefer desktop for very large transfers (hundreds of MB).

## Related

[Connections](connections.md) · [Terminal](terminal.md) · [Uiable Files](https://github.com/AlfieeLawrence/uiable/blob/main/docs/files.md) · [Backup](backup-restore.md)
