'use strict';
// Read-only server health / security checks. One shell script over SSH (exec), parsed here.
// Nothing in HEALTH_SCRIPT changes the server: it only reads files and runs list/status commands.
// sudo is only ever used as `sudo -n` (never prompts) and only for read commands.
const HEALTH_SCRIPT = String.raw`
export LC_ALL=C PATH="$PATH:/usr/sbin:/sbin:/usr/local/sbin"
S() { echo "@@$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""; ROOT=""; [ "$(id -u)" = 0 ] && ROOT=1
if [ -z "$ROOT" ] && have sudo && sudo -n true 2>/dev/null; then SUDO="sudo -n"; fi
T=""; have timeout && T="timeout 20"
S meta; echo "root=$ROOT sudo=$SUDO"
S ports
if have ss; then $SUDO ss -tulnp 2>/dev/null | tail -n +2 || ss -tuln | tail -n +2; echo TOOL=ss
elif have netstat; then $SUDO netstat -tulnp 2>/dev/null | tail -n +3 || netstat -tuln | tail -n +3; echo TOOL=netstat
else echo TOOL=none; fi
S fw
if have ufw; then o=$($SUDO ufw status 2>&1 | head -1); echo "ufw|$o"; fi
if have firewall-cmd; then echo "firewalld|$(firewall-cmd --state 2>&1 | head -1)"; fi
if have nft; then if o=$($SUDO nft list ruleset 2>/dev/null); then echo "nft|$(printf '%s\n' "$o" | grep -cE '^\s+(ip|tcp|udp|ct|iif|meta|counter|accept|drop|reject)')"; else echo "nft|denied"; fi; fi
if have iptables; then if o=$($SUDO iptables -S 2>/dev/null); then echo "iptables|$(printf '%s\n' "$o" | grep -c '^-A') $(printf '%s\n' "$o" | grep '^-P INPUT' | cut -d' ' -f3)"; else echo "iptables|denied"; fi; fi
S upd
if have apt; then echo PM=apt; apt list --upgradable 2>/dev/null | grep '/'; echo "STAMP=$(stat -c %Y /var/lib/apt/periodic/update-success-stamp /var/lib/apt/lists/partial /var/cache/apt/pkgcache.bin 2>/dev/null | sort -n | tail -1)"
elif have dnf || have yum; then P=dnf; have dnf || P=yum; echo PM=$P; $P -C -q check-update 2>/dev/null | grep -E '^[^ ]+\.[^ ]+ +[^ ]+ +[^ ]+' | sed 's/^/P /'; $P -C -q updateinfo list --security 2>/dev/null | sed 's/^/S /'
elif have apk; then echo PM=apk; apk -u list 2>/dev/null
elif have pacman; then echo PM=pacman; pacman -Qu 2>/dev/null
else echo PM=none; fi
S reboot
[ -f /var/run/reboot-required ] && { echo YES; head -20 /var/run/reboot-required.pkgs 2>/dev/null; }
have needs-restarting && { needs-restarting -r >/dev/null 2>&1; echo "NR=$?"; }
[ -d /var/lib/dpkg ] && echo DEB
S docker
D=""
if have docker; then if docker ps >/dev/null 2>&1; then D=docker; elif [ -n "$SUDO" ] && $SUDO docker ps >/dev/null 2>&1; then D="$SUDO docker"; else echo NOACCESS; fi; else echo NODOCKER; fi
if [ -n "$D" ]; then BX=""; $D buildx version >/dev/null 2>&1 && BX=1
  $D ps --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Ports}}' | head -40 | while IFS='|' read -r id name img ports; do
    iid=$($D inspect --format '{{.Image}}' "$id" 2>/dev/null); rd=$($D image inspect --format '{{join .RepoDigests " "}}' "$iid" 2>/dev/null)
    rem=""; case "$img" in sha256:*|*@sha256:*) ;; *)
      [ -n "$BX" ] && rem=$($T $D buildx imagetools inspect "$img" 2>/dev/null | awk '/^Digest:/{print $2; exit}')
      if [ -z "$rem" ]; then m=$($T $D manifest inspect -v "$img" 2>/dev/null); case "$m" in \{*) rem=$(printf %s "$m" | grep -o '"digest": *"sha256:[0-9a-f]*"' | head -1 | grep -o 'sha256:[0-9a-f]*');; esac; fi;; esac
    echo "C|$name|$img|$ports|$rd|$rem"
  done; fi
S ssh
if [ -n "$ROOT$SUDO" ] && o=$($SUDO sshd -T 2>/dev/null) && [ -n "$o" ]; then printf '%s\n' "$o" | grep -Ei '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication) '; echo SRC=sshd
elif [ -r /etc/ssh/sshd_config ]; then cat /etc/ssh/sshd_config.d/*.conf /etc/ssh/sshd_config 2>/dev/null | grep -Ei '^\s*(PermitRootLogin|PasswordAuthentication|KbdInteractiveAuthentication)\s'; echo SRC=file
else echo SRC=none; fi
S df; df -P -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | tail -n +2 || df -P | tail -n +2
S dfi; df -Pi -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | tail -n +2 || df -Pi 2>/dev/null | tail -n +2
S units; if have systemctl && [ -d /run/systemd/system ]; then systemctl --failed --no-legend --plain 2>/dev/null | head -30; echo RC=ok; else echo NOSYSTEMD; fi
S end
`;
// Only run on an explicit tap. Refreshes the package index (needs passwordless sudo); never installs anything.
const HEALTH_REFRESH = String.raw`export LC_ALL=C; S=""; [ "$(id -u)" = 0 ] || S="sudo -n"
if command -v apt-get >/dev/null; then C="apt-get update -qq"
elif command -v dnf >/dev/null; then C="dnf -q makecache"
elif command -v yum >/dev/null; then C="yum -q makecache"
elif command -v apk >/dev/null; then C="apk update -q"
else echo "Refreshing isn't supported for this package manager"; exit 3; fi
o=$($S $C 2>&1); rc=$?; echo "$o" | tail -3; exit $rc`;

function parseHealth(out) {
  const sec = {}; let k = null;
  for (const l of out.split('\n')) { const m = l.match(/^@@(\w+)$/); if (m) { k = m[1]; sec[k] = []; } else if (k) sec[k].push(l); }
  const L = n => (sec[n] || []).filter(x => x.trim() !== '');
  const meta = (L('meta')[0] || ''); const priv = /root=1/.test(meta) || /sudo=sudo/.test(meta);
  const R = []; const add = (id, title, status, summary, details = []) => R.push({ id, title, status, summary, details });
  const needSudo = priv ? '' : ' (some details need root or passwordless sudo)';
  // ---- firewall first (ports status depends on it)
  let fwActive = null; { const rows = L('fw').map(l => l.split('|')); const d = [];
    let denied = 0;
    for (const [t, v] of rows) {
      if (t === 'ufw') { d.push('ufw: ' + v); if (/Status: active/i.test(v)) fwActive = 'ufw'; else if (/inactive/i.test(v)) fwActive ??= false; else denied++; }
      if (t === 'firewalld') { d.push('firewalld: ' + v); if (/^running/.test(v)) fwActive = 'firewalld'; else fwActive ??= false; }
      if (t === 'nft') { if (v === 'denied') { denied++; d.push('nftables: needs sudo to read'); } else { d.push(`nftables: ${v} rule lines`); if (+v > 0) fwActive ||= 'nftables'; else fwActive ??= false; } }
      if (t === 'iptables') { if (v === 'denied') { denied++; d.push('iptables: needs sudo to read'); } else { const [n, pol] = v.split(' '); d.push(`iptables: ${n} rules, INPUT policy ${pol || '?'}`); if (+n > 0 || pol === 'DROP') fwActive ||= 'iptables'; else fwActive ??= false; } }
    }
    if (!rows.length) add('fw', 'Firewall', 'warn', 'No firewall tool found (ufw, firewalld, nftables, iptables)', d);
    else if (fwActive) add('fw', 'Firewall', 'ok', `Active (${fwActive})`, d);
    else if (fwActive === false) add('fw', 'Firewall', 'warn', 'No active firewall rules found' + (denied ? needSudo : ''), d);
    else add('fw', 'Firewall', 'unknown', 'Couldn\'t read the firewall status' + needSudo, d);
  }
  // ---- listening ports
  { const lines = L('ports'); const tool = (lines.find(l => l.startsWith('TOOL=')) || 'TOOL=none').slice(5); const exp = [];
    for (const l of lines) { if (l.startsWith('TOOL=')) continue; const p = l.trim().split(/\s+/);
      let proto, local, proc = '';
      if (tool === 'ss') { proto = p[0]; local = p[4]; proc = (l.match(/users:\(\("([^"]+)"/) || [])[1] || ''; }
      else { proto = p[0]; local = p[3]; proc = (p[p.length - 1] || '').includes('/') ? p[p.length - 1].split('/')[1] : ''; }
      if (!local) continue; const i = local.lastIndexOf(':'); const addr = local.slice(0, i).replace(/^\[|\]$/g, '').replace(/%.*/, ''), port = local.slice(i + 1);
      if (/^(127\.|::1$|::ffff:127\.)/.test(addr) || addr === 'localhost') continue;
      exp.push({ proto: proto.replace(/\d$/, ''), addr: addr === '*' || addr === '' ? '0.0.0.0' : addr, port, proc }); }
    const uniq = [...new Map(exp.map(e => [e.proto + e.addr + e.port, e])).values()].sort((a, b) => a.port - b.port);
    const det = uniq.map(e => `${e.proto} ${e.addr.includes(":") ? "[" + e.addr + "]" : e.addr}:${e.port}${e.proc ? ' · ' + e.proc : ''}`);
    if (tool === 'none') add('ports', 'Listening ports', 'unknown', 'Neither ss nor netstat is installed');
    else if (!uniq.length) add('ports', 'Listening ports', 'ok', 'Nothing listens on a public address (loopback only)');
    else add('ports', 'Listening ports', fwActive ? 'ok' : 'warn', `${uniq.length} port${uniq.length > 1 ? 's' : ''} reachable from the network` + (fwActive ? ' (firewall active, check it allows only what you need)' : ' and no active firewall seen') + (priv ? '' : '. Process names need sudo'), det);
  }
  // ---- updates
  { const lines = L('upd'); const pm = ((lines.find(l => l.startsWith('PM=')) || 'PM=none').slice(3)); const body = lines.filter(l => !/^(PM|STAMP)=/.test(l));
    let pk = [], sec = [];
    if (pm === 'apt') { pk = body.map(l => l.split(' ')[0].split('/')[0] + ' → ' + (l.split(' ')[1] || '')); sec = body.filter(l => /-security/.test(l)); }
    else if (pm === 'dnf' || pm === 'yum') { pk = body.filter(l => l.startsWith('P ')).map(l => l.slice(2).split(/\s+/).slice(0, 2).join(' → ')); sec = body.filter(l => l.startsWith('S ')); }
    else pk = body;
    const stamp = +((lines.find(l => l.startsWith('STAMP=')) || 'STAMP=').slice(6)); const age = stamp ? Math.floor((Date.now() / 1000 - stamp) / 86400) : null;
    const note = age != null && age > 7 ? ` · package lists last refreshed ${age} days ago` : '';
    if (pm === 'none') add('upd', 'Package updates', 'unknown', 'No supported package manager (apt, dnf, yum, apk, pacman)');
    else if (sec.length) add('upd', 'Package updates', 'fail', `${sec.length} security update${sec.length > 1 ? 's' : ''} (${pk.length} total, ${pm})` + note, pk.slice(0, 200));
    else if (pk.length) add('upd', 'Package updates', 'warn', `${pk.length} update${pk.length > 1 ? 's' : ''} available (${pm})` + note, pk.slice(0, 200));
    else add('upd', 'Package updates', 'ok', `Up to date according to the local package lists (${pm})` + note);
    R[R.length - 1].pm = pm;
  }
  // ---- reboot
  { const l = L('reboot'); const nr = (l.find(x => x.startsWith('NR=')) || '').slice(3);
    if (l[0] === 'YES') add('reboot', 'Reboot', 'warn', 'A reboot is required to finish installing updates', l.slice(1).filter(x => !/^(NR=|DEB)/.test(x)));
    else if (nr === '1') add('reboot', 'Reboot', 'warn', 'A reboot is required (needs-restarting)');
    else if (nr === '0' || l.includes('DEB')) add('reboot', 'Reboot', 'ok', 'No reboot required');
    else add('reboot', 'Reboot', 'unknown', 'Can\'t tell on this distro'); }
  // ---- docker
  { const l = L('docker');
    if (l[0] === 'NODOCKER') add('docker', 'Docker', 'ok', 'Docker isn\'t installed');
    else if (l[0] === 'NOACCESS') add('docker', 'Docker', 'unknown', 'Docker is installed but this user can\'t read it (add the user to the docker group, or allow passwordless sudo)');
    else { const cs = l.filter(x => x.startsWith('C|')).map(x => { const [, name, img, ports, rd, rem] = x.split('|');
        const pub = (ports || '').split(', ').filter(p => /^(0\.0\.0\.0|::|\[::\]):/.test(p));
        const digs = (rd || '').split(' ').filter(Boolean).map(d => d.split('@')[1]);
        const upd = !rem || !digs.length ? 'unknown' : digs.includes(rem) ? 'current' : 'newer';
        return { name, img, pub, upd }; });
      const newer = cs.filter(c => c.upd === 'newer'), pub = cs.filter(c => c.pub.length), unk = cs.filter(c => c.upd === 'unknown');
      const det = cs.map(c => `${c.name} · ${c.img} · image ${c.upd === 'newer' ? 'NEWER VERSION AVAILABLE' : c.upd === 'current' ? 'up to date' : 'unknown (can\'t compare with the registry)'}${c.pub.length ? ' · public ports ' + [...new Set(c.pub.map(p => p.replace(/^(0\.0\.0\.0|::|\[::\]):/, '').replace(/^.*?:/, '')))].join(', ') : ''}`);
      const bits = [`${cs.length} running container${cs.length === 1 ? '' : 's'}`]; if (newer.length) bits.push(`${newer.length} with a newer image`); if (pub.length) bits.push(`${pub.length} publishing ports on all interfaces (0.0.0.0)`); if (unk.length) bits.push(`${unk.length} image${unk.length > 1 ? 's' : ''} unknown`);
      add('docker', 'Docker containers', newer.length || pub.length ? 'warn' : 'ok', bits.join(' · '), det); } }
  // ---- ssh
  { const l = L('ssh'); const src = (l.find(x => x.startsWith('SRC=')) || 'SRC=none').slice(4); const v = {};
    for (const x of l) { const m = x.trim().match(/^(\w+)\s+(\S+)/); if (m && !x.startsWith('SRC=')) { const k = m[1].toLowerCase(); if (!(k in v)) v[k] = m[2].toLowerCase(); } }
    const prl = v.permitrootlogin || 'prohibit-password', pa = v.passwordauthentication || 'yes';
    const det = [`PermitRootLogin ${prl}${v.permitrootlogin ? '' : ' (default)'}`, `PasswordAuthentication ${pa}${v.passwordauthentication ? '' : ' (default)'}`, src === 'sshd' ? 'Read from sshd -T (effective config)' : 'Read from /etc/ssh/sshd_config (effective values need sudo)'];
    if (src === 'none') add('ssh', 'SSH config', 'unknown', 'Couldn\'t read sshd_config');
    else if (prl === 'yes') add('ssh', 'SSH config', 'fail', 'Root can log in with a password (PermitRootLogin yes)', det);
    else if (pa === 'yes') add('ssh', 'SSH config', 'warn', 'Password logins are allowed. SSH keys only is safer', det);
    else add('ssh', 'SSH config', 'ok', 'Root password login off, key-only logins', det); }
  // ---- disk + inodes
  const dfp = n => L(n).map(x => x.trim().split(/\s+/)).filter(p => p.length >= 6 && /%$/.test(p[4])).map(p => ({ mount: p.slice(5).join(' '), pct: parseInt(p[4]) })).filter(d => !isNaN(d.pct) && !/^\/(run|dev|sys|proc|snap|boot\/efi)/.test(d.mount));
  for (const [n, t] of [['df', 'Disk space'], ['dfi', 'Inodes']]) { const d = dfp(n); const mx = d.reduce((a, b) => b.pct > a.pct ? b : a, { pct: -1 });
    if (!d.length) add(n, t, 'unknown', 'Not reported');
    else add(n, t, mx.pct >= 95 ? 'fail' : mx.pct >= 85 ? 'warn' : 'ok', `Fullest: ${mx.mount} at ${mx.pct}%`, d.map(x => `${x.mount} ${x.pct}%`)); }
  // ---- systemd
  { const l = L('units'); if (l[0] === 'NOSYSTEMD') add('units', 'Failed services', 'unknown', 'systemd isn\'t running here');
    else { const f = l.filter(x => !x.startsWith('RC=')).map(x => x.trim().split(/\s+/)[0]);
      add('units', 'Failed services', f.length ? 'warn' : 'ok', f.length ? `${f.length} failed systemd unit${f.length > 1 ? 's' : ''}` : 'No failed systemd units', f); } }
  const order = ['fw', 'ports', 'upd', 'reboot', 'ssh', 'docker', 'df', 'dfi', 'units'];
  return { privileged: priv, items: R.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) };
}

// ---------- Health tab (renderer only; runs the read-only script above over the 'exec' channel)
const H_LABEL = { ok: 'OK', warn: 'Warn', fail: 'Fail', unknown: '?' };
function vHealth(s, u, v) {
  if (!s.connected) { v.innerHTML = notConn(s); return; }
  const draw = () => { const h = u.health;
    v.innerHTML = `<div class="card health"><div class="row" style="margin-bottom:8px;flex-wrap:wrap"><div class="card-title grow">Health &amp; security <span class="muted">· read-only checks, nothing on the server is changed</span></div>
      <button class="sm" id="hRef" title="Runs apt-get update / dnf makecache with sudo -n" ${u.healthBusy ? 'disabled' : ''}>Refresh package lists (sudo)</button><button class="primary sm" id="hRun" ${u.healthBusy ? 'disabled' : ''}>${u.healthBusy ? 'Checking…' : h ? 'Run again' : 'Run checks'}</button></div>
      ${u.healthBusy ? '<p class="muted">Running checks… Docker image checks can take up to a minute.</p>' : ''}
      ${h ? `<p class="muted small" style="margin:0 0 8px">Checked at ${new Date(h.at).toLocaleTimeString('en-GB')}${h.privileged ? ' · used passwordless sudo for read-only details' : ' · no root or passwordless sudo, so some checks are limited'}</p>
      <div class="hlist">${h.items.map(i => `<details class="hitem ${i.status}"><summary><span class="hs ${i.status}">${H_LABEL[i.status]}</span><b>${esc(i.title)}</b><span class="muted small hsum">${esc(i.summary)}</span></summary>${i.details.length ? `<ul class="mono small">${i.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : '<p class="muted small">No details.</p>'}</details>`).join('')}</div>`
      : u.healthBusy ? '' : '<p class="muted">Checks open ports, firewall, pending updates, reboot, Docker images, SSH login settings, disk/inode space and failed services.</p>'}</div>`;
    $('#hRun').onclick = run; $('#hRef').onclick = refreshLists; };
  const run = async () => { u.healthBusy = true; draw();
    try { const r = await uc.call('exec', s.id, HEALTH_SCRIPT, 150000); u.health = { ...parseHealth(r.out || ''), at: Date.now() }; }
    catch (e) { toast('Health check failed: ' + e.message, true); }
    u.healthBusy = false; if (cur === s.id && u.tab === 'health') draw(); };
  const refreshLists = async () => {
    if (!confirm('Refresh the package lists on this server?\n\nThis runs apt-get update (or dnf/yum makecache, apk update) with sudo -n, so it only works as root or with passwordless sudo. Nothing is installed or upgraded.')) return;
    u.healthBusy = true; draw();
    try { const r = await uc.call('exec', s.id, HEALTH_REFRESH, 180000);
      if (r.code) toast('Couldn\'t refresh: ' + ((r.err || r.out || '').trim().split('\n').pop() || 'needs root or passwordless sudo'), true); else toast('Package lists refreshed'); }
    catch (e) { toast(e.message, true); }
    u.healthBusy = false; run(); };
  draw(); if (!u.health && !u.healthBusy) run();
}
if (typeof module !== 'undefined') module.exports = { HEALTH_SCRIPT, HEALTH_REFRESH, parseHealth };
