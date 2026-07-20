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

test('Vendor-Block ist SheetJS und wird nur im DOM-Pfad gebraucht', () => {
  const vendor = blockInhalt('vendor-xlsx');
  assert.match(vendor, /SheetJS/, 'Vendor-Block sieht nicht nach SheetJS aus');

  // Die reinen Funktionen duerfen SheetJS nicht brauchen - sonst waeren die
  // Node-Tests auf den Vendor-Block angewiesen. Der App-Block darf XLSX also
  // nur in Event-Handlern benutzen, nicht auf Modul-Ebene beim Laden.
  const app = blockInhalt('app-logic');
  assert.doesNotMatch(app, /^\s*XLSX\./m, 'XLSX wird auf Modul-Ebene benutzt');
});

test('App-Block laesst sich isoliert kompilieren', () => {
  const app = blockInhalt('app-logic');
  assert.doesNotThrow(() => new vm.Script(app, { filename: 'app-logic.js' }));
});
