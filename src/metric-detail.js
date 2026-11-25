'use strict';
// Overview metric → full-detail modal (1.4.12). Big chart with time range, min/avg/max/current, hover/keyboard
// tooltips, per-core / per-interface / per-device / per-mount / per-GPU detail sampled live from /proc while open,
// Esc to close and a page scroll lock (shared dialog plumbing in ux.js). Ranges beyond this session come from
// Uiable's stored metrics history when Uiable runs on the server (read-only, via `docker exec uiable node …`
// or the host data dir; plain → sudo -n → saved sudo password).
const MD = (() => {
  const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
  // Runs inside Uiable's container (or on the host): reads metrics/history.sqlite (node:sqlite, read-only) or the
  // JSONL fallback, buckets to <= UCN points, prints JSON. Also returns the last Uiable alerts (alerts-history.jsonl).
  const READER = `const fs=require('fs'),p=require('path');const E=process.env,D=E.UCD||'/data',F=+E.UCF||0,T=+E.UCT||Date.now(),N=Math.max(10,+E.UCN||600),B=Math.max(1,Math.floor((T-F)/N));const o=x=>process.stdout.write(JSON.stringify(x));
if(E.UCM==='alerts'){let a=[];try{a=fs.readFileSync(p.join(D,'alerts-history.jsonl'),'utf8').trim().split('\\n').slice(-40).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean)}catch(e){}o({ok:1,alerts:a})}else{
const K=['cpu','mem','disk','rx','tx','temp','gpu','load1'];let rows=[],be='none',ret=null;const md=p.join(D,'metrics');try{ret=JSON.parse(fs.readFileSync(p.join(md,'settings.json'),'utf8'))}catch(e){}
try{const f=p.join(md,'history.sqlite');if(fs.existsSync(f)){const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(f,{readOnly:true});rows=db.prepare('SELECT CAST(t/'+B+' AS INTEGER)*'+B+' AS t,'+K.map(k=>'avg('+k+') AS '+k).join(',')+',max(cpu) AS cpuMax,min(cpu) AS cpuMin FROM samples WHERE t>=? AND t<=? GROUP BY CAST(t/'+B+' AS INTEGER) ORDER BY t').all(F,T).map(r=>[r.t].concat(K.map(k=>r[k]),[r.cpuMax,r.cpuMin]));be='sqlite'}}catch(e){be='none'}
if(be==='none'){const m=new Map();let n=[];try{n=fs.readdirSync(md).filter(x=>/\\.jsonl$/.test(x)).sort()}catch(e){}for(const x of n){let t='';try{t=fs.readFileSync(p.join(md,x),'utf8')}catch(e){continue}for(const l of t.split('\\n')){if(!l)continue;let r;try{r=JSON.parse(l)}catch(e){continue}if(r.t<F||r.t>T)continue;const k=Math.floor(r.t/B)*B;let a=m.get(k);if(!a){a={n:{},s:{},mx:null,mn:null};m.set(k,a)}for(const q of K)if(r[q]!=null){a.s[q]=(a.s[q]||0)+r[q];a.n[q]=(a.n[q]||0)+1}if(r.cpu!=null){a.mx=Math.max(a.mx??-1,r.cpu);a.mn=Math.min(a.mn??1e9,r.cpu)}}be='jsonl'}
rows=[...m.entries()].sort((a,b)=>a[0]-b[0]).map(([t,a])=>[t].concat(K.map(q=>a.n[q]?a.s[q]/a.n[q]:null),[a.mx,a.mn]))}
o({ok:1,backend:be,bucketMs:B,retain:ret,rows})}`;
  const b64 = typeof btoa === 'function' ? s => btoa(unescape(encodeURIComponent(s))) : s => Buffer.from(s).toString('base64');
  const envs = o => Object.entries(o).map(([k, v]) => `${k}=${shq(v)}`);
  // ways to run the reader, best first
  const ways = () => {
    const js = `"$(printf %s ${b64(READER)} | base64 -d)"`;
    return [
      { k: 'dk', cmd: o => `docker exec ${envs(o).map(e => '-e ' + e).join(' ')} uiable node -e ${js}` },
      { k: 'host', cmd: o => `for D in "$(sed -n 's/^UIABLE_DATA_DIR=//p' /opt/uiable/.env 2>/dev/null | tail -1)" /opt/uiable/data /var/lib/docker/volumes/uiable-data/_data; do [ -n "$D" ] && [ -d "$D/metrics" -o -f "$D/alerts-history.jsonl" ] && break; D=; done; [ -n "$D" ] || exit 3; for N in node /opt/uiable/node/bin/node /usr/local/bin/node; do command -v $N >/dev/null 2>&1 && break; N=; done; [ -n "$N" ] || exit 4; ${envs(o).join(' ')} UCD="$D" $N -e ${js}` },
    ];
  };
  // try: plain, then sudo -n, then saved sudo password (fd-fed). Never prompts. Remembers what worked per session.
  async function uiableRead(s, opts) {
    const u = S(s.id); if (u.uiHistNo && Date.now() - u.uiHistNo.t < 120000) throw new Error(u.uiHistNo.why);
    const combos = u.uiHistWay ? [u.uiHistWay] : [];
    for (const w of ways()) for (const m of ['plain', 'sudoN', 'sudoPw']) combos.push({ w: w.k, m });
    let why = 'Uiable history isn\'t readable with this SSH user';
    for (const c of combos) {
      if (c.m === 'sudoPw' && !s.has_sudoPassword) continue;
      const w = ways().find(x => x.k === c.w); const cmd = w.cmd(opts);
      try {
        const r = c.m === 'sudoPw' ? await uc.call('sudo:exec', s.id, `sh -c ${shq(cmd)}`) : await uc.call('exec', s.id, c.m === 'sudoN' ? `sudo -n sh -c ${shq(cmd)}` : cmd, 30000);
        if (r.code === 0 && /^\{/.test(String(r.out).trim())) { u.uiHistWay = c; u.uiHistNo = null; return JSON.parse(r.out); }
        if (/No such container/i.test(r.err || '')) why = 'Uiable isn\'t running in Docker here';
      } catch (e) { why = e.message || why; }
    }
    u.uiHistNo = { t: Date.now(), why }; throw new Error(why);
  }
  const hasUiable = s => { const ui = S(s.id).uiable; return !!(ui && (ui.reachable || ui.installed || ui.isUiable)); };

  // metric definitions: session keys (u.statsHist) and Uiable keys (row index in reader output)
  const UI_IDX = { cpu: 1, mem: 2, disk: 3, rx: 4, tx: 5, temp: 6, gpu: 7, load1: 8 };
  const DEF = {
    cpu: { title: 'CPU', unit: '%', max: 100, series: [['cpu', 'cpu', 'CPU', 'var(--accent)'], ['temp', 'temp', 'Temperature (°C)', '#fb7185', '°C']], live: 'cpu' },
    mem: { title: 'Memory', unit: '%', max: 100, series: [['mem', 'mem', 'Memory', 'var(--ok)'], ['swap', null, 'Swap', 'var(--warn)']], live: 'mem' },
    load: { title: 'Load average', unit: '', series: [['load', 'load1', 'Load (1 min)', '#2dd4bf']], live: 'load' },
    net: { title: 'Network I/O', unit: 'B/s', series: [['netRx', 'rx', 'Received', '#38bdf8'], ['netTx', 'tx', 'Sent', '#818cf8']], live: 'net' },
    diskio: { title: 'Disk I/O', unit: 'B/s', series: [['diskR', null, 'Read', '#34d399'], ['diskW', null, 'Write', '#fbbf24']], live: 'disk' },
    gpu: { title: 'GPU', unit: '%', max: 100, series: [['gpu', 'gpu', 'GPU', '#a78bfa'], ['gpuMem', null, 'VRAM', '#c4b5fd']], live: 'gpu' },
    storage: { title: 'Storage', unit: '%', max: 100, series: [[null, 'disk', 'Primary disk used', 'var(--accent-2)']], live: 'mounts' },
  };
  const RANGES = [['live', 'This session'], ['1h', '1 h'], ['6h', '6 h'], ['24h', '24 h'], ['7d', '7 d'], ['30d', '30 d']];
  const RMS = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };
  const fmt = (v, unit, d) => { if (v == null || isNaN(v)) return '–'; if (unit === 'B/s') return fmtB(v) + '/s'; if (unit === '%') return (+v).toFixed(d ?? 1) + '%'; if (unit === '°C') return Math.round(v) + '°C'; return (+v).toFixed(d ?? 2); };
  const tfmt = (t, span) => { const d = new Date(t); return span > 2 * 86400e3 ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleTimeString('en-GB', span < 3 * 3600e3 ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' }); };
  const nice = mx => { if (!(mx > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(mx))); const f = mx / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

  // ---------- live detail sampler (/proc), deltas between two reads
  const LIVE_CMD = { cpu: "grep '^cpu' /proc/stat; echo ---; cat /proc/loadavg", mem: 'cat /proc/meminfo', load: "cat /proc/loadavg; echo ---; nproc 2>/dev/null; echo ---; ps -eo stat= 2>/dev/null | cut -c1 | sort | uniq -c",
    net: 'cat /proc/net/dev', disk: 'cat /proc/diskstats', gpu: 'nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits 2>/dev/null', mounts: null };
  function parseLive(kind, out, prev, dt) {
    const L = String(out || '').split('\n');
    if (kind === 'cpu') { const cores = []; const raw = {};
      for (const l of L) { const m = /^(cpu\d*)\s+(.*)$/.exec(l); if (!m) continue; const f = m[2].trim().split(/\s+/).map(Number); const idle = f[3] + (f[4] || 0), tot = f.reduce((a, b) => a + b, 0); raw[m[1]] = [idle, tot];
        if (prev && prev[m[1]] && m[1] !== 'cpu') { const di = idle - prev[m[1]][0], dtot = tot - prev[m[1]][1]; cores.push({ name: m[1].replace('cpu', 'Core '), v: dtot > 0 ? Math.max(0, 100 * (1 - di / dtot)) : 0 }); } }
      return { raw, cores }; }
    if (kind === 'mem') { const k = {}; for (const l of L) { const m = /^(\w+(?:\(\w+\))?):\s+(\d+)/.exec(l); if (m) k[m[1]] = +m[2] * 1024; }
      const used = k.MemTotal - (k.MemAvailable ?? k.MemFree); return { rows: [['Used by apps', used - (k.Shmem || 0), 'var(--ok)'], ['Shared / tmpfs', k.Shmem || 0, '#22d3ee'], ['Buffers', k.Buffers || 0, '#a78bfa'], ['Page cache', (k.Cached || 0) - (k.Shmem || 0), '#818cf8'], ['Free', k.MemFree || 0, 'var(--track)']], total: k.MemTotal, avail: k.MemAvailable, swapT: k.SwapTotal, swapU: (k.SwapTotal || 0) - (k.SwapFree || 0), dirty: k.Dirty }; }
    if (kind === 'load') { const [la, np, ps] = out.split('---'); const f = (la || '').trim().split(/\s+/); const st = {}; for (const l of (ps || '').trim().split('\n')) { const m = /(\d+)\s+(\S)/.exec(l); if (m) st[m[2]] = +m[1]; }
      return { l1: +f[0], l5: +f[1], l15: +f[2], run: (f[3] || '').split('/')[0], tot: (f[3] || '').split('/')[1], cores: +String(np).trim() || null, st }; }
    if (kind === 'net') { const raw = {}, rows = []; for (const l of L) { const m = /^\s*([\w.@-]+):\s*(.*)$/.exec(l); if (!m) continue; const f = m[2].trim().split(/\s+/).map(Number); raw[m[1]] = [f[0], f[8]];
        const p = prev && prev[m[1]]; rows.push({ name: m[1], rx: p && dt ? Math.max(0, (f[0] - p[0]) / dt) : null, tx: p && dt ? Math.max(0, (f[8] - p[1]) / dt) : null, rxT: f[0], txT: f[8] }); }
      return { raw, rows: rows.filter(r => r.name !== 'lo').sort((a, b) => (b.rxT + b.txT) - (a.rxT + a.txT)) }; }
    if (kind === 'disk') { const raw = {}, rows = []; const whole = /^(sd[a-z]+|vd[a-z]+|hd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+|md\d+|dm-\d+)$/;
      for (const l of L) { const p = l.trim().split(/\s+/); if (p.length < 14 || !whole.test(p[2])) continue; const r = +p[5] * 512, w = +p[9] * 512, busy = +p[12]; raw[p[2]] = [r, w, busy]; const q = prev && prev[p[2]];
        rows.push({ name: p[2], r: q && dt ? (r - q[0]) / dt : null, w: q && dt ? (w - q[1]) / dt : null, util: q && dt ? Math.min(100, (busy - q[2]) / (dt * 10)) : null, rT: r, wT: w }); }
      return { raw, rows }; }
    if (kind === 'gpu') return { rows: L.filter(l => l.trim()).map(l => { const p = l.split(',').map(x => x.trim()); const n = i => (p[i] === '' || /N\/A/.test(p[i]) ? null : +p[i]); return { i: p[0], name: p[1], util: n(2), mu: n(3) * 1048576, mt: n(4) * 1048576, temp: n(5), pw: n(6) }; }) };
    return {};
  }

  function open(s, u, key) {
    const d = DEF[key]; if (!d) return;
    let range = u.mdRange && u.mdRange[key] || 'live'; let uiRows = null, uiMeta = null, uiErr = null, hover = null, liveTimer = null, prevRaw = null, prevT = 0, live = null, chartTimer = null;
    const m = el(`<div class="modal-bg md-bg"><div class="modal md-modal" style="width:min(1080px,100%)"><header><h3 class="grow">${esc(d.title)} <span class="muted small">· ${esc(s.name || s.host)}</span></h3><button type="button" class="sm icon-btn" id="c" aria-label="Close (Esc)" title="Close (Esc)">${UX.icon('x')}</button></header>
      <div class="body md-body"><div class="md-top"><div class="seg md-ranges" role="radiogroup" aria-label="Time range">${RANGES.map(([k, l]) => `<button type="button" role="radio" data-r="${k}" aria-checked="${k === range}" class="${k === range ? 'active' : ''}">${l}</button>`).join('')}</div><span class="muted small md-src" id="mdSrc" aria-live="polite"></span></div>
      <div class="md-stats" id="mdStats"></div>
      <div class="md-chart" id="mdChart" tabindex="0" role="img" aria-label="${esc(d.title)} chart. Use the left and right arrow keys to read values."><div class="md-tip hidden" id="mdTip" role="status"></div></div>
      <div class="md-legend" id="mdLeg"></div>
      <h4 class="md-h">Live detail <span class="muted small" id="mdLiveNote"></span></h4><div class="md-live" id="mdLive">${UX.skel.lines(3)}</div></div></div></div>`);
    const close = () => { clearTimeout(liveTimer); clearInterval(chartTimer); m.remove(); };
    m.querySelector('#c').onclick = close; m._close = close;
    m.addEventListener('pointerdown', e => { if (e.target === m) close(); });
    document.body.append(m); m.querySelector('#mdChart').focus();
    const C = m.querySelector('#mdChart'), tip = m.querySelector('#mdTip');

    const data = () => { // -> { t:[], series:[{label,color,unit,vals}] }
      if (range === 'live') { const hh = u.statsHist || [];
        const ss = d.series.filter(x => x[0] && hh.some(p => p[x[0]] != null)).map(([sk, , lab, col, un]) => ({ label: lab, color: col, unit: un || d.unit, vals: hh.map(p => p[sk]) }));
        if (key === 'storage') { const x = u.stats; return { t: [], series: [], note: x ? '' : '' }; }
        return { t: hh.map(p => p.t), series: ss }; }
      if (!uiRows) return { t: [], series: [] };
      const ss = d.series.filter(x => x[1] && uiRows.some(r => r[UI_IDX[x[1]]] != null)).map(([, uk, lab, col, un]) => ({ label: lab, color: col, unit: un || d.unit, vals: uiRows.map(r => r[UI_IDX[uk]]) }));
      if (key === 'cpu' && uiRows.some(r => r[9] != null)) ss.splice(1, 0, { label: 'CPU peak in bucket', color: 'color-mix(in srgb, var(--accent) 45%, transparent)', unit: '%', vals: uiRows.map(r => r[9]), thin: true });
      return { t: uiRows.map(r => r[0]), series: ss };
    };
    const drawChart = () => {
      const { t, series } = data(); const W = Math.max(320, C.clientWidth || 900), H = Math.max(200, Math.min(340, Math.round(W * .36))), pl = 56, pr = 14, pt = 12, pb = 28;
      C.querySelector('svg')?.remove();
      if (!series.length || t.length < 2) {
        C.querySelector('.md-none')?.remove();
        C.insertAdjacentHTML('afterbegin', `<div class="md-none">${range === 'live' ? (key === 'storage' ? 'Storage usage over time comes from Uiable\'s history — pick a range above. Per-mount usage is below.' : 'Collecting samples… the chart fills in every few seconds while this connection is open.') : uiErr ? esc(uiErr) : uiRows ? 'No samples stored for this range yet.' : UX.skel.lines(2)}</div>`);
        m.querySelector('#mdStats').innerHTML = ''; m.querySelector('#mdLeg').innerHTML = ''; return; }
      C.querySelector('.md-none')?.remove();
      const t0 = t[0], t1 = t[t.length - 1], span = Math.max(1, t1 - t0);
      const unitMain = series[0].unit; const sameUnit = series.filter(x => x.unit === unitMain);
      let mx = d.max && unitMain === '%' ? 100 : nice(Math.max(...sameUnit.flatMap(x => x.vals.filter(v => v != null))) * 1.1 || 1);
      const X = tt => pl + (tt - t0) / span * (W - pl - pr), Y = v => pt + (1 - v / mx) * (H - pt - pb);
      const grid = [0, .25, .5, .75, 1].map(f => { const v = mx * f; return `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="md-grid"/><text x="${pl - 8}" y="${Y(v) + 4}" text-anchor="end" class="md-ax">${esc(fmt(v, unitMain, unitMain === '%' ? 0 : 1))}</text>`; }).join('');
      const xt = Array.from({ length: 5 }, (_, i) => t0 + span * i / 4).map((tt, i) => `<text x="${X(tt)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}" class="md-ax">${esc(tfmt(tt, span))}</text>`).join('');
      const lines = sameUnit.map((sr, si) => { let dpath = '', pen = false; sr.vals.forEach((v, i) => { if (v == null || isNaN(v)) { pen = false; return; } dpath += `${pen ? 'L' : 'M'}${X(t[i]).toFixed(1)},${Y(Math.min(v, mx)).toFixed(1)}`; pen = true; });
        const area = si === 0 && !sr.thin ? `<path d="${dpath}L${X(t1).toFixed(1)},${Y(0)}L${X(t0).toFixed(1)},${Y(0)}Z" fill="${sr.color}" opacity=".12" class="md-area"/>` : '';
        return `${area}<path d="${dpath}" fill="none" stroke="${sr.color}" stroke-width="${sr.thin ? 1 : 2}" stroke-linejoin="round" stroke-linecap="round" ${sr.thin ? 'stroke-dasharray="3 3"' : ''}/>`; }).join('');
      let cross = '';
      if (hover != null && t[hover] != null) { const x = X(t[hover]); cross = `<line x1="${x}" x2="${x}" y1="${pt}" y2="${H - pb}" class="md-cross"/>` + sameUnit.map(sr => sr.vals[hover] == null ? '' : `<circle cx="${x}" cy="${Y(Math.min(sr.vals[hover], mx))}" r="4" fill="${sr.color}" stroke="var(--card-solid)" stroke-width="2"/>`).join('');
        tip.classList.remove('hidden'); tip.innerHTML = `<b>${esc(tfmt(t[hover], span < 86400e3 ? 0 : span))}</b>${series.map(sr => `<span><i style="background:${sr.color}"></i>${esc(sr.label)} <b>${esc(fmt(sr.vals[hover], sr.unit))}</b></span>`).join('')}`;
        const left = x / W * C.clientWidth; tip.style.left = Math.min(Math.max(8, left + 12), C.clientWidth - tip.offsetWidth - 8) + 'px'; }
      else tip.classList.add('hidden');
      C.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" aria-hidden="true">${grid}${xt}${lines}${cross}</svg>`);
      C._map = { t, X, W, pl, pr };
      const st = series.filter(x => !x.thin).map(sr => { const hs = histStats(sr.vals); return `<div class="md-stat"><span class="md-sl"><i style="background:${sr.color}"></i>${esc(sr.label)}</span><span><small>Current</small><b>${esc(fmt(hs.last, sr.unit))}</b></span><span><small>Average</small><b>${esc(fmt(hs.avg, sr.unit))}</b></span><span><small>Min</small><b>${esc(fmt(hs.min, sr.unit))}</b></span><span><small>Max</small><b>${esc(fmt(hs.max, sr.unit))}</b></span></div>`; }).join('');
      m.querySelector('#mdStats').innerHTML = st;
      m.querySelector('#mdLeg').innerHTML = `<span class="muted small">${t.length} points · ${esc(tfmt(t0, span))} – ${esc(tfmt(t1, span))}</span>`;
    };
    const pick = clientX => { const mp = C._map; if (!mp) return; const r = C.getBoundingClientRect(); const x = (clientX - r.left) / r.width * mp.W; let best = 0, bd = Infinity; mp.t.forEach((tt, i) => { const dd = Math.abs(mp.X(tt) - x); if (dd < bd) { bd = dd; best = i; } }); hover = best; drawChart(); };
    C.addEventListener('pointermove', e => pick(e.clientX)); C.addEventListener('pointerdown', e => pick(e.clientX));
    C.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { hover = null; drawChart(); } });
    C.addEventListener('keydown', e => { const mp = C._map; if (!mp) return; if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); hover = hover == null ? mp.t.length - 1 : Math.max(0, Math.min(mp.t.length - 1, hover + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1))); drawChart(); } if (e.key === 'Home') { hover = 0; drawChart(); } if (e.key === 'End') { hover = mp.t.length - 1; drawChart(); } });
    C.addEventListener('blur', () => { hover = null; drawChart(); });

    const setSrc = () => { const el2 = m.querySelector('#mdSrc');
      if (range === 'live') el2.textContent = `This session · ${(u.statsHist || []).length} samples every ~3 s`;
      else if (uiErr) el2.textContent = 'Uiable history unavailable';
      else if (uiMeta) el2.textContent = `Uiable metrics history (${uiMeta.backend}) · ${Math.round(uiMeta.bucketMs / 1000) >= 60 ? Math.round(uiMeta.bucketMs / 60000) + '-min' : Math.round(uiMeta.bucketMs / 1000) + '-s'} averages${uiMeta.retain && uiMeta.retain.retainDays ? ` · kept ${uiMeta.retain.retainDays} days` : ''}`;
      else el2.textContent = 'Loading Uiable history…'; };
    const loadRange = async () => {
      m.querySelectorAll('[data-r]').forEach(b => { const on = b.dataset.r === range; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
      (u.mdRange ||= {})[key] = range; hover = null; uiErr = null;
      if (range === 'live') { uiRows = null; setSrc(); drawChart(); return; }
      uiRows = null; uiMeta = null; setSrc(); drawChart();
      if (!hasUiable(s)) { uiErr = 'Longer ranges use the metrics history Uiable stores on the server. Install Uiable (see Overview) to keep up to 90 days of history.'; setSrc(); drawChart(); return; }
      const want = range;
      try { const now = Date.now(); const r = await uiableRead(s, { UCM: 'hist', UCF: String(now - RMS[range]), UCT: String(now), UCN: '480' }); if (range !== want) return; uiRows = r.rows || []; uiMeta = r; }
      catch (e) { if (range !== want) return; uiErr = `Couldn't read Uiable's history: ${e.message}. It needs access to Docker on the server (docker group, passwordless sudo or a saved sudo password).`; }
      setSrc(); drawChart();
    };
    m.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { range = b.dataset.r; loadRange(); });
    m.querySelector('.md-ranges').onkeydown = e => { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; e.preventDefault(); const i = RANGES.findIndex(r => r[0] === range); range = RANGES[(i + (e.key === 'ArrowRight' ? 1 : -1) + RANGES.length) % RANGES.length][0]; loadRange().then(() => m.querySelector(`[data-r="${range}"]`)?.focus()); };

    // ---- live detail
    const bar = (p, col) => `<div class="bar md-bar"><i style="width:${Math.max(0, Math.min(100, p || 0)).toFixed(1)}%;${col ? 'background:' + col : ''}"></i></div>`;
    const drawLive = () => { const L = m.querySelector('#mdLive'), x = u.stats || {}; if (!L) return;
      if (d.live === 'mounts') { const ds = x.disks || []; L.innerHTML = ds.length ? `<div class="md-rows">${ds.map(q => { const p = q.size ? 100 * q.used / q.size : 0; return `<div class="md-row"><span class="mono ellipsis" title="${esc(q.mount)}">${esc(q.mount)}</span>${bar(p, p > 90 ? 'var(--danger)' : p > 75 ? 'var(--warn)' : '')}<span class="small nowrap">${fmtB(q.used)} / ${fmtB(q.size)} · ${p.toFixed(0)}%</span></div>`; }).join('')}</div>` : '<p class="muted">No disks reported.</p>'; return; }
      if (!live) return;
      if (d.live === 'cpu') { if (!live.cores.length) { L.innerHTML = UX.skel.lines(2); return; } L.innerHTML = `<div class="md-cores" style="--n:${live.cores.length}">${live.cores.map(c => `<div class="md-core" title="${esc(c.name)}: ${c.v.toFixed(1)}%"><span class="small">${esc(c.name)}</span>${bar(c.v, c.v > 90 ? 'var(--danger)' : c.v > 70 ? 'var(--warn)' : '')}<b class="small">${c.v.toFixed(0)}%</b></div>`).join('')}</div>`; return; }
      if (d.live === 'mem') { const t = live.total || 1; L.innerHTML = `<div class="md-stack" role="img" aria-label="Memory breakdown">${live.rows.map(([n, v, c]) => `<i style="width:${(100 * Math.max(0, v) / t).toFixed(2)}%;background:${c}" title="${esc(n)} ${fmtB(v)}"></i>`).join('')}</div>
        <div class="md-rows">${live.rows.map(([n, v, c]) => `<div class="md-row"><span><i class="md-sw" style="background:${c}"></i>${esc(n)}</span><span></span><span class="small nowrap">${fmtB(Math.max(0, v))} · ${(100 * Math.max(0, v) / t).toFixed(1)}%</span></div>`).join('')}
        <div class="md-row"><span>Available</span><span></span><span class="small">${fmtB(live.avail)}</span></div>${live.swapT ? `<div class="md-row"><span>Swap</span>${bar(100 * live.swapU / live.swapT, 'var(--warn)')}<span class="small nowrap">${fmtB(live.swapU)} / ${fmtB(live.swapT)}</span></div>` : ''}</div>`; return; }
      if (d.live === 'load') { const c = live.cores || x.cores || 1; L.innerHTML = `<div class="md-rows">${[['1 min', live.l1], ['5 min', live.l5], ['15 min', live.l15]].map(([n, v]) => `<div class="md-row"><span>${n}</span>${bar(100 * v / c, v > c ? 'var(--danger)' : '')}<span class="small nowrap">${v.toFixed(2)} · ${(100 * v / c).toFixed(0)}% of ${c} cores</span></div>`).join('')}
        <div class="md-row"><span>Processes</span><span class="small">${esc(live.run)} running of ${esc(live.tot)}${live.st.D ? ` · <b>${live.st.D}</b> waiting on I/O` : ''}${live.st.Z ? ` · ${live.st.Z} zombie` : ''}</span><span></span></div></div>`; return; }
      if (d.live === 'net') { L.innerHTML = live.rows.length ? `<table class="list md-t"><thead><tr><th scope="col">Interface</th><th scope="col" class="right">↓ Receive</th><th scope="col" class="right">↑ Send</th><th scope="col" class="right">Total in / out</th></tr></thead><tbody>${live.rows.map(r => `<tr><td class="mono">${esc(r.name)}</td><td class="right">${r.rx == null ? '…' : fmtB(r.rx) + '/s'}</td><td class="right">${r.tx == null ? '…' : fmtB(r.tx) + '/s'}</td><td class="right muted small">${fmtB(r.rxT)} / ${fmtB(r.txT)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No interfaces.</p>'; return; }
      if (d.live === 'disk') { L.innerHTML = live.rows.length ? `<table class="list md-t"><thead><tr><th scope="col">Device</th><th scope="col" class="right">Read</th><th scope="col" class="right">Write</th><th scope="col">Busy</th></tr></thead><tbody>${live.rows.map(r => `<tr><td class="mono">${esc(r.name)}</td><td class="right">${r.r == null ? '…' : fmtB(r.r) + '/s'}</td><td class="right">${r.w == null ? '…' : fmtB(r.w) + '/s'}</td><td style="min-width:120px">${r.util == null ? '…' : bar(r.util) + `<span class="small">${r.util.toFixed(0)}%</span>`}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No block devices.</p>'; return; }
      if (d.live === 'gpu') { L.innerHTML = live.rows.length ? `<div class="md-rows">${live.rows.map(g => `<div class="md-row"><span class="ellipsis">GPU ${esc(g.i)} · ${esc(g.name)}</span>${bar(g.util)}<span class="small nowrap">${g.util ?? '–'}% · ${fmtB(g.mu)} / ${fmtB(g.mt)}${g.temp != null ? ' · ' + g.temp + '°C' : ''}${g.pw != null ? ' · ' + g.pw.toFixed(0) + ' W' : ''}</span></div>`).join('')}</div>` : '<p class="muted">nvidia-smi isn\'t available, so per-GPU detail can\'t be read.</p>'; }
    };
    const sample = async () => {
      if (!m.isConnected) return;
      const cmd = LIVE_CMD[d.live];
      if (cmd && s.connected) { try { const r = await uc.call('exec', s.id, cmd, 10000); const now = Date.now(); const dt = prevT ? (now - prevT) / 1000 : 0; live = parseLive(d.live, r.out, prevRaw, dt); prevRaw = live.raw || null; prevT = now; } catch {} }
      drawLive(); m.querySelector('#mdLiveNote').textContent = cmd ? '· refreshes every 2 s' : '· from the latest stats';
      liveTimer = setTimeout(sample, document.hidden ? 10000 : 2000);
    };
    chartTimer = setInterval(() => { if (!m.isConnected) return clearInterval(chartTimer); if (range === 'live') { setSrc(); drawChart(); } }, 3000);
    new ResizeObserver(() => drawChart()).observe(C);
    loadRange(); sample();
  }

  const EXPANDABLE = ['cpu', 'mem', 'load', 'net', 'diskio', 'gpu', 'storage'];
  // called after every Overview redraw: adds an "expand" button to each card head and makes the graph clickable
  function bindOverview(v, s, u) {
    v.querySelectorAll('details.metric').forEach(dl => {
      const k = dl.dataset.k; if (!EXPANDABLE.includes(k)) return;
      const sum = dl.querySelector('summary'); if (sum && !sum.querySelector('.metric-exp')) {
        const b = el(`<button type="button" class="sm icon-btn metric-exp" title="Expand ${esc(DEF[k].title)} — full detail" aria-label="Expand ${esc(DEF[k].title)} to full detail">${UX.icon('expand')}</button>`);
        b.onclick = e => { e.preventDefault(); e.stopPropagation(); open(s, u, k); };
        sum.querySelector('.metric-chev') ? sum.querySelector('.metric-chev').before(b) : sum.append(b);
      }
      dl.querySelectorAll('.spark-wrap, .metric-hist .bar').forEach(g => { g.classList.add('md-click'); g.setAttribute('role', 'button'); g.setAttribute('tabindex', '0'); g.setAttribute('aria-label', `Open ${DEF[k].title} full detail`);
        g.onclick = () => open(s, u, k); g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(s, u, k); } }; });
    });
  }
  // Uiable's own alert history → notification centre (de-duplicated; older than a day arrives already read)
  async function pollAlerts(s) {
    if (!s || !s.connected || !hasUiable(s)) return;
    const u = S(s.id); if (u.uiAlertsAt && Date.now() - u.uiAlertsAt < 240000) return; u.uiAlertsAt = Date.now();
    let r; try { r = await uiableRead(s, { UCM: 'alerts' }); } catch { return; }
    for (const a of (r.alerts || []).filter(a => a && !a.test && a.title)) {
      const t = Date.parse(a.t) || Date.now(); if (Date.now() - t > 7 * 86400e3) continue;
      UX.notify({ kind: 'uiable', title: a.title, detail: a.body || '', srv: s.id, tab: 'uiable', t, read: Date.now() - t > 86400e3, key: `uiable:${s.id}:${a.t}:${a.key || a.title}` });
    }
  }
  setInterval(() => { for (const s of (typeof servers !== 'undefined' ? servers : [])) if (s.connected && isSsh(s)) pollAlerts(s); }, 300000);
  return { open, bindOverview, uiableRead, parseLive, pollAlerts, READER };
})();
