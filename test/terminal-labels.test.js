const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders, plain } = require('./harness');

let X;
test.before(() => { X = loadBuilders(); });

test('spaceLabelBauen kombiniert id und name', () => {
  assert.strictEqual(X.spaceLabelBauen('90004', 'Filiale Zürich'), '90004 · Filiale Zürich');
  assert.strictEqual(X.spaceLabelBauen('90004', ''), '90004');
  assert.strictEqual(X.spaceLabelBauen('90004', null), '90004');
  assert.strictEqual(X.spaceLabelBauen('', 'Nur Name'), 'Nur Name');
  assert.strictEqual(X.spaceLabelBauen('', ''), '');
  assert.strictEqual(X.spaceLabelBauen('  90004  ', '  Zürich  '), '90004 · Zürich', 'trimmt');
});

test('terminalGehoertZuSpace matcht ueber spaceId', () => {
  const t = { id: '111', space: '90004 · Zürich', spaceId: '90004' };
  assert.ok(X.terminalGehoertZuSpace(t, '90004'));
  assert.ok(X.terminalGehoertZuSpace(t, 90004), 'Zahl als Space-ID wird toleriert');
  assert.ok(!X.terminalGehoertZuSpace(t, '90003'), 'andere Space matcht nicht');
});

test('terminalGehoertZuSpace faellt auf den ID-Teil des Anzeige-Tags zurueck', () => {
  // Terminals, die vor der Einfuehrung von spaceId synchronisiert wurden, haben
  // nur den Anzeige-String - die sollen trotzdem zugeordnet werden.
  const alt = { id: '222', space: '90004 · Zürich' };
  assert.ok(X.terminalGehoertZuSpace(alt, '90004'), 'ID aus dem Tag-Kopf');
  assert.ok(!X.terminalGehoertZuSpace(alt, '8395'), 'kein Teiltreffer');

  const nurId = { id: '333', space: '90003' };
  assert.ok(X.terminalGehoertZuSpace(nurId, '90003'));
});

test('terminalGehoertZuSpace ist robust gegen fehlende Felder', () => {
  assert.ok(!X.terminalGehoertZuSpace({ id: '1' }, '90004'), 'ohne space/spaceId kein Treffer');
  assert.ok(!X.terminalGehoertZuSpace(null, '90004'), 'null wirft nicht');
  assert.ok(!X.terminalGehoertZuSpace({ space: '90004' }, ''), 'leere Space-ID matcht nie');
  assert.ok(!X.terminalGehoertZuSpace({ space: '90004' }, null));
});

test('setzeAuswahlFuerSpace waehlt nur die Terminals der Space an', () => {
  const terminals = [
    { id: 'A', space: '90004 · Zürich', spaceId: '90004', selected: false },
    { id: 'B', space: '90003 · Bern',   spaceId: '90003', selected: false },
    { id: 'C', selected: false },                       // ohne Space - bleibt
  ];
  const r = X.setzeAuswahlFuerSpace(terminals, '90004', true);
  assert.strictEqual(r.geaendert, 1);
  assert.deepStrictEqual(plain(r.liste).map(t => t.selected), [true, false, false],
    'nur die Zürich-Terminals werden angehakt, andere und tag-lose bleiben');
});

test('setzeAuswahlFuerSpace waehlt beim Abwaehlen nur die eigenen ab', () => {
  const terminals = [
    { id: 'A', spaceId: '90004', selected: true },
    { id: 'B', spaceId: '90003', selected: true },
  ];
  const r = X.setzeAuswahlFuerSpace(terminals, '90004', false);
  assert.strictEqual(r.geaendert, 1);
  assert.deepStrictEqual(plain(r.liste).map(t => t.selected), [false, true],
    'die andere Space bleibt ausgewaehlt');
});

test('setzeAuswahlFuerSpace zaehlt nur echte Aenderungen', () => {
  const terminals = [{ id: 'A', spaceId: '90004', selected: true }];
  const r = X.setzeAuswahlFuerSpace(terminals, '90004', true);
  assert.strictEqual(r.geaendert, 0, 'schon ausgewaehlt - keine Aenderung');
  assert.strictEqual(plain(r.liste)[0].selected, true);
});
