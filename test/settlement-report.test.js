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

// --- Settlement-Report: Modell ---------------------------------------------

const ENDE = { end: '2026-02-01 00:00:00' };

// Rest-Parameter, nicht ein einzelnes Array: modellAus() wird an jeder
// Aufrufstelle mit mehreren einzelnen CSV-Zeilen-Strings aufgerufen
// (modellAus('zeile1', 'zeile2', ...)), nicht mit einem Array. Ein einzelner
// Parameter ohne "..." wuerde nur die erste Zeile binden und deren einzelne
// Zeichen ueber csv(...zeilen) als Zeilen spreaden - ein stiller Bug, der
// beim Schreiben dieser Tests aufgefallen ist (Detail-/Connector-Tests
// scheiterten mit dutzenden Ein-Zeichen-"Zeilen" statt der echten Eingabe).
function modellAus(...zeilen) {
  const { parseSettlementCsv, buildSettlementReportModel } = loadBuilders();
  const res = parseSettlementCsv(csv(...zeilen));
  assert.strictEqual(res.error, null);
  return buildSettlementReportModel(res.rows, ENDE);
}

test('Modell gruppiert nach Settlement-Datum und summiert je Gruppe', () => {
  const m = modellAus(
    '2026-01-05,SETTLED,1,,50161,CHF,TWINT,Physical Terminal,,100.00000000,100.00000000,2.00000000,98.00000000,1',
    '2026-01-05,SETTLED,2,,50161,CHF,Visa,Ecommerce,,50.00000000,50.00000000,1.00000000,49.00000000,1',
    '2026-01-07,SETTLED,3,,50161,CHF,Visa,Ecommerce,,20.00000000,20.00000000,0.50000000,19.50000000,1',
  );
  assert.strictEqual(m.settlements.length, 2);
  assert.deepStrictEqual(
    plain(m.settlements.map(s => [s.nr, s.datum, s.status, s.anzahlTx])),
    [[1, '2026-01-05', 'Settled', 2], [2, '2026-01-07', 'Settled', 1]],
  );
  assert.strictEqual(m.settlements[0].brutto, 15000000000);
  assert.strictEqual(m.settlements[0].fees, 300000000);
  assert.strictEqual(m.settlements[0].netto, 14700000000);
});

test('Brutto minus Fees ergibt in jeder Zeile und in der Summe exakt Netto', () => {
  const m = modellAus(
    '2026-01-05,SETTLED,1,,50161,CHF,TWINT,Physical Terminal,,111.11000000,111.11000000,2.13000000,108.98000000,1',
    '2026-01-06,SETTLED,2,,50161,CHF,Visa,Ecommerce,,7.77000000,7.77000000,0.19000000,7.58000000,1',
  );
  m.settlements.forEach(s => assert.strictEqual(s.brutto - s.fees, s.netto));
  assert.strictEqual(m.gesamt.brutto - m.gesamt.fees, m.gesamt.netto);
  assert.strictEqual(m.kpi.brutto - m.kpi.fees, m.kpi.netto);
});

test('Settlement nach dem Berichtsende gilt als Ausstehend und wird separat ausgewiesen', () => {
  const m = modellAus(
    '2026-01-31,SETTLED,1,,50161,CHF,Visa,Ecommerce,,10.00000000,10.00000000,0.10000000,9.90000000,1',
    '2026-02-03,SETTLED,2,,50161,CHF,Visa,Ecommerce,,20.00000000,20.00000000,0.20000000,19.80000000,1',
  );
  assert.deepStrictEqual(plain(m.settlements.map(s => s.status)), ['Settled', 'Ausstehend']);
  assert.strictEqual(m.ausstehend.anzahlSettlements, 1);
  assert.strictEqual(m.ausstehend.anzahlTx, 1);
  assert.strictEqual(m.ausstehend.brutto, 2000000000);
  assert.strictEqual(m.ausstehend.netto, 1980000000);
});

// Befund 1 (Schluss-Review, Merge-Blocker): die App liefert 'end' nie als
// exklusive Mitternacht, sondern immer als 'YYYY-MM-DD 23:59:59'
// (state.endTime steht ueberall auf '23:59:59') - der letzte Tag des
// Berichtszeitraums selbst, nicht der Tag danach. Mit der frueheren
// Slice-auf-10-Zeichen-Logik waere '2026-06-30' als endeTag behandelt und ein
// Settlement genau an diesem letzten Tag faelschlich als Ausstehend
// eingestuft worden - reproduziert mit genau diesen realistischen Werten.
test('Settlement am letzten Tag des Zeitraums ist Settled, am Folgetag Ausstehend (echte App-Form, Befund 1)', () => {
  const { parseSettlementCsv, buildSettlementReportModel } = loadBuilders();
  const res = parseSettlementCsv(csv(
    '2026-06-30,SETTLED,1,,50161,CHF,Visa,Ecommerce,,10.00000000,10.00000000,0.10000000,9.90000000,1',
    '2026-07-01,SETTLED,2,,50161,CHF,Visa,Ecommerce,,20.00000000,20.00000000,0.20000000,19.80000000,1',
  ));
  assert.strictEqual(res.error, null);
  const m = buildSettlementReportModel(res.rows, { end: '2026-06-30 23:59:59' });
  assert.deepStrictEqual(plain(m.settlements.map(s => [s.datum, s.status])), [
    ['2026-06-30', 'Settled'],
    ['2026-07-01', 'Ausstehend'],
  ]);
});

test('berichtsEndeCH mit der echten App-Form (23:59:59) nennt den letzten Tag selbst (Befund 1)', () => {
  const { berichtsEndeCH } = loadBuilders();
  assert.strictEqual(berichtsEndeCH('2026-06-30 23:59:59'), '30.06.2026');
});

test('berichtsEndeCH: die alte exklusive Form (00:00:00 Folgetag) liefert denselben letzten Tag (Befund 1)', () => {
  const { berichtsEndeCH } = loadBuilders();
  assert.strictEqual(berichtsEndeCH('2026-07-01 00:00:00'), '30.06.2026');
});

test('berichtsEndeTag: 23:59:59 ist der letzte Tag selbst, 00:00:00 ist der Folgetag exklusiv (Befund 1)', () => {
  const { berichtsEndeTag } = loadBuilders();
  assert.strictEqual(berichtsEndeTag('2026-06-30 23:59:59'), '2026-06-30');
  assert.strictEqual(berichtsEndeTag('2026-07-01 00:00:00'), '2026-06-30');
  assert.strictEqual(berichtsEndeTag(''), '');
  assert.strictEqual(berichtsEndeTag(undefined), '');
});

test('NO_RECORD bildet die Zeile "Offen" am Ende, ohne Datum und ohne Netto', () => {
  const m = modellAus(
    '2026-01-05,SETTLED,1,,50161,CHF,Visa,Ecommerce,,10.00000000,10.00000000,0.10000000,9.90000000,1',
    ',NO_RECORD,2,,50161,CHF,Visa,Ecommerce,,88.50000000,,,,0',
    ',NO_RECORD,3,,50161,CHF,TWINT,Physical Terminal,,11.50000000,,,,0',
  );
  const offen = m.settlements[m.settlements.length - 1];
  assert.strictEqual(offen.status, 'Offen');
  assert.strictEqual(offen.datum, '');
  assert.strictEqual(offen.anzahlTx, 2);
  assert.strictEqual(offen.brutto, 10000000000, 'Offen nutzt brutto_gross der Transaktion');
  assert.strictEqual(offen.netto, 0);
  // Offen zaehlt nicht als Settlement und nicht ins ausbezahlte Netto.
  assert.strictEqual(m.kpi.anzahlSettlements, 1);
  assert.strictEqual(m.kpi.netto, 990000000);
  assert.strictEqual(m.kpi.offenAnzahlTx, 2);
  assert.strictEqual(m.kpi.offenBrutto, 10000000000);
  // In der Gesamtzeile ist sie dagegen enthalten.
  assert.strictEqual(m.gesamt.anzahlTx, 3);
});

test('Connector-Aufschluesselung summiert je Zahlungsmittel, absteigend nach Brutto', () => {
  const m = modellAus(
    '2026-01-05,SETTLED,1,,50161,CHF,Visa,Ecommerce,,10.00000000,10.00000000,0.10000000,9.90000000,1',
    '2026-01-05,SETTLED,2,,50161,CHF,TWINT,Physical Terminal,,90.00000000,90.00000000,0.90000000,89.10000000,1',
    '2026-01-06,SETTLED,3,,50161,CHF,Visa,Ecommerce,,5.00000000,5.00000000,0.05000000,4.95000000,1',
  );
  assert.deepStrictEqual(
    plain(m.connectors.map(c => [c.connector, c.anzahlTx, c.brutto])),
    [['TWINT', 1, 9000000000], ['Visa', 2, 1500000000]],
  );
  assert.strictEqual(m.connectorTotal.anzahlTx, 3);
  assert.strictEqual(m.connectorTotal.brutto, 10500000000);
});

// Befund 1 (Review Task 4): die Connector-Aufschluesselung steht im Report
// direkt unter den KPI-Kennzahlen - ihre Total-Zeile muss deshalb zu genau
// diesen Kennzahlen passen. Zwei Zeilen desselben Connectors, eine abgerechnet
// (SETTLED) und eine offen (NO_RECORD): der Connector darf nur die
// abgerechnete Zeile zaehlen, sonst widerspricht connectorTotal den KPIs zwei
// Zeilen darueber.
test('Connector-Aufschluesselung zaehlt NO_RECORD-Zeilen nicht mit (Befund 1, Review Task 4)', () => {
  const m = modellAus(
    '2026-01-05,SETTLED,1,,50161,CHF,Visa,Ecommerce,,10.00000000,10.00000000,0.10000000,9.90000000,1',
    ',NO_RECORD,2,,50161,CHF,Visa,Ecommerce,,88.50000000,,,,0',
  );
  assert.deepStrictEqual(
    plain(m.connectors.map(c => [c.connector, c.anzahlTx, c.brutto])),
    [['Visa', 1, 1000000000]],
  );
  assert.strictEqual(m.connectorTotal.anzahlTx, 1);
  assert.strictEqual(m.connectorTotal.brutto, m.kpi.brutto);
  assert.strictEqual(m.connectorTotal.fees, m.kpi.fees);
  assert.strictEqual(m.connectorTotal.netto, m.kpi.netto);
});

test('Detail je Settlement ist nach Transaktions-ID sortiert und durchnummeriert', () => {
  const m = modellAus(
    '2026-01-05,SETTLED,300,,50161,CHF,Visa,Ecommerce,,3.00000000,3.00000000,0.03000000,2.97000000,1',
    '2026-01-05,SETTLED,100,,50161,CHF,TWINT,Physical Terminal,,1.00000000,1.00000000,0.01000000,0.99000000,1',
  );
  assert.deepStrictEqual(
    plain(m.settlements[0].detail.map(d => [d.nr, d.transactionId, d.connector])),
    [[1, '100', 'TWINT'], [2, '300', 'Visa']],
  );
});

test('Durchschnitt je Settlement rechnet nur ueber Zeilen mit Datum', () => {
  const m = modellAus(
    '2026-01-05,SETTLED,1,,50161,CHF,Visa,Ecommerce,,10.00000000,10.00000000,0.00000000,10.00000000,1',
    '2026-01-06,SETTLED,2,,50161,CHF,Visa,Ecommerce,,30.00000000,30.00000000,0.00000000,30.00000000,1',
    ',NO_RECORD,3,,50161,CHF,Visa,Ecommerce,,99.00000000,,,,0',
  );
  assert.strictEqual(m.kpi.avgNetto, 2000000000, '40.00 / 2 Settlements = 20.00');
});

test('Leeres Ergebnis ergibt ein leeres, aber vollstaendiges Modell', () => {
  const { buildSettlementReportModel } = loadBuilders();
  const m = buildSettlementReportModel([], ENDE);
  assert.deepStrictEqual(plain(m.settlements), []);
  assert.deepStrictEqual(plain(m.connectors), []);
  assert.strictEqual(m.kpi.anzahlTx, 0);
  assert.strictEqual(m.kpi.avgNetto, 0);
  assert.strictEqual(m.ausstehend.anzahlSettlements, 0);
});

// Befund 2 (Review Task 4): gesamt ist die Spaltensumme der
// Settlement-Uebersicht, welche die "Offen"-Zeile mitlistet (Brutto
// vorhanden, Fees/Netto 0). Das ist bewusst so - kein Bug, der repariert
// werden sollte: die Spaltensumme muss aufgehen, die fachliche Identitaet
// Brutto - Fees = Netto gilt naturgemaess nur fuer Zeilen mit Banktransaktion.
test('gesamt ist die Spaltensumme aller Settlement-Zeilen inkl. Offen (Befund 2, Review Task 4)', () => {
  const m = modellAus(
    '2026-01-05,SETTLED,1,,50161,CHF,Visa,Ecommerce,,10.00000000,10.00000000,0.10000000,9.90000000,1',
    '2026-01-06,SETTLED,2,,50161,CHF,Visa,Ecommerce,,30.00000000,30.00000000,0.30000000,29.70000000,1',
    ',NO_RECORD,3,,50161,CHF,Visa,Ecommerce,,88.50000000,,,,0',
  );
  const spaltensumme = m.settlements.reduce((a, s) => {
    a.anzahlTx += s.anzahlTx; a.brutto += s.brutto; a.fees += s.fees; a.netto += s.netto;
    return a;
  }, { anzahlTx: 0, brutto: 0, fees: 0, netto: 0 });
  assert.strictEqual(m.gesamt.anzahlTx, spaltensumme.anzahlTx);
  assert.strictEqual(m.gesamt.brutto, spaltensumme.brutto);
  assert.strictEqual(m.gesamt.fees, spaltensumme.fees);
  assert.strictEqual(m.gesamt.netto, spaltensumme.netto);
  // Ausdruecklich erwartet, NICHT reparieren: die Offen-Zeile hat Brutto ohne
  // Fees/Netto, daher geht die Identitaet in der Summe bewusst nicht auf.
  assert.notStrictEqual(m.gesamt.brutto - m.gesamt.fees, m.gesamt.netto);
});

// Befund 3 (Review Task 4): Tie-Breaker der Connector-Sortierung. Bei
// gleichem Brutto entscheidet die alphabetische Reihenfolge des
// Connector-Namens (localeCompare, 'de').
test('Connectoren mit gleichem Brutto werden alphabetisch sortiert (Befund 3, Review Task 4)', () => {
  const m = modellAus(
    '2026-01-05,SETTLED,1,,50161,CHF,Visa,Ecommerce,,10.00000000,10.00000000,0.10000000,9.90000000,1',
    '2026-01-05,SETTLED,2,,50161,CHF,Mastercard,Ecommerce,,10.00000000,10.00000000,0.10000000,9.90000000,1',
    '2026-01-05,SETTLED,3,,50161,CHF,TWINT,Physical Terminal,,10.00000000,10.00000000,0.10000000,9.90000000,1',
  );
  assert.deepStrictEqual(
    plain(m.connectors.map(c => c.connector)),
    ['Mastercard', 'TWINT', 'Visa'],
  );
});

// Befund 3 (Review Task 4): fehlt end oder ist es leer, darf der
// lexikografische Vergleich g.datum >= endeTag nicht greifen (ein leerer
// String waere sonst kleinstmoeglich und wuerde jedes Datum >= '' erfuellen -
// alles wuerde zu Ausstehend). Der Guard "if (endeTag && ...)" faengt genau
// das ab: ohne end bleiben alle Gruppen Settled.
test('Ohne end bleiben alle Gruppen Settled statt faelschlich Ausstehend (Befund 3, Review Task 4)', () => {
  const { parseSettlementCsv, buildSettlementReportModel } = loadBuilders();
  const res = parseSettlementCsv(csv(
    '2026-01-05,SETTLED,1,,50161,CHF,Visa,Ecommerce,,10.00000000,10.00000000,0.10000000,9.90000000,1',
    '2026-02-10,SETTLED,2,,50161,CHF,Visa,Ecommerce,,20.00000000,20.00000000,0.20000000,19.80000000,1',
  ));
  assert.strictEqual(res.error, null);

  const ohneEnde = buildSettlementReportModel(res.rows, {});
  assert.deepStrictEqual(plain(ohneEnde.settlements.map(s => s.status)), ['Settled', 'Settled']);

  const leeresEnde = buildSettlementReportModel(res.rows, { end: '' });
  assert.deepStrictEqual(plain(leeresEnde.settlements.map(s => s.status)), ['Settled', 'Settled']);
});

// Befund 3 (Review Task 4): ein Modell mit allen drei Status gleichzeitig.
// kpi.anzahlSettlements zaehlt beide datierten Status (Settled UND
// Ausstehend) zusammen, Offen jedoch nicht - Offen hat kein Settlement-Datum
// und ist damit begrifflich kein Settlement.
test('kpi.anzahlSettlements zaehlt Settled und Ausstehend zusammen, aber nicht Offen (Befund 3, Review Task 4)', () => {
  const m = modellAus(
    '2026-01-05,SETTLED,1,,50161,CHF,Visa,Ecommerce,,10.00000000,10.00000000,0.10000000,9.90000000,1',
    '2026-02-03,SETTLED,2,,50161,CHF,Visa,Ecommerce,,20.00000000,20.00000000,0.20000000,19.80000000,1',
    ',NO_RECORD,3,,50161,CHF,Visa,Ecommerce,,88.50000000,,,,0',
  );
  assert.deepStrictEqual(
    plain(m.settlements.map(s => s.status)),
    ['Settled', 'Ausstehend', 'Offen'],
  );
  assert.strictEqual(m.kpi.anzahlSettlements, 2);
});
