// Tests fuer Erweiterung 1 (Trinkgeld / TIP) und Erweiterung 2 (unsettled_anzahl).
// Siehe CLAUDE.md fuer den fachlichen Hintergrund. Testkommando:
// node --test "test/*.test.js"

const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders } = require('./harness');

const B = loadBuilders();

const RANGE = {
  spaceIds: [12345],
  start: '2026-07-01 00:00:00',
  end:   '2026-07-02 00:00:00',
};

const ALL_ON = () => {
  const c = {};
  B.EXPORT_COLUMNS.forEach(x => { c[x.key] = true; });
  return c;
};
const NONE_ON = () => {
  const c = {};
  B.EXPORT_COLUMNS.forEach(x => { c[x.key] = false; });
  return c;
};

// Extrahiert den Rumpf des tip-CTE ("tip AS ( ... )") aus generiertem SQL.
// Die schliessende Klammer eines CTE steht im Codestil dieses Projekts immer
// allein auf ihrer eigenen Zeile (siehe tipCte() in wallee_query_builder.html),
// daher greift ein nicht-gieriges Match bis zum ersten "\n)" zuverlaessig den
// vollstaendigen CTE-Rumpf ab - unabhaengig davon, in welchem Modus/Query das
// tip-CTE eingebettet ist.
function tipCteBody(sql) {
  const m = sql.match(/tip AS \(([\s\S]*?)\n\)/);
  assert.ok(m, 'tip-CTE (tip AS (...)) nicht im generierten SQL gefunden');
  return m[1];
}

// Prueft, dass das tip-Konstrukt im generierten SQL vor-aggregiert ist
// (GROUP BY tl.transaction_id INNERHALB des CTE-Rumpfs). Fehlt die
// Vor-Aggregation, vervielfacht der anschliessende LEFT JOIN tip die Zeilen
// der Aussenquery und zerstoert COUNT(*)/SUM(t.completedamount)/Gebuehrensummen
// still - das ist der Fehler, den dieser Helper in allen vier Modi mit
// Trinkgeld (brand/terminal/export/settlement) nachweisen soll.
function assertTipPreAggregated(sql) {
  const body = tipCteBody(sql);
  assert.match(body, /transaction_lineitem/, 'transaction_lineitem fehlt im tip-CTE-Rumpf');
  assert.match(
    body,
    /GROUP BY tl\.transaction_id/,
    'tip-CTE ist nicht pro Transaktion vor-aggregiert (GROUP BY tl.transaction_id fehlt) - ' +
    'der LEFT JOIN auf tip wuerde Zeilen vervielfachen'
  );
}

// --- tipCte direkt ---------------------------------------------------------

test('tipCte: aggregiert Trinkgeld pro Transaktion, eingegrenzt ueber tx', () => {
  const sql = B.tipCte({ spaceIds: [12345] });
  assert.match(sql, /^tip AS \(/);
  assert.match(sql, /transaction_lineitem tl/);
  assert.match(sql, /JOIN lineitem li/);
  assert.match(sql, /li\.spaceid = tl\.spaceid/);
  assert.match(sql, /li\.type = 'TIP'/);
  assert.match(sql, /tl\.transaction_id IN \(SELECT id FROM tx\)/);
  assert.match(sql, /GROUP BY tl\.transaction_id/);
  assert.match(sql, /SUM\(li\.amountincludingtax\) AS tip_amount/);
});

// --- Export: tip-Spalten ----------------------------------------------------

test('Export mit tip an: tx- und tip-CTE vorhanden, LEFT JOIN tip, ueber tx eingegrenzt', () => {
  const cols = NONE_ON();
  cols.tip = true;
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.match(sql, /^WITH tx AS \(/m);
  assert.match(sql, /tip AS \(/);
  assert.match(sql, /LEFT JOIN tip\s+ON tip\.transaction_id\s+=\s+t\.id/);
  assert.match(sql, /tl\.transaction_id IN \(SELECT id FROM tx\)/);
  assert.match(sql, /COALESCE\(tip\.tip_amount, 0\)\s+AS tip_amount/);
  assertTipPreAggregated(sql);
});

test('Export mit grossnotip an: braucht ebenfalls das tip-CTE', () => {
  const cols = NONE_ON();
  cols.grossnotip = true;
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.match(sql, /tip AS \(/);
  assert.match(sql, /t\.completedamount - COALESCE\(tip\.tip_amount, 0\)\s+AS gross_excl_tip/);
});

test('Export mit tip aus: kein tip-CTE, kein Join, kein transaction_lineitem im SQL', () => {
  const cols = B.defaultColumns(); // tip/grossnotip sind def:false
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.doesNotMatch(sql, /tip AS \(/);
  assert.doesNotMatch(sql, /LEFT JOIN tip/);
  assert.doesNotMatch(sql, /transaction_lineitem/);
});

test('Export: tip allein erzwingt das tx-CTE', () => {
  // Gegenprobe zum bestehenden Test "ohne Join-Spalten entsteht gar kein WITH":
  // sobald tip gewaehlt ist, MUSS tx da sein (sonst scannt tipCte die ganze
  // lineitem-Historie).
  const cols = NONE_ON();
  cols.tip = true;
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.match(sql, /WITH tx AS \(/);
});

// --- Brand / Terminal: tip_total --------------------------------------------

test('Brand-Query: genau ein Tip-Konstrukt, tip_total im SELECT, nicht im GROUP BY', () => {
  const sql = B.buildBrandQuery(RANGE);
  const tipCteCount = (sql.match(/tip AS \(/g) || []).length;
  assert.strictEqual(tipCteCount, 1, 'genau ein tip-CTE erwartet');
  assert.match(sql, /COALESCE\(SUM\(tip\.tip_amount\), 0\)\s+AS tip_total/);
  const groupByIdx = sql.lastIndexOf('GROUP BY');
  const orderByIdx = sql.indexOf('ORDER BY', groupByIdx);
  const groupBySection = sql.slice(groupByIdx, orderByIdx === -1 ? undefined : orderByIdx);
  assert.doesNotMatch(groupBySection, /tip\.tip_amount/);
  assert.doesNotMatch(groupBySection, /tip_total/);
  // Ohne Vor-Aggregation im tip-CTE selbst wuerde der LEFT JOIN tip Zeilen
  // vervielfachen und COUNT(*)/SUM(t.completedamount) verfaelschen, obwohl die
  // Aussenquery unveraendert aussieht - siehe assertTipPreAggregated.
  assertTipPreAggregated(sql);
});

test('Brand-Query: COUNT(*) und SUM(t.completedamount) unveraendert', () => {
  const sql = B.buildBrandQuery(RANGE);
  assert.match(sql, /COUNT\(\*\)\s+AS anzahl_transaktionen/);
  assert.match(sql, /SUM\(t\.completedamount\)\s+AS brutto_gross/);
});

test('Terminal-Query: genau ein Tip-Konstrukt, tip_total im SELECT, nicht im GROUP BY', () => {
  const sql = B.buildTerminalQuery({ ...RANGE, terminalIds: ['T-1'] });
  const tipCteCount = (sql.match(/tip AS \(/g) || []).length;
  assert.strictEqual(tipCteCount, 1, 'genau ein tip-CTE erwartet');
  assert.match(sql, /COALESCE\(SUM\(tip\.tip_amount\), 0\)\s+AS tip_total/);
  const groupByIdx = sql.lastIndexOf('GROUP BY');
  const orderByIdx = sql.indexOf('ORDER BY', groupByIdx);
  const groupBySection = sql.slice(groupByIdx, orderByIdx === -1 ? undefined : orderByIdx);
  assert.doesNotMatch(groupBySection, /tip\.tip_amount/);
  assert.doesNotMatch(groupBySection, /tip_total/);
  assertTipPreAggregated(sql);
});

test('Terminal-Query: COUNT(*) und SUM(t.completedamount) unveraendert', () => {
  const sql = B.buildTerminalQuery({ ...RANGE, terminalIds: ['T-1'] });
  assert.match(sql, /COUNT\(\*\)\s+AS anzahl_transaktionen/);
  assert.match(sql, /SUM\(t\.completedamount\)\s+AS brutto_gross/);
});

// --- Settlement: tip_total ---------------------------------------------------

test('Settlement-Query: tip_total vorhanden, Vor-Aggregation von settle_tx unversehrt', () => {
  const sql = B.buildSettlementQuery({ ...RANGE, terminalIds: [], byTerminal: false });
  assert.match(sql, /COALESCE\(SUM\(tip\.tip_amount\), 0\)\s+AS tip_total/);
  assert.match(sql, /settle_tx AS \(/);
  assert.match(sql, /GROUP BY psr\.transaction_id/);
  assert.match(sql, /LEFT JOIN settle_tx s ON s\.transaction_id = t\.id/);
  assertTipPreAggregated(sql);
});

test('Settlement-Query: genau ein Tip-CTE', () => {
  const sql = B.buildSettlementQuery({ ...RANGE, terminalIds: [], byTerminal: false });
  const tipCteCount = (sql.match(/tip AS \(/g) || []).length;
  assert.strictEqual(tipCteCount, 1, 'genau ein tip-CTE erwartet');
});

// --- Kartensuche: kein Trinkgeld ---------------------------------------------

test('Kartensuche: kein Trinkgeld, kein lineitem', () => {
  const sql = B.buildCardQuery({ ...RANGE, terminalIds: [], last4: '7873' });
  assert.doesNotMatch(sql, /tip/i);
  assert.doesNotMatch(sql, /lineitem/i);
});

// --- unsettled_anzahl --------------------------------------------------------

test('Brand-Query: unsettled_anzahl prueft beide Bedingungen (Fee fehlt UND kein Settlement-Record)', () => {
  const sql = B.buildBrandQuery(RANGE);
  assert.match(sql, /AS unsettled_anzahl/);
  const caseMatch = sql.match(/SUM\(CASE WHEN([\s\S]*?)THEN 1 ELSE 0 END\)\s+AS unsettled_anzahl/);
  assert.ok(caseMatch, 'CASE-Ausdruck fuer unsettled_anzahl nicht gefunden');
  const cond = caseMatch[1];
  assert.match(cond, /t\.totalappliedfees IS NULL OR t\.totalappliedfees = 0/);
  assert.match(cond, /se\.transaction_id IS NULL/);
  assert.match(sql, /LEFT JOIN settle_exists se ON se\.transaction_id = t\.id/);
  // Beide Teilbedingungen muessen per AND verknuepft sein - nicht nur beide
  // irgendwo im CASE vorkommen. Ein OR wuerde jede frisch abgeschlossene
  // Transaktion, die noch auf ihren Settlement-Lauf wartet (Fee fehlt, aber
  // se.transaction_id ist nicht NULL, weil schon ein Record existiert - oder
  // umgekehrt), faelschlich mitzaehlen.
  assert.match(
    cond,
    /\(t\.totalappliedfees IS NULL OR t\.totalappliedfees = 0\)\s*AND\s*se\.transaction_id IS NULL/,
    'Fee- und Settlement-Bedingung muessen per AND verknuepft sein, nicht per OR'
  );
});

test('Terminal-Query: unsettled_anzahl prueft beide Bedingungen', () => {
  const sql = B.buildTerminalQuery({ ...RANGE, terminalIds: ['T-1'] });
  assert.match(sql, /AS unsettled_anzahl/);
  const caseMatch = sql.match(/SUM\(CASE WHEN([\s\S]*?)THEN 1 ELSE 0 END\)\s+AS unsettled_anzahl/);
  assert.ok(caseMatch, 'CASE-Ausdruck fuer unsettled_anzahl nicht gefunden');
  const cond = caseMatch[1];
  assert.match(cond, /t\.totalappliedfees IS NULL OR t\.totalappliedfees = 0/);
  assert.match(cond, /se\.transaction_id IS NULL/);
  assert.match(sql, /LEFT JOIN settle_exists se ON se\.transaction_id = t\.id/);
  // Siehe Kommentar im Brand-Query-Test: AND, nicht OR.
  assert.match(
    cond,
    /\(t\.totalappliedfees IS NULL OR t\.totalappliedfees = 0\)\s*AND\s*se\.transaction_id IS NULL/,
    'Fee- und Settlement-Bedingung muessen per AND verknuepft sein, nicht per OR'
  );
});

test('Brand- und Terminal-Query: kein currentaccountwithdrawal', () => {
  const brandSql = B.buildBrandQuery(RANGE);
  const terminalSql = B.buildTerminalQuery({ ...RANGE, terminalIds: ['T-1'] });
  assert.doesNotMatch(brandSql, /currentaccountwithdrawal/);
  assert.doesNotMatch(terminalSql, /currentaccountwithdrawal/);
});

test('settleExistsCte: DISTINCT/GROUP BY auf transaction_id, eingegrenzt ueber tx, kein Space-Filter', () => {
  const sql = B.settleExistsCte();
  assert.match(sql, /^settle_exists AS \(/);
  assert.match(sql, /payfacsettlementrecord psr/);
  assert.match(sql, /psr\.transaction_id IN \(SELECT id FROM tx\)/);
  assert.doesNotMatch(sql, /psr\.spaceid/);
});

// --- 0 Spaces: Guard-Klausel bleibt in allen betroffenen Modi ---------------

test('0 Spaces: -1-Guard-Klausel in brand, terminal, export, settlement, kein Crash', () => {
  const zero = { ...RANGE, spaceIds: [] };
  assert.doesNotThrow(() => {
    const brandSql = B.buildBrandQuery(zero);
    assert.match(brandSql, /t\.spaceid = -1/);

    const terminalSql = B.buildTerminalQuery({ ...zero, terminalIds: ['T-1'] });
    assert.match(terminalSql, /t\.spaceid = -1/);

    const exportSql = B.buildExportQuery({ ...zero, terminalIds: [], cols: ALL_ON() });
    assert.match(exportSql, /t\.spaceid = -1/);

    const settlementSql = B.buildSettlementQuery({ ...zero, terminalIds: [], byTerminal: false });
    assert.match(settlementSql, /t\.spaceid = -1/);
  });
});

test('Export mit allen Spalten: tip-CTE koexistiert mit card/settle/payoutref', () => {
  const cols = ALL_ON();
  const sql = B.buildExportQuery({ ...RANGE, terminalIds: [], cols });
  assert.match(sql, /card AS \(/);
  assert.match(sql, /settle AS \(/);
  assert.match(sql, /payoutref AS \(/);
  assert.match(sql, /tip AS \(/);
});
