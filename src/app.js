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

/** Bring the Electron window forward and focus the first field in a modal (xterm steals focus otherwise). */
function focusModal(m) {
  try { uc.call('app:focusWin').catch(() => {}); } catch (_) {}
  requestAnimationFrame(() => {
    const f = m && m.querySelector('input:not([type=hidden]), select, textarea, button.primary, button');
    if (f && typeof f.focus === 'function') f.focus();
  });
}

// ---------- app state: split view = up to two panes, each a (server, tab) pair
let servers = [], APP = { platform: 'desktop' };
const st = {}; // per-server UI state
const S = id => st[id] ||= { terms: [], activeTerm: null, files: {}, peer: null, sel: new Set(), uiable: null, stats: null };
let panes = [{ srv: null, tab: 'overview' }];
let focusPane = 0;
try { const p = JSON.parse(localStorage.getItem('uc.panes') || 'null'); if (Array.isArray(p) && p.length) panes = p.slice(0, 2).map(x => ({ srv: x.srv || null, tab: x.tab || 'overview' })); } catch {}
const ON_MOBILE = !!window.UC_MOBILE;
if (ON_MOBILE) panes = [panes[0]];
const persistPanes = () => localStorage.setItem('uc.panes', JSON.stringify(panes));
const cur = () => panes[focusPane] && panes[focusPane].srv;
const curSrv = () => servers.find(s => s.id === cur());
const anyPane = (id, tab) => panes.some(p => p.srv === id && p.tab === tab);
const isSsh = s => !s || !s.connType || s.connType === 'ssh';
const TABS = s => isSsh(s) ? ['overview', 'terminal', 'files', 'forwards', 'health', 'alerts', 'history'] : ['terminal', 'history'];
const connLabel = s => s.connType === 'serial' ? `serial ${esc(s.serialPath)} @ ${s.baudRate || 115200}` : s.connType === 'telnet' ? `telnet ${esc(s.host)}:${s.port}` : `${esc(s.username)}@${esc(s.host)}:${s.port}`;

async function refresh() { servers = await uc.call('servers:list');
  for (const p of panes) { if (p.srv && !servers.find(s => s.id === p.srv)) p.srv = null; const s = servers.find(x => x.id === p.srv); if (s && !TABS(s).includes(p.tab)) p.tab = TABS(s)[0]; }
  if (!panes.some(p => p.srv) && servers[0]) panes[0].srv = servers[0].id;
  renderSide(); renderMain(); }
function renderSide() {
  const host = $('#srvlist');
  host.innerHTML = servers.length ? '' : '<p class="muted small" style="padding:8px">No connections yet.</p>';
  // group headers (collapsible); ungrouped connections sit at the top
  const groups = new Map(); for (const s of servers) { const g = s.group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }
  const names = [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
  const col = JSON.parse(localStorage.getItem('uc.gcol') || '{}');
  for (const g of names) {
    if (g) { const h = el(`<div class="ghead">${col[g] ? '▸' : '▾'} ${esc(g)} <span class="muted">${groups.get(g).length}</span></div>`);
      h.onclick = () => { col[g] = !col[g]; localStorage.setItem('uc.gcol', JSON.stringify(col)); renderSide(); }; host.append(h);
      if (col[g]) continue; }
    for (const s of groups.get(g)) {
      const n = el(`<div class="srv ${panes.some(p => p.srv === s.id) ? 'active' : ''} ${s.quick ? 'quick' : ''}"><span class="dot ${s.connected ? 'on' : ''}"></span><div class="t"><b>${esc(s.name || s.host || s.serialPath)}</b><span class="muted small">${connLabel(s)}</span></div></div>`);
      n.onclick = () => { panes[focusPane].srv = s.id; const t = TABS(s); if (!t.includes(panes[focusPane].tab)) panes[focusPane].tab = t[0]; renderSide(); renderMain(); };
      n.oncontextmenu = e => { e.preventDefault(); srvMenu(e.clientX, e.clientY, s); };
      let lp = null; // long-press opens the same menu on touch devices (no right-click)
      n.addEventListener('touchstart', e => { const t = e.touches[0]; lp = setTimeout(() => srvMenu(t.clientX, t.clientY, s), 550); }, { passive: true });
      ['touchend', 'touchmove', 'touchcancel'].forEach(ev => n.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
      host.append(n);
    }
  }
}
function srvMenu(x, y, s) {
  ctxMenu(x, y, [
    s.connected ? ['Disconnect', async () => { S(s.id).userClosed = true; await call(s.quick ? 'servers:purgetemp' : 'conn:disconnect', s.id); refresh(); }]
      : ['Connect', () => connect(s.id)],
    s.mac && !s.connected ? ['⚡ Wake on LAN', () => call('net:wol', s.id).then(() => toast('Wake packet sent'))] : null,
    ['Edit', () => editServer(s)],
    ['Duplicate', async () => { await call('servers:dup', s.id); refresh(); }],
    s.hostKey ? ['Forget host key', async () => { await call('servers:clearhostkey', s.id); toast('Host key forgotten — it will be asked again on next connect'); refresh(); }] : null,
    ['Delete', async () => { if (!confirm(`Delete ${s.name || s.host}?`)) return; await call(s.quick ? 'servers:purgetemp' : 'servers:delete', s.id); delete st[s.id]; panes.forEach(p => { if (p.srv === s.id) p.srv = null; }); refresh(); }],
  ].filter(Boolean));
}
// ---------- clipboard (Electron: native clipboard via preload; browser/mobile: navigator.clipboard)
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const clip = { read: async () => uc.clip ? uc.clip.read() : navigator.clipboard.readText(), write: async t => uc.clip ? uc.clip.write(t) : navigator.clipboard.writeText(t) };
function ctxMenu(x, y, items) {
  $('#ctx')?.remove(); const m = el('<div id="ctx" class="ctx"></div>');
  for (const [label, fn, off] of items) { const b = el(`<button ${off ? 'disabled' : ''}>${label}</button>`); b.onclick = () => { m.remove(); Promise.resolve(fn()).catch(e => toast(e.message || 'Clipboard not available', true)); }; m.append(b); }
  document.body.append(m); m.style.left = Math.min(x, innerWidth - m.offsetWidth - 4) + 'px'; m.style.top = Math.min(y, innerHeight - m.offsetHeight - 4) + 'px';
  const close = e => { if (e.type === 'keydown' ? e.key === 'Escape' : !m.contains(e.target)) { m.remove(); off(); } };
  const off = () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', close, true); };
  setTimeout(() => { document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', close, true); });
}
// Mac: Cmd+C copies, Cmd+V pastes (via the Edit menu's paste role -> native paste event). Win/Linux: Ctrl+Shift+C/V,
// Ctrl+Insert / Shift+Insert. Plain Ctrl+C still sends ^C to the server. Right-click menu everywhere.
function termClipboard(term, node) {
  const paste = () => clip.read().then(t => t && term.paste(t));
  term.attachCustomKeyEventHandler(e => {
    if (e.type !== 'keydown') return true; const k = e.key.toLowerCase();
    if ((IS_MAC && e.metaKey && k === 'c') || (e.ctrlKey && e.shiftKey && k === 'c') || (e.ctrlKey && k === 'insert')) { const t = term.getSelection(); if (t) clip.write(t).catch(() => {}); e.preventDefault(); return false; }
    if (IS_MAC && e.metaKey && k === 'v') return false; // browser/menu paste event -> xterm handles it once
    if ((e.ctrlKey && e.shiftKey && k === 'v') || (e.shiftKey && k === 'insert')) { e.preventDefault(); paste().catch(() => {}); return false; }
    if (IS_MAC && e.metaKey && k === 'a') { term.selectAll(); return false; }
    return true;
  });
  node.addEventListener('contextmenu', e => { e.preventDefault(); const sel = term.getSelection();
    ctxMenu(e.clientX, e.clientY, [['Copy', () => clip.write(sel), !sel], ['Paste', paste], ['Select all', () => term.selectAll()], ['Clear', () => term.clear()]]); });
}

// ---------- alerts: background stats poll for connected SSH servers with enabled rules (every 10 s, app open only)
function onStats(s, x) { const u = S(s.id); u.stats = x; u.statsAt = Date.now(); for (const m of evalAlerts(s, x)) raiseAlert(s, m); }
setInterval(async () => {
  for (const s of servers) {
    const u = S(s.id); if (!s.connected || !isSsh(s) || u.statsBusy || Date.now() - (u.statsAt || 0) < 9000) continue;
    if (!rulesFor(s).some(r => r.enabled && r.metric !== 'disconnect')) continue;
    u.statsBusy = true; try { onStats(s, await uc.call('stats', s.id)); } catch {} u.statsBusy = false;
  }
}, 10000);

// ---------- panes / main layout
let statsTimer = null; function stopStats() { clearTimeout(statsTimer); statsTimer = null; }
function renderMain() {
  stopStats(); const host = $('#panes');
  host.classList.toggle('split', panes.length > 1);
  host.innerHTML = '';
  panes.forEach((p, i) => { const sec = el(`<section class="pane ${i === focusPane ? 'focus' : ''}" data-i="${i}"></section>`); sec.addEventListener('pointerdown', () => { if (focusPane !== i) { focusPane = i; renderSide(); renderMain(); } }); host.append(sec); renderPane(sec, p, i); });
  persistPanes();
}
function renderPane(sec, p, i) {
  const s = servers.find(x => x.id === p.srv);
  if (!s) {
    sec.innerHTML = `<div class="pane-head empty-head"></div><div class="empty"><div><h1>Uiable Connect</h1><p class="muted">Add a connection to open a terminal, browse files, check health and forward ports.<br>Works with or without Uiable on the server.</p><button class="primary" data-act="add">+ Add connection</button></div></div>`;
    return;
  }
  const u = S(s.id), tabs = TABS(s);
  sec.innerHTML = `<div class="pane-head"><span class="pdot ${s.connected ? 'on' : ''}"></span><div class="grow" style="min-width:0"><div class="ph-name ellipsis">${esc(s.name || s.host || s.serialPath)}${s.group ? ` <span class="gtag">${esc(s.group)}</span>` : ''}</div><div class="ph-sub ellipsis">${u.lat ? u.lat + ' ms · ' : ''}${connLabel(s)}${s.jumpId ? ' ⇢ via ' + esc(servers.find(j => j.id === s.jumpId)?.name || 'jump host') + ' · ' : ''}${isSsh(s) ? ({ password: 'password', key: 'SSH key', keypass: 'key + password' }[s.auth] || s.auth) : ''}</div></div>
    ${panes.length > 1 ? '<button class="sm" id="pclose" title="Close this pane">✕</button>' : ''}
    ${!ON_MOBILE && panes.length < 2 ? '<button class="sm" id="psplit" title="Show two panes side by side">⿻</button>' : ''}
    <button class="sm" id="edit">Edit</button>${s.connected ? '<button class="sm danger" id="disc">Disconnect</button>' : `${s.mac ? '<button class="sm" id="wake" title="Send a Wake-on-LAN packet">⚡ Wake</button>' : ''}<button class="primary sm" id="conn">Connect</button>`}</div>
    <div class="tabs"><div class="seg">${tabs.map(t => { const short = ({ overview:'Home', terminal:'Term', files:'Files', forwards:'Ports', health:'Health', alerts:'Alerts', history:'Hist' }[t] || t);
    const label = ON_MOBILE ? short : (t[0].toUpperCase() + t.slice(1));
    const icon = ON_MOBILE ? ({
      overview: '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z"/></svg>',
      terminal: '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5 10 12 4 17.5M12 18h8"/></svg>',
      files: '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5V19a1.5 1.5 0 0 0 1.5 1.5h14A1.5 1.5 0 0 0 20.5 19V9.5A1.5 1.5 0 0 0 19 8h-7.2L9.5 5.5H5A1.5 1.5 0 0 0 3.5 7.5z"/></svg>',
      forwards: '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10M17 7l-3-3M17 7l-3 3M17 17H7M7 17l3-3M7 17l3 3"/></svg>',
      health: '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h3.5l2-5 3 10 2.5-5H21"/></svg>',
      alerts: '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17h12l-1.2-2.2a6.2 6.2 0 0 1-1.3-3.7V9a4.5 4.5 0 1 0-9 0v2.1c0 1.3-.45 2.6-1.3 3.7L6 17zm4.2 1.2a2 2 0 0 0 3.6 0"/></svg>',
      history: '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/></svg>',
    }[t] || '') : '';
    return `<button data-t="${t}" class="${p.tab === t ? 'active' : ''}" title="${t}">${icon}<span class="tlab">${label}</span></button>`; }).join('')}</div><span class="spacer"></span><span id="uiPill"></span></div>
    <div class="view" id="view"></div>`;
  $('#edit', sec).onclick = () => editServer(s);
  if ($('#conn', sec)) $('#conn', sec).onclick = () => connect(s.id);
  const wk = $('#wake', sec); if (wk) wk.onclick = () => call('net:wol', s.id).then(() => toast('Wake packet sent — give it a moment, then connect'));
  if ($('#disc', sec)) $('#disc', sec).onclick = async () => { u.userClosed = true; await call(s.quick ? 'servers:purgetemp' : 'conn:disconnect', s.id); u.terms.forEach(t => t.term.dispose()); u.terms = []; u.uiable = null; refresh(); };
  const ps = $('#psplit', sec); if (ps) ps.onclick = () => { panes.push({ srv: s.id, tab: 'terminal' }); focusPane = panes.length - 1; renderSide(); renderMain(); };
  const pc = $('#pclose', sec); if (pc) pc.onclick = () => { panes.splice(i, 1); if (!panes.length) panes = [{ srv: null, tab: 'overview' }]; focusPane = Math.max(0, i - 1); renderSide(); renderMain(); };
  sec.querySelectorAll('.tabs button[data-t]').forEach(b => b.onclick = () => { p.tab = b.dataset.t; renderMain(); });
  uiPill(sec, s, u);
  ({ overview: vOverview, terminal: vTerminal, files: vFiles, forwards: vForwards, health: vHealth, alerts: vAlerts, history: vHistory })[p.tab](s, u, $('#view', sec), sec);
}
const notConn = s => `<div class="empty"><div><p class="muted">This connection is offline.</p><button class="primary" data-act="connect" data-id="${s.id}">Connect</button></div></div>`;

// ---------- host keys: trust on first use. Backends refuse an unknown/changed key before sending any password or key.
const hostKeyErr = e => { const m = /HOSTKEY_(UNKNOWN|CHANGED) (SHA256:\S+)/.exec(e && e.message || ''); return m && { changed: m[1] === 'CHANGED', fp: m[2] }; };
function trustPrompt(s, k) { return new Promise(res => {
  const m = el(`<div class="modal-bg"><div class="modal" style="width:560px"><header><h3 class="grow">${k.changed ? '⚠ Host key changed' : 'Trust this server?'}</h3></header><div class="body">
    ${k.changed ? `<p class="pill err" style="display:block">The host key of <b>${esc(s.host)}</b> is different from the one you trusted before. This happens after a reinstall or a new server at that address, but it can also mean someone is intercepting the connection. Nothing was sent.</p>`
      : `<p>First connection to <b>${esc(s.host)}</b>. Check the fingerprint matches the server (run <code class="mono">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code> on it), then trust it.</p>`}
    <p class="muted small" style="margin-bottom:4px">${k.changed ? 'Previously trusted' : ''}</p>${k.changed ? `<p class="mono small" style="overflow-wrap:anywhere">${esc(s.hostKey || '')}</p><p class="muted small" style="margin-bottom:4px">Now offered</p>` : '<p class="muted small" style="margin-bottom:4px">SHA256 fingerprint</p>'}
    <p class="mono" style="overflow-wrap:anywhere;font-size:14px">${esc(k.fp)}</p></div>
    <footer><span class="spacer"></span><button id="c">Cancel</button><button class="${k.changed ? 'danger' : 'primary'}" id="ok">${k.changed ? 'Trust new key' : 'Trust and connect'}</button></footer></div></div>`);
  document.body.append(m); focusModal(m); m.querySelector('#c').onclick = () => { m.remove(); res(false); }; m.querySelector('#ok').onclick = () => { m.remove(); res(true); }; }); }
async function connect(id) {
  const s = servers.find(x => x.id === id); const btns = document.querySelectorAll('#conn'); btns.forEach(b => { b.disabled = true; b.textContent = 'Connecting…'; });
  try { try { await uc.call('conn:connect', id); }
    catch (e) { const k = hostKeyErr(e); if (!k) throw e;
      if (!await trustPrompt(s || {}, k)) { refresh(); return; } await call('servers:hostkey', id, k.fp); await uc.call('conn:connect', id); }
    refresh(); // show connected right away; detection + latency fill in async
    uc.call('net:ping', id).then(ms => { S(id).lat = ms; if (anyPane(id)) renderMain(); }).catch(() => {});
    if (s && isSsh(s)) { S(id).uiable = await uc.call('uiable:detect', id).catch(() => null); if (anyPane(id)) renderMain(); } }
  catch (e) { toast('Could not connect: ' + e.message, true); refresh(); }
}
function uiPill(sec, s, u) {
  const p = $('#uiPill', sec); if (!p) return;
  if (!s.connected || !isSsh(s)) { p.innerHTML = ''; return; }
  if (!u.uiable) {
    p.innerHTML = '<span class="pill">Checking for Uiable…</span>';
    // Already-connected sessions (e.g. restored panes) never go through connect(), so kick off detect once
    if (!u._uiDetecting) {
      u._uiDetecting = true;
      Promise.resolve(uc.call('uiable:detect', s.id)).then(d => {
        u.uiable = d || { reachable: false }; u._uiDetecting = false;
        if (anyPane(s.id)) renderMain();
      }).catch(e => {
        console.warn('uiable:detect failed', e);
        u.uiable = { reachable: false }; u._uiDetecting = false;
        if (anyPane(s.id)) renderMain();
      });
    }
    return;
  }
  p.innerHTML = u.uiable.reachable
    ? `<span class="pill ok">● Uiable${u.uiable.version ? ' ' + esc(u.uiable.version) : ''} on :${u.uiable.port}</span> <button class="primary sm" id="openUi">Open Uiable dashboard</button> <button class="sm" id="openUiB" title="Open in your browser">Browser</button>`
    : `<span class="pill">Uiable not found on this server · SSH features only</span>`;
  p.insertAdjacentHTML('beforeend', ' <span id="uiInst"></span>'); uiInstallButton(s, u, p);
  if ($('#openUi', p)) { $('#openUi', p).onclick = () => openUi(s.id, 'window'); $('#openUiB', p).onclick = () => openUi(s.id, 'browser'); }
}
async function openUi(id, mode) { const u = S(id); if (u.uiOpening) return; u.uiOpening = true;
  try { const url = await call('uiable:open', id, mode, u.uiable && u.uiable.port); toast('Tunnel up: ' + url); refresh(); }
  finally { u.uiOpening = false; } }

// ---------- Overview / stats
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
      <div class="card"><div class="card-title">Uiable</div><p class="small">${u.uiable?.reachable ? `Dashboard is running on the server (port ${u.uiable.port}). Use <b>Open Uiable dashboard</b> above.` : 'Not found on this server. Terminal, Files and Forwards still work over plain SSH.'}</p></div>
    </div><div class="card" style="margin-top:16px"><div class="card-title">Storage</div>${x.disks.map(d => { const p = pct(d.used, d.size); return `<div style="margin-bottom:12px"><div class="row small"><span class="mono grow ellipsis">${esc(d.mount)}</span><span class="muted">${fmtB(d.used)} / ${fmtB(d.size)} · ${p}%</span></div>${bar(p)}</div>`; }).join('') || '<p class="muted">No disks reported</p>'}</div>`;
  };
  const tick = async () => { if (!anyPane(s.id, 'overview')) return; if (!u.statsBusy) { u.statsBusy = true; try { onStats(s, await uc.call('stats', s.id)); } catch {} u.statsBusy = false; } if (anyPane(s.id, 'overview')) { draw(); statsTimer = setTimeout(tick, document.hidden ? 15000 : 3000); } };
  draw(); tick();
}

// ---------- Terminal (tabs persist while connected; tmux keeps sessions alive on the server)
const THEME_KEY = 'uc.theme';
const APP_THEMES = ['dark', 'light', 'solarized', 'dracula', 'monokai'];
const resolvedTheme = (pref) => {
  const p = pref || localStorage.getItem(THEME_KEY) || 'dark';
  if (p === 'system') return (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  return APP_THEMES.includes(p) ? p : 'dark';
};
const applyTheme = (pref) => {
  if (pref != null) localStorage.setItem(THEME_KEY, pref);
  const resolved = resolvedTheme();
  document.documentElement.setAttribute('data-theme', resolved);
  // Keep terminal chrome in sync when user hasn't picked a terminal theme explicitly after app theme
  // (terminal select still overrides via uc.ttheme).
  return resolved;
};
applyTheme(); // apply persisted app theme as soon as app.js runs
if (window.matchMedia) {
  try {
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if ((localStorage.getItem(THEME_KEY) || 'dark') === 'system') applyTheme();
    });
  } catch (_) {}
}

const TERM_THEMES = {
  dark: { background: '#0b0d14', foreground: '#e8eaf2', cursor: '#7c5cff' },
  light: { background: '#fafbfe', foreground: '#1a1c26', cursor: '#5b3df5' },
  solarized: { background: '#002b36', foreground: '#839496', cursor: '#93a1a1' },
  dracula: { background: '#282a36', foreground: '#f8f8f2', cursor: '#bd93f9' },
  monokai: { background: '#272822', foreground: '#f8f8f2', cursor: '#f92672' },
};
const termTheme = () => TERM_THEMES[localStorage.getItem('uc.ttheme') || 'dark'] || TERM_THEMES.dark;
function vTerminal(s, u, v) {
  if (!s.connected) { v.innerHTML = notConn(s); return; }
  v.innerHTML = `<div class="termwrap"><div class="row"><div class="seg" id="ttabs"></div><button class="sm" id="newT" title="New tab (Ctrl+T)">+ Tab</button>${isSsh(s) ? '<button class="sm" id="tmuxT" title="New tab attached to a tmux session on the server — it keeps running if you disconnect">+ tmux</button><button class="sm" id="dockT" title="Open a shell inside a running Docker container on the server">◫ Docker</button>' : ''}<button class="sm" id="snipB" title="Saved commands">⌘ Scripts</button><span class="spacer"></span><button class="sm" id="findB" title="Search in the terminal (Ctrl+F)">🔍</button></div>
    <div class="termhost" id="th"></div>
    <div class="findbar hidden" id="fb"><input id="fbi" placeholder="Find in terminal…"><button class="sm" id="fbp" title="Previous">↑</button><button class="sm" id="fbn" title="Next">↓</button><button class="sm" id="fbx">✕</button></div></div>`;
  const draw = () => {
    $('#ttabs').innerHTML = u.terms.map((t, i) => `<button class="${t.sid === u.activeTerm ? 'active' : ''}" data-s="${t.sid}">${t.label || 'Tab ' + (i + 1)} <span data-x="${t.sid}" style="opacity:.6">✕</span></button>`).join('');
    $('#ttabs').querySelectorAll('button').forEach(b => b.onclick = (e) => { if (e.target.dataset.x) { uc.send('shell:close', s.id, e.target.dataset.x); return; } u.activeTerm = b.dataset.s; show(); });
  };
  const show = () => { draw(); const h = $('#th'); [...h.children].forEach(c => c.style.display = 'none'); const t = u.terms.find(t => t.sid === u.activeTerm); if (!t) return;
    if (t.node.parentNode !== h) h.append(t.node); t.node.style.display = ''; requestAnimationFrame(() => { t.fit.fit(); if (!document.querySelector(".modal-bg")) t.term.focus(); }); };
  const newT = async (runCmd, label) => {
    const sid = 't' + Date.now() + Math.floor(Math.random() * 999); const node = document.createElement('div');
    const term = new Terminal({ fontFamily: 'Consolas, "Cascadia Mono", monospace', fontSize: 14, cursorBlink: true, scrollback: 3000, theme: termTheme() });
    const fit = new FitAddon.FitAddon(); term.loadAddon(fit);
    const search = window.SearchAddon ? new SearchAddon.SearchAddon() : null; if (search) term.loadAddon(search);
    $('#th').append(node); term.open(node); fit.fit();
    term.onData(d => uc.send('shell:write', s.id, sid, d));
    termClipboard(term, node);
    term.onResize(({ cols, rows }) => uc.send('shell:resize', s.id, sid, cols, rows));
    u.terms.push({ sid, term, fit, search, node, label }); u.activeTerm = sid;
    await call('shell:open', s.id, sid, term.cols, term.rows);
    if (runCmd) uc.send('shell:write', s.id, sid, runCmd.replace(/\r?\n/g, '\r') + '\r');
    show();
  };
  // find bar: searches the active terminal via the search addon
  const fb = $('#fb', v), fbi = $('#fbi', v);
  const curSearch = () => u.terms.find(t => t.sid === u.activeTerm)?.search;
  const find = dir => { const sa = curSearch(); if (sa && fbi.value) dir < 0 ? sa.findPrevious(fbi.value) : sa.findNext(fbi.value); };
  u.search = { open() { fb.classList.remove('hidden'); fbi.focus(); fbi.select(); }, close() { fb.classList.add('hidden'); curSearch()?.clearSelection(); } };
  $('#findB', v).onclick = () => fb.classList.contains('hidden') ? u.search.open() : u.search.close();
  $('#fbx', v).onclick = () => u.search.close();
  $('#fbn', v).onclick = () => find(1); $('#fbp', v).onclick = () => find(-1);
  fbi.oninput = () => find(1); fbi.onkeydown = e => { if (e.key === 'Enter') find(e.shiftKey ? -1 : 1); if (e.key === 'Escape') u.search.close(); };
  $('#newT').onclick = () => newT(); u.newT = newT; u.redrawTerms = show;
  const tm = $('#tmuxT'); if (tm) tm.onclick = () => newT('tmux new-session -A -s uiable || tmux new-session -s uiable', 'tmux');
  const dk = $('#dockT', v); if (dk) dk.onclick = async () => {
    let cs;
    try { cs = await call('docker:ps', s.id); }
    catch (e) { return toast(e.message || String(e), true); }
    if (!cs.length) return toast('No running containers on this server', true);
    const c = cs.length === 1 ? cs[0].name : await pickList('Shell into container', cs.map(x => x.name + '  ·  ' + x.image), cs.map(x => x.name));
    if (c) newT(`docker exec -it ${c} bash 2>/dev/null || docker exec -it ${c} sh`, '◫ ' + c); };
  $('#snipB').onclick = () => snippetsDialog(s, u);
  if (!u.terms.length) newT(); else show();
}
uc.on(d => {
  const u = S(d.id);
  if (d.ev === 'shell-data') u.terms.find(t => t.sid === d.sid)?.term.write(d.data);
  else if (d.ev === 'shell-exit') { const i = u.terms.findIndex(t => t.sid === d.sid); if (i >= 0) { u.terms[i].term.dispose(); u.terms[i].node.remove(); u.terms.splice(i, 1); }
    if (u.activeTerm === d.sid) u.activeTerm = u.terms[0]?.sid; if (anyPane(d.id, 'terminal')) u.redrawTerms?.(); }
  else if (d.ev === 'closed') { const s = servers.find(x => x.id === d.id); const r = s && rulesFor(s).find(x => x.metric === 'disconnect');
    if (s && !u.userClosed && r?.enabled) raiseAlert(s, 'Disconnected unexpectedly'); else toast('Connection closed', !u.userClosed); u.userClosed = false; u.terms = [];
    if (s && s.quick) uc.call('servers:purgetemp', d.id).catch(() => {});
    refresh(); }
  else if (d.ev === 'progress') { let p = $('#prog'); if (!p) { p = el('<div id="prog" class="pill prog"></div>'); document.body.append(p); }
    p.innerHTML = `<span>${esc(d.name)} ${d.tot ? Math.round(100 * d.t / d.tot) + '%' : fmtB(d.t)}</span><i class="pbar"><b style="width:${d.tot ? Math.round(100 * d.t / d.tot) : 0}%"></b></i>${d.cx ? '<b class="pcx" title="Cancel">✕</b>' : ''}`;
    const x = p.querySelector('.pcx'); if (x) x.onclick = () => { uc.call('fs:cancel', d.cx).catch(() => {}); p.remove(); };
    clearTimeout(p._t); p._t = setTimeout(() => p.remove(), 1500); }
  else if (d.ev === 'toast') toast(d.message, true);
});
window.addEventListener('resize', () => { for (const p of panes) { if (p.tab !== 'terminal') continue; const u = S(p.srv); const t = u.terms.find(t => t.sid === u.activeTerm); if (t) t.fit.fit(); } });

// ---------- Files (SFTP): one pane per server — open a second pane to drag files between servers
function fpane(srvId, F, onOther) {
  // F = per-pane state { cwd, sel }. Returns { node, load }. Rows are draggable onto the sibling pane.
  F.sel ||= new Set(); const isLocal = srvId === '__local';
  const node = el(`<div class="fpane"><div class="fhead"><button class="sm" data-r="up" title="Up one folder">↑</button><div class="crumbs grow" data-r="crumbs"></div><button class="sm" data-r="rf" title="Refresh">⟳</button></div>
    <div class="fhead2" data-r="tools"><button class="sm" data-r="mk" title="New folder">+ Folder</button><button class="sm" data-r="nf" title="New file">+ File</button><span class="spacer"></span><button class="sm" data-r="dl" title="Download selected">Download</button><button class="sm" data-r="rn" title="Rename selected">Rename</button><button class="sm danger" data-r="rm" title="Delete selected">Delete</button></div>
    <div class="scroll flist"><table class="list"><tbody data-r="fl"></tbody></table></div></div>`);
  let items = [];
  const q = r => node.querySelector(`[data-r="${r}"]`);
  const load = async () => {
    if (!F.cwd) F.cwd = isLocal ? await uc.call('lfs:home') : await call('fs:home', srvId);
    try { items = isLocal ? await uc.call('lfs:list', F.cwd) : await uc.call('fs:list', srvId, F.cwd); } catch (e) { toast(e.message, true); items = []; }
    F.sel.clear(); const parts = F.cwd.split('/').filter(Boolean);
    q('crumbs').innerHTML = `<a data-p="/">/</a>` + parts.map((p, i) => `<a data-p="/${parts.slice(0, i + 1).join('/')}">${esc(p)}</a><span class="muted">/</span>`).join('');
    q('crumbs').querySelectorAll('a').forEach(a => a.onclick = () => { F.cwd = a.dataset.p; load(); });
    q('fl').innerHTML = items.map((f, i) => `<tr data-i="${i}" draggable="true"><td>${f.dir ? '📁' : f.link ? '🔗' : '📄'} ${esc(f.name)}</td><td class="right muted">${f.dir ? '' : fmtB(f.size)}</td><td class="muted small">${new Date(f.mtime).toLocaleString('en-GB')}</td></tr>`).join('') || '<tr><td colspan=3 class="muted">Empty folder</td></tr>';
    q('fl').querySelectorAll('tr[data-i]').forEach(r => {
      const f = items[r.dataset.i], p = pjoin(F.cwd, f.name);
      r.onclick = e => { if (!e.ctrlKey && !e.shiftKey) { F.sel.clear(); q('fl').querySelectorAll('tr').forEach(x => x.classList.remove('sel')); } F.sel.has(p) ? F.sel.delete(p) : F.sel.add(p); r.classList.toggle('sel', F.sel.has(p)); };
      r.ondblclick = () => f.dir || f.link && !f.size ? (F.cwd = p, load()) : isLocal ? null : editFile(srvId, p);
      r.ondragstart = e => { e.dataTransfer.setData('application/x-uc-row', JSON.stringify({ srv: srvId, path: p, dir: f.dir, local: isLocal })); e.dataTransfer.effectAllowed = 'copy'; };
    });
  };
  q('up').onclick = () => { F.cwd = pdir(F.cwd); load(); }; q('rf').onclick = load;
  if (isLocal) q('tools').style.display = 'none';
  q('mk').onclick = async () => { const n = await prompt2('New folder name'); if (n) { await call('fs:mkdir', srvId, pjoin(F.cwd, n)); load(); } };
  q('nf').onclick = async () => { const n = await prompt2('New file name'); if (n) { await call('fs:write', srvId, pjoin(F.cwd, n), ''); load(); } };
  q('rn').onclick = async () => { const [p] = F.sel; if (!p) return toast('Select something first', true); const n = await prompt2('Rename to', p.split('/').pop()); if (n) { await call('fs:rename', srvId, p, pjoin(pdir(p), n)); load(); } };
  q('rm').onclick = async () => { if (!F.sel.size) return toast('Select something first', true); if (!confirm(`Delete ${F.sel.size} item(s)? Folders are deleted with everything inside.`)) return; for (const p of F.sel) await call('fs:remove', srvId, p); load(); };
  q('dl').onclick = async () => { if (!F.sel.size) return toast('Select something first', true); const d = await call('fs:download', srvId, [...F.sel]); if (d) toast('Downloaded to ' + d); };
  // drop target: rows from the other pane (server->server copy) or OS files (upload)
  let dragN = 0; const drop = el('<div class="drop hidden">Drop here</div>'); node.append(drop);
  node.ondragenter = e => { e.preventDefault(); dragN++; drop.classList.remove('hidden'); };
  node.ondragleave = () => { if (--dragN <= 0) { dragN = 0; drop.classList.add('hidden'); } };
  node.ondragover = e => e.preventDefault();
  node.ondrop = async e => {
    e.preventDefault(); dragN = 0; drop.classList.add('hidden');
    const row = e.dataTransfer.getData('application/x-uc-row');
    if (row) { const r = JSON.parse(row); if (r.srv === srvId && pdir(r.path) === F.cwd) return;
      try {
        if (r.local) await call('fs:upload', srvId, [r.path], F.cwd); // local file -> remote pane
        else if (isLocal) await call('fs:downloadTo', r.srv, r.path, F.cwd); // remote file -> this device
        else { const cx = 'c' + Date.now().toString(36); await call('fs:copy', r.srv, r.path, srvId, F.cwd, cx); } // server -> server
        toast('Copied');
      } catch {} load(); onOther && onOther(); return; }
    const paths = [...e.dataTransfer.files].map(f => uc.pathFor(f)).filter(Boolean);
    if (!paths.length) return; await call('fs:upload', srvId, paths, F.cwd); toast(`Uploaded ${paths.length} item(s)`); load();
  };
  return { node, load };
}
async function vFiles(s, u, v) {
  if (!s.connected) { v.innerHTML = notConn(s); return; }
  const peers = servers.filter(x => x.connected && isSsh(x));
  if (APP.platform === 'desktop') peers.push({ id: '__local', name: 'This device', connType: 'ssh', connected: true });
  u.f1 ||= {}; u.f2 ||= {};
  if (u.peer && !peers.find(x => x.id === u.peer)) u.peer = null;
  v.innerHTML = `<div class="files"><div class="fbar"><b>Files</b><span class="spacer"></span>
    ${u.peer ? `<select id="peerSel">${peers.map(x => `<option value="${x.id}" ${x.id === u.peer ? 'selected' : ''}>${esc(x.name || x.host)}</option>`).join('')}</select>` : ''}
    <button class="sm" id="twoP">${u.peer ? 'Single pane' : '⇄ Two panes'}</button></div><div class="fcols ${u.peer ? 'two' : ''}" id="fcols"></div></div>`;
  const cols = $('#fcols', v);
  const a = fpane(s.id, u.f1, () => b && b.load()); cols.append(a.node); a.load();
  let b = null;
  if (u.peer) { b = fpane(u.peer, u.f2, () => a.load()); cols.append(b.node); b.load(); }
  $('#twoP', v).onclick = () => { if (u.peer) { u.peer = null; } else { u.peer = peers.find(x => x.id !== s.id)?.id || s.id; } vFiles(s, u, v); };
  const ps = $('#peerSel', v); if (ps) ps.onchange = () => { u.peer = ps.value; u.f2 = {}; vFiles(s, u, v); };
}
// ---------- global shortcuts: Ctrl+T/W/1-9/F for terminals in the focused pane
document.addEventListener('keydown', e => {
  if (!e.ctrlKey || e.target.closest('input,textarea,select')) return;
  const p = panes[focusPane]; if (!p || p.tab !== 'terminal') { if (e.key === 'f' || e.key === 'F') { if (p && p.tab === 'terminal') { e.preventDefault(); } } return; }
  const u = S(p.srv); const k = e.key.toLowerCase();
  if (k === 't') { e.preventDefault(); u.newT && u.newT(); }
  else if (k === 'w') { e.preventDefault(); if (u.activeTerm) uc.send('shell:close', p.srv, u.activeTerm); }
  else if (k === 'f') { e.preventDefault(); u.search && u.search.open(); }
  else if (/^[1-9]$/.test(e.key)) { const i = +e.key - 1; if (u.terms[i]) { e.preventDefault(); u.activeTerm = u.terms[i].sid; u.redrawTerms && u.redrawTerms(); } }
});
function pickList(title, labels, vals) { return new Promise(res => { // chooser: click a row -> vals[i]; shows EVERY option
  const rows = labels.map((l, i) => {
    const main = typeof l === 'string' ? l : (l.main || String(l));
    const sub = typeof l === 'object' && l.sub ? `<div class="pip-sub">${esc(l.sub)}</div>` : '';
    return `<div class="pickrow" data-i="${i}" role="button" tabindex="0"><span class="pip">${i + 1}</span><div><div class="pip-host">${esc(main)}</div>${sub}</div></div>`;
  }).join('');
  const m = el(`<div class="modal-bg"><div class="modal" style="width:440px"><header><h3>${esc(title)}</h3></header><div class="body picklist-body">${rows || '<p class="muted" style="padding:12px 16px">Nothing to pick</p>'}</div><footer><span class="spacer"></span><button id="c">Cancel</button></footer></div></div>`);
  document.body.append(m); focusModal(m);
  m.querySelector('#c').onclick = () => { m.remove(); res(null); };
  const choose = i => { const v = vals[i]; m.remove(); res(v); };
  m.querySelectorAll('.pickrow').forEach(r => {
    r.onclick = () => choose(+r.dataset.i);
    r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(+r.dataset.i); } };
  });
}); }

function prompt2(title, val = '', pw = false) { return new Promise(res => {
  const m = el(`<div class="modal-bg"><div class="modal"><header><h3>${esc(title)}</h3></header><div class="body"><input ${pw ? 'type="password"' : ''}></div><footer><button id="c">Cancel</button><button class="primary" id="o">OK</button></footer></div></div>`);
  document.body.append(m); focusModal(m); const i = m.querySelector('input'); i.value = val; if (!pw) i.select(); i.focus();
  const done = v => { m.remove(); res(v); }; m.querySelector('#c').onclick = () => done(null); m.querySelector('#o').onclick = () => done(i.value.trim());
  i.onkeydown = e => { if (e.key === 'Enter') done(i.value.trim()); if (e.key === 'Escape') done(null); }; }); }

// ---------- Port forwards
function vForwards(s, u, v) {
  const fw = s.forwards || [];
  const stat = id => s.fwdStatus?.find(x => x.id === id) || { active: false };
  const pubNote = APP.hostNet ? ' · any PC port works (host networking)' : APP.fwdPorts ? ` · PC port must be published by the container (${fmtPorts(APP.fwdPorts)}); add -p mappings and set UC_FWD_PORTS for others` : '';
  v.innerHTML = `<div class="card"><div class="card-title grow">Port forwards <span class="muted">· "PC listens" puts a server port at localhost:port on this PC · "Server listens" puts a PC port on the server${esc(pubNote)}</span></div>
    <table class="list"><thead><tr><th>Name</th><th>Direction</th><th>Server host</th><th>Server port</th><th>PC host</th><th>PC port</th><th>Auto</th><th>Status</th><th></th></tr></thead><tbody>
    ${fw.map((f, i) => { const a = stat(f.id); const remote = f.dir === 'remote'; return `<tr data-i="${i}"><td><input data-k="name" value="${esc(f.name)}"></td>
      <td><select data-k="dir" ${f.builtin ? 'disabled' : ''}><option value="local" ${!remote ? 'selected' : ''}>PC listens</option><option value="remote" ${remote ? 'selected' : ''}>Server listens</option></select></td>
      <td><input data-k="remoteHost" value="${esc(f.remoteHost)}" title="${remote ? 'Where the server listens' : 'Server-side target'}"></td><td style="width:100px"><input data-k="remotePort" type="number" value="${f.remotePort}"></td>
      <td style="width:130px"><input data-k="localHost" value="${esc(f.localHost || '127.0.0.1')}" ${remote ? '' : 'disabled'} title="PC-side target (Server listens only)"></td><td style="width:100px"><input data-k="localPort" type="number" value="${f.localPort}"></td>
      <td><input type="checkbox" data-k="auto" ${f.auto ? 'checked' : ''} title="Start when connecting"></td>
      <td>${a.active ? `<span class="pill ok">● On${a.conns ? ' · ' + a.conns : ''}</span>` : '<span class="pill">Off</span>'}</td>
      <td class="nowrap right">${a.active ? `${!remote ? `<a href="#" data-open="${f.localPort}">open</a>` : ''} <button class="sm" data-stop="${f.id}">Stop</button>` : `<button class="sm primary" data-start="${i}" ${s.connected ? '' : 'disabled'}>Start</button>`} ${f.builtin ? '' : `<button class="sm danger" data-del="${i}">✕</button>`}</td></tr>`; }).join('')}
    </tbody></table><div class="row" style="margin-top:12px"><button class="sm" id="addF">+ Add forward</button><span class="spacer"></span><span class="muted small">Edits save automatically · remote listens need AllowTcpForwarding in sshd_config</span></div></div>`;
  const persist = async () => { await call('servers:forwards', s.id, fw); };
  v.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => { const f = fw[inp.closest('tr').dataset.i]; f[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.value;
    if (inp.dataset.k === 'dir') { inp.closest('tr').querySelector('[data-k="localHost"]').disabled = f.dir !== 'remote'; }
    persist(); });
  v.querySelectorAll('[data-start]').forEach(b => b.onclick = async () => { const f = fw[b.dataset.start];
    if (f.dir !== 'remote') { const c = await uc.call('fwd:check', f.localPort); if (!c.free) return toast(`Port ${f.localPort} is already in use on this PC, pick another PC port`, true); }
    await call('fwd:start', s.id, f); refresh(); });
  v.querySelectorAll('[data-stop]').forEach(b => b.onclick = async () => { await call('fwd:stop', s.id, b.dataset.stop); refresh(); });
  v.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const f = fw[b.dataset.del]; if (s.connected) await uc.call('fwd:stop', s.id, f.id).catch(() => {}); fw.splice(b.dataset.del, 1); await persist(); refresh(); });
  v.querySelectorAll('[data-open]').forEach(a => a.onclick = e => { e.preventDefault(); if (a._busy) return; a._busy = true; setTimeout(() => a._busy = false, 1200); window.open('http://localhost:' + a.dataset.open + '/'); });
  $('#addF').onclick = async () => { // pick the lowest free port — in Docker, from the published pool so it just works
    let lp = (APP.fwdPorts || []).find(p => !fw.some(f => +f.localPort === p)); if (!lp) { lp = 3000; while (fw.some(f => +f.localPort === lp)) lp++; }
    fw.push({ id: 'f' + Date.now(), name: 'New forward', remoteHost: '127.0.0.1', remotePort: lp, localPort: lp, auto: false }); await persist(); refresh(); };
}
const fmtPorts = ps => ps.length > 8 ? `${ps[0]}–${ps[ps.length - 1]} (+${ps.length - 2} more)` : ps.join(', ');

// ---------- History: local audit log. Events only — never keystrokes, file contents or secrets.
async function vHistory(s, u, v) {
  const on = await uc.call('history:get').catch(() => true);
  const events = await uc.call('history:list', 500).catch(() => []);
  v.innerHTML = `<div class="card"><div class="row" style="margin-bottom:10px"><div class="card-title grow">Activity log <span class="muted">· connections, forwards, file ops and commands — never passwords, keys or terminal data</span></div>
    <label class="row small" style="gap:6px"><input type="checkbox" id="hOn" ${on ? 'checked' : ''}> Record activity</label><button class="sm danger" id="hClr">Clear</button></div>
    <div class="scroll"><table class="list"><thead><tr><th>Time</th><th>Server</th><th>Event</th><th>Detail</th></tr></thead><tbody>
    ${events.map(e => `<tr class="${e.s === s.id ? 'hcur' : ''}"><td class="muted small nowrap">${new Date(e.t).toLocaleString('en-GB')}</td><td>${esc(e.n || '—')}</td><td><span class="pill small">${esc(e.ev)}</span></td><td class="mono small" style="overflow-wrap:anywhere">${esc(e.d || '')}</td></tr>`).join('') || '<tr><td colspan=4 class="muted">Nothing recorded yet</td></tr>'}
    </tbody></table></div></div>`;
  $('#hOn', v).onchange = e => uc.call('history:set', e.target.checked).catch(() => {});
  $('#hClr', v).onclick = async () => { if (!confirm('Delete the whole activity log?')) return; await call('history:clear'); vHistory(s, u, v); };
}

// ---------- Add / edit server
function editServer(s = {}) {
  const auth = s.auth || 'password', ct = s.connType || 'ssh';
  const canTelnet = !ON_MOBILE, canSerial = !ON_MOBILE && APP.platform !== 'web', canLocal = !ON_MOBILE, canScan = !ON_MOBILE;
  const jumps = servers.filter(x => x.id !== s.id && isSsh(x) && !x.quick);
  const groupList = [...new Set(servers.map(x => x.group).filter(Boolean))];
  const m = el(`<div class="modal-bg"><div class="modal"><header><h3>${s.id ? `Edit connection` : `Add connection`}</h3></header><div class="body">
    <label class="field"><span>Name</span><input id="n" placeholder="Home server" value="${esc(s.name)}"></label>
    ${canTelnet || canSerial || canLocal ? `<div class="seg" style="margin-bottom:12px;flex-wrap:wrap"><button data-c="ssh">SSH</button>${canTelnet ? '<button data-c="telnet">Telnet</button><button data-c="raw">Raw TCP</button>' : ''}${canSerial ? '<button data-c="serial">Serial</button>' : ''}${canLocal ? '<button data-c="local">Local shell</button>' : ''}</div>` : ''}
    <div id="ctLoc" class="hidden"><p class="muted small" style="margin-bottom:12px">A terminal on ${APP.platform === 'web' ? 'the machine running this Docker app' : 'this device'} — no server needed. Commands only (no full-screen apps like vim).</p></div>
    <div id="ctNet"><div class="row"><label class="field grow"><span>Host / IP</span><input id="h" placeholder="192.168.1.20" value="${esc(s.host)}"></label><label class="field" style="width:90px"><span>Port</span><input id="p" type="number" value="${s.port || 22}"></label></div>
    <div class="row" style="margin:-4px 0 12px">${canScan ? '<button class="sm" id="scan">Find on my network</button>' : ''}${APP.platform === 'desktop' && !s.id ? '<button class="sm" id="impSsh">Import ~/.ssh/config</button>' : ''}</div></div>
    <div id="ctSer" class="hidden"><div class="row"><label class="field grow"><span>Serial port</span><select id="sp"><option value="">loading…</option></select></label>
      <label class="field" style="width:130px"><span>Baud</span><select id="bd">${[300, 1200, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map(b => `<option ${b === (s.baudRate || 115200) ? 'selected' : ''}>${b}</option>`).join('')}</select></label></div>
      <div class="row" style="margin:-4px 0 12px"><button class="sm" id="spr">⟳ Refresh ports</button><span class="muted small">USB and paired Bluetooth devices appear as COM/serial ports</span></div></div>
    <div id="ctSsh">
    <div class="msec">Sign in</div>
    <label class="field"><span>Username</span><input id="u" value="${esc(s.username)}"></label>
    <div class="seg" style="margin-bottom:12px"><button data-a="password">Password</button><button data-a="key">SSH key</button><button data-a="keypass">Key + password</button></div>
    <div id="pw"><label class="field"><span>Password</span><input id="pass" type="password" placeholder="${s.has_password ? '•••••• saved (leave blank to keep)' : ''}"></label></div>
    <div id="ky"><label class="field"><span>Private key ${s.keyName ? '· ' + esc(s.keyName) : ''}</span><textarea id="key" rows="4" class="mono" placeholder="${s.has_privateKey ? 'Key saved (leave blank to keep). ' : ''}Paste -----BEGIN OPENSSH PRIVATE KEY----- …"></textarea></label>
      <div class="row" style="margin:-4px 0 12px"><button class="sm" id="pick">Choose key file…</button><span class="muted small" id="kn"></span></div>
      <label class="field"><span>Key passphrase (optional)</span><input id="pp" type="password" placeholder="${s.has_passphrase ? '•••••• saved' : ''}"></label></div>
    <div id="ctAdv"><div class="msec">Advanced</div>
    <div class="row"><label class="field grow"><span>Group</span><input id="grp" list="grps" placeholder="e.g. home" value="${esc(s.group || '')}"><datalist id="grps">${groupList.map(g => `<option value="${esc(g)}">`).join('')}</datalist></label>
    <label class="field grow"><span>MAC address (Wake-on-LAN)</span><input id="mac" placeholder="AA:BB:CC:DD:EE:FF" value="${esc(s.mac || '')}"></label></div>
    <label class="field"><span>Jump host (reach this server through another connection)</span><select id="jh"><option value="">None</option>${jumps.map(j => `<option value="${j.id}" ${s.jumpId === j.id ? 'selected' : ''}>${esc(j.name || j.host)}</option>`).join('')}</select></label></div>
    <div class="msec">Admin</div>
    <label class="field"><span>sudo password (optional)</span><input id="spw" type="password" placeholder="${s.has_sudoPassword ? '•••••• saved (leave blank to keep)' : 'Leave blank to use your login password'}"></label>
    <p class="muted small">Passwords and keys are encrypted on this device and never leave it. With "Key + password" the key is tried first and the password is the fallback.</p><div id="tr" class="small"></div>
    </div></div>
    <footer>${s.id ? '<button class="danger" id="del">Delete</button><span class="spacer"></span>' : ''}<button id="c">Cancel</button><button id="t">Test</button><button id="ts">Test sudo</button><button class="primary" id="sv">Save</button></footer></div></div>`);
  document.body.append(m); focusModal(m); let a = auth, ctype = ct, keyName = s.keyName;
  const setC = x => { ctype = x; m.querySelectorAll('[data-c]').forEach(b => b.classList.toggle('active', b.dataset.c === x));
    m.querySelector('#ctSsh').classList.toggle('hidden', x !== 'ssh'); m.querySelector('#ctSer').classList.toggle('hidden', x !== 'serial');
    m.querySelector('#ctNet').classList.toggle('hidden', x === 'serial' || x === 'local'); m.querySelector('#ctLoc').classList.toggle('hidden', x !== 'local');
    m.querySelector('#ctAdv').classList.toggle('hidden', x !== 'ssh');
    m.querySelector('#p').value = x === 'telnet' ? (s.port || 23) : (s.port || 22);
    if (x === 'serial') ports(); };
  m.querySelectorAll('[data-c]').forEach(b => b.onclick = () => setC(b.dataset.c)); setC(canTelnet || canSerial || canLocal ? ct : 'ssh');
  const sc = m.querySelector('#scan'); if (sc) sc.onclick = async () => { sc.disabled = true; sc.textContent = 'Scanning…';
    try {
      const ips = [...new Set(await uc.call('net:scan') || [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (!ips.length) return toast('Nothing with SSH open found on this network', true);
      if (ips.length === 1) {
        m.querySelector('#h').value = ips[0];
        toast('Found ' + ips[0]);
      } else {
        // Always list every host — never auto-pick the first when there are several
        const labels = ips.map(ip => ({ main: ip, sub: 'SSH · port 22' }));
        const ip = await pickList('SSH hosts on your network (' + ips.length + ')', labels, ips);
        if (ip) { m.querySelector('#h').value = ip; toast('Selected ' + ip); }
      }
    } catch (e) { toast(e.message, true); } finally { sc.disabled = false; sc.textContent = 'Find on my network'; } };
  const imp = m.querySelector('#impSsh'); if (imp) imp.onclick = async () => {
    try { const list = await uc.call('servers:importSsh');
      if (!list.length) return toast('No usable hosts found in ~/.ssh/config', true);
      const picks = await pickChecks(list.map(x => `${x.name}  ·  ${x.username ? x.username + '@' : ''}${x.host}:${x.port}${x.keyName ? '  ·  ' + x.keyName : ''}`), list.map((_, i) => i));
      for (const i of picks || []) { const x = list[i]; await uc.call('servers:save', { name: x.name, host: x.host, port: x.port, username: x.username, auth: x.privateKey ? 'key' : 'password', privateKey: x.privateKey || '', keyName: x.keyName, connType: 'ssh' }); }
      if (picks && picks.length) { toast(`Imported ${picks.length} connection(s)`); m.remove(); refresh(); }
    } catch (e) { toast(e.message, true); } };
  const setA = x => { a = x; m.querySelectorAll('[data-a]').forEach(b => b.classList.toggle('active', b.dataset.a === x));
    m.querySelector('#pw').classList.toggle('hidden', x === 'key'); m.querySelector('#ky').classList.toggle('hidden', x === 'password'); };
  m.querySelectorAll('[data-a]').forEach(b => b.onclick = () => setA(b.dataset.a)); setA(auth);
  async function ports() { const sel = m.querySelector('#sp'); sel.innerHTML = '<option value="">loading…</option>';
    try { const l = await uc.call('serial:list'); sel.innerHTML = (s.serialPath ? '' : '<option value="">choose…</option>') + l.map(p => `<option value="${esc(p.path)}" ${p.path === s.serialPath ? 'selected' : ''}>${esc(p.name)}</option>`).join('') || '<option value="">no ports found</option>'; }
    catch (e) { sel.innerHTML = `<option value="">${esc(e.message)}</option>`; } }
  m.querySelector('#spr').onclick = ports; if (ct === 'serial') ports();
  m.querySelector('#pick').onclick = async () => { const k = await call('key:pick'); if (k) { m.querySelector('#key').value = k.text; keyName = k.name; m.querySelector('#kn').textContent = k.name; } };
  let hk = s.hostKey;
  const val = () => ({ id: s.id, hostKey: hk, connType: ctype, name: m.querySelector('#n').value.trim(), host: m.querySelector('#h').value.trim(), port: m.querySelector('#p').value,
    serialPath: m.querySelector('#sp')?.value, baudRate: +m.querySelector('#bd')?.value || 115200,
    username: m.querySelector('#u').value.trim(), auth: a, keyName,
    group: m.querySelector('#grp')?.value.trim() || '', mac: m.querySelector('#mac')?.value.trim() || '', jumpId: m.querySelector('#jh')?.value || '',
    password: m.querySelector('#pass').value, privateKey: m.querySelector('#key').value.trim() ? m.querySelector('#key').value.trim() + '\n' : '', passphrase: m.querySelector('#pp').value,
    sudoPassword: m.querySelector('#spw').value });
  m.querySelector('#c').onclick = () => m.remove();
  m.querySelector('#t').onclick = async () => { const tr = m.querySelector('#tr'); tr.innerHTML = '<span class="pill">Testing…</span>';
    try { let r; try { r = await uc.call('servers:test', val()); } catch (e) { const k = hostKeyErr(e); if (!k) throw e;
        if (!await trustPrompt({ ...val(), hostKey: hk }, k)) throw new Error('Host key not trusted'); hk = k.fp; r = await uc.call('servers:test', val()); } tr.innerHTML = `<span class="pill ok">✓ Connected · ${esc(r.info)}</span>`; } catch (e) { tr.innerHTML = `<span class="pill err">✕ ${esc(e.message)}</span>`; } };
  m.querySelector('#ts').onclick = async () => { const tr = m.querySelector('#tr'); tr.innerHTML = '<span class="pill">Testing sudo…</span>';
    try { const r = await uc.call('sudo:test', val(), m.querySelector('#spw').value || undefined);
      tr.innerHTML = r.ok ? `<span class="pill ok">✓ ${esc(r.info)}</span>` : `<span class="pill err">✕ ${esc(r.info)}</span>`; }
    catch (e) { const k = hostKeyErr(e); if (k && await trustPrompt({ ...val(), hostKey: hk }, k)) { hk = k.fp; const r = await uc.call('sudo:test', val(), m.querySelector('#spw').value || undefined).catch(x => { throw x; });
        tr.innerHTML = r.ok ? `<span class="pill ok">✓ ${esc(r.info)}</span>` : `<span class="pill err">✕ ${esc(r.info)}</span>`; }
      else tr.innerHTML = `<span class="pill err">✕ ${esc(e.message)}</span>`; } };
  m.querySelector('#sv').onclick = async () => { const v = val();
    if (ctype === 'ssh' && (!v.host || !v.username)) return toast('Host and username are required', true);
    if ((ctype === 'telnet' || ctype === 'raw') && !v.host) return toast('Host is required', true);
    if (ctype === 'serial' && !v.serialPath) return toast('Pick a serial port', true);
    if (!v.name) v.name = ctype === 'serial' ? v.serialPath : v.host; panes[focusPane].srv = await call('servers:save', v); m.remove(); refresh(); };
  if (s.id) m.querySelector('#del').onclick = async () => { if (!confirm(`Delete ${s.name}?`)) return; S(s.id).userClosed = true; await call('servers:delete', s.id); delete st[s.id]; panes.forEach(p => { if (p.srv === s.id) p.srv = null; }); m.remove(); refresh(); };
}
// ---------- quick connect (one-off, never saved) + app settings
function quickDialog() {
  const m = el(`<div class="modal-bg"><div class="modal" style="width:430px"><header><h3>Quick connect</h3></header><div class="body">
    <p class="muted small" style="margin-bottom:12px">Connect once without saving — the connection disappears when you disconnect.</p>
    <label class="field"><span>Address</span><input id="qh" placeholder="192.168.1.20  or  root@192.168.1.20:2222"></label>
    <div class="row"><label class="field grow"><span>Username</span><input id="qu" placeholder="root"></label>
    <label class="field grow"><span>Password</span><input id="qp" type="password"></label></div><div id="qr" class="small"></div></div>
    <footer><span class="spacer"></span><button id="c">Cancel</button><button class="primary" id="o">Connect</button></footer></div></div>`);
  document.body.append(m); focusModal(m); const $i = q => m.querySelector(q);
  $i('#qh').focus(); m.querySelector('#c').onclick = () => m.remove();
  const parse = () => { const [a, rest] = $i('#qh').value.trim().split('@'); const hasU = !!rest; const [host, port] = (rest || a).split(':');
    return { host: host || '', port: port || 22, username: (hasU ? a : '') || $i('#qu').value.trim() || 'root', password: $i('#qp').value }; };
  const go = async () => { const v = parse(); if (!v.host) return toast('Host is required', true);
    $i('#o').disabled = true; $i('#o').textContent = 'Connecting…';
    try { const id = await uc.call('conn:quick', v); m.remove(); panes[focusPane].srv = id; panes[focusPane].tab = 'terminal'; refresh(); }
    catch (e) { const k = hostKeyErr(e);
      if (k) { await refresh(); const s = servers.find(x => x.quick && x.host === v.host);
        if (s && await trustPrompt(s, k)) { await call('servers:hostkey', s.id, k.fp); m.remove(); panes[focusPane].srv = s.id; connect(s.id); return; }
        if (s) await call('servers:purgetemp', s.id); }
      $i('#qr').innerHTML = `<span class="pill err">✕ ${esc(e.message)}</span>`; $i('#o').disabled = false; $i('#o').textContent = 'Connect'; } };
  $i('#o').onclick = go; $i('#qp').onkeydown = e => e.key === 'Enter' && go(); $i('#qh').onkeydown = e => e.key === 'Enter' && go();
}
function settingsDialog() {
  const curT = localStorage.getItem('uc.ttheme') || 'dark';
  const curA = localStorage.getItem(THEME_KEY) || 'dark';
  const themes = [['dark', 'Dark'], ['light', 'Light'], ['solarized', 'Solarized'], ['dracula', 'Dracula'], ['monokai', 'Monokai'], ['system', 'System']];
  const m = el(`<div class="modal-bg"><div class="modal" style="width:400px"><header><h3>Settings</h3></header><div class="body">
    <label class="field"><span>App theme</span><select id="th">${themes.map(([v, l]) => `<option value="${v}" ${v === curA ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field"><span>Terminal theme</span><select id="tt">${Object.keys(TERM_THEMES).map(t => `<option value="${t}" ${t === curT ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></label>
    <p class="muted small">App theme colours the whole UI (including Solarized, Dracula and Monokai). Picking an app theme also matches the terminal; you can still override the terminal below. Both save on this device.</p></div>
    <footer><span class="spacer"></span><button class="primary" id="o">Done</button></footer></div></div>`);
  document.body.append(m); focusModal(m);
  m.querySelector('#th').onchange = e => {
    applyTheme(e.target.value);
    // Match terminal to app chrome when user flips app theme (still overridable below)
    const r = resolvedTheme();
    if (TERM_THEMES[r]) { m.querySelector('#tt').value = r; applyTermTheme(r); }
  };
  m.querySelector('#tt').onchange = e => applyTermTheme(e.target.value);
  m.querySelector('#o').onclick = () => m.remove();
}
const applyTermTheme = name => { localStorage.setItem('uc.ttheme', name); const t = termTheme();
  document.documentElement.style.setProperty('--tbg', t.background); // the .termhost frame follows the theme
  for (const id in st) for (const x of st[id].terms || []) { try { x.term.options.theme = t; x.term.refresh(0, x.term.rows - 1); } catch {} } };
$('#addSrv').onclick = () => editServer();
$('#quickB').onclick = () => quickDialog();
$('#setB').onclick = () => settingsDialog();
$('#bakB').onclick = () => backupDialog();
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b) return; if (b.dataset.act === 'add') editServer(); if (b.dataset.act === 'connect') { b.disabled = true; b.textContent = 'Connecting…'; connect(b.dataset.id); } });
// Docker without host networking: tell the user forwards are limited to the published pool,
// with the exact commands to unlock any port or publish more. Re-checks every 30 s so it
// appears/disappears live when the mode changes (container recreated on/off host network).
async function hnPoll() {
  const i = await uc.call('app:info').catch(() => null); if (!i || i.platform !== 'web') return;
  const was = APP.hostNet; APP.hostNet = i.hostNet; APP.fwdPorts = i.fwdPorts;
  if (!!was !== !!APP.hostNet) { APP.hostNet ? hnHide() : hnShow(); refresh(); }
}
function hnShow() {
  if ($('#hnBar')) return;
  const b = el(`<div id="hnBar"><span>⛁ Docker mode — forwards can only use PC ports <b>${fmtPorts(APP.fwdPorts || [])}</b>. <a href="#" id="hnMore">Use any port</a></span><button class="sm" id="hnR" title="Re-check host networking">⟳</button><button class="sm" id="hnX" title="Dismiss">✕</button></div>`);
  document.body.append(b);
  b.querySelector('#hnX').onclick = () => b.remove();
  b.querySelector('#hnR').onclick = hnPoll;
  b.querySelector('#hnMore').onclick = e => { e.preventDefault(); hnDialog(); };
}
function hnHide() { $('#hnBar')?.remove(); }
function hnDialog() {
  const m = el(`<div class="modal-bg"><div class="modal" style="width:580px"><header><h3>Use any PC port in Docker</h3></header><div class="body small">
    <p><b>Option 1 — host networking (recommended).</b> The container shares this PC's network, so every port works:</p>
    <p class="muted">1. Docker Desktop → <b>Settings → Resources → Network</b> → tick <b>Enable host networking</b> → Apply &amp; restart<br>
    2. Recreate the container in host mode:</p>
    <pre class="mono small uilog" style="max-height:none">docker compose -f docker-compose.hostnet.yml up -d</pre>
    <p>or without compose:</p>
    <pre class="mono small uilog" style="max-height:none">docker run -d --name uiable-connect --network host -e UC_HOST_NET=1 -v uiable-connect-data:/data ghcr.io/alfieelawrence/uiable-connect:latest</pre>
    <p class="muted">Then click ⟳ on the banner — it disappears when host networking is detected.</p>
    <p><b>Option 2 — publish one more port.</b> Docker can't open new PC ports on a running container, so recreate it with the port added:</p>
    <pre class="mono small uilog" style="max-height:none">ports:
  - "127.0.0.1:PORT:PORT"
environment:
  UC_FWD_PORTS: "8000-8099,PORT"
# then: docker compose up -d</pre></div>
    <footer><span class="spacer"></span><button class="primary" id="c">Done</button></footer></div></div>`);
  document.body.append(m); m.querySelector('#c').onclick = () => m.remove();
}
(async () => { const t = termTheme(); document.documentElement.style.setProperty('--tbg', t.background); // restore terminal theme
  setTimeout(() => $('#boot')?.classList.add('gone'), 6000); // never trap the UI behind the splash
  try {
    APP = await (window.uc ? uc.call('app:info') : Promise.reject()).catch(() => ({ platform: ON_MOBILE ? 'mobile' : 'desktop' }));
    await refresh();
  } catch (e) { console.error(e); try { renderMain(); } catch (_) {} }
  $('#boot')?.classList.add('gone');
  if (APP && APP.platform === 'web') { if (!APP.hostNet && localStorage.getItem('uc.hn.dismiss') !== '1') hnShow(); setInterval(hnPoll, 30000); } })();

// ---- "new version available" banner: checks GitHub at most every 6 h, silent on any failure
(async function checkUpdate() {
  const K = 'uc.update';
  // Strip leading "v", ignore build/+meta and prerelease for the numeric compare; only show banner when remote is STRICTLY newer.
  const verParts = (s) => String(s || '').trim().replace(/^v/i, '').split(/[+-]/)[0].split('.').map(p => parseInt(p, 10) || 0);
  const newer = (a, b) => { const x = verParts(a), y = verParts(b); for (let i = 0; i < Math.max(x.length, y.length, 3); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  const sameVer = (a, b) => { const x = verParts(a), y = verParts(b); const n = Math.max(x.length, y.length, 3); for (let i = 0; i < n; i++) if ((x[i] || 0) !== (y[i] || 0)) return false; return true; };
  try {
    let c = JSON.parse(localStorage.getItem(K) || 'null');
    if (!c || Date.now() - c.t > 6 * 3600e3) { const r = await uc.call('app:update'); if (!r || !r.latest) return;
      const latestNorm = String(r.latest).trim().replace(/^v/i, '').split(/[+-]/)[0];
      if (!/^\d+\.\d+\.\d+$/.test(latestNorm)) return;
      c = { t: Date.now(), ...r, latest: latestNorm, current: String(r.current || '').replace(/^v/i, '').split(/[+-]/)[0] || r.current }; localStorage.setItem(K, JSON.stringify(c)); }
    const cur = (await uc.call('app:version').catch(() => null)) || c.current;
    const latest = String(c.latest || '').replace(/^v/i, '').split(/[+-]/)[0];
    const curN = String(cur || '').replace(/^v/i, '').split(/[+-]/)[0];
    if (!latest || sameVer(latest, curN) || !newer(latest, curN) || localStorage.getItem(K + '.dismissed') === latest) return;
    c.latest = latest;
    const b = el(`<div id="updBar"><span>Uiable Connect ${esc(c.latest)} is available</span><button class="sm primary" id="updGo">Update</button><button class="sm" id="updX" title="Dismiss">✕</button></div>`);
    document.body.append(b);
    b.querySelector('#updGo').onclick = async () => { b.querySelector('#updGo').disabled = true; b.querySelector('#updGo').textContent = 'Working…';
      try { const r = await uc.call('app:selfupdate');
        if (r && r.docker) { b.remove(); const m = el(`<div class="modal-bg"><div class="modal"><header><h3>Update the Docker version</h3></header><div class="body"><p class="small">Pull the new image and restart the container:</p><pre class="mono small uilog">docker pull ghcr.io/alfieelawrence/uiable-connect:latest\ndocker compose up -d</pre></div><footer><span class="spacer"></span><button class="primary" id="c">Done</button></footer></div></div>`);
          document.body.append(m); m.querySelector('#c').onclick = () => m.remove(); }
        else if (r && r.started) { b.querySelector('span').textContent = `Updating to ${esc(r.version)} — the app restarts itself…`; }
        else if (r && r.downloaded) { toast('Update downloaded — open the dmg/zip and replace the app'); b.remove(); }
        else { b.remove(); uc.call('app:open', c.url || 'https://github.com/AlfieeLawrence/uiable-connect/releases/latest').catch(() => {}); } }
      catch (e) { toast(e.message, true); b.querySelector('#updGo').disabled = false; b.querySelector('#updGo').textContent = 'Update'; } };
    b.querySelector('#updX').onclick = () => { localStorage.setItem(K + '.dismissed', c.latest); b.remove(); };
  } catch {}
})();
