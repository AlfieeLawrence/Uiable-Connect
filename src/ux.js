'use strict';
// Uiable Connect 1.4.12 — shared UX layer (desktop, Docker web and mobile web all load it).
// Dialog plumbing (scroll lock, focus trap, Esc, focus return), confirm / typed-confirm dialogs, undo toasts,
// skeletons and empty states, the Ctrl/Cmd-K command palette, keyboard shortcuts + "?" help, the activity
// centre (bell), live sidebar status, swipe between tabs, the first-run tour and the getting-started checklist.
// Loaded before app.js: everything that touches app state runs lazily (handlers / UX.init on DOMContentLoaded).
const UX = (() => {
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const MOD = MAC ? '⌘' : 'Ctrl';
  const phone = () => matchMedia('(max-width: 760px)').matches;
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mk = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const inField = t => !!(t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]'));
  const inTerm = t => !!(t && t.closest && t.closest('.xterm'));
  const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 45 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : new Date(t).toLocaleDateString('en-GB'); };

  // ---------------------------------------------------------------- icons (one stroke set, currentColor)
  const P = {
    bell: '<path d="M6 17h12l-1.2-2.2a6.2 6.2 0 0 1-1.3-3.7V9a4.5 4.5 0 1 0-9 0v2.1c0 1.3-.45 2.6-1.3 3.7L6 17zm4.2 2.2a2 2 0 0 0 3.6 0"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    server: '<rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    term: '<path d="M4 6.5 10 12 4 17.5M12 18h8"/>',
    files: '<path d="M3.5 7.5V19a1.5 1.5 0 0 0 1.5 1.5h14A1.5 1.5 0 0 0 20.5 19V9.5A1.5 1.5 0 0 0 19 8h-7.2L9.5 5.5H5A1.5 1.5 0 0 0 3.5 7.5z"/>',
    box: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 10-14h-7l1-6z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    play: '<path d="M7 5v14l11-7z"/>',
    alert: '<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4.5M12 17.5h.01"/>',
    xfer: '<path d="M7 7h10M17 7l-3-3M17 7l-3 3M17 17H7M7 17l3-3M7 17l3 3"/>',
    upd: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/>',
    ui: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7 9.5h10M7 12.5h7"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    keyb: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>',
    expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    map: '<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z"/><path d="M9 4v14M15 6v14"/>',
    home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z"/>',
    more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  };
  const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;

  // ---------------------------------------------------------------- dialogs: ARIA, scroll lock, focus trap, Esc, focus return
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const topModal = () => { const all = [...document.querySelectorAll('.modal-bg, .ux-layer')].filter(m => m.isConnected && getComputedStyle(m).display !== 'none'); return all[all.length - 1] || null; };
  const decorate = bg => {
    if (bg._ux) return; bg._ux = true;
    bg._ret = document.activeElement;
    const d = bg.querySelector('.modal') || bg;
    if (!d.getAttribute('role')) d.setAttribute('role', bg.classList.contains('ux-alert') ? 'alertdialog' : 'dialog');
    d.setAttribute('aria-modal', 'true');
    const t = d.querySelector('header h3, h2, h3');
    if (t && !d.getAttribute('aria-labelledby') && !d.getAttribute('aria-label')) { t.id ||= 'uxdlg' + Math.random().toString(36).slice(2, 8); d.setAttribute('aria-labelledby', t.id); }
    // icon-only / symbol buttons get a name from their title
    d.querySelectorAll('button:not([aria-label])').forEach(b => { if (b.title && !/[a-z]{3}/i.test(b.textContent)) b.setAttribute('aria-label', b.title); });
  };
  const syncLock = () => {
    const open = !!document.querySelector('.modal-bg, .ux-layer.lock');
    document.documentElement.classList.toggle('modal-open', open);
  };
  new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes.forEach(n => { if (n.nodeType === 1 && (n.classList.contains('modal-bg') || n.classList.contains('ux-layer'))) decorate(n); });
      m.removedNodes.forEach(n => { if (n.nodeType === 1 && (n.classList.contains('modal-bg') || n.classList.contains('ux-layer')) && n._ret && n._ret.isConnected && !topModal()) { try { n._ret.focus({ preventScroll: true }); } catch {} } });
    }
    syncLock();
  }).observe(document.body, { childList: true });
  const closeTop = bg => {
    if (bg.dataset.noesc != null) return false;
    if (typeof bg._close === 'function') { bg._close(); return true; }
    const c = bg.querySelector('[data-close], #c, #x, #mCustCancel, #edClose, #edX');
    if (c && !c.disabled) { c.click(); return true; }
    const f = [...bg.querySelectorAll('footer button, header button')].find(b => /^(cancel|close|done|not now)$/i.test(b.textContent.trim()));
    if (f) { f.click(); return true; }
    bg.remove(); return true;
  };
  document.addEventListener('keydown', e => {
    const bg = topModal(); if (!bg) return;
    if (e.key === 'Escape' && !e.defaultPrevented) {
      if (inTerm(e.target)) return;
      if (closeTop(bg)) { e.preventDefault(); e.stopPropagation(); }
    } else if (e.key === 'Tab') {
      const items = [...bg.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (!bg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, true);

  // ---------------------------------------------------------------- confirm + typed confirm (replaces window.confirm)
  // Safe actions use undo toasts instead; destructive ones (delete files / servers, prune) need the word typed.
  // typed: a word, or an array of accepted words (any one confirms). focusCancel: start on Cancel even with a typed field.
  function confirmDlg({ title, body = '', ok = 'OK', cancel = 'Cancel', danger = false, typed = null, typedHint = '', typedNote = "This can't be undone.", focusCancel = false, cls = '' } = {}) {
    const accept = typed == null ? null : (Array.isArray(typed) ? typed : [typed]).map(String).filter(Boolean);
    const shown = accept ? accept.map(w => `<b class="mono">${h(w)}</b>`).join(' or ') : '';
    return new Promise(res => {
      const m = mk(`<div class="modal-bg ux-alert${cls ? ' ' + h(cls) : ''}"><div class="modal ux-confirm" style="width:min(460px,100%)"><header><h3 class="grow">${h(title)}</h3></header><div class="body">
        ${body ? `<div class="ux-confirm-body">${body}</div>` : ''}
        ${accept ? `<label class="field ux-typed"><span>${typedHint ? h(typedHint) : `Type ${shown} to confirm`}</span><input id="uxTyped" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="uxTypedNote"></label><p class="muted small" id="uxTypedNote">${h(typedNote)}</p>` : ''}
        </div><footer><span class="spacer"></span><button type="button" id="c">${h(cancel)}</button><button type="button" class="${danger ? 'danger solid' : 'primary'}" id="ok" ${accept ? 'disabled' : ''}>${h(ok)}</button></footer></div></div>`);
      const done = v => { m.remove(); res(v); };
      m.querySelector('#c').onclick = () => done(false);
      const okB = m.querySelector('#ok'); okB.onclick = () => done(true);
      m.addEventListener('click', e => { if (e.target === m) done(false); });
      document.body.append(m);
      const ti = m.querySelector('#uxTyped');
      if (ti) { ti.oninput = () => { okB.disabled = !accept.includes(ti.value.trim()); }; ti.onkeydown = e => { if (e.key === 'Enter' && !okB.disabled) done(true); }; requestAnimationFrame(() => (focusCancel ? m.querySelector('#c') : ti).focus()); }
      else requestAnimationFrame(() => (danger ? m.querySelector('#c') : okB).focus());
    });
  }

  // ---------------------------------------------------------------- undo toasts
  // apply() runs now (optimistic UI); commit() runs when the toast times out / is dismissed / the page closes;
  // revert() runs on Undo (or Ctrl/Cmd+Z while the toast is up). Nothing irreversible happens before commit.
  const pending = new Set(); let lastUndo = null;
  function undoable({ msg, apply, commit, revert, ms = 6000, kind = 'action', srv = null, tab = null }) {
    try { apply && apply(); } catch (e) { console.error(e); }
    let done = false;
    const host = document.getElementById('toasts');
    const t = mk(`<div class="toast undo" role="status"><span class="toast-msg">${h(msg)}</span><button type="button" class="sm toast-undo">Undo</button><button type="button" class="toast-x" aria-label="Dismiss" title="Dismiss">✕</button><i class="toast-timer" style="animation-duration:${ms}ms"></i></div>`);
    const fin = async undo => {
      if (done) return; done = true; pending.delete(fin); if (lastUndo === fin) lastUndo = null; clearTimeout(timer); t.remove();
      if (undo) { try { revert && revert(); } catch (e) { console.error(e); } return; }
      try { await (commit && commit()); notify({ kind, title: msg.replace(/…$/, ''), srv, tab }); }
      catch (e) { if (!e || !e._toasted) toast((e && e.message) || String(e), true); try { revert && revert(); } catch {} }
    };
    t.querySelector('.toast-undo').onclick = e => { e.stopPropagation(); fin(true); };
    t.querySelector('.toast-x').onclick = e => { e.stopPropagation(); fin(false); };
    host.append(t); const timer = setTimeout(() => fin(false), ms);
    pending.add(fin); lastUndo = fin;
    return { undo: () => fin(true), commit: () => fin(false) };
  }
  window.addEventListener('pagehide', () => { for (const f of [...pending]) f(false); });
  document.addEventListener('keydown', e => {
    if (!lastUndo || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z' || inField(e.target) || inTerm(e.target)) return;
    e.preventDefault(); lastUndo(true);
  });

  // ---------------------------------------------------------------- skeletons + empty states
  const skel = {
    cards: (n = 4) => `<div class="metric-cols ux-skel-grid" aria-busy="true" aria-label="Loading">${Array.from({ length: n }, () => '<div class="card skel-card"><i class="skel w40"></i><i class="skel h28 w30"></i><i class="skel h8"></i><i class="skel h40"></i></div>').join('')}</div>`,
    rows: (n = 6, cols = 3) => Array.from({ length: n }, (_, i) => `<tr class="skel-row" aria-hidden="true">${Array.from({ length: cols }, (_, j) => `<td><i class="skel" style="width:${j ? 40 + ((i * 13 + j * 7) % 40) : 50 + ((i * 17) % 35)}%"></i></td>`).join('')}</tr>`).join(''),
    lines: (n = 3) => `<div class="skel-lines" aria-busy="true">${Array.from({ length: n }, (_, i) => `<i class="skel" style="width:${90 - i * 18}%"></i>`).join('')}</div>`,
  };
  // actions: [{ label, primary, run }] — returns an element (handlers bound)
  function empty({ ico = 'server', title, text = '', actions = [], compact = false }) {
    const n = mk(`<div class="ux-empty ${compact ? 'compact' : ''}"><div class="ux-empty-ico">${icon(ico)}</div><h3>${h(title)}</h3>${text ? `<p class="muted">${text}</p>` : ''}<div class="ux-empty-acts"></div></div>`);
    const a = n.querySelector('.ux-empty-acts');
    actions.filter(Boolean).forEach(x => { const b = mk(`<button type="button" class="${x.primary ? 'primary' : 'ghost'}">${x.ico ? icon(x.ico) : ''}${h(x.label)}</button>`); b.onclick = x.run; a.append(b); });
    return n;
  }

  // ---------------------------------------------------------------- activity centre (bell)
  const ACT = 'uc.activity';
  let acts = LS.get(ACT, []); if (!Array.isArray(acts)) acts = [];
  const KIND = { alert: ['alert', 'Alert'], error: ['alert', 'Error'], transfer: ['xfer', 'Transfer'], update: ['upd', 'Update'], uiable: ['ui', 'Uiable'], action: ['check', 'Action'], log: ['clock', 'Activity log'] };
  const saveActs = () => { if (acts.length > 150) acts = acts.slice(0, 150); LS.set(ACT, acts); };
  function notify({ kind = 'action', title, detail = '', srv = null, tab = null, sel = null, link = null, key = null, read = false, t = null }) {
    if (!title) return;
    if (key && acts.some(a => a.key === key)) return; // de-dupe (e.g. a Uiable alert seen on a previous poll)
    const s = srv && typeof servers !== 'undefined' ? servers.find(x => x.id === srv) : null;
    acts.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: t || Date.now(), kind, title: String(title).slice(0, 300), detail: String(detail || '').slice(0, 400), srv, srvName: s ? (s.name || s.host) : '', tab, sel, link, key, read: !!read }); acts.sort((a, b) => b.t - a.t);
    saveActs(); badge(); if (document.getElementById('uxBell')) renderBell();
  }
  const unread = () => acts.filter(a => !a.read).length;
  function badge() {
    const n = unread();
    document.querySelectorAll('[data-bell]').forEach(b => { let d = b.querySelector('.bdg'); if (!n) { d && d.remove(); b.setAttribute('aria-label', 'Notifications'); return; }
      if (!d) { d = mk('<span class="bdg"></span>'); b.append(d); } d.textContent = n > 99 ? '99+' : n; b.setAttribute('aria-label', `Notifications, ${n} unread`); });
  }
  let bellFilter = 'all', logRows = [];
  const go = a => {
    closeBell();
    if (a.link === 'update') { const b = document.getElementById('updBar'); if (b) { b.scrollIntoView(); b.querySelector('#updGo')?.focus(); } else uc.call('app:open', 'https://github.com/AlfieeLawrence/Uiable-Connect/releases/latest').catch(() => {}); return; }
    if (a.link && /^https?:/.test(a.link)) { uc.call('app:open', a.link).catch(() => window.open(a.link, '_blank', 'noopener')); return; }
    const s = a.srv && servers.find(x => x.id === a.srv);
    if (!s) { if (a.srv) toast('That connection no longer exists', true); return; }
    if (a.sel) { const u = S(s.id); u.ctSel = a.sel; }
    openSrvTab(s, a.tab || 'overview');
    if (!s.connected && a.tab && a.tab !== 'history') toast('Connect to open ' + (a.tab || 'this view'));
  };
  function renderBell() {
    const p = document.getElementById('uxBell'); if (!p) return;
    const list = bellFilter === 'log' ? logRows : acts.filter(a => bellFilter === 'all' || a.kind === bellFilter || (bellFilter === 'alert' && a.kind === 'error'));
    const tabs = [['all', 'All'], ['alert', 'Alerts'], ['transfer', 'Transfers'], ['uiable', 'Uiable'], ['update', 'Updates'], ['log', 'Activity log']];
    p.querySelector('.bell-tabs').innerHTML = tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${bellFilter === k}" class="${bellFilter === k ? 'active' : ''}" data-f="${k}">${l}</button>`).join('');
    const body = p.querySelector('.bell-list');
    body.innerHTML = list.length ? list.map((a, i) => { const [ic, lab] = KIND[a.kind] || KIND.action;
      return `<li><button type="button" class="bell-item k-${a.kind} ${a.read ? '' : 'unread'}" data-i="${i}"><span class="bi-ico">${icon(ic)}</span><span class="bi-main"><span class="bi-title">${h(a.title)}</span>${a.detail ? `<span class="bi-detail">${h(a.detail)}</span>` : ''}<span class="bi-meta">${h(lab)}${a.srvName ? ' · ' + h(a.srvName) : ''} · ${ago(a.t)}</span></span>${icon('chev', 'bi-go')}</button></li>`; }).join('')
      : `<li class="bell-empty">${icon(bellFilter === 'log' ? 'clock' : 'bell')}<b>${bellFilter === 'log' ? 'No activity recorded yet' : 'You\'re all caught up'}</b><span class="muted small">${bellFilter === 'log' ? 'Connections, forwards and file operations show up here.' : 'Alerts, failed transfers, update notices and Uiable alerts land here.'}</span></li>`;
    p.querySelectorAll('.bell-tabs button').forEach(b => b.onclick = async () => { bellFilter = b.dataset.f; if (bellFilter === 'log') await loadLog(); renderBell(); p.querySelector(`.bell-tabs [data-f="${bellFilter}"]`)?.focus(); });
    body.querySelectorAll('.bell-item').forEach(b => b.onclick = () => { const a = list[+b.dataset.i]; if (a) { a.read = true; saveActs(); badge(); go(a); } });
  }
  async function loadLog() {
    const ev = await uc.call('history:list', 60).catch(() => []);
    const TAB = { connected: 'overview', disconnected: 'overview', 'connection-lost': 'overview', 'forward-start': 'forwards', 'forward-stop': 'forwards', upload: 'files', download: 'files', 'upload-sudo': 'files', 'download-sudo': 'files', 'exec-sudo': 'history', 'shell-root': 'terminal', 'shell-sudo': 'terminal' };
    logRows = (ev || []).map(e => ({ kind: 'log', t: e.t, title: String(e.ev || '').replace(/-/g, ' '), detail: e.d || '', srv: e.s, srvName: e.n || '', tab: TAB[e.ev] || 'history', read: true }));
  }
  function closeBell() { const p = document.getElementById('uxBell'); if (p) p.remove(); document.querySelectorAll('[data-bell]').forEach(b => b.setAttribute('aria-expanded', 'false')); }
  function openBell(anchor) {
    if (document.getElementById('uxBell')) return closeBell();
    const p = mk(`<div id="uxBell" class="ux-layer ux-pop bell-panel" role="dialog" aria-label="Notifications"><div class="bell-head"><b class="grow">Notifications</b><button type="button" class="sm" id="bellRead">Mark all read</button><button type="button" class="sm" id="bellClr">Clear</button><button type="button" class="sm icon-btn" id="bellX" data-close aria-label="Close">${icon('x')}</button></div><div class="bell-tabs" role="tablist" aria-label="Filter"></div><ul class="bell-list" role="list"></ul></div>`);
    p._close = closeBell;
    document.body.append(p);
    if (!phone() && anchor) { const r = anchor.getBoundingClientRect(); const w = Math.min(400, innerWidth - 24);
      p.style.width = w + 'px'; p.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + 'px';
      if (r.top > innerHeight / 2) p.style.bottom = (innerHeight - r.top + 8) + 'px'; else p.style.top = (r.bottom + 8) + 'px'; }
    p.querySelector('#bellX').onclick = closeBell;
    p.querySelector('#bellRead').onclick = () => { acts.forEach(a => a.read = true); saveActs(); badge(); renderBell(); };
    p.querySelector('#bellClr').onclick = () => { const keep = acts.slice(); undoable({ msg: `Cleared ${keep.length} notification${keep.length === 1 ? '' : 's'}`, apply: () => { acts = []; saveActs(); badge(); renderBell(); }, commit: () => {}, revert: () => { acts = keep; saveActs(); badge(); renderBell(); } }); };
    document.querySelectorAll('[data-bell]').forEach(b => b.setAttribute('aria-expanded', 'true'));
    renderBell(); requestAnimationFrame(() => p.querySelector('.bell-tabs button')?.focus());
    setTimeout(() => document.addEventListener('pointerdown', function off(e) { const q = document.getElementById('uxBell'); if (!q) return document.removeEventListener('pointerdown', off, true);
      if (!q.contains(e.target) && !e.target.closest('[data-bell]')) { closeBell(); document.removeEventListener('pointerdown', off, true); } }, true));
  }

  // ---------------------------------------------------------------- live status (health dots + sparklines)
  const liveOn = () => LS.get('uc.live', true) !== false;
  function level(s) {
    if (!s || !s.connected) return 'off';
    const u = S(s.id), x = u.stats; if (!x || Date.now() - (u.statsAt || 0) > 60000) return 'on';
    const mem = x.memTotal ? 100 * x.memUsed / x.memTotal : 0, cpu = x.cpu || 0;
    const disk = Math.max(0, ...(x.disks || []).map(d => d.size ? 100 * d.used / d.size : 0));
    if (cpu >= 95 || mem >= 95 || disk >= 95) return 'crit';
    if (cpu >= 85 || mem >= 90 || disk >= 90) return 'warn';
    return 'ok';
  }
  const LV = { off: 'Offline', on: 'Connected', ok: 'Healthy', warn: 'Needs attention', crit: 'Critical' };
  function mini(vals, cls) {
    const v = vals.filter(x => x != null && !isNaN(x)).slice(-30); if (v.length < 2) return `<svg class="mini ${cls}" viewBox="0 0 60 16" aria-hidden="true"></svg>`;
    const max = Math.max(100, ...v), pts = v.map((y, i) => `${(i / (v.length - 1) * 58 + 1).toFixed(1)},${(15 - (y / max) * 14).toFixed(1)}`).join(' ');
    return `<svg class="mini ${cls}" viewBox="0 0 60 16" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
  }
  function sideLive(s) {
    if (!s.connected || !isSsh(s) || !liveOn()) return '';
    const u = S(s.id), hist = u.statsHist || [], x = u.stats;
    if (!x) return `<span class="srv-live loading"><i class="skel" style="width:70%"></i></span>`;
    const mem = x.memTotal ? Math.round(100 * x.memUsed / x.memTotal) : null;
    return `<span class="srv-live" aria-label="CPU ${x.cpu == null ? 'unknown' : Math.round(x.cpu) + '%'}, memory ${mem == null ? 'unknown' : mem + '%'}"><span class="sl"><i class="sl-k">CPU</i>${mini(hist.map(p => p.cpu), 'cpu')}<em>${x.cpu == null ? '–' : Math.round(x.cpu) + '%'}</em></span><span class="sl"><i class="sl-k">MEM</i>${mini(hist.map(p => p.mem), 'mem')}<em>${mem == null ? '–' : mem + '%'}</em></span></span>`;
  }
  function refreshSideLive() {
    for (const s of (typeof servers !== 'undefined' ? servers : [])) {
      const n = document.querySelector(`#srvlist .srv[data-id="${CSS.escape(s.id)}"]`); if (!n) continue;
      const lv = level(s), d = n.querySelector('.dot');
      if (d) { d.className = 'dot ' + (s.connected ? 'on ' : '') + 'lv-' + lv; d.title = LV[lv]; d.setAttribute('aria-label', LV[lv]); }
      const t = n.querySelector('.t'); const old = t && t.querySelector('.srv-live'); const html = sideLive(s);
      if (old) { if (html) old.outerHTML = html; else old.remove(); } else if (t && html) t.insertAdjacentHTML('beforeend', html);
    }
  }

  // ---------------------------------------------------------------- swipe between tabs (touch)
  function bindSwipe() {
    let sx = 0, sy = 0, st0 = 0, ok = false;
    document.addEventListener('touchstart', e => {
      const t = e.target; ok = false; if (e.touches.length !== 1) return;
      const v = t.closest && t.closest('#panes .view'); if (!v || t.closest('.xterm, input, textarea, select, .metric-drag, .ux-noswipe, .uiable-frame-wrap, iframe')) return;
      for (let n = t; n && n !== v; n = n.parentElement) if (n.scrollWidth > n.clientWidth + 4 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return;
      ok = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY; st0 = Date.now();
    }, { passive: true });
    document.addEventListener('touchend', e => {
      if (!ok) return; ok = false; const c = e.changedTouches[0]; const dx = c.clientX - sx, dy = c.clientY - sy;
      if (Math.abs(dx) < 70 || Math.abs(dy) > 45 || Math.abs(dx) < 2 * Math.abs(dy) || Date.now() - st0 > 700) return;
      const sec = e.target.closest && e.target.closest('.pane'); const i = sec ? +sec.dataset.i : focusPane; const p = panes[i]; const s = p && servers.find(x => x.id === p.srv); if (!s) return;
      const tabs = TABS(s), k = tabs.indexOf(p.tab), n = k + (dx < 0 ? 1 : -1); if (n < 0 || n >= tabs.length) return;
      p.tab = tabs[n]; focusPane = i; renderMain();
      const lab = document.querySelector('.pane.focus .tabs .seg button.active, .pane.focus .tabs [data-t].active'); if (lab) lab.scrollIntoView({ block: 'nearest', inline: 'center' });
    }, { passive: true });
  }

  // ---------------------------------------------------------------- command palette
  const TAB_LABEL = { overview: 'Overview', terminal: 'Terminal', files: 'Files', containers: 'Containers', forwards: 'Port forwards', health: 'Health', alerts: 'Alerts', history: 'History', uiable: 'Uiable dashboard' };
  const TAB_ICO = { overview: 'home', terminal: 'term', files: 'files', containers: 'box', forwards: 'xfer', health: 'check', alerts: 'bell', history: 'clock', uiable: 'ui' };
  let snipCache = null;
  async function paletteItems() {
    const out = []; const add = (group, label, run, o = {}) => out.push({ group, label, run, ...o });
    const cs = curSrv();
    // actions first (most-used verbs)
    add('Actions', 'Add connection…', () => editServer(), { ico: 'plus', kw: 'new server ssh host create' });
    add('Actions', 'Quick connect…', () => quickDialog(), { ico: 'bolt', kw: 'one-off temporary' });
    if (cs && !cs.connected) add('Actions', `Connect to ${cs.name || cs.host}`, () => connect(cs.id), { ico: 'play' });
    if (cs && cs.connected) {
      add('Actions', 'New terminal tab', () => { openSrvTab(cs, 'terminal'); setTimeout(() => S(cs.id).newT && S(cs.id).newT(), 300); }, { ico: 'term', hint: MOD + ' T' });
      add('Actions', `Disconnect ${cs.name || cs.host}`, () => document.querySelector('.pane.focus #disc, #disc')?.click(), { ico: 'x' });
    }
    if (!ON_MOBILE && panes.length < 2 && cs) add('Actions', 'Split view (two panes)', () => document.querySelector('#psplit')?.click(), { ico: 'map' });
    add('Actions', 'Notifications', () => openBell(document.querySelector('[data-bell]')), { ico: 'bell', hint: 'N' });
    add('Actions', 'Keyboard shortcuts', () => help(), { ico: 'keyb', hint: '?' });
    add('Actions', 'Backup and restore…', () => backupDialog(), { ico: 'upd' });
    add('Actions', 'Getting started checklist', () => { LS.set('uc.gs.hide', false); renderChecklist(true); }, { ico: 'check' });
    add('Actions', 'Take the tour', () => tour(true), { ico: 'map' });
    // servers
    for (const s of servers) add('Servers', s.name || s.host || s.serialPath, () => { openSrvTab(s, panes[focusPane].tab); if (!s.connected) connect(s.id); }, { ico: 'server', sub: `${s.connected ? '● connected' : 'offline'}${s.group ? ' · ' + s.group : ''} · ${s.username ? s.username + '@' : ''}${s.host || s.serialPath || ''}`, kw: (s.group || '') + ' ' + (s.host || '') });
    // sections of the focused server, then other connected servers
    if (cs) for (const t of TABS(cs)) add('Go to', `${TAB_LABEL[t] || t}`, () => openSrvTab(cs, t), { ico: TAB_ICO[t], sub: cs.name || cs.host, hint: 'Alt ' + (TABS(cs).indexOf(t) + 1) });
    for (const s of servers) if (s.connected && (!cs || s.id !== cs.id)) for (const t of TABS(s)) add('Go to', `${s.name || s.host} › ${TAB_LABEL[t] || t}`, () => openSrvTab(s, t), { ico: TAB_ICO[t] });
    // open terminal tabs
    for (const s of servers) { const u = st[s.id]; if (!u || !u.terms) continue;
      u.terms.forEach((t, i) => add('Terminal tabs', `${t.label || 'Tab ' + (i + 1)}${t.sudo ? ' (' + t.sudo + ')' : ''}`, () => { u.activeTerm = t.sid; openSrvTab(s, 'terminal'); }, { ico: 'term', sub: s.name || s.host })); }
    // containers (cached by the Containers view / live poll)
    for (const s of servers) { const u = st[s.id]; if (!u || !u.containers) continue;
      for (const c of u.containers) add('Containers', c.name, () => { u.ctSel = c.id; openSrvTab(s, 'containers'); }, { ico: 'box', sub: `${c.image} · ${c.state} · ${s.name || s.host}`, kw: c.image }); }
    // snippets
    if (!snipCache) snipCache = await uc.call('snippets:list').catch(() => []);
    for (const x of snipCache || []) { if (x.serverId && (!cs || x.serverId !== cs.id)) continue;
      add('Scripts', x.name, () => { if (!cs || !cs.connected) return toast('Connect to a server first', true); const u = S(cs.id); const t = u.terms.find(t => t.sid === u.activeTerm);
        if (!t) { openSrvTab(cs, 'terminal'); setTimeout(() => { const u2 = S(cs.id); const t2 = u2.terms.find(q => q.sid === u2.activeTerm); if (t2) uc.send('shell:write', cs.id, t2.sid, x.cmd.replace(/\r?\n/g, '\r') + '\r'); }, 1500); return; }
        uc.send('shell:write', cs.id, t.sid, x.cmd.replace(/\r?\n/g, '\r') + '\r'); openSrvTab(cs, 'terminal'); }, { ico: 'play', sub: x.cmd.slice(0, 80), kw: x.cmd }); }
    // settings
    add('Settings', 'Open settings', () => settingsDialog(), { ico: 'gear' });
    for (const [v, l] of [['dark', 'Dark'], ['light', 'Light'], ['solarized', 'Solarized'], ['dracula', 'Dracula'], ['monokai', 'Monokai'], ['system', 'System']])
      add('Settings', `Theme: ${l}`, () => { applyTheme(v); const r = resolvedTheme(); if (TERM_THEMES[r]) applyTermTheme(r); }, { ico: 'gear', kw: 'appearance colour color' });
    add('Settings', `Reduce motion: ${motionPref() === 'reduce' ? 'turn off' : 'turn on'}`, () => setMotion(motionPref() === 'reduce' ? 'system' : 'reduce'), { ico: 'gear', kw: 'animation accessibility' });
    add('Settings', `Live status in sidebar: ${liveOn() ? 'turn off' : 'turn on'}`, () => { LS.set('uc.live', !liveOn()); renderSide(); }, { ico: 'gear', kw: 'sparkline health dot' });
    return out;
  }
  const score = (q, it) => {
    if (!q) return 1; const hay = (it.label + ' ' + (it.sub || '') + ' ' + (it.kw || '') + ' ' + it.group).toLowerCase(); const l = it.label.toLowerCase();
    let sc = 0; for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
      if (l.startsWith(w)) sc += 30; else if (l.includes(' ' + w)) sc += 20; else if (l.includes(w)) sc += 14; else if (hay.includes(w)) sc += 6;
      else { let i = 0; for (const ch of w) { i = l.indexOf(ch, i); if (i < 0) return 0; i++; } sc += 2; } }
    return sc;
  };
  async function palette() {
    if (document.getElementById('uxPal')) return;
    const p = mk(`<div id="uxPal" class="ux-layer lock pal-bg"><div class="pal" role="dialog" aria-label="Command palette"><div class="pal-in">${icon('search')}<input id="palQ" role="combobox" aria-expanded="true" aria-controls="palL" aria-autocomplete="list" placeholder="Search servers, tabs, containers, scripts, settings…" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div><ul id="palL" class="pal-list" role="listbox" aria-label="Results"></ul><div class="pal-foot muted small"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>?</kbd> all shortcuts</span></div></div></div>`);
    const close = () => p.remove(); p._close = close;
    p.addEventListener('pointerdown', e => { if (e.target === p) close(); });
    document.body.append(p);
    const q = p.querySelector('#palQ'), L = p.querySelector('#palL');
    let items = await paletteItems(), shown = [], sel = 0;
    const draw = () => {
      const v = q.value.trim();
      shown = items.map(it => ({ it, s: score(v, it) })).filter(x => x.s > 0).sort((a, b) => v ? b.s - a.s : 0).slice(0, 60).map(x => x.it);
      if (!v) { // no query: a short, grouped start list
        const cap = { Actions: 7, Servers: 8, 'Go to': 9, 'Terminal tabs': 4, Containers: 5, Scripts: 4, Settings: 2 }; const cnt = {};
        shown = items.filter(it => (cnt[it.group] = (cnt[it.group] || 0) + 1) <= (cap[it.group] ?? 3)); }
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      let g = null;
      L.innerHTML = shown.map((it, i) => { const head = it.group !== g ? `<li class="pal-g" role="presentation">${h(it.group)}</li>` : ''; g = it.group;
        return `${head}<li role="option" id="palo${i}" aria-selected="${i === sel}" class="pal-o ${i === sel ? 'sel' : ''}" data-i="${i}">${icon(it.ico || 'chev')}<span class="pal-t"><span>${h(it.label)}</span>${it.sub ? `<small>${h(it.sub)}</small>` : ''}</span>${it.hint ? `<kbd>${h(it.hint)}</kbd>` : ''}</li>`; }).join('')
        || `<li class="pal-none" role="option" aria-disabled="true">No matches for “${h(v)}”</li>`;
      q.setAttribute('aria-activedescendant', shown.length ? 'palo' + sel : '');
      L.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    };
    const run = i => { const it = shown[i]; if (!it) return; close(); Promise.resolve().then(it.run).catch(e => toast(e.message || String(e), true)); };
    q.oninput = () => { sel = 0; draw(); };
    q.onkeydown = e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, shown.length); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + shown.length) % Math.max(1, shown.length); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    };
    L.onclick = e => { const o = e.target.closest('.pal-o'); if (o) run(+o.dataset.i); };
    L.onmousemove = e => { const o = e.target.closest('.pal-o'); if (o && +o.dataset.i !== sel) { sel = +o.dataset.i; L.querySelectorAll('.pal-o').forEach(x => { const on = +x.dataset.i === sel; x.classList.toggle('sel', on); x.setAttribute('aria-selected', on); }); } };
    draw(); q.focus();
  }

  // ---------------------------------------------------------------- shortcuts + help sheet
  const SHORTCUTS = [
    ['General', [[`${MOD} K`, 'Command palette (search everything)'], [`${MOD} Shift K`, 'Command palette while typing in a terminal'], ['?', 'This shortcuts sheet'], ['N', 'Notifications'], ['Esc', 'Close a dialog, menu or palette'], [`${MOD} Z`, 'Undo the last action while its toast is showing']]],
    ['Navigate', [['Alt 1 – 9', 'Switch section (Overview, Terminal, Files…)'], ['Alt ← / →', 'Previous / next section'], ['Alt ↑ / ↓', 'Previous / next server'], ['Swipe ← / →', 'Previous / next section (touch)']]],
    ['Terminal', [[`Ctrl T`, 'New terminal tab'], [`Ctrl W`, 'Close terminal tab (with undo)'], [`Ctrl 1 – 9`, 'Switch terminal tab'], [`Ctrl F`, 'Find in terminal'], [MAC ? '⌘ C / ⌘ V' : 'Ctrl Shift C / V', 'Copy / paste']]],
  ];
  function help() {
    if (document.getElementById('uxHelp')) return;
    const m = mk(`<div class="modal-bg" id="uxHelp"><div class="modal" style="width:min(620px,100%)"><header><h3 class="grow">Keyboard shortcuts</h3><button type="button" class="sm icon-btn" id="c" aria-label="Close">${icon('x')}</button></header><div class="body kb-grid">
      ${SHORTCUTS.map(([g, rows]) => `<section><h4>${g}</h4><dl>${rows.map(([k, d]) => `<div><dt>${k.split(' ').map(x => x === '/' || x === '–' ? `<span class="muted">${x}</span>` : `<kbd>${h(x)}</kbd>`).join(' ')}</dt><dd>${h(d)}</dd></div>`).join('')}</dl></section>`).join('')}
      </div><footer><span class="muted small grow">Single-key shortcuts work when you're not typing in a field or terminal.</span><button type="button" class="primary" id="ok">Done</button></footer></div></div>`);
    m.querySelector('#c').onclick = m.querySelector('#ok').onclick = () => m.remove();
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
    document.body.append(m); m.querySelector('#ok').focus();
  }
  function bindKeys() {
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      const mod = MAC ? e.metaKey : e.ctrlKey;
      if (mod && k === 'k' && !e.altKey && (e.shiftKey || MAC || !inTerm(e.target))) { e.preventDefault(); e.stopPropagation(); document.getElementById('uxPal') ? document.getElementById('uxPal').remove() : palette(); return; }
      if (topModal() || inField(e.target) || inTerm(e.target)) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const p = panes[focusPane], s = p && servers.find(x => x.id === p.srv);
        if (/^Digit[1-9]$/.test(e.code) && s) { const t = TABS(s)[+e.code.slice(5) - 1]; if (t) { e.preventDefault(); p.tab = t; renderMain(); } return; }
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && s) { const ts = TABS(s), i = ts.indexOf(p.tab) + (e.key === 'ArrowRight' ? 1 : -1); if (ts[i]) { e.preventDefault(); p.tab = ts[i]; renderMain(); } return; }
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && servers.length) { e.preventDefault(); const i = servers.findIndex(x => x.id === (p && p.srv)); const n = servers[(i + (e.key === 'ArrowDown' ? 1 : -1) + servers.length) % servers.length]; openSrvTab(n, p.tab); return; }
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?') { e.preventDefault(); help(); }
      else if (k === 'n') { e.preventDefault(); openBell(document.querySelector('[data-bell]:not([hidden])')); }
    }, true);
  }

  // ---------------------------------------------------------------- motion preference (system / reduce)
  const motionPref = () => LS.get('uc.motion', 'system');
  const setMotion = v => { LS.set('uc.motion', v); document.documentElement.classList.toggle('reduce-motion', v === 'reduce'); };

  // ---------------------------------------------------------------- getting-started checklist
  const GS = () => {
    const real = (typeof servers !== 'undefined' ? servers : []).filter(s => !s.quick);
    const ui = real.some(s => { const u = st[s.id]; return u && u.uiable && (u.uiable.reachable || u.uiable.installed || u.uiable.isUiable); }) || LS.get('uc.gs.uiable', false);
    const target = curSrv() || real[0];
    const openT = t => () => { if (!target) return editServer(); openSrvTab(target, t); if (!target.connected) connect(target.id); };
    return [
      { k: 'add', label: 'Add a server', done: real.length > 0, cta: 'Add', run: () => editServer() },
      { k: 'sudo', label: 'Save a sudo password', done: real.some(s => s.has_sudoPassword), cta: 'Save', run: () => target ? editServer(target) : editServer(), hint: 'Lets Use sudo and Files work as root without asking' },
      { k: 'term', label: 'Try the terminal', done: LS.get('uc.gs.term', false), cta: 'Open', run: openT('terminal') },
      { k: 'files', label: 'Try the file browser', done: LS.get('uc.gs.files', false), cta: 'Open', run: openT('files') },
      { k: 'uiable', label: 'Install or link Uiable', done: !!ui, cta: 'Set up', run: () => { if (target) { openSrvTab(target, 'overview'); if (!target.connected) connect(target.id); setTimeout(() => (document.querySelector('#uiInst button, #openUi') || document.querySelector('#uiPill'))?.scrollIntoView({ block: 'center' }), 600); } else editServer(); }, hint: 'The web dashboard for your server' },
    ];
  };
  function renderChecklist(force) {
    const host = document.getElementById('side'); if (!host) return;
    let c = document.getElementById('gsCard');
    const items = GS(), n = items.filter(i => i.done).length;
    if ((LS.get('uc.gs.hide', false) && !force) || (n === items.length && !force && LS.get('uc.gs.doneSeen', false))) { c && c.remove(); return; }
    if (n === items.length) LS.set('uc.gs.doneSeen', true);
    const open = LS.get('uc.gs.open', true);
    const html = `<div id="gsCard" class="gs ${open ? 'open' : ''}"><div class="gs-head"><button type="button" class="gs-tog" aria-expanded="${open}" aria-controls="gsList"><span class="gs-ring" style="--p:${Math.round(100 * n / items.length)}" aria-hidden="true"></span><span class="grow"><b>Getting started</b><span class="muted small">${n} of ${items.length} done</span></span></button><button type="button" class="sm icon-btn" id="gsX" title="Hide checklist (bring it back from Settings)" aria-label="Hide checklist">${icon('x')}</button></div>
      <ul id="gsList" class="gs-list">${items.map(i => `<li class="${i.done ? 'done' : ''}"><span class="gs-chk" aria-hidden="true">${i.done ? icon('check') : ''}</span><span class="grow"><span class="gs-l">${h(i.label)}</span>${i.hint && !i.done ? `<span class="muted small">${h(i.hint)}</span>` : ''}</span>${i.done ? '<span class="sr-only">done</span>' : `<button type="button" class="sm ghost" data-gs="${i.k}">${h(i.cta)}</button>`}</li>`).join('')}</ul></div>`;
    const nn = mk(html); if (c) c.replaceWith(nn); else host.querySelector('.side-foot')?.before(nn);
    nn.querySelector('.gs-tog').onclick = () => { LS.set('uc.gs.open', !open); renderChecklist(true); };
    nn.querySelector('#gsX').onclick = () => { LS.set('uc.gs.hide', true); nn.remove(); toast('Checklist hidden — bring it back from Settings or the command palette'); };
    nn.querySelectorAll('[data-gs]').forEach(b => b.onclick = () => items.find(i => i.k === b.dataset.gs)?.run());
  }
  function onView(s, tab) { // called by renderPane
    if (tab === 'terminal' && s.connected && !LS.get('uc.gs.term', false)) { LS.set('uc.gs.term', true); renderChecklist(); }
    if (tab === 'files' && s.connected && !LS.get('uc.gs.files', false)) { LS.set('uc.gs.files', true); renderChecklist(); }
    if (tab === 'uiable' && !LS.get('uc.gs.uiable', false)) { LS.set('uc.gs.uiable', true); renderChecklist(); }
  }

  // ---------------------------------------------------------------- first-run tour
  const STEPS = [
    { title: 'Welcome to Uiable Connect', text: 'A quick tour of the essentials — about 30 seconds. You can skip it and re-run it any time from Settings.' },
    { sel: '#srvlist', alt: '.pane-head .burger', title: 'Your servers', text: 'Saved connections live here. The dot shows health and the mini graphs show live CPU and memory for connected servers.' },
    { sel: '#cmdkB', alt: '.ph-cmdk', title: 'Jump anywhere', text: `Press ${MOD} K to search servers, tabs, containers, scripts, settings and actions. Press ? for every shortcut.` },
    { sel: '.pane.focus .tabs .seg', title: 'Sections', text: 'Overview, Terminal, Files, Containers, Ports and more. On touch screens, swipe left or right to move between them.' },
    { sel: '#bellB', alt: '.ph-bell', title: 'Notifications', text: 'Alerts, failed transfers, update notices and Uiable alerts collect here, each linking back to where it happened.' },
    { sel: '#gsCard', title: 'Getting started', text: 'A short checklist to get set up. Hide it when you’re done.' },
    { sel: '#setB', alt: '.ph-set', title: 'Settings', text: 'Themes, reduced motion, live status — and “Take the tour” to see this again.' },
  ];
  function tour(force) {
    if (!force && LS.get('uc.tour', null)) return;
    if (document.getElementById('uxTour')) return;
    const vis = s => { if (!s) return null; const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight ? e : null; };
    const steps = STEPS.filter(x => !x.sel || vis(x.sel) || vis(x.alt));
    let i = 0;
    const L = mk(`<div id="uxTour" class="ux-layer lock tour" data-noesc><div class="tour-hole" aria-hidden="true"></div><div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourT" aria-describedby="tourD"><div class="tour-step muted small" id="tourN"></div><h3 id="tourT"></h3><p id="tourD"></p><div class="tour-btns"><button type="button" class="sm" id="tourSkip">Skip tour</button><span class="spacer"></span><button type="button" class="sm" id="tourBack">Back</button><button type="button" class="sm primary" id="tourNext">Next</button></div></div></div>`);
    const end = done => { L.remove(); LS.set('uc.tour', done ? 'done' : 'skipped'); window.removeEventListener('resize', place); };
    L._close = () => end(false);
    const hole = L.querySelector('.tour-hole'), card = L.querySelector('.tour-card');
    const place = () => {
      const s = steps[i]; const t = vis(s.sel) || vis(s.alt);
      L.querySelector('#tourN').textContent = `${i + 1} of ${steps.length}`; L.querySelector('#tourT').textContent = s.title; L.querySelector('#tourD').textContent = s.text;
      L.querySelector('#tourBack').hidden = i === 0; L.querySelector('#tourNext').textContent = i === steps.length - 1 ? 'Finish' : i === 0 ? 'Start tour' : 'Next';
      L.classList.toggle('centered', !t);
      if (!t) { hole.style.cssText = 'display:none'; card.style.cssText = ''; return; }
      const r = t.getBoundingClientRect(), pad = 6;
      hole.style.cssText = `display:block;left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + 2 * pad}px;height:${r.height + 2 * pad}px`;
      const cw = Math.min(340, innerWidth - 24); card.style.width = cw + 'px';
      const ch = card.offsetHeight || 180;
      let left = r.right + 14, top = r.top;
      if (left + cw > innerWidth - 12) { left = Math.min(Math.max(12, r.left), innerWidth - cw - 12); top = r.bottom + 14; if (top + ch > innerHeight - 12) top = r.top - ch - 14; }
      card.style.left = left + 'px'; card.style.top = Math.max(12, Math.min(top, innerHeight - ch - 12)) + 'px';
    };
    L.querySelector('#tourSkip').onclick = () => end(false);
    L.querySelector('#tourBack').onclick = () => { i = Math.max(0, i - 1); place(); };
    L.querySelector('#tourNext').onclick = () => { if (i >= steps.length - 1) { end(true); return; } i++; place(); L.querySelector('#tourNext').focus(); };
    L.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); } if (e.key === 'ArrowRight') L.querySelector('#tourNext').click(); if (e.key === 'ArrowLeft' && i) L.querySelector('#tourBack').click(); });
    document.body.append(L); window.addEventListener('resize', place); place(); L.querySelector('#tourNext').focus();
  }

  // ---------------------------------------------------------------- settings section (appended to the Settings dialog)
  function settingsExtras(m) {
    const body = m.querySelector('.body'); if (!body) return;
    body.insertAdjacentHTML('beforeend', `<div class="set-sec"><h4>Accessibility &amp; layout</h4>
      <label class="field"><span>Motion</span><select id="uxMotion"><option value="system">Follow the system setting</option><option value="reduce">Reduce motion</option></select></label>
      <label class="row set-row"><input type="checkbox" id="uxLive"> <span>Live status in the server list (health dot + CPU/memory graphs, polls connected servers every 10 s)</span></label></div>
      <div class="set-sec"><h4>Help</h4><div class="row set-btns"><button type="button" class="sm" id="uxTourB">${icon('map')}Take the tour</button><button type="button" class="sm" id="uxGsB">${icon('check')}Show getting started</button><button type="button" class="sm" id="uxKbB">${icon('keyb')}Keyboard shortcuts</button></div></div>`);
    const mo = m.querySelector('#uxMotion'); mo.value = motionPref(); mo.onchange = () => setMotion(mo.value);
    const lv = m.querySelector('#uxLive'); lv.checked = liveOn(); lv.onchange = () => { LS.set('uc.live', lv.checked); renderSide(); };
    m.querySelector('#uxTourB').onclick = () => { m.remove(); tour(true); };
    m.querySelector('#uxGsB').onclick = () => { LS.set('uc.gs.hide', false); LS.set('uc.gs.open', true); renderChecklist(true); m.remove(); document.getElementById('gsCard')?.scrollIntoView({ block: 'nearest' }); if (phone()) document.body.classList.add('drawer-open'); };
    m.querySelector('#uxKbB').onclick = () => { m.remove(); help(); };
  }

  // ---------------------------------------------------------------- hooks into app.js globals
  function wrapGlobals() {
    if (typeof window.toast === 'function' && !window.toast._ux) {
      const t0 = window.toast;
      window.toast = function (msg, err) { t0(msg, err); const m = String(msg || '');
        if (err && !/^⚠ /.test(m)) { const p = panes[focusPane]; // "⚠ server: …" toasts come from raiseAlert, logged below
          notify({ kind: /upload|download|copy|transfer|sftp|permission denied|no such file/i.test(m) ? 'transfer' : 'error', title: m, srv: p && p.srv, tab: p && p.tab }); } };
      window.toast._ux = true;
    }
    if (typeof window.raiseAlert === 'function' && !window.raiseAlert._ux) {
      const r0 = window.raiseAlert;
      window.raiseAlert = function (s, msg) { r0(s, msg); notify({ kind: 'alert', title: msg, detail: s && (s.name || s.host), srv: s && s.id, tab: 'alerts' }); };
      window.raiseAlert._ux = true;
    }
  }

  function init() {
    setMotion(motionPref());
    wrapGlobals(); bindKeys(); bindSwipe(); badge();
    const mq = matchMedia('(max-width: 760px)'); (mq.addEventListener ? mq.addEventListener('change', () => renderMain()) : mq.addListener(() => renderMain()));
    setInterval(() => { document.querySelectorAll('#uxBell .bi-meta').length && renderBell(); }, 60000);
  }
  document.addEventListener('DOMContentLoaded', init);

  return { LS, icon, confirm: confirmDlg, undoable, skel, empty, notify, openBell, closeBell, badge, palette, help, tour, renderChecklist, onView, settingsExtras, sideLive, refreshSideLive, level, LV, liveOn, mini, MOD, phone, TAB_LABEL, TAB_ICO, ago, invalidateSnippets: () => { snipCache = null; } };
})();
