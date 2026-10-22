// Parser tests for src/health.js with canned server output (no SSH needed): node test/health.test.js
const { parseHealth } = require('../src/health.js');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const out = `@@meta
root= sudo=sudo -n
@@ports
tcp   LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))
tcp   LISTEN 0 4096 127.0.0.1:8080 0.0.0.0:* users:(("node",pid=2,fd=3))
tcp   LISTEN 0 4096 [::]:443 [::]:* users:(("nginx",pid=3,fd=3))
udp   UNCONN 0 0 127.0.0.53%lo:53 0.0.0.0:* users:(("systemd-resolve",pid=4,fd=3))
TOOL=ss
@@fw
ufw|Status: active
iptables|12 DROP
@@upd
PM=apt
openssl/jammy-security 3.0.2-0ubuntu1.15 amd64 [upgradable from: 3.0.2-0ubuntu1.14]
curl/jammy-updates 7.81.0-1ubuntu1.16 amd64 [upgradable from: 7.81.0-1ubuntu1.15]
STAMP=${Math.floor(Date.now() / 1000) - 10 * 86400}
@@reboot
YES
linux-image-6.8.0-45-generic
DEB
@@docker
C|web|nginx:latest|0.0.0.0:80->80/tcp, :::80->80/tcp|nginx@sha256:aaa|sha256:bbb
C|db|postgres:16|127.0.0.1:5432->5432/tcp|postgres@sha256:ccc|sha256:ccc
C|local|myapp:dev|||
@@ssh
PermitRootLogin yes
PasswordAuthentication no
SRC=sshd
@@df
/dev/sda1 100 96 4 96% /
/dev/sdb1 100 50 50 50% /data
@@dfi
/dev/sda1 100 10 90 10% /
@@units
nginx.service loaded failed failed A high performance web server
RC=ok
@@end
`;
const r = parseHealth(out); const g = id => r.items.find(i => i.id === id);
ok(r.privileged, 'sudo detected');
ok(g('fw').status === 'ok' && /ufw/.test(g('fw').summary), 'firewall active: ' + g('fw').summary);
ok(g('ports').details.length === 2 && g('ports').details.some(d => /443 · nginx/.test(d)) && !g('ports').details.some(d => /8080|:53/.test(d)), 'ports: loopback skipped: ' + g('ports').details.join(' | '));
ok(g('upd').status === 'fail' && /1 security update \(2 total/.test(g('upd').summary) && /10 days/.test(g('upd').summary), 'apt security: ' + g('upd').summary);
ok(g('reboot').status === 'warn', 'reboot required');
const d = g('docker'); ok(d.status === 'warn' && /1 with a newer image/.test(d.summary) && /1 publishing/.test(d.summary) && /1 image unknown/.test(d.summary), 'docker: ' + d.summary);
ok(g('ssh').status === 'fail', 'PermitRootLogin yes = fail');
ok(g('df').status === 'fail' && g('dfi').status === 'ok', 'disk 96% fail, inodes ok');
ok(g('units').status === 'warn' && g('units').details[0] === 'nginx.service', 'failed unit');
const r2 = parseHealth('@@meta\nroot= sudo=\n@@ports\nTOOL=none\n@@fw\n@@upd\nPM=dnf\nP bash.x86_64 5.2-1 updates\nS FEDORA-2026-1 Important/Sec. bash-5.2-1\n@@reboot\nNR=1\n@@docker\nNODOCKER\n@@ssh\nSRC=none\n@@df\n@@dfi\n@@units\nNOSYSTEMD\n@@end\n');
const g2 = id => r2.items.find(i => i.id === id);
ok(g2('fw').status === 'warn' && g2('ports').status === 'unknown' && g2('upd').status === 'fail' && g2('reboot').status === 'warn' && g2('docker').status === 'ok' && g2('ssh').status === 'unknown' && g2('units').status === 'unknown', 'missing tools handled gracefully');
