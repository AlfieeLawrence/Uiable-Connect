---
title: Install on macOS
description: Install the Intel or Apple Silicon build and clear Gatekeeper “damaged” warnings.
order: 11
slug: install-macos
---

# Install on macOS

## Download

From [Releases](https://github.com/AlfieeLawrence/Uiable-Connect/releases/latest), pick the build for your Mac:

- **Apple Silicon (arm64)** — `.dmg` or `-mac.zip`
- **Intel (x64)** — matching `.dmg` / `.zip`

Drag **Uiable Connect.app** into Applications (from the dmg) or unzip the zip.

## Gatekeeper: “app is damaged” or “can’t be opened”

The Mac build is **ad-hoc signed but not notarized** by Apple, so Gatekeeper often blocks the first open. Do **one** of these once:

**Option A — clear quarantine (Terminal):**

```sh
xattr -cr "/Applications/Uiable Connect.app"
```

Then open the app normally.

**Option B — Open Anyway:**

1. Try to open the app (it may fail)  
2. Open **System Settings → Privacy & Security**  
3. Scroll down and click **Open Anyway**

Right-click the app → **Open** can also help the first time.

## Run from source / build yourself

On a Mac with Node.js 20+:

```sh
npm install
npm start
# or produce dmg + zip for Intel and Apple Silicon:
bash build-mac.sh
```

Output lands in `dist/`.

## Next

[Getting started](getting-started.md) · [Connections](connections.md) · [Troubleshooting](troubleshooting.md)
