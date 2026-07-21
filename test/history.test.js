const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders, plain } = require('./harness');

const ST = {
  spaces: [{ id: '123', selected: true }, { id: '456', selected: false }],
  startDate: '2026-07-01', endDate: '2026-07-08',
  terminals: [{ id: 't1', selected: true }, { id: 't2', selected: true }],
  cardLast4: '7873',
};

test('modusLabel liefert die erwarteten Anzeigenamen', () => {
  const x = loadBuilders();
  assert.strictEqual(x.modusLabel('brand'), 'Brand-Auswertung');
  assert.strictEqual(x.modusLabel('terminal'), 'Terminal-Report');
  assert.strictEqual(x.modusLabel('export'), 'Transaktions-Export');
  assert.strictEqual(x.modusLabel('card'), 'Kartensuche');
  assert.strictEqual(x.modusLabel('settlement'), 'Settlement / Auszahlung');
});

test('historyEintragBauen baut Metadaten ohne SQL', () => {
  const x = loadBuilders();
  const e = plain(x.historyEintragBauen('brand', 'TOK1', ST, '2026-07-08T10:00:00.000Z'));
  assert.strictEqual(e.token, 'TOK1');
  assert.strictEqual(e.id, 'TOK1');
  assert.strictEqual(e.mode, 'brand');
  assert.strictEqual(e.submittedAt, '2026-07-08T10:00:00.000Z');
  assert.strictEqual(e.status, 'SUCCESS');
  assert.ok(!('sql' in e));
  assert.match(e.spacesSummary, /123/);
  assert.match(e.timeframeSummary, /2026-07-01/);
});

test('historyEinfuegen dedupliziert nach Token und kappt auf HISTORY_MAX', () => {
  const x = loadBuilders();
  let list = [];
  for (let i = 0; i < 55; i++) {
    list = x.historyEinfuegen(list, x.historyEintragBauen('brand', 'T' + i, ST, '2026-07-08T10:00:00.000Z'));
  }
  assert.strictEqual(list.length, x.HISTORY_MAX);
  assert.strictEqual(list[0].token, 'T54');            // neueste zuerst
  // gleicher Token erneut -> kein Duplikat, wandert nach vorne
  list = x.historyEinfuegen(list, x.historyEintragBauen('brand', 'T30', ST, '2026-07-08T10:00:00.000Z'));
  assert.strictEqual(list.filter(e => e.token === 'T30').length, 1);
  assert.strictEqual(list[0].token, 'T30');
});

test('historyFuerModus filtert', () => {
  const x = loadBuilders();
  let list = [];
  list = x.historyEinfuegen(list, x.historyEintragBauen('brand', 'A', ST, '2026-07-08T10:00:00.000Z'));
  list = x.historyEinfuegen(list, x.historyEintragBauen('card', 'B', ST, '2026-07-08T10:00:00.000Z'));
  assert.deepStrictEqual(plain(x.historyFuerModus(list, 'card')).map(e => e.token), ['B']);
});

test('historyLaden vertraegt Private Mode', () => {
  const x = loadBuilders({ blockLocalStorage: true });
  assert.deepStrictEqual(plain(x.historyLaden()), []);
  x.historySpeichern([{ id: 'X', token: 'X', mode: 'brand' }]);   // darf nicht werfen
});
