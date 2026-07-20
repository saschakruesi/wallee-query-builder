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

test('Export: tip-Spalte allein zieht kein WITH tx nach, wenn sonst nichts gewaehlt ist - doch, denn needsTip braucht tx', () => {
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
