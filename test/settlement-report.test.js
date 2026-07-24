// Parser und Modell des Settlement-Reports. Beide sind rein und DOM-frei,
// deshalb hier ohne DOM-Ersatz getestet.

const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders, plain } = require('./harness');

const KOPF = 'settlement_datum,settlement_state,transaction_id,merchant_reference,'
  + 'space_id,waehrung,connector,sales_channel,terminal_identifier,'
  + 'brutto_gross,settlement_gross,processing_fees,netamount,settlement_records';

function csv(...zeilen) {
  return [KOPF, ...zeilen].join('\n') + '\n';
}

test('parseSettlementCsv liest eine Zeile in 1e-8-Einheiten', () => {
  const { parseSettlementCsv } = loadBuilders();
  const res = parseSettlementCsv(csv(
    '2026-01-05,SETTLED,460535725,ref-1,50161,CHF,TWINT,Physical Terminal,32655604,'
    + '225.00000000,225.00000000,2.14000000,222.86000000,1',
  ));
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.rows.length, 1);
  assert.deepStrictEqual(plain(res.rows[0]), {
    settlementDatum: '2026-01-05',
    settlementState: 'SETTLED',
    transactionId: '460535725',
    merchantReference: 'ref-1',
    spaceId: '50161',
    waehrung: 'CHF',
    connector: 'TWINT',
    salesChannel: 'Physical Terminal',
    terminalIdentifier: '32655604',
    bruttoTx: 22500000000,
    brutto: 22500000000,
    fees: 214000000,
    netto: 22286000000,
    records: 1,
  });
});

test('parseSettlementCsv haelt Rappen exakt - keine Float-Drift ueber viele Zeilen', () => {
  const { parseSettlementCsv } = loadBuilders();
  const zeilen = [];
  for (let i = 0; i < 300; i++) {
    zeilen.push('2026-01-05,SETTLED,' + (1000 + i) + ',,50161,CHF,Visa,Ecommerce,,'
      + '0.10000000,0.10000000,0.00000000,0.10000000,1');
  }
  const res = parseSettlementCsv(csv(...zeilen));
  const summe = res.rows.reduce((a, r) => a + r.netto, 0);
  assert.strictEqual(summe, 300 * 10000000, 'Summe muss exakt 30.00 sein');
});

test('parseSettlementCsv nimmt eine NO_RECORD-Zeile mit leeren Betraegen an', () => {
  const { parseSettlementCsv } = loadBuilders();
  const res = parseSettlementCsv(csv(
    ',NO_RECORD,460999999,,50161,CHF,Visa,Ecommerce,,88.50000000,,,,0',
  ));
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.rows[0].settlementDatum, '');
  assert.strictEqual(res.rows[0].bruttoTx, 8850000000);
  assert.strictEqual(res.rows[0].brutto, 0);
  assert.strictEqual(res.rows[0].netto, 0);
});

test('parseSettlementCsv meldet eine fehlende Pflichtspalte als Fehlerobjekt, ohne zu werfen', () => {
  const { parseSettlementCsv } = loadBuilders();
  const res = parseSettlementCsv('settlement_datum,transaction_id\n2026-01-05,1\n');
  assert.ok(res.error, 'Fehlerobjekt erwartet');
  assert.match(res.error.message, /netamount/);
  assert.deepStrictEqual(plain(res.rows), []);
});

test('parseSettlementCsv liefert bei leerer Eingabe einen Fehler statt zu werfen', () => {
  const { parseSettlementCsv } = loadBuilders();
  const res = parseSettlementCsv('');
  assert.ok(res.error);
  assert.deepStrictEqual(plain(res.rows), []);
});

// Befund 1 (Review Task 3): Silent-Defaults fuer leere Pflichtfelder. Das ist
// bewusstes, defensives Verhalten (`|| 'NO_RECORD'` / `|| 'UNKNOWN'`) und keine
// Annahme, die hier in Frage gestellt wird - Task 1s Query liefert
// settlement_state per COALESCE nie leer, der Fallback faengt nur ein CSV aus
// anderer Quelle oder mit verschobenen Spalten ab. Dieser Test nagelt das
// Verhalten fest, damit es spaeter nicht versehentlich als Unfall entfernt wird.
test('parseSettlementCsv setzt NO_RECORD/UNKNOWN als Fallback bei leeren Pflichtfeldern', () => {
  const { parseSettlementCsv } = loadBuilders();
  const res = parseSettlementCsv(csv(
    '2026-01-05,,460555000,ref-2,50161,CHF,,Physical Terminal,32655604,'
    + '100.00000000,100.00000000,1.00000000,99.00000000,1',
  ));
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.rows.length, 1);
  assert.strictEqual(res.rows[0].settlementState, 'NO_RECORD');
  assert.strictEqual(res.rows[0].connector, 'UNKNOWN');
});

// Befund 2 (Review Task 3): der Parser loest Spalten ueber eine Index-Map auf
// (headers.forEach((h, i) => idx[h] = i), daher reihenfolge-unabhaengig. Diese
// Kopfzeile vertauscht die Spaltenreihenfolge gegenueber KOPF bewusst, um genau
// das zu belegen.
test('parseSettlementCsv ist unabhaengig von der Spaltenreihenfolge im Kopf', () => {
  const { parseSettlementCsv } = loadBuilders();
  const kopfVertauscht = [
    'transaction_id', 'settlement_datum', 'connector', 'settlement_state', 'waehrung',
    'space_id', 'merchant_reference', 'sales_channel', 'terminal_identifier',
    'settlement_gross', 'processing_fees', 'netamount', 'settlement_records', 'brutto_gross',
  ].join(',');
  const zeile = [
    '777001', '2026-02-01', 'Mastercard', 'PARTIAL', 'EUR',
    '50161', 'ref-77', 'Ecommerce', '',
    '50.00000000', '0.50000000', '49.50000000', '2', '55.00000000',
  ].join(',');
  const res = parseSettlementCsv(kopfVertauscht + '\n' + zeile + '\n');
  assert.strictEqual(res.error, null);
  assert.deepStrictEqual(plain(res.rows[0]), {
    settlementDatum: '2026-02-01',
    settlementState: 'PARTIAL',
    transactionId: '777001',
    merchantReference: 'ref-77',
    spaceId: '50161',
    waehrung: 'EUR',
    connector: 'Mastercard',
    salesChannel: 'Ecommerce',
    terminalIdentifier: '',
    bruttoTx: 5500000000,
    brutto: 5000000000,
    fees: 50000000,
    netto: 4950000000,
    records: 2,
  });
});
