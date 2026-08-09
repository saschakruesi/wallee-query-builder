// Parser und Modell des Settlement-Reports. Beide sind rein und DOM-frei,
// deshalb hier ohne DOM-Ersatz getestet. Das Modell folgt der Spec
// (settlement-report-spec/SPEC.md): Settlements pro (Space, Valuta-Timestamp),
// Bankgutschriften pro internalreference, Space-/Zahlungsmittel-Aggregate.

const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders, plain } = require('./harness');

// Reihenfolge egal (Parser loest ueber Header-Index auf) - hier die
// natuerliche Reihenfolge der Query. Voller Valuta-Timestamp + created_on.
const KOPF = 'settlement_valuedate,settlement_state,transaction_id,created_on,merchant_reference,'
  + 'space_id,waehrung,connector,sales_channel,terminal_identifier,'
  + 'brutto_gross,settlement_gross,processing_fees,netamount,settlement_records';
const KOPF_REF = KOPF + ',settlement_reference';

function csv(...zeilen) {
  return [KOPF, ...zeilen].join('\n') + '\n';
}
function csvRef(...zeilen) {
  return [KOPF_REF, ...zeilen].join('\n') + '\n';
}

// Kompakter Zeilenbauer: Pflichtfelder mit sinnvollen Defaults, nur das
// Interessante wird ueberschrieben. Betraege als Dezimalstrings (8 Nachkommas).
function zeile(opts = {}) {
  const o = Object.assign({
    valuedate: '2026-01-05 09:00:00', state: 'SETTLED', id: '1',
    createdon: '2026-01-03 10:00:00', mref: '', space: '50161', waehrung: 'CHF',
    connector: 'Visa', channel: 'Ecommerce', terminal: '',
    brutto: '10.00000000', sgross: '10.00000000', fees: '0.10000000',
    netto: '9.90000000', records: '1', ref: undefined,
  }, opts);
  const felder = [o.valuedate, o.state, o.id, o.createdon, o.mref, o.space, o.waehrung,
    o.connector, o.channel, o.terminal, o.brutto, o.sgross, o.fees, o.netto, o.records];
  if (o.ref !== undefined) felder.push(o.ref);
  return felder.join(',');
}

// --- Parser ----------------------------------------------------------------

test('parseSettlementCsv liest eine Zeile in 1e-8-Einheiten inkl. Valuta-Timestamp', () => {
  const { parseSettlementCsv } = loadBuilders();
  const res = parseSettlementCsv(csv(
    '2026-01-05 05:10:23,SETTLED,460535725,2026-01-03 12:00:00,ref-1,50161,CHF,'
    + 'TWINT,Physical Terminal,32655604,225.00000000,225.00000000,2.14000000,222.86000000,1',
  ));
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.rows.length, 1);
  assert.deepStrictEqual(plain(res.rows[0]), {
    settlementValuedate: '2026-01-05 05:10:23',
    settlementDatum: '2026-01-05',
    createdOn: '2026-01-03 12:00:00',
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
    settlementReference: '',
  });
});

test('parseSettlementCsv haelt Rappen exakt - keine Float-Drift ueber viele Zeilen', () => {
  const { parseSettlementCsv } = loadBuilders();
  const zeilen = [];
  for (let i = 0; i < 300; i++) {
    zeilen.push(zeile({ id: String(1000 + i), brutto: '0.10000000',
      sgross: '0.10000000', fees: '0.00000000', netto: '0.10000000' }));
  }
  const res = parseSettlementCsv(csv(...zeilen));
  const summe = res.rows.reduce((a, r) => a + r.netto, 0);
  assert.strictEqual(summe, 300 * 10000000, 'Summe muss exakt 30.00 sein');
});

test('parseSettlementCsv nimmt eine NO_RECORD-Zeile mit leeren Betraegen an', () => {
  const { parseSettlementCsv } = loadBuilders();
  const res = parseSettlementCsv(csv(zeile({
    valuedate: '', state: 'NO_RECORD', id: '460999999',
    brutto: '88.50000000', sgross: '', fees: '', netto: '', records: '0',
  })));
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.rows[0].settlementValuedate, '');
  assert.strictEqual(res.rows[0].settlementDatum, '');
  assert.strictEqual(res.rows[0].bruttoTx, 8850000000);
  assert.strictEqual(res.rows[0].brutto, 0);
  assert.strictEqual(res.rows[0].netto, 0);
});

test('parseSettlementCsv liest die optionale settlement_reference-Spalte', () => {
  const { parseSettlementCsv } = loadBuilders();
  const res = parseSettlementCsv(csvRef(zeile({ ref: 'PAYOUT-4711' })));
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.rows[0].settlementReference, 'PAYOUT-4711');
});

test('parseSettlementCsv ohne Referenz-Spalte bleibt gueltig, Feld ist leer', () => {
  const { parseSettlementCsv } = loadBuilders();
  const res = parseSettlementCsv(csv(zeile()));
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.rows[0].settlementReference, '');
});

test('parseSettlementCsv meldet eine fehlende Pflichtspalte als Fehlerobjekt, ohne zu werfen', () => {
  const { parseSettlementCsv } = loadBuilders();
  const res = parseSettlementCsv('settlement_valuedate,transaction_id\n2026-01-05 09:00:00,1\n');
  assert.ok(res.error, 'Fehlerobjekt erwartet');
  assert.match(res.error.message, /netamount/);
  assert.deepStrictEqual(plain(res.rows), []);
});

test('parseSettlementCsv nennt die fehlende settlement_valuedate-Spalte', () => {
  const { parseSettlementCsv } = loadBuilders();
  const res = parseSettlementCsv('settlement_datum,transaction_id\n2026-01-05,1\n');
  assert.ok(res.error);
  assert.match(res.error.message, /settlement_valuedate/);
});

test('parseSettlementCsv liefert bei leerer Eingabe einen Fehler statt zu werfen', () => {
  const { parseSettlementCsv } = loadBuilders();
  const res = parseSettlementCsv('');
  assert.ok(res.error);
  assert.deepStrictEqual(plain(res.rows), []);
});

test('parseSettlementCsv setzt NO_RECORD/UNKNOWN als Fallback bei leeren Pflichtfeldern', () => {
  const { parseSettlementCsv } = loadBuilders();
  const res = parseSettlementCsv(csv(zeile({ state: '', connector: '', mref: 'ref-2' })));
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.rows[0].settlementState, 'NO_RECORD');
  assert.strictEqual(res.rows[0].connector, 'UNKNOWN');
});

test('parseSettlementCsv ist unabhaengig von der Spaltenreihenfolge im Kopf', () => {
  const { parseSettlementCsv } = loadBuilders();
  const kopfVertauscht = [
    'transaction_id', 'settlement_valuedate', 'connector', 'settlement_state', 'waehrung',
    'space_id', 'merchant_reference', 'sales_channel', 'terminal_identifier', 'created_on',
    'settlement_gross', 'processing_fees', 'netamount', 'settlement_records', 'brutto_gross',
  ].join(',');
  const werte = [
    '777001', '2026-02-01 00:00:00', 'Mastercard', 'PARTIAL', 'EUR',
    '50161', 'ref-77', 'Ecommerce', '', '2026-01-30 08:00:00',
    '50.00000000', '0.50000000', '49.50000000', '2', '55.00000000',
  ].join(',');
  const res = parseSettlementCsv(kopfVertauscht + '\n' + werte + '\n');
  assert.strictEqual(res.error, null);
  assert.strictEqual(res.rows[0].settlementValuedate, '2026-02-01 00:00:00');
  assert.strictEqual(res.rows[0].settlementState, 'PARTIAL');
  assert.strictEqual(res.rows[0].bruttoTx, 5500000000);
  assert.strictEqual(res.rows[0].brutto, 5000000000);
  assert.strictEqual(res.rows[0].netto, 4950000000);
});

// --- Modell ----------------------------------------------------------------

const ENDE = { end: '2026-02-01 00:00:00' };

function modellAus(...zeilen) {
  const { parseSettlementCsv, buildSettlementReportModel } = loadBuilders();
  const res = parseSettlementCsv(csv(...zeilen));
  assert.strictEqual(res.error, null);
  return buildSettlementReportModel(res.rows, ENDE);
}
function modellAusRef(zeilen, optionen) {
  const { parseSettlementCsv, buildSettlementReportModel } = loadBuilders();
  const res = parseSettlementCsv(csvRef(...zeilen));
  assert.strictEqual(res.error, null);
  return buildSettlementReportModel(res.rows, optionen || ENDE);
}

test('Settlement-Grain: ein Settlement je (Space, Valuta-Timestamp)', () => {
  const m = modellAus(
    // Space 50161, zwei Auszahlungen am selben Tag -> zwei Settlements
    zeile({ id: '1', space: '50161', valuedate: '2026-01-05 05:10:00', brutto: '100.00000000', sgross: '100.00000000', fees: '2.00000000', netto: '98.00000000' }),
    zeile({ id: '2', space: '50161', valuedate: '2026-01-05 16:33:00', brutto: '50.00000000', sgross: '50.00000000', fees: '1.00000000', netto: '49.00000000' }),
    // Space 97319, gleicher Zeitpunkt wie oben -> eigenes Settlement (nie space-uebergreifend)
    zeile({ id: '3', space: '97319', valuedate: '2026-01-05 05:10:00', brutto: '20.00000000', sgross: '20.00000000', fees: '0.50000000', netto: '19.50000000' }),
  );
  assert.strictEqual(m.settlements.length, 3);
  assert.strictEqual(m.kpi.anzahlSettlements, 3);
  assert.strictEqual(m.kpi.anzahlSpaces, 2);
});

test('Settlement-IDs sind je Space aufsteigend nach Valuta durchnummeriert', () => {
  const m = modellAus(
    zeile({ id: '1', space: '50161', valuedate: '2026-01-07 09:00:00' }),
    zeile({ id: '2', space: '50161', valuedate: '2026-01-05 09:00:00' }),
    zeile({ id: '3', space: '97319', valuedate: '2026-01-06 09:00:00' }),
  );
  const byId = Object.fromEntries(m.settlements.map(s => [s.settlementId, s.datum]));
  assert.strictEqual(byId['50161-S001'], '2026-01-05');
  assert.strictEqual(byId['50161-S002'], '2026-01-07');
  assert.strictEqual(byId['97319-S001'], '2026-01-06');
});

test('Brutto minus Fees ergibt in jeder Zeile und in der Summe exakt Netto', () => {
  const m = modellAus(
    zeile({ id: '1', valuedate: '2026-01-05 09:00:00', brutto: '111.11000000', sgross: '111.11000000', fees: '2.13000000', netto: '108.98000000' }),
    zeile({ id: '2', valuedate: '2026-01-06 09:00:00', brutto: '7.77000000', sgross: '7.77000000', fees: '0.19000000', netto: '7.58000000' }),
  );
  m.settlements.forEach(s => assert.strictEqual(s.brutto - s.fees, s.netto));
  assert.strictEqual(m.gesamt.brutto - m.gesamt.fees, m.gesamt.netto);
  assert.strictEqual(m.kpi.brutto - m.kpi.fees, m.kpi.netto);
});

test('Settlement nach dem Berichtsende gilt als Ausstehend und wird separat ausgewiesen', () => {
  const m = modellAus(
    zeile({ id: '1', valuedate: '2026-01-31 09:00:00', brutto: '10.00000000', sgross: '10.00000000', fees: '0.10000000', netto: '9.90000000' }),
    zeile({ id: '2', valuedate: '2026-02-03 09:00:00', brutto: '20.00000000', sgross: '20.00000000', fees: '0.20000000', netto: '19.80000000' }),
  );
  assert.deepStrictEqual(plain(m.settlements.map(s => s.status)), ['Settled', 'Ausstehend']);
  assert.strictEqual(m.ausstehend.anzahlSettlements, 1);
  assert.strictEqual(m.ausstehend.anzahlTx, 1);
  assert.strictEqual(m.ausstehend.brutto, 2000000000);
  assert.strictEqual(m.ausstehend.netto, 1980000000);
});

test('Settlement am letzten Tag des Zeitraums ist Settled, am Folgetag Ausstehend (echte App-Form 23:59:59)', () => {
  const { parseSettlementCsv, buildSettlementReportModel } = loadBuilders();
  const res = parseSettlementCsv(csv(
    zeile({ id: '1', valuedate: '2026-06-30 09:00:00' }),
    zeile({ id: '2', valuedate: '2026-07-01 09:00:00' }),
  ));
  assert.strictEqual(res.error, null);
  const m = buildSettlementReportModel(res.rows, { end: '2026-06-30 23:59:59' });
  assert.deepStrictEqual(plain(m.settlements.map(s => [s.datum, s.status])), [
    ['2026-06-30', 'Settled'],
    ['2026-07-01', 'Ausstehend'],
  ]);
});

test('berichtsEndeCH/berichtsEndeTag: 23:59:59 = letzter Tag, 00:00:00 = Folgetag exklusiv', () => {
  const { berichtsEndeCH, berichtsEndeTag } = loadBuilders();
  assert.strictEqual(berichtsEndeCH('2026-06-30 23:59:59'), '30.06.2026');
  assert.strictEqual(berichtsEndeCH('2026-07-01 00:00:00'), '30.06.2026');
  assert.strictEqual(berichtsEndeTag('2026-06-30 23:59:59'), '2026-06-30');
  assert.strictEqual(berichtsEndeTag('2026-07-01 00:00:00'), '2026-06-30');
  assert.strictEqual(berichtsEndeTag(''), '');
  assert.strictEqual(berichtsEndeTag(undefined), '');
});

test('NO_RECORD landet als "Offen" separat, nicht in den Settlement-Summen', () => {
  const m = modellAus(
    zeile({ id: '1', valuedate: '2026-01-05 09:00:00', brutto: '10.00000000', sgross: '10.00000000', fees: '0.10000000', netto: '9.90000000' }),
    zeile({ id: '2', state: 'NO_RECORD', valuedate: '', brutto: '88.50000000', sgross: '', fees: '', netto: '', records: '0' }),
    zeile({ id: '3', state: 'NO_RECORD', valuedate: '', connector: 'TWINT', brutto: '11.50000000', sgross: '', fees: '', netto: '', records: '0' }),
  );
  // Offene Transaktionen sind nicht Teil von settlements.
  assert.strictEqual(m.settlements.length, 1);
  assert.strictEqual(m.offen.anzahlTx, 2);
  assert.strictEqual(m.offen.brutto, 10000000000, 'Offen nutzt brutto_gross der Transaktion');
  // KPIs: Offen zaehlt nicht als Settlement und nicht ins Netto.
  assert.strictEqual(m.kpi.anzahlSettlements, 1);
  assert.strictEqual(m.kpi.netto, 990000000);
  assert.strictEqual(m.kpi.offenAnzahlTx, 2);
  assert.strictEqual(m.kpi.offenBrutto, 10000000000);
  // gesamt ist die Settled-Summe (Brutto - Fees = Netto gilt).
  assert.strictEqual(m.gesamt.anzahlTx, 1);
  assert.strictEqual(m.gesamt.brutto - m.gesamt.fees, m.gesamt.netto);
});

test('offen.detail ist nach Transaktions-ID sortiert und durchnummeriert', () => {
  const m = modellAus(
    zeile({ id: '300', state: 'NO_RECORD', valuedate: '', brutto: '3.00000000', sgross: '', fees: '', netto: '', records: '0' }),
    zeile({ id: '100', state: 'NO_RECORD', valuedate: '', brutto: '1.00000000', sgross: '', fees: '', netto: '', records: '0' }),
  );
  assert.deepStrictEqual(plain(m.offen.detail.map(d => [d.nr, d.transactionId])), [[1, '100'], [2, '300']]);
});

test('Zahlungsmittel: wallee-Praefixe werden entfernt (SPEC 2.1)', () => {
  const m = modellAus(
    zeile({ id: '1', connector: 'Wallee All-in-One - Visa' }),
    zeile({ id: '2', valuedate: '2026-01-06 09:00:00', connector: 'Wallee ACQ - Mastercard' }),
  );
  const namen = m.connectors.map(c => c.connector).sort();
  assert.deepStrictEqual(plain(namen), ['Mastercard', 'Visa']);
});

test('Connector-Aufschluesselung: absteigend nach Brutto, NO_RECORD zaehlt nicht mit', () => {
  const m = modellAus(
    zeile({ id: '1', connector: 'Visa', brutto: '10.00000000', sgross: '10.00000000', fees: '0.10000000', netto: '9.90000000' }),
    zeile({ id: '2', connector: 'TWINT', brutto: '90.00000000', sgross: '90.00000000', fees: '0.90000000', netto: '89.10000000' }),
    zeile({ id: '3', state: 'NO_RECORD', valuedate: '', connector: 'Visa', brutto: '88.50000000', sgross: '', fees: '', netto: '', records: '0' }),
  );
  assert.deepStrictEqual(
    plain(m.connectors.map(c => [c.connector, c.anzahlTx, c.brutto])),
    [['TWINT', 1, 9000000000], ['Visa', 1, 1000000000]],
  );
  assert.strictEqual(m.connectorTotal.brutto, m.kpi.brutto);
  assert.strictEqual(m.connectorTotal.netto, m.kpi.netto);
});

test('Connectoren mit gleichem Brutto werden alphabetisch sortiert', () => {
  const m = modellAus(
    zeile({ id: '1', connector: 'Visa' }),
    zeile({ id: '2', connector: 'Mastercard' }),
    zeile({ id: '3', connector: 'TWINT' }),
  );
  assert.deepStrictEqual(plain(m.connectors.map(c => c.connector)), ['Mastercard', 'TWINT', 'Visa']);
});

test('Space-Aufschluesselung summiert je Space inkl. Settlement-Zaehler', () => {
  const m = modellAus(
    zeile({ id: '1', space: '50161', valuedate: '2026-01-05 09:00:00', brutto: '10.00000000', sgross: '10.00000000', fees: '0.10000000', netto: '9.90000000' }),
    zeile({ id: '2', space: '50161', valuedate: '2026-01-06 09:00:00', brutto: '20.00000000', sgross: '20.00000000', fees: '0.20000000', netto: '19.80000000' }),
    zeile({ id: '3', space: '97319', valuedate: '2026-01-05 09:00:00', brutto: '30.00000000', sgross: '30.00000000', fees: '0.30000000', netto: '29.70000000' }),
  );
  const s = Object.fromEntries(m.spaces.map(x => [x.spaceId, x]));
  assert.strictEqual(s['50161'].anzahlSettlements, 2);
  assert.strictEqual(s['50161'].anzahlTx, 2);
  assert.strictEqual(s['50161'].brutto, 3000000000);
  assert.strictEqual(s['97319'].anzahlSettlements, 1);
  assert.strictEqual(m.spaceTotal.anzahlSettlements, 3);
  assert.strictEqual(m.spaceTotal.brutto, m.kpi.brutto);
});

// --- Bankgutschriften (SPEC 2.2) ------------------------------------------

test('Bankgutschriften: BG-nn nach fruehestem Valutazeitpunkt, buendelt Spaces und Valutatage', () => {
  const m = modellAusRef([
    // Referenz A: eine Space, zwei Valutatage
    zeile({ id: '1', space: '50161', valuedate: '2026-01-06 09:00:00', ref: 'REF-A', brutto: '10.00000000', sgross: '10.00000000', fees: '0.10000000', netto: '9.90000000' }),
    zeile({ id: '2', space: '50161', valuedate: '2026-01-07 09:00:00', ref: 'REF-A', brutto: '20.00000000', sgross: '20.00000000', fees: '0.20000000', netto: '19.80000000' }),
    // Referenz B: frueherer Valutazeitpunkt -> BG-01, zwei Spaces
    zeile({ id: '3', space: '50161', valuedate: '2026-01-05 09:00:00', ref: 'REF-B', brutto: '30.00000000', sgross: '30.00000000', fees: '0.30000000', netto: '29.70000000' }),
    zeile({ id: '4', space: '97319', valuedate: '2026-01-05 09:00:00', ref: 'REF-B', brutto: '40.00000000', sgross: '40.00000000', fees: '0.40000000', netto: '39.60000000' }),
  ], ENDE);
  assert.strictEqual(m.hasReference, true);
  assert.strictEqual(m.credits.length, 2);
  const bg01 = m.credits[0], bg02 = m.credits[1];
  assert.strictEqual(bg01.bg, 'BG-01');
  assert.strictEqual(bg01.referenz, 'REF-B');
  assert.deepStrictEqual(plain(bg01.spaces), ['50161', '97319']);
  assert.strictEqual(bg01.anzahlTx, 2);
  assert.strictEqual(bg02.bg, 'BG-02');
  assert.strictEqual(bg02.referenz, 'REF-A');
  assert.strictEqual(bg02.von, '2026-01-06 09:00:00');
  assert.strictEqual(bg02.bis, '2026-01-07 09:00:00');
  // Credit-Total == Report-Total
  assert.strictEqual(m.creditTotal.brutto, m.kpi.brutto);
  assert.strictEqual(m.creditTotal.netto, m.kpi.netto);
});

test('Settlement traegt die BG-Nr. seiner Referenz', () => {
  const m = modellAusRef([
    zeile({ id: '1', valuedate: '2026-01-05 09:00:00', ref: 'REF-X' }),
  ], ENDE);
  assert.strictEqual(m.settlements[0].bg, 'BG-01');
  assert.strictEqual(m.settlements[0].referenz, 'REF-X');
});

// An den Referenzdaten (settlement-report-spec) tragen 26 der 69'436
// abgerechneten Transaktionen keine Referenz. Ohne Sammelzeile waere die
// Summe der Bankgutschriften kleiner als das Report-Total und die Abstimmung
// (SPEC 7, Check 3) ginge nicht auf.
test('Bankgutschriften: abgerechnete Zeilen ohne Referenz landen in einer Sammelzeile', () => {
  const m = modellAusRef([
    zeile({ id: '1', valuedate: '2026-01-05 09:00:00', ref: 'REF-A',
      brutto: '10.00000000', sgross: '10.00000000', fees: '0.10000000', netto: '9.90000000' }),
    zeile({ id: '2', valuedate: '2026-01-06 09:00:00', ref: '',
      brutto: '20.00000000', sgross: '20.00000000', fees: '0.20000000', netto: '19.80000000' }),
  ], ENDE);
  const sammel = m.credits.find(c => c.bg === '—');
  assert.ok(sammel, 'Sammelzeile fuer Zeilen ohne Referenz erwartet');
  assert.strictEqual(sammel.referenz, '');
  assert.strictEqual(sammel.anzahlTx, 1);
  assert.strictEqual(sammel.brutto, 2000000000);
  // Entscheidend: die Summe der Gutschriften entspricht dem Report-Total.
  assert.strictEqual(m.creditTotal.anzahlTx, m.kpi.anzahlTx);
  assert.strictEqual(m.creditTotal.brutto, m.kpi.brutto);
  assert.strictEqual(m.creditTotal.fees, m.kpi.fees);
  assert.strictEqual(m.creditTotal.netto, m.kpi.netto);
});

test('Ohne Referenzspalte gibt es keine Bankgutschriften (hasReference false)', () => {
  const m = modellAus(zeile({ id: '1' }));
  assert.strictEqual(m.hasReference, false);
  assert.deepStrictEqual(plain(m.credits), []);
  assert.strictEqual(m.settlements[0].bg, '—');
});

test('txDetail traegt je Transaktion Settlement-ID, BG-Nr. und Referenz', () => {
  const m = modellAusRef([
    zeile({ id: '55', space: '50161', valuedate: '2026-01-05 09:00:00', ref: 'REF-Z' }),
  ], ENDE);
  assert.strictEqual(m.txDetail.length, 1);
  assert.strictEqual(m.txDetail[0].settlementId, '50161-S001');
  assert.strictEqual(m.txDetail[0].bg, 'BG-01');
  assert.strictEqual(m.txDetail[0].referenz, 'REF-Z');
  assert.strictEqual(m.txDetail[0].transactionId, '55');
});

test('Leeres Ergebnis ergibt ein leeres, aber vollstaendiges Modell', () => {
  const { buildSettlementReportModel } = loadBuilders();
  const m = buildSettlementReportModel([], ENDE);
  assert.deepStrictEqual(plain(m.settlements), []);
  assert.deepStrictEqual(plain(m.connectors), []);
  assert.deepStrictEqual(plain(m.spaces), []);
  assert.deepStrictEqual(plain(m.credits), []);
  assert.deepStrictEqual(plain(m.txDetail), []);
  assert.strictEqual(m.kpi.anzahlTx, 0);
  assert.strictEqual(m.kpi.anzahlBankgutschriften, 0);
  assert.strictEqual(m.hasReference, false);
  assert.strictEqual(m.offen.anzahlTx, 0);
});

test('Ohne end bleiben alle Settlements Settled statt faelschlich Ausstehend', () => {
  const { parseSettlementCsv, buildSettlementReportModel } = loadBuilders();
  const res = parseSettlementCsv(csv(
    zeile({ id: '1', valuedate: '2026-01-05 09:00:00' }),
    zeile({ id: '2', valuedate: '2026-02-10 09:00:00' }),
  ));
  const ohneEnde = buildSettlementReportModel(res.rows, {});
  assert.deepStrictEqual(plain(ohneEnde.settlements.map(s => s.status)), ['Settled', 'Settled']);
  const leeresEnde = buildSettlementReportModel(res.rows, { end: '' });
  assert.deepStrictEqual(plain(leeresEnde.settlements.map(s => s.status)), ['Settled', 'Settled']);
});

test('kpi.valutaVon/valutaBis und createdAb spiegeln den Datenbereich', () => {
  const m = modellAus(
    zeile({ id: '1', createdon: '2026-01-02 08:00:00', valuedate: '2026-01-05 09:00:00' }),
    zeile({ id: '2', createdon: '2026-01-04 08:00:00', valuedate: '2026-01-09 09:00:00' }),
  );
  assert.strictEqual(m.kpi.createdAb, '2026-01-02');
  assert.strictEqual(m.kpi.valutaVon, '2026-01-05');
  assert.strictEqual(m.kpi.valutaBis, '2026-01-09');
});

// --- Mehrwaehrungs-Erkennung -----------------------------------------------

test('kpi.waehrungen listet alle vorkommenden Waehrungen sortiert auf', () => {
  const m = modellAus(
    zeile({ id: '1', waehrung: 'CHF' }),
    zeile({ id: '2', valuedate: '2026-01-06 09:00:00', waehrung: 'EUR', brutto: '100.00000000', sgross: '100.00000000', fees: '1.00000000', netto: '99.00000000' }),
  );
  assert.deepStrictEqual(plain(m.kpi.waehrungen), ['CHF', 'EUR']);
});

test('kpi.waehrungen bleibt bei einer einzigen Waehrung ein Ein-Element-Array', () => {
  const m = modellAus(
    zeile({ id: '1', waehrung: 'CHF' }),
    zeile({ id: '2', valuedate: '2026-01-06 09:00:00', waehrung: 'CHF', brutto: '20.00000000', sgross: '20.00000000', fees: '0.20000000', netto: '19.80000000' }),
  );
  assert.deepStrictEqual(plain(m.kpi.waehrungen), ['CHF']);
});
