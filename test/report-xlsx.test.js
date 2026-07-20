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

const APP = path.join(__dirname, '..', 'wallee_query_builder_v2.html');
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
  '\n;globalThis.__x.exportReportXlsx = exportReportXlsx;',
  sandbox, { filename: 'app-logic.js' },
);

const { parseReportCsv, buildReportModel, exportReportXlsx } = sandbox.__x;
const XLSX = sandbox.XLSX;
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'beispiel-daten.csv'), 'utf8');

async function exportiereUndLies() {
  downloads.length = 0;
  const res = parseReportCsv(FIXTURE);
  assert.strictEqual(res.error, null);
  exportReportXlsx(buildReportModel(res.rows, {}));

  assert.strictEqual(downloads.length, 1, 'Export muss genau eine Datei erzeugen');
  const bytes = new Uint8Array(await downloads[0].arrayBuffer());
  // cellNF: true, sonst fuellt SheetJS beim Lesen das Feld .z gar nicht -
  // das Format steht dann trotzdem in der Datei, nur unsichtbar fuer den Test.
  return { bytes, wb: XLSX.read(bytes, { type: 'array', cellNF: true }) };
}

// --- Tests -----------------------------------------------------------------

test('XLSX-Export erzeugt eine gueltige Arbeitsmappe', async () => {
  const { bytes, wb } = await exportiereUndLies();

  // "PK" - ein XLSX ist ein ZIP.
  assert.strictEqual(bytes[0], 0x50);
  assert.strictEqual(bytes[1], 0x4b);
  assert.ok(bytes.length > 2000, 'Datei wirkt verdaechtig klein');
  assert.deepStrictEqual(plain(wb.SheetNames),
    ['Total Outlet-Gruppen', 'Total Brand-Gruppen', 'Gesamttotal', 'Detail']);
});

test('XLSX: Gesamttotal steht mit den richtigen Zahlen drin', async () => {
  const { wb } = await exportiereUndLies();
  const zeilen = XLSX.utils.sheet_to_json(wb.Sheets['Gesamttotal'], { header: 1 });

  assert.deepStrictEqual(plain(zeilen[0]), ['', 'Complete Demand', 'Tip', 'Unmatched', 'Anz.']);
  assert.deepStrictEqual(plain(zeilen[1]), ['Total', 62756.16, 793.46, 889, 2070]);
});

test('XLSX: Betraege sind Zahlen, keine Texte', async () => {
  const { wb } = await exportiereUndLies();
  const ws = wb.Sheets['Gesamttotal'];

  // B2 = Complete Demand des Gesamttotals
  assert.strictEqual(ws['B2'].t, 'n', 'Betrag muss als Zahl gespeichert sein, sonst kann Excel nicht rechnen');
  assert.strictEqual(ws['B2'].v, 62756.16);
});

test('XLSX: Betragsspalten tragen das Schweizer Zahlformat', async () => {
  const { wb } = await exportiereUndLies();
  const ws = wb.Sheets['Gesamttotal'];

  assert.strictEqual(ws['B2'].z, '#,##0.00', 'Betrag ohne Zahlformat');
  assert.strictEqual(ws['D2'].z, '#,##0', 'Zaehler ohne Zahlformat');
});

test('XLSX: Brand-Totals vollstaendig und korrekt', async () => {
  const { wb } = await exportiereUndLies();
  const zeilen = XLSX.utils.sheet_to_json(wb.Sheets['Total Brand-Gruppen'], { header: 1 });

  assert.deepStrictEqual(plain(zeilen.slice(1)), [
    ['Lunch-Check', 31, 0, 1, 2],
    ['Wallee', 62725.16, 793.46, 888, 2068],
  ]);
});

test('XLSX: Detail-Blatt hat eine Zeile je Terminal und Marke', async () => {
  const { wb } = await exportiereUndLies();
  const zeilen = XLSX.utils.sheet_to_json(wb.Sheets['Detail'], { header: 1 });

  const res = parseReportCsv(FIXTURE);
  assert.strictEqual(zeilen.length - 1, res.rows.length,
    'Detail muss jede CSV-Zeile abbilden');
});

test('XLSX: Summe der Outlet-Totals ergibt das Gesamttotal', async () => {
  const { wb } = await exportiereUndLies();
  const zeilen = XLSX.utils.sheet_to_json(wb.Sheets['Total Outlet-Gruppen'], { header: 1 }).slice(1);

  const summe = zeilen.reduce((a, r) => a + r[2], 0);
  assert.strictEqual(Math.round(summe * 100) / 100, 62756.16);
});
