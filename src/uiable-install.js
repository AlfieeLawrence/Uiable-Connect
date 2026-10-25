'use strict';
// One-click Install / Update of Uiable (github.com/AlfieeLawrence/uiable) on the connected server.
// Uses the project's own install.sh from the release zip. Data lives in the Docker volume "uiable-data", which
// install.sh never removes; the existing port/bind from /opt/uiable/.env are passed back so nothing changes.
const UI_DIR = '/opt/uiable';
const UI_DETECT = `D=${UI_DIR}; V=$(sed -n 's/.*"version": *"\\([^"]*\\)".*/\\1/p' "$D/package.json" 2>/dev/null | head -1)
P=$(sed -n 's/^UIABLE_PORT=//p' "$D/.env" 2>/dev/null | tail -1); B=$(sed -n 's/^UIABLE_BIND=//p' "$D/.env" 2>/dev/null | tail -1)
P=\${P:-8080}; H=\${B:-127.0.0.1}; case "$H" in 0.0.0.0|::|'') H=127.0.0.1;; esac
R=$( (curl -fsm3 "http://$H:$P/api/state" 2>/dev/null || wget -qO- -T3 "http://$H:$P/api/state" 2>/dev/null) | sed -n 's/.*"version":"\\([^"]*\\)".*/\\1/p' | head -1)
echo "files=$V"; echo "running=$R"; echo "port=$P"
command -v docker >/dev/null 2>&1 && echo docker=1; (docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1) && echo compose=1
command -v curl >/dev/null 2>&1 && echo curl=1; command -v wget >/dev/null 2>&1 && echo wget=1
if [ "$(id -u)" = 0 ]; then echo priv=root; elif command -v sudo >/dev/null 2>&1; then if sudo -n true 2>/dev/null; then echo priv=nopass; else echo priv=password; fi; else echo priv=none; fi
echo "home=$HOME"`;
const UI_JOB = (url, ver, user = '') => `#!/bin/sh
# Uiable Connect: install/update Uiable ${ver}. Runs as root. Never removes the uiable-data volume.
set -eu
D=${UI_DIR}; URL='${url.replace(/'/g, '')}'; SSHUSER='${String(user).replace(/[^A-Za-z0-9._-]/g, '')}'
echo "==> Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Docker isn't installed: installing it first"
  . /etc/os-release 2>/dev/null || true
  case " \${ID:-} \${ID_LIKE:-} " in
    *" alpine "*) apk add --no-cache docker docker-cli-compose; rc-update add docker default || true; rc-service docker start || service docker start || true ;;
    *" arch "*) pacman -Sy --noconfirm --needed docker docker-compose; systemctl enable --now docker ;;
    *" debian "*|*" ubuntu "*|*" raspbian "*|*" fedora "*|*" centos "*|*" rhel "*|*" rocky "*|*" almalinux "*)
      if command -v curl >/dev/null 2>&1; then curl -fsSL https://get.docker.com -o "\${TMPDIR:-/tmp}/get-docker.sh"; else wget -qO "\${TMPDIR:-/tmp}/get-docker.sh" https://get.docker.com; fi
      sh "\${TMPDIR:-/tmp}/get-docker.sh"; rm -f "\${TMPDIR:-/tmp}/get-docker.sh"
      systemctl enable --now docker 2>/dev/null || service docker start 2>/dev/null || true ;;
    *) echo "ERROR: automatic Docker install isn't supported on \${PRETTY_NAME:-this OS}. Install Docker and Docker Compose yourself (https://docs.docker.com/engine/install/), then try again."; exit 10 ;;
  esac
  if [ -n "$SSHUSER" ] && [ "$SSHUSER" != root ] && getent group docker >/dev/null 2>&1; then
    (usermod -aG docker "$SSHUSER" 2>/dev/null || addgroup "$SSHUSER" docker 2>/dev/null) && echo "==> Added $SSHUSER to the docker group (takes effect on the next login)"; fi
  i=0; until docker info >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 15 ] && break; sleep 2; done
  docker version || { echo "ERROR: Docker was installed but isn't running."; exit 11; }
elif ! docker info >/dev/null 2>&1; then echo "ERROR: Docker is installed but not running. Start it (sudo systemctl start docker) and try again; Uiable Connect won't change an existing Docker install."; exit 11
else echo "Docker is already installed: leaving it as it is"; fi
if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  echo "ERROR: Docker Compose is missing from the existing Docker install. Install the docker-compose-plugin package, then try again."; exit 12
fi
docker compose version 2>/dev/null || docker-compose version
PORT=8080; BIND=127.0.0.1
if [ -f "$D/.env" ]; then
  P=$(sed -n 's/^UIABLE_PORT=//p' "$D/.env" | tail -1); B=$(sed -n 's/^UIABLE_BIND=//p' "$D/.env" | tail -1)
  [ -n "$P" ] && PORT=$P; [ -n "$B" ] && BIND=$B
fi
if [ -f "$D/docker-compose.yml" ]; then
  BK="$D.backup-$(date +%Y%m%d-%H%M%S).tar.gz"
  echo "==> Backing up the current app folder and config to $BK (your accounts are in the uiable-data volume, which is kept)"
  tar -C "$(dirname "$D")" --exclude=node_modules -czf "$BK" "$(basename "$D")"
fi
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
echo "==> Downloading $URL"
if command -v curl >/dev/null 2>&1; then curl -fL --retry 2 -o "$T/u.zip" "$URL"; else wget -O "$T/u.zip" "$URL"; fi
mkdir -p "$T/x"
if command -v unzip >/dev/null 2>&1; then unzip -q "$T/u.zip" -d "$T/x"
elif command -v busybox >/dev/null 2>&1 && busybox unzip -h >/dev/null 2>&1; then busybox unzip -q "$T/u.zip" -d "$T/x"
elif command -v python3 >/dev/null 2>&1; then python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$T/u.zip" "$T/x"
else echo "ERROR: need unzip, busybox or python3 to unpack the release"; exit 13; fi
X=$(dirname "$(find "$T/x" -name install.sh | head -n1)")
[ -d "$X/server" ] && [ -f "$X/docker-compose.yml" ] || { echo "ERROR: the download doesn't look like Uiable"; exit 14; }
echo "==> Running Uiable's installer (port $PORT, bind $BIND)"
sh "$X/install.sh" --port "$PORT" --bind "$BIND" --dir "$D"
echo "==> Done"
`;
const kv = t => Object.fromEntries(t.split('\n').map(l => l.split('=')).filter(a => a.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()]));
const vNewer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

async function uiInstallState(s, u) {
  const [d, latest] = await Promise.all([uc.call('exec', s.id, UI_DETECT, 20000), uc.call('uiable:latest').catch(() => null)]);
  const i = kv(d.out || ''); const cur = i.running || i.files || '';
  u.uiInst = { ...i, installed: !!(i.files || i.running || u.uiable?.isUiable), cur, latest };
  return u.uiInst;
}
async function uiInstallButton(s, u, pill) {
  const box = (pill || document).querySelector('#uiInst'); if (!box || !s.connected) return;
  if (!u.uiInst) { try { await uiInstallState(s, u); } catch { return; } }
  if (!box.isConnected) return;
  const i = u.uiInst, L = i.latest;
  if (!L) { box.innerHTML = i.installed ? `<span class="pill small">Uiable ${esc(i.cur)}</span>` : ''; return; }
  const label = !i.installed ? `Install Uiable ${esc(L.version)}` : vNewer(L.version, i.cur || '0') ? `Update Uiable to ${esc(L.version)}` : '';
  box.innerHTML = label ? `<button class="sm ${i.installed ? 'primary' : ''}" id="uiGo">${label}</button>` : `<span class="pill ok small">Uiable ${esc(i.cur)} · up to date</span>`;
  if (box.querySelector('#uiGo')) box.querySelector('#uiGo').onclick = () => uiInstallRun(s, u);
}
async function uiInstallRun(s, u) {
  let i; try { i = await uiInstallState(s, u); } catch (e) { return toast(e.message, true); }
  const L = i.latest; if (!L || !L.url) return toast("Couldn't find the latest Uiable release on GitHub", true);
  const update = i.installed;
  const miss = !(i.curl || i.wget) ? 'Neither curl nor wget is installed on this server.' : i.priv === 'none' ? 'This needs root, and sudo is not available for this user.' : '';
  const needPw = i.priv === 'password' && !s.has_sudoPassword;
  const m = el(`<div class="modal-bg"><div class="modal" style="width:720px"><header><h3 class="grow">${update ? `Update Uiable ${esc(i.cur)} → ${esc(L.version)}` : `Install Uiable ${esc(L.version)}`}</h3></header><div class="body">
    ${miss ? `<p class="pill err" style="display:block">${miss} </p>` : `
    <p>This downloads <span class="mono">${esc(L.url.split('/').pop())}</span> from the Uiable GitHub release onto the server, unpacks it into <span class="mono">${UI_DIR}</span> and runs Uiable's own <span class="mono">install.sh</span> (<span class="mono">docker compose up -d --build</span>).</p>
    <ul class="small">${!i.docker ? `<li><b>Docker isn't installed; it will be installed first</b> (Docker's official get.docker.com script on Debian/Ubuntu/Raspbian/Fedora/CentOS/RHEL, apk on Alpine, pacman on Arch), started, and ${esc(s.username)} is added to the docker group. Other systems stop with a message.</li>` : !i.compose ? `<li class="err">Docker is installed but Docker Compose is missing. Uiable Connect won't change an existing Docker install, so install the compose plugin first.</li>` : ''}<li>${update ? `Your accounts, settings and layouts stay: they live in the Docker volume <span class="mono">uiable-data</span>, which is never removed. The current folder and <span class="mono">.env</span> are backed up to <span class="mono">${UI_DIR}.backup-&lt;date&gt;.tar.gz</span> first, and the same port is kept.` : `Uiable will listen on 127.0.0.1:8080 on the server; open it here through the SSH tunnel.`}</li>
    <li>It needs root. ${i.priv === 'root' ? 'You are root.' : i.priv === 'nopass' ? 'Passwordless sudo will be used.' : s.has_sudoPassword ? 'Your saved sudo password will be used.' : 'Enter your sudo password below; it is sent to sudo over the SSH connection and is not stored or logged.'}</li><li>Building takes a few minutes on small servers.</li></ul>
    ${needPw ? `<label class="field"><span>sudo password for ${esc(s.username)}</span><input type="password" id="sp" autocomplete="off"></label>` : ''}`}
    <pre class="mono small uilog hidden"></pre></div>
    <footer><span class="muted small" id="uist"></span><span class="spacer"></span><button id="c">Close</button>${miss ? '' : `<button class="primary" id="go">${update ? 'Update' : 'Install'}</button>`}</footer></div></div>`);
  document.body.append(m); const log = m.querySelector('.uilog'), stl = m.querySelector('#uist'); let running = false;
  m.querySelector('#c').onclick = () => { if (running && !confirm('The install keeps running on the server. Close this window?')) return; m.remove(); };
  if (miss) return;
  m.querySelector('#go').onclick = async () => {
    const pw = m.querySelector('#sp')?.value || ''; if (needPw && !pw) return toast('Enter the sudo password', true);
    running = true; m.querySelector('#go').disabled = true; log.classList.remove('hidden'); log.textContent = ''; stl.textContent = 'Running…';
    const dir = (i.home || '~') + '/.uiable-connect', job = dir + '/uiable-job.sh', out = dir + '/uiable-job.log';
    const q = x => "'" + x.replace(/'/g, `'\\''`) + "'";
    try {
      await uc.call('exec', s.id, `mkdir -p -m 700 ${q(dir)} && chmod 700 ${q(dir)} && rm -f ${q(out)}`, 15000);
      await uc.call('fs:write', s.id, job, UI_JOB(L.url, L.version, s.username));
      const run = `nohup sh -c 'sh ${job.replace(/'/g, '')} ; echo "@@EXIT $?"' > ${q(out)} 2>&1 < /dev/null &`;
      // sudo goes through the app: the saved (or one-off) password reaches sudo's stdin via a file
      // descriptor, never on a command line and never in the job log
      const r = i.priv === 'root' ? await uc.call('exec', s.id, run, 30000)
        : i.priv === 'nopass' ? await uc.call('exec', s.id, `sudo -n sh -c ${q(run)}`, 30000)
        : await uc.call('sudo:exec', s.id, run, pw || undefined);
      if (r.code) throw new Error(/incorrect|try again|Sorry/i.test(r.err || '') ? 'Wrong sudo password' : (r.err || 'Could not start the installer').trim());
      let off = 0, code = null, idle = 0;
      while (code == null && document.body.contains(m)) {
        await new Promise(res => setTimeout(res, 1500));
        const t = await uc.call('exec', s.id, `[ -f ${q(out)} ] && { wc -c < ${q(out)}; tail -c +${off + 1} ${q(out)}; } || echo 0`, 15000).catch(() => null);
        if (!t) { if (++idle > 20) throw new Error('Lost contact with the server'); continue; }
        const nl = t.out.indexOf('\n'); const size = parseInt(t.out.slice(0, nl), 10) || off; const chunk = t.out.slice(nl + 1);
        if (size > off) { off = size; const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 30; log.textContent += chunk.replace(/\x1b\[[0-9;]*m/g, ''); if (atEnd) log.scrollTop = log.scrollHeight; }
        const mm = /@@EXIT (\d+)/.exec(log.textContent); if (mm) code = Number(mm[1]);
      }
      if (code == null) return;
      stl.textContent = code === 0 ? 'Finished' : `Failed (exit ${code})`;
      u.uiInst = null; u.uiable = await uc.call('uiable:detect', s.id).catch(() => null); refresh();
      if (code === 0) { toast(update ? 'Uiable updated' : 'Uiable installed');
        const b = el('<button class="primary">Open dashboard</button>'); b.onclick = () => { m.remove(); openUi(s.id, 'window'); }; m.querySelector('footer').append(b); }
      else toast('Uiable install failed, see the log', true);
    } catch (e) { stl.textContent = 'Failed'; toast(e.message, true); m.querySelector('#go').disabled = false; }
    finally { running = false; }
  };
}
if (typeof module !== 'undefined') module.exports = { UI_DETECT, UI_JOB, kv };
