// Runs after every `cap sync` (npm hook capacitor:sync:after). Citadel (the iOS SSH library) needs iOS 17,
// so raise the deployment target in the Capacitor-managed SPM package and the Xcode project.
const fs = require('fs'), path = require('path');
const ios = path.join(__dirname, '..', 'ios', 'App');
const spm = path.join(ios, 'CapApp-SPM', 'Package.swift');
if (fs.existsSync(spm)) fs.writeFileSync(spm, fs.readFileSync(spm, 'utf8').replace(/\.iOS\(\.v1[0-6]\)/, '.iOS(.v17)'));
const pbx = path.join(ios, 'App.xcodeproj', 'project.pbxproj');
if (fs.existsSync(pbx)) fs.writeFileSync(pbx, fs.readFileSync(pbx, 'utf8').replace(/IPHONEOS_DEPLOYMENT_TARGET = 1[0-6]\.\d;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 17.0;'));
// Allow plain-http loopback (the Uiable dashboard through the tunnel) under App Transport Security
const plist = path.join(ios, 'App', 'Info.plist');
if (fs.existsSync(plist)) { let s = fs.readFileSync(plist, 'utf8');
  if (!s.includes('NSAllowsLocalNetworking')) s = s.replace(/<dict>/, '<dict>\n\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsLocalNetworking</key>\n\t\t<true/>\n\t</dict>');
  fs.writeFileSync(plist, s); }
