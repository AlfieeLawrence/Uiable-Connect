'use strict';
// Mobile replacement for the Electron preload bridge (window.uc). Same API surface as preload.js + main.js,
// but SSH/SFTP/forwards go through the native UiableSsh Capacitor plugin and secrets live in the
// iOS Keychain / Android Keystore. In a plain browser (no Capacitor) a demo mock is used so the UI can be previewed.
(function () {
  const Cap = window.Capacitor;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const P = native ? Cap.Plugins : {};
  const Ssh = native ? P.UiableSsh : (window.UcMock && window.UcMock.ssh);
  const listeners = [];
  const emit = d => listeners.forEach(fn => { try { fn(d); } catch (e) { console.error(e); } });
  window.UC_MOBILE = { native, platform: native ? Cap.getPlatform() : 'web' };

  // ---------- store (one JSON blob, kept encrypted by the OS keystore)
  const DEFAULT_FWD = () => ({ id: 'uiable', name: 'Uiable dashboard', localPort: 8080, remoteHost: '127.0.0.1', remotePort: 8080, builtin: true, auto: false });
  const SECRET = ['password', 'privateKey', 'passphrase'];
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
  const auth = s => ({ host: s.host, port: Number(s.port) || 22, username: s.username,
    ...(s.auth === 'key' ? { privateKey: s.privateKey || '', passphrase: s.passphrase || '' } : { password: s.password || '' }) });
  const sh = p => "'" + String(p).replace(/'/g, `'\\''`) + "'";
  const exec = (id, cmd, timeout = 20000) => Ssh.exec({ id, cmd, timeout });

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
    const s = S(id); if (s.forwards.has(f.id)) return fwdStatus(id, f.id);
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
      for (const k of ['name', 'host', 'port', 'username', 'auth', 'keyName', 'color']) if (k in inp) s[k] = inp[k];
      s.port = Number(s.port) || 22;
      for (const k of SECRET) { if (inp[k] === null) delete s[k]; else if (typeof inp[k] === 'string' && inp[k] !== '') s[k] = inp[k]; }
      if (s.auth === 'password') { delete s.privateKey; delete s.passphrase; delete s.keyName; } else delete s.password;
      await save(); return s.id; },
    'servers:delete': async id => { await load(); if (sessions.has(id)) await H['conn:disconnect'](id); data.servers = data.servers.filter(s => s.id !== id); await save(); },
    'servers:forwards': async (id, fw) => { await load(); const s = data.servers.find(x => x.id === id); s.forwards = fw.map(f => ({ ...f, localPort: Number(f.localPort), remotePort: Number(f.remotePort) })); await save(); },
    'servers:test': async s => { await load(); const f = { ...s }; if (s.id) { const saved = full(s.id); for (const k of SECRET) if (!f[k]) f[k] = saved[k]; }
      const r = await Ssh.test(auth(f)); return { ok: true, info: r.info }; },
    'key:pick': () => new Promise(res => { const i = document.createElement('input'); i.type = 'file';
      i.onchange = () => { const f = i.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => res({ name: f.name, text: r.result }); r.readAsText(f); }; i.click(); }),
    'conn:connect': async id => { await load(); if (sessions.has(id)) return true; const srv = full(id);
      await Ssh.connect({ id, ...auth(srv) }); sessions.set(id, { forwards: new Map(), prev: null });
      for (const f of srv.forwards || []) if (f.auto) startForward(id, f).catch(e => emit({ id, ev: 'toast', message: e.message }));
      return true; },
    'conn:disconnect': async id => { sessions.delete(id); await Ssh.disconnect({ id }).catch(() => {}); },
    'fwd:start': (id, f) => startForward(id, f),
    'fwd:stop': async (id, fid) => { const s = sessions.get(id); if (s) { s.forwards.delete(fid); await Ssh.forwardStop({ id, fid }).catch(() => {}); } return { id: fid, active: false }; },
    'fwd:check': port => Ssh.portFree({ port: Number(port) }),
    'stats': async id => { const s = S(id); const r = await exec(id, STATS_CMD, 10000); const x = parseStats(r.out, s.prev); s.prev = x.raw; delete x.raw; return x; },
    'uiable:detect': async (id, port = 8080) => {
      const r = await exec(id, `(curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}/ 2>/dev/null || wget -q -T 3 -O /dev/null -S http://127.0.0.1:${port}/ 2>&1 | awk '/HTTP\\//{print $2}' | tail -1); echo; (curl -s -m 3 http://127.0.0.1:${port}/ 2>/dev/null || wget -q -T 3 -O - http://127.0.0.1:${port}/ 2>/dev/null) | grep -io '<title>[^<]*' | head -1`).catch(() => ({ out: '' }));
      const [code, title] = r.out.trim().split('\n'); const up = /^[23]\d\d$/.test((code || '').trim());
      return { reachable: up, isUiable: up && /uiable/i.test(title || ''), title: (title || '').replace(/<title>/i, ''), port }; },
    'uiable:open': async (id, mode) => { await load(); const srv = data.servers.find(x => x.id === id);
      const f = (srv.forwards || []).find(x => x.id === 'uiable') || DEFAULT_FWD();
      await startForward(id, f); const url = `http://127.0.0.1:${f.localPort}/`;
      if (native && P.Browser) await P.Browser.open({ url, presentationStyle: 'fullscreen', toolbarColor: '#0b0d14' }); else window.open(url);
      return url; },
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
