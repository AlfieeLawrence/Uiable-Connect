'use strict';
// One-click Install / Update of Uiable (github.com/AlfieeLawrence/uiable) on the connected server.
// Uses the project's own install.sh from the release zip. Data lives in the Docker volume "uiable-data", which
// install.sh never removes; the existing port/bind from /opt/uiable/.env are passed back so nothing changes.
const UI_DIR = '/opt/uiable';
const UI_DETECT = `D=${UI_DIR}; V=$(sed -n 's/.*"version": *"\\([^"]*\\)".*/\\1/p' "$D/package.json" 2>/dev/null | head -1)
P=$(sed -n 's/^UIABLE_PORT=//p' "$D/.env" 2>/dev/null | tail -1); B=$(sed -n 's/^UIABLE_BIND=//p' "$D/.env" 2>/dev/null | tail -1)
P=\${P:-8080}; H=\${B:-127.0.0.1}; case "$H" in 0.0.0.0|::|'') H=127.0.0.1;; esac
R=$( (curl -fsm3 "http://$H:$P/api/state" 2>/dev/null || wget -qO- -T3 "http://$H:$P/api/state" 2>/dev/null) | sed -n 's/.*"version":"\\([^"]*\\)".*/\\1/p' | head -1)
echo "files=$V"; echo "running=$R"; echo "port=$P"; echo "bind=$B"
command -v docker >/dev/null 2>&1 && echo docker=1; (docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1) && echo compose=1
command -v curl >/dev/null 2>&1 && echo curl=1; command -v wget >/dev/null 2>&1 && echo wget=1
if [ "$(id -u)" = 0 ]; then echo priv=root; elif command -v sudo >/dev/null 2>&1; then if sudo -n true 2>/dev/null; then echo priv=nopass; else echo priv=password; fi; else echo priv=none; fi
echo "home=$HOME"`;
const UI_JOB = (url, ver, user = '', opts = {}) => {
  const port = Math.max(1, Math.min(65535, parseInt(opts.port, 10) || 8080));
  const bind = opts.bind === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
  const adminUser = String(opts.adminUser || '').replace(/[^A-Za-z0-9_.\-@]/g, '').slice(0, 64);
  const adminPassB64 = opts.adminPass ? Buffer.from(String(opts.adminPass), 'utf8').toString('base64') : '';
  return `#!/bin/sh
# Uiable Connect: install/update Uiable ${ver}. Runs as root. Never removes the uiable-data volume.
set -eu
D=${UI_DIR}; URL='${url.replace(/'/g, '')}'; SSHUSER='${String(user).replace(/[^A-Za-z0-9._-]/g, '')}'
PORT=${port}; BIND='${bind}'
ADMIN_USER='${adminUser}'; ADMIN_PASS_B64='${adminPassB64}'
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
# Always pass port/bind/dir. Prefer installer account flags when present.
HAS_ADMIN_FLAGS=0
if [ -n "$ADMIN_USER" ] && [ -n "$ADMIN_PASS_B64" ] && grep -q -- '--admin-user' "$X/install.sh" 2>/dev/null; then
  HAS_ADMIN_FLAGS=1
  ADMIN_PASS=$(printf '%s' "$ADMIN_PASS_B64" | (base64 -d 2>/dev/null || base64 -D 2>/dev/null || openssl base64 -d))
  echo "==> Running Uiable's installer (port $PORT, bind $BIND, first account $ADMIN_USER)"
  sh "$X/install.sh" --port "$PORT" --bind "$BIND" --dir "$D" --admin-user "$ADMIN_USER" --admin-password "$ADMIN_PASS"
else
  echo "==> Running Uiable's installer (port $PORT, bind $BIND)"
  sh "$X/install.sh" --port "$PORT" --bind "$BIND" --dir "$D"
fi
# If installer has no account flags, create admin via /api/setup when credentials were given
if [ -n "$ADMIN_USER" ] && [ -n "$ADMIN_PASS_B64" ] && [ "$HAS_ADMIN_FLAGS" = 0 ]; then
  ADMIN_PASS=$(printf '%s' "$ADMIN_PASS_B64" | (base64 -d 2>/dev/null || base64 -D 2>/dev/null || openssl base64 -d))
  CHECK_HOST=$BIND
  if [ "$BIND" = "0.0.0.0" ] || [ "$BIND" = "::" ]; then CHECK_HOST=127.0.0.1; fi
  echo "==> Waiting for Uiable on $CHECK_HOST:$PORT to create the first account"
  ok=0; i=0; until [ $i -gt 40 ]; do
    i=$((i+1))
    st=$(curl -fsm3 "http://$CHECK_HOST:$PORT/api/state" 2>/dev/null || wget -qO- -T3 "http://$CHECK_HOST:$PORT/api/state" 2>/dev/null || true)
    if echo "$st" | grep -q '"setup":true'; then ok=1; break; fi
    if echo "$st" | grep -q '"setup":false'; then echo "==> Setup already completed; leaving accounts as they are"; ok=2; break; fi
    sleep 2
  done
  if [ "$ok" = 1 ]; then
    echo "==> Creating admin account '$ADMIN_USER'"
    if command -v python3 >/dev/null 2>&1; then
      SETUP_USER="$ADMIN_USER" SETUP_PASS="$ADMIN_PASS" SETUP_URL="http://$CHECK_HOST:$PORT/api/setup" python3 - <<'PY'
import json, os, urllib.request
req = urllib.request.Request(os.environ["SETUP_URL"], data=json.dumps({
  "username": os.environ["SETUP_USER"], "password": os.environ["SETUP_PASS"]
}).encode(), headers={"Content-Type": "application/json"}, method="POST")
try:
  with urllib.request.urlopen(req, timeout=30) as r:
    print("==> Account created:", r.status)
except Exception as e:
  print("ERROR: could not create account:", e)
  raise SystemExit(15)
PY
    else
      # minimal JSON escape for curl fallback
      body=$(printf '{"username":"%s","password":"%s"}' "$ADMIN_USER" "$(printf '%s' "$ADMIN_PASS" | sed 's/\\/\\\\/g; s/"/\\"/g')")
      curl -fsS -X POST "http://$CHECK_HOST:$PORT/api/setup" -H 'Content-Type: application/json' -d "$body" \
        || wget -qO- --post-data="$body" --header='Content-Type: application/json' "http://$CHECK_HOST:$PORT/api/setup" \
        || { echo "ERROR: could not create account (need python3 or curl/wget)"; exit 15; }
      echo "==> Account created"
    fi
  elif [ "$ok" = 0 ]; then
    echo "WARNING: Uiable did not become ready in time; create the admin account on first open"
  fi
fi
echo "==> Done"
`;
};

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
  const curPort = String(parseInt(i.port, 10) || 8080);
  const curBind = i.bind === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
  const miss = !(i.curl || i.wget) ? 'Neither curl nor wget is installed on this server.' : i.priv === 'none' ? 'This needs root, and sudo is not available for this user.' : '';
  const needPw = i.priv === 'password' && !s.has_sudoPassword;

  const cfg = el(`<div class="modal-bg"><div class="modal" style="width:520px"><header><h3 class="grow">${update ? `Update Uiable ${esc(i.cur)} → ${esc(L.version)}` : `Install Uiable ${esc(L.version)}`}</h3></header><div class="body">
    <p class="small muted">Choose how Uiable should listen on the server. Optional first-account fields create the admin during install; leave them blank to set the account on first open (same as today).</p>
    <div class="row" style="gap:12px;align-items:flex-end">
      <label class="field grow"><span>Port</span><input type="number" id="uiport" min="1" max="65535" value="${esc(curPort)}"></label>
      <label class="field grow"><span>Bind address</span><select id="uibind"><option value="127.0.0.1"${curBind === '127.0.0.1' ? ' selected' : ''}>127.0.0.1 (localhost only)</option><option value="0.0.0.0"${curBind === '0.0.0.0' ? ' selected' : ''}>0.0.0.0 (all interfaces)</option></select></label>
    </div>
    <label class="field"><span>First account username <span class="muted">(optional)</span></span><input type="text" id="uiuser" autocomplete="off" spellcheck="false" placeholder="Leave blank to set on first launch"></label>
    <label class="field"><span>First account password <span class="muted">(optional)</span></span><input type="password" id="uipass" autocomplete="new-password" placeholder="Leave blank to set on first launch"></label>
    <p class="small muted">${update ? 'On update, the account is only created if no admin exists yet. Your data volume is never removed.' : 'Credentials are sent only to the server installer job over SSH and are not stored in Connect.'}</p>
  </div><footer><button id="c">Cancel</button><span class="spacer"></span><button class="primary" id="next"${miss ? ' disabled' : ''}>Continue</button></footer></div></div>`);
  document.body.append(cfg); if (typeof focusModal === 'function') focusModal(cfg);
  cfg.querySelector('#c').onclick = () => cfg.remove();
  if (miss) {
    cfg.querySelector('.body').insertAdjacentHTML('afterbegin', `<p class="pill err" style="display:block">${miss}</p>`);
    return;
  }
  const opts = await new Promise(resolve => {
    cfg.querySelector('#next').onclick = () => {
      const port = Math.max(1, Math.min(65535, parseInt(cfg.querySelector('#uiport').value, 10) || 0));
      if (!port) return toast('Enter a valid port (1–65535)', true);
      const bind = cfg.querySelector('#uibind').value === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
      const adminUser = (cfg.querySelector('#uiuser').value || '').trim();
      const adminPass = cfg.querySelector('#uipass').value || '';
      if ((adminUser && !adminPass) || (!adminUser && adminPass)) return toast('Enter both username and password, or leave both blank', true);
      if (adminUser && !/^[A-Za-z0-9_.\-@]{1,64}$/.test(adminUser)) return toast('Username: letters, numbers, . _ - @ only', true);
      cfg.remove();
      resolve({ port, bind, adminUser, adminPass });
    };
    cfg.addEventListener('keydown', e => { if (e.key === 'Escape') { cfg.remove(); resolve(null); } });
  });
  if (!opts) return;
  return uiInstallProgress(s, u, i, L, update, needPw, opts);
}

async function uiInstallProgress(s, u, i, L, update, needPw, opts) {
  const m = el(`<div class="modal-bg"><div class="modal" style="width:720px"><header><h3 class="grow">${update ? `Update Uiable ${esc(i.cur)} → ${esc(L.version)}` : `Install Uiable ${esc(L.version)}`}</h3></header><div class="body">
    <p>This downloads <span class="mono">${esc(L.url.split('/').pop())}</span> from the Uiable GitHub release onto the server, unpacks it into <span class="mono">${UI_DIR}</span> and runs Uiable's own <span class="mono">install.sh</span> (<span class="mono">docker compose up -d --build</span>).</p>
    <ul class="small">${!i.docker ? `<li><b>Docker isn't installed; it will be installed first</b> (Docker's official get.docker.com script on Debian/Ubuntu/Raspbian/Fedora/CentOS/RHEL, apk on Alpine, pacman on Arch), started, and ${esc(s.username)} is added to the docker group. Other systems stop with a message.</li>` : !i.compose ? `<li class="err">Docker is installed but Docker Compose is missing. Uiable Connect won't change an existing Docker install, so install the compose plugin first.</li>` : ''}<li>${update ? `Your accounts, settings and layouts stay: they live in the Docker volume <span class="mono">uiable-data</span>, which is never removed. The current folder and <span class="mono">.env</span> are backed up to <span class="mono">${UI_DIR}.backup-&lt;date&gt;.tar.gz</span> first.` : `Uiable will listen on <span class="mono">${esc(opts.bind)}:${esc(String(opts.port))}</span> on the server; open it here through the SSH tunnel.`}</li>
    <li>Listen: <span class="mono">${esc(opts.bind)}:${esc(String(opts.port))}</span>${opts.adminUser ? `; first account <span class="mono">${esc(opts.adminUser)}</span> will be created if setup is still needed` : '; first account set on first open if none exists'}.</li>
    <li>It needs root. ${i.priv === 'root' ? 'You are root.' : i.priv === 'nopass' ? 'Passwordless sudo will be used.' : s.has_sudoPassword ? 'Your saved sudo password will be used.' : 'Enter your sudo password below; it is sent to sudo over the SSH connection and is not stored or logged.'}</li><li>Building takes a few minutes on small servers.</li></ul>
    ${needPw ? `<label class="field"><span>sudo password for ${esc(s.username)}</span><input type="password" id="sp" autocomplete="off"></label>` : ''}
    <pre class="mono small uilog hidden"></pre></div>
    <footer><span class="muted small" id="uist"></span><span class="spacer"></span><button id="c">Close</button><button class="primary" id="go">${update ? 'Update' : 'Install'}</button></footer></div></div>`);
  document.body.append(m); if (typeof focusModal === 'function') focusModal(m); const log = m.querySelector('.uilog'), stl = m.querySelector('#uist'); let running = false;
  m.querySelector('#c').onclick = () => { if (running && !confirm('The install keeps running on the server. Close this window?')) return; m.remove(); };
  m.querySelector('#go').onclick = async () => {
    const pw = m.querySelector('#sp')?.value || ''; if (needPw && !pw) return toast('Enter the sudo password', true);
    running = true; m.querySelector('#go').disabled = true; log.classList.remove('hidden'); log.textContent = ''; stl.textContent = 'Running…';
    const dir = (i.home || '~') + '/.uiable-connect', job = dir + '/uiable-job.sh', out = dir + '/uiable-job.log';
    const q = x => "'" + x.replace(/'/g, "'\\''") + "'";
    try {
      await uc.call('exec', s.id, `mkdir -p -m 700 ${q(dir)} && chmod 700 ${q(dir)} && rm -f ${q(out)}`, 15000);
      await uc.call('fs:write', s.id, job, UI_JOB(L.url, L.version, s.username, opts));
      const run = `nohup sh -c 'sh ${job.replace(/'/g, '')} ; echo "@@EXIT $?"' > ${q(out)} 2>&1 < /dev/null &`;
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
