#!/bin/bash
# Build Uiable Connect for iPhone and iPad. Run on a Mac with Xcode 15+ and Node.js 20+. Needs iOS 17+ on the device.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js is not installed. Get it from https://nodejs.org"; exit 1; }
command -v xcodebuild >/dev/null || { echo "Xcode is not installed. Get it from the Mac App Store."; exit 1; }
npm install
npm run web
npx cap sync ios        # also runs scripts/ios-fix.js (iOS 17 target, local networking)
if [ "$1" = "--unsigned-ipa" ]; then
  # Unsigned .ipa for sideloading with Sideloadly / AltStore (they re-sign it with your Apple ID).
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
    -archivePath build/App.xcarchive archive CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" TARGETED_DEVICE_FAMILY="1,2"
  rm -rf build/Payload && mkdir -p build/Payload && cp -R build/App.xcarchive/Products/Applications/App.app build/Payload/
  (cd build && zip -qry ../Uiable-Connect.ipa Payload)
  echo "Done: mobile/Uiable-Connect.ipa (unsigned; sideload it with Sideloadly or AltStore)"
  exit 0
fi
npx cap open ios
cat <<'T'
Xcode is opening. Then:
  1. Select the "App" target > Signing & Capabilities > tick "Automatically manage signing" and choose your Team (a free Apple ID works).
  2. Plug in your iPhone/iPad (or pick a simulator) at the top, press Run (Cmd+R).
  3. For TestFlight/App Store: Product > Archive > Distribute App (needs a paid Apple Developer account).
Or build an unsigned .ipa for sideloading:  bash build-ios.sh --unsigned-ipa
T
