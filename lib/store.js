'use strict';
// Saved servers on disk. Secrets (password, privateKey, passphrase) are encrypted with the injected
// encrypt/decrypt functions (Electron safeStorage = Windows DPAPI, tied to your Windows login).
const fs = require('fs');
const crypto = require('crypto');
const SECRET = ['password', 'privateKey', 'passphrase'];
const DEFAULT_FWD = () => ({ id: 'uiable', name: 'Uiable dashboard', localPort: 8080, remoteHost: '127.0.0.1', remotePort: 8080, builtin: true, auto: false });

class Store {
  constructor(file, enc, dec) { this.file = file; this.enc = enc; this.dec = dec; this.data = { servers: [] };
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} }
  save() { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 1)); fs.renameSync(this.file + '.tmp', this.file); }
  // public view: no secrets, only flags
  list() { return this.data.servers.map(s => { const o = { ...s }; for (const k of SECRET) { o['has_' + k] = !!s[k]; delete o[k]; } return o; }); }
  full(id) { const s = this.data.servers.find(x => x.id === id); if (!s) throw new Error('Server not found');
    const o = { ...s }; for (const k of SECRET) if (s[k]) o[k] = this.dec(s[k]); return o; }
  upsert(inp) {
    let s = this.data.servers.find(x => x.id === inp.id);
    if (!s) { s = { id: crypto.randomUUID(), forwards: [DEFAULT_FWD()] }; this.data.servers.push(s); }
    for (const k of ['name', 'host', 'port', 'username', 'auth', 'keyName', 'color']) if (k in inp) s[k] = inp[k];
    s.port = Number(s.port) || 22;
    for (const k of SECRET) { if (inp[k] === null) delete s[k]; else if (typeof inp[k] === 'string' && inp[k] !== '') s[k] = this.enc(inp[k]); }
    if (s.auth === 'password') { delete s.privateKey; delete s.passphrase; delete s.keyName; } else delete s.password;
    this.save(); return s.id;
  }
  remove(id) { this.data.servers = this.data.servers.filter(s => s.id !== id); this.save(); }
  setForwards(id, fw) { const s = this.data.servers.find(x => x.id === id); s.forwards = fw.map(f => ({ ...f, localPort: Number(f.localPort), remotePort: Number(f.remotePort) })); this.save(); }
}
module.exports = { Store, DEFAULT_FWD };
