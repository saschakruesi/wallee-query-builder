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

const APP = path.join(__dirname, '..', 'wallee_query_builder.html');
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

test('App-HTML hat genau drei script-Bloecke mit den erwarteten ids', () => {
  // Nicht /<script[^>]*>/g auf das ganze Dokument: der jsPDF-Bundle baut ueber
  // seinen "pdfobjectnewwindow"-Ausgabemodus zur Laufzeit selbst HTML zusammen
  // und enthaelt dafuer die JS-String-Literale '<script src="'+o+'"...>' und
  // '<script >' (mit escaptem '<\/script>' als Gegenstueck, damit sie den
  // umschliessenden Vendor-Block nicht vorzeitig beenden). Eine naive Suche
  // nach jedem "<script ...>" zaehlt diese String-Fragmente faelschlich mit.
  // Echte Script-Elemente tragen hier alle ein id-Attribut, die Fragmente
  // nicht - deshalb gezielt danach filtern.
  const tags = html.match(/<script id="[^"]*">/g) || [];
  assert.deepStrictEqual(tags,
    ['<script id="vendor-xlsx">', '<script id="vendor-jspdf">', '<script id="app-logic">']);
});

test('Genau drei echte </script>-Enden im Rohdokument', () => {
  // Die id-basierte Suche oben schuetzt vor String-Fragmenten, die wie ein
  // OEFFNENDER Tag aussehen (siehe Kommentar oben), sagt aber nichts darueber,
  // ob genau drei echte Script-Elemente auch wieder SCHLIESSEN. Zwei
  // Bruchfaelle waeren sonst unentdeckt: ein vierter, echter Script-Block ohne
  // id, oder ein Vendor-Block, der versehentlich einen rohen </script> enthaelt
  // (dann endet das umschliessende Script-Element mitten im Vendor-Code).
  const closes = html.match(/<\/script>/g) || [];
  assert.strictEqual(closes.length, 3,
    'Unerwartete Anzahl - ein neuer Script-Block ohne id oder ein roher </script> im Vendor-Code?');
});

test('Vendor-Block ist syntaktisch heiles JavaScript (keine $-Korruption)', () => {
  const vendor = blockInhalt('vendor-xlsx');
  // Der eingebettete xlsx-js-style-Bundle ist ~425 KB minifiziert; die Schwelle
  // faengt nur ab, dass der Block versehentlich ganz leer/abgeschnitten ist.
  assert.ok(vendor.length > 300000, `Vendor-Block unerwartet klein: ${vendor.length} Zeichen`);
  assert.doesNotThrow(
    () => new vm.Script(vendor, { filename: 'vendor-xlsx.js' }),
    'Vendor-Block laesst sich nicht kompilieren - vermutlich beim Einbetten beschaedigt',
  );
});

test('Vendor-Block ist der stilfaehige SheetJS-Fork (xlsx-js-style)', () => {
  const vendor = blockInhalt('vendor-xlsx');
  assert.match(vendor, /SheetJS/, 'Vendor-Block sieht nicht nach SheetJS aus');
  // Muss der Style-Fork sein - die reine Community Edition kann keine Zellfarben
  // schreiben, auf die der wallee-XLSX-Export angewiesen ist.
  assert.match(vendor, /xlsx-js-style/, 'Vendor-Block ist nicht der stilfaehige Fork');
});

test('jsPDF-Vendor-Block ist syntaktisch heiles JavaScript (keine $-Korruption)', () => {
  const vendor = blockInhalt('vendor-jspdf');
  assert.ok(vendor.length > 200000, `jsPDF-Block unerwartet klein: ${vendor.length} Zeichen`);
  assert.doesNotThrow(
    () => new vm.Script(vendor, { filename: 'vendor-jspdf.js' }),
    'jsPDF-Block laesst sich nicht kompilieren - vermutlich beim Einbetten beschaedigt',
  );
});

test('jsPDF-Vendor-Block bringt autoTable mit', () => {
  const vendor = blockInhalt('vendor-jspdf');
  assert.match(vendor, /jsPDF/);
  assert.match(vendor, /autoTable/, 'Ohne das autoTable-Plugin gibt es keine Tabellen im PDF');
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
