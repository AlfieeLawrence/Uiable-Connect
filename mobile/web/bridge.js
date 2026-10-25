'use strict';
// Mobile replacement for the Electron preload bridge (window.uc). Same API surface as preload.js + main.js,
// but SSH/SFTP/forwards go through the native UiableSsh Capacitor plugin and secrets live in the
// iOS Keychain / Android Keystore. In a plain browser (no Capacitor) a demo mock is used so the UI can be previewed.
(function () {
  // Show uncaught errors on screen so problems are visible on the device (no dev console there).
  const showErr = msg => { try { const t = document.getElementById('toasts'); if (!t) return setTimeout(() => showErr(msg), 300);
    const d = document.createElement('div'); d.className = 'toast err'; d.textContent = '⚠ ' + msg; d.onclick = () => d.remove(); t.append(d); setTimeout(() => d.remove(), 10000); } catch {} };
  window.addEventListener('error', e => showErr((e.message || 'Error') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '')));
  window.addEventListener('unhandledrejection', e => showErr('Unhandled: ' + ((e.reason && e.reason.message) || e.reason)));
  const Cap = window.Capacitor;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const P = native ? Cap.Plugins : {};
  const Ssh = native ? P.UiableSsh : (window.UcMock && window.UcMock.ssh);
  const listeners = [];
  const emit = d => listeners.forEach(fn => { try { fn(d); } catch (e) { console.error(e); } });
  window.UC_MOBILE = { native, platform: native ? Cap.getPlatform() : 'web' };

  // ---------- store (one JSON blob, kept encrypted by the OS keystore)
  const DEFAULT_FWD = () => ({ id: 'uiable', name: 'Uiable dashboard', localPort: 8080, remoteHost: '127.0.0.1', remotePort: 8080, builtin: true, auto: false });
  const SECRET = ['password', 'privateKey', 'passphrase', 'sudoPassword'];
  let data = null;
  async function load() {
    if (data) return data;
    try { const r = await Ssh.secretGet({ key: 'servers' }); data = r && r.value ? JSON.parse(r.value) : { servers: [] }; } catch { data = { servers: [] }; }
    return data;
  }
  const save = () => Ssh.secretSet({ key: 'servers', value: JSON.stringify(data) });
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const pub = s => { const o = { ...s }; for (const k of SECRET) { o['has_' + k] = !!s[k]; delete o[k]; } return o; };
  const full = id => { const s = data.servers.find(x => x.id === id); if (!s) throw new Error('Server not found'); return { ...s }; };

  // ---------- sessions (JS-side state; the native side owns the sockets)
  const sessions = new Map(); // id -> { forwards: Map(fid -> status), prev }
  const S = id => { const s = sessions.get(id); if (!s) throw new Error('Not connected'); return s; };
  const auth = s => ({ host: s.host, port: Number(s.port) || 22, username: s.username, hostKey: s.hostKey || '',
    ...(s.auth === 'key' ? { privateKey: s.privateKey || '', passphrase: s.passphrase || '' }
      : s.auth === 'keypass' ? { privateKey: s.privateKey || '', passphrase: s.passphrase || '', password: s.password || '' }
      : { password: s.password || '' }) });
  const sh = p => "'" + String(p).replace(/'/g, `'\\''`) + "'";
  const exec = (id, cmd, timeout = 20000) => Ssh.exec({ id, cmd, timeout });
  // audit log: events only, never keystrokes/file contents/secrets
  const hlog = async (id, ev, d) => { await load(); if ((data.settings || {}).history === false) return;
    const s = data.servers.find(x => x.id === id);
    (data.history ||= []).push({ t: Date.now(), s: id || null, n: s ? s.name || s.host : '', ev, d: String(d ?? '').slice(0, 500) });
    if (data.history.length > 500) data.history = data.history.slice(-500); await save(); };

  if (Ssh && Ssh.addListener) {
    Ssh.addListener('shellData', d => emit({ id: d.id, ev: 'shell-data', sid: d.sid, data: d.data }));
    Ssh.addListener('shellExit', d => emit({ id: d.id, ev: 'shell-exit', sid: d.sid }));
    Ssh.addListener('closed', d => { sessions.delete(d.id); emit({ id: d.id, ev: 'closed' }); });
  }

  // stats: identical command + parser to lib/core.js
  const STATS_CMD = `head -1 /proc/stat; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo; cat /proc/uptime; cat /proc/loadavg; nproc 2>/dev/null; echo ---DF; df -PkT -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | tail -n +2; echo ---HN; hostname; . /etc/os-release 2>/dev/null; echo "$PRETTY_NAME"`;
  function parseStats(txt, prev) {
    const [a, b] = txt.split('---DF\n'); const [dfTxt, hn] = (b || '').split('---HN\n');
    const L = a.trim().split('\n'); const cpuF = L[0].split(/\s+/).slice(1).map(Number);
    const idle = cpuF[3] + (cpuF[4] || 0), total = cpuF.reduce((x, y) => x + y, 0);
    let cpu = null; if (prev && total > prev.total) cpu = Math.max(0, Math.min(100, 100 * (1 - (idle - prev.idle) / (total - prev.total))));
    const mem = {}; L.forEach(l => { const m = l.match(/^(\w+):\s+(\d+)/); if (m) mem[m[1]] = Number(m[2]) * 1024; });
    const up = L.find(l => /^\d+\.\d+ \d+\.\d+$/.test(l)); const load = L.find(l => /^\d+\.\d+ \d+\.\d+ \d+\.\d+ /.test(l));
    const disks = (dfTxt || '').trim().split('\n').filter(Boolean).map(l => { const p = l.split(/\s+/); return { fs: p[0], type: p[1], size: p[2] * 1024, used: p[3] * 1024, mount: p.slice(6).join(' ') }; })
      .filter(d => d.size > 0 && !/^\/(run|boot\/efi|snap)/.test(d.mount));
    const [hostname, os] = (hn || '').trim().split('\n');
    return { cpu, cores: Number(L[L.length - 1]) || null, raw: { idle, total }, memTotal: mem.MemTotal, memUsed: mem.MemTotal - mem.MemAvailable, swapTotal: mem.SwapTotal, swapUsed: mem.SwapTotal - mem.SwapFree,
      uptime: up ? Number(up.split(' ')[0]) : null, load: load ? load.split(' ').slice(0, 3).map(Number) : null, disks, hostname, os };
  }
  const fwdStatus = (id, fid) => { const s = sessions.get(id); const f = s && s.forwards.get(fid); return f ? { id: fid, active: true, conns: 0, error: null } : { id: fid, active: false }; };
  async function startForward(id, f) {
    const s = S(id); // same id but different definition -> restart so nothing stays stale
    const ex = s.forwards.get(f.id);
    if (ex) { if (+ex.remotePort === +f.remotePort && (ex.remoteHost || '127.0.0.1') === (f.remoteHost || '127.0.0.1') && +ex.localPort === +f.localPort) return fwdStatus(id, f.id);
      s.forwards.delete(f.id); await Ssh.forwardStop({ id, fid: f.id }).catch(() => {}); }
    try { await Ssh.forwardStart({ id, fid: f.id, localPort: Number(f.localPort), remoteHost: f.remoteHost || '127.0.0.1', remotePort: Number(f.remotePort) }); }
    catch (e) { throw new Error(/in use|EADDRINUSE|bind/i.test(e.message) ? `Local port ${f.localPort} is already in use on this device` : e.message); }
    s.forwards.set(f.id, f); return fwdStatus(id, f.id);
  }
  const CHUNK = 512 * 1024;
  const b64ToBytes = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
  const bytesToB64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };

  const H = {
    'servers:list': async () => { await load(); return data.servers.map(s => ({ ...pub(s), connected: sessions.has(s.id), fwdStatus: sessions.has(s.id) ? (s.forwards || []).map(f => fwdStatus(s.id, f.id)) : [] })); },
    'servers:save': async inp => { await load(); let s = data.servers.find(x => x.id === inp.id);
      if (!s) { s = { id: uuid(), forwards: [DEFAULT_FWD()] }; data.servers.push(s); }
      for (const k of ['name', 'host', 'port', 'username', 'auth', 'keyName', 'color', 'hostKey', 'connType', 'serialPath', 'baudRate']) if (k in inp) s[k] = inp[k];
      s.port = Number(s.port) || (s.connType === 'telnet' ? 23 : 22);
      for (const k of SECRET) { if (inp[k] === null) delete s[k]; else if (typeof inp[k] === 'string' && inp[k] !== '') s[k] = inp[k]; }
      if (s.auth === 'password') { delete s.privateKey; delete s.passphrase; delete s.keyName; }
      if (s.auth === 'key') delete s.password;
      await save(); return s.id; },
    'servers:delete': async id => { await load(); if (sessions.has(id)) await H['conn:disconnect'](id); data.servers = data.servers.filter(s => s.id !== id); await save(); },
    'servers:forwards': async (id, fw) => { await load(); const s = data.servers.find(x => x.id === id); s.forwards = fw.map(f => ({ ...f, localPort: Number(f.localPort), remotePort: Number(f.remotePort) })); await save(); },
    'servers:hostkey': async (id, fp) => { await load(); const s = data.servers.find(x => x.id === id); if (!s) throw new Error('Server not found'); s.hostKey = String(fp); await save(); },
    'snippets:list': async () => { await load(); return data.snippets || []; },
    'snippets:save': async l => { await load(); data.snippets = (l || []).map(x => ({ id: String(x.id), name: String(x.name || ''), cmd: String(x.cmd || ''), serverId: x.serverId || null, sudo: !!x.sudo })); await save(); },
    'backup:export': async () => { await load(); return { servers: data.servers.map(s => ({ ...s })), snippets: data.snippets || [] }; },
    'backup:import': async (d, mode) => { await load(); const conv = s => { const o = { ...s }; for (const k of Object.keys(o)) if (k.startsWith('has_') || k === 'connected' || k === 'fwdStatus') delete o[k];
        o.id = String(o.id || uuid()); o.port = Number(o.port) || 22; o.forwards = Array.isArray(o.forwards) ? o.forwards : []; return o; };
      const inc = d.servers.map(conv), sn = (d.snippets || []).map(x => ({ id: String(x.id), name: String(x.name || ''), cmd: String(x.cmd || ''), serverId: x.serverId || null }));
      if (mode === 'replace') { for (const id of [...sessions.keys()]) await H['conn:disconnect'](id); data.servers = inc; data.snippets = sn; }
      else { for (const s of inc) { const i = data.servers.findIndex(x => x.id === s.id); if (i >= 0) data.servers[i] = s; else data.servers.push(s); }
        const cur = data.snippets || []; for (const x of sn) { const i = cur.findIndex(y => y.id === x.id); if (i >= 0) cur[i] = x; else cur.push(x); } data.snippets = cur; }
      await save(); return inc.length; },
    // backups: written to the app cache then handed to the share sheet (Save to Files, Drive, AirDrop...)
    'file:save': async (name, text) => { const FS = P.Filesystem; if (!FS) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text])); a.download = name; a.click(); return name; }
      await FS.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' }); const { uri } = await FS.getUri({ path: name, directory: 'CACHE' });
      await P.Share.share({ title: 'Save backup', files: [uri] }); return name; },
    'servers:alerts': async (id, rules) => { await load(); const s = data.servers.find(x => x.id === id); if (!s) throw new Error('Server not found');
      s.alerts = rules.map(r => ({ ...r, threshold: Number(r.threshold) || 0, forSec: Number(r.forSec) || 0, cooldownMin: Number(r.cooldownMin) || 0, enabled: !!r.enabled })); await save(); },
    'exec': (id, cmd, timeout) => { S(id); return exec(id, String(cmd), Math.min(Number(timeout) || 20000, 180000)); },
    // alerts -> @capacitor/local-notifications (shows while the app is open/backgrounded; the app does not poll when it's closed)
    'notify:permission': async () => { const LN = P.LocalNotifications; if (!LN) return false; const r = await LN.requestPermissions(); return r.display === 'granted'; },
    'notify': async ({ title, body }) => { const LN = P.LocalNotifications; if (!LN) return false;
      const p = await LN.checkPermissions(); if (p.display !== 'granted' && (await LN.requestPermissions()).display !== 'granted') return false;
      await LN.schedule({ notifications: [{ id: Math.floor(Math.random() * 2e9), title: String(title || 'Uiable Connect'), body: String(body || '') }] }); return true; },
    'servers:test': async s => { await load(); const f = { ...s }; if (s.id) { const saved = full(s.id); for (const k of SECRET) if (!f[k]) f[k] = saved[k]; }
      const r = await Ssh.test(auth(f)); return { ok: true, info: r.info }; },
    'key:pick': () => new Promise(res => { const i = document.createElement('input'); i.type = 'file';
      i.onchange = () => { const f = i.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => res({ name: f.name, text: r.result }); r.readAsText(f); }; i.click(); }),
    'conn:connect': async id => { await load(); if (sessions.has(id)) return true; const srv = full(id);
      if (srv.connType && srv.connType !== 'ssh') throw new Error(`${srv.connType} connections aren't supported on phones/tablets`);
      await Ssh.connect({ id, ...auth(srv) }); sessions.set(id, { forwards: new Map(), prev: null });
      await hlog(id, 'connected', `${srv.username || ''}@${srv.host}:${srv.port}`);
      for (const f of srv.forwards || []) if (f.auto) startForward(id, f).catch(e => emit({ id, ev: 'toast', message: e.message }));
      return true; },
    'conn:disconnect': async id => { sessions.delete(id); await hlog(id, 'disconnected'); await Ssh.disconnect({ id }).catch(() => {}); },
    'fwd:start': (id, f) => { hlog(id, 'forward-start', `${f.name || f.id} :${f.localPort} -> ${f.remoteHost}:${f.remotePort}`); return startForward(id, f); },
    'fwd:stop': async (id, fid) => { const s = sessions.get(id); if (s) { s.forwards.delete(fid); hlog(id, 'forward-stop', fid); await Ssh.forwardStop({ id, fid }).catch(() => {}); } return { id: fid, active: false }; },
    'fwd:check': port => Ssh.portFree({ port: Number(port) }),
    'stats': async id => { const s = S(id); const r = await exec(id, STATS_CMD, 10000); const x = parseStats(r.out, s.prev); s.prev = x.raw; delete x.raw; return x; },
    // Uiable is identified by /api/state on every listening port (+ the port in /opt/uiable/.env),
    // not just "something on 8080" — same probe as lib/core.js detectUiable
    'uiable:detect': async (id, port) => {
      const extra = Number(port) > 0 ? Number(port) : '';
      const r = await exec(id, `
probe() { (curl -fs -m 2 "http://$1/api/state" 2>/dev/null || wget -qO- -T 2 "http://$1/api/state" 2>/dev/null) | head -c 1500 | tr '\\n' ' '; }
EP=$(sed -n 's/^UIABLE_PORT=//p' /opt/uiable/.env 2>/dev/null | tail -1)
EB=$(sed -n 's/^UIABLE_BIND=//p' /opt/uiable/.env 2>/dev/null | tail -1)
case "$EB" in 0.0.0.0|::|'') EB=127.0.0.1;; esac
O=""
for HP in $EB:$EP 127.0.0.1:$EP 127.0.0.1:${extra}; do O=$(probe $HP); [ -n "$O" ] && break; done
if [ -z "$O" ]; then
  if command -v ss >/dev/null 2>&1; then L=$(ss -tlnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -un)
  elif command -v netstat >/dev/null 2>&1; then L=$(netstat -tln 2>/dev/null | awk 'NR>2{print $4}' | sed 's/.*://' | sort -un); fi
  for P in $(echo 8080 $L | tr ' ' '\\n' | sort -un | head -14); do
    ( Q=$(probe 127.0.0.1:$P); [ -n "$Q" ] && echo "@@127.0.0.1:$P $Q" ) &
  done; wait
else echo "@@$EB:$EP $O"; fi`, 15000).catch(() => ({ out: '' }));
      let found = null;
      for (const l of (r.out || '').split('\n')) {
        const m = l.match(/^@@(\S+)\s+(\{.*)/); if (!m || found) continue;
        if (!/"version"\s*:/.test(m[2]) && !/uiable/i.test(m[2])) continue;
        const v = m[2].match(/"version"\s*:\s*"([^"]+)"/); found = { port: Number(m[1].split(':').pop()), version: v ? v[1] : null };
      }
      return { reachable: !!found, isUiable: !!found, version: found && found.version, port: found ? found.port : (extra || 8080) }; },
    'uiable:open': async (id, mode, port) => { await load(); const srv = data.servers.find(x => x.id === id);
      const saved = (srv.forwards || []).find(x => x.id === 'uiable') || {};
      const f = { id: 'uiable', localPort: saved.localPort || 8080, remoteHost: '127.0.0.1', remotePort: Number(port) || saved.remotePort || 8080 };
      await startForward(id, f); const url = `http://127.0.0.1:${f.localPort}/`;
      if (native && P.Browser) await P.Browser.open({ url, presentationStyle: 'fullscreen', toolbarColor: '#0b0d14' }); else window.open(url);
      return url; },
    'app:update': async () => { const r = await fetch('https://api.github.com/repos/AlfieeLawrence/uiable-connect/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return null; const j = await r.json(); return { current: window.UC_VERSION || '0.0.0', latest: String(j.tag_name || '').replace(/^v/, ''), url: j.html_url }; },
    'uiable:latest': async () => { const r = await fetch('https://api.github.com/repos/AlfieeLawrence/uiable/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return null; const j = await r.json(); const a = (j.assets || []).find(x => x.name === 'uiable.zip');
      return { version: String(j.tag_name || '').replace(/^v/, ''), url: a ? a.browser_download_url : null, page: j.html_url }; },
    'app:version': async () => window.UC_VERSION || '0.0.0',
    'app:info': async () => ({ platform: 'mobile', os: native ? Cap.getPlatform() : 'web' }),
    'app:selfupdate': async () => { const url = 'https://github.com/AlfieeLawrence/uiable-connect/releases/latest'; if (native && P.Browser) await P.Browser.open({ url }); else window.open(url); return { opened: true }; },
    'serial:list': async () => { throw new Error('Serial connections are not supported on phones/tablets'); },
    // sudo: the password file is opened by the shell then deleted; sudo reads it from the still-open fd.
    // With a saved password this never touches the JS side.
    'sudo:exec': async (id, cmd, pw) => { await load(); const srv = full(id); const usePw = pw || srv.sudoPassword || srv.password;
      if (!usePw) return exec(id, `sudo -n sh -c ${sh(cmd)}`, 180000);
      const home = (await Ssh.sftpRealpath({ id, path: '.' }).catch(() => ({ path: '~' }))).path;
      const dir = home + '/.uiable-connect', pf = dir + '/.p';
      try { await exec(id, `mkdir -p -m 700 ${sh(dir)}`, 15000);
        await Ssh.sftpWrite({ id, path: pf, data: bytesToB64(new TextEncoder().encode(usePw + '\n')), append: false });
        const r = await exec(id, `exec 3< ${sh(pf)}; rm -f ${sh(pf)}; sudo -S -p '' sh -c ${sh(cmd)} <&3`, 180000);
        if (r.code && /incorrect|try again|Sorry/i.test(r.err || '')) throw new Error('Wrong sudo password');
        return r; }
      finally { exec(id, `rm -f ${sh(pf)}`, 10000).catch(() => {}); } },
    // server -> server copy, relayed through the app in 512 KB chunks (never on disk)
    'fs:copy': async (id, src, toId, dstDir) => { S(toId); await load();
      if (toId === id) { const r = await exec(id, `cp -r -- ${sh(src)} ${sh(dstDir)}`); if (r.code) throw new Error(r.err || 'copy failed'); return true; }
      const st = await Ssh.sftpStat({ id, path: src }); const name = src.replace(/\/+$/, '').split('/').pop();
      const dest = (dstDir.endsWith('/') ? dstDir : dstDir + '/') + name;
      if (st.dir) { await Ssh.sftpMkdir({ id: toId, path: dest }).catch(() => {});
        const { items } = await Ssh.sftpList({ id, path: src });
        for (const i of items) await H['fs:copy'](id, src.replace(/\/+$/, '') + '/' + i.name, toId, dest); return dest; }
      await Ssh.sftpWrite({ id: toId, path: dest, data: '', append: false });
      let off = 0; do { const r = await Ssh.sftpRead({ id, path: src, offset: off, length: CHUNK });
        if (r.data) await Ssh.sftpWrite({ id: toId, path: dest, data: r.data, append: off > 0 });
        off += r.bytes; emit({ id, ev: 'progress', name, t: off, tot: st.size }); if (!r.bytes) break; } while (off < st.size);
      return dest; },
    // audit log: events only, never keystrokes/file contents/secrets
    'history:list': async n => { await load(); return (data.history || []).slice(-Math.min(Number(n) || 300, 2000)).reverse(); },
    'history:clear': async () => { await load(); data.history = []; await save(); },
    'history:get': async () => { await load(); return (data.settings || {}).history !== false; },
    'history:set': async v => { await load(); (data.settings ||= {}).history = !!v; await save(); },
    'app:open': async url => { if (!/^https:\/\/github\.com\//.test(url)) return; if (native && P.Browser) await P.Browser.open({ url }); else window.open(url); },
    'shell:open': async (id, sid, cols, rows) => { S(id); await Ssh.shellOpen({ id, sid, cols, rows }); return sid; },
    'fs:home': async id => (await Ssh.sftpRealpath({ id, path: '.' }).catch(() => ({ path: '/' }))).path,
    'fs:list': async (id, p) => (await Ssh.sftpList({ id, path: p })).items.map(i => ({ name: i.name, size: i.size, mtime: i.mtime * 1000, mode: i.mode,
      dir: (i.mode & 0o170000) === 0o040000, link: (i.mode & 0o170000) === 0o120000 })).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name)),
    'fs:mkdir': (id, p) => Ssh.sftpMkdir({ id, path: p }).then(() => true),
    'fs:rename': (id, a, b) => Ssh.sftpRename({ id, from: a, to: b }).then(() => true),
    'fs:remove': async (id, p) => { const r = await exec(id, `rm -rf -- ${sh(p)}`); if (r.code) throw new Error(r.err || 'rm failed'); return true; },
    'fs:read': async (id, p) => { const st = await Ssh.sftpStat({ id, path: p }); if (st.size > 2 * 1024 * 1024) throw new Error('File is larger than 2 MB, download it instead');
      const r = await Ssh.sftpRead({ id, path: p, offset: 0, length: st.size }); const u = b64ToBytes(r.data);
      if (u.includes(0)) throw new Error('This looks like a binary file'); return new TextDecoder().decode(u); },
    'fs:write': (id, p, t) => Ssh.sftpWrite({ id, path: p, data: bytesToB64(new TextEncoder().encode(t)), append: false }).then(() => true),
    // Mobile upload: File objects from <input type=file> (photos, Files app, Drive...) streamed in 512 KB chunks
    'fs:upload': async (id, files, dir) => { for (const f of files) {
      const dest = (dir.endsWith('/') ? dir : dir + '/') + f.name; let off = 0;
      if (!f.size) await Ssh.sftpWrite({ id, path: dest, data: '', append: false });
      while (off < f.size) { const u = new Uint8Array(await f.slice(off, off + CHUNK).arrayBuffer());
        await Ssh.sftpWrite({ id, path: dest, data: bytesToB64(u), append: off > 0 }); off += u.length;
        emit({ id, ev: 'progress', name: f.name, t: off, tot: f.size }); } } return true; },
    // Mobile download: saved to the app cache then handed to the share sheet ("Save to Files", Drive, AirDrop...)
    'fs:download': async (id, remotes) => { const out = [];
      for (let p of remotes) { let name = p.split('/').pop() || 'download', tmp = null;
        const st = await Ssh.sftpStat({ id, path: p });
        if (st.dir) { tmp = `/tmp/uc-${Date.now()}.tar.gz`; const r = await exec(id, `tar -C ${sh(p.replace(/\/[^/]+\/?$/, '') || '/')} -czf ${tmp} -- ${sh(name)}`, 600000);
          if (r.code) throw new Error(r.err || 'tar failed'); name += '.tar.gz'; p = tmp; st.size = (await Ssh.sftpStat({ id, path: tmp })).size; }
        const FS = P.Filesystem; let off = 0; await FS.writeFile({ path: name, data: '', directory: 'CACHE' });
        do { const r = await Ssh.sftpRead({ id, path: p, offset: off, length: CHUNK }); if (r.data) await FS.appendFile({ path: name, data: r.data, directory: 'CACHE' });
          off += r.bytes; emit({ id, ev: 'progress', name, t: off, tot: st.size }); if (!r.bytes) break; } while (off < st.size);
        if (tmp) exec(id, `rm -f ${tmp}`).catch(() => {});
        out.push((await FS.getUri({ path: name, directory: 'CACHE' })).uri); }
      await P.Share.share({ title: 'Save download', files: out }); return 'share sheet'; },
  };
  const SEND = {
    'shell:write': (id, sid, data) => Ssh.shellWrite({ id, sid, data }),
    'shell:resize': (id, sid, cols, rows) => Ssh.shellResize({ id, sid, cols, rows }),
    'shell:close': (id, sid) => Ssh.shellClose({ id, sid }),
  };
  window.uc = {
    call: async (ch, ...a) => { if (!H[ch]) throw new Error('Not supported on mobile: ' + ch);
      try { return await H[ch](...a); } catch (e) { throw new Error((e && (e.message || e.errorMessage)) || String(e)); } },
    send: (ch, ...a) => { const f = SEND[ch]; if (f) Promise.resolve(f(...a)).catch(() => {}); },
    on: fn => listeners.push(fn),
    pathFor: f => f, // mobile passes File objects straight to fs:upload
  };
})();
