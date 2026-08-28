// XLSX-Export des Reporting-Reports end-to-end: eingebettetes xlsx-js-style aus
// der HTML-Datei laden, exportieren, die erzeugte Mappe wieder EINLESEN und die
// Werte darin gegen die Sollwerte halten.
//
// Gleiches Vorgehen wie test/report-xlsx.test.js - dass eine Datei entsteht,
// heisst noch lange nicht, dass die richtigen Zahlen und Zahlformate drinstehen.

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

vm.runInContext(blockInhalt('vendor-xlsx'), sandbox, { filename: 'vendor-xlsx.js' });
vm.runInContext(
  blockInhalt('app-logic') +
  '\n;globalThis.__x.ingestReportingCsv = ingestReportingCsv;' +
  '\n;globalThis.__x.exportReportingXlsx = exportReportingXlsx;',
  sandbox, { filename: 'app-logic.js' },
);

const { ingestReportingCsv, exportReportingXlsx } = sandbox.__x;
const XLSX = sandbox.XLSX;
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'reporting-beispiel.csv'), 'utf8');

async function exportiereUndLies() {
  downloads.length = 0;
  assert.strictEqual(ingestReportingCsv(FIXTURE), true);
  exportReportingXlsx();
  assert.strictEqual(downloads.length, 1, 'Export muss genau eine Datei erzeugen');
  const bytes = new Uint8Array(await downloads[0].arrayBuffer());
  // cellNF: sonst fuellt der Reader .z gar nicht - das Format steht dann in
  // der Datei, ist fuer den Test aber unsichtbar. cellStyles: dasselbe fuer .s.
  return { bytes, wb: XLSX.read(bytes, { type: 'array', cellNF: true, cellStyles: true }) };
}

// Zeilen eines Blattes als Array-of-Arrays.
function blattZeilen(wb, name) {
  const ws = wb.Sheets[name];
  assert.ok(ws, `Blatt "${name}" fehlt`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true });
}
function titelZeile(zeilen, name) {
  const t = zeilen.findIndex(z => (z[0] || '') === name);
  assert.notStrictEqual(t, -1, `Abschnitt "${name}" fehlt im Blatt`);
  return t;                 // Titel bei t, Spaltenkopf bei t+1, Daten ab t+2
}

test('XLSX: ein Blatt je Kanal, Titelblock voran', async () => {
  const { bytes, wb } = await exportiereUndLies();
  assert.strictEqual(bytes[0], 0x50);          // "PK" - ein XLSX ist ein ZIP
  assert.strictEqual(bytes[1], 0x4b);
  // Der Titelblock traegt kanal '' und bekommt sein eigenes Blatt; danach ein
  // Blatt je Kanal, mit den Abschnitten untereinander (Muster Terminal-Report).
  assert.deepStrictEqual(plain(wb.SheetNames), ['Reporting', 'POS', 'E-Com', 'Andere']);
});

test('XLSX: gebrandeter Titel steht ueber jedem Blatt', async () => {
  const { wb } = await exportiereUndLies();
  ['Reporting', 'POS', 'E-Com', 'Andere'].forEach(name => {
    const zeilen = blattZeilen(wb, name);
    assert.match(String(zeilen[0][0]), /^wallee — Reporting-Report/);
  });
});

test('XLSX: Abschnitte stehen untereinander, nicht in Tabs je Block', async () => {
  const { wb } = await exportiereUndLies();
  const zeilen = blattZeilen(wb, 'POS');
  // Alle POS-Bloecke in EINEM Blatt.
  ['POS · Kennzahlen', 'POS · Zahlungsmittel', 'POS · Verlauf'].forEach(n => titelZeile(zeilen, n));
});

test('XLSX: Betraege sind Zahlen, keine 1e-8-Einheiten und keine Strings', async () => {
  const { wb } = await exportiereUndLies();
  const ws = wb.Sheets['POS'];
  const zeilen = blattZeilen(wb, 'POS');
  const t = titelZeile(zeilen, 'POS · Zahlungsmittel');
  // Kopf bei t+1, erste Datenzeile (Visa) bei t+2, Betrag in Spalte 6.
  const zelle = ws[XLSX.utils.encode_cell({ r: t + 2, c: 6 })];
  assert.strictEqual(zelle.t, 'n', 'Betrag als Zahl, sonst kann Excel nicht rechnen');
  assert.strictEqual(zelle.v, 20671.88);
  assert.strictEqual(zelle.z, '#,##0.00');
});

test('XLSX: Prozente tragen das Zahlformat 0.0"%"', async () => {
  const { wb } = await exportiereUndLies();
  const ws = wb.Sheets['POS'];
  const t = titelZeile(blattZeilen(wb, 'POS'), 'POS · Zahlungsmittel');
  const zelle = ws[XLSX.utils.encode_cell({ r: t + 2, c: 3 })];   // Erfolg %
  assert.strictEqual(zelle.t, 'n');
  assert.strictEqual(zelle.v, 96.7, 'auf eine Nachkommastelle gerundet, damit 0.0"%" nicht luegt');
  assert.strictEqual(zelle.z, '0.0"%"');
});

test('XLSX: die Kachel-Wertspalte laeuft ueber reportingZellFormat', async () => {
  const { wb } = await exportiereUndLies();
  const ws = wb.Sheets['POS'];
  const zeilen = blattZeilen(wb, 'POS');
  const t = titelZeile(zeilen, 'POS · Kennzahlen');
  // Zeile 1 der Kacheln: Zahlungsversuche (Zaehler)
  const zaehler = ws[XLSX.utils.encode_cell({ r: t + 2, c: 1 })];
  assert.strictEqual(zaehler.v, 1403);
  assert.strictEqual(zaehler.z, '#,##0');
  // Die Umsatz-Kachel weiter unten: Betrag, nicht 4229859000000.
  const umsatz = zeilen.slice(t).find(z => z[0] === 'Umsatz');
  assert.ok(umsatz, 'Umsatz-Kachel fehlt');
  assert.strictEqual(umsatz[1], 42298.59);
});

test('XLSX: die Kopfzeile jedes Abschnitts ist tuerkis eingefaerbt', async () => {
  const { wb } = await exportiereUndLies();
  const ws = wb.Sheets['POS'];
  const t = titelZeile(blattZeilen(wb, 'POS'), 'POS · Zahlungsmittel');
  const kopf = ws[XLSX.utils.encode_cell({ r: t + 1, c: 0 })];
  // Der Leser reicht die Fuellung flach zurueck (patternType/fgColor direkt in
  // .s), nicht in der verschachtelten Schreibform - geprueft wird also, dass
  // die Flaeche wirklich in der Datei gelandet ist.
  assert.strictEqual(kopf.s.patternType, 'solid');
  assert.strictEqual(kopf.s.fgColor.rgb, '11D9CC', '--accent als Kopfflaeche');
  // Gegenprobe: eine Datenzelle darunter traegt die Kopffarbe NICHT.
  const daten = ws[XLSX.utils.encode_cell({ r: t + 2, c: 0 })];
  assert.notStrictEqual(daten.s && daten.s.fgColor && daten.s.fgColor.rgb, '11D9CC');
});

test('XLSX: der Hinweis eines Blocks geht nicht verloren', async () => {
  const { wb } = await exportiereUndLies();
  const zeilen = blattZeilen(wb, 'POS');
  const flach = zeilen.map(z => String(z[0] || '')).join('\n');
  assert.match(flach, /Quoten zählen nur Versuche mit Endzustand/);
});
