const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders } = require('./harness');

const B = loadBuilders();

const RANGE = {
  spaceIds: [12345],
  start: '2026-07-01 00:00:00',
  end:   '2026-07-02 00:00:00',
};

test('Harness laedt die Builder', () => {
  assert.strictEqual(typeof B.buildBrandQuery, 'function');
  assert.strictEqual(typeof B.buildExportQuery, 'function');
  assert.ok(Array.isArray(B.EXPORT_COLUMNS));
});

test('Brand-Query: korrektes Zeitfenster, keine 23:59:59-Falle', () => {
  const sql = B.buildBrandQuery(RANGE);
  assert.match(sql, /t\.completedon >= TIMESTAMP '2026-07-01 00:00:00'/);
  assert.match(sql, /t\.completedon <  TIMESTAMP '2026-07-02 00:00:00'/);
  assert.doesNotMatch(sql, /<= TIMESTAMP/);
});

test('Standard-Spaltenauswahl kommt ohne Withdrawal-Join aus', () => {
  const cols = B.defaultColumns();
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.doesNotMatch(sql, /JOIN\s+currentaccountwithdrawal/);
});

test('txCte grenzt auf Space, Zeitraum und Status ein', () => {
  const sql = B.txCte(RANGE);
  assert.match(sql, /^tx AS \(/);
  assert.match(sql, /SELECT t\.id/);
  assert.match(sql, /t\.spaceid = 12345/);
  assert.match(sql, /t\.completedon >= TIMESTAMP '2026-07-01 00:00:00'/);
  assert.match(sql, /t\.completedon <  TIMESTAMP '2026-07-02 00:00:00'/);
  assert.match(sql, /t\.state IN \('FULFILL', 'COMPLETED'\)/);
});

test('txCte mit mehreren Spaces nutzt IN', () => {
  const sql = B.txCte({ ...RANGE, spaceIds: [12345, 12346] });
  assert.match(sql, /t\.spaceid IN \(12345, 12346\)/);
});

test('card-CTE ist auf die Transaktionen des Reports eingegrenzt', () => {
  const cols = { ...B.defaultColumns(), maskedcard: true };
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.match(sql, /card AS \(/);
  assert.match(sql, /c\.transaction_id IN \(SELECT id FROM tx\)/);
  assert.match(sql, /^WITH tx AS \(/m);
});

test('ohne Join-Spalten entsteht gar kein WITH', () => {
  const cols = {}; // nur Basisspalten
  B.EXPORT_COLUMNS.forEach(c => { cols[c.key] = false; });
  cols.spaceid = true; cols.gross = true;
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.doesNotMatch(sql, /WITH /);
  assert.doesNotMatch(sql, /chargeattempt/);
});

const ALL_ON = () => {
  const c = {};
  B.EXPORT_COLUMNS.forEach(x => { c[x.key] = true; });
  return c;
};

test('Settlement-Spalten ohne Referenz: kein Withdrawal-Join', () => {
  const cols = ALL_ON();
  cols.payoutref = false;
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.match(sql, /settle AS \(/);
  assert.doesNotMatch(sql, /JOIN\s+currentaccountwithdrawal/);
  assert.doesNotMatch(sql, /ROW_NUMBER\(\)/);
});

test('Auszahlungsreferenz zieht ein auszahlungen-CTE nach, das auf den eigenen Account eingeschraenkt ist', () => {
  // Ohne diese Einschraenkung enthaelt currentaccountwithdrawal die Auszahlungen
  // der gesamten Plattform, nicht nur die des eigenen Haendlers - siehe
  // sql/settlement_verifikation.sql, Query 7 und 9, sowie den Kommentar im
  // payoutref-CTE selbst.
  const cols = ALL_ON();
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.match(sql, /auszahlungen AS \(/);
  assert.match(sql, /JOIN\s+spacereference\s+sr/);
  assert.match(sql, /sr\.accountid\s*=\s*w\.accountid/);
  assert.match(sql, /sr\.spaceid = 12345/);
  assert.doesNotMatch(sql, /ROW_NUMBER\(\)/);
});

test('payoutref joint gegen auszahlungen, nicht direkt gegen currentaccountwithdrawal', () => {
  const cols = ALL_ON();
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  const cteMatch = sql.match(/payoutref AS \(([\s\S]*?)\n\)/);
  assert.ok(cteMatch, 'payoutref-CTE nicht gefunden');
  const cte = cteMatch[1];

  // currentaccountwithdrawal wird nur noch im auszahlungen-CTE abgefragt,
  // nicht mehr direkt im payoutref-CTE (der Kommentar dort darf die Tabelle
  // weiterhin in Prosa erwaehnen, deshalb der Check auf FROM/JOIN statt auf
  // das blosse Wort).
  assert.doesNotMatch(cte, /(FROM|JOIN)\s+currentaccountwithdrawal/);
  assert.match(cte, /JOIN auszahlungen a/);
  assert.match(cte, /a\.createdon >= bt\.valuedate/);
  assert.match(cte, /a\.createdon\s*<\s*bt\.valuedate \+ INTERVAL '10' DAY/);
  assert.match(cte, /min_by\(a\.internalreference, a\.createdon\)/);
  // Die psr/bt-Seite des Range-Joins bleibt ueber tx eingegrenzt.
  assert.match(sql, /psr\.transaction_id IN \(SELECT id FROM tx\)/);
});

test('payoutref-Fenster steht auf zehn Tagen, nicht mehr auf dreissig', () => {
  const cols = ALL_ON();
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.match(sql, /INTERVAL '10' DAY/);
  assert.doesNotMatch(sql, /INTERVAL '30' DAY/);
});

test('auszahlungen-CTE: absolutes Fenster kombiniert Berichtszeitraum mit den zehn Tagen Puffer', () => {
  // Analog zur frueheren Begruendung im payoutref-CTE: ohne ein konstantes
  // Praedikat auf w.createdon kann der Optimizer currentaccountwithdrawal
  // nicht per Partition beschneiden. Das absolute Fenster lebt jetzt hier,
  // im vorgelagerten auszahlungen-CTE.
  const cols = ALL_ON();
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  const cteMatch = sql.match(/auszahlungen AS \(([\s\S]*?)\n\)/);
  assert.ok(cteMatch, 'auszahlungen-CTE nicht gefunden');
  const cte = cteMatch[1];
  assert.match(cte, /w\.createdon >= TIMESTAMP '2026-07-01 00:00:00'/);
  assert.match(cte, /w\.createdon\s*<\s*TIMESTAMP '2026-07-02 00:00:00' \+ INTERVAL '10' DAY/);
});

test('ohne Auszahlungsreferenz: weder auszahlungen noch spacereference noch currentaccountwithdrawal im SQL', () => {
  const cols = ALL_ON();
  cols.payoutref = false;
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.doesNotMatch(sql, /auszahlungen AS \(/);
  assert.doesNotMatch(sql, /spacereference/);
  // Bare-Word-Check waere hier falsch-positiv: der settle-CTE-Kommentar
  // erwaehnt "currentaccountwithdrawal" als Prosa-Referenz auf das
  // payoutref-CTE, auch wenn payoutref selbst nicht gewaehlt ist (siehe
  // die aehnliche Einschraenkung in den Tests weiter oben). Massgeblich ist,
  // dass die Tabelle nicht tatsaechlich abgefragt wird.
  assert.doesNotMatch(sql, /(FROM|JOIN)\s+currentaccountwithdrawal/);
});

test('Mehr-Space-Fall: auszahlungen-CTE nutzt sr.spaceid IN (...)', () => {
  const cols = ALL_ON();
  const sql = B.buildExportQuery({ ...RANGE, spaceIds: [12345, 12346], terminalIds: [], cols });
  const cteMatch = sql.match(/auszahlungen AS \(([\s\S]*?)\n\)/);
  assert.ok(cteMatch, 'auszahlungen-CTE nicht gefunden');
  assert.match(cteMatch[1], /sr\.spaceid IN \(12345, 12346\)/);
});

test('settle-CTE filtert bt.state nicht in der WHERE-Klausel (UPCOMING bleibt sichtbar)', () => {
  // bt.state darf in der Aggregat-Logik (CASE/count_if) vorkommen, aber die
  // WHERE-Klausel des CTE darf keine Zeilen anhand von bt.state ausschliessen.
  const cols = ALL_ON();
  cols.payoutref = false;
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  const cteMatch = sql.match(/settle AS \(([\s\S]*?)\n\)/);
  assert.ok(cteMatch, 'settle-CTE nicht gefunden');
  const whereMatch = cteMatch[1].match(/WHERE[\s\S]*?(?=\n\s*GROUP BY)/);
  assert.ok(whereMatch, 'WHERE-Klausel im CTE nicht gefunden');
  assert.doesNotMatch(whereMatch[0], /bt\.state/);
});

test('Export-settle-CTE: settlement_state nutzt dieselbe PARTIAL-Logik wie settle_tx (kein max_by)', () => {
  // Derselbe Fehler wie im Settlement-Modus: max_by(bt.state, bt.valuedate)
  // ignoriert Zeilen mit NULL-valuedate, wodurch eine offene Teil-Auszahlung
  // als SETTLED erscheinen wuerde. Der Export-CTE muss dieselbe PARTIAL-Logik
  // wie settle_tx in buildSettlementQuery verwenden.
  const cols = ALL_ON();
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.doesNotMatch(sql, /max_by\(bt\.state/);
  assert.match(sql, /'PARTIAL'/);
  assert.match(sql, /count_if\(bt\.state = 'SETTLED'\)\s*>\s*0/);
  assert.match(sql, /count_if\(bt\.state <> 'SETTLED'\)\s*>\s*0/);
});

test('Export-settle-CTE: settlement_state wird NICHT auf NO_RECORD gezogen (bleibt Aggregat-Logik des Settlement-Modus)', () => {
  // Im Export ist settle.settlement_state fuer Transaktionen ohne
  // Settlement-Record schlicht NULL (leere CSV-Zelle) - die
  // COALESCE(..., 'NO_RECORD')-Logik gehoert nur zum Settlement-Modus.
  const cols = ALL_ON();
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.doesNotMatch(sql, /NO_RECORD/);
});

test('Brand-Query ohne unmatched_anzahl', () => {
  const sql = B.buildBrandQuery(RANGE);
  assert.doesNotMatch(sql, /unmatched_anzahl/);
  assert.doesNotMatch(sql, /CASE WHEN t\.totalappliedfees/);
});

test('Brand-Query: Fee-Spalte ohne COALESCE, Netto mit', () => {
  const sql = B.buildBrandQuery(RANGE);
  assert.match(sql, /SUM\(t\.totalappliedfees\)\s+AS transaction_fee_total/);
  assert.match(sql, /SUM\(t\.completedamount\) - COALESCE\(SUM\(t\.totalappliedfees\), 0\) AS netto/);
});

test('Brand-Fallback bleibt erhalten', () => {
  const sql = B.buildBrandQuery(RANGE);
  assert.match(sql, /COALESCE\(pc\.name\['en-US'\], pcc\.name, 'UNKNOWN'\)/);
});

// Der Fallback COALESCE(pc.name['en-US'], pcc.name, 'UNKNOWN') steht sowohl in der
// SELECT-Liste als auch im GROUP BY. Ein blosses Vorkommen im gesamten SQL-String
// (wie im Test oben) wuerde eine Mutation, die NUR den GROUP-BY-Teil auf pcc.name
// zurueckstutzt, nicht erkennen - die SELECT-Liste haette den Fallback ja noch.
// Deshalb hier gezielt der Abschnitt ab "GROUP BY" (schneidet die SELECT-Liste weg).
function groupBySection(sql) {
  const idx = sql.indexOf('GROUP BY');
  assert.ok(idx !== -1, 'kein GROUP BY im SQL gefunden');
  return sql.slice(idx);
}

test('Brand- und Terminal-Fallback bleibt auch im GROUP BY erhalten', () => {
  const brandSql = B.buildBrandQuery(RANGE);
  const terminalSql = B.buildTerminalQuery({ ...RANGE, terminalIds: ['T-001'] });
  assert.match(
    groupBySection(brandSql),
    /COALESCE\(pc\.name\['en-US'\], pcc\.name, 'UNKNOWN'\)/,
  );
  assert.match(
    groupBySection(terminalSql),
    /COALESCE\(pc\.name\['en-US'\], pcc\.name, 'UNKNOWN'\)/,
  );
});

test('Terminal-Query ebenso bereinigt', () => {
  const sql = B.buildTerminalQuery({ ...RANGE, terminalIds: ['T-001'] });
  assert.doesNotMatch(sql, /unmatched_anzahl/);
  assert.match(sql, /pt\.identifier = 'T-001'/);
  // Wie bei der Brand-Query: kein unmatched-CASE mehr, Fee-Spalte ohne COALESCE,
  // Netto-Arithmetik weiterhin mit COALESCE (sonst leere Netto-Spalte bei Brands
  // ohne Gebuehrendaten).
  assert.doesNotMatch(sql, /CASE WHEN t\.totalappliedfees/);
  assert.match(sql, /SUM\(t\.totalappliedfees\)\s+AS transaction_fee_total/);
  assert.match(sql, /SUM\(t\.completedamount\) - COALESCE\(SUM\(t\.totalappliedfees\), 0\) AS netto/);
});

test('Export kennt keinen Kartenfilter mehr', () => {
  const cols = ALL_ON();
  // Bewusst card: '1234' uebergeben — der Test wird rot, falls jemand
  // den Kartenfilter-Parameter wieder einführt.
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols, card: '1234' });
  assert.doesNotMatch(sql, /masked_card LIKE/);
});

test('Export ohne Kartenspalten bindet charge/chargeattempt nicht ein', () => {
  const cols = B.defaultColumns();
  cols.maskedcard = false; cols.authcode = false; cols.payoutref = false;
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.doesNotMatch(sql, /chargeattempt/);
});

test('Kartensuche filtert auf die letzten 4 Ziffern', () => {
  const sql = B.buildCardQuery({ ...RANGE, terminalIds: [], last4: '7873' });
  assert.match(sql, /card\.masked_card LIKE '%7873'/);
  assert.match(sql, /card AS \(/);
  assert.match(sql, /^WITH tx AS \(/m);
  assert.match(sql, /ORDER BY t\.completedon DESC/);
});

test('Kartensuche liefert das feste Spaltenset', () => {
  const sql = B.buildCardQuery({ ...RANGE, terminalIds: [], last4: '7873' });
  ['space_id','completedon','terminal_identifier','terminal_name','gross_amount',
   'waehrung','brand','masked_card','auth_code','transaction_id','state']
    .forEach(a => assert.match(sql, new RegExp('AS ' + a + '\\b')));
});

test('Kartensuche ohne Ziffern laeuft leer statt alles zu exportieren', () => {
  const sql = B.buildCardQuery({ ...RANGE, terminalIds: [], last4: '' });
  assert.match(sql, /1 = 0/);
  assert.match(sql, /BITTE DIE LETZTEN 4 ZIFFERN EINGEBEN/);
});

test('Kartensuche verwirft Nicht-Ziffern', () => {
  const sql = B.buildCardQuery({ ...RANGE, terminalIds: [], last4: "78'; DROP--" });
  assert.match(sql, /LIKE '%78'/);
  assert.doesNotMatch(sql, /DROP/);
});

test('Kartensuche mit Terminal-Filter', () => {
  const sql = B.buildCardQuery({ ...RANGE, terminalIds: ['T-1','T-2'], last4: '7873' });
  assert.match(sql, /pt\.identifier IN \('T-1', 'T-2'\)/);
});

test('Settlement-Query aggregiert pro Transaktion vor und joint per LEFT JOIN', () => {
  const sql = B.buildSettlementQuery({ ...RANGE, terminalIds: [], byTerminal: false });
  assert.match(sql, /settle_tx AS \(/);
  assert.match(sql, /GROUP BY psr\.transaction_id/);
  // Der Join auf transaction erfolgt gegen das aggregierte CTE, nicht direkt,
  // und ist ein LEFT JOIN, damit Transaktionen ohne Settlement-Record sichtbar
  // bleiben (Korrektur 2):
  assert.match(sql, /LEFT JOIN settle_tx s ON s\.transaction_id = t\.id/);
  assert.doesNotMatch(sql, /JOIN payfacsettlementrecord psr\s+ON psr\.transaction_id = t\.id/);
});

test('Settlement-Query gruppiert tagesweise und nach bt.state', () => {
  const sql = B.buildSettlementQuery({ ...RANGE, terminalIds: [], byTerminal: false });
  assert.match(sql, /date\(t\.completedon\)\s+AS tag/);
  assert.match(sql, /AS settlement_state/);
  assert.doesNotMatch(sql, /date_format/);
});

test('Settlement-Query liefert die Diagnose-Spalte', () => {
  const sql = B.buildSettlementQuery({ ...RANGE, terminalIds: [], byTerminal: false });
  assert.match(sql, /AS anzahl_transaktionen/);
  assert.match(sql, /AS anzahl_settlement_records/);
});

test('Settlement-Query kennt die echten Settlement-Betraege', () => {
  const sql = B.buildSettlementQuery({ ...RANGE, terminalIds: [], byTerminal: false });
  assert.match(sql, /sum\(bt\.valueamount\)/);
  assert.match(sql, /sum\(bt\.postingamount - bt\.valueamount\)/);
  assert.match(sql, /sum\(bt\.postingamount\)/);
});

test('Settlement-Query filtert bt.state nicht in der WHERE-Klausel (UPCOMING bleibt sichtbar)', () => {
  // bt.state darf in der Aggregat-Logik (CASE/count_if) vorkommen, aber die
  // WHERE-Klausel des CTE darf keine Zeilen anhand von bt.state ausschliessen.
  const sql = B.buildSettlementQuery({ ...RANGE, terminalIds: [], byTerminal: false });
  const cteMatch = sql.match(/settle_tx AS \(([\s\S]*?)\n\)\n/);
  assert.ok(cteMatch, 'settle_tx-CTE nicht gefunden');
  const whereMatch = cteMatch[1].match(/WHERE[\s\S]*?(?=\n\s*GROUP BY)/);
  assert.ok(whereMatch, 'WHERE-Klausel im CTE nicht gefunden');
  assert.doesNotMatch(whereMatch[0], /bt\.state/);
});

test('Settlement-Query: settlement_state ist PARTIAL bei gemischtem Zustand, unabhaengig von valuedate', () => {
  const sql = B.buildSettlementQuery({ ...RANGE, terminalIds: [], byTerminal: false });
  assert.doesNotMatch(sql, /max_by\(bt\.state/);
  assert.match(sql, /'PARTIAL'/);
  assert.match(sql, /count_if\(bt\.state = 'SETTLED'\)\s*>\s*0/);
  assert.match(sql, /count_if\(bt\.state <> 'SETTLED'\)\s*>\s*0/);
});

test('Settlement-Query: Transaktionen ohne Settlement-Record bleiben sichtbar (NO_RECORD)', () => {
  const sql = B.buildSettlementQuery({ ...RANGE, terminalIds: [], byTerminal: false });
  assert.match(sql, /'NO_RECORD'/);
  assert.match(sql, /COALESCE\(s\.settlement_state, 'NO_RECORD'\)/);
});

test('Settlement-Query: COALESCE-Ausdruck fuer settlement_state ist in SELECT und GROUP BY identisch', () => {
  const sql = B.buildSettlementQuery({ ...RANGE, terminalIds: [], byTerminal: false });
  const occurrences = sql.match(/COALESCE\(s\.settlement_state, 'NO_RECORD'\)/g);
  assert.ok(occurrences && occurrences.length >= 2, 'COALESCE-Ausdruck muss in SELECT und GROUP BY vorkommen');
  const groupBy = sql.match(/GROUP BY[\s\S]*?(?=\nORDER BY)/)[0];
  assert.match(groupBy, /COALESCE\(s\.settlement_state, 'NO_RECORD'\)/);
});

test('Settlement-Query: anzahl_settlement_records zeigt 0 statt NULL ohne Records', () => {
  const sql = B.buildSettlementQuery({ ...RANGE, terminalIds: [], byTerminal: false });
  assert.match(sql, /COALESCE\(SUM\(s\.settlement_records\), 0\)\s+AS anzahl_settlement_records/);
});

test('Settlement-Query: blosser Terminal-Filter ohne byTerminal aggregiert weiterhin (Korrektur 3)', () => {
  const sql = B.buildSettlementQuery({ ...RANGE, terminalIds: ['T-1', 'T-2'], byTerminal: false });
  assert.doesNotMatch(sql, /AS terminal_identifier/);
  assert.doesNotMatch(sql, /,\n\s*pt\.identifier\s*\n/);
  // Der Join muss trotzdem da sein, weil die WHERE-Klausel pt.identifier braucht:
  assert.match(sql, /LEFT JOIN paymentterminal pt/);
  assert.match(sql, /pt\.identifier IN \('T-1', 'T-2'\)/);
});

test('Settlement-Query optional nach Terminal aufgeschluesselt', () => {
  const off = B.buildSettlementQuery({ ...RANGE, terminalIds: [], byTerminal: false });
  assert.doesNotMatch(off, /AS terminal_identifier/);
  const on = B.buildSettlementQuery({ ...RANGE, terminalIds: [], byTerminal: true });
  assert.match(on, /AS terminal_identifier/);
  assert.match(on, /paymentterminal pt/);
  assert.match(on, /,\n\s*pt\.identifier/);
});

// --- State-Migration (v4 -> v5) --------------------------------------------
// loadState() laeuft beim Init des Scripts genau einmal. Um verschiedene
// localStorage-Ausgangslagen zu pruefen, wird pro Fall eine frische Sandbox via
// loadBuilders({ seedLocalStorage }) erzeugt und der resultierende State per
// getState() (siehe harness.js) ausgelesen.

test('Migration: alter Schluessel vorhanden, neuer nicht - Spaces/Terminals/Presets bleiben erhalten', () => {
  const oldState = {
    mode: 'terminal',
    spaces: [
      { id: '12345', label: 'Erst-Space', selected: true },
      { id: '99999', label: 'Zweit-Space', selected: false },
    ],
    terminals: [{ id: 'T-1', label: 'Kasse 1', selected: true }],
    userPresets: [{ name: 'Mein Preset', startDate: '2026-01-01' }],
  };
  const b = loadBuilders({ seedLocalStorage: { [B.STORAGE_KEY_OLD]: JSON.stringify(oldState) } });
  const state = b.getState();
  // state stammt aus einer eigenen vm-Sandbox (anderer Realm als dieses Testfile),
  // daher ueber JSON statt deepStrictEqual vergleichen - sonst schlaegt der
  // Prototyp-Vergleich trotz identischem Inhalt fehl.
  assert.strictEqual(JSON.stringify(state.spaces), JSON.stringify(oldState.spaces));
  assert.strictEqual(JSON.stringify(state.terminals), JSON.stringify(oldState.terminals));
  assert.strictEqual(JSON.stringify(state.userPresets), JSON.stringify(oldState.userPresets));
  assert.strictEqual(state.mode, 'terminal');
});

test('Migration: cardSearch wandert zu cardLast4, nicht-numerische Zeichen werden entfernt', () => {
  const b1 = loadBuilders({ seedLocalStorage: { [B.STORAGE_KEY_OLD]: JSON.stringify({ cardSearch: '78731' }) } });
  const state1 = b1.getState();
  assert.strictEqual(state1.cardLast4, '7873');
  assert.strictEqual('cardSearch' in state1, false);

  const b2 = loadBuilders({ seedLocalStorage: { [B.STORAGE_KEY_OLD]: JSON.stringify({ cardSearch: 'ab-12cd' }) } });
  assert.strictEqual(b2.getState().cardLast4, '12');
});

test('Migration: exportColumns.payoutref wird beim Umzug auf v5 zwingend deaktiviert', () => {
  const cols = B.defaultColumns();
  cols.payoutref = true; // im alten Schluessel war die Spalte aktiv
  const b = loadBuilders({ seedLocalStorage: { [B.STORAGE_KEY_OLD]: JSON.stringify({ exportColumns: cols }) } });
  assert.strictEqual(b.getState().exportColumns.payoutref, false);
});

test('Kein Migrationsfall: payoutref aus einem bereits vorhandenen v5-Schluessel bleibt unangetastet', () => {
  const cols = B.defaultColumns();
  cols.payoutref = true; // Nutzer hat die Spalte im neuen Schluessel bewusst wieder eingeschaltet
  const b = loadBuilders({ seedLocalStorage: { [B.STORAGE_KEY]: JSON.stringify({ exportColumns: cols }) } });
  assert.strictEqual(b.getState().exportColumns.payoutref, true);
});

test('Migration: unbekannter Modus faellt auf brand zurueck, ein gueltiger Modus bleibt erhalten', () => {
  const b1 = loadBuilders({ seedLocalStorage: { [B.STORAGE_KEY_OLD]: JSON.stringify({ mode: 'quatsch' }) } });
  assert.strictEqual(b1.getState().mode, 'brand');

  const b2 = loadBuilders({ seedLocalStorage: { [B.STORAGE_KEY_OLD]: JSON.stringify({ mode: 'settlement' }) } });
  assert.strictEqual(b2.getState().mode, 'settlement');
});

test('Beide Schluessel leer: Defaults greifen, keine Exception', () => {
  const b = loadBuilders();
  const state = b.getState();
  assert.strictEqual(state.mode, 'brand');
  // Kein leerer Platzhalter-Space mehr vorgewaehlt: frischer Start hat eine
  // leere Space-Liste (renderSpaces zeigt dann den Hinweis zum Hinzufuegen).
  assert.ok(Array.isArray(state.spaces));
  assert.strictEqual(state.spaces.length, 0);
  assert.strictEqual(state.cardLast4, '');
  assert.strictEqual(state.settlementByTerminal, false);
});

test('Migration persistiert das Ergebnis sofort unter dem neuen Schluessel, der alte bleibt unangetastet', () => {
  const oldRaw = JSON.stringify({ mode: 'export', cardSearch: '7873' });
  const b = loadBuilders({ seedLocalStorage: { [B.STORAGE_KEY_OLD]: oldRaw } });
  const newRaw = b._localStorage.getItem(B.STORAGE_KEY);
  assert.ok(newRaw, 'nach der Migration sollte der neue Schluessel befuellt sein');
  assert.strictEqual(JSON.parse(newRaw).cardLast4, '7873');
  assert.strictEqual(b._localStorage.getItem(B.STORAGE_KEY_OLD), oldRaw, 'alter Schluessel bleibt unveraendert stehen');
});

test('v5-Schluessel vorhanden: keine Migration, alter Schluessel wird ignoriert', () => {
  const b = loadBuilders({
    seedLocalStorage: {
      [B.STORAGE_KEY]: JSON.stringify({ mode: 'card', cardLast4: '1111' }),
      [B.STORAGE_KEY_OLD]: JSON.stringify({ mode: 'brand', cardSearch: '9999' }),
    },
  });
  const state = b.getState();
  assert.strictEqual(state.mode, 'card');
  assert.strictEqual(state.cardLast4, '1111');
});
