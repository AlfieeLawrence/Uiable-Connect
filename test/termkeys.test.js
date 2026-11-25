'use strict';
// Terminal typing: printable keys (Shift / Caps Lock capitals, UK symbols, AltGr) must be sent from keydown and
// never depend on xterm's later keypress; IME, dead keys and Ctrl/Alt/Cmd combos are left to xterm.
const test = require('node:test'), assert = require('node:assert');
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'app.js'), 'utf8');
const m = src.match(/function termTypedKey\(term, e, st\) \{[\s\S]*?\n\}/); assert.ok(m, 'termTypedKey in src/app.js');
const termTypedKey = new Function(m[0] + '; return termTypedKey;')();
const ev = (key, o = {}) => ({ type: 'keydown', key, keyCode: o.keyCode ?? 65, shiftKey: !!o.shift, ctrlKey: !!o.ctrl, altKey: !!o.alt, metaKey: !!o.meta, isComposing: !!o.composing,
  getModifierState: k => (k === 'AltGraph' ? !!o.altGr : k === 'CapsLock' ? !!o.caps : false), prevented: false, preventDefault() { this.prevented = true; } });
const run = (events) => { const sent = []; const term = { input: (d, u) => { assert.strictEqual(u, true); sent.push(d); } }; const st = { dead: false };
  const handled = events.map(e => termTypedKey(term, e, st)); return { sent: sent.join(''), handled, events }; };

test('Shift+A..Z and Caps Lock capitals are typed from keydown', () => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const r = run([...A].map(c => ev(c, { shift: true }))); assert.strictEqual(r.sent, A); assert.ok(r.events.every(e => e.prevented));
  assert.strictEqual(run([...A].map(c => ev(c, { caps: true }))).sent, A);
  assert.strictEqual(run([...'abc'].map(c => ev(c, { caps: true, shift: true }))).sent, 'abc');
});
test('UK layout symbols, space and AltGr characters', () => {
  assert.strictEqual(run([...'!"£$%^&*()_+@~#?|¬ '].map(c => ev(c, { shift: true }))).sent, '!"£$%^&*()_+@~#?|¬ ');
  assert.strictEqual(run([ev('€', { ctrl: true, alt: true, altGr: true }), ev('é', { ctrl: true, alt: true, altGr: true })]).sent, '€é');
});
test('Ctrl / Alt / Cmd combos, IME, dead keys and named keys go to xterm', () => {
  const r = run([ev('c', { ctrl: true }), ev('C', { ctrl: true, shift: true }), ev('x', { alt: true }), ev('k', { meta: true }), ev('a', { ctrl: true, alt: true, altGr: true }),
    ev('A', { keyCode: 229 }), ev('Process', { keyCode: 229 }), ev('a', { composing: true }), ev('Unidentified', { keyCode: 229 }), ev('Enter'), ev('ArrowUp'), ev('Shift'), ev('CapsLock')]);
  assert.strictEqual(r.sent, ''); assert.ok(r.handled.every(h => h === false)); assert.ok(r.events.every(e => !e.prevented));
});
test('dead key: the next key is finished by xterm, then normal typing resumes', () => {
  const r = run([ev('Dead'), ev('é'), ev('A', { shift: true })]); assert.deepStrictEqual(r.handled, [false, false, true]); assert.strictEqual(r.sent, 'A');
});
