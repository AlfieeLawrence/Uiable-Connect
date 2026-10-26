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
2. Tick **Use sudo** in the Files toolbar. List, open/view, upload, and same-server copy then run via sudo using that saved password (login password is used as a fallback if no dedicated sudo password is set).  
3. In the editor, open **Save ▾** and choose **Save as sudo** to write the file as root.
4. **Delete**, list, open, upload, and same-server copy also honour **Use sudo** (one error toast if permission is still denied).

The sudo password is never put on the command line and is never written to History. Prefer a dedicated sudo password over reusing the login password when you can.

## Two panes (between servers)

**Two panes** opens a second file pane for another connected server. Drag files between them; Connect relays the copy through the app (nothing needs a temporary file on disk for the relay path). With **Use sudo** on the destination pane, same-server copies also use sudo.

## Mobile notes

Downloads are held in memory before the share sheet opens. Prefer desktop for very large transfers (hundreds of MB).

## Related

[Connections](connections.md) · [Terminal](terminal.md) · [Uiable Files](https://github.com/AlfieeLawrence/uiable/blob/main/docs/files.md) · [Backup](backup-restore.md)
