// Tests fuer die Blockschicht des Terminal-Reports: reportExportBloecke ist
// die gemeinsame, reine Grundlage fuer XLSX und CSV (und seit v5.14 traegt
// sie die Variante full/kondensiert, SPEC-ITERATION-2 §5.2). Kein DOM, kein
// Vendor - siehe test/harness.js. Bis v5.13 stand das in test/report.test.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadBuilders, plain } = require('./harness');

const app = loadBuilders();
const { parseReportCsv, buildReportModel, reportExportBloecke, buildReportCsv,
  AUTORISIERT_HINWEIS } = app;

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'beispiel-daten.csv'), 'utf8');

function modell(config) {
  const res = parseReportCsv(FIXTURE);
  assert.strictEqual(res.error, null, 'Fixture muss lesbar sein');
  return buildReportModel(res.rows, config || {});
}

// Zeilen, wie sie der Parser liefert - inkl. authorized.
function row(tid, name, brand, gross, authorized, extra) {
  return Object.assign({ tid, name, brand, currency: 'CHF', count: 1, unmatched: 0,
    gross, authorized, tip: 0 }, extra || {});
}

// --- Export-Bloecke --------------------------------------------------------
// reportExportBloecke() liefert die Export-Struktur als reine Daten - dieselbe
// Grundlage fuer XLSX und CSV. Betraege stehen darin als ZAHL, nicht als
// formatierter String: der Kunde soll im Excel weiterrechnen und sortieren
// koennen. Das Schweizer Aussehen macht das Excel-Zahlformat (#,##0.00), nicht
// eine vorformatierte Zeichenkette.

test('Export-Bloecke: alle vier Bloecke in fester Reihenfolge', () => {
  const bloecke = reportExportBloecke(modell());
  assert.deepStrictEqual(plain(bloecke.map(b => b.name)), [
    'Total Outlet-Gruppen', 'Total Brand-Gruppen', 'Gesamttotal', 'Detail',
  ]);
});

test('Export-Bloecke: Betraege sind Zahlen, keine Strings', () => {
  const gesamt = reportExportBloecke(modell()).find(b => b.name === 'Gesamttotal');
  const zeile = gesamt.rows[0];

  zeile.slice(1).forEach((wert, i) => {
    assert.strictEqual(typeof wert, 'number', `Spalte ${i + 1} muss eine Zahl sein, ist ${typeof wert}`);
  });
});

test('Export-Bloecke: Gesamttotal traegt die Sollzahlen', () => {
  const gesamt = reportExportBloecke(modell()).find(b => b.name === 'Gesamttotal');
  assert.deepStrictEqual(plain(gesamt.header), ['', 'Complete Demand', 'Authorized', 'Tip', 'Unmatched', 'Anz.']);
  assert.deepStrictEqual(plain(gesamt.rows), [['Total', 62756.16, 62756.16, 793.46, 889, 2070]]);
});

test('Export-Bloecke: Brand-Totals vollstaendig', () => {
  const brands = reportExportBloecke(modell()).find(b => b.name === 'Total Brand-Gruppen');
  assert.deepStrictEqual(plain(brands.rows), [
    ['Lunch-Check', 31, 31, 0, 1, 2],
    ['Wallee', 62725.16, 62725.16, 793.46, 888, 2068],
  ]);
});

test('Export-Bloecke: Outlet-Totals decken alle Gruppen ab', () => {
  const m = modell();
  const outlets = reportExportBloecke(m).find(b => b.name === 'Total Outlet-Gruppen');
  assert.strictEqual(outlets.rows.length, m.outletTotals.length);
  // Summe der Betragsspalte muss das Gesamttotal ergeben.
  const summe = outlets.rows.reduce((a, r) => a + r[2], 0);
  assert.strictEqual(Math.round(summe * 100) / 100, 62756.16);
});

test('Export-Bloecke: Detail enthaelt eine Zeile je Terminal und Marke', () => {
  const m = modell();
  const detail = reportExportBloecke(m).find(b => b.name === 'Detail');
  const erwartet = m.detail.reduce((a, o) =>
    a + o.terminals.reduce((b, t) => b + t.brands.length, 0), 0);
  assert.strictEqual(detail.rows.length, erwartet);
});

test('Export-Bloecke: Rundung auf zwei Stellen, ohne Gleitkomma-Rauschen', () => {
  const rows = [
    { tid: 'T1', name: 'A 1', brand: 'Visa', currency: 'CHF', count: 1, unmatched: 0,
      gross: 10000000, tip: 0 },                       // 0.10
    { tid: 'T2', name: 'A 2', brand: 'Visa', currency: 'CHF', count: 1, unmatched: 0,
      gross: 20000000, tip: 0 },                       // 0.20
  ];
  const gesamt = reportExportBloecke(buildReportModel(rows, {}))
    .find(b => b.name === 'Gesamttotal');
  assert.strictEqual(gesamt.rows[0][1], 0.3, 'muss exakt 0.3 sein, nicht 0.30000000000000004');
});

// --- CSV-Export ------------------------------------------------------------

test('CSV-Export: BOM, Semikolon und alle Bloecke', () => {
  const csv = buildReportCsv(modell());

  assert.ok(csv.startsWith('﻿'), 'UTF-8-BOM fehlt (Excel liest sonst falsch)');
  assert.ok(csv.includes(';'), 'Semikolon als Trennzeichen erwartet');
  ['Total Outlet-Gruppen', 'Total Brand-Gruppen', 'Gesamttotal', 'Detail']
    .forEach(t => assert.ok(csv.includes(t), `Block "${t}" fehlt im CSV`));
});

test('CSV-Export: Zahlen mit Punkt und ohne Tausendertrennung', () => {
  const csv = buildReportCsv(modell());

  assert.ok(csv.includes('62756.16'), 'Gesamtbetrag muss maschinenlesbar bleiben');
  assert.ok(!csv.includes('62’756.16'), 'keine Tausendertrennung im CSV - das bricht den Import');
});

test('CSV-Export: Felder mit Semikolon oder Quote werden maskiert', () => {
  const rows = [
    { tid: 'T1', name: 'Bar; "Eck" 1', brand: 'Visa', currency: 'CHF',
      count: 1, unmatched: 0, gross: 100000000, tip: 0 },
  ];
  const csv = buildReportCsv(buildReportModel(rows, {}));

  assert.ok(csv.includes('"Bar; ""Eck"" 1"'), 'Semikolon und Quotes muessen maskiert sein');
});

// --- Autorisiert in den Ausgaben (v5.14, SPEC-ITERATION-2 §4.2-4.4) ---------

const G2 = 'Autorisiert = Summe der vom Kartenherausgeber freigegebenen Beträge. Weicht sie vom '
  + 'Complete Demand ab, fehlt für die Differenz eine Submission (Einreichung/Tagesabschluss am '
  + 'Terminal) — der Betrag ist freigegeben, aber noch nicht abgerechnet.';

test('Hinweis G2 ist wortgleich die Vorgabe der Spec', () => {
  assert.strictEqual(AUTORISIERT_HINWEIS, G2);
});

test('Export-Bloecke: Kennzahl-Reihenfolge Complete Demand · Authorized · Tip · Unmatched · Anz. in allen Bloecken', () => {
  reportExportBloecke(modell()).forEach(b => {
    const kennzahlen = b.header.slice(-5);
    assert.deepStrictEqual(plain(kennzahlen), ['Complete Demand', 'Authorized', 'Tip', 'Unmatched', 'Anz.'], b.name);
    assert.deepStrictEqual(plain(b.typen.slice(-5)), ['betrag', 'betrag', 'betrag', 'zahl', 'zahl'], b.name);
    assert.strictEqual(b.typen.length, b.header.length, b.name + ': typen passt zur Header-Laenge');
    b.rows.forEach(r => assert.strictEqual(r.length, b.header.length, b.name + ': Zeilenbreite'));
  });
});

test('Export-Bloecke: Authorized traegt die Differenz, Detail-Zeile mit offener Autorisierung', () => {
  const rows = [
    row('T1', 'Bar 1', 'Visa', 100000000, 100000000),
    row('T1', 'Bar 1', 'Mastercard', 0, 250000000, { count: 0 }),
  ];
  const bloecke = reportExportBloecke(buildReportModel(rows, {}));
  const detail = bloecke.find(b => b.name === 'Detail');
  const mc = detail.rows.find(r => r[3] === 'Mastercard');
  assert.deepStrictEqual(plain(mc), ['Bar', 'Bar 1', 'T1', 'Mastercard', 'Wallee', 0, 2.5, 0, 0, 0]);
  const gesamt = bloecke.find(b => b.name === 'Gesamttotal');
  assert.deepStrictEqual(plain(gesamt.rows[0]), ['Total', 1, 3.5, 0, 0, 1]);
});

test('CSV-Export: Hinweis G2 als letzte Zeile nach einer Leerzeile', () => {
  const csv = buildReportCsv(modell());
  const zeilen = csv.replace(/\r\n$/, '').split('\r\n');
  assert.strictEqual(zeilen[zeilen.length - 1], G2);
  assert.strictEqual(zeilen[zeilen.length - 2], '');
  assert.ok(zeilen.slice(0, -2).some(z => /;Authorized;/.test(z)), 'Kopfzeile mit Authorized');
});

// --- Variante kondensiert (v5.14, SPEC-ITERATION-2 §5.2) --------------------
//
// Full = byte-identisch zu den Bloecken oben; kondensiert = eine Detail-Zeile
// je Terminal x Brand-Gruppe (Marken summiert), Unmatched und Anz. in ALLEN
// Bloecken weg. Die Verdichtung passiert hier in der Blockschicht, nicht in
// einem zweiten Modell.

const KENNZAHLEN_FULL = ['Complete Demand', 'Authorized', 'Tip', 'Unmatched', 'Anz.'];
const KENNZAHLEN_KONDENSIERT = ['Complete Demand', 'Authorized', 'Tip'];

test('Variante: Default und unbekannter Wert ergeben Full', () => {
  const m = modell();
  const standard = plain(reportExportBloecke(m));
  assert.deepStrictEqual(plain(reportExportBloecke(m, { variante: 'full' })), standard);
  assert.deepStrictEqual(plain(reportExportBloecke(m, {})), standard);
  assert.deepStrictEqual(plain(reportExportBloecke(m, { variante: 'irgendwas' })), standard);
});

test('Kondensiert: dieselben vier Bloecke, Kennzahlen ohne Unmatched und Anz.', () => {
  const bloecke = reportExportBloecke(modell(), { variante: 'kondensiert' });
  assert.deepStrictEqual(plain(bloecke.map(b => b.name)), [
    'Total Outlet-Gruppen', 'Total Brand-Gruppen', 'Gesamttotal', 'Detail',
  ]);
  bloecke.forEach(b => {
    assert.deepStrictEqual(plain(b.header.slice(-3)), KENNZAHLEN_KONDENSIERT, b.name);
    assert.ok(!b.header.includes('Unmatched') && !b.header.includes('Anz.'), b.name);
    assert.deepStrictEqual(plain(b.typen.slice(-3)), ['betrag', 'betrag', 'betrag'], b.name);
    assert.strictEqual(b.typen.length, b.header.length, b.name + ': typen passt zur Header-Laenge');
    b.rows.forEach(r => assert.strictEqual(r.length, b.header.length, b.name + ': Zeilenbreite'));
  });
});

test('Kondensiert: Detail ohne Marke, eine Zeile je Terminal x Brand-Gruppe, Marken summiert', () => {
  const rows = [
    row('T1', 'Bar 1', 'Visa',        10000000, 10000000),           // 0.10
    row('T1', 'Bar 1', 'Mastercard',  20000000, 45000000),           // 0.20 / 0.45
    row('T1', 'Bar 1', 'Lunch Check',  5000000,  5000000, { tip: 1000000 }),  // 0.05, Tip 0.01
    row('T2', 'Bar 2', 'Visa',       100000000, 100000000),
  ];
  const detail = reportExportBloecke(buildReportModel(rows, {}), { variante: 'kondensiert' })
    .find(b => b.name === 'Detail');
  assert.deepStrictEqual(plain(detail.header),
    ['Outlet-Gruppe', 'Terminal', 'TID', 'Brand-Gruppe', ...KENNZAHLEN_KONDENSIERT]);
  assert.deepStrictEqual(plain(detail.typen), ['text', 'text', 'text', 'text', 'betrag', 'betrag', 'betrag']);
  assert.deepStrictEqual(plain(detail.rows), [
    ['Bar', 'Bar 1', 'T1', 'Lunch-Check', 0.05, 0.05, 0.01],
    ['Bar', 'Bar 1', 'T1', 'Wallee', 0.3, 0.55, 0],     // exakt 0.3, in Einheiten summiert
    ['Bar', 'Bar 2', 'T2', 'Wallee', 1, 1, 0],
  ]);
});

test('Kondensiert: Totale je Brand-Gruppe und Gesamttotal stimmen mit Full ueberein (A3)', () => {
  const m = modell();
  const full = reportExportBloecke(m);
  const kond = reportExportBloecke(m, { variante: 'kondensiert' });
  ['Total Outlet-Gruppen', 'Total Brand-Gruppen', 'Gesamttotal'].forEach(name => {
    const f = full.find(b => b.name === name), k = kond.find(b => b.name === name);
    const textSpalten = f.header.length - KENNZAHLEN_FULL.length;
    const erwartet = f.rows.map(r => r.slice(0, textSpalten + 3));
    assert.deepStrictEqual(plain(k.rows), plain(erwartet), name);
  });
  // Die verdichteten Detail-Zeilen summieren sich auf das Gesamttotal.
  const detail = kond.find(b => b.name === 'Detail');
  const summe = detail.rows.reduce((a, r) => a + r[4], 0);
  assert.strictEqual(Math.round(summe * 100) / 100, 62756.16);
  assert.strictEqual(detail.rows.length, m.detail.reduce((a, o) =>
    a + o.terminals.reduce((b, t) => b + new Set(t.brands.map(x => x.brandGroup)).size, 0), 0));
});

test('Full bleibt Full: die Marke steht im Detail, alle fuenf Kennzahlen', () => {
  const detail = reportExportBloecke(modell(), { variante: 'full' }).find(b => b.name === 'Detail');
  assert.deepStrictEqual(plain(detail.header),
    ['Outlet-Gruppe', 'Terminal', 'TID', 'Marke', 'Brand-Gruppe', ...KENNZAHLEN_FULL]);
});

test('CSV bleibt Full (Variante ist eine Excel-Entscheidung, §5.1)', () => {
  const csv = buildReportCsv(modell());
  assert.ok(csv.includes(';Marke;'));
  assert.ok(csv.includes(';Unmatched;Anz.'));
});
