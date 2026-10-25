'use strict';
// Saved servers on disk. Secrets (password, privateKey, passphrase) are encrypted with the injected
// encrypt/decrypt functions (Electron safeStorage = Windows DPAPI, tied to your Windows login).
const fs = require('fs');
const crypto = require('crypto');
const SECRET = ['password', 'privateKey', 'passphrase', 'sudoPassword'];
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
    for (const k of ['name', 'host', 'port', 'username', 'auth', 'keyName', 'color', 'hostKey', 'connType', 'serialPath', 'baudRate']) if (k in inp) s[k] = inp[k];
    s.port = Number(s.port) || (s.connType === 'telnet' ? 23 : 22);
    for (const k of SECRET) { if (inp[k] === null) delete s[k]; else if (typeof inp[k] === 'string' && inp[k] !== '') s[k] = this.enc(inp[k]); }
    if (s.auth === 'password') { delete s.privateKey; delete s.passphrase; delete s.keyName; }
    if (s.auth === 'key') delete s.password;
    // 'keypass' keeps both: the key is tried first, the password is the fallback (and vice versa per server config)
    this.save(); return s.id;
  }
  remove(id) { this.data.servers = this.data.servers.filter(s => s.id !== id); this.save(); }
  setForwards(id, fw) { const s = this.data.servers.find(x => x.id === id); s.forwards = fw.map(f => ({ ...f, localPort: Number(f.localPort), remotePort: Number(f.remotePort) })); this.save(); }
}
Store.prototype.setHostKey = function (id, fp) { const s = this.data.servers.find(x => x.id === id); if (!s) throw new Error('Server not found');
  if (!/^SHA256:[A-Za-z0-9+/]+$/.test(fp)) throw new Error('Bad fingerprint'); s.hostKey = fp; this.save(); };
// snippets: [{ id, name, cmd, serverId|null }] (serverId null = global)
Store.prototype.snippets = function () { return this.data.snippets || []; };
Store.prototype.setSnippets = function (list) { this.data.snippets = cleanSnippets(list); this.save(); };
const cleanSnippets = l => (Array.isArray(l) ? l : []).slice(0, 500).map(x => ({ id: String(x.id), name: String(x.name || '').slice(0, 200), cmd: String(x.cmd || '').slice(0, 20000), serverId: x.serverId ? String(x.serverId) : null, sudo: !!x.sudo }));
// backups: plain objects with decrypted secrets; encryption to .ucbackup happens in the UI (WebCrypto)
Store.prototype.exportAll = function () { return { servers: this.data.servers.map(s => this.full(s.id)), snippets: this.snippets() }; };
Store.prototype.importAll = function (d, mode) { return importInto(this.data, d, mode, this.enc) && (this.save(), d.servers.length); };
// shared by desktop + Docker (mobile has the same logic in bridge.js)
function importInto(data, d, mode, enc) {
  if (!d || !Array.isArray(d.servers)) throw new Error('Backup has no servers');
  const conv = s => { const o = { ...s }; delete o.connected; delete o.fwdStatus; for (const k of SECRET) { if (o[k]) o[k] = enc(String(o[k])); else delete o[k]; } for (const k of Object.keys(o)) if (k.startsWith('has_')) delete o[k];
    o.id = String(o.id || crypto.randomUUID()); o.port = Number(o.port) || 22; o.forwards = Array.isArray(o.forwards) ? o.forwards : []; return o; };
  const inc = d.servers.map(conv);
  if (mode === 'replace') { data.servers = inc; data.snippets = cleanSnippets(d.snippets); return true; }
  for (const s of inc) { const i = data.servers.findIndex(x => x.id === s.id); if (i >= 0) data.servers[i] = s; else data.servers.push(s); }
  const sn = data.snippets || []; for (const x of cleanSnippets(d.snippets)) { const i = sn.findIndex(y => y.id === x.id); if (i >= 0) sn[i] = x; else sn.push(x); } data.snippets = sn; return true;
}
// alert rules live with the server entry (no secrets in them)
Store.prototype.setAlerts = function (id, rules) { const s = this.data.servers.find(x => x.id === id); if (!s) throw new Error('Server not found');
  s.alerts = cleanAlerts(rules); this.save(); };
const cleanAlerts = rules => (Array.isArray(rules) ? rules : []).slice(0, 30).map(r => ({ id: String(r.id), metric: String(r.metric), mount: String(r.mount || ''),
  threshold: Number(r.threshold) || 0, forSec: Number(r.forSec) || 0, cooldownMin: Number(r.cooldownMin) || 0, enabled: !!r.enabled }));
// simple app settings (history on/off etc.); no secrets ever go here
Store.prototype.setting = function (k, d) { const v = (this.data.settings || {})[k]; return v === undefined ? d : v; };
Store.prototype.setSetting = function (k, v) { (this.data.settings ||= {})[k] = v; this.save(); };
module.exports = { Store, DEFAULT_FWD, cleanAlerts, importInto };
