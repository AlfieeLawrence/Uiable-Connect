'use strict';
// Touch layout glue for the shared desktop UI (src/app.js). Loaded after app.js on mobile only.
(function () {
  const M = window.UC_MOBILE || {}; const body = document.body;
  body.classList.add('mobile', 'plat-' + (M.platform || 'web'));
  const phone = () => matchMedia('(max-width: 760px)').matches;

  // ---- collapsible server drawer (phones) / collapsible sidebar (tablets)
  const side = document.getElementById('side');
  const scrim = document.createElement('div'); scrim.id = 'scrim'; body.append(scrim);
  const open = v => body.classList.toggle('drawer-open', v);
  scrim.onclick = () => open(false);
  side.addEventListener('click', e => { if (e.target.closest('.srv') && phone()) open(false); });
  const burger = () => { const b = document.createElement('button'); b.className = 'sm burger'; b.textContent = '☰'; b.title = 'Servers';
    b.onclick = () => phone() ? open(!body.classList.contains('drawer-open')) : body.classList.toggle('side-collapsed'); return b; };

  // ---- stats only poll while the app is visible: hold the call until we're back in front
  const call0 = uc.call;
  uc.call = (ch, ...a) => ch === 'stats' && document.hidden
    ? new Promise(r => document.addEventListener('visibilitychange', function f() { if (!document.hidden) { document.removeEventListener('visibilitychange', f); r(); } })).then(() => call0(ch, ...a))
    : call0(ch, ...a);

  // ---- sticky Ctrl for the terminal extras row
  let ctrl = false; const send0 = uc.send;
  uc.send = (ch, id, sid, d, ...r) => {
    if (ch === 'shell:write' && ctrl && typeof d === 'string' && d.length === 1) { const c = d.toUpperCase().charCodeAt(0); if (c >= 64 && c <= 95) d = String.fromCharCode(c - 64); setCtrl(false); }
    return send0(ch, id, sid, d, ...r);
  };
  const setCtrl = v => { ctrl = v; document.querySelectorAll('.kx [data-k="ctrl"]').forEach(b => b.classList.toggle('active', v)); };
  const KEYS = [['Esc', '\x1b'], ['Tab', '\t'], ['Ctrl', 'ctrl'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C'], ['|', '|'], ['~', '~'], ['/', '/'], ['-', '-'], ['^C', '\x03'], ['Paste', 'paste']];
  function termExtras(v) {
    if (v.querySelector('.kx')) return;
    const row = document.createElement('div'); row.className = 'kx';
    row.innerHTML = KEYS.map(([l, k]) => `<button class="sm" data-k="${k === 'ctrl' ? 'ctrl' : ''}" data-s="${encodeURIComponent(k)}">${l}</button>`).join('');
    row.addEventListener('pointerdown', e => e.preventDefault()); // keep the on-screen keyboard open
    row.onclick = e => { const b = e.target.closest('button'); if (!b) return; const k = decodeURIComponent(b.dataset.s);
      if (k === 'ctrl') return setCtrl(!ctrl);
      if (k === 'paste') { const t = S(cur).terms.find(t => t.sid === S(cur).activeTerm); if (t) navigator.clipboard.readText().then(x => x && t.term.paste(x), () => toast('Clipboard not available', true)); return; }
      const u = S(cur); const sid = u.activeTerm; if (!sid) return; send0('shell:write', cur, sid, k); u.terms.find(t => t.sid === sid)?.term.focus(); };
    v.querySelector('.termwrap').append(row);
  }

  // ---- files: Upload button (device picker) + tap-again-to-open (no double click on touch)
  function filesExtras(v) {
    const dl = v.querySelector('#dl'); if (!dl || v.querySelector('#upl')) return;
    const b = document.createElement('button'); b.className = 'sm primary'; b.id = 'upl'; b.textContent = '⇪ Upload'; dl.before(b);
    b.onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true;
      i.onchange = async () => { const f = [...i.files]; if (!f.length) return; await uc.call('fs:upload', cur, f, S(cur).cwd).then(() => toast(`Uploaded ${f.length} item(s)`), e => toast(e.message, true)); v.querySelector('#rf').click(); }; i.click(); };
    const fl = v.querySelector('#fl');
    fl.addEventListener('click', e => { const r = e.target.closest('tr[data-i]'); if (r && r.classList.contains('sel') && S(cur).sel.size === 1) { e.stopImmediatePropagation(); r.ondblclick(); } }, true);
    const hint = v.querySelector('.files > p.muted'); if (hint && !hint.dataset.mob) hint.dataset.mob = '1', hint.textContent = 'Tap to select · tap again to open or edit · Upload picks from Photos/Files';
  }

  function decorate() {
    const m = document.getElementById('main');
    const head = m.querySelector(':scope > .row');
    if (head && !head.querySelector('.burger')) head.prepend(burger());
    if (!m.querySelector('.burger')) { const e = m.querySelector('.empty > div'); if (e) e.prepend(burger()); }
    const v = document.getElementById('view'); if (!v) return;
    if (v.querySelector('.termwrap')) termExtras(v);
    if (v.querySelector('.files')) filesExtras(v);
    const fwc = v.querySelector('.card-title'); if (fwc && /Port forwards/.test(fwc.textContent) && !fwc.dataset.mob) {
      fwc.dataset.mob = '1'; // mark first: rewriting text below re-triggers this observer
      fwc.querySelector('.muted').textContent = '· a port on the server shows up on this device at 127.0.0.1:<device port>';
      const th = v.querySelector('th:nth-child(4)'); if (th) th.textContent = 'Device port';
      if (M.platform === 'ios') v.querySelector('.card').insertAdjacentHTML('beforeend', '<p class="muted small ios-note">iOS pauses forwards when Uiable Connect is in the background. Keep the app open while you use a forwarded port; reconnect if it stops.</p>');
    }
    const pill = document.getElementById('uiPill'); const ob = document.getElementById('openUiB'); if (ob) ob.remove();
    if (pill && M.platform === 'ios' && document.getElementById('openUi') && !pill.querySelector('.ios-note')) pill.insertAdjacentHTML('beforeend', '<span class="muted small ios-note">Stays up while the app is open</span>');
  }
  new MutationObserver(decorate).observe(document.getElementById('main'), { childList: true, subtree: true });
  // modal wording (secrets are in Keychain/Keystore, not DPAPI)
  new MutationObserver(() => document.querySelectorAll('.modal .body > p.muted.small').forEach(p => { if (/DPAPI|Windows/.test(p.textContent)) p.textContent = `Passwords and keys are encrypted with ${M.platform === 'ios' ? 'the iOS Keychain' : 'the Android Keystore'} and never leave this device.`; }))
    .observe(body, { childList: true });
  // on-screen keyboard resizes the viewport: refit the terminal
  if (window.visualViewport) visualViewport.addEventListener('resize', () => { document.documentElement.style.setProperty('--vvh', visualViewport.height + 'px'); window.dispatchEvent(new Event('resize')); });
  decorate();
})();
