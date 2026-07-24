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
