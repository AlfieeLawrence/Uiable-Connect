'use strict';
// Per-server alert rules, evaluated on the stats the app already polls (only while running + connected).
const ALERT_METRICS = {
  cpu: { label: 'CPU usage', unit: '%' }, mem: { label: 'RAM usage', unit: '%' }, disk: { label: 'Disk usage', unit: '%' },
  swap: { label: 'Swap usage', unit: '%' }, load: { label: 'Load average (1 min)', unit: '' }, disconnect: { label: 'Server disconnected unexpectedly', unit: '' },
};
const defaultAlerts = () => [
  { id: 'cpu', metric: 'cpu', threshold: 90, forSec: 60, cooldownMin: 15, enabled: true },
  { id: 'mem', metric: 'mem', threshold: 90, forSec: 60, cooldownMin: 15, enabled: true },
  { id: 'disk', metric: 'disk', mount: '', threshold: 90, forSec: 0, cooldownMin: 60, enabled: true },
  { id: 'swap', metric: 'swap', threshold: 80, forSec: 120, cooldownMin: 30, enabled: false },
  { id: 'load', metric: 'load', threshold: 8, forSec: 120, cooldownMin: 30, enabled: false },
  { id: 'disconnect', metric: 'disconnect', enabled: true },
];
const rulesFor = s => (s.alerts && s.alerts.length ? s.alerts : defaultAlerts());
const alertState = {}; // serverId -> ruleId -> { since, last }
function metricValue(r, x) {
  const pct = (a, b) => (b ? 100 * a / b : null);
  if (r.metric === 'cpu') return x.cpu == null ? null : { v: x.cpu };
  if (r.metric === 'mem') return x.memTotal ? { v: pct(x.memUsed, x.memTotal) } : null;
  if (r.metric === 'swap') return x.swapTotal ? { v: pct(x.swapUsed, x.swapTotal) } : null;
  if (r.metric === 'load') return x.load ? { v: x.load[0] } : null;
  if (r.metric === 'disk') { const ds = (x.disks || []).filter(d => !r.mount || d.mount === r.mount); if (!ds.length) return null;
    const top = ds.map(d => ({ v: pct(d.used, d.size), where: d.mount })).sort((a, b) => b.v - a.v)[0]; return top; }
  return null;
}
// Returns messages for rules that fire now. Pure apart from alertState (so it can be unit tested).
function evalAlerts(s, x, now = Date.now()) {
  const st = alertState[s.id] ||= {}; const out = [];
  for (const r of rulesFor(s)) {
    if (!r.enabled || r.metric === 'disconnect') { delete st[r.id]; continue; }
    const m = metricValue(r, x); const k = st[r.id] ||= { since: null, last: 0 };
    if (!m || !(m.v > Number(r.threshold))) { k.since = null; continue; }
    k.since ??= now;
    if (now - k.since >= (Number(r.forSec) || 0) * 1000 && (!k.last || now - k.last >= (Number(r.cooldownMin) || 0) * 60000)) {
      k.last = now; const meta = ALERT_METRICS[r.metric];
      const val = r.metric === 'load' ? m.v.toFixed(2) : Math.round(m.v) + '%';
      out.push(`${meta.label} is ${val}${m.where ? ' on ' + m.where : ''} (above ${r.threshold}${meta.unit}${Number(r.forSec) ? ' for ' + r.forSec + 's' : ''})`);
    }
  }
  return out;
}

function vAlerts(s, u, v) {
  if (s.connected && isSsh(s) && !u.statsBusy && (!u.stats || Date.now() - (u.statsAt || 0) > 5000)) {
    u.statsBusy = true; uc.call('stats', s.id).then(x => { onStats(s, x); if (anyPane(s.id, 'alerts')) vAlerts(s, u, v); }).catch(() => {}).finally(() => { u.statsBusy = false; });
  }
  const rules = rulesFor(s).map(r => ({ ...r })); const mounts = (u.stats?.disks || []).map(d => d.mount);
  const num = (r, k, w, step = 1) => `<input type="number" min="0" step="${step}" data-k="${k}" value="${esc(r[k])}" style="width:${w}px">`;
  const live = (r) => {
    if (!s.connected || !u.stats || r.metric === 'disconnect') return null;
    return metricValue(r, u.stats);
  };
  const statusChip = (r) => {
    if (!r.enabled) return '<span class="achip off">Off</span>';
    if (r.metric === 'disconnect') return '<span class="achip idle">Watching</span>';
    if (!s.connected) return '<span class="achip idle">Idle</span>';
    const m = live(r);
    if (!m) return '<span class="achip idle">No data</span>';
    const hot = m.v > Number(r.threshold);
    const st = (alertState[s.id] || {})[r.id] || {};
    if (hot && st.since) {
      const secs = Math.round((Date.now() - st.since) / 1000);
      return `<span class="achip fire">Firing · ${secs}s</span>`;
    }
    if (hot) return '<span class="achip warn">Above</span>';
    return '<span class="achip ok">OK</span>';
  };
  const liveLine = (r) => {
    if (r.metric === 'disconnect') return '<span class="muted small">Fires if the link drops without you pressing Disconnect</span>';
    const m = live(r); const meta = ALERT_METRICS[r.metric];
    if (!s.connected) return '<span class="muted small">Connect to start checking this rule</span>';
    if (!m) return '<span class="muted small">Waiting for stats…</span>';
    const val = r.metric === 'load' ? m.v.toFixed(2) : Math.round(m.v) + '%';
    const st = (alertState[s.id] || {})[r.id] || {};
    const last = st.last ? ` · last alert ${new Date(st.last).toLocaleString('en-GB')}` : '';
    return `<span class="muted small">Now <b>${esc(val)}</b>${m.where ? ' on ' + esc(m.where) : ''} · threshold ${r.threshold}${meta.unit}${last}</span>`;
  };
  const enabledN = rules.filter(r => r.enabled).length;
  v.innerHTML = `<div class="card alerts"><div class="row" style="margin-bottom:8px;align-items:flex-start"><div class="grow"><div class="card-title">Alerts</div>
      <p class="muted small" style="margin:4px 0 0">Rules are checked about every 10 s while Connect is open and this server is connected. You get a system notification and an in-app toast.</p></div>
      <div class="row" style="gap:6px;flex-wrap:wrap"><span class="pill small">${enabledN} on</span><button class="sm" id="aTest">Test</button><button class="sm" id="aReset">Defaults</button></div></div>
    <div class="alist">${rules.map((r, i) => { const m = ALERT_METRICS[r.metric]; return `<div class="arule ${r.enabled ? '' : 'off'}" data-i="${i}">
      <div class="arule-top"><label class="atog"><input type="checkbox" data-k="enabled" ${r.enabled ? 'checked' : ''}><b>${m.label}</b></label>${statusChip(r)}</div>
      <div class="arule-live">${liveLine(r)}</div>
      ${r.metric === 'disconnect' ? '' : `<div class="aopts">
        ${r.metric === 'disk' ? `<select data-k="mount" title="Mount point"><option value="">any mount</option>${[...new Set([...mounts, r.mount].filter(Boolean))].map(x => `<option ${x === r.mount ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>` : ''}
        <span>above ${num(r, 'threshold', 70, r.metric === 'load' ? 0.5 : 1)}${m.unit}</span>
        <span>for ${num(r, 'forSec', 70, 10)} s</span>
        <span>quiet ${num(r, 'cooldownMin', 64)} min</span>
      </div>`}
    </div>`; }).join('')}</div>
    <p class="muted small" style="margin:12px 0 0">Tip: turn a rule on, then leave Home open so stats keep flowing — or any other tab while connected. ${s.connected ? '' : 'Connect this server to start checking.'}</p></div>`;
  const persist = async () => { await call('servers:alerts', s.id, rules); s.alerts = rules; };
  v.querySelectorAll('[data-k]').forEach(inp => inp.onchange = async () => { const r = rules[inp.closest('.arule').dataset.i];
    r[inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? Math.max(0, Number(inp.value) || 0) : inp.value;
    inp.closest('.arule').classList.toggle('off', !r.enabled); delete (alertState[s.id] || {})[r.id];
    if (inp.dataset.k === 'enabled' && r.enabled) uc.call('notify:permission').catch(() => {});
    await persist(); vAlerts(s, u, v); });
  $('#aReset').onclick = async () => { rules.splice(0, rules.length, ...defaultAlerts()); await persist(); vAlerts(s, u, v); };
  $('#aTest').onclick = async () => { await uc.call('notify:permission').catch(() => {}); raiseAlert(s, 'Test notification: alerts are working'); };
}
function raiseAlert(s, msg) {
  toast(`⚠ ${s.name || s.host}: ${msg}`, true);
  uc.call('notify', { title: `Uiable Connect · ${s.name || s.host}`, body: msg }).catch(() => {});
}
if (typeof module !== 'undefined') module.exports = { defaultAlerts, evalAlerts, alertState };
