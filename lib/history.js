'use strict';
// Audit/activity log. By design it can never contain secrets: it records events only —
// no terminal input/output, no file contents, and command lines are run through redact()
// which strips password/secret-looking arguments before they touch the disk.
const fs = require('fs');
const path = require('path');

const SECRETISH = /((?:pass(?:word|wd|phrase)?|secret|token|api[-_]?key|private[-_]?key|sudo)\s*[=:]\s*)(\S+)|((?:-p|--password(?:=|\s+)|mysql\s+-p)\s*)(\S+)/gi;
const redact = s => String(s ?? '').replace(SECRETISH, (m, a, _b, c) => (a || c) + '••••').slice(0, 500);

class History {
  constructor(dir, maxLines = 5000) { this.dir = dir; this.maxLines = maxLines; }
  file() { return path.join(this.dir, 'history.jsonl'); }
  add(serverId, serverName, ev, detail) {
    const line = JSON.stringify({ t: Date.now(), s: serverId || null, n: serverName || '', ev, d: detail === undefined ? '' : redact(detail) });
    try { fs.mkdirSync(this.dir, { recursive: true }); fs.appendFileSync(this.file(), line + '\n'); this.trim(); } catch {}
  }
  trim() {
    try {
      const f = this.file(); const txt = fs.readFileSync(f, 'utf8'); const lines = txt.split('\n');
      if (lines.length > this.maxLines) { const tmp = f + '.tmp'; fs.writeFileSync(tmp, lines.slice(-this.maxLines).join('\n')); fs.renameSync(tmp, f); }
    } catch {}
  }
  list(limit = 300) {
    try {
      const lines = fs.readFileSync(this.file(), 'utf8').split('\n').filter(Boolean);
      return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
    } catch { return []; }
  }
  clear() { try { fs.rmSync(this.file(), { force: true }); } catch {} }
}
module.exports = { History, redact };
