'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const fmtB = b => { if (b == null || isNaN(b)) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + ' ' + u[i]; };
const fmtUp = s => { if (!s) return '–'; const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + h + 'h ' + m + 'm'; };
const pjoin = (a, b) => (a.endsWith('/') ? a : a + '/') + b;
const pdir = p => p.replace(/\/[^/]+\/?$/, '') || '/';
function toast(msg, err) { const t = el(`<div class="toast ${err ? 'err' : ''}">${esc(msg)}</div>`); $('#toasts').append(t); setTimeout(() => t.remove(), err ? 6000 : 3000); }
const call = (...a) => uc.call(...a).catch(e => { toast(e.message, true); throw e; });

let servers = [], cur = null; const st = {}; // per-server UI state
const S = id => st[id] ||= { tab: 'overview', terms: [], activeTerm: null, cwd: null, sel: new Set(), uiable: null, stats: null };

async function refresh() { servers = await uc.call('servers:list'); renderSide(); if (cur && !servers.find(s => s.id === cur)) cur = null; if (!cur && servers[0]) cur = servers[0].id; renderMain(); }
function renderSide() {
  $('#srvlist').innerHTML = servers.length ? '' : '<p class="muted small" style="padding:8px">No servers yet.</p>';
  for (const s of servers) {
    const n = el(`<div class="srv ${s.id === cur ? 'active' : ''}"><span class="dot ${s.connected ? 'on' : ''}"></span><div class="t"><b>${esc(s.name || s.host)}</b><span class="muted small">${esc(s.username)}@${esc(s.host)}</span></div></div>`);
    n.onclick = () => { cur = s.id; renderSide(); renderMain(); }; $('#srvlist').append(n);
  }
}
const curSrv = () => servers.find(s => s.id === cur);

function renderMain() {
  stopStats(); const m = $('#main'); const s = curSrv();
  if (!s) { m.innerHTML = `<div class="empty"><div><h1>Uiable Connect</h1><p class="muted">Save a server to get a terminal, files, stats and tunnels.<br>Works with or without Uiable installed on it.</p><button class="primary" data-act="add">+ Add server</button></div></div>`; return; }
  const u = S(s.id);
  m.innerHTML = `<div class="row"><div class="grow"><h2 class="ellipsis">${esc(s.name || s.host)}</h2><div class="muted small mono">${esc(s.username)}@${esc(s.host)}:${s.port} · ${s.auth === 'key' ? 'SSH key' : 'password'}</div></div>
    <button class="sm" id="edit">Edit</button>${s.connected ? '<button class="sm danger" id="disc">Disconnect</button>' : '<button class="primary" id="conn">Connect</button>'}</div>
    <div class="tabs"><div class="seg">${['overview', 'terminal', 'files', 'forwards'].map(t => `<button data-t="${t}" class="${u.tab === t ? 'active' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div><span class="spacer"></span><span id="uiPill"></span></div>
    <div class="view" id="view"></div>`;
  $('#edit').onclick = () => editServer(s);
  if ($('#conn')) $('#conn').onclick = () => connect(s.id);
  if ($('#disc')) $('#disc').onclick = async () => { await call('conn:disconnect', s.id); u.terms.forEach(t => t.term.dispose()); u.terms = []; u.uiable = null; refresh(); };
  m.querySelectorAll('.tabs button[data-t]').forEach(b => b.onclick = () => { u.tab = b.dataset.t; renderMain(); });
  uiPill();
  ({ overview: vOverview, terminal: vTerminal, files: vFiles, forwards: vForwards })[u.tab](s, u, $('#view'));
}
async function connect(id) {
  const b = $('#conn'); if (b) { b.disabled = true; b.textContent = 'Connecting…'; }
  try { await uc.call('conn:connect', id); S(id).uiable = await uc.call('uiable:detect', id).catch(() => null); }
  catch (e) { toast('Could not connect: ' + e.message, true); }
  refresh();
}
function uiPill() {
  const s = curSrv(), u = S(s.id), p = $('#uiPill'); if (!p) return;
  if (!s.connected) { p.innerHTML = ''; return; }
  if (!u.uiable) { p.innerHTML = '<span class="pill">Checking for Uiable…</span>'; return; }
  p.innerHTML = u.uiable.reachable
    ? `<span class="pill ok">● ${u.uiable.isUiable ? 'Uiable' : esc(u.uiable.title || 'Web app')} on :${u.uiable.port}</span> <button class="primary sm" id="openUi">Open Uiable dashboard</button> <button class="sm" id="openUiB" title="Open in your browser">Browser</button>`
    : `<span class="pill">Uiable not found on this server · SSH features only</span>`;
  if ($('#openUi')) { $('#openUi').onclick = () => openUi('window'); $('#openUiB').onclick = () => openUi('browser'); }
}
async function openUi(mode) { const url = await call('uiable:open', cur, mode); toast('Tunnel up: ' + url); refresh(); }

// ---------- Overview / stats
let statsTimer = null; function stopStats() { clearTimeout(statsTimer); statsTimer = null; }
function vOverview(s, u, v) {
  if (!s.connected) { v.innerHTML = notConn(s); return; }
  const draw = () => {
    const x = u.stats; if (!x) { v.innerHTML = '<p class="muted">Loading stats…</p>'; return; }
    const pct = (a, b) => b ? Math.round(100 * a / b) : 0, bar = p => `<div class="bar ${p > 90 ? 'crit' : p > 75 ? 'warn' : ''}"><i style="width:${p}%"></i></div>`;
    const mp = pct(x.memUsed, x.memTotal);
    v.innerHTML = `<div class="grid cols-4">
      <div class="card"><div class="card-title">CPU <span class="muted">${x.cores || '?'} cores</span></div><div class="stat-big">${x.cpu == null ? '…' : x.cpu.toFixed(1) + '%'}</div>${bar(x.cpu || 0)}<p class="muted small">Load ${x.load ? x.load.map(n => n.toFixed(2)).join(' · ') : '–'}</p></div>
      <div class="card"><div class="card-title">Memory</div><div class="stat-big">${mp}%</div>${bar(mp)}<p class="muted small">${fmtB(x.memUsed)} of ${fmtB(x.memTotal)}${x.swapTotal ? ' · swap ' + fmtB(x.swapUsed) : ''}</p></div>
      <div class="card"><div class="card-title">Uptime</div><div class="stat-big">${fmtUp(x.uptime)}</div><p class="muted small ellipsis">${esc(x.hostname)} · ${esc(x.os)}</p></div>
      <div class="card"><div class="card-title">Uiable</div><p class="small">${u.uiable?.reachable ? 'Dashboard is running on the server. Use <b>Open Uiable dashboard</b> above.' : 'Not installed (or not on port 8080). Terminal, Files and Forwards still work over plain SSH.'}</p></div>
    </div><div class="card" style="margin-top:16px"><div class="card-title">Storage</div>${x.disks.map(d => { const p = pct(d.used, d.size); return `<div style="margin-bottom:12px"><div class="row small"><span class="mono grow ellipsis">${esc(d.mount)}</span><span class="muted">${fmtB(d.used)} / ${fmtB(d.size)} · ${p}%</span></div>${bar(p)}</div>`; }).join('') || '<p class="muted">No disks reported</p>'}</div>`;
  };
  const tick = async () => { if (cur !== s.id || S(s.id).tab !== 'overview') return; try { u.stats = await uc.call('stats', s.id); } catch {} if (cur === s.id && u.tab === 'overview') { draw(); statsTimer = setTimeout(tick, document.hidden ? 15000 : 3000); } };
  draw(); tick();
}
const notConn = s => `<div class="empty"><div><p class="muted">Not connected.</p><button class="primary" data-act="connect" data-id="${s.id}">Connect</button></div></div>`;

// ---------- Terminal (tabs persist while connected)
function vTerminal(s, u, v) {
  if (!s.connected) { v.innerHTML = notConn(s); return; }
  v.innerHTML = `<div class="termwrap"><div class="row"><div class="seg" id="ttabs"></div><button class="sm" id="newT">+ New tab</button></div><div class="termhost" id="th"></div></div>`;
  const draw = () => {
    $('#ttabs').innerHTML = u.terms.map((t, i) => `<button class="${t.sid === u.activeTerm ? 'active' : ''}" data-s="${t.sid}">Tab ${i + 1} <span data-x="${t.sid}" style="opacity:.6">✕</span></button>`).join('');
    $('#ttabs').querySelectorAll('button').forEach(b => b.onclick = (e) => { if (e.target.dataset.x) { uc.send('shell:close', s.id, e.target.dataset.x); return; } u.activeTerm = b.dataset.s; show(); });
  };
  const show = () => { draw(); const h = $('#th'); [...h.children].forEach(c => c.style.display = 'none'); const t = u.terms.find(t => t.sid === u.activeTerm); if (!t) return;
    if (t.node.parentNode !== h) h.append(t.node); t.node.style.display = ''; requestAnimationFrame(() => { t.fit.fit(); t.term.focus(); }); };
  const newT = async () => {
    const sid = 't' + Date.now(); const node = document.createElement('div');
    const term = new Terminal({ fontFamily: 'Consolas, "Cascadia Mono", monospace', fontSize: 14, cursorBlink: true, scrollback: 3000, theme: { background: '#0b0d14' } });
    const fit = new FitAddon.FitAddon(); term.loadAddon(fit);
    $('#th').append(node); term.open(node); fit.fit();
    term.onData(d => uc.send('shell:write', s.id, sid, d));
    term.onResize(({ cols, rows }) => uc.send('shell:resize', s.id, sid, cols, rows));
    u.terms.push({ sid, term, fit, node }); u.activeTerm = sid;
    await call('shell:open', s.id, sid, term.cols, term.rows); show();
  };
  $('#newT').onclick = newT; u.redrawTerms = show;
  if (!u.terms.length) newT(); else show();
}
uc.on(d => {
  const u = S(d.id);
  if (d.ev === 'shell-data') u.terms.find(t => t.sid === d.sid)?.term.write(d.data);
  else if (d.ev === 'shell-exit') { const i = u.terms.findIndex(t => t.sid === d.sid); if (i >= 0) { u.terms[i].term.dispose(); u.terms[i].node.remove(); u.terms.splice(i, 1); }
    if (u.activeTerm === d.sid) u.activeTerm = u.terms[0]?.sid; if (cur === d.id && u.tab === 'terminal') u.redrawTerms?.(); }
  else if (d.ev === 'closed') { toast('Connection closed', true); u.terms = []; refresh(); }
  else if (d.ev === 'progress') { let p = $('#prog'); if (!p) { p = el('<div id="prog" class="pill prog"></div>'); document.body.append(p); } p.textContent = `${d.name} ${Math.round(100 * d.t / (d.tot || 1))}%`; clearTimeout(p._t); p._t = setTimeout(() => p.remove(), 1500); }
  else if (d.ev === 'toast') toast(d.message, true);
});
window.addEventListener('resize', () => { const u = cur && S(cur); const t = u?.terms.find(t => t.sid === u.activeTerm); if (t && u.tab === 'terminal') t.fit.fit(); });

// ---------- Files (SFTP)
async function vFiles(s, u, v) {
  if (!s.connected) { v.innerHTML = notConn(s); return; }
  if (!u.cwd) u.cwd = await call('fs:home', s.id);
  v.innerHTML = `<div class="card files"><div class="row" style="margin-bottom:10px"><div class="crumbs grow" id="crumbs"></div>
    <button class="sm" id="up">↑ Up</button><button class="sm" id="mk">New folder</button><button class="sm" id="nf">New file</button><button class="sm" id="dl">Download</button><button class="sm" id="rn">Rename</button><button class="sm danger" id="rm">Delete</button><button class="sm" id="rf">⟳</button></div>
    <div class="scroll"><table class="list"><thead><tr><th>Name</th><th class="right">Size</th><th>Modified</th></tr></thead><tbody id="fl"></tbody></table></div>
    <p class="muted small" style="margin:8px 0 0">Drag files or folders from Windows onto this list to upload · double-click a file to edit it</p></div>`;
  const card = v.querySelector('.files'); let items = [];
  const load = async () => {
    try { items = await uc.call('fs:list', s.id, u.cwd); } catch (e) { toast(e.message, true); items = []; }
    u.sel.clear(); const parts = u.cwd.split('/').filter(Boolean);
    $('#crumbs').innerHTML = `<a data-p="/">/</a>` + parts.map((p, i) => `<a data-p="/${parts.slice(0, i + 1).join('/')}">${esc(p)}</a><span class="muted">/</span>`).join('');
    $('#crumbs').querySelectorAll('a').forEach(a => a.onclick = () => { u.cwd = a.dataset.p; load(); });
    $('#fl').innerHTML = items.map((f, i) => `<tr data-i="${i}"><td>${f.dir ? '📁' : f.link ? '🔗' : '📄'} ${esc(f.name)}</td><td class="right muted">${f.dir ? '' : fmtB(f.size)}</td><td class="muted small">${new Date(f.mtime).toLocaleString('en-GB')}</td></tr>`).join('') || '<tr><td colspan=3 class="muted">Empty folder</td></tr>';
    $('#fl').querySelectorAll('tr[data-i]').forEach(r => {
      const f = items[r.dataset.i], p = pjoin(u.cwd, f.name);
      r.onclick = e => { if (!e.ctrlKey && !e.shiftKey) { u.sel.clear(); $('#fl').querySelectorAll('tr').forEach(x => x.classList.remove('sel')); } u.sel.has(p) ? u.sel.delete(p) : u.sel.add(p); r.classList.toggle('sel', u.sel.has(p)); };
      r.ondblclick = () => f.dir || f.link && !f.size ? (u.cwd = p, load()) : editFile(s.id, p);
    });
  };
  $('#up').onclick = () => { u.cwd = pdir(u.cwd); load(); }; $('#rf').onclick = load;
  $('#mk').onclick = async () => { const n = await prompt2('New folder name'); if (n) { await call('fs:mkdir', s.id, pjoin(u.cwd, n)); load(); } };
  $('#nf').onclick = async () => { const n = await prompt2('New file name'); if (n) { await call('fs:write', s.id, pjoin(u.cwd, n), ''); load(); } };
  $('#rn').onclick = async () => { const [p] = u.sel; if (!p) return toast('Select something first', true); const n = await prompt2('Rename to', p.split('/').pop()); if (n) { await call('fs:rename', s.id, p, pjoin(pdir(p), n)); load(); } };
  $('#rm').onclick = async () => { if (!u.sel.size) return toast('Select something first', true); if (!confirm(`Delete ${u.sel.size} item(s)? Folders are deleted with everything inside.`)) return; for (const p of u.sel) await call('fs:remove', s.id, p); load(); };
  $('#dl').onclick = async () => { if (!u.sel.size) return toast('Select something first', true); const d = await call('fs:download', s.id, [...u.sel]); if (d) toast('Downloaded to ' + d); };
  let dragN = 0; const drop = el('<div class="drop hidden">Drop to upload here</div>'); card.append(drop);
  card.ondragenter = e => { e.preventDefault(); dragN++; drop.classList.remove('hidden'); };
  card.ondragleave = () => { if (--dragN <= 0) { dragN = 0; drop.classList.add('hidden'); } };
  card.ondragover = e => e.preventDefault();
  card.ondrop = async e => { e.preventDefault(); dragN = 0; drop.classList.add('hidden'); const paths = [...e.dataTransfer.files].map(f => uc.pathFor(f)).filter(Boolean);
    if (!paths.length) return; await call('fs:upload', s.id, paths, u.cwd); toast(`Uploaded ${paths.length} item(s)`); load(); };
  load();
}
async function editFile(id, p) {
  let txt; try { txt = await uc.call('fs:read', id, p); } catch (e) { return toast(e.message, true); }
  const m = el(`<div class="modal-bg"><div class="modal full"><header><h3 class="grow mono ellipsis">${esc(p)}</h3></header><div class="body"><textarea class="editor" spellcheck="false"></textarea></div><footer><button id="c">Close</button><button class="primary" id="sv">Save (Ctrl+S)</button></footer></div></div>`);
  document.body.append(m); const ta = m.querySelector('textarea'); ta.value = txt; ta.focus();
  const save = async () => { await call('fs:write', id, p, ta.value); txt = ta.value; toast('Saved'); };
  ta.onkeydown = e => { if (e.key === 's' && e.ctrlKey) { e.preventDefault(); save(); } if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end'); } };
  m.querySelector('#sv').onclick = save; m.querySelector('#c').onclick = () => { if (ta.value !== txt && !confirm('Discard unsaved changes?')) return; m.remove(); };
}
function prompt2(title, val = '') { return new Promise(res => {
  const m = el(`<div class="modal-bg"><div class="modal"><header><h3>${esc(title)}</h3></header><div class="body"><input></div><footer><button id="c">Cancel</button><button class="primary" id="o">OK</button></footer></div></div>`);
  document.body.append(m); const i = m.querySelector('input'); i.value = val; i.focus(); i.select();
  const done = v => { m.remove(); res(v); }; m.querySelector('#c').onclick = () => done(null); m.querySelector('#o').onclick = () => done(i.value.trim());
  i.onkeydown = e => { if (e.key === 'Enter') done(i.value.trim()); if (e.key === 'Escape') done(null); }; }); }

// ---------- Port forwards
function vForwards(s, u, v) {
  const fw = s.forwards || [];
  const stat = id => s.fwdStatus?.find(x => x.id === id) || { active: false };
  v.innerHTML = `<div class="card"><div class="card-title grow">Port forwards <span class="muted">· a port on the server shows up on this PC at localhost:&lt;local port&gt;</span></div>
    <table class="list"><thead><tr><th>Name</th><th>Server host</th><th>Server port</th><th>PC port</th><th>Auto</th><th>Status</th><th></th></tr></thead><tbody>
    ${fw.map((f, i) => { const a = stat(f.id); return `<tr data-i="${i}"><td><input data-k="name" value="${esc(f.name)}"></td><td><input data-k="remoteHost" value="${esc(f.remoteHost)}"></td><td style="width:110px"><input data-k="remotePort" type="number" value="${f.remotePort}"></td><td style="width:110px"><input data-k="localPort" type="number" value="${f.localPort}"></td>
      <td><input type="checkbox" data-k="auto" ${f.auto ? 'checked' : ''} title="Start when connecting"></td>
      <td>${a.active ? `<span class="pill ok">● On${a.conns ? ' · ' + a.conns : ''}</span>` : '<span class="pill">Off</span>'}</td>
      <td class="nowrap right">${a.active ? `<a href="#" data-open="${f.localPort}">open</a> <button class="sm" data-stop="${f.id}">Stop</button>` : `<button class="sm primary" data-start="${i}" ${s.connected ? '' : 'disabled'}>Start</button>`} ${f.builtin ? '' : `<button class="sm danger" data-del="${i}">✕</button>`}</td></tr>`; }).join('')}
    </tbody></table><div class="row" style="margin-top:12px"><button class="sm" id="addF">+ Add forward</button><span class="spacer"></span><span class="muted small">Edits save automatically</span></div></div>`;
  const persist = async () => { await call('servers:forwards', s.id, fw); };
  v.querySelectorAll('input[data-k]').forEach(inp => inp.onchange = () => { const f = fw[inp.closest('tr').dataset.i]; f[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.value; persist(); });
  v.querySelectorAll('[data-start]').forEach(b => b.onclick = async () => { const f = fw[b.dataset.start];
    const c = await uc.call('fwd:check', f.localPort); if (!c.free) return toast(`Port ${f.localPort} is already in use on this PC, pick another PC port`, true);
    await call('fwd:start', s.id, f); refresh(); });
  v.querySelectorAll('[data-stop]').forEach(b => b.onclick = async () => { await call('fwd:stop', s.id, b.dataset.stop); refresh(); });
  v.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const f = fw[b.dataset.del]; if (s.connected) await uc.call('fwd:stop', s.id, f.id).catch(() => {}); fw.splice(b.dataset.del, 1); await persist(); refresh(); });
  v.querySelectorAll('[data-open]').forEach(a => a.onclick = e => { e.preventDefault(); window.open('http://localhost:' + a.dataset.open + '/'); });
  $('#addF').onclick = async () => { let lp = 3000; while (fw.some(f => +f.localPort === lp)) lp++; fw.push({ id: 'f' + Date.now(), name: 'New forward', remoteHost: '127.0.0.1', remotePort: lp, localPort: lp, auto: false }); await persist(); refresh(); };
}

// ---------- Add / edit server
function editServer(s = {}) {
  const auth = s.auth || 'password';
  const m = el(`<div class="modal-bg"><div class="modal"><header><h3>${s.id ? 'Edit server' : 'Add server'}</h3></header><div class="body">
    <label class="field"><span>Name</span><input id="n" placeholder="Home server" value="${esc(s.name)}"></label>
    <div class="row"><label class="field grow"><span>Host / IP</span><input id="h" placeholder="192.168.1.20" value="${esc(s.host)}"></label><label class="field" style="width:90px"><span>Port</span><input id="p" type="number" value="${s.port || 22}"></label></div>
    <label class="field"><span>Username</span><input id="u" value="${esc(s.username)}"></label>
    <div class="seg" style="margin-bottom:12px"><button data-a="password">Password</button><button data-a="key">SSH key</button></div>
    <div id="pw"><label class="field"><span>Password</span><input id="pass" type="password" placeholder="${s.has_password ? '•••••• saved (leave blank to keep)' : ''}"></label></div>
    <div id="ky"><label class="field"><span>Private key ${s.keyName ? '· ' + esc(s.keyName) : ''}</span><textarea id="key" rows="4" class="mono" placeholder="${s.has_privateKey ? 'Key saved (leave blank to keep). ' : ''}Paste -----BEGIN OPENSSH PRIVATE KEY----- …"></textarea></label>
      <div class="row" style="margin:-4px 0 12px"><button class="sm" id="pick">Choose key file…</button><span class="muted small" id="kn"></span></div>
      <label class="field"><span>Key passphrase (optional)</span><input id="pp" type="password" placeholder="${s.has_passphrase ? '•••••• saved' : ''}"></label></div>
    <p class="muted small">Passwords and keys are encrypted with your Windows login (DPAPI) and never leave this PC.</p><div id="tr" class="small"></div>
  </div><footer>${s.id ? '<button class="danger" id="del">Delete</button><span class="spacer"></span>' : ''}<button id="c">Cancel</button><button id="t">Test</button><button class="primary" id="sv">Save</button></footer></div></div>`);
  document.body.append(m); let a = auth, keyName = s.keyName;
  const setA = x => { a = x; m.querySelectorAll('[data-a]').forEach(b => b.classList.toggle('active', b.dataset.a === x)); m.querySelector('#pw').classList.toggle('hidden', x !== 'password'); m.querySelector('#ky').classList.toggle('hidden', x !== 'key'); };
  m.querySelectorAll('[data-a]').forEach(b => b.onclick = () => setA(b.dataset.a)); setA(auth);
  m.querySelector('#pick').onclick = async () => { const k = await call('key:pick'); if (k) { m.querySelector('#key').value = k.text; keyName = k.name; m.querySelector('#kn').textContent = k.name; } };
  const val = () => ({ id: s.id, name: m.querySelector('#n').value.trim(), host: m.querySelector('#h').value.trim(), port: m.querySelector('#p').value, username: m.querySelector('#u').value.trim(), auth: a, keyName,
    password: m.querySelector('#pass').value, privateKey: m.querySelector('#key').value.trim() ? m.querySelector('#key').value.trim() + '\n' : '', passphrase: m.querySelector('#pp').value });
  m.querySelector('#c').onclick = () => m.remove();
  m.querySelector('#t').onclick = async () => { const tr = m.querySelector('#tr'); tr.innerHTML = '<span class="pill">Testing…</span>';
    try { const r = await uc.call('servers:test', val()); tr.innerHTML = `<span class="pill ok">✓ Connected · ${esc(r.info)}</span>`; } catch (e) { tr.innerHTML = `<span class="pill err">✕ ${esc(e.message)}</span>`; } };
  m.querySelector('#sv').onclick = async () => { const v = val(); if (!v.host || !v.username) return toast('Host and username are required', true); if (!v.name) v.name = v.host; cur = await call('servers:save', v); m.remove(); refresh(); };
  if (s.id) m.querySelector('#del').onclick = async () => { if (!confirm(`Delete ${s.name}?`)) return; await call('servers:delete', s.id); delete st[s.id]; cur = null; m.remove(); refresh(); };
}
$('#addSrv').onclick = () => editServer();
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b) return; if (b.dataset.act === 'add') editServer(); if (b.dataset.act === 'connect') { b.disabled = true; b.textContent = 'Connecting…'; connect(b.dataset.id); } });
refresh();
