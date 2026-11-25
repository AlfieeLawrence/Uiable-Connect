'use strict';
// Install Uiable needs two separate confirmations (1.4.12). Drives uiInstallDoubleConfirm with a fake dialog.
const test = require('node:test'), assert = require('node:assert');
const { uiInstallDoubleConfirm } = require('../src/uiable-install.js');
const S = { name: 'xserver', host: '10.0.0.5' }, L = { version: '1.2.8' }, O = { port: 8080, bind: '127.0.0.1' };
const fake = answers => { const seen = []; return { seen, dlg: async o => { seen.push(o); return answers[seen.length - 1]; } }; };

test('both steps confirmed -> install allowed', async () => {
  const f = fake([true, true]);
  assert.strictEqual(await uiInstallDoubleConfirm(S, L, O, f.dlg), true);
  assert.strictEqual(f.seen.length, 2);
  assert.match(f.seen[0].body, /privileged Docker container/); assert.match(f.seen[0].body, /127\.0\.0\.1:8080/); assert.match(f.seen[0].body, /pulls/);
  const two = f.seen[1];
  assert.deepStrictEqual(two.typed, ['xserver', 'INSTALL']);
  assert.strictEqual(two.danger, true); assert.strictEqual(two.focusCancel, true); assert.strictEqual(two.ok, 'Install');
});
test('cancel (Esc / outside click / Cancel) at step 1 stops before step 2', async () => {
  const f = fake([false, true]);
  assert.strictEqual(await uiInstallDoubleConfirm(S, L, O, f.dlg), false);
  assert.strictEqual(f.seen.length, 1);
});
test('cancel at step 2 -> nothing runs', async () => {
  assert.strictEqual(await uiInstallDoubleConfirm(S, L, O, fake([true, false]).dlg), false);
  assert.strictEqual(await uiInstallDoubleConfirm(S, L, O, fake([true, undefined]).dlg), false);
});
test('no dialog available -> never confirmed', async () => {
  assert.strictEqual(await uiInstallDoubleConfirm(S, L, O, undefined), false);
});
test('all-interfaces bind is called out; unnamed server falls back to host', async () => {
  const f = fake([true, true]);
  await uiInstallDoubleConfirm({ host: 'box.lan' }, L, { port: 9000, bind: '0.0.0.0' }, f.dlg);
  assert.match(f.seen[0].body, /reachable from your network/);
  assert.deepStrictEqual(f.seen[1].typed, ['box.lan', 'INSTALL']);
});
