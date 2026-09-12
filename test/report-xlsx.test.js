// Prueft den XLSX-Export wirklich end-to-end: eingebettetes SheetJS aus der
// HTML-Datei laden, den Export laufen lassen, die erzeugte Mappe wieder
// EINLESEN und die Zahlen darin gegen die Sollwerte halten.
//
// Das ist die einzige Testdatei, die den 930-KB-Vendor-Block laedt. Alle
// uebrigen Tests bleiben bewusst unabhaengig davon (siehe test/harness.js) -
// aber der Export selbst waere sonst voellig ungeprueft, und dass eine Datei
// entsteht heisst noch lange nicht, dass die richtigen Werte drinstehen.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { plain } = require('./harness');

const APP = path.join(__dirname, '..', 'wallee_query_builder.html');
const html = fs.readFileSync(APP, 'utf8');

function blockInhalt(id) {
  const open = `<script id="${id}">`;
  const start = html.indexOf(open);
  const from = start + open.length;
  return html.slice(from, html.indexOf('</script>', from));
}

// --- Sandbox mit SheetJS ---------------------------------------------------

function stubElement() {
  const el = {
    textContent: '', innerHTML: '', value: '', checked: false,
    dataset: {}, style: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    removeChild() {}, setAttribute() {}, getAttribute: () => null,
    removeAttribute() {}, focus() {}, blur() {}, select() {}, click() {},
    closest: () => null, querySelector: () => stubElement(), querySelectorAll: () => [],
  };
  return el;
}

// Faengt ab, was downloadDatei() an den Browser reichen wuerde.
const downloads = [];

const sandbox = {
  console, setTimeout, clearTimeout, Buffer, Uint8Array, Date, Math, JSON,
  TextEncoder, TextDecoder, Blob,
  URL: {
    createObjectURL(blob) { downloads.push(blob); return 'blob:test'; },
    revokeObjectURL() {},
  },
  document: {
    getElementById: () => stubElement(),
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    createElement: () => stubElement(),
    createRange: () => ({ selectNodeContents() {} }),
    addEventListener() {},
    body: stubElement(),
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
  window: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }), print() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  __x: {},
};
sandbox.global = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// Erst der Vendor-Block, dann der App-Code - genau die Reihenfolge, in der sie
// auch im Browser stehen.
vm.runInContext(blockInhalt('vendor-xlsx'), sandbox, { filename: 'vendor-xlsx.js' });
vm.runInContext(
  blockInhalt('app-logic') +
  '\n;globalThis.__x.parseReportCsv = parseReportCsv;' +
  '\n;globalThis.__x.buildReportModel = buildReportModel;' +
  '\n;globalThis.__x.exportReportXlsx = exportReportXlsx;' +
  '\n;globalThis.__x.xlsxSeitenlayoutEinbetten = xlsxSeitenlayoutEinbetten;' +
  '\n;globalThis.__x.setzeReportZeitraum = z => { reportZeitraum = z; };' +
  '\n;globalThis.__x.setzeReportSpaces = sp => { reportSpaces = sp; };',
  sandbox, { filename: 'app-logic.js' },
);

const { parseReportCsv, buildReportModel, exportReportXlsx, xlsxSeitenlayoutEinbetten, setzeReportZeitraum, setzeReportSpaces } = sandbox.__x;
const XLSX = sandbox.XLSX;
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'beispiel-daten.csv'), 'utf8');

// Faengt zusaetzlich den Dateinamen ab (a.download), den downloadDatei setzt.
const dateinamen = [];
sandbox.document.createElement = () => {
  const el = stubElement();
  Object.defineProperty(el, 'download', { set(v) { dateinamen.push(v); }, get() { return ''; } });
  return el;
};

async function exportiereUndLies(csv, variante) {
  downloads.length = 0;
  dateinamen.length = 0;
  const res = parseReportCsv(csv || FIXTURE);
  assert.strictEqual(res.error, null);
  exportReportXlsx(buildReportModel(res.rows, {}), variante);

  assert.strictEqual(downloads.length, 1, 'Export muss genau eine Datei erzeugen');
  const bytes = new Uint8Array(await downloads[0].arrayBuffer());
  // cellNF: true, sonst fuellt SheetJS beim Lesen das Feld .z gar nicht -
  // das Format steht dann trotzdem in der Datei, nur unsichtbar fuer den Test.
  // cellStyles: dasselbe fuer .s (Orange-Markierung).
  return { bytes, wb: XLSX.read(bytes, { type: 'array', cellNF: true, cellStyles: true }),
    dateiname: dateinamen[0] };
}

// Das rohe Blatt-XML aus dem ZIP - fuer alles, was der Reader nicht zurueckgibt
// (pageSetup, sheetPr). CFB liest ZIP-Container, der Pfad braucht das '/'.
function sheetXml(bytes, n) {
  const cfb = XLSX.CFB.read(bytes, { type: 'buffer' });
  const datei = XLSX.CFB.find(cfb, `/xl/worksheets/sheet${n || 1}.xml`);
  assert.ok(datei, 'sheet' + (n || 1) + '.xml fehlt im ZIP');
  return new TextDecoder().decode(datei.content);
}
function workbookXml(bytes) {
  const cfb = XLSX.CFB.read(bytes, { type: 'buffer' });
  return new TextDecoder().decode(XLSX.CFB.find(cfb, '/xl/workbook.xml').content);
}
// Schriftfarbe einer Zelle: der Reader liefert in .s nur die Fuellung, die
// Schrift steht in xl/styles.xml (Zelle s="N" -> cellXfs[N].fontId -> fonts).
function zellenSchriftfarbe(bytes, ref) {
  const cfb = XLSX.CFB.read(bytes, { type: 'buffer' });
  const sheet = new TextDecoder().decode(XLSX.CFB.find(cfb, '/xl/worksheets/sheet1.xml').content);
  const styles = new TextDecoder().decode(XLSX.CFB.find(cfb, '/xl/styles.xml').content);
  const zelle = new RegExp(`<c r="${ref}"[^>]*\\bs="(\\d+)"`).exec(sheet);
  assert.ok(zelle, `Zelle ${ref} ohne Stilindex`);
  const xfs = (styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0].match(/<xf\b[^>]*>/g);
  const fontId = /fontId="(\d+)"/.exec(xfs[Number(zelle[1])])[1];
  const fonts = (styles.match(/<fonts[\s\S]*?<\/fonts>/) || [''])[0].match(/<font>[\s\S]*?<\/font>/g);
  const farbe = /<color rgb="([0-9A-Fa-f]+)"/.exec(fonts[Number(fontId)]);
  return farbe ? farbe[1].toUpperCase().slice(-6) : null;
}

// --- Tests -----------------------------------------------------------------

// Alle Abschnitte liegen jetzt in EINEM Blatt "Terminal-Report" untereinander
// (wie der PDF-Report), nicht mehr in vier Tabs. Diese Helfer finden einen
// Abschnitt an seiner Titelzeile.
function blattZeilen(wb) {
  return XLSX.utils.sheet_to_json(wb.Sheets['Terminal-Report'], { header: 1, blankrows: true });
}
function titelZeile(zeilen, name) {
  const t = zeilen.findIndex(z => (z[0] || '') === name);
  assert.notStrictEqual(t, -1, `Abschnitt "${name}" fehlt im Blatt`);
  return t;                 // Titel bei t, Spaltenkopf bei t+1, Daten ab t+2
}
// Datenzeilen eines Abschnitts bis zur naechsten Leerzeile.
function abschnittDaten(zeilen, name) {
  const t = titelZeile(zeilen, name);
  const daten = [];
  for (let i = t + 2; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (!z || z.length === 0 || (z.length === 1 && z[0] === '')) break;
    daten.push(z);
  }
  return daten;
}

test('XLSX-Export erzeugt eine gueltige Arbeitsmappe mit EINEM Blatt', async () => {
  const { bytes, wb } = await exportiereUndLies();
  assert.strictEqual(bytes[0], 0x50);   // "PK" - ein XLSX ist ein ZIP.
  assert.strictEqual(bytes[1], 0x4b);
  assert.ok(bytes.length > 2000, 'Datei wirkt verdaechtig klein');
  // Alles in einem Blatt (nicht mehr vier Tabs) - wie der PDF-Report.
  assert.deepStrictEqual(plain(wb.SheetNames), ['Terminal-Report']);
});

test('XLSX: Gesamttotal steht mit den richtigen Zahlen drin', async () => {
  const { wb } = await exportiereUndLies();
  const zeilen = blattZeilen(wb);
  const t = titelZeile(zeilen, 'Gesamttotal');
  // Seit v5.14.1 stehen die Kennzahlen jedes Blocks rechtsbuendig unter denen
  // des Detail-Blocks (10 Spalten im Full-Report), die Luecke ist leer.
  const PAD = ['', '', '', ''];
  assert.deepStrictEqual(plain(zeilen[t + 1]), ['', ...PAD, 'Complete Demand', 'Authorized', 'Tip', 'Unmatched', 'Anz.']);
  assert.deepStrictEqual(plain(zeilen[t + 2]), ['Total', ...PAD, 62756.16, 62756.16, 793.46, 889, 2070]);
});

test('XLSX: Betraege sind Zahlen mit Schweizer Zahlformat', async () => {
  const { wb } = await exportiereUndLies();
  const ws = wb.Sheets['Terminal-Report'];
  const t = titelZeile(blattZeilen(wb), 'Gesamttotal');
  const datenR = t + 2;                 // 0-basierter Zeilenindex der Total-Zeile
  const b = ws[XLSX.utils.encode_cell({ r: datenR, c: 5 })];   // Complete Demand (rechtsbuendig zum Detail)
  const d = ws[XLSX.utils.encode_cell({ r: datenR, c: 9 })];   // Anz.
  assert.strictEqual(b.t, 'n', 'Betrag muss als Zahl gespeichert sein, sonst kann Excel nicht rechnen');
  assert.strictEqual(b.v, 62756.16);
  assert.strictEqual(b.z, '#,##0.00', 'Betrag ohne Zahlformat');
  assert.strictEqual(d.z, '#,##0', 'Zaehler ohne Zahlformat');
});

test('XLSX: Brand-Totals vollstaendig und korrekt', async () => {
  const { wb } = await exportiereUndLies();
  const daten = abschnittDaten(blattZeilen(wb), 'Total Brand-Gruppen');
  assert.deepStrictEqual(plain(daten), [
    ['Lunch-Check', '', '', '', '', 31, 31, 0, 1, 2],
    ['Wallee', '', '', '', '', 62725.16, 62725.16, 793.46, 888, 2068],
  ]);
});

test('XLSX: Detail-Abschnitt hat eine Zeile je Terminal und Marke', async () => {
  const { wb } = await exportiereUndLies();
  const daten = abschnittDaten(blattZeilen(wb), 'Detail');
  const res = parseReportCsv(FIXTURE);
  assert.strictEqual(daten.length, res.rows.length, 'Detail muss jede CSV-Zeile abbilden');
});

test('XLSX: Summe der Outlet-Totals ergibt das Gesamttotal', async () => {
  const { wb } = await exportiereUndLies();
  const zeilen = blattZeilen(wb);
  const cCd = zeilen[titelZeile(zeilen, 'Total Outlet-Gruppen') + 1].indexOf('Complete Demand');
  const daten = abschnittDaten(zeilen, 'Total Outlet-Gruppen');
  const summe = daten.reduce((a, r) => a + r[cCd], 0);
  assert.strictEqual(Math.round(summe * 100) / 100, 62756.16);
});

// --- v5.14: Variante, Spaltenbreite, Druckbild, Autorisiert (SPEC-ITERATION-2 §4.3-5.4) ---

const G2 = 'Autorisiert = Summe der vom Kartenherausgeber freigegebenen Beträge. Weicht sie vom '
  + 'Complete Demand ab, fehlt für die Differenz eine Submission (Einreichung/Tagesabschluss am '
  + 'Terminal) — der Betrag ist freigegeben, aber noch nicht abgerechnet.';

const HEADER_V514 = '"space_id","terminal_identifier","terminal_name","brand","waehrung",'
  + '"anzahl_transaktionen","unsettled_anzahl","brutto_gross","autorisiert_gross","transaction_fee_total","netto","tip_total"';
// Ueberlange Terminal-Bezeichnung, siebenstelliger Betrag, offene Autorisierung.
const CSV_LANG = [
  HEADER_V514,
  '"1","T1","Terrasse Ost, Gartenpavillon beim Brunnen 12","Visa","CHF","3","0","1234567.89000000","1234567.89000000","0","0","0.00000000"',
  '"1","T1","Terrasse Ost, Gartenpavillon beim Brunnen 12","Mastercard","CHF","0","0","0.00000000","42.50000000","0","0","0.00000000"',
  '"1","T2","Bar 2","Visa","CHF","1","0","10.00000000","10.00000000","0","0","0.00000000"',
].join('\n');

test('XLSX: Dateiname und Titel je Variante', async () => {
  const full = await exportiereUndLies(FIXTURE, 'full');
  assert.match(full.dateiname, /^terminal-report_\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.strictEqual(blattZeilen(full.wb)[0][0], 'wallee — Terminal-Report');
  const kond = await exportiereUndLies(FIXTURE, 'kondensiert');
  assert.match(kond.dateiname, /^terminal-report-kondensiert_\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.strictEqual(blattZeilen(kond.wb)[0][0], 'wallee — Terminal-Report (kondensiert)');
  const standard = await exportiereUndLies(FIXTURE);
  assert.strictEqual(standard.dateiname, full.dateiname, 'ohne Angabe = Full');
});

test('XLSX kondensiert: keine Marke, kein Unmatched, kein Anz., Summen wie Full (A3)', async () => {
  const { wb } = await exportiereUndLies(FIXTURE, 'kondensiert');
  const zeilen = blattZeilen(wb);
  const t = titelZeile(zeilen, 'Detail');
  assert.deepStrictEqual(plain(zeilen[t + 1]),
    ['Outlet-Gruppe', 'Terminal', 'TID', 'Brand-Gruppe', 'Complete Demand', 'Authorized', 'Tip']);
  const alleZellen = zeilen.flat().map(String);
  ['Marke', 'Unmatched', 'Anz.'].forEach(k => assert.ok(!alleZellen.includes(k), k + ' darf nicht vorkommen'));
  const brands = abschnittDaten(zeilen, 'Total Brand-Gruppen');
  assert.deepStrictEqual(plain(brands), [
    ['Lunch-Check', '', '', '', 31, 31, 0],
    ['Wallee', '', '', '', 62725.16, 62725.16, 793.46],
  ]);
  const g = titelZeile(zeilen, 'Gesamttotal');
  assert.deepStrictEqual(plain(zeilen[g + 2]), ['Total', '', '', '', 62756.16, 62756.16, 793.46]);
});

test('XLSX: Hinweis G2 unter "Erstellt am" und als Fussnote nach dem letzten Block', async () => {
  const { wb } = await exportiereUndLies();
  const ws = wb.Sheets['Terminal-Report'];
  const zeilen = blattZeilen(wb);
  assert.match(String(zeilen[1][0]), /^Erstellt am /);
  assert.match(String(zeilen[2][0]), /^Abfragezeitraum: /);
  assert.strictEqual(zeilen[3][0], G2, 'unter dem Abfragezeitraum');
  assert.strictEqual(zeilen[4].length, 0, 'Leerzeile danach');
  const letzte = zeilen.map(z => z[0]).filter(v => v !== undefined && v !== '');
  assert.strictEqual(letzte[letzte.length - 1], G2, 'Fussnote nach dem letzten Block');
  // ueber die Blattbreite verbunden
  const breite = Math.max(...zeilen.map(z => z.length));
  const merges = ws['!merges'].map(m => `${m.s.r}:${m.s.c}-${m.e.r}:${m.e.c}`);
  assert.ok(merges.includes(`3:0-3:${breite - 1}`), 'Hinweiszeile 3 ist verbunden');
  assert.ok(merges.includes(`2:0-2:${breite - 1}`), 'Zeitraumzeile 2 ist verbunden');
});

test('XLSX: Authorized orange nur bei Differenz, Differenz-Zelle rechts vom Gesamttotal', async () => {
  const { bytes, wb } = await exportiereUndLies(CSV_LANG);
  const ws = wb.Sheets['Terminal-Report'];
  const zeilen = blattZeilen(wb);
  const d = titelZeile(zeilen, 'Detail');
  const cAuth = zeilen[d + 1].indexOf('Authorized');
  const zeileMc = zeilen.findIndex((z, i) => i > d && z[3] === 'Mastercard');
  const zeileT2 = zeilen.findIndex((z, i) => i > d && z[1] === 'Bar 2');
  const refMc = XLSX.utils.encode_cell({ r: zeileMc, c: cAuth });
  const refT2 = XLSX.utils.encode_cell({ r: zeileT2, c: cAuth });
  assert.strictEqual(ws[refMc].v, 42.5);
  assert.strictEqual(zellenSchriftfarbe(bytes, refMc), 'FF4D00');
  assert.strictEqual(ws[refT2].v, 10);
  assert.strictEqual(zellenSchriftfarbe(bytes, refT2), '225956', 'ohne Differenz die normale Textfarbe');

  const g = titelZeile(zeilen, 'Gesamttotal');
  const total = zeilen[g + 2];
  // ['Total', '', '', '', '', CD, Auth, Tip, Unmatched, Anz., 'Differenz:', 42.5]
  assert.strictEqual(total[10], 'Differenz:');
  assert.strictEqual(total[11], 42.5);
  const refDiff = XLSX.utils.encode_cell({ r: g + 2, c: 11 });
  assert.strictEqual(ws[refDiff].z, '#,##0.00');
  assert.strictEqual(zellenSchriftfarbe(bytes, refDiff), 'FF4D00');
});

test('XLSX: ohne Differenz keine Differenz-Zelle', async () => {
  const { wb } = await exportiereUndLies();
  const zeilen = blattZeilen(wb);
  const g = titelZeile(zeilen, 'Gesamttotal');
  assert.strictEqual(zeilen[g + 2].length, 10);
  assert.ok(!zeilen.flat().includes('Differenz:'));
});

test('XLSX: Spaltenbreiten nach §5.4 - so schmal wie moeglich, nie abgeschnitten', async () => {
  const { wb } = await exportiereUndLies(CSV_LANG);
  const ws = wb.Sheets['Terminal-Report'];
  const cols = ws['!cols'].map(c => Math.round(c.wch));
  const zeilen = blattZeilen(wb);
  const d = titelZeile(zeilen, 'Detail');
  const kopf = zeilen[d + 1];
  // Terminal-Spalte: laengster Eintrag (44 Zeichen, Datenzelle 10 pt):
  // 44 * 0.88 * 10/11 + 1 = 36.2 -> 37
  assert.strictEqual(cols[kopf.indexOf('Terminal')], 37);
  // Complete Demand: fetter Kopf 11 pt 15 * 0.88 * 1.1 + 1 = 15.5 -> 16 schlaegt
  // den Betrag '1’234’567.89' (12 * 10/11 + 1 = 11.9 -> 12)
  assert.strictEqual(cols[kopf.indexOf('Complete Demand')], 16);
  // TID traegt nur noch TIDs: die Kennzahlen der Total-Bloecke stehen
  // rechtsbuendig unter denen des Detail-Blocks, nicht mehr in Spalte C.
  // 'T1' und der fette Kopf 'TID' (3 * 0.88 * 1.1 + 1 = 3.9) -> Untergrenze 6
  assert.strictEqual(cols[kopf.indexOf('TID')], 6);
  // Anz.: fetter Kopf 4 * 0.88 * 1.1 + 1 = 4.9 -> Untergrenze 6
  assert.strictEqual(cols[kopf.indexOf('Anz.')], 6);
  // nicht mehr die festen 18/15
  assert.ok(!cols.every((w, i) => w === (i < 3 ? 18 : 15)), 'feste Breiten sind Geschichte');
  // verbundene Hinweiszeile blaeht Spalte A nicht auf
  assert.ok(cols[0] < 60, 'Spalte A darf nicht auf Hinweislaenge wachsen');
});

test('XLSX: Raender, Seitenlayout (fitToWidth/fitToHeight/fitToPage/orientation) und Drucktitel', async () => {
  const { bytes, wb } = await exportiereUndLies();
  const ws = wb.Sheets['Terminal-Report'];
  assert.deepStrictEqual(plain(ws['!margins']),
    { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 });
  const xml = sheetXml(bytes);
  assert.match(xml, /<worksheet[^>]*><sheetPr><pageSetUpPr fitToPage="1"\/><\/sheetPr>/);
  assert.match(xml, /<pageMargins[^>]*\/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"\/>/,
    'Full hat 10 Spalten -> Querformat');
  assert.match(workbookXml(bytes), /<definedName name="_xlnm\.Print_Titles" localSheetId="0">&apos;Terminal-Report&apos;!\$7:\$7<\/definedName>/,
    'die erste tuerkise Kopfzeile (Zeile 7) als Drucktitel');
  // kondensiert: 7 Spalten -> Hochformat
  const kond = await exportiereUndLies(FIXTURE, 'kondensiert');
  assert.match(sheetXml(kond.bytes), /orientation="portrait"/);
});

test('XLSX: die Nachbearbeitung ist der Vendor-Pfad plus xlsxSeitenlayoutEinbetten - Datei bleibt lesbar', async () => {
  const { bytes, wb } = await exportiereUndLies();
  assert.strictEqual(bytes[0], 0x50);
  assert.deepStrictEqual(plain(wb.SheetNames), ['Terminal-Report']);
  const xml = sheetXml(bytes);
  assert.strictEqual(xlsxSeitenlayoutEinbetten(xml, { orientation: 'landscape' }), xml, 'idempotent auf der echten Datei');
});

test('XLSX: Kennzahlen aller Bloecke stehen in denselben Spalten wie im Detail-Block', async () => {
  const { wb } = await exportiereUndLies();
  const zeilen = blattZeilen(wb);
  const detailKopf = zeilen[titelZeile(zeilen, 'Detail') + 1];
  const cCd = detailKopf.indexOf('Complete Demand');
  ['Total Outlet-Gruppen', 'Total Brand-Gruppen', 'Gesamttotal'].forEach(name => {
    const kopf = zeilen[titelZeile(zeilen, name) + 1];
    assert.strictEqual(kopf.indexOf('Complete Demand'), cCd, name);
    assert.strictEqual(kopf.indexOf('Anz.'), detailKopf.indexOf('Anz.'), name);
    abschnittDaten(zeilen, name).forEach(r => assert.strictEqual(typeof r[cCd], 'number', name + ': Betrag unter Betrag'));
  });
});

test('XLSX: Abfragezeitraum unter "Erstellt am" - aus dem Zeitraum der Abfrage, sonst Strich', async () => {
  setzeReportZeitraum({ start: '2026-07-01 00:00:00', end: '2026-08-01 00:00:00' });
  let { wb } = await exportiereUndLies();
  assert.strictEqual(blattZeilen(wb)[2][0], 'Abfragezeitraum: 01.07.2026 – 31.07.2026',
    'Ende 00:00:00 ist exklusiv, letzter Tag ist der 31.07.');
  setzeReportZeitraum('2026-07-01 → 2026-07-31');
  ({ wb } = await exportiereUndLies());
  assert.strictEqual(blattZeilen(wb)[2][0], 'Abfragezeitraum: 2026-07-01 → 2026-07-31', 'alter Verlaufseintrag: Tages-Zusammenfassung');
  setzeReportZeitraum(null);
  ({ wb } = await exportiereUndLies());
  assert.strictEqual(blattZeilen(wb)[2][0], 'Abfragezeitraum: –');
});

test('XLSX: Dateiname traegt Space und Abfragezeitraum (v5.14.3)', async () => {
  setzeReportZeitraum({ start: '2026-07-01 00:00:00', end: '2026-08-01 00:00:00' });
  setzeReportSpaces([{ id: '123', label: 'Jade Lounge' }]);
  const full = await exportiereUndLies(FIXTURE, 'full');
  assert.strictEqual(full.dateiname, 'terminal-report_Jade-Lounge_2026-07-01_2026-07-31.xlsx');
  const kond = await exportiereUndLies(FIXTURE, 'kondensiert');
  assert.strictEqual(kond.dateiname, 'terminal-report-kondensiert_Jade-Lounge_2026-07-01_2026-07-31.xlsx');
  setzeReportZeitraum(null);
  setzeReportSpaces([]);
});
