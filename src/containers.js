'use strict';
// Containers tab (1.4.12): live list with CPU/memory sparklines, and per container live logs (follow + search),
// stats, environment (values masked until revealed), ports, mounts, start/stop (with undo), restart and redeploy.
// Runs docker over the existing exec channel: plain docker, then `sudo -n docker`, then the saved sudo password
// (fd-fed, never typed into a terminal). The mode that works is remembered per connection session.
const CT = (() => {
  const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const okRef = r => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(String(r || ''));
  const PERM = /permission denied|dial unix|cannot connect to the docker daemon|not in the.*docker.*group|connect: /i;
  const NODOCKER = /docker: (command )?not found|command not found|no such file or directory.*docker/i;
  async function run(s, args, { timeout = 25000 } = {}) {
    const u = S(s.id); const tries = u.dkMode ? [u.dkMode] : ['plain', 'sudoN', 'sudoPw'];
    let last = null;
    for (const m of tries) {
      if (m === 'sudoPw' && !(s.has_sudoPassword || s.has_password)) continue;
      let r;
      try { r = m === 'sudoPw' ? await uc.call('sudo:exec', s.id, 'docker ' + args) : await uc.call('exec', s.id, (m === 'sudoN' ? 'sudo -n docker ' : 'docker ') + args, timeout); }
      catch (e) { last = e; continue; }
      const err = String((r.err || '') + (r.code ? '\n' + (r.out || '') : ''));
      if (r.code === 127 || (r.code && NODOCKER.test(err))) { const e = new Error('Docker isn\'t installed on this server (or not on the PATH for SSH sessions)'); e.code = 'NODOCKER'; throw e; }
      if (r.code && (PERM.test(err) || /sudo:|password is required/i.test(err)) && !u.dkMode) { last = new Error(err.trim().split('\n').pop()); last.code = 'NOACCESS'; continue; }
      u.dkMode = m;
      if (r.code) { const e = new Error((err.trim().split('\n').filter(Boolean).pop()) || 'docker ' + args.split(' ')[0] + ' failed'); e.code = 'FAIL'; throw e; }
      return r.out || '';
    }
    if (last && last.code === 'NOACCESS') last.message = 'This user can\'t talk to Docker. Add it to the docker group, or save a sudo password on the connection.';
    throw last || new Error('docker failed');
  }
  const jsonLines = out => String(out).split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const pctN = v => { const n = parseFloat(String(v || '').replace('%', '')); return isNaN(n) ? null : n; };
  async function list(s) {
    const rows = jsonLines(await run(s, "ps -a --no-trunc --format '{{json .}}'"));
    const u = S(s.id);
    u.containers = rows.map(r => ({ id: String(r.ID || '').slice(0, 64), short: String(r.ID || '').slice(0, 12), name: String(r.Names || '').split(',')[0], image: r.Image || '', state: (r.State || '').toLowerCase() || (/^up/i.test(r.Status) ? 'running' : 'exited'), status: r.Status || '', ports: r.Ports || '', labels: r.Labels || '', created: r.CreatedAt || r.RunningFor || '' })).filter(c => okRef(c.id) && okRef(c.name))
      .sort((a, b) => (a.state !== 'running') - (b.state !== 'running') || a.name.localeCompare(b.name));
    u.ctAt = Date.now();
    return u.containers;
  }
  async function stats(s) {
    const rows = jsonLines(await run(s, "stats --no-stream --no-trunc --format '{{json .}}'", { timeout: 30000 }));
    const u = S(s.id); u.ctStats ||= {}; u.ctHist ||= {};
    for (const r of rows) { const id = String(r.ID || r.Container || '').slice(0, 64); const k = Object.keys(u.ctHist).find(x => x.startsWith(id) || id.startsWith(x)) || id;
      const x = { cpu: pctN(r.CPUPerc), mem: pctN(r.MemPerc), memUsage: r.MemUsage || '', net: r.NetIO || '', block: r.BlockIO || '', pids: r.PIDs || '' };
      u.ctStats[k] = x; (u.ctHist[k] ||= []).push({ t: Date.now(), cpu: x.cpu, mem: x.mem }); if (u.ctHist[k].length > 120) u.ctHist[k].shift(); }
    return u.ctStats;
  }
  const histFor = (u, id) => { const k = u.ctHist && Object.keys(u.ctHist).find(x => x.startsWith(id) || id.startsWith(x)); return k ? u.ctHist[k] : []; };
  const statFor = (u, id) => { const k = u.ctStats && Object.keys(u.ctStats).find(x => x.startsWith(id) || id.startsWith(x)); return k ? u.ctStats[k] : null; };
  const label = (labels, key) => { const m = String(labels || '').split(',').map(x => x.split('=')).find(([k]) => k === key); return m ? m.slice(1).join('=') : ''; };

  function view(s, u, v) {
    if (!s.connected) { v.innerHTML = notConn(s); return; }
    u.ctShowAll ??= true; u.ctQ ||= '';
    v.innerHTML = `<div class="ct-wrap"><div class="ct-bar"><div class="ct-search">${UX.icon('search')}<input id="ctQ" type="search" placeholder="Filter containers" aria-label="Filter containers" value="${esc(u.ctQ)}"></div>
      <label class="row small ct-all"><input type="checkbox" id="ctAll" ${u.ctShowAll ? 'checked' : ''}> Show stopped</label><span class="spacer"></span><span class="muted small" id="ctCount" aria-live="polite"></span>
      <button type="button" class="sm" id="ctRef" title="Refresh">⟳ Refresh</button><button type="button" class="sm danger" id="ctPrune" title="Remove all stopped containers">Prune…</button></div>
      <div class="ct-cols ${u.ctSel ? 'has-sel' : ''}" id="ctCols"><div class="ct-list" id="ctList" role="listbox" aria-label="Containers"><div class="ct-skel">${Array.from({ length: 5 }, () => '<div class="ct-row skel-row"><i class="skel w30"></i><i class="skel w50"></i></div>').join('')}</div></div>
      <section class="ct-detail" id="ctDet" aria-label="Container details"></section></div></div>`;
    const L = $('#ctList', v), D = $('#ctDet', v), cols = $('#ctCols', v);
    let alive = true; const here = () => alive && v.isConnected && anyPane(s.id, 'containers');
    const pending = new Map(); // id -> 'stopping' (undo window)
    const drawList = () => {
      const all = u.containers || []; const q = (u.ctQ || '').toLowerCase();
      const rows = all.filter(c => (u.ctShowAll || c.state === 'running') && (!q || (c.name + ' ' + c.image + ' ' + c.short).toLowerCase().includes(q)));
      $('#ctCount', v).textContent = `${all.filter(c => c.state === 'running').length} running · ${all.length} total`;
      if (!all.length) { L.innerHTML = ''; L.append(UX.empty({ ico: 'box', title: 'No containers here yet', text: 'Docker is running but this server has no containers. Start one from the terminal, or deploy a stack with Uiable.', actions: [
        { label: 'Open terminal', primary: true, ico: 'term', run: () => openSrvTab(s, 'terminal') }, { label: 'Refresh', run: () => load(true) }] })); D.innerHTML = ''; cols.classList.remove('has-sel'); return; }
      if (!rows.length) { L.innerHTML = ''; L.append(UX.empty({ compact: true, ico: 'search', title: 'Nothing matches', text: q ? `No container matches “${esc(q)}”.` : 'All containers are stopped.', actions: [q ? { label: 'Clear filter', run: () => { u.ctQ = ''; $('#ctQ', v).value = ''; drawList(); } } : { label: 'Show stopped', primary: true, run: () => { u.ctShowAll = true; $('#ctAll', v).checked = true; drawList(); } }] })); return; }
      L.innerHTML = rows.map(c => { const x = statFor(u, c.id), hh = histFor(u, c.id), st0 = pending.get(c.id) || c.state;
        return `<div class="ct-row ${u.ctSel === c.id ? 'sel' : ''}" role="option" tabindex="0" aria-selected="${u.ctSel === c.id}" data-id="${esc(c.id)}"><span class="ct-dot st-${esc(st0)}" title="${esc(st0)}" aria-hidden="true"></span>
          <span class="ct-main"><b class="ellipsis">${esc(c.name)}</b><span class="muted small ellipsis">${esc(c.image)}</span><span class="small ct-status st-${esc(st0)}">${pending.has(c.id) ? 'Stopping…' : esc(c.status)}</span></span>
          ${c.state === 'running' ? `<span class="ct-sp"><span class="sl"><b>CPU</b>${UX.mini(hh.map(p => p.cpu), 'cpu')}<em>${x && x.cpu != null ? x.cpu.toFixed(1) + '%' : '–'}</em></span><span class="sl"><b>MEM</b>${UX.mini(hh.map(p => p.mem), 'mem')}<em>${x && x.mem != null ? x.mem.toFixed(1) + '%' : '–'}</em></span></span>` : '<span class="ct-sp muted small">stopped</span>'}</div>`; }).join('');
      L.querySelectorAll('.ct-row').forEach(r => { r.onclick = () => select(r.dataset.id); r.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(r.dataset.id); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = e.key === 'ArrowDown' ? r.nextElementSibling : r.previousElementSibling; n && n.focus(); } }; });
    };
    const load = async (manual) => {
      try { await list(s); } catch (e) {
        L.innerHTML = ''; cols.classList.remove('has-sel'); D.innerHTML = '';
        const nod = e.code === 'NODOCKER';
        L.append(UX.empty({ ico: 'box', title: nod ? 'Docker isn\'t installed' : 'Can\'t reach Docker', text: esc(e.message), actions: nod ? [
          { label: 'Open terminal', primary: true, ico: 'term', run: () => openSrvTab(s, 'terminal') }, { label: 'How to install Docker', run: () => uc.call('app:open', 'https://docs.docker.com/engine/install/').catch(() => {}) }]
          : [{ label: 'Save a sudo password', primary: !s.has_sudoPassword, run: () => editServer(s) }, { label: 'Try again', run: () => { u.dkMode = null; load(true); } }] }));
        $('#ctCount', v).textContent = ''; return false; }
      if (u.ctSel && !(u.containers || []).some(c => c.id === u.ctSel || c.id.startsWith(u.ctSel) || c.name === u.ctSel)) u.ctSel = null;
      if (u.ctSel) { const c = u.containers.find(c => c.id === u.ctSel || c.id.startsWith(u.ctSel) || c.name === u.ctSel); u.ctSel = c.id; }
      drawList(); if (manual && u.ctSel) detail(); return true;
    };
    const tick = async () => { if (!here()) { alive = false; return; }
      if ((u.containers || []).some(c => c.state === 'running')) { try { await stats(s); } catch {} }
      if (!here()) return; if (Date.now() - (u.ctAt || 0) > 15000) await load().catch(() => {}); else drawList();
      if (u.ctSel && u.ctTab === 'stats') drawStats();
      u.ctTimer = setTimeout(tick, document.hidden ? 20000 : 5000); };
    clearTimeout(u.ctTimer);

    // ---------- detail pane
    const cur = () => (u.containers || []).find(c => c.id === u.ctSel);
    let info = null, logTimer = null, logLines = [], lastTs = '', envShown = new Set();
    const select = id => { u.ctSel = id; info = null; logLines = []; lastTs = ''; envShown = new Set(); clearTimeout(logTimer); cols.classList.add('has-sel'); drawList(); detail(); L.querySelector('.ct-row.sel')?.scrollIntoView({ block: 'nearest' }); };
    const detail = async () => {
      const c = cur(); if (!c) { D.innerHTML = ''; return; }
      const compose = label(c.labels, 'com.docker.compose.project');
      u.ctTab ||= 'logs';
      const stopping = pending.has(c.id);
      D.innerHTML = `<header class="ct-dh"><button type="button" class="sm ct-back" id="ctBack" aria-label="Back to the container list">← Back</button><span class="ct-dot st-${esc(c.state)}" aria-hidden="true"></span><div class="grow" style="min-width:0"><h3 class="ellipsis">${esc(c.name)}</h3><div class="muted small ellipsis">${esc(c.image)} · ${esc(c.short)}${compose ? ' · compose: ' + esc(compose) : ''}</div></div></header>
        <div class="ct-acts">${c.state === 'running' && !stopping ? `<button type="button" class="sm" id="ctStop">■ Stop</button>` : `<button type="button" class="sm primary" id="ctStart" ${stopping ? 'disabled' : ''}>▶ Start</button>`}
          <button type="button" class="sm" id="ctRestart" ${c.state !== 'running' || stopping ? 'disabled' : ''}>⟳ Restart</button>
          <button type="button" class="sm" id="ctRedeploy" ${compose ? '' : 'disabled'} title="${compose ? 'Pull the image and recreate this service with docker compose' : 'Redeploy needs a docker compose service (this container was started without compose)'}">⇪ Redeploy</button>
          <button type="button" class="sm" id="ctShell" ${c.state !== 'running' ? 'disabled' : ''}>${UX.icon('term')}Shell</button></div>
        <div class="seg ct-tabs" role="tablist" aria-label="Container details">${[['logs', 'Logs'], ['stats', 'Stats'], ['env', 'Env'], ['ports', 'Ports'], ['mounts', 'Mounts']].map(([k, l]) => `<button type="button" role="tab" id="ctt-${k}" aria-selected="${u.ctTab === k}" aria-controls="ctPanel" class="${u.ctTab === k ? 'active' : ''}" data-ct="${k}">${l}</button>`).join('')}</div>
        <div id="ctPanel" class="ct-panel" role="tabpanel" aria-labelledby="ctt-${u.ctTab}"></div>`;
      $('#ctBack', D).onclick = () => { u.ctSel = null; clearTimeout(logTimer); cols.classList.remove('has-sel'); drawList(); L.querySelector('.ct-row')?.focus(); };
      D.querySelectorAll('[data-ct]').forEach(b => b.onclick = () => { u.ctTab = b.dataset.ct; clearTimeout(logTimer); detail(); });
      D.querySelector('.ct-tabs').onkeydown = e => { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; const bs = [...D.querySelectorAll('[data-ct]')]; const i = bs.findIndex(b => b.dataset.ct === u.ctTab); const n = bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length]; u.ctTab = n.dataset.ct; clearTimeout(logTimer); detail().then(() => D.querySelector(`[data-ct="${u.ctTab}"]`)?.focus()); };
      const rid = c.id;
      const act = async (verb, msg) => { try { await run(s, `${verb} ${rid}`, { timeout: 60000 }); UX.notify({ kind: 'action', title: msg, srv: s.id, tab: 'containers', sel: c.id }); toast(msg); } catch (e) { toast(`Couldn't ${verb} ${c.name}: ${e.message}`, true); } u.ctAt = 0; await load(); detail(); };
      const sb = $('#ctStop', D); if (sb) sb.onclick = () => UX.undoable({ msg: `Stopping ${c.name}…`, kind: 'action', srv: s.id, tab: 'containers', ms: 5000,
        apply: () => { pending.set(c.id, 'stopping'); drawList(); detail(); },
        commit: async () => { try { await run(s, 'stop ' + rid, { timeout: 60000 }); } finally { pending.delete(c.id); u.ctAt = 0; if (here()) { await load(); detail(); } } },
        revert: () => { pending.delete(c.id); if (here()) { drawList(); detail(); } toast(`${c.name} keeps running`); } });
      const stb = $('#ctStart', D); if (stb) stb.onclick = () => { stb.disabled = true; stb.textContent = 'Starting…'; act('start', `Started ${c.name}`); };
      $('#ctRestart', D).onclick = e => { e.target.disabled = true; e.target.textContent = 'Restarting…'; act('restart', `Restarted ${c.name}`); };
      $('#ctShell', D).onclick = () => { u.pendingNewT = { cmd: `docker exec -it ${c.name} bash 2>/dev/null || docker exec -it ${c.name} sh`, label: '◫ ' + c.name }; openSrvTab(s, 'terminal'); };
      $('#ctRedeploy', D).onclick = async () => {
        if (!await UX.confirm({ title: `Redeploy ${c.name}?`, body: `<p>Pulls the latest image for the <b>${esc(label(c.labels, 'com.docker.compose.service'))}</b> service and recreates the container with <span class="mono">docker compose up -d --force-recreate</span>. It is briefly unavailable while it restarts. Volumes and data are kept.</p>`, ok: 'Redeploy' })) return;
        const wd = label(c.labels, 'com.docker.compose.project.working_dir'), files = label(c.labels, 'com.docker.compose.project.config_files'), svc = label(c.labels, 'com.docker.compose.service');
        const fl = files ? files.split(',').filter(Boolean).map(f => '-f ' + shq(f)).join(' ') : '';
        const base = `compose -p ${shq(compose)} ${fl}`;
        const o = el(`<div class="modal-bg"><div class="modal" style="width:min(720px,100%)"><header><h3 class="grow">Redeploying ${esc(c.name)}</h3><span class="muted small" id="rdS" aria-live="polite">Pulling…</span></header><div class="body"><pre class="mono small uilog" id="rdO">${UX.skel.lines(3)}</pre></div><footer><span class="spacer"></span><button type="button" id="c">Close</button></footer></div></div>`);
        document.body.append(o); o.querySelector('#c').onclick = () => o.remove();
        try { const cd = wd ? `--project-directory ${shq(wd)} ` : '';
          const a = await run(s, `${base} ${cd}pull ${shq(svc)} 2>&1`, { timeout: 180000 }); o.querySelector('#rdS').textContent = 'Recreating…';
          const b = await run(s, `${base} ${cd}up -d --force-recreate ${shq(svc)} 2>&1`, { timeout: 180000 });
          o.querySelector('#rdO').textContent = (a + '\n' + b).trim() || 'Done'; o.querySelector('#rdS').textContent = 'Done';
          UX.notify({ kind: 'action', title: `Redeployed ${c.name}`, srv: s.id, tab: 'containers', sel: c.id }); }
        catch (e) { o.querySelector('#rdO').textContent = e.message; o.querySelector('#rdS').textContent = 'Failed'; toast(`Redeploy failed: ${e.message}`, true); }
        u.ctAt = 0; await load(); };
      const P = $('#ctPanel', D);
      if (u.ctTab === 'logs') return drawLogs(P, c);
      if (u.ctTab === 'stats') return drawStats();
      P.innerHTML = UX.skel.lines(4);
      if (!info || info.Id && !info.Id.startsWith(c.id.slice(0, 12))) { try { info = JSON.parse(await run(s, 'inspect ' + rid))[0]; } catch (e) { P.innerHTML = `<p class="pill err">${esc(e.message)}</p>`; return; } }
      if (u.ctTab === 'env') drawEnv(P); else if (u.ctTab === 'ports') drawPorts(P, c); else drawMounts(P);
    };
    // logs: tail + follow (polls `docker logs --since <last timestamp>` every 2 s), search with highlights
    const drawLogs = async (P, c) => {
      u.ctLog ||= { follow: true, tail: 500, ts: false, q: '' };
      const o = u.ctLog;
      P.innerHTML = `<div class="log-bar"><label class="row small"><input type="checkbox" id="lgF" ${o.follow ? 'checked' : ''}> Follow</label><label class="row small"><input type="checkbox" id="lgT" ${o.ts ? 'checked' : ''}> Timestamps</label>
        <select id="lgN" aria-label="Lines to load" class="sm-sel">${[100, 500, 2000].map(n => `<option ${n === o.tail ? 'selected' : ''} value="${n}">Last ${n}</option>`).join('')}</select>
        <div class="ct-search grow">${UX.icon('search')}<input id="lgQ" type="search" placeholder="Search logs" aria-label="Search logs" value="${esc(o.q)}"></div><span class="muted small" id="lgC" aria-live="polite"></span><button type="button" class="sm" id="lgP" aria-label="Previous match">↑</button><button type="button" class="sm" id="lgNx" aria-label="Next match">↓</button></div>
        <pre class="mono small ct-log" id="lgO" tabindex="0" aria-label="Container logs">${UX.skel.lines(6)}</pre>`;
      const O = $('#lgO', P); let hit = -1;
      const paint = () => {
        const q = o.q.toLowerCase(); let n = 0;
        const lines = logLines.map(([ts, t]) => { const pre = o.ts ? `<span class="lg-ts">${esc(ts.slice(0, 19).replace('T', ' '))}</span> ` : '';
          if (!q) return pre + esc(t); const lo = t.toLowerCase(); let out = '', i = 0, j;
          while ((j = lo.indexOf(q, i)) >= 0) { out += esc(t.slice(i, j)) + `<mark data-m="${n++}">${esc(t.slice(j, j + q.length))}</mark>`; i = j + q.length; }
          return pre + out + esc(t.slice(i)); });
        const atEnd = O.scrollHeight - O.scrollTop - O.clientHeight < 40;
        O.innerHTML = lines.join('\n') || '<span class="muted">No log output yet.</span>';
        $('#lgC', P).textContent = q ? `${n} match${n === 1 ? '' : 'es'}` : `${logLines.length} lines`;
        if (q && n) { hit = Math.min(Math.max(hit, 0), n - 1); const m = O.querySelector(`mark[data-m="${hit}"]`); if (m) { m.classList.add('cur'); m.scrollIntoView({ block: 'center' }); } }
        else if (o.follow && atEnd !== false) O.scrollTop = O.scrollHeight;
      };
      const parse = out => String(out).split('\n').filter(Boolean).map(l => { const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z)\s?(.*)$/.exec(l); return m ? [m[1], m[2]] : ['', l]; });
      const fetchLogs = async first => {
        if (!here() || u.ctSel !== c.id || u.ctTab !== 'logs') return;
        try { const out = await run(s, first || !lastTs ? `logs --timestamps --tail ${o.tail} ${ref(c)} 2>&1` : `logs --timestamps --since ${lastTs} ${ref(c)} 2>&1`);
          let add = parse(out); if (!first && lastTs) add = add.filter(([ts]) => ts > lastTs);
          if (add.length) { logLines = first ? add : logLines.concat(add); if (logLines.length > 5000) logLines = logLines.slice(-5000); const lt = add.filter(x => x[0]).pop(); if (lt) lastTs = lt[0]; paint(); }
          else if (first) paint();
        } catch (e) { O.textContent = e.message; }
        clearTimeout(logTimer); if (o.follow) logTimer = setTimeout(() => fetchLogs(false), document.hidden ? 10000 : 2000);
      };
      $('#lgF', P).onchange = e => { o.follow = e.target.checked; clearTimeout(logTimer); if (o.follow) fetchLogs(false); };
      $('#lgT', P).onchange = e => { o.ts = e.target.checked; paint(); };
      $('#lgN', P).onchange = e => { o.tail = +e.target.value; lastTs = ''; logLines = []; fetchLogs(true); };
      $('#lgQ', P).oninput = e => { o.q = e.target.value; hit = 0; paint(); };
      $('#lgQ', P).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); hit += e.shiftKey ? -1 : 1; if (hit < 0) hit = 0; paint(); } };
      $('#lgNx', P).onclick = () => { hit++; paint(); }; $('#lgP', P).onclick = () => { hit = Math.max(0, hit - 1); paint(); };
      if (logLines.length) paint(); fetchLogs(!logLines.length);
    };
    const ref = c => c.id;
    const drawStats = () => {
      const P = $('#ctPanel', D); const c = cur(); if (!P || !c || u.ctTab !== 'stats') return;
      const x = statFor(u, c.id), hh = histFor(u, c.id);
      if (c.state !== 'running') { P.innerHTML = ''; P.append(UX.empty({ compact: true, ico: 'box', title: 'Not running', text: 'Start the container to see live stats.' })); return; }
      if (!x) { P.innerHTML = UX.skel.cards(2); return; }
      const hs = histStats(hh.map(p => p.cpu)), hm = histStats(hh.map(p => p.mem));
      P.innerHTML = `<div class="ct-stats"><div class="card"><div class="card-title">CPU</div><div class="stat-big">${x.cpu != null ? x.cpu.toFixed(1) + '%' : '–'}</div><div class="spark-wrap">${sparkline(hh.map(p => p.cpu), 220, 44, 'var(--accent)')}</div><div class="row small metric-hist-stats"><span><b class="muted">Avg</b> ${hs.avg == null ? '–' : hs.avg.toFixed(1) + '%'}</span><span><b class="muted">Max</b> ${hs.max == null ? '–' : hs.max.toFixed(1) + '%'}</span></div></div>
        <div class="card"><div class="card-title">Memory</div><div class="stat-big">${x.mem != null ? x.mem.toFixed(1) + '%' : '–'}</div><div class="spark-wrap">${sparkline(hh.map(p => p.mem), 220, 44, 'var(--ok)')}</div><div class="row small metric-hist-stats"><span>${esc(x.memUsage)}</span><span><b class="muted">Max</b> ${hm.max == null ? '–' : hm.max.toFixed(1) + '%'}</span></div></div>
        <div class="card"><div class="card-title">Network I/O</div><div class="stat-md">${esc(x.net || '–')}</div><p class="muted small">received / sent since start</p></div>
        <div class="card"><div class="card-title">Block I/O</div><div class="stat-md">${esc(x.block || '–')}</div><p class="muted small">read / written · ${esc(x.pids || '–')} processes</p></div></div>
        <p class="muted small">Sampled every 5 s while this tab is open · ${hh.length} sample${hh.length === 1 ? '' : 's'}</p>`;
    };
    const drawEnv = P => {
      const env = ((info && info.Config && info.Config.Env) || []).map(l => { const i = l.indexOf('='); return i < 0 ? [l, ''] : [l.slice(0, i), l.slice(i + 1)]; });
      if (!env.length) { P.innerHTML = ''; P.append(UX.empty({ compact: true, ico: 'box', title: 'No environment variables' })); return; }
      const draw = () => { P.innerHTML = `<div class="row small env-bar"><span class="muted grow">Values are hidden until you reveal them. Nothing is stored.</span><button type="button" class="sm" id="envAll">${envShown.size === env.length ? 'Hide all' : 'Reveal all'}</button></div>
        <table class="list env-t"><thead><tr><th scope="col">Name</th><th scope="col">Value</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${env.map(([k, val], i) => `<tr><td class="mono small">${esc(k)}</td><td class="mono small env-v">${envShown.has(i) ? esc(val) || '<span class="muted">(empty)</span>' : '<span class="masked" aria-label="hidden value">••••••••</span>'}</td>
          <td class="nowrap right"><button type="button" class="sm icon-btn" data-rv="${i}" aria-label="${envShown.has(i) ? 'Hide' : 'Reveal'} ${esc(k)}" title="${envShown.has(i) ? 'Hide' : 'Reveal'}">${UX.icon('eye')}</button><button type="button" class="sm icon-btn" data-cp="${i}" aria-label="Copy value of ${esc(k)}" title="Copy value">${UX.icon('copy')}</button></td></tr>`).join('')}</tbody></table>`;
        $('#envAll', P).onclick = () => { if (envShown.size === env.length) envShown.clear(); else env.forEach((_, i) => envShown.add(i)); draw(); };
        P.querySelectorAll('[data-rv]').forEach(b => b.onclick = () => { const i = +b.dataset.rv; envShown.has(i) ? envShown.delete(i) : envShown.add(i); draw(); P.querySelector(`[data-rv="${i}"]`)?.focus(); });
        P.querySelectorAll('[data-cp]').forEach(b => b.onclick = () => clip.write(env[+b.dataset.cp][1]).then(() => toast('Copied ' + env[+b.dataset.cp][0])).catch(() => toast('Clipboard not available', true))); };
      draw();
    };
    const drawPorts = (P, c) => {
      const ports = (info && info.NetworkSettings && info.NetworkSettings.Ports) || {}; const rows = [];
      for (const [cp, binds] of Object.entries(ports)) { if (!binds || !binds.length) rows.push([cp, '', '']); else for (const b of binds) rows.push([cp, b.HostIp || '0.0.0.0', b.HostPort]); }
      if (!rows.length) { P.innerHTML = ''; P.append(UX.empty({ compact: true, ico: 'xfer', title: 'No ports exposed', text: (info && info.HostConfig && info.HostConfig.NetworkMode === 'host') ? 'This container uses the host network, so its ports are the server\'s ports.' : 'This container doesn\'t publish any ports.' })); return; }
      P.innerHTML = `<table class="list"><thead><tr><th scope="col">Container</th><th scope="col">Host</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map(([cp, hi, hp], i) => `<tr><td class="mono small">${esc(cp)}</td><td class="mono small">${hp ? esc(hi + ':' + hp) : '<span class="muted">not published</span>'}</td><td class="right">${hp && /tcp/.test(cp) ? `<button type="button" class="sm" data-fw="${i}">Forward to this PC</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
      P.querySelectorAll('[data-fw]').forEach(b => b.onclick = async () => { const [, , hp] = rows[+b.dataset.fw]; const fw = (s.forwards || []).slice();
        if (fw.some(f => f.dir !== 'remote' && +f.remotePort === +hp)) { toast('There is already a forward for port ' + hp); openSrvTab(s, 'forwards'); return; }
        let lp = (APP.fwdPorts || []).find(p => !fw.some(f => +f.localPort === p)) || +hp; while (fw.some(f => +f.localPort === lp)) lp++;
        fw.push({ id: 'f' + Date.now(), name: c.name + ' ' + hp, remoteHost: '127.0.0.1', remotePort: +hp, localPort: lp, auto: false });
        await call('servers:forwards', s.id, fw); UX.notify({ kind: 'action', title: `Added a forward for ${c.name} (port ${hp})`, srv: s.id, tab: 'forwards' }); toast(`Forward added — start it in Ports (PC port ${lp})`); await refresh(); });
    };
    const drawMounts = P => {
      const ms = (info && info.Mounts) || [];
      if (!ms.length) { P.innerHTML = ''; P.append(UX.empty({ compact: true, ico: 'files', title: 'No mounts', text: 'This container has no volumes or bind mounts.' })); return; }
      P.innerHTML = `<table class="list"><thead><tr><th scope="col">Type</th><th scope="col">Source</th><th scope="col">Destination</th><th scope="col">Mode</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${ms.map((m, i) => `<tr><td><span class="pill">${esc(m.Type)}</span></td><td class="mono small" style="overflow-wrap:anywhere">${esc(m.Name || m.Source)}</td><td class="mono small" style="overflow-wrap:anywhere">${esc(m.Destination)}</td><td class="small">${m.RW ? 'read-write' : 'read-only'}</td><td class="right">${m.Source ? `<button type="button" class="sm" data-of="${i}">Open in Files</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
      P.querySelectorAll('[data-of]').forEach(b => b.onclick = () => { const m = ms[+b.dataset.of]; u.f1 ||= {}; u.f1.cwd = m.Source; openSrvTab(s, 'files'); });
    };

    $('#ctQ', v).oninput = e => { u.ctQ = e.target.value; drawList(); };
    $('#ctAll', v).onchange = e => { u.ctShowAll = e.target.checked; drawList(); };
    $('#ctRef', v).onclick = async e => { e.target.disabled = true; await load(true); e.target.disabled = false; };
    $('#ctPrune', v).onclick = async () => {
      const stopped = (u.containers || []).filter(c => c.state !== 'running');
      if (!stopped.length) return toast('No stopped containers to prune');
      if (!await UX.confirm({ title: 'Prune stopped containers?', danger: true, ok: `Delete ${stopped.length} container${stopped.length === 1 ? '' : 's'}`, typed: 'prune',
        body: `<p>Permanently removes <b>${stopped.length}</b> stopped container${stopped.length === 1 ? '' : 's'} (<span class="mono">docker container prune</span>):</p><ul class="mono small">${stopped.slice(0, 8).map(c => `<li>${esc(c.name)}</li>`).join('')}${stopped.length > 8 ? `<li class="muted">…and ${stopped.length - 8} more</li>` : ''}</ul><p class="small">Images and volumes are kept.</p>` })) return;
      try { const out = await run(s, 'container prune -f', { timeout: 120000 }); const m = /Total reclaimed space:\s*(.+)/.exec(out); toast(`Pruned ${stopped.length} container${stopped.length === 1 ? '' : 's'}${m ? ' · ' + m[1] : ''}`); UX.notify({ kind: 'action', title: `Pruned ${stopped.length} stopped container${stopped.length === 1 ? '' : 's'}`, detail: m ? 'Reclaimed ' + m[1] : '', srv: s.id, tab: 'containers' }); }
      catch (e) { toast('Prune failed: ' + e.message, true); }
      u.ctAt = 0; load(true);
    };
    (async () => { if (u.containers) drawList(); const ok = await load(); if (ok) { if (u.ctSel) detail(); tick(); } })();
  }
  return { view, run, list, stats };
})();
