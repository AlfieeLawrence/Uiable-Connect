'use strict';
const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Session, testConnection } = require('./lib/core');
const { Store } = require('./lib/store');

// Keep it light: no GPU process work for a simple UI, single instance.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,SpareRendererForSitePerProcess');
if (!app.requestSingleInstanceLock()) app.quit();
Menu.setApplicationMenu(null);

let win, store; const sessions = new Map(); // serverId -> Session
const enc = s => safeStorage.isEncryptionAvailable() ? 'e:' + safeStorage.encryptString(s).toString('base64') : 'p:' + Buffer.from(s).toString('base64');
const dec = s => s.startsWith('e:') ? safeStorage.decryptString(Buffer.from(s.slice(2), 'base64')) : Buffer.from(s.slice(2), 'base64').toString();
const send = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); };

function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 820, minWidth: 900, minHeight: 560, backgroundColor: '#0b0d14', title: 'Uiable Connect',
    icon: path.join(__dirname, 'src', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, spellcheck: false, backgroundThrottling: true } });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  if (process.env.UC_SHOT) win.webContents.once('did-finish-load', () => require('./test/shots')(win, process.env.UC_SHOT));
}

if (process.env.UC_DATA) app.setPath('userData', process.env.UC_DATA);
app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('userData'), 'servers.json'), enc, dec);
  createWindow();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { for (const s of sessions.values()) s.end(); app.quit(); });

const S = id => { const s = sessions.get(id); if (!s || s.closed) throw new Error('Not connected'); return s; };
const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (e) { return { ok: false, error: e.message || String(e) }; } });

h('servers:list', () => store.list().map(s => ({ ...s, connected: sessions.has(s.id) && !sessions.get(s.id).closed,
  fwdStatus: sessions.has(s.id) ? (s.forwards || []).map(f => sessions.get(s.id).forwardStatus(f.id)) : [] })));
h('servers:save', s => store.upsert(s));
h('servers:delete', id => { if (sessions.has(id)) sessions.get(id).end(); sessions.delete(id); store.remove(id); });
h('servers:forwards', (id, fw) => store.setForwards(id, fw));
h('servers:test', async (s) => { // merge saved secrets if editing and fields left blank
  let full = { ...s }; if (s.id) { const saved = store.full(s.id); for (const k of ['password', 'privateKey', 'passphrase']) if (!full[k]) full[k] = saved[k]; }
  return testConnection(full);
});
h('key:pick', async () => { const r = await dialog.showOpenDialog(win, { title: 'Choose private key', properties: ['openFile', 'showHiddenFiles'] });
  if (r.canceled) return null; const p = r.filePaths[0]; return { name: path.basename(p), text: fs.readFileSync(p, 'utf8') }; });

h('conn:connect', async (id) => {
  if (sessions.has(id) && !sessions.get(id).closed) return true;
  const srv = store.full(id);
  const s = new Session(srv, (ev, d) => send('ev', { id, ev, ...d }));
  await s.connect(); sessions.set(id, s);
  for (const f of srv.forwards || []) if (f.auto) s.startForward(f).catch(e => send('ev', { id, ev: 'toast', message: e.message }));
  return true;
});
h('conn:disconnect', id => { const s = sessions.get(id); if (s) s.end(); sessions.delete(id); });
h('fwd:start', (id, f) => S(id).startForward(f));
h('fwd:stop', (id, fid) => S(id).stopForward(fid));
h('fwd:check', (port) => new Session({}).checkLocalPort(Number(port)));
h('stats', id => S(id).stats());
h('uiable:detect', (id, port) => S(id).detectUiable(port || 8080));
h('uiable:open', async (id, mode) => {
  const s = S(id); const srv = store.list().find(x => x.id === id);
  const f = (srv.forwards || []).find(x => x.id === 'uiable') || { id: 'uiable', localPort: 8080, remoteHost: '127.0.0.1', remotePort: 8080 };
  await s.startForward(f);
  const url = `http://localhost:${f.localPort}/`;
  if (mode === 'browser') shell.openExternal(url);
  else { const w = new BrowserWindow({ width: 1360, height: 860, title: `Uiable · ${srv.name}`, backgroundColor: '#0b0d14', autoHideMenuBar: true }); w.loadURL(url); }
  return url;
});
h('shell:open', (id, sid, c, r) => S(id).openShell(sid, c, r));
ipcMain.on('shell:write', (_e, id, sid, d) => sessions.get(id)?.shellWrite(sid, d));
ipcMain.on('shell:resize', (_e, id, sid, c, r) => sessions.get(id)?.shellResize(sid, c, r));
ipcMain.on('shell:close', (_e, id, sid) => sessions.get(id)?.shellClose(sid));
h('fs:home', id => S(id).home());
h('fs:list', (id, p) => S(id).list(p));
h('fs:mkdir', (id, p) => S(id).mkdir(p));
h('fs:rename', (id, a, b) => S(id).rename(a, b));
h('fs:remove', (id, p) => S(id).remove(p));
h('fs:read', (id, p) => S(id).readText(p));
h('fs:write', (id, p, t) => S(id).writeText(p, t));
h('fs:upload', async (id, locals, dir) => { for (const l of locals) await S(id).upload(l, dir, pr => send('ev', { id, ev: 'progress', ...pr })); return true; });
h('fs:download', async (id, remotes) => {
  const r = await dialog.showOpenDialog(win, { title: 'Download to…', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  for (const p of remotes) await S(id).download(p, r.filePaths[0], pr => send('ev', { id, ev: 'progress', ...pr }));
  shell.openPath(r.filePaths[0]); return r.filePaths[0];
});
