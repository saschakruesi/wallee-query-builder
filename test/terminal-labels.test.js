const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders, plain } = require('./harness');

let X;
test.before(() => { X = loadBuilders(); });

test('spaceLabelBauen kombiniert id und name', () => {
  assert.strictEqual(X.spaceLabelBauen('83954', 'Filiale Zürich'), '83954 · Filiale Zürich');
  assert.strictEqual(X.spaceLabelBauen('83954', ''), '83954');
  assert.strictEqual(X.spaceLabelBauen('83954', null), '83954');
  assert.strictEqual(X.spaceLabelBauen('', 'Nur Name'), 'Nur Name');
  assert.strictEqual(X.spaceLabelBauen('', ''), '');
  assert.strictEqual(X.spaceLabelBauen('  83954  ', '  Zürich  '), '83954 · Zürich', 'trimmt');
});

test('terminalMatchtFilter sucht in id, label und space', () => {
  const t = { id: '33024744', label: 'Kasse 1', space: '83954 · Zürich' };
  assert.ok(X.terminalMatchtFilter(t, ''), 'leerer Filter matcht alles');
  assert.ok(X.terminalMatchtFilter(t, '   '), 'whitespace matcht alles');
  assert.ok(X.terminalMatchtFilter(t, '3302'), 'Treffer in id');
  assert.ok(X.terminalMatchtFilter(t, 'kasse'), 'case-insensitiv in label');
  assert.ok(X.terminalMatchtFilter(t, 'zürich'), 'Treffer in space');
  assert.ok(!X.terminalMatchtFilter(t, 'berlin'), 'kein Treffer');
  assert.ok(!X.terminalMatchtFilter({ id: '1' }, 'x'), 'fehlende Felder werfen nicht');
});

test('gefilterteIndices liefert die Original-Indizes der Treffer', () => {
  const list = [
    { id: '100', label: 'A', space: 'S1' },
    { id: '200', label: 'B', space: 'S2' },
    { id: '300', label: 'A2', space: 'S1' },
  ];
  assert.deepStrictEqual(plain(X.gefilterteIndices(list, 'S1')), [0, 2]);
  assert.deepStrictEqual(plain(X.gefilterteIndices(list, '')), [0, 1, 2]);
  assert.deepStrictEqual(plain(X.gefilterteIndices(list, 'zzz')), []);
});
