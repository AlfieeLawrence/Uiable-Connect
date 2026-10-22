#!/bin/bash
# Build Uiable Connect for macOS (run this on a Mac). Needs Node.js 20+ from https://nodejs.org
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js is not installed. Get it from https://nodejs.org"; exit 1; }
npm install
npm install-scripts approve electron >/dev/null 2>&1 || true
npm run dist:mac
echo "Done. Your .dmg and .zip are in the dist folder (Intel and Apple Silicon)."
open dist 2>/dev/null || true