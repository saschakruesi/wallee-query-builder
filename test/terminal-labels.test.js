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

test('terminalGehoertZuSpace matcht ueber spaceId', () => {
  const t = { id: '111', space: '83954 · Zürich', spaceId: '83954' };
  assert.ok(X.terminalGehoertZuSpace(t, '83954'));
  assert.ok(X.terminalGehoertZuSpace(t, 83954), 'Zahl als Space-ID wird toleriert');
  assert.ok(!X.terminalGehoertZuSpace(t, '73192'), 'andere Space matcht nicht');
});

test('terminalGehoertZuSpace faellt auf den ID-Teil des Anzeige-Tags zurueck', () => {
  // Terminals, die vor der Einfuehrung von spaceId synchronisiert wurden, haben
  // nur den Anzeige-String - die sollen trotzdem zugeordnet werden.
  const alt = { id: '222', space: '83954 · Zürich' };
  assert.ok(X.terminalGehoertZuSpace(alt, '83954'), 'ID aus dem Tag-Kopf');
  assert.ok(!X.terminalGehoertZuSpace(alt, '8395'), 'kein Teiltreffer');

  const nurId = { id: '333', space: '73192' };
  assert.ok(X.terminalGehoertZuSpace(nurId, '73192'));
});

test('terminalGehoertZuSpace ist robust gegen fehlende Felder', () => {
  assert.ok(!X.terminalGehoertZuSpace({ id: '1' }, '83954'), 'ohne space/spaceId kein Treffer');
  assert.ok(!X.terminalGehoertZuSpace(null, '83954'), 'null wirft nicht');
  assert.ok(!X.terminalGehoertZuSpace({ space: '83954' }, ''), 'leere Space-ID matcht nie');
  assert.ok(!X.terminalGehoertZuSpace({ space: '83954' }, null));
});

test('setzeAuswahlFuerSpace waehlt nur die Terminals der Space an', () => {
  const terminals = [
    { id: 'A', space: '83954 · Zürich', spaceId: '83954', selected: false },
    { id: 'B', space: '73192 · Bern',   spaceId: '73192', selected: false },
    { id: 'C', selected: false },                       // ohne Space - bleibt
  ];
  const r = X.setzeAuswahlFuerSpace(terminals, '83954', true);
  assert.strictEqual(r.geaendert, 1);
  assert.deepStrictEqual(plain(r.liste).map(t => t.selected), [true, false, false],
    'nur die Zürich-Terminals werden angehakt, andere und tag-lose bleiben');
});

test('setzeAuswahlFuerSpace waehlt beim Abwaehlen nur die eigenen ab', () => {
  const terminals = [
    { id: 'A', spaceId: '83954', selected: true },
    { id: 'B', spaceId: '73192', selected: true },
  ];
  const r = X.setzeAuswahlFuerSpace(terminals, '83954', false);
  assert.strictEqual(r.geaendert, 1);
  assert.deepStrictEqual(plain(r.liste).map(t => t.selected), [false, true],
    'die andere Space bleibt ausgewaehlt');
});

test('setzeAuswahlFuerSpace zaehlt nur echte Aenderungen', () => {
  const terminals = [{ id: 'A', spaceId: '83954', selected: true }];
  const r = X.setzeAuswahlFuerSpace(terminals, '83954', true);
  assert.strictEqual(r.geaendert, 0, 'schon ausgewaehlt - keine Aenderung');
  assert.strictEqual(plain(r.liste)[0].selected, true);
});
