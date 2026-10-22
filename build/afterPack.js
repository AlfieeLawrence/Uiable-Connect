// Ad-hoc sign the macOS .app before electron-builder makes the dmg and zip (mac identity is null, so it won't sign).
// Without a real ad-hoc signature (sealed resources) Apple Silicon Gatekeeper reports the app as "damaged".
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  const sign = p => execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', p], { stdio: 'inherit' });
  // inside-out: frameworks' dylibs/helpers first, then helper apps, then frameworks, then the app
  const fw = path.join(app, 'Contents', 'Frameworks');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => { const p = path.join(d, e.name); return e.isSymbolicLink() ? [] : e.isDirectory() ? [...walk(p), p] : [p]; });
  if (fs.existsSync(fw)) {
    for (const f of walk(fw)) if (!f.includes('.app/') && /\.(dylib|node)$/.test(f)) sign(f);
    for (const f of walk(fw)) if (/\.app$/.test(f)) sign(f);
    for (const f of walk(fw)) if (/\.framework$/.test(f)) sign(f);
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
  console.log('ad-hoc signed', app);
};
