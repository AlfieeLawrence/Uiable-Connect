'use strict';
// Docker/web replacement for the Electron preload (window.uc): calls go to the container over HTTP, events over SSE.
(function () {
  const listeners = [], emit = d => listeners.forEach(fn => { try { fn(d); } catch (e) { console.error(e); } });
  const post = (url, o) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o), credentials: 'same-origin' });
  const es = new EventSource('api/events'); es.onmessage = e => emit(JSON.parse(e.data));
  // keystrokes etc. are queued and sent in order, batched while a request is in flight
  let q = [], busy = false; const flush = async () => { if (busy || !q.length) return; busy = true; const b = q; q = []; try { await post('api/send', b); } catch {} busy = false; flush(); };
  const L = {
    'key:pick': () => new Promise(res => { const i = document.createElement('input'); i.type = 'file';
      i.onchange = async () => { const f = i.files[0]; res(f ? { name: f.name, text: await f.text() } : null); }; i.click(); }),
    'fs:upload': async (id, files, dir, sudo) => { for (const f of files) { if (!(f instanceof File)) continue;
      const r = await fetch(`api/upload?id=${encodeURIComponent(id)}&path=${encodeURIComponent((dir.endsWith('/') ? dir : dir + '/') + f.name)}${sudo ? '&sudo=1' : ''}`, { method: 'POST', body: f, credentials: 'same-origin' });
      const j = await r.json(); if (!j.ok) throw new Error(j.error); } return true; },
    'fs:download': async (id, remotes) => { for (const p of remotes) { const a = document.createElement('a'); a.href = `api/download?id=${encodeURIComponent(id)}&path=${encodeURIComponent(p)}`; a.download = ''; document.body.append(a); a.click(); a.remove(); await new Promise(r => setTimeout(r, 400)); } return null; },
    'file:save': async (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); return name; },
    'notify:permission': async () => 'Notification' in window && (Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted'),
    'notify': async ({ title, body }) => { if (!('Notification' in window) || Notification.permission !== 'granted') return false; const n = new Notification(title, { body, icon: 'favicon.svg' }); n.onclick = () => { window.focus(); n.close(); }; return true; },
    'app:open': async url => { if (/^https:\/\/github\.com\//.test(url)) window.open(url, '_blank', 'noopener'); },
    'uiable:open': async (id, mode, port) => { const r = await remote('uiable:open', [id, mode, port]); const url = `${location.protocol}//${location.hostname}:${r.port}/`; window.open(url, '_blank', 'noopener'); return url; },
  };
  async function remote(ch, a) { const r = await post('api/call', { ch, a }); if (r.status === 401) { location.href = 'login'; throw new Error('Signed out'); }
    const j = await r.json(); if (!j.ok) throw new Error(j.error); return j.data; }
  window.UC_WEB = true;
  window.uc = { call: (ch, ...a) => L[ch] ? L[ch](...a) : remote(ch, a), send: (ch, ...a) => { q.push([ch, ...a]); flush(); }, on: fn => listeners.push(fn), pathFor: f => f };
})();
