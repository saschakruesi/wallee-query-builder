// Rendering des Settlement-Reports gegen den reicheren DOM-Ersatz.
// Geprueft wird die erzeugte Struktur, nicht das Aussehen.

const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders } = require('./harness');
const { makeDocument } = require('./dom-stub');

const KOPF = 'settlement_datum,settlement_state,transaction_id,merchant_reference,'
  + 'space_id,waehrung,connector,sales_channel,terminal_identifier,'
  + 'brutto_gross,settlement_gross,processing_fees,netamount,settlement_records';

const CSV = [KOPF,
  '2026-01-05,SETTLED,100,,50161,CHF,Visa,Ecommerce,,10.00000000,10.00000000,0.10000000,9.90000000,1',
  '2026-01-05,SETTLED,200,,50161,CHF,TWINT,Physical Terminal,,20.00000000,20.00000000,0.20000000,19.80000000,1',
].join('\n') + '\n';

test('ingestSettlementCsv nimmt ein gueltiges Ergebnis an und rendert die Abschnitte', () => {
  const document = makeDocument();
  const api = loadBuilders({ document });
  assert.strictEqual(api.ingestSettlementCsv(CSV), true);

  const html = document.getElementById('settlementReportOutput').innerHTML;
  assert.match(html, /Zusammenfassung/);
  assert.match(html, /Aufschlüsselung nach Zahlungsmittel/);
  assert.match(html, /Settlement-Übersicht/);
  assert.match(html, /05\.01\.2026/);
  assert.match(html, /29\.70/, 'Netto der Gruppe in CH-Formatierung');
});

test('ingestSettlementCsv lehnt ein Ergebnis mit fehlender Pflichtspalte ab', () => {
  const document = makeDocument();
  const api = loadBuilders({ document });
  assert.strictEqual(api.ingestSettlementCsv('settlement_datum,transaction_id\n2026-01-05,1\n'), false);
  assert.match(document.getElementById('settlementReportStatus').textContent, /Pflichtspalten/);
  assert.strictEqual(document.getElementById('settlementReportOutput').innerHTML, '');
});

test('ingestSettlementCsv verkraftet ein leeres Ergebnis ohne zu werfen', () => {
  const document = makeDocument();
  const api = loadBuilders({ document });
  assert.doesNotThrow(() => api.ingestSettlementCsv(''));
  assert.strictEqual(api.ingestSettlementCsv(''), false);
});

// Befund 2 (Schluss-Review): der Modus umfasst alle Spaces eines Accounts und
// kann deshalb mehrere Waehrungen im Ergebnis haben. Statt sie
// stillschweigend zu addieren (10 CHF + 100 EUR = "110 CHF"), muss der
// Report das verweigern - gleicher Fehlerpfad wie bei fehlenden
// Pflichtspalten (Modell und Ausgabe bleiben leer, Statusmeldung nennt die
// gefundenen Waehrungen).
const CSV_ZWEI_WAEHRUNGEN = [KOPF,
  '2026-01-05,SETTLED,100,,50161,CHF,Visa,Ecommerce,,10.00000000,10.00000000,0.10000000,9.90000000,1',
  '2026-01-05,SETTLED,200,,50161,EUR,Visa,Ecommerce,,100.00000000,100.00000000,1.00000000,99.00000000,1',
].join('\n') + '\n';

test('ingestSettlementCsv verweigert den Report bei mehr als einer Waehrung (Befund 2)', () => {
  const document = makeDocument();
  const api = loadBuilders({ document });
  assert.strictEqual(api.ingestSettlementCsv(CSV_ZWEI_WAEHRUNGEN), false);
  const status = document.getElementById('settlementReportStatus').textContent;
  assert.match(status, /Währungen/);
  assert.match(status, /CHF/);
  assert.match(status, /EUR/);
  assert.strictEqual(document.getElementById('settlementReportOutput').innerHTML, '');
});

test('ingestSettlementCsv bleibt bei einer einzigen Waehrung unveraendert (Befund 2, Regression)', () => {
  const document = makeDocument();
  const api = loadBuilders({ document });
  assert.strictEqual(api.ingestSettlementCsv(CSV), true);
  const html = document.getElementById('settlementReportOutput').innerHTML;
  assert.match(html, /Zusammenfassung/);
});
