'use strict';
// Encrypted backups (.ucbackup), identical format on desktop, mobile and Docker (WebCrypto only):
// PBKDF2-SHA256 (600k iterations) -> AES-256-GCM. Contains servers (with passwords/keys), forwards, alerts, host keys, snippets.
const UCB = { format: 'uiable-connect-backup', v: 1, iter: 600000 };
const b64e = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function ucbKey(pw, salt, iter) {
  if (!globalThis.crypto?.subtle) throw new Error('Encryption needs a secure context (https or localhost)');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function ucbEncrypt(obj, pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const head = { format: UCB.format, v: UCB.v, kdf: 'PBKDF2-SHA256', iter: UCB.iter, cipher: 'AES-256-GCM', salt: b64e(salt), iv: b64e(iv), created: new Date().toISOString() };
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(head.format + ':' + head.v) }, await ucbKey(pw, salt, head.iter), new TextEncoder().encode(JSON.stringify(obj)));
  return JSON.stringify({ ...head, data: b64e(new Uint8Array(ct)) });
}
async function ucbDecrypt(text, pw) {
  let f; try { f = JSON.parse(text); } catch { throw new Error('Not a Uiable Connect backup file'); }
  if (f.format !== UCB.format || f.v !== 1 || f.kdf !== 'PBKDF2-SHA256' || !(f.iter >= 100000 && f.iter <= 5e6)) throw new Error('Not a Uiable Connect backup file (or a newer version)');
  try { const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(f.iv), additionalData: new TextEncoder().encode(f.format + ':' + f.v) }, await ucbKey(pw, b64d(f.salt), f.iter), b64d(f.data));
    return JSON.parse(new TextDecoder().decode(pt)); }
  catch { throw new Error('Wrong password or damaged file'); }
}
function backupDialog() {
  const m = el(`<div class="modal-bg"><div class="modal" style="width:520px"><header><h3 class="grow">Backup &amp; restore</h3></header><div class="body">
    <p class="muted small">An encrypted <span class="mono">.ucbackup</span> file with all servers (including passwords and keys), forwards, alerts, trusted host keys and snippets. It opens on Windows, macOS, iPhone/iPad, Android and the Docker version.</p>
    <label class="field"><span>Backup password (at least 8 characters, you need it to restore)</span><input type="password" id="bpw" autocomplete="new-password"></label>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="primary" id="bex">Export backup…</button><span class="spacer"></span>
      <div class="seg"><button data-m="merge" class="active">Merge</button><button data-m="replace">Replace all</button></div><button id="bim">Import…</button></div>
    <p class="muted small" id="bmh" style="margin-top:8px">Merge adds servers from the file and updates ones with the same id.</p></div>
    <footer><span class="spacer"></span><button id="c">Close</button></footer></div></div>`);
  document.body.append(m); let mode = 'merge';
  m.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { mode = b.dataset.m; m.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('active', x === b));
    m.querySelector('#bmh').textContent = mode === 'merge' ? 'Merge adds servers from the file and updates ones with the same id.' : 'Replace removes every saved server and snippet here first.'; });
  const pw = () => { const p = m.querySelector('#bpw').value; if (p.length < 8) { toast('Use a backup password of at least 8 characters', true); return null; } return p; };
  m.querySelector('#c').onclick = () => m.remove();
  m.querySelector('#bex').onclick = async () => { const p = pw(); if (!p) return;
    try { const data = await uc.call('backup:export'); const txt = await ucbEncrypt({ app: 'uiable-connect', ...data }, p);
      const name = `uiable-connect-${new Date().toISOString().slice(0, 10)}.ucbackup`; const r = await uc.call('file:save', name, txt); if (r) toast('Backup saved'); } catch (e) { toast(e.message, true); } };
  m.querySelector('#bim').onclick = () => { const p = pw(); if (!p) return; const i = document.createElement('input'); i.type = 'file'; i.accept = '.ucbackup,application/json,*/*';
    i.onchange = async () => { const f = i.files[0]; if (!f) return;
      try { const d = await ucbDecrypt(await f.text(), p); if (!Array.isArray(d.servers)) throw new Error('Backup has no servers');
        if (mode === 'replace' && !confirm(`Replace all saved servers with the ${d.servers.length} in this backup?`)) return;
        const n = await uc.call('backup:import', { servers: d.servers, snippets: d.snippets || [] }, mode); toast(`Imported ${n} server(s)`); m.remove(); refresh(); }
      catch (e) { toast(e.message, true); } }; i.click(); };
}
