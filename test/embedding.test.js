// Schuetzt die Struktur der Single-File-App: zwei klar getrennte <script>-Bloecke,
// und der eingebettete SheetJS-Code muss syntaktisch heil sein.
//
// Hintergrund: beim Einbetten wurde der Vendor-Code einmal still korrumpiert,
// weil String.replace() mit einem String-Ersatz die Sequenzen $&, $', $` und $1
// als Einsetzungsmuster deutet - und minifizierter Code steckt voller $-Sequenzen.
// Das faellt weder beim Laden der Datei noch in den Builder-Tests auf, sondern
// erst, wenn im Browser der XLSX-Export gedrueckt wird. Deshalb hier ein Test,
// der den Block wirklich kompiliert statt nur nachzusehen, ob er da ist.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = path.join(__dirname, '..', 'wallee_query_builder_v2.html');
const html = fs.readFileSync(APP, 'utf8');

function blockInhalt(id) {
  const open = `<script id="${id}">`;
  const start = html.indexOf(open);
  assert.notStrictEqual(start, -1, `Block <script id="${id}"> fehlt`);
  const from = start + open.length;
  const end = html.indexOf('</script>', from);
  assert.notStrictEqual(end, -1, `Kein schliessendes </script> fuer id="${id}"`);
  return html.slice(from, end);
}

test('App-HTML hat genau zwei script-Bloecke mit den erwarteten ids', () => {
  const tags = html.match(/<script[^>]*>/g) || [];
  assert.deepStrictEqual(tags, ['<script id="vendor-xlsx">', '<script id="app-logic">']);
});

test('Vendor-Block ist syntaktisch heiles JavaScript (keine $-Korruption)', () => {
  const vendor = blockInhalt('vendor-xlsx');
  assert.ok(vendor.length > 500000, `Vendor-Block unerwartet klein: ${vendor.length} Zeichen`);
  assert.doesNotThrow(
    () => new vm.Script(vendor, { filename: 'vendor-xlsx.js' }),
    'Vendor-Block laesst sich nicht kompilieren - vermutlich beim Einbetten beschaedigt',
  );
});

test('Vendor-Block ist SheetJS', () => {
  const vendor = blockInhalt('vendor-xlsx');
  assert.match(vendor, /SheetJS/, 'Vendor-Block sieht nicht nach SheetJS aus');
});

test('App-Block laeuft ohne SheetJS - XLSX wird erst im Event-Pfad gebraucht', () => {
  // Die eigentlich interessante Eigenschaft: der App-Code muss sich laden und
  // initialisieren lassen, ohne dass XLSX ueberhaupt existiert. Nur so bleiben
  // die Node-Tests unabhaengig vom 930-KB-Vendor-Block.
  //
  // Frueher stand hier ein Textvergleich (kein Zeilenanfang "XLSX."), der aber
  // nur ein schlechter Stellvertreter war: er schlug auch bei einem voellig
  // korrekten XLSX-Aufruf INNERHALB einer Funktion an. Jetzt wird die
  // Eigenschaft direkt geprueft - Script ausfuehren, ohne XLSX bereitzustellen.
  const app = blockInhalt('app-logic');
  const sandbox = {
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
    window: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) },
    navigator: { clipboard: { writeText: async () => {} } },
    console, setTimeout, clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  assert.doesNotThrow(
    () => vm.runInContext(app, sandbox, { filename: 'app-logic.js' }),
    'App-Code darf SheetJS nicht schon beim Laden brauchen',
  );
  assert.strictEqual(typeof sandbox.XLSX, 'undefined', 'XLSX war in diesem Lauf nie vorhanden');
});

function stubElement() {
  const el = {
    textContent: '', innerHTML: '', value: '', checked: false,
    dataset: {}, style: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    focus() {}, blur() {}, select() {}, closest: () => null,
    querySelector: () => stubElement(), querySelectorAll: () => [],
  };
  return el;
}

test('App-Block laesst sich isoliert kompilieren', () => {
  const app = blockInhalt('app-logic');
  assert.doesNotThrow(() => new vm.Script(app, { filename: 'app-logic.js' }));
});
