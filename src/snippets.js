'use strict';
// Scripts: saved commands, global or per server, kept on this device. Type them into the open terminal,
// run them once and show the output, or run them with sudo (saved sudo password or a one-off prompt).
async function snippetsDialog(s, u) {
  let all = await call('snippets:list');
  const m = el(`<div class="modal-bg"><div class="modal" style="width:640px"><header><h3 class="grow">Scripts</h3><button class="sm primary" id="sAdd">+ New</button></header><div class="body"><div class="slist"></div></div>
    <footer><span class="muted small">Global scripts show on every server.</span><span class="spacer"></span><button id="c">Close</button></footer></div></div>`);
  document.body.append(m); m.querySelector('#c').onclick = () => m.remove();
  const persist = async () => { await call('snippets:save', all); };
  const draw = () => { const list = all.filter(x => !x.serverId || x.serverId === s.id);
    m.querySelector('.slist').innerHTML = list.length ? list.map(x => `<div class="snip" data-id="${esc(x.id)}"><div class="grow" style="min-width:0"><b>${esc(x.name)}</b> <span class="muted small">${x.sudo ? 'sudo · ' : ''}${x.serverId ? 'this server' : 'global'}</span><div class="mono small muted ellipsis">${esc(x.cmd)}</div></div>
      <button class="sm primary" data-r="term" title="Type it into the open terminal and press Enter">▶ Terminal</button><button class="sm" data-r="exec" title="Run once and show the output" ${s.connType && s.connType !== 'ssh' ? 'disabled' : ''}>Run</button><button class="sm" data-r="edit">Edit</button></div>`).join('')
      : '<p class="muted">No scripts yet. Save commands you use often, like <span class="mono">docker compose pull &amp;&amp; docker compose up -d</span>.</p>';
    m.querySelectorAll('.snip button').forEach(b => b.onclick = () => { const x = all.find(y => y.id === b.closest('.snip').dataset.id); ({ term: () => runInTerm(x), exec: () => runExec(x), edit: () => edit(x) })[b.dataset.r](); }); };
  const runInTerm = x => { const t = u.terms.find(t => t.sid === u.activeTerm);
    if (!t || !anyPane(s.id, 'terminal')) return toast('Open a terminal tab first (or use Run)', true);
    uc.send('shell:write', s.id, t.sid, x.cmd.replace(/\r?\n/g, '\r') + '\r'); m.remove(); t.term.focus(); };
  const runExec = async x => { if (!s.connected) return toast('Not connected', true);
    const o = el(`<div class="modal-bg"><div class="modal" style="width:760px"><header><h3 class="grow">${esc(x.name)}</h3><span class="muted small" id="oc">Running…</span></header><div class="body"><pre class="mono small uilog"></pre></div><footer><span class="spacer"></span><button id="c">Close</button></footer></div></div>`);
    document.body.append(o); o.querySelector('#c').onclick = () => o.remove();
    const ch = x.sudo ? 'sudo:exec' : 'exec';
    try { let r; try { r = await uc.call(ch, s.id, x.cmd); }
      catch (e) { // sudo needs a password and none is saved: ask once (not stored, never logged)
        if (!x.sudo || !/password|sudo/i.test(e.message)) throw e;
        const pw = await prompt2(`sudo password for ${s.username || 'this user'}`, '', true); if (pw == null) throw new Error('Cancelled');
        r = await uc.call('sudo:exec', s.id, x.cmd, pw); }
      o.querySelector('pre').textContent = (r.out || '') + (r.err ? '\n' + r.err : '') || '(no output)'; o.querySelector('#oc').textContent = 'exit ' + r.code; }
    catch (e) { o.querySelector('pre').textContent = e.message; o.querySelector('#oc').textContent = 'failed'; } };
  const edit = x => { const n = !x; x = x || { id: 'sn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: '', cmd: '', serverId: s.id };
    const e = el(`<div class="modal-bg"><div class="modal" style="width:560px"><header><h3 class="grow">${n ? 'New script' : 'Edit script'}</h3></header><div class="body">
      <label class="field"><span>Name</span><input id="sn" value="${esc(x.name)}"></label><label class="field"><span>Command</span><textarea id="sc" rows="4" class="mono" spellcheck="false" autocapitalize="off">${esc(x.cmd)}</textarea></label>
      <label class="row" style="gap:8px"><input type="checkbox" id="sg" ${x.serverId ? '' : 'checked'}> Global (all servers)</label>
      <label class="row" style="gap:8px"><input type="checkbox" id="sd" ${x.sudo ? 'checked' : ''}> Run with sudo (uses the saved sudo password, or asks each time)</label></div>
      <footer>${n ? '' : '<button class="danger" id="sdel">Delete</button>'}<span class="spacer"></span><button id="c">Cancel</button><button class="primary" id="ss">Save</button></footer></div></div>`);
    document.body.append(e); e.querySelector('#c').onclick = () => e.remove();
    e.querySelector('#ss').onclick = async () => { const name = e.querySelector('#sn').value.trim(), cmd = e.querySelector('#sc').value.trim(); if (!name || !cmd) return toast('Name and command are required', true);
      Object.assign(x, { name, cmd, serverId: e.querySelector('#sg').checked ? null : (x.serverId || s.id), sudo: e.querySelector('#sd').checked }); if (n) all.push(x); await persist(); e.remove(); draw(); };
    if (!n) e.querySelector('#sdel').onclick = async () => { if (!confirm(`Delete script "${x.name}"?`)) return; all = all.filter(y => y !== x); await persist(); e.remove(); draw(); }; };
  m.querySelector('#sAdd').onclick = () => edit(null); draw();
}
