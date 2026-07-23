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
  assert.deepStrictEqual(plain(zeilen[t + 1]), ['', 'Complete Demand', 'Tip', 'Unmatched', 'Anz.']);
  assert.deepStrictEqual(plain(zeilen[t + 2]), ['Total', 62756.16, 793.46, 889, 2070]);
});

test('XLSX: Betraege sind Zahlen mit Schweizer Zahlformat', async () => {
  const { wb } = await exportiereUndLies();
  const ws = wb.Sheets['Terminal-Report'];
  const t = titelZeile(blattZeilen(wb), 'Gesamttotal');
  const datenR = t + 2;                 // 0-basierter Zeilenindex der Total-Zeile
  const b = ws[XLSX.utils.encode_cell({ r: datenR, c: 1 })];   // Complete Demand
  const d = ws[XLSX.utils.encode_cell({ r: datenR, c: 3 })];   // Anz.
  assert.strictEqual(b.t, 'n', 'Betrag muss als Zahl gespeichert sein, sonst kann Excel nicht rechnen');
  assert.strictEqual(b.v, 62756.16);
  assert.strictEqual(b.z, '#,##0.00', 'Betrag ohne Zahlformat');
  assert.strictEqual(d.z, '#,##0', 'Zaehler ohne Zahlformat');
});

test('XLSX: Brand-Totals vollstaendig und korrekt', async () => {
  const { wb } = await exportiereUndLies();
  const daten = abschnittDaten(blattZeilen(wb), 'Total Brand-Gruppen');
  assert.deepStrictEqual(plain(daten), [
    ['Lunch-Check', 31, 0, 1, 2],
    ['Wallee', 62725.16, 793.46, 888, 2068],
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
  const daten = abschnittDaten(blattZeilen(wb), 'Total Outlet-Gruppen');
  const summe = daten.reduce((a, r) => a + r[2], 0);
  assert.strictEqual(Math.round(summe * 100) / 100, 62756.16);
});
