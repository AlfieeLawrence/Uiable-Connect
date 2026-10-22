'use strict';
// Small SFTP text editor: line numbers, monospace, Ctrl/Cmd+S, unsaved-changes guard. Plain text on purpose (stays light).
// Size limit (2 MB) and binary refusal are enforced by fs:read on every platform.
async function editFile(id, p) {
  let txt; try { txt = await uc.call('fs:read', id, p); } catch (e) { return toast(e.message, true); }
  const crlf = /\r\n/.test(txt); txt = txt.replace(/\r\n/g, '\n'); // textarea normalises line endings; restore them on save
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const name = p.split('/').pop();
  const m = el(`<div class="modal-bg ed-bg"><div class="modal full editor-modal"><header><h3 class="grow mono ellipsis" title="${esc(p)}"><span class="ed-dirty"></span>${esc(name)}</h3><span class="muted small mono ellipsis ed-path">${esc(p)}</span></header>
    <div class="body ed-body"><div class="ed"><pre class="ed-gut" aria-hidden="true"></pre><textarea class="ed-ta" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off"></textarea></div></div>
    <footer><span class="muted small mono ed-st"></span><span class="grow"></span><button id="c">Close</button><button class="primary" id="sv">Save <span class="muted small">${mac ? '⌘S' : 'Ctrl+S'}</span></button></footer></div></div>`);
  document.body.append(m);
  const ta = m.querySelector('textarea'), gut = m.querySelector('.ed-gut'), st = m.querySelector('.ed-st'), dirty = m.querySelector('.ed-dirty');
  ta.value = txt; let lines = 0, raf = 0, saving = false;
  const update = () => { raf = 0; const v = ta.value; let n = 1; for (let i = v.indexOf('\n'); i >= 0; i = v.indexOf('\n', i + 1)) n++;
    if (n !== lines) { lines = n; let g = ''; for (let i = 1; i <= n; i++) g += i + '\n'; gut.textContent = g; }
    const pre = v.slice(0, ta.selectionStart), ln = pre.split('\n').length, col = ta.selectionStart - pre.lastIndexOf('\n');
    st.textContent = `Ln ${ln}, Col ${col} · ${lines} lines${crlf ? ' · CRLF' : ''}`; const d = v !== txt; dirty.textContent = d ? '● ' : ''; m.classList.toggle('dirty', d);
    gut.scrollTop = ta.scrollTop; };
  const later = () => { if (!raf) raf = requestAnimationFrame(update); };
  ta.addEventListener('input', later); ta.addEventListener('keyup', later); ta.addEventListener('click', later); ta.addEventListener('scroll', () => { gut.scrollTop = ta.scrollTop; });
  const save = async () => { if (saving) return; saving = true; const v = ta.value;
    try { await call('fs:write', id, p, crlf ? v.replace(/\n/g, '\r\n') : v); txt = v; toast('Saved ' + name); update(); } catch {} saving = false; };
  const close = () => { if (ta.value !== txt && !confirm('You have unsaved changes. Close without saving?')) return; m.remove(); };
  m.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab' && e.target === ta && !e.ctrlKey && !e.metaKey) { e.preventDefault(); ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end'); later(); }
  });
  m.querySelector('#sv').onclick = save; m.querySelector('#c').onclick = close;
  ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0; update();
}
