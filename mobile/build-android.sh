#!/bin/bash
# Build Uiable Connect for Android (debug APK you can install straight away).
# Needs: Node.js 20+, JDK 17 (JAVA_HOME) and the Android SDK (ANDROID_HOME, platform 34 + build-tools 34).
# Easiest way to get JDK + SDK: install Android Studio, open it once, then run this script.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js is not installed. Get it from https://nodejs.org"; exit 1; }
if [ -z "$JAVA_HOME" ] && [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"; fi
[ -n "$JAVA_HOME" ] || command -v java >/dev/null || { echo "JDK 17 not found. Install Temurin 17 (https://adoptium.net) or Android Studio, then set JAVA_HOME."; exit 1; }
if [ -z "$ANDROID_HOME" ]; then for d in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" "$HOME/android-sdk"; do [ -d "$d" ] && export ANDROID_HOME="$d" && break; done; fi
[ -n "$ANDROID_HOME" ] || { echo "Android SDK not found. Install Android Studio or set ANDROID_HOME."; exit 1; }
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
npm install
npm run web
npx cap sync android
cd android && chmod +x gradlew && ./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk ../Uiable-Connect-android-debug.apk
echo "Done: mobile/Uiable-Connect-android-debug.apk"
echo "Install on a phone: enable USB debugging, then: adb install -r mobile/Uiable-Connect-android-debug.apk (or copy the file to the phone and open it)."
cat <<'R'

Release build (for sharing / Play Store):
  1. Make a signing key once (keep it safe, you need it for every update):
       keytool -genkey -v -keystore uiable-release.jks -alias uiable -keyalg RSA -keysize 2048 -validity 10000
  2. cd mobile/android && ./gradlew assembleRelease     (or bundleRelease for an .aab for Play)
  3. Sign + align the APK:
       $ANDROID_HOME/build-tools/34.0.0/zipalign -p 4 app/build/outputs/apk/release/app-release-unsigned.apk aligned.apk
       $ANDROID_HOME/build-tools/34.0.0/apksigner sign --ks uiable-release.jks --out Uiable-Connect-release.apk aligned.apk
R
