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

// --- xlsxBlattName: Excel-Blattnamen aus den Blocknamen ---------------------
// Excel erlaubt maximal 31 Zeichen, keines der Zeichen : \ / ? * [ ], und zwei
// Blaetter duerfen nicht gleich heissen. Der 35 Zeichen lange Blockname
// "Aufschlüsselung nach Zahlungsmittel" wurde bisher per slice(0, 31) mitten im
// Wort zu "Aufschlüsselung nach Zahlungsmi" abgeschnitten.

const BEKANNTE_BLOCKNAMEN = [
  'Zusammenfassung',
  'Aufschlüsselung nach Zahlungsmittel',
  'Settlement-Übersicht',
  'Settlement 1: 05.01.2026',
  'Settlement 42: Offen',
];

test('xlsxBlattName: alle bekannten Blocknamen bleiben innerhalb des 31-Zeichen-Limits', () => {
  const { xlsxBlattName } = loadBuilders();
  BEKANNTE_BLOCKNAMEN.forEach(n => {
    const name = xlsxBlattName(n);
    assert.ok(name.length <= 31, `"${name}" (${name.length} Zeichen) aus "${n}" ueberschreitet 31 Zeichen`);
  });
});

test('xlsxBlattName: keines der verbotenen Zeichen : \\ / ? * [ ] im Ergebnis', () => {
  const { xlsxBlattName } = loadBuilders();
  const verboten = /[:\\/?*[\]]/;
  BEKANNTE_BLOCKNAMEN.concat(['Sonderfall: a/b*c?d[e]f\\g']).forEach(n => {
    const name = xlsxBlattName(n);
    assert.ok(!verboten.test(name), `"${name}" aus "${n}" enthaelt noch ein verbotenes Zeichen`);
  });
});

test('xlsxBlattName: "Aufschlüsselung nach Zahlungsmittel" wird sprechend gekuerzt, nicht mitten im Wort', () => {
  const { xlsxBlattName } = loadBuilders();
  const name = xlsxBlattName('Aufschlüsselung nach Zahlungsmittel');
  assert.strictEqual(name, 'Zahlungsmittel');
});

test('xlsxBlattName: kurze Blocknamen bleiben unveraendert', () => {
  const { xlsxBlattName } = loadBuilders();
  assert.strictEqual(xlsxBlattName('Zusammenfassung'), 'Zusammenfassung');
  assert.strictEqual(xlsxBlattName('Settlement-Übersicht'), 'Settlement-Übersicht');
  // Das ':' wird durch '-' ersetzt (Excel vertraegt keinen Doppelpunkt).
  assert.strictEqual(xlsxBlattName('Settlement 1: 05.01.2026'), 'Settlement 1- 05.01.2026');
});

test('xlsxBlattName: wort-bewusstes Kuerzen schneidet nie mitten im Wort ab', () => {
  const { xlsxBlattName } = loadBuilders();
  // Kein bekannter Blockname, aber realistisch lang - prueft den generischen
  // Fallback-Pfad (nicht die Zuordnungstabelle).
  const lang = 'Ein ziemlich langer Blattname mit vielen Woertern';
  const name = xlsxBlattName(lang);
  assert.ok(name.length <= 31, `"${name}" ueberschreitet 31 Zeichen`);
  // Jedes Wort im Ergebnis muss vollstaendig aus dem Original stammen -
  // kein Wort darf mitten drin enden.
  const woerterOriginal = lang.split(' ');
  name.split(' ').forEach((wort, i) => {
    assert.strictEqual(wort, woerterOriginal[i], `Wort "${wort}" wurde mitten im Wort abgeschnitten`);
  });
});

test('xlsxBlattName: die laufende Nummer eines Settlement-Blocks wird nie weggeschnitten', () => {
  const { xlsxBlattName } = loadBuilders();
  // Konstruierter Grenzfall: ein Blockname im "Settlement N: ..."-Format, bei
  // dem der Teil nach der Nummer lang genug ist, um das 31-Zeichen-Limit zu
  // reissen. Ein naives slice(0, 31) wuerde hier trotzdem nicht die Nummer
  // kappen (die steht ja am Anfang) - der eigentliche Risikofall ist ein
  // kuenftiges Namensschema, bei dem die Nummer erst spaeter im String steht.
  // Das wort-bewusste Kuerzen schuetzt auch dagegen: es trennt nur an
  // Leerzeichen, nie mitten in einem Token wie einer Nummer.
  const namen = [
    'Settlement 1: Ein sehr langer Beschreibungstext fuer den Bericht',
    'Settlement 2: Ein sehr langer Beschreibungstext fuer den Bericht',
    'Settlement 3: Ein sehr langer Beschreibungstext fuer den Bericht',
  ];
  const gekuerzt = namen.map(xlsxBlattName);
  gekuerzt.forEach((n, i) => {
    assert.ok(n.startsWith(`Settlement ${i + 1}`), `"${n}" verliert die laufende Nummer`);
  });
  assert.strictEqual(new Set(gekuerzt).size, gekuerzt.length,
    `Blattnamen kollidieren: ${JSON.stringify(gekuerzt)}`);
});

test('xlsxBlattName: Eindeutigkeit ueber viele echte Settlement-Bloecke hinweg (Modell mit 40 Settlements)', () => {
  const { settlementExportBloecke, xlsxBlattName } = loadBuilders();
  // Ein Modell mit 40 Settlements an 40 verschiedenen Tagen - reicht, um die
  // Blattnamen-Bildung ueber eine realistische Menge an Detailbloecken zu
  // pruefen (Zusammenfassung, Zahlungsmittel, Uebersicht + 40 Detailbloecke).
  const zeilen = [];
  for (let tag = 1; tag <= 40; tag++) {
    const datum = `2026-01-${String(tag).padStart(2, '0')}`;
    zeilen.push(`${datum},SETTLED,${100 + tag},,50161,CHF,Visa,Ecommerce,,`
      + '10.00000000,10.00000000,0.10000000,9.90000000,1');
  }
  const modellWert = modell(...zeilen);
  const bloecke = settlementExportBloecke(modellWert, { detail: true });
  assert.strictEqual(bloecke.length, 43, 'Zusammenfassung + Zahlungsmittel + Uebersicht + 40 Settlements');
  const blattnamen = bloecke.map(b => xlsxBlattName(b.name));
  blattnamen.forEach(n => assert.ok(n.length <= 31, `"${n}" ueberschreitet 31 Zeichen`));
  assert.strictEqual(new Set(blattnamen).size, blattnamen.length,
    `Blattnamen kollidieren im 40-Settlement-Modell: ${JSON.stringify(blattnamen)}`);
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
