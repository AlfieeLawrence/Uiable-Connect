'use strict';
const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, Menu, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { makeSession, testConnection, testSudo, sudoExec, listSerial, jumpSock, listDockerPs, sudoReadText, sudoWriteText, sudoList, sudoUploadPath, sudoCopySame } = require('./lib/core');
const os = require('os');
const net = require('net');
const { Store } = require('./lib/store');
const { History } = require('./lib/history');

// Keep it light: no GPU process work for a simple UI, single instance.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,SpareRendererForSitePerProcess');
if (!app.requestSingleInstanceLock()) app.quit();
// macOS needs an Edit menu for Cmd+C/V/X/A to work at all; no Reload item so a stray Cmd+R can't drop sessions.
if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' },
  { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] }, { role: 'windowMenu' }]));
else Menu.setApplicationMenu(null);
if (process.platform === 'win32') app.setAppUserModelId('com.xtechind.uiableconnect'); // needed for Windows toast notifications

let win, store, hist; const sessions = new Map(); // serverId -> Session
const enc = s => safeStorage.isEncryptionAvailable() ? 'e:' + safeStorage.encryptString(s).toString('base64') : 'p:' + Buffer.from(s).toString('base64');
const dec = s => s.startsWith('e:') ? safeStorage.decryptString(Buffer.from(s.slice(2), 'base64')) : Buffer.from(s.slice(2), 'base64').toString();
const send = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); };
// Audit log: events only — it never sees terminal input/output, file contents or secrets.
const log = (id, ev, detail) => { if (store && store.setting('history', true) && hist) { const s = store.list().find(x => x.id === id); hist.add(id, s ? s.name || s.host : '', ev, detail); } };

function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 820, minWidth: 900, minHeight: 560, backgroundColor: '#0b0d14', title: 'Uiable Connect',
    icon: path.join(__dirname, 'src', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, spellcheck: false, backgroundThrottling: true } });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // native right-click menu for text fields and selected text (the terminal has its own menu)
  win.webContents.on('context-menu', (_e, p) => { const t = p.isEditable
    ? [{ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll' }]
    : p.selectionText ? [{ role: 'copy' }] : [];
    if (t.length) Menu.buildFromTemplate(t).popup({ window: win }); });
  if (process.env.UC_SHOT) win.webContents.once('did-finish-load', () => require('./test/shots')(win, process.env.UC_SHOT));
}

if (process.env.UC_DATA) app.setPath('userData', process.env.UC_DATA);
app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('userData'), 'servers.json'), enc, dec);
  hist = new History(path.join(app.getPath('userData'), 'logs'));
  createWindow();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { for (const s of sessions.values()) s.end(); app.quit(); });

const S = id => { const s = sessions.get(id); if (!s || s.closed) throw new Error('Not connected'); return s; };
const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (e) { return { ok: false, error: e.message || String(e) }; } });
const fwdStatuses = (s, sess) => sess.forwardStatus ? (s.forwards || []).map(f => sess.forwardStatus(f.id)) : [];
// Resolve a jump host into an SSH channel socket on srv._sock (one hop). unJump tears down a sock
// that never became a session (e.g. a failed Test).
const withJump = async srv => { if ((!srv.connType || srv.connType === 'ssh') && srv.jumpId && srv.jumpId !== srv.id) {
  const j = store.full(srv.jumpId); if (j.jumpId === srv.id) delete j.jumpId; srv._sock = await jumpSock(j, srv.host, srv.port); } return srv; };
const unJump = srv => { try { if (srv._sock) { srv._sock.destroy(); srv._sock._jumpClient && srv._sock._jumpClient.end(); } } catch {} };

h('servers:list', () => store.list().map(s => ({ ...s, connected: sessions.has(s.id) && !sessions.get(s.id).closed,
  fwdStatus: sessions.has(s.id) ? fwdStatuses(s, sessions.get(s.id)) : [] })));
h('servers:save', s => { const id = store.upsert(s); log(id, 'server-saved', `${s.username ? s.username + '@' : ''}${s.host || s.serialPath || ''}`); return id; });
h('servers:delete', id => { if (sessions.has(id)) sessions.get(id).end(); sessions.delete(id); log(id, 'server-deleted'); store.remove(id); });
h('servers:forwards', (id, fw) => store.setForwards(id, fw));
h('servers:hostkey', (id, fp) => store.setHostKey(id, fp));
h('snippets:list', () => store.snippets());
h('snippets:save', l => store.setSnippets(l));
h('backup:export', () => { log(null, 'backup-export'); return store.exportAll(); });
h('backup:import', (d, mode) => { if (mode === 'replace') { for (const s of sessions.values()) s.end(); sessions.clear(); } const n = store.importAll(d, mode); log(null, 'backup-import', `${n} server(s), ${mode}`); return n; });
h('file:save', async (name, text) => { const r = await dialog.showSaveDialog(win, { title: 'Save backup', defaultPath: path.join(app.getPath('documents'), path.basename(String(name))), filters: [{ name: 'Uiable Connect backup', extensions: ['ucbackup'] }] });
  if (r.canceled || !r.filePath) return null; fs.writeFileSync(r.filePath, String(text), { mode: 0o600 }); return r.filePath; });
h('servers:alerts', (id, rules) => store.setAlerts(id, rules));
h('servers:test', async (s) => { // merge saved secrets if editing and fields left blank
  let full = { ...s }; if (s.id) { const saved = store.full(s.id); for (const k of ['password', 'privateKey', 'passphrase', 'sudoPassword']) if (!full[k]) full[k] = saved[k]; }
  try { await withJump(full); return await testConnection(full); } finally { unJump(full); }
});
h('sudo:test', async (s, pw) => { // test sudo on a throwaway connection (merges saved secrets like servers:test)
  let full = { ...s }; if (s.id) { const saved = store.full(s.id); for (const k of ['password', 'privateKey', 'passphrase', 'sudoPassword']) if (!full[k]) full[k] = saved[k]; }
  try { await withJump(full); return await testSudo(full, pw); } finally { unJump(full); }
});
h('servers:dup', id => { const f = store.full(id); delete f.id; delete f.hostKey; f.name = (f.name || f.host || 'server') + ' copy'; return store.upsert(f); });
h('servers:clearhostkey', id => { if (store.tmp && store.tmp.has(id)) { store.tmp.get(id).hostKey = null; return true; } store.clearHostKey(id); return true; });
// parse ~/.ssh/config into saveable server entries (key contents included when readable)
h('servers:importSsh', () => { const f = path.join(app.getPath('home'), '.ssh', 'config'); if (!fs.existsSync(f)) return [];
  const out = []; let cur = null;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(\S+)\s+(.+?)\s*(?:#.*)?$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2];
    if (k === 'host') { if (cur) out.push(cur); cur = /[*?]/.test(v) ? null : { name: v, host: v, port: 22, username: '', privateKey: '', keyName: '' }; }
    else if (cur) { if (k === 'hostname') cur.host = v; else if (k === 'user') cur.username = v; else if (k === 'port') cur.port = Number(v) || 22;
      else if (k === 'identityfile' && !cur.privateKey) { const p = v.replace(/^~/, app.getPath('home')).replace(/%d/g, app.getPath('home'));
        try { const t = fs.readFileSync(p, 'utf8'); if (/PRIVATE KEY/.test(t)) { cur.privateKey = t; cur.keyName = path.basename(p); } } catch {} } }
  }
  if (cur) out.push(cur); return out; });
h('key:pick', async () => { const r = await dialog.showOpenDialog(win, { title: 'Choose private key', properties: ['openFile', 'showHiddenFiles'] });
  if (r.canceled) return null; const p = r.filePaths[0]; return { name: path.basename(p), text: fs.readFileSync(p, 'utf8') }; });
h('serial:list', () => listSerial());

h('conn:connect', async (id) => {
  if (sessions.has(id) && !sessions.get(id).closed) return true;
  const srv = await withJump(store.full(id));
  const s = makeSession(srv, (ev, d) => { if (ev === 'closed') log(id, 'connection-lost'); send('ev', { id, ev, ...d }); });
  try { await s.connect(); } catch (e) { unJump(srv); throw e; } sessions.set(id, s);
  log(id, 'connected', srv.connType === 'serial' ? `${srv.serialPath} @ ${srv.baudRate || 115200}` : srv.connType === 'local' ? 'local shell' : `${srv.username || ''}@${srv.host}:${srv.port}`);
  if (s.startForward) for (const f of srv.forwards || []) if (f.auto) (f.dir === 'remote' && s.startRemote ? s.startRemote(f) : s.startForward(f)).catch(e => send('ev', { id, ev: 'toast', message: e.message }));
  return true;
});
// quick connect: a temp server held in memory only — it disappears from disk-free store when removed
h('conn:quick', async (v) => { const srv = { id: 'q' + Date.now(), name: v.host, host: String(v.host || '').trim(), port: Number(v.port) || 22, username: String(v.username || 'root').trim(), auth: 'password', connType: 'ssh', quick: true, forwards: [] };
  if (!srv.host) throw new Error('Host is required'); if (v.password) srv.password = v.password;
  store.putTemp(srv);
  try { const s = makeSession(srv, (ev, d) => { if (ev === 'closed') log(srv.id, 'connection-lost'); send('ev', { id: srv.id, ev, ...d }); });
    await s.connect(); sessions.set(srv.id, s); log(srv.id, 'connected', `${srv.username}@${srv.host}`); return srv.id; }
  catch (e) { store.rmTemp(srv.id); throw e; } });
h('servers:purgetemp', id => { const s = sessions.get(id); if (s) s.end(); sessions.delete(id); store.rmTemp(id); return true; });
h('conn:disconnect', id => { const s = sessions.get(id); if (s) { s.end(); log(id, 'disconnected'); } sessions.delete(id); });
h('fwd:start', (id, f) => { const sess = S(id); const r = f.dir === 'remote' && sess.startRemote ? sess.startRemote(f) : sess.startForward(f);
  log(id, 'forward-start', `${f.name || f.id} ${f.dir === 'remote' ? `${f.remoteHost || 'server'}:${f.remotePort} -> ${f.localHost || 'this PC'}:${f.localPort}` : `localhost:${f.localPort} -> ${f.remoteHost}:${f.remotePort}`}`); return r; });
h('fwd:stop', (id, fid) => { log(id, 'forward-stop', fid); return S(id).stopForward(fid); });
h('fwd:check', (port) => makeSession({}).checkLocalPort(Number(port)));
h('stats', id => S(id).stats());
h('exec', (id, cmd, timeout) => S(id).exec(String(cmd), { timeout: Math.min(Number(timeout) || 20000, 180000) }));
// Run a command with sudo. Uses the saved sudo password when present; a transient pw may be passed for
// one-off use (never saved). The password reaches sudo's stdin via a file descriptor — see sudoExec.
h('sudo:exec', async (id, cmd, pw) => { log(id, 'exec-sudo', cmd); const srv = store.full(id); return sudoExec(S(id), String(cmd), pw || srv.sudoPassword || srv.password || null, { timeout: 180000 }); });
h('notify:permission', () => Notification.isSupported());
h('notify', ({ title, body }) => { if (!Notification.isSupported()) return false;
  const n = new Notification({ title: String(title || 'Uiable Connect'), body: String(body || '') });
  n.on('click', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } }); n.show(); return true; });
h('uiable:detect', (id, port) => S(id).detectUiable ? S(id).detectUiable(port) : { reachable: false });

// ---- Uiable dashboard: one app window per server, refocused on repeat clicks. The tunnel is confirmed
// serving HTTP before anything loads, so the window never shows a dead page. 'browser' opens externally.
const uiWins = new Map(); let uiBusy = false;
const waitHttp = (port, ms = 5000) => new Promise(res => { const end = Date.now() + ms;
  const once = () => http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, r => { r.resume(); res(true); })
    .on('error', () => { if (Date.now() < end) setTimeout(once, 250); else res(false); }); once(); });
h('uiable:open', async (id, mode, port) => {
  const s = S(id); const srv = store.list().find(x => x.id === id);
  const saved = (srv.forwards || []).find(x => x.id === 'uiable') || {};
  const f = { id: 'uiable', localPort: saved.localPort || 8080, remoteHost: '127.0.0.1', remotePort: Number(port) || saved.remotePort || 8080 };
  await s.startForward(f);
  const url = `http://localhost:${f.localPort}/`;
  await waitHttp(f.localPort); // warm the tunnel so nothing ever loads an error page
  if (mode === 'browser') { shell.openExternal(url); return url; }
  const w0 = uiWins.get(id); if (w0 && !w0.isDestroyed()) { w0.focus(); return url; }
  if (uiBusy) return url; uiBusy = true;
  const w = new BrowserWindow({ width: 1360, height: 860, title: `Uiable · ${srv.name}`, backgroundColor: '#0b0d14', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false } });
  w.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
  uiWins.set(id, w); w.on('closed', () => { if (uiWins.get(id) === w) uiWins.delete(id); });
  w.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
  w.webContents.once('did-fail-load', () => { w.close(); shell.openExternal(url);
    send('ev', { id, ev: 'toast', message: 'The dashboard would not load inside the app, so it opened in your browser instead' }); });
  await w.loadURL(url).catch(() => {});
  uiBusy = false; return url;
});

// ---- self-update: Windows portable exe is replaced in place (bat file waits for us to quit, swaps and
// relaunches). macOS downloads the matching dmg to Downloads and reveals it. Other platforms open the page.
h('app:selfupdate', async () => {
  const r = await fetch('https://api.github.com/repos/AlfieeLawrence/uiable-connect/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Uiable-Connect' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('Could not reach GitHub'); const j = await r.json();
  const v = String(j.tag_name || '').replace(/^v/, ''); const assets = j.assets || [];
  const dl = async (a, dest) => { const res = await fetch(a.browser_download_url, { headers: { 'User-Agent': 'Uiable-Connect' }, signal: AbortSignal.timeout(300000) });
    if (!res.ok || !res.body) throw new Error('Download failed'); const w = fs.createWriteStream(dest);
    for await (const c of res.body) w.write(c); await new Promise((ok, no) => { w.end(ok); w.on('error', no); }); };
  if (process.platform === 'win32') {
    // Installed (nsis) app: run the new Setup exe so it upgrades in place. Portable: swap the exe next to the old one.
    const portable = !!process.env.PORTABLE_EXECUTABLE_DIR;
    const a = assets.find(x => portable ? /\.exe$/i.test(x.name) && !/setup|nsis/i.test(x.name) : /setup|nsis/i.test(x.name) && /\.exe$/i.test(x.name))
      || assets.find(x => /\.exe$/i.test(x.name));
    if (!a) throw new Error('No Windows download in the latest release');
    // A portable build runs from %TEMP%, so the real exe dir comes from PORTABLE_EXECUTABLE_DIR.
    let dir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
    if (dir.startsWith(app.getPath('temp')) || !fs.existsSync(dir) || (() => { try { fs.accessSync(dir, fs.constants.W_OK); return false; } catch { return true; } })()) dir = path.join(app.getPath('userData'), 'updates');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, a.name); await dl(a, dest);
    const old = process.env.PORTABLE_EXECUTABLE_FILE || ''; // delete the old portable exe after relaunch
    const bat = path.join(app.getPath('temp'), `uc-update-${Date.now()}.bat`);
    fs.writeFileSync(bat, `@echo off\r\ntimeout /t 2 /nobreak >nul\r\nstart "" "${dest}"\r\n${old ? `del "${old}" >nul 2>&1\r\n` : ''}del "%~f0"\r\n`);
    require('child_process').spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    setTimeout(() => app.quit(), 500);
    return { started: true, version: v };
  }
  if (process.platform === 'darwin') {
    const a = assets.find(x => /\.dmg$/i.test(x.name) && (process.arch === 'arm64' ? /arm64/i.test(x.name) : !/arm64/i.test(x.name))) || assets.find(x => /\.dmg$/i.test(x.name));
    if (!a) throw new Error('No macOS download in the latest release');
    const dest = path.join(app.getPath('downloads'), a.name); await dl(a, dest); shell.showItemInFolder(dest);
    return { downloaded: dest, version: v };
  }
  shell.openExternal(j.html_url); return { opened: true, version: v };
});

// update check: latest GitHub release (main process, so the renderer CSP stays tight)
h('app:update', async () => {
  const r = await fetch('https://api.github.com/repos/AlfieeLawrence/uiable-connect/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Uiable-Connect' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null; const j = await r.json(); return { current: app.getVersion(), latest: String(j.tag_name || '').replace(/^v/, ''), url: j.html_url };
});
const latestUiable = async () => { const r = await fetch('https://api.github.com/repos/AlfieeLawrence/uiable/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Uiable-Connect' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null; const j = await r.json(); const a = (j.assets || []).find(x => x.name === 'uiable.zip');
  return { version: String(j.tag_name || '').replace(/^v/, ''), url: a ? a.browser_download_url : null, page: j.html_url }; };
h('uiable:latest', latestUiable);
h('app:version', () => app.getVersion());
h('app:focusWin', () => { if (!win || win.isDestroyed()) return false; if (win.isMinimized()) win.restore(); win.show(); win.focus(); try { win.webContents.focus(); } catch (_) {} return true; });
h('app:info', () => ({ platform: 'desktop', os: process.platform }));
h('app:open', url => { if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url); });
h('history:list', n => hist ? hist.list(Math.min(Number(n) || 300, 2000)) : []);
h('history:clear', () => hist && hist.clear());
h('history:get', () => store.setting('history', true));
h('history:set', v => store.setSetting('history', !!v));
h('shell:open', (id, sid, c, r) => { log(id, 'shell'); return S(id).openShell(sid, c, r); });
ipcMain.on('shell:write', (_e, id, sid, d) => sessions.get(id)?.shellWrite(sid, d));
ipcMain.on('shell:resize', (_e, id, sid, c, r) => sessions.get(id)?.shellResize(sid, c, r));
ipcMain.on('shell:close', (_e, id, sid) => sessions.get(id)?.shellClose(sid));
h('fs:home', id => S(id).home());
h('fs:list', async (id, p, sudo) => { if (!sudo) return S(id).list(p); const srv = store.full(id); return sudoList(S(id), p, srv.sudoPassword || srv.password || null); });
h('fs:mkdir', (id, p) => S(id).mkdir(p));
h('fs:rename', (id, a, b) => S(id).rename(a, b));
h('fs:remove', (id, p) => { log(id, 'remove', p); return S(id).remove(p); });
h('fs:read', async (id, p, sudo) => { if (!sudo) return S(id).readText(p); const srv = store.full(id); return sudoReadText(S(id), p, srv.sudoPassword || srv.password || null); });
h('fs:write', async (id, p, t, sudo) => { if (!sudo) return S(id).writeText(p, t); log(id, 'write-sudo', p); const srv = store.full(id); return sudoWriteText(S(id), p, t, srv.sudoPassword || srv.password || null); });
const copies = new Map(); // cx -> { dead }
h('fs:cancel', cx => { const c = copies.get(cx); if (c) c.dead = true; return true; });
h('fs:copy', async (id, src, toId, dstDir, cx, sudo) => { const dst = S(toId); // same-server copy -> plain cp; otherwise relay through this app
  if (toId === id) { if (sudo) { const srv = store.full(id); return sudoCopySame(S(id), String(src), String(dstDir), srv.sudoPassword || srv.password || null); } const q = x => "'" + String(x).replace(/'/g, `'\\''`) + "'"; const r = await S(id).exec(`cp -r -- ${q(src)} ${q(dstDir)}`); if (r.code) throw new Error(r.err || 'copy failed'); return true; }
  log(id, 'copy', `${src} -> ${toId}:${dstDir}`);
  const ab = { dead: false }; if (cx) copies.set(cx, ab);
  try { return await S(id).copyTo(dst, String(src), String(dstDir), pr => send('ev', { id, ev: 'progress', cx, ...pr }), () => ab.dead); }
  finally { copies.delete(cx); } });
h('fs:downloadTo', async (id, remote, dir) => { await S(id).download(String(remote), String(dir), pr => send('ev', { id, ev: 'progress', ...pr })); log(id, 'download', remote); return dir; });
h('lfs:home', () => app.getPath('home'));
h('lfs:list', async (dir) => { const es = await fs.promises.readdir(String(dir), { withFileTypes: true });
  return es.map(e => ({ name: e.name, size: 0, mtime: 0, dir: e.isDirectory(), link: e.isSymbolicLink() })).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name)); });
// ---- utilities: LAN scan for SSH hosts, Wake-on-LAN, TCP ping, docker container list
h('net:scan', async () => { const bases = new Set();
  for (const l of Object.values(os.networkInterfaces())) for (const a of l || []) if (a.family === 'IPv4' && !a.internal) bases.add(a.address.split('.').slice(0, 3).join('.'));
  const ips = []; for (const b of [...bases].slice(0, 3)) for (let n = 1; n < 255; n++) ips.push(`${b}.${n}`);
  const found = []; const probe = ip => new Promise(res => { const s = net.connect({ host: ip, port: 22, timeout: 600 });
    const done = () => { s.destroy(); res(); }; s.once('connect', () => { found.push(ip); done(); }); s.once('error', done); s.once('timeout', done); });
  for (let i = 0; i < ips.length; i += 128) await Promise.all(ips.slice(i, i + 128).map(probe));
  return [...new Set(found)]; });
h('net:wol', id => new Promise((res, rej) => { const s = store.full(id); const mac = String(s.mac || '').replace(/[^0-9a-f]/gi, '');
  if (mac.length !== 12) return rej(new Error('Save a MAC address on this connection first'));
  const buf = Buffer.alloc(102); buf.fill(0xff, 0, 6); const m = Buffer.from(mac, 'hex'); for (let i = 0; i < 16; i++) m.copy(buf, 6 + i * 6);
  const d = require('dgram').createSocket('udp4'); d.bind(() => { d.setBroadcast(true); d.send(buf, 9, '255.255.255.255', e => { d.close(); e ? rej(e) : res(true); }); }); }));
h('net:ping', id => new Promise(r => { const s = store.full(id); if (!s.host) return r(null); const t = Date.now();
  const k = net.connect({ host: s.host, port: Number(s.port) || 22, timeout: 3000 });
  k.once('connect', () => { k.destroy(); r(Date.now() - t); }); k.once('error', () => r(null)); k.once('timeout', () => { k.destroy(); r(null); }); }));
h('docker:ps', async id => {
  const srv = store.full(id);
  return listDockerPs(S(id), { sudoPw: srv.sudoPassword || srv.password || null });
});
h('fs:upload', async (id, locals, dir, sudo) => { const srv = store.full(id); const pw = srv.sudoPassword || srv.password || null; for (const l of locals) { if (sudo) await sudoUploadPath(S(id), l, dir, pw, pr => send('ev', { id, ev: 'progress', ...pr })); else await S(id).upload(l, dir, pr => send('ev', { id, ev: 'progress', ...pr })); } log(id, sudo ? 'upload-sudo' : 'upload', `${locals.length} item(s) -> ${dir}`); return true; });
h('fs:download', async (id, remotes) => {
  const r = await dialog.showOpenDialog(win, { title: 'Download to…', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  for (const p of remotes) await S(id).download(p, r.filePaths[0], pr => send('ev', { id, ev: 'progress', ...pr }));
  log(id, 'download', `${remotes.length} item(s)`); shell.openPath(r.filePaths[0]); return r.filePaths[0];
});
