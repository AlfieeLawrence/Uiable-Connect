'use strict';
// Pure Node SSH core (no Electron) so it can be tested headless.
const { Client } = require('ssh2');
const net = require('net');
const fs = require('fs');
const path = require('path');
const posix = path.posix;
const crypto = require('crypto');
// OpenSSH-style fingerprint of the raw host key blob: SHA256:base64 (no padding)
const fingerprint = blob => 'SHA256:' + crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');

function connectOpts(s) {
  const o = { host: s.host, port: Number(s.port) || 22, username: s.username, readyTimeout: 15000, keepaliveInterval: 20000, keepaliveCountMax: 3 };
  // 'keypass' = key first, password fallback (ssh2 tries every method it has credentials for)
  if (s.auth === 'key' || s.auth === 'keypass') { o.privateKey = s.privateKey; if (s.passphrase) o.passphrase = s.passphrase; }
  if (s.auth === 'password' || s.auth === 'keypass') { o.password = s.password; o.tryKeyboard = true; }
  return o;
}

function openClient(s) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    let done = false, hk = null;
    c.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => s.password || '')));
    c.once('ready', () => { done = true; resolve(c); });
    c.once('error', (e) => { if (!done) { done = true; reject(hk ? new Error(hk) : e); } });
    // Trust on first use: no saved key -> HOSTKEY_UNKNOWN, different key -> HOSTKEY_CHANGED. Checked before any auth is sent.
    const hostVerifier = key => { const fp = fingerprint(key); if (s.hostKey && s.hostKey === fp) return true; hk = (s.hostKey ? 'HOSTKEY_CHANGED ' : 'HOSTKEY_UNKNOWN ') + fp; return false; };
    try { c.connect({ ...connectOpts(s), hostVerifier }); } catch (e) { reject(e); }
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
    this.client.on('close', () => { this.closed = true; for (const f of this.forwards.values()) this._killForward(f); this.forwards.clear(); this.emit('closed', {}); });
    this.client.on('error', e => this.emit('error', { message: e.message }));
    return this;
  }
  _killForward(f) { f.server.close(); for (const sock of f.st.socks) sock.destroy(); f.st.socks.clear(); }
  end() { for (const f of this.forwards.values()) this._killForward(f); this.forwards.clear(); try { this.client.end(); } catch {} }
  exec(cmd, o) { return exec(this.client, cmd, o); }
  sftp() { if (this._sftp) return Promise.resolve(this._sftp);
    return new Promise((res, rej) => this.client.sftp((e, s) => { if (e) return rej(e); this._sftp = s; s.on('close', () => this._sftp = null); res(s); })); }

  async stats() { const r = await this.exec(STATS_CMD, { timeout: 10000 }); const s = parseStats(r.out, this.prevCpu); this.prevCpu = s.raw; delete s.raw; return s; }

  // Uiable is identified by its /api/state JSON, not just "something listens on 8080" — any other web
  // app on that port won't answer it. Every listening TCP port is probed, plus the port in
  // /opt/uiable/.env, so a Uiable on a custom port is still found.
  async detectUiable(port) {
    const extra = Number(port) > 0 ? Number(port) : '';
    const r = await this.exec(String.raw`
EP=$(sed -n 's/^UIABLE_PORT=//p' /opt/uiable/.env 2>/dev/null | tail -1)
EB=$(sed -n 's/^UIABLE_BIND=//p' /opt/uiable/.env 2>/dev/null | tail -1)
case "$EB" in 0.0.0.0|::|'') EB=127.0.0.1;; esac
PS="127.0.0.1:$EP $EB:$EP 127.0.0.1:8080 127.0.0.1:${extra}"
if command -v ss >/dev/null 2>&1; then L=$(ss -tlnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -un)
elif command -v netstat >/dev/null 2>&1; then L=$(netstat -tln 2>/dev/null | awk 'NR>2{print $4}' | sed 's/.*://' | sort -un); fi
for P in $L; do PS="$PS 127.0.0.1:$P"; done
# probe all candidates in parallel so the whole check takes ~2s, not 3s x N ports
for HP in $(echo $PS | tr ' ' '\n' | sort -u | head -16); do
  ( O=$( (curl -fs -m 2 "http://$HP/api/state" 2>/dev/null || wget -qO- -T 2 "http://$HP/api/state" 2>/dev/null) | head -c 1500 | tr '\n' ' ');
    [ -n "$O" ] && echo "@@$HP $O" ) &
done; wait`, { timeout: 15000 }).catch(() => ({ out: '' }));
    let found = null;
    for (const l of (r.out || '').split('\n')) {
      const m = l.match(/^@@(\S+)\s+(\{.*)/); if (!m || found) continue;
      // /api/state returns JSON containing "version" (and usually "uiable"); either marker is enough
      if (!/"version"\s*:/.test(m[2]) && !/uiable/i.test(m[2])) continue;
      const v = m[2].match(/"version"\s*:\s*"([^"]+)"/);
      found = { port: Number(m[1].split(':').pop()), version: v ? v[1] : null };
    }
    return { reachable: !!found, isUiable: !!found, version: found && found.version, port: found ? found.port : (extra || 8080) };
  }

  // ---- port forwarding: local listener -> forwardOut over SSH
  checkLocalPort(port, bind = '127.0.0.1') {
    return new Promise(res => { const s = net.createServer(); s.once('error', e => res({ free: false, error: e.code })); s.listen(port, bind, () => s.close(() => res({ free: true }))); });
  }
  startForward(f) {
    return new Promise((resolve, reject) => {
      // Same id but different definition (e.g. the Uiable port changed) -> restart so nothing stays stale.
      const ex = this.forwards.get(f.id);
      if (ex) { if (ex.def.remoteHost === (f.remoteHost || '127.0.0.1') && +ex.def.remotePort === +f.remotePort && +ex.def.localPort === +f.localPort) return resolve(this.forwardStatus(f.id));
        this.stopForward(f.id); }
      const bind = f.bind || '127.0.0.1';
      const st = { id: f.id, conns: 0, bytes: 0, error: null, socks: new Set() };
      const srv = net.createServer(sock => {
        st.conns++; st.socks.add(sock); sock.on('close', () => st.socks.delete(sock));
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
  stopForward(id) { const f = this.forwards.get(id); if (f) { this._killForward(f); this.forwards.delete(id); } return { id, active: false }; }
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

  // Server -> server copy, relayed through this app (never on disk). dstSession is another connected Session.
  async copyTo(dstSession, remote, dstDir, onProg) {
    const name = posix.basename(remote.replace(/\/+$/, '')); const dest = posix.join(dstDir, name);
    if (await this.isDir(remote)) { await dstSession.mkdir(dest).catch(() => {}); for (const i of await this.list(remote)) await this.copyTo(dstSession, posix.join(remote, i.name), dest, onProg); return dest; }
    const s = await this.sftp(), d = await dstSession.sftp();
    const rd = s.createReadStream(remote), wr = d.createWriteStream(dest);
    let t = 0; rd.on('data', c => { t += c.length; onProg && onProg({ name, t, tot: 0 }); });
    await new Promise((r, j) => { rd.on('error', j); wr.on('error', j); wr.on('close', r); rd.pipe(wr); });
    return dest;
  }
}

// sudo for things that need a password: the password goes to sudo's stdin through a file descriptor,
// never on a command line (it would show in `ps`) and never into a log. The password file lives in a
// 0700 dir, is opened by the shell, deleted immediately, and sudo reads it from the still-open fd.
const shq = x => "'" + String(x).replace(/'/g, `'\\''`) + "'";
async function sudoExec(sess, cmd, pw, opts) {
  if (pw == null) { const r = await sess.exec(`sudo -n sh -c ${shq(cmd)}`, opts); // root or passwordless sudo
    if (r.code && /password is required|a password is required|no tty|Sorry/i.test(r.err || '')) throw new Error('sudo password required'); return r; }
  const dir = (await sess.home()) + '/.uiable-connect', pf = dir + '/.p';
  try {
    await sess.exec(`mkdir -p -m 700 ${shq(dir)}`, { timeout: 15000 });
    await sess.writeText(pf, pw + '\n');
    const r = await sess.exec(`exec 3< ${shq(pf)}; rm -f ${shq(pf)}; sudo -S -p '' sh -c ${shq(cmd)} <&3`, opts);
    if (r.code && /incorrect|try again|Sorry/i.test(r.err || '')) throw new Error('Wrong sudo password');
    return r;
  } finally { sess.exec(`rm -f ${shq(pf)}`, { timeout: 10000 }).catch(() => {}); }
}

// ---- telnet: one TCP socket per shell tab, minimal IAC negotiation (refuse all options)
class TelnetSession {
  constructor(server, emit) { this.server = server; this.emit = emit || (() => {}); this.shells = new Map(); }
  connect() { this.closed = false; return Promise.resolve(this); }
  end() { this.closed = true; for (const s of this.shells.values()) s.destroy(); this.shells.clear(); }
  _socket(sid) {
    const s = net.connect({ host: this.server.host, port: Number(this.server.port) || 23 });
    // tiny telnet state machine: refuse every option negotiation, skip sub-negotiations, unescape IAC IAC
    let iac = 0, verb = 0; // 0 data, 1 got IAC, 2 got IAC+verb (option byte next), 3 in sub-negotiation, 4 SB+got IAC
    s.on('data', d => { const out = []; const rep = [];
      for (const b of d) {
        if (iac === 1) {
          if (b === 255) { out.push(b); iac = 0; } else if (b === 250) iac = 3;
          else if (b === 240 || b === 241 || b === 249) iac = 0; else { verb = b; iac = 2; } continue; }
        if (iac === 2) { // refuse every option: DO->WONT, WILL->DONT; DONT/WONT need no reply
          if (verb === 253) rep.push(255, 252, b); else if (verb === 251) rep.push(255, 254, b); iac = 0; continue; }
        if (iac === 3) { if (b === 255) iac = 4; continue; }
        if (iac === 4) { iac = b === 240 ? 0 : 3; continue; }
        if (b === 255) { iac = 1; continue; }
        out.push(b);
      }
      if (rep.length) s.write(Buffer.from(rep));
      if (out.length) this.emit('shell-data', { sid, data: Buffer.from(out).toString('utf8') }); });
    s.on('close', () => { this.shells.delete(sid); this.emit('shell-exit', { sid }); if (!this.shells.size) { this.closed = true; this.emit('closed', {}); } });
    s.on('error', e => this.emit('error', { message: e.message }));
    return s;
  }
  openShell(sid) { const s = this._socket(sid); this.shells.set(sid, s); return new Promise((res, rej) => { s.once('connect', () => res(sid)); s.once('error', rej); }); }
  shellWrite(sid, d) { const s = this.shells.get(sid); if (s) s.write(d); }
  shellResize() {}
  shellClose(sid) { const s = this.shells.get(sid); if (s) s.destroy(); }
}

// ---- serial (USB and Bluetooth SPP — a paired Bluetooth device shows up as a COM port).
// Desktop only: the optional `serialport` package is lazy-required so Docker/mobile builds don't need it.
function serialLib() { try { return require('serialport'); } catch { return null; } }
async function listSerial() { const L = serialLib(); if (!L) throw new Error('Serial support is not available in this build');
  return (await L.SerialPort.list()).map(p => ({ path: p.path, name: p.friendlyName || p.description || p.path })); }
class SerialSession {
  constructor(server, emit) { this.server = server; this.emit = emit || (() => {}); this.shells = new Map(); this.port = null; }
  connect() {
    const L = serialLib(); if (!L) return Promise.reject(new Error('Serial support is not available in this build'));
    return new Promise((res, rej) => {
      this.port = new L.SerialPort({ path: this.server.serialPath, baudRate: Number(this.server.baudRate) || 115200, autoOpen: false });
      this.port.open(e => { if (e) return rej(new Error(e.message));
        this.port.on('data', d => { const t = d.toString('utf8'); for (const sid of this.shells.keys()) this.emit('shell-data', { sid, data: t }); });
        this.port.on('close', () => { this.closed = true; this.emit('closed', {}); for (const sid of this.shells.keys()) this.emit('shell-exit', { sid }); this.shells.clear(); });
        this.port.on('error', e => this.emit('error', { message: e.message }));
        this.closed = false; res(this); });
    });
  }
  end() { this.closed = true; try { this.port && this.port.isOpen && this.port.close(); } catch {} this.shells.clear(); }
  openShell(sid) { this.shells.set(sid, true); return Promise.resolve(sid); }
  shellWrite(sid, d) { if (this.shells.has(sid) && this.port && this.port.isOpen) this.port.write(d); }
  shellResize() {}
  shellClose(sid) { this.shells.delete(sid); }
}

function makeSession(server, emit) {
  if (server.connType === 'telnet') return new TelnetSession(server, emit);
  if (server.connType === 'serial') return new SerialSession(server, emit);
  return new Session(server, emit);
}

async function testConnection(server) {
  if (server.connType === 'telnet') {
    return new Promise((res, rej) => { const s = net.connect({ host: server.host, port: Number(server.port) || 23 });
      const t = setTimeout(() => { s.destroy(); rej(new Error('Connection timed out')); }, 10000);
      s.once('connect', () => { clearTimeout(t); s.end(); res({ ok: true, info: 'Telnet port reachable' }); });
      s.once('error', e => { clearTimeout(t); rej(e); }); });
  }
  if (server.connType === 'serial') {
    const L = serialLib(); if (!L) throw new Error('Serial support is not available in this build');
    return new Promise((res, rej) => { const p = new L.SerialPort({ path: server.serialPath, baudRate: Number(server.baudRate) || 115200, autoOpen: false });
      p.open(e => { if (e) return rej(new Error(e.message)); p.close(() => res({ ok: true, info: 'Serial port opened' })); }); });
  }
  const c = await openClient(server);
  try { const r = await exec(c, 'uname -sr; hostname'); return { ok: true, info: r.out.trim().replace('\n', ' · ') }; }
  finally { c.end(); }
}

module.exports = { Session, TelnetSession, SerialSession, makeSession, testConnection, parseStats, openClient, fingerprint, sudoExec, shq, listSerial };
