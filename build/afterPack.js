// Ad-hoc sign the macOS .app before electron-builder makes the dmg and zip (mac identity is null, so it won't sign).
// Without a real ad-hoc signature (sealed resources) Apple Silicon Gatekeeper reports the app as "damaged".
// Strictly inside-out: every loose Mach-O file, then bundles (.framework/.app) deepest first, then the main app.
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const MACHO = new Set(['feedfacf', 'cffaedfe', 'feedface', 'cefaedfe', 'cafebabe', 'bebafeca']);
const isMachO = f => { try { const fd = fs.openSync(f, 'r'), b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd); return MACHO.has(b.toString('hex')); } catch { return false; } };
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  const sign = p => execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', p], { stdio: 'inherit' });
  const files = [], bundles = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { walk(p); if (/\.(framework|app|xpc)$/.test(e.name)) bundles.push(p); }
    else if (isMachO(p)) files.push(p); } };
  walk(path.join(app, 'Contents'));
  const depth = p => p.split(path.sep).length;
  // bundle main executables get sealed with their bundle, so skip them as loose files
  const bundleExe = new Set(bundles.flatMap(b => b.endsWith('.framework') ? [path.join(b, 'Versions', 'A', path.basename(b, '.framework'))] : [path.join(b, 'Contents', 'MacOS', path.basename(b, path.extname(b)))]));
  bundleExe.add(path.join(app, 'Contents', 'MacOS', path.basename(app, '.app')));
  for (const f of files.filter(f => !bundleExe.has(f)).sort((a, b) => depth(b) - depth(a))) sign(f);
  for (const b of bundles.sort((a, c) => depth(c) - depth(a))) sign(b.endsWith('.framework') ? path.join(b, 'Versions', 'A') : b);
  sign(app);
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
  console.log(`ad-hoc signed ${app} (${files.length} Mach-O files, ${bundles.length} bundles)`);
};
