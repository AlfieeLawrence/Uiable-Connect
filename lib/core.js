'use strict';
// Pure Node SSH core (no Electron) so it can be tested headless.
const { Client } = require('ssh2');
const net = require('net');
const fs = require('fs');
const path = require('path');
const posix = path.posix;

function connectOpts(s) {
  const o = { host: s.host, port: Number(s.port) || 22, username: s.username, readyTimeout: 15000, keepaliveInterval: 20000, keepaliveCountMax: 3 };
  if (s.auth === 'key') { o.privateKey = s.privateKey; if (s.passphrase) o.passphrase = s.passphrase; }
  else { o.password = s.password; o.tryKeyboard = true; }
  return o;
}

function openClient(s) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    let done = false;
    c.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => s.password || '')));
    c.once('ready', () => { done = true; resolve(c); });
    c.once('error', (e) => { if (!done) { done = true; reject(e); } });
    try { c.connect(connectOpts(s)); } catch (e) { reject(e); }
  });
}

function exec(c, cmd, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    c.exec(cmd, (err, st) => {
      if (err) return reject(err);
      let out = '', errOut = '', t = setTimeout(() => { st.close(); reject(new Error('Command timed out')); }, timeout);
      st.on('data', d => out += d).stderr.on('data', d => errOut += d);
      st.on('close', (code) => { clearTimeout(t); resolve({ code, out, err: errOut }); });
    });
  });
}

const STATS_CMD = `head -1 /proc/stat; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo; cat /proc/uptime; cat /proc/loadavg; nproc 2>/dev/null; echo ---DF; df -PkT -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | tail -n +2; echo ---HN; hostname; . /etc/os-release 2>/dev/null; echo "$PRETTY_NAME"`;

function parseStats(txt, prev) {
  const [a, b] = txt.split('---DF\n');
  const [dfTxt, hn] = (b || '').split('---HN\n');
  const L = a.trim().split('\n');
  const cpuF = L[0].split(/\s+/).slice(1).map(Number);
  const idle = cpuF[3] + (cpuF[4] || 0), total = cpuF.reduce((x, y) => x + y, 0);
  let cpu = null;
  if (prev && total > prev.total) cpu = Math.max(0, Math.min(100, 100 * (1 - (idle - prev.idle) / (total - prev.total))));
  const mem = {}; L.forEach(l => { const m = l.match(/^(\w+):\s+(\d+)/); if (m) mem[m[1]] = Number(m[2]) * 1024; });
  const up = L.find(l => /^\d+\.\d+ \d+\.\d+$/.test(l)); const load = L.find(l => /^\d+\.\d+ \d+\.\d+ \d+\.\d+ /.test(l));
  const cores = Number(L[L.length - 1]) || null;
  const disks = (dfTxt || '').trim().split('\n').filter(Boolean).map(l => { const p = l.split(/\s+/); return { fs: p[0], type: p[1], size: p[2] * 1024, used: p[3] * 1024, mount: p.slice(6).join(' ') }; })
    .filter(d => d.size > 0 && !/^\/(run|boot\/efi|snap)/.test(d.mount));
  const [hostname, os] = (hn || '').trim().split('\n');
  return { cpu, cores, raw: { idle, total }, memTotal: mem.MemTotal, memUsed: mem.MemTotal - mem.MemAvailable, swapTotal: mem.SwapTotal, swapUsed: mem.SwapTotal - mem.SwapFree,
    uptime: up ? Number(up.split(' ')[0]) : null, load: load ? load.split(' ').slice(0, 3).map(Number) : null, disks, hostname, os };
}

class Session {
  constructor(server, emit) { this.server = server; this.emit = emit || (() => {}); this.forwards = new Map(); this.shells = new Map(); this._sftp = null; this.prevCpu = null; }
  async connect() {
    this.client = await openClient(this.server);
    this.client.on('close', () => { this.closed = true; for (const f of this.forwards.values()) f.server.close(); this.forwards.clear(); this.emit('closed', {}); });
    this.client.on('error', e => this.emit('error', { message: e.message }));
    return this;
  }
  end() { for (const f of this.forwards.values()) f.server.close(); this.forwards.clear(); try { this.client.end(); } catch {} }
  exec(cmd, o) { return exec(this.client, cmd, o); }
  sftp() { if (this._sftp) return Promise.resolve(this._sftp);
    return new Promise((res, rej) => this.client.sftp((e, s) => { if (e) return rej(e); this._sftp = s; s.on('close', () => this._sftp = null); res(s); })); }

  async stats() { const r = await this.exec(STATS_CMD, { timeout: 10000 }); const s = parseStats(r.out, this.prevCpu); this.prevCpu = s.raw; delete s.raw; return s; }

  async detectUiable(port = 8080) {
    const r = await this.exec(`(curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}/ 2>/dev/null || wget -q -T 3 -O /dev/null -S http://127.0.0.1:${port}/ 2>&1 | awk '/HTTP\\//{print $2}' | tail -1); echo; (curl -s -m 3 http://127.0.0.1:${port}/ 2>/dev/null || wget -q -T 3 -O - http://127.0.0.1:${port}/ 2>/dev/null) | grep -io '<title>[^<]*' | head -1`).catch(() => ({ out: '' }));
    const [code, title] = r.out.trim().split('\n');
    const up = /^[23]\d\d$/.test((code || '').trim());
    return { reachable: up, isUiable: up && /uiable/i.test(title || ''), title: (title || '').replace(/<title>/i, ''), port };
  }

  // ---- port forwarding: local listener -> forwardOut over SSH
  checkLocalPort(port, bind = '127.0.0.1') {
    return new Promise(res => { const s = net.createServer(); s.once('error', e => res({ free: false, error: e.code })); s.listen(port, bind, () => s.close(() => res({ free: true }))); });
  }
  startForward(f) {
    return new Promise((resolve, reject) => {
      if (this.forwards.has(f.id)) return resolve(this.forwardStatus(f.id));
      const bind = f.bind || '127.0.0.1';
      const st = { id: f.id, conns: 0, bytes: 0, error: null };
      const srv = net.createServer(sock => {
        st.conns++;
        this.client.forwardOut(sock.remoteAddress || '127.0.0.1', sock.remotePort || 0, f.remoteHost || '127.0.0.1', Number(f.remotePort), (err, ch) => {
          if (err) { st.error = err.message; this.emit('forward', { ...st }); sock.destroy(); st.conns--; return; }
          sock.pipe(ch).pipe(sock);
          const fin = () => { st.conns = Math.max(0, st.conns - 1); };
          ch.on('close', () => { sock.destroy(); }); sock.on('close', fin); sock.on('error', () => ch.close());
        });
      });
      srv.once('error', e => { this.forwards.delete(f.id); reject(new Error(e.code === 'EADDRINUSE' ? `Local port ${f.localPort} is already in use on this PC` : e.message)); });
      srv.listen(Number(f.localPort), bind, () => { this.forwards.set(f.id, { server: srv, st, def: f }); resolve(this.forwardStatus(f.id)); });
    });
  }
  stopForward(id) { const f = this.forwards.get(id); if (f) { f.server.close(); this.forwards.delete(id); } return { id, active: false }; }
  forwardStatus(id) { const f = this.forwards.get(id); return f ? { id, active: true, conns: f.st.conns, error: f.st.error } : { id, active: false }; }

  // ---- interactive shells
  openShell(id, cols, rows) {
    return new Promise((res, rej) => this.client.shell({ term: 'xterm-256color', cols, rows }, (e, st) => {
      if (e) return rej(e);
      this.shells.set(id, st);
      st.on('data', d => this.emit('shell-data', { sid: id, data: d.toString('utf8') }));
      st.stderr.on('data', d => this.emit('shell-data', { sid: id, data: d.toString('utf8') }));
      st.on('close', () => { this.shells.delete(id); this.emit('shell-exit', { sid: id }); });
      res(id);
    }));
  }
  shellWrite(id, d) { const s = this.shells.get(id); if (s) s.write(d); }
  shellResize(id, cols, rows) { const s = this.shells.get(id); if (s) s.setWindow(rows, cols, 0, 0); }
  shellClose(id) { const s = this.shells.get(id); if (s) s.close(); }

  // ---- SFTP
  async home() { const s = await this.sftp(); return new Promise((r) => s.realpath('.', (e, p) => r(e ? '/' : p))); }
  async list(dir) {
    const s = await this.sftp();
    const items = await new Promise((r, j) => s.readdir(dir, (e, l) => e ? j(e) : r(l)));
    return items.map(i => ({ name: i.filename, size: i.attrs.size, mtime: i.attrs.mtime * 1000, mode: i.attrs.mode,
      dir: (i.attrs.mode & 0o170000) === 0o040000, link: (i.attrs.mode & 0o170000) === 0o120000 }))
      .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
  }
  async isDir(p) { const s = await this.sftp(); return new Promise(r => s.stat(p, (e, st) => r(!e && st.isDirectory()))); }
  async mkdir(p) { const s = await this.sftp(); return new Promise((r, j) => s.mkdir(p, e => e ? j(e) : r(true))); }
  async rename(a, b) { const s = await this.sftp(); return new Promise((r, j) => s.rename(a, b, e => e ? j(e) : r(true))); }
  async remove(p) {
    // recursive delete; use rm -rf via exec for dirs (much faster than walking SFTP)
    if (await this.isDir(p)) { const q = p.replace(/'/g, `'\\''`); const r = await this.exec(`rm -rf -- '${q}'`); if (r.code) throw new Error(r.err || 'rm failed'); return true; }
    const s = await this.sftp(); return new Promise((r, j) => s.unlink(p, e => e ? j(e) : r(true)));
  }
  async readText(p, max = 2 * 1024 * 1024) {
    const s = await this.sftp();
    const st = await new Promise((r, j) => s.stat(p, (e, x) => e ? j(e) : r(x)));
    if (st.size > max) throw new Error('File is larger than 2 MB, download it instead');
    const buf = await new Promise((r, j) => s.readFile(p, (e, b) => e ? j(e) : r(b)));
    if (buf.includes(0)) throw new Error('This looks like a binary file');
    return buf.toString('utf8');
  }
  async writeText(p, txt) { const s = await this.sftp(); return new Promise((r, j) => s.writeFile(p, txt, e => e ? j(e) : r(true))); }
  async upload(local, remoteDir, onProg) {
    const s = await this.sftp(); const name = path.basename(local); const dest = posix.join(remoteDir, name);
    const st = fs.statSync(local);
    if (st.isDirectory()) { await this.mkdir(dest).catch(() => {}); for (const n of fs.readdirSync(local)) await this.upload(path.join(local, n), dest, onProg); return dest; }
    await new Promise((r, j) => s.fastPut(local, dest, { step: (t, _c, tot) => onProg && onProg({ name, t, tot }) }, e => e ? j(e) : r()));
    return dest;
  }
  async download(remote, localDir, onProg) {
    const s = await this.sftp(); const name = posix.basename(remote); const dest = path.join(localDir, name);
    if (await this.isDir(remote)) { fs.mkdirSync(dest, { recursive: true }); for (const i of await this.list(remote)) await this.download(posix.join(remote, i.name), dest, onProg); return dest; }
    await new Promise((r, j) => s.fastGet(remote, dest, { step: (t, _c, tot) => onProg && onProg({ name, t, tot }) }, e => e ? j(e) : r()));
    return dest;
  }
}

async function testConnection(server) {
  const c = await openClient(server);
  try { const r = await exec(c, 'uname -sr; hostname'); return { ok: true, info: r.out.trim().replace('\n', ' · ') }; }
  finally { c.end(); }
}

module.exports = { Session, testConnection, parseStats, openClient };
