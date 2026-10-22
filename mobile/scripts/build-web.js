// Copies the desktop UI (../src) into www/ and swaps in the mobile bridge + touch layout.
// The desktop app is untouched: index.html is rewritten only inside www/.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), src = path.join(root, '..', 'src'), out = path.join(root, 'www');
const bundle = f => path.join(root, 'node_modules', f);
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(out, f));
for (const f of fs.readdirSync(path.join(root, 'web'))) if (f !== 'index.html') fs.copyFileSync(path.join(root, 'web', f), path.join(out, f));
// Capacitor runtime: plugins are reached through window.Capacitor (no bundler needed).
let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">')
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replace('<link rel="stylesheet" href="app.css">', '<link rel="stylesheet" href="app.css"><link rel="stylesheet" href="mobile.css">')
  .replace('<script src="app.js"></script>', '<script>window.UC_VERSION=' + JSON.stringify(require(path.join(root, 'package.json')).version) + '</script><script src="bridge.js"></script><script src="app.js"></script><script src="mobile.js"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('www/ ready (' + fs.readdirSync(out).length + ' files)');
