// Tests fuer die gemeinsame XLSX-Finalisierung (SPEC-ITERATION-2 §5.3-5.5):
// Spaltenbreiten, Seitenlayout, Drucktitel und die ZIP-Nachbearbeitung
// xlsxSeitenlayoutEinbetten - alles reine Funktionen auf Blatt-Objekten bzw.
// Strings, ohne Vendor (der End-to-End-Pfad mit dem Vendor steht in
// test/report-xlsx.test.js).

const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders, plain } = require('./harness');

const { xlsxZellAdresse, xlsxZahlAnzeige, xlsxSpaltenbreiten, xlsxSeitenlayout,
  xlsxBlattFinalisieren, xlsxSeitenlayoutEinbetten, xlsxDruckTitelRef, XLSX_RAENDER } = loadBuilders();

// Blatt von Hand: { A1: {t,v,...}, '!ref': ..., '!merges': [...] }
function blatt(zellen, extra) {
  return Object.assign({}, zellen, extra || {});
}

test('xlsxZellAdresse: A1, Z9, AA1, AB12 und Unsinn', () => {
  assert.deepStrictEqual(plain(xlsxZellAdresse('A1')), { r: 0, c: 0 });
  assert.deepStrictEqual(plain(xlsxZellAdresse('Z9')), { r: 8, c: 25 });
  assert.deepStrictEqual(plain(xlsxZellAdresse('AA1')), { r: 0, c: 26 });
  assert.deepStrictEqual(plain(xlsxZellAdresse('AB12')), { r: 11, c: 27 });
  assert.deepStrictEqual(plain(xlsxZellAdresse('!cols')), { r: -1, c: -1 });
});

test('xlsxZahlAnzeige: Formate der App ergeben den Excel-Anzeigetext', () => {
  assert.strictEqual(xlsxZahlAnzeige(1234567.891, '#,##0.00'), '1’234’567.89');
  assert.strictEqual(xlsxZahlAnzeige(1234567.89, '#,##0.00" CHF"'), '1’234’567.89 CHF');
  assert.strictEqual(xlsxZahlAnzeige(2070, '#,##0'), '2’070');
  assert.strictEqual(xlsxZahlAnzeige(-5.5, '#,##0.00'), '-5.50');
  assert.strictEqual(xlsxZahlAnzeige(98.63, '0.0"%"'), '98.6%');
  assert.strictEqual(xlsxZahlAnzeige(3, '0.00'), '3.00');
  assert.strictEqual(xlsxZahlAnzeige(42, undefined), '42');
  assert.strictEqual(xlsxZahlAnzeige(42, 'General'), '42');
});

// Einheit ist Excels Ziffernbreite (Calibri 11): Text x 0.88, Schrift sz/11,
// fett x 1.1, dazu 1 Polster (v5.14.1 - "laenge + 2" war sichtbar zu breit).
test('xlsxSpaltenbreiten: laengster Anzeigetext in Ziffernbreiten, Zahlen voll, Text 0.88, fett x 1.1', () => {
  const ws = blatt({
    A1: { t: 's', v: 'Terminal', s: { font: { bold: true } } },            // 8 * 0.88 * 1.1 + 1 = 8.74 -> 9
    B1: { t: 's', v: 'Complete Demand', s: { font: { bold: true } } },     // 15 * 0.88 * 1.1 + 1 = 15.52 -> 16
    A2: { t: 's', v: 'Terrasse Ost, Gartenpavillon beim Brunnen 12' },     // 44 * 0.88 + 1 = 39.72 -> 40
    B2: { t: 'n', v: 1234567.89, z: '#,##0.00' },                          // '1’234’567.89' = 12 + 1 = 13
    A3: { t: 's', v: 'Bar 1' },
    B3: { t: 'n', v: 7.5, s: { numFmt: '#,##0.00" CHF"' } },               // '7.50 CHF' = 8 + 1 = 9
    '!ref': 'A1:B3',
  });
  assert.deepStrictEqual(plain(xlsxSpaltenbreiten(ws)), [{ wch: 40 }, { wch: 16 }]);
});

test('xlsxSpaltenbreiten: kleinere Schrift skaliert mit sz/11, Zahlen zaehlen voll', () => {
  const ws = blatt({
    A1: { t: 's', v: 'Mastercard Maestro', s: { font: { sz: 10 } } },     // 18 * 0.88 * 10/11 + 1 = 15.4 -> 16
    B1: { t: 'n', v: 1234567.89, z: '#,##0.00', s: { font: { sz: 10 } } }, // 12 * 10/11 + 1 = 11.9 -> 12
    '!ref': 'A1:B1',
  });
  assert.deepStrictEqual(plain(xlsxSpaltenbreiten(ws)), [{ wch: 16 }, { wch: 12 }]);
});

test('xlsxSpaltenbreiten: verbundene Zellen werden nicht gemessen, Unter- und Obergrenze greifen', () => {
  const hinweis = 'H'.repeat(120);
  const ws = blatt({
    A1: { t: 's', v: hinweis },                    // ueber A1:D1 verbunden -> nicht gemessen
    A2: { t: 's', v: 'x' },                        // 1.88 -> Untergrenze 6
    B2: { t: 's', v: 'y'.repeat(70) },             // 62.6 -> Obergrenze 60 + wrapText
    C2: { t: 'n', v: 1 },
    '!ref': 'A1:D2',
    '!merges': [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }],
  });
  const cols = xlsxSpaltenbreiten(ws);
  assert.deepStrictEqual(plain(cols), [{ wch: 6 }, { wch: 60 }, { wch: 6 }, { wch: 6 }]);
  assert.strictEqual(ws.B2.s.alignment.wrapText, true, 'ueberlanger Text bekommt den Umbruch');
  assert.strictEqual(ws.A1.s.alignment.wrapText, true, 'ueberlanger Hinweis in verbundener Zelle ebenso');
  assert.strictEqual(ws.A2.s, undefined, 'kurze Zelle bleibt ohne Stil');
});

test('xlsxSpaltenbreiten: eine Verbindung ueber nur eine Spalte zaehlt als normale Zelle', () => {
  const ws = blatt({
    A1: { t: 's', v: 'Zwanzig Zeichen lang' },
    '!ref': 'A1:A2',
    '!merges': [{ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }],
  });
  assert.deepStrictEqual(plain(xlsxSpaltenbreiten(ws)), [{ wch: 19 }]);   // 20 * 0.88 + 1
});

test('xlsxSeitenlayout: Hochformat bis 8 Spalten, Querformat ab 9, Override moeglich', () => {
  assert.deepStrictEqual(plain(xlsxSeitenlayout(8)),
    { paperSize: 9, orientation: 'portrait', fitToWidth: 1, fitToHeight: 0 });
  assert.strictEqual(xlsxSeitenlayout(9).orientation, 'landscape');
  assert.strictEqual(xlsxSeitenlayout(3, true).orientation, 'landscape');
  assert.strictEqual(xlsxSeitenlayout(12, false).orientation, 'portrait');
});

test('xlsxBlattFinalisieren: !cols, !margins, !pageSetup und Drucktitel', () => {
  const ws = blatt({ A1: { t: 's', v: 'Kopf', s: { font: { bold: true } } }, A2: { t: 's', v: 'a' }, '!ref': 'A1:A2' });
  const ergebnis = xlsxBlattFinalisieren(ws, { kopfZeile: 0 });
  assert.strictEqual(ergebnis, ws);
  assert.deepStrictEqual(plain(ws['!cols']), [{ wch: 6 }]);   // 4 * 0.88 * 1.1 + 1 = 4.9 -> Untergrenze
  assert.deepStrictEqual(plain(ws['!margins']), plain(XLSX_RAENDER));
  assert.deepStrictEqual(plain(XLSX_RAENDER), { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 });
  assert.deepStrictEqual(plain(ws['!pageSetup']), { paperSize: 9, orientation: 'portrait', fitToWidth: 1, fitToHeight: 0 });
  assert.strictEqual(ws['!druckTitel'], 0);
  // ohne kopfZeile kein Drucktitel; Querformat erzwingbar
  const ws2 = xlsxBlattFinalisieren(blatt({ A1: { t: 's', v: 'a' }, '!ref': 'A1' }), { querformat: true });
  assert.strictEqual('!druckTitel' in ws2, false);
  assert.strictEqual(ws2['!pageSetup'].orientation, 'landscape');
});

test('xlsxBlattFinalisieren: Blattbreite kommt aus !ref, auch fuer leere Spalten', () => {
  const ws = blatt({ A1: { t: 's', v: 'a' }, '!ref': 'A1:E1' });
  xlsxBlattFinalisieren(ws, {});
  assert.strictEqual(ws['!cols'].length, 5);
});

test('xlsxDruckTitelRef: Blattname in einfachen Anfuehrungszeichen, verdoppelt falls enthalten', () => {
  assert.strictEqual(xlsxDruckTitelRef('Terminal-Report', 5), "'Terminal-Report'!$6:$6");
  assert.strictEqual(xlsxDruckTitelRef("Händler's Blatt", 0), "'Händler''s Blatt'!$1:$1");
});

// --- xlsxSeitenlayoutEinbetten ------------------------------------------------

const WS_ANFANG = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
const SHEETDATA = '<dimension ref="A1:B2"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>'
  + '<sheetData><row r="1"><c r="A1" t="str"><v>a</v></c></row></sheetData>';
const MARGINS = '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>';
const LAYOUT = { paperSize: 9, orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };
const PAGESETUP = '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
const FIT = '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>';

test('Einbetten: sheetPr als erstes Kind von worksheet, pageSetup direkt nach pageMargins', () => {
  const xml = WS_ANFANG + SHEETDATA + MARGINS + '</worksheet>';
  const neu = xlsxSeitenlayoutEinbetten(xml, LAYOUT);
  assert.strictEqual(neu, WS_ANFANG + FIT + SHEETDATA + MARGINS + PAGESETUP + '</worksheet>');
});

test('Einbetten ist idempotent: zweimal anwenden = einmal', () => {
  const xml = WS_ANFANG + SHEETDATA + MARGINS + '</worksheet>';
  const einmal = xlsxSeitenlayoutEinbetten(xml, LAYOUT);
  assert.strictEqual(xlsxSeitenlayoutEinbetten(einmal, LAYOUT), einmal);
  assert.strictEqual((einmal.match(/<pageSetup\b/g) || []).length, 1);
  assert.strictEqual((einmal.match(/<sheetPr\b/g) || []).length, 1);
});

test('Einbetten: vorhandenes selbstschliessendes sheetPr wird ergaenzt, nicht verdoppelt', () => {
  const xml = WS_ANFANG + '<sheetPr codeName="Blatt1"/>' + SHEETDATA + MARGINS + '</worksheet>';
  const neu = xlsxSeitenlayoutEinbetten(xml, LAYOUT);
  assert.ok(neu.includes('<sheetPr codeName="Blatt1"><pageSetUpPr fitToPage="1"/></sheetPr>'));
  assert.strictEqual((neu.match(/<sheetPr\b/g) || []).length, 1);
});

test('Einbetten: sheetPr mit Kindern bekommt pageSetUpPr als letztes Kind; ein vorhandenes wird ersetzt', () => {
  const mitTab = WS_ANFANG + '<sheetPr><tabColor rgb="FF11D9CC"/></sheetPr>' + SHEETDATA + MARGINS + '</worksheet>';
  const neu = xlsxSeitenlayoutEinbetten(mitTab, LAYOUT);
  assert.ok(neu.includes('<sheetPr><tabColor rgb="FF11D9CC"/><pageSetUpPr fitToPage="1"/></sheetPr>'));
  const mitAlt = WS_ANFANG + '<sheetPr><pageSetUpPr fitToPage="0"/></sheetPr>' + SHEETDATA + MARGINS + '</worksheet>';
  const neu2 = xlsxSeitenlayoutEinbetten(mitAlt, LAYOUT);
  assert.ok(neu2.includes('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'));
  assert.ok(!neu2.includes('fitToPage="0"'));
});

test('Einbetten: vorhandenes pageSetup wird ersetzt; ohne pageMargins vor headerFooter bzw. </worksheet>', () => {
  const mitAlt = WS_ANFANG + SHEETDATA + MARGINS + '<pageSetup orientation="portrait"/></worksheet>';
  const neu = xlsxSeitenlayoutEinbetten(mitAlt, LAYOUT);
  assert.strictEqual((neu.match(/<pageSetup\b/g) || []).length, 1);
  assert.ok(neu.includes(MARGINS + PAGESETUP));
  const ohneMargins = WS_ANFANG + SHEETDATA + '<headerFooter/></worksheet>';
  assert.ok(xlsxSeitenlayoutEinbetten(ohneMargins, LAYOUT).includes(SHEETDATA + PAGESETUP + '<headerFooter/>'));
  const nackt = WS_ANFANG + SHEETDATA + '</worksheet>';
  assert.ok(xlsxSeitenlayoutEinbetten(nackt, LAYOUT).endsWith(PAGESETUP + '</worksheet>'));
});

test('Einbetten: ohne Layout gilt Hochformat A4, eine Seite breit', () => {
  const neu = xlsxSeitenlayoutEinbetten(WS_ANFANG + SHEETDATA + MARGINS + '</worksheet>');
  assert.ok(neu.includes('<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>'));
});

test('Einbetten: $-Zeichen im XML ueberleben (Replacer-Funktion, kein Ersatz-String)', () => {
  const xml = WS_ANFANG + '<sheetData><row r="1"><c r="A1" t="str"><v>$&amp; $1 $` $\'</v></c></row></sheetData>' + MARGINS + '</worksheet>';
  const neu = xlsxSeitenlayoutEinbetten(xml, LAYOUT);
  assert.ok(neu.includes('<v>$&amp; $1 $` $\'</v>'));
});
