'use strict';
// Uiable Connect for Docker: serves the same UI (../src) as a web app and implements the window.uc channels over
// HTTP (POST /api/call, /api/send) + Server-Sent Events (/api/events), backed by lib/core.js (ssh2). No extra deps.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const { Session, testConnection } = require('../lib/core');
const { Store } = require('../lib/store');
const VERSION = require('../package.json').version;
const DATA = process.env.UC_DATA || '/data', PORT = Number(process.env.PORT || 8484), BIND = process.env.UC_BIND || '0.0.0.0';
const FWD_BIND = process.env.UC_FWD_BIND || '0.0.0.0'; // forwards listen inside the container; publish the ports in compose
const PASSWORD = process.env.UC_PASSWORD || '';
const ALLOWED = (process.env.UC_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
fs.mkdirSync(DATA, { recursive: true });

// ---- secrets: AES-256-GCM with UC_SECRET (any string) or a random key kept in the volume
let KEY;
if (process.env.UC_SECRET) KEY = crypto.createHash('sha256').update(process.env.UC_SECRET).digest();
else { const kf = path.join(DATA, 'secret.key'); try { KEY = Buffer.from(fs.readFileSync(kf, 'utf8').trim(), 'base64'); } catch {}
  if (!KEY || KEY.length !== 32) { KEY = crypto.randomBytes(32); fs.writeFileSync(kf, KEY.toString('base64'), { mode: 0o600 }); } }
const enc = s => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv); const ct = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return 'g:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); };
const dec = s => { if (!s.startsWith('g:')) throw new Error('Unknown secret format'); const b = Buffer.from(s.slice(2), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); };
const store = new Store(path.join(DATA, 'servers.json'), enc, dec);

// ---- sessions + events
const sessions = new Map(), clients = new Set();
const emit = d => { const line = `data: ${JSON.stringify(d)}\n\n`; for (const r of clients) r.write(line); };
const S = id => { const s = sessions.get(id); if (!s || s.closed) throw new Error('Not connected'); return s; };
const latestUiable = async () => { const r = await fetch('https://api.github.com/repos/AlfieeLawrence/uiable/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Uiable-Connect' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null; const j = await r.json(); const a = (j.assets || []).find(x => x.name === 'uiable.zip');
  return { version: String(j.tag_name || '').replace(/^v/, ''), url: a ? a.browser_download_url : null, page: j.html_url }; };
const H = {
  'servers:list': () => store.list().map(s => ({ ...s, connected: sessions.has(s.id) && !sessions.get(s.id).closed, fwdStatus: sessions.has(s.id) ? (s.forwards || []).map(f => sessions.get(s.id).forwardStatus(f.id)) : [] })),
  'servers:save': s => store.upsert(s),
  'servers:delete': id => { if (sessions.has(id)) sessions.get(id).end(); sessions.delete(id); store.remove(id); },
  'servers:forwards': (id, fw) => store.setForwards(id, fw),
  'servers:hostkey': (id, fp) => store.setHostKey(id, fp),
  'servers:alerts': (id, r) => store.setAlerts(id, r),
  'servers:test': s => { const full = { ...s }; if (s.id) { const saved = store.full(s.id); for (const k of ['password', 'privateKey', 'passphrase']) if (!full[k]) full[k] = saved[k]; } return testConnection(full); },
  'snippets:list': () => store.snippets(), 'snippets:save': l => store.setSnippets(l),
  'backup:export': () => store.exportAll(),
  'backup:import': (d, mode) => { if (mode === 'replace') { for (const s of sessions.values()) s.end(); sessions.clear(); } return store.importAll(d, mode); },
  'conn:connect': async id => { if (sessions.has(id) && !sessions.get(id).closed) return true; const srv = store.full(id);
    const s = new Session(srv, (ev, d) => emit({ id, ev, ...d })); await s.connect(); sessions.set(id, s);
    for (const f of srv.forwards || []) if (f.auto) s.startForward({ ...f, bind: FWD_BIND }).catch(e => emit({ id, ev: 'toast', message: e.message }));
    return true; },
  'conn:disconnect': id => { const s = sessions.get(id); if (s) s.end(); sessions.delete(id); },
  'fwd:start': (id, f) => S(id).startForward({ ...f, bind: FWD_BIND }),
  'fwd:stop': (id, fid) => S(id).stopForward(fid),
  'fwd:check': port => new Session({}).checkLocalPort(Number(port), FWD_BIND),
  'stats': id => S(id).stats(),
  'exec': (id, cmd, t) => S(id).exec(String(cmd), { timeout: Math.min(Number(t) || 20000, 180000) }),
  'uiable:detect': (id, port) => S(id).detectUiable(port || 8080),
  'uiable:latest': latestUiable,
  'uiable:open': async id => { const srv = store.list().find(x => x.id === id);
    const f = (srv.forwards || []).find(x => x.id === 'uiable') || { id: 'uiable', localPort: 8080, remoteHost: '127.0.0.1', remotePort: 8080 };
    await S(id).startForward({ ...f, bind: FWD_BIND }); return { port: f.localPort }; },
  'app:update': async () => { const r = await fetch('https://api.github.com/repos/AlfieeLawrence/uiable-connect/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Uiable-Connect' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null; const j = await r.json(); return { current: VERSION, latest: String(j.tag_name || '').replace(/^v/, ''), url: j.html_url }; },
  'app:version': () => VERSION,
  'shell:open': (id, sid, c, r) => S(id).openShell(sid, c, r),
  'fs:home': id => S(id).home(), 'fs:list': (id, p) => S(id).list(p), 'fs:mkdir': (id, p) => S(id).mkdir(p),
  'fs:rename': (id, a, b) => S(id).rename(a, b), 'fs:remove': (id, p) => S(id).remove(p),
  'fs:read': (id, p) => S(id).readText(p), 'fs:write': (id, p, t) => S(id).writeText(p, t),
};
const SEND = { 'shell:write': (id, sid, d) => sessions.get(id)?.shellWrite(sid, d), 'shell:resize': (id, sid, c, r) => sessions.get(id)?.shellResize(sid, c, r), 'shell:close': (id, sid) => sessions.get(id)?.shellClose(sid) };

// ---- auth (optional UC_PASSWORD) + host/origin checks (DNS rebinding, CSRF)
const TOKEN = PASSWORD ? crypto.createHmac('sha256', KEY).update('login:' + PASSWORD).digest('base64url') : '';
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(a => a.length === 2));
const sha = x => crypto.createHash('sha256').update(String(x)).digest();
const authed = req => !PASSWORD || crypto.timingSafeEqual(sha(cookies(req).uc_auth || ''), sha(TOKEN));
const hostOk = req => { const h = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return PASSWORD || ['localhost', '127.0.0.1', '::1'].includes(h) || ALLOWED.includes(h); };
const originOk = req => { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host; } catch { return false; } };
const fails = new Map(); // ip -> [count, until]

// ---- static UI
const SRC = path.join(__dirname, '..', 'src'), WEB = path.join(__dirname, 'web');
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const INDEX = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8')
  .replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">')
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replace('<script src="app.js"></script>', '<script src="web-bridge.js"></script><script src="app.js"></script>');
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.github.com; frame-ancestors 'none'";
const LOGIN = err => `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Uiable Connect</title><link rel="stylesheet" href="base.css"></head>
<body style="display:grid;place-items:center;min-height:100vh"><form method="post" action="login" class="card" style="width:320px"><h3>Uiable Connect</h3>${err ? '<p class="pill err">Wrong password</p>' : ''}<label class="field"><span>Password</span><input type="password" name="password" autofocus></label><button class="primary" style="width:100%;justify-content:center">Sign in</button></form></body></html>`;
const head = (res, code, type, extra = {}) => res.writeHead(code, { 'Content-Type': type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache', ...extra });
const body = (req, max = 64 * 1024 * 1024) => new Promise((ok, no) => { const b = []; let n = 0; req.on('data', c => { n += c.length; if (n > max) { no(new Error('Too large')); req.destroy(); } else b.push(c); }); req.on('end', () => ok(Buffer.concat(b))); req.on('error', no); });
const json = (res, code, o) => { head(res, code, 'application/json'); res.end(JSON.stringify(o)); };

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'); const p = u.pathname;
    if (!hostOk(req)) { res.writeHead(403); return res.end('Host not allowed. Set UC_PASSWORD, or add the name to UC_ALLOWED_HOSTS.'); }
    if (req.method !== 'GET' && !originOk(req)) { res.writeHead(403); return res.end('Bad origin'); }
    if (p === '/login' && PASSWORD) {
      if (req.method === 'POST') { const ip = req.socket.remoteAddress; const f = fails.get(ip) || [0, 0];
        if (f[1] > Date.now()) { head(res, 429, 'text/plain'); return res.end('Too many attempts, wait a minute'); }
        const pw = new URLSearchParams((await body(req, 4096)).toString()).get('password') || '';
        const ok = crypto.timingSafeEqual(crypto.createHash('sha256').update(pw).digest(), crypto.createHash('sha256').update(PASSWORD).digest());
        if (!ok) { f[0]++; if (f[0] >= 5) { f[0] = 0; f[1] = Date.now() + 60000; } fails.set(ip, f); head(res, 401, 'text/html; charset=utf-8'); return res.end(LOGIN(true)); }
        fails.delete(ip); res.writeHead(303, { Location: './', 'Set-Cookie': `uc_auth=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` }); return res.end(); }
      head(res, 200, 'text/html; charset=utf-8'); return res.end(LOGIN(false)); }
    const pub = p === '/base.css' || p === '/favicon.svg';
    if (!pub && !authed(req)) { if (p.startsWith('/api/')) return json(res, 401, { ok: false, error: 'Signed out' }); res.writeHead(303, { Location: '/login' }); return res.end(); }
    if (p === '/api/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.write(': hi\n\n');
      clients.add(res); const t = setInterval(() => res.write(': ping\n\n'), 25000); req.on('close', () => { clearInterval(t); clients.delete(res); }); return; }
    if (p === '/api/call' && req.method === 'POST') { const { ch, a } = JSON.parse((await body(req, 16 * 1024 * 1024)).toString());
      const fn = Object.prototype.hasOwnProperty.call(H, ch) && H[ch]; if (!fn) return json(res, 404, { ok: false, error: 'Unknown channel ' + ch });
      try { return json(res, 200, { ok: true, data: await fn(...(Array.isArray(a) ? a : [])) }); } catch (e) { return json(res, 200, { ok: false, error: e.message || String(e) }); } }
    if (p === '/api/send' && req.method === 'POST') { for (const [ch, ...a] of JSON.parse((await body(req, 4 * 1024 * 1024)).toString())) { const f = Object.prototype.hasOwnProperty.call(SEND, ch) && SEND[ch]; if (f) f(...a); } res.writeHead(204); return res.end(); }
    if (p === '/api/upload' && req.method === 'POST') { const id = u.searchParams.get('id'), dest = u.searchParams.get('path'); const sftp = await S(id).sftp();
      const tot = Number(req.headers['content-length']) || 0; let t = 0, last = 0; const name = dest.split('/').pop();
      await new Promise((ok, no) => { const w = sftp.createWriteStream(dest); w.on('error', no); w.on('close', ok); req.on('data', c => { t += c.length; if (Date.now() - last > 300) { last = Date.now(); emit({ id, ev: 'progress', name, t, tot }); } }); req.pipe(w); });
      return json(res, 200, { ok: true, data: true }); }
    if (p === '/api/download') { const id = u.searchParams.get('id'), rp = u.searchParams.get('path'); const s = S(id); const name = path.posix.basename(rp) || 'download';
      if (await s.isDir(rp)) { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ucd-')); try { await s.download(rp, tmp);
          res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.tar.gz"` });
          const t = require('child_process').spawn('tar', ['-C', tmp, '-czf', '-', name]); t.stdout.pipe(res); await new Promise(r => t.on('close', r)); } finally { fs.rmSync(tmp, { recursive: true, force: true }); } return; }
      const sftp = await s.sftp(); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` });
      sftp.createReadStream(rp).on('error', () => res.destroy()).pipe(res); return; }
    // static files
    let f = p === '/' ? '/index.html' : p; if (f === '/index.html') { head(res, 200, TYPES['.html']); return res.end(INDEX); }
    const name = path.basename(f); const file = [path.join(WEB, name), path.join(SRC, name)].find(x => fs.existsSync(x) && path.dirname(f) === '/');
    if (!file) { res.writeHead(404); return res.end('Not found'); }
    head(res, 200, TYPES[path.extname(file)] || 'application/octet-stream'); fs.createReadStream(file).pipe(res);
  } catch (e) { if (!res.headersSent) json(res, 500, { ok: false, error: e.message }); else res.destroy(); }
});
server.listen(PORT, BIND, () => {
  console.log(`Uiable Connect ${VERSION} (web) listening on ${BIND}:${PORT} inside the container, data in ${DATA}`);
  if (!PASSWORD) console.warn('WARNING: UC_PASSWORD is not set. Anyone who can reach this port can use your saved servers. Publish it only on 127.0.0.1 (the compose default), or set UC_PASSWORD before exposing it.' + (ALLOWED.length ? ' UC_ALLOWED_HOSTS is set: ' + ALLOWED.join(', ') : ''));
});
const stop = () => { for (const s of sessions.values()) s.end(); process.exit(0); }; process.on('SIGTERM', stop); process.on('SIGINT', stop);
