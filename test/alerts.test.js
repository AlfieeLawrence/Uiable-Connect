// node test/alerts.test.js
const { evalAlerts, defaultAlerts } = require('../src/alerts.js');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const s = { id: 'a', alerts: defaultAlerts() };
const x = (cpu, disk = 50) => ({ cpu, memUsed: 1, memTotal: 10, swapTotal: 0, load: [1, 1, 1], disks: [{ mount: '/', used: disk, size: 100 }, { mount: '/data', used: 10, size: 100 }] });
let t = 0; ok(!evalAlerts(s, x(95), t).length, 'cpu high but not for 60s yet');
ok(!evalAlerts(s, x(95), t += 30e3).length, '30s');
let r = evalAlerts(s, x(95), t += 31e3); ok(r.length === 1 && /CPU usage is 95%/.test(r[0]), 'fires after 60s: ' + r[0]);
ok(!evalAlerts(s, x(95), t += 60e3).length, 'cooldown holds');
ok(!evalAlerts(s, x(10), t += 1e3).length, 'drops back');
r = evalAlerts(s, x(10, 93), t += 1e3); ok(r.length === 1 && /Disk usage is 93% on \//.test(r[0]), 'disk any mount fires immediately: ' + r[0]);
const s2 = { id: 'b', alerts: defaultAlerts().map(a => a.metric === 'disk' ? { ...a, mount: '/data' } : a) };
ok(!evalAlerts(s2, x(10, 99), 0).length, 'disk rule scoped to /data ignores /');
ok(!evalAlerts({ id: 'c', alerts: defaultAlerts().map(a => ({ ...a, enabled: false })) }, x(99, 99), 1e9).length, 'disabled rules never fire');
