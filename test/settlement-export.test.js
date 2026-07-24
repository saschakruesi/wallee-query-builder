// Export-Basis des Settlement-Reports: eine Blockliste, aus der CSV, XLSX und
// PDF gleichermassen gespeist werden. Rein und ohne Vendor testbar.

const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders, plain } = require('./harness');

const KOPF = 'settlement_datum,settlement_state,transaction_id,merchant_reference,'
  + 'space_id,waehrung,connector,sales_channel,terminal_identifier,'
  + 'brutto_gross,settlement_gross,processing_fees,netamount,settlement_records';

function modell(...zeilen) {
  const { parseSettlementCsv, buildSettlementReportModel } = loadBuilders();
  const res = parseSettlementCsv([KOPF, ...zeilen].join('\n') + '\n');
  assert.strictEqual(res.error, null);
  return buildSettlementReportModel(res.rows, { end: '2026-02-01 00:00:00' });
}

const ZEILEN = [
  '2026-01-05,SETTLED,100,,50161,CHF,Visa,Ecommerce,,10.00000000,10.00000000,0.10000000,9.90000000,1',
  '2026-01-05,SETTLED,200,,50161,CHF,TWINT,Physical Terminal,,20.00000000,20.00000000,0.20000000,19.80000000,1',
  '2026-02-03,SETTLED,300,,50161,CHF,Visa,Ecommerce,,30.00000000,30.00000000,0.30000000,29.70000000,1',
];

test('Bloecke: Zusammenfassung, Zahlungsmittel und Uebersicht sind immer dabei', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN), { detail: false });
  assert.deepStrictEqual(
    plain(b.map(x => x.name)),
    ['Zusammenfassung', 'Aufschlüsselung nach Zahlungsmittel', 'Settlement-Übersicht'],
  );
});

test('Bloecke: mit detail:true folgt je Settlement ein Detailblock', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN), { detail: true });
  assert.deepStrictEqual(
    plain(b.map(x => x.name)),
    ['Zusammenfassung', 'Aufschlüsselung nach Zahlungsmittel', 'Settlement-Übersicht',
      'Settlement 1: 05.01.2026', 'Settlement 2: 03.02.2026'],
  );
  const detail = b[3];
  assert.deepStrictEqual(plain(detail.header), ['#', 'Transaction ID', 'Connector', 'Brutto', 'Fees', 'Netto']);
  assert.deepStrictEqual(plain(detail.rows), [
    [1, '100', 'Visa', 10, 0.1, 9.9],
    [2, '200', 'TWINT', 20, 0.2, 19.8],
    ['Subtotal (2 Tx)', '', '', 30, 0.3, 29.7],
  ]);
});

test('Bloecke: Betraege stehen als Zahlen, nicht als formatierte Strings', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN), { detail: false });
  const uebersicht = b[2];
  assert.deepStrictEqual(plain(uebersicht.header),
    ['#', 'Settlement Datum', 'Tx', 'Brutto', 'Fees', 'Netto', 'Status']);
  assert.deepStrictEqual(plain(uebersicht.rows), [
    [1, '05.01.2026', 2, 30, 0.3, 29.7, 'Settled'],
    [2, '03.02.2026', 1, 30, 0.3, 29.7, 'Ausstehend'],
    ['TOTAL', '', 3, 60, 0.6, 59.4, ''],
  ]);
  assert.deepStrictEqual(plain(uebersicht.typen),
    ['text', 'text', 'zahl', 'betrag', 'betrag', 'betrag', 'text']);
});

test('Bloecke: Uebersicht traegt den Hinweis auf ausstehende Settlements', () => {
  const { settlementExportBloecke } = loadBuilders();
  // Der Hinweis nennt das Berichtsende, deshalb braucht dieser Aufruf 'end'.
  const b = settlementExportBloecke(modell(...ZEILEN),
    { detail: false, end: '2026-02-01 00:00:00' });
  assert.match(String(b[2].hinweis), /^1 Settlement\(s\) mit 1 Transaktionen/);
  assert.match(String(b[2].hinweis), /nach dem 31\.01\.2026 abgerechnet/);
});

test('Bloecke: ohne ausstehende Settlements gibt es keinen Hinweis', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(ZEILEN[0]),
    { detail: false, end: '2026-02-01 00:00:00' });
  assert.strictEqual(b[2].hinweis, '');
});

test('Bloecke: Zusammenfassung nennt die Kennzahlen der Vorlage', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN), { detail: false });
  assert.deepStrictEqual(plain(b[0].rows), [
    ['Anzahl Settlements', 2],
    ['Anzahl Transaktionen', 3],
    ['Brutto Volumen', 60],
    ['Processing Fees', 0.6],
    ['Netto Auszahlung', 59.4],
    ['Ø Netto/Settlement', 29.7],
  ]);
});

test('Zusammenfassung weist offene Transaktionen als eigene Kennzahl aus', () => {
  const { settlementExportBloecke } = loadBuilders();
  const m = modell(ZEILEN[0], ',NO_RECORD,999,,50161,CHF,Visa,Ecommerce,,7.00000000,,,,0');
  const b = settlementExportBloecke(m, { detail: false });
  assert.deepStrictEqual(plain(b[0].rows).slice(-2), [
    ['Noch nicht abgerechnet (Tx)', 1],
    ['Noch nicht abgerechnet (Brutto)', 7],
  ]);
});

test('CSV: Bloecke untereinander, Semikolon, BOM', () => {
  const { buildSettlementReportCsv } = loadBuilders();
  const csv = buildSettlementReportCsv(modell(...ZEILEN), { detail: false, end: '2026-02-01 00:00:00' });
  assert.ok(csv.charCodeAt(0) === 0xFEFF, 'BOM fehlt - Excel liest sonst Latin-1');
  const zeilen = csv.replace(/^﻿/, '').split('\r\n');
  assert.strictEqual(zeilen[0], 'Zusammenfassung');
  assert.ok(zeilen.includes('Settlement-Übersicht'));
  assert.ok(zeilen.includes('1;05.01.2026;2;30;0.3;29.7;Settled'));
});

test('CSV: mit detail:true landen auch die Settlement-Detailbloecke im CSV', () => {
  const { buildSettlementReportCsv } = loadBuilders();
  const csv = buildSettlementReportCsv(modell(...ZEILEN),
    { detail: true, end: '2026-02-01 00:00:00' });
  const zeilen = csv.replace(/^﻿/, '').split('\r\n');
  assert.ok(zeilen.includes('Settlement 1: 05.01.2026'));
  assert.ok(zeilen.includes('Settlement 2: 03.02.2026'));
  assert.ok(zeilen.includes('#;Transaction ID;Connector;Brutto;Fees;Netto'));
  assert.ok(zeilen.includes('1;100;Visa;10;0.1;9.9'));
  assert.ok(zeilen.includes('Subtotal (2 Tx);;;30;0.3;29.7'));
});

test('Hinweis: fehlt optionen.end, bleibt der Satz sauber (kein doppeltes Leerzeichen, kein haengendes "nach dem")', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN), { detail: false });
  const hinweis = String(b[2].hinweis);
  assert.ok(hinweis.length > 0, 'Hinweis sollte hier gesetzt sein (es gibt ausstehende Settlements)');
  assert.ok(!/ {2,}/.test(hinweis), `Hinweis enthaelt ein doppeltes Leerzeichen: "${hinweis}"`);
  assert.ok(!/nach dem\s*\.$/.test(hinweis), `Hinweis endet mit haengendem "nach dem": "${hinweis}"`);
  assert.match(hinweis, /Berichtszeitraum abgerechnet\.$/);
});

test('zellTyp: Zusammenfassung liefert je Zeile den richtigen Typ, sonst faellt sie auf typen[c] zurueck', () => {
  const { settlementExportBloecke, zellTyp } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN), { detail: false });
  const zus = b[0];
  // Zaehler-Zeilen
  assert.strictEqual(zellTyp(zus, 0, 1), 'zahl'); // Anzahl Settlements
  assert.strictEqual(zellTyp(zus, 1, 1), 'zahl'); // Anzahl Transaktionen
  // Betrags-Zeilen
  assert.strictEqual(zellTyp(zus, 2, 1), 'betrag'); // Brutto Volumen
  assert.strictEqual(zellTyp(zus, 3, 1), 'betrag'); // Processing Fees
  assert.strictEqual(zellTyp(zus, 4, 1), 'betrag'); // Netto Auszahlung
  assert.strictEqual(zellTyp(zus, 5, 1), 'betrag'); // Oe Netto/Settlement
  // Erste Spalte durchgehend Text
  assert.strictEqual(zellTyp(zus, 0, 0), 'text');

  // Ein Block ohne zellTypen faellt auf typen[c] zurueck (Verhalten unveraendert)
  const uebersicht = b[2];
  assert.strictEqual(uebersicht.zellTypen, undefined);
  for (let c = 0; c < uebersicht.typen.length; c++) {
    assert.strictEqual(zellTyp(uebersicht, 0, c), uebersicht.typen[c]);
  }
});

test('Fallback: settlementExportBloecke(null, ...) liefert keine NaN-Werte', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(null, { detail: false });
  b.forEach(block => {
    block.rows.forEach(row => {
      row.forEach(zelle => {
        assert.ok(!(typeof zelle === 'number' && Number.isNaN(zelle)),
          `NaN in Block "${block.name}": ${JSON.stringify(row)}`);
      });
    });
  });
});

test('formatZahlCH: negativer Betrag (Refund) stimmt mit formatAmountCH ueberein', () => {
  const { formatZahlCH, formatAmountCH } = loadBuilders();
  // -530000000 in 1e-8-Einheiten entspricht -5.30 CHF.
  assert.strictEqual(formatZahlCH(-5.3), formatAmountCH(-530000000));
  assert.strictEqual(formatZahlCH(-5.3), '-5.30');
});

test('berichtsEndeCH: Jahresgrenze', () => {
  const { berichtsEndeCH } = loadBuilders();
  assert.strictEqual(berichtsEndeCH('2026-01-01 00:00:00'), '31.12.2025');
});

// --- PDF-Layout (Task 6) ---------------------------------------------------

const PDF_OPT = {
  detail: true,
  start: '2026-01-01 00:00:00',
  end: '2026-02-01 00:00:00',
  account: '52238',
};

test('PDF: Titel und Kopfzeilen nennen Zeitraum und Account', () => {
  const { settlementPdfBloecke } = loadBuilders();
  const p = settlementPdfBloecke(modell(...ZEILEN), PDF_OPT);
  assert.strictEqual(p.titel, 'SETTLEMENT-REPORT');
  assert.deepStrictEqual(plain(p.kopfzeilen), [
    'Zeitraum: 01.01.2026 – 31.01.2026',
    'Account: 52238',
  ]);
});

test('PDF: Betraege sind fertig formatierte Strings in CH-Schreibweise', () => {
  const { settlementPdfBloecke } = loadBuilders();
  const p = settlementPdfBloecke(modell(...ZEILEN), { ...PDF_OPT, detail: false });
  const uebersicht = p.tabellen.find(t => t.titel === '2. Settlement-Übersicht');
  assert.deepStrictEqual(plain(uebersicht.rows[0]),
    ['1', '05.01.2026', '2', "30.00", '0.30', '29.70', 'Settled']);
});

test('PDF: Zahlenspalten sind rechtsbuendig, Textspalten links', () => {
  const { settlementPdfBloecke } = loadBuilders();
  const p = settlementPdfBloecke(modell(...ZEILEN), { ...PDF_OPT, detail: false });
  const uebersicht = p.tabellen.find(t => t.titel === '2. Settlement-Übersicht');
  assert.deepStrictEqual(plain(uebersicht.ausrichtung),
    ['left', 'left', 'right', 'right', 'right', 'right', 'left']);
});

test('PDF: Abschnitt 3 beginnt auf einer neuen Seite, Folgesettlements nicht', () => {
  const { settlementPdfBloecke } = loadBuilders();
  const p = settlementPdfBloecke(modell(...ZEILEN), PDF_OPT);
  const titel = p.tabellen.map(t => t.titel);
  assert.deepStrictEqual(plain(titel), [
    '1. Zusammenfassung',
    'Aufschlüsselung nach Zahlungsmittel',
    '2. Settlement-Übersicht',
    '3. Transaktionsdetail pro Settlement',
    'Settlement 2: 03.02.2026',
  ]);
  const umbrueche = p.tabellen.map(t => t.seitenumbruchDavor);
  assert.deepStrictEqual(plain(umbrueche), [false, false, true, true, false]);
});

test('PDF: ohne detail fehlen die Detailtabellen ganz', () => {
  const { settlementPdfBloecke } = loadBuilders();
  const p = settlementPdfBloecke(modell(...ZEILEN), { ...PDF_OPT, detail: false });
  assert.deepStrictEqual(plain(p.tabellen.map(t => t.titel)), [
    '1. Zusammenfassung',
    'Aufschlüsselung nach Zahlungsmittel',
    '2. Settlement-Übersicht',
  ]);
});

test('PDF: der Hinweis auf ausstehende Settlements haengt an der Uebersicht', () => {
  const { settlementPdfBloecke } = loadBuilders();
  const p = settlementPdfBloecke(modell(...ZEILEN), { ...PDF_OPT, detail: false });
  const uebersicht = p.tabellen.find(t => t.titel === '2. Settlement-Übersicht');
  assert.match(String(uebersicht.hinweis), /1 Settlement\(s\) mit 1 Transaktionen/);
});

test('PDF: Zusammenfassung respektiert zeilenweise Typen (Zaehler vs. Betrag)', () => {
  // Ohne zellTyp in pdfTabelle wuerde die Wert-Spalte pauschal ueber
  // block.typen[1] ('betrag') formatiert - "Anzahl Settlements" kaeme dann
  // faelschlich als "2.00" statt "2" heraus.
  const { settlementPdfBloecke } = loadBuilders();
  const p = settlementPdfBloecke(modell(...ZEILEN), { ...PDF_OPT, detail: false });
  const zus = p.tabellen.find(t => t.titel === '1. Zusammenfassung');
  const anzahlSettlements = zus.rows.find(r => r[0] === 'Anzahl Settlements');
  const bruttoVolumen = zus.rows.find(r => r[0] === 'Brutto Volumen');
  assert.strictEqual(anzahlSettlements[1], '2');
  assert.strictEqual(bruttoVolumen[1], '60.00');
});
