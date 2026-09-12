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
  assert.strictEqual(x.modusLabel('reporting'), 'Reporting');
  // Kein Bedienmodus, sondern die zweite Abfrage des Reporting-Modus
  // (Iteration 2, §3.3). Ohne Eintrag stuende der rohe Schluessel in der
  // Verlaufszeile - modusLabel gibt Unbekanntes unveraendert zurueck.
  assert.strictEqual(x.modusLabel('reporting-tds'), '3DS-Failures');
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

test('historyFuerModus zeigt die zweite Reporting-Abfrage im Reporting-Verlauf', () => {
  // 'reporting-tds' ist kein Bedienmodus - es gibt keinen Knopf, mit dem man
  // dorthin umschaltet. renderHistory filtert aber nach state.mode: ohne die
  // Zuordnung waere der Eintrag unsichtbar, obwohl er der einzige Weg zum
  // Roh-CSV der 3DS-Abfrage ist.
  const x = loadBuilders();
  let list = [];
  list = x.historyEinfuegen(list, x.historyEintragBauen('reporting', 'A', ST, '2026-07-08T10:00:00.000Z'));
  list = x.historyEinfuegen(list, x.historyEintragBauen('reporting-tds', 'B', ST, '2026-07-08T10:01:00.000Z'));
  list = x.historyEinfuegen(list, x.historyEintragBauen('brand', 'C', ST, '2026-07-08T10:02:00.000Z'));

  assert.deepStrictEqual(
    plain(x.historyFuerModus(list, 'reporting')).map(e => e.token).sort(), ['A', 'B']);
  // Nur in DIESE Richtung: der Aggregat-Eintrag gehoert nicht in einen
  // Verlauf, den niemand aufrufen kann.
  assert.deepStrictEqual(
    plain(x.historyFuerModus(list, 'reporting-tds')).map(e => e.token), ['B']);
  assert.deepStrictEqual(
    plain(x.historyFuerModus(list, 'brand')).map(e => e.token), ['C'],
    'Kein anderer Modus darf die 3DS-Zeile mit einsammeln');
});

test('historyFuerModus laesst sich nicht von Prototyp-Namen ueberrumpeln', () => {
  // Die Nebenmodi-Tabelle wird ueber den Modus-Namen nachgeschlagen. Ohne
  // hasOwnProperty kaeme fuer 'constructor' eine Funktion statt einer Liste
  // zurueck - concat legte sie dann als erlaubten Modus daneben.
  const x = loadBuilders();
  const list = [{ id: 'A', token: 'A', mode: 'brand' }];
  ['constructor', 'toString', '__proto__', 'valueOf'].forEach(name => {
    assert.doesNotThrow(() => x.historyFuerModus(list, name));
    assert.deepStrictEqual(plain(x.historyFuerModus(list, name)), []);
  });
});

test('historyLaden vertraegt Private Mode', () => {
  const x = loadBuilders({ blockLocalStorage: true });
  assert.deepStrictEqual(plain(x.historyLaden()), []);
  x.historySpeichern([{ id: 'X', token: 'X', mode: 'brand' }]);   // darf nicht werfen
});

test('historySpeichern/historyLaden Round-Trip bei funktionierendem Storage', () => {
  const x = loadBuilders();
  const liste = [
    x.historyEintragBauen('brand', 'TOK1', ST, '2026-07-08T10:00:00.000Z'),
    x.historyEintragBauen('card', 'TOK2', ST, '2026-07-08T11:00:00.000Z'),
  ];
  x.historySpeichern(liste);
  assert.deepStrictEqual(plain(x.historyLaden()), plain(liste));
  // wurde unter HISTORY_KEY abgelegt
  assert.ok(x._localStorage.getItem(x.HISTORY_KEY));
});

// --- Account im Verlaufseintrag (Task 10) -----------------------------------

test('Verlaufseintrag merkt sich den Account der Abfrage', () => {
  const { historyEintragBauen } = loadBuilders();
  const st = {
    spaces: [], start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00',
    terminals: [], settlementSuperUser: true, settlementAccountId: '99999',
  };
  const e = historyEintragBauen('settlement', 'tok-1', st, '2026-07-24T10:00:00Z', 'SUCCESS');
  assert.strictEqual(e.account, '99999');
});

test('Verlaufseintrag ohne Super-User traegt einen leeren Account', () => {
  const { historyEintragBauen } = loadBuilders();
  const st = {
    spaces: [], start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00',
    terminals: [], settlementSuperUser: false, settlementAccountId: '99999',
  };
  const e = historyEintragBauen('brand', 'tok-2', st, '2026-07-24T10:00:00Z', 'SUCCESS');
  assert.strictEqual(e.account, '');
});

// Regression v5.10: der Super-User-Account gehoert zum Settlement-Modus. Stand er
// auch an einem Terminal-/Brand-Eintrag, lief der spaetere Download-by-Token im
// falschen Account und lieferte nichts.
test('Verlaufseintrag traegt den Super-User-Account nur im Settlement-Modus', () => {
  const { historyEintragBauen } = loadBuilders();
  const st = {
    spaces: [{ id: '50161', selected: true }],
    start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00',
    terminals: [{ id: '3265', selected: true }],
    settlementSuperUser: true, settlementAccountId: '99999',
  };

  ['brand', 'terminal', 'export', 'card', 'reporting', 'reporting-tds'].forEach(mode => {
    const e = historyEintragBauen(mode, 'tok-' + mode, st, '2026-07-24T10:00:00Z', 'SUCCESS');
    assert.strictEqual(e.account, '', `Modus ${mode} darf den Settlement-Account nicht merken`);
  });

  const s = historyEintragBauen('settlement', 'tok-s', st, '2026-07-24T10:00:00Z', 'SUCCESS');
  assert.strictEqual(s.account, '99999', 'im Settlement-Modus bleibt er erhalten');
  assert.strictEqual(s.spacesSummary, 'Account 99999');
});

// --- Zusammenfassung im Settlement-Modus ist account-basiert, nicht Space/Terminal (Fix) --

test('Settlement-Eintrag mit abweichendem Account zeigt den Account, keine Space-/Terminalangabe', () => {
  const { historyEintragBauen } = loadBuilders();
  const st = {
    ...ST, settlementSuperUser: true, settlementAccountId: '99999',
  };
  const e = historyEintragBauen('settlement', 'tok-settle-1', st, '2026-07-24T10:00:00Z', 'SUCCESS');
  assert.strictEqual(e.account, '99999');
  assert.match(e.spacesSummary, /99999/);
  assert.doesNotMatch(e.spacesSummary, /123/);        // keine Space-ID aus st.spaces
  assert.doesNotMatch(e.spacesSummary, /Terminal/);
  assert.strictEqual(e.filterSummary, '');             // kein Terminal-Filter im Settlement-Modus
});

test('Settlement-Eintrag ohne abweichenden Account zeigt die Normalfall-Formulierung', () => {
  const { historyEintragBauen } = loadBuilders();
  const st = { ...ST, settlementSuperUser: false, settlementAccountId: '' };
  const e = historyEintragBauen('settlement', 'tok-settle-2', st, '2026-07-24T10:00:00Z', 'SUCCESS');
  assert.strictEqual(e.account, '');
  assert.strictEqual(e.spacesSummary, 'hinterlegter Account');
  assert.strictEqual(e.filterSummary, '');
});

test('Regression: Terminal-Modus zeigt weiterhin Space- und Terminalangabe wie bisher', () => {
  const { historyEintragBauen } = loadBuilders();
  const e = historyEintragBauen('terminal', 'tok-term-1', ST, '2026-07-08T10:00:00.000Z', 'SUCCESS');
  assert.match(e.spacesSummary, /123/);
  assert.strictEqual(e.filterSummary, '2 Terminal(s)');
});

// --- Excel-Variante am Verlaufseintrag (v5.14, Entscheid O2) ----------------

test('historyMitXlsxVariante haengt das Feld nur an den Eintrag des Tokens, rein und additiv', () => {
  const x = loadBuilders();
  const a = x.historyEintragBauen('terminal', 'TOK-A', ST, '2026-07-08T10:00:00.000Z');
  const b = x.historyEintragBauen('terminal', 'TOK-B', ST, '2026-07-08T11:00:00.000Z');
  const list = [a, b];
  const neu = x.historyMitXlsxVariante(list, 'TOK-B', 'kondensiert');
  assert.notStrictEqual(neu, list, 'neue Liste, nicht dieselbe');
  assert.strictEqual(neu[1].xlsxVariante, 'kondensiert');
  assert.strictEqual('xlsxVariante' in neu[0], false);
  assert.strictEqual(neu[0], a, 'unbeteiligter Eintrag bleibt dasselbe Objekt');
  assert.strictEqual('xlsxVariante' in b, false, 'Eingabe unveraendert');
  // Unbekannter Token: nichts passiert; Unsinn als Variante -> full
  assert.deepStrictEqual(plain(x.historyMitXlsxVariante(list, 'NOPE', 'kondensiert')), plain(list));
  assert.strictEqual(x.historyMitXlsxVariante(list, 'TOK-A', 'quatsch')[0].xlsxVariante, 'full');
  assert.deepStrictEqual(plain(x.historyMitXlsxVariante(null, 'TOK-A', 'full')), []);
});

test('historyXlsxVarianteLabel: "Excel: Kondensiert" / "Excel: Full", sonst leer', () => {
  const x = loadBuilders();
  assert.strictEqual(x.historyXlsxVarianteLabel({ xlsxVariante: 'kondensiert' }), 'Excel: Kondensiert');
  assert.strictEqual(x.historyXlsxVarianteLabel({ xlsxVariante: 'full' }), 'Excel: Full');
  assert.strictEqual(x.historyXlsxVarianteLabel({}), '');
  assert.strictEqual(x.historyXlsxVarianteLabel({ xlsxVariante: 'x' }), '');
  assert.strictEqual(x.historyXlsxVarianteLabel(null), '');
});

test('Verlaufseintrag ueberlebt den Round-Trip mit xlsxVariante', () => {
  const x = loadBuilders();
  const e = x.historyEintragBauen('terminal', 'TOK-1', ST, '2026-07-08T10:00:00.000Z');
  x.historySpeichern(x.historyMitXlsxVariante([e], 'TOK-1', 'kondensiert'));
  assert.strictEqual(x.historyLaden()[0].xlsxVariante, 'kondensiert');
});

// --- Abfragezeitraum am Verlaufseintrag und im Terminal-Report (v5.14.2) ---

test('Verlaufseintrag traegt start/end der Abfrage mit Uhrzeit (additiv)', () => {
  const x = loadBuilders();
  const e = plain(x.historyEintragBauen('terminal', 'TOK', Object.assign({ startTime: '00:00:00', endTime: '00:00:00' }, ST), '2026-07-08T10:00:00.000Z'));
  assert.strictEqual(e.start, '2026-07-01 00:00:00');
  assert.strictEqual(e.end, '2026-07-08 00:00:00');
  assert.strictEqual(e.timeframeSummary, '2026-07-01 → 2026-07-08');
});

test('reportZeitraumErmitteln: Filter des Laufs vor Verlaufseintrag vor Tages-Zusammenfassung vor nichts', () => {
  const x = loadBuilders();
  const filter = { start: '2026-07-01 00:00:00', end: '2026-08-01 00:00:00', spaceIds: [1] };
  const eintrag = { token: 'T', start: '2026-06-01 00:00:00', end: '2026-07-01 00:00:00', timeframeSummary: '2026-06-01 → 2026-06-30' };
  assert.deepStrictEqual(plain(x.reportZeitraumErmitteln(filter, eintrag)), { start: filter.start, end: filter.end });
  assert.deepStrictEqual(plain(x.reportZeitraumErmitteln(null, eintrag)), { start: eintrag.start, end: eintrag.end });
  assert.strictEqual(x.reportZeitraumErmitteln(null, { timeframeSummary: '2026-06-01 → 2026-06-30' }), '2026-06-01 → 2026-06-30');
  assert.strictEqual(x.reportZeitraumErmitteln(null, null), null);
  assert.strictEqual(x.reportZeitraumErmitteln({ start: '', end: '' }, undefined), null, 'ein leerer Picker ist kein Zeitraum');
  // Formatiert wie im Reporting-Report: Ende 00:00:00 exklusiv
  assert.strictEqual(x.reportingZeitraumText(x.reportZeitraumErmitteln(filter)), '01.07.2026 – 31.07.2026');
  assert.strictEqual(x.reportingZeitraumText(null), '');
});
