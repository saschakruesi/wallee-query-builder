// Verlaufs-Excel (styledSheetAusZeilen) end-to-end mit dem eingebetteten
// Vendor: seit v5.14 traegt es unter der Tabelle den Hinweis G2, wenn die
// Kopfzeile autorisiert_gross fuehrt (brand/terminal) - und sonst nicht
// (export/card/settlement). SPEC-ITERATION-2 §3.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { plain } = require('./harness');

const html = fs.readFileSync(path.join(__dirname, '..', 'wallee_query_builder.html'), 'utf8');
function blockInhalt(id) {
  const open = `<script id="${id}">`;
  const from = html.indexOf(open) + open.length;
  return html.slice(from, html.indexOf('</script>', from));
}
function stubElement() {
  return {
    textContent: '', innerHTML: '', value: '', checked: false, dataset: {}, style: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
    setAttribute() {}, getAttribute: () => null, removeAttribute() {}, focus() {}, blur() {},
    select() {}, click() {}, closest: () => null, querySelector: () => stubElement(), querySelectorAll: () => [],
  };
}
const sandbox = {
  console, setTimeout, clearTimeout, Buffer, Uint8Array, Date, Math, JSON, TextEncoder, TextDecoder, Blob,
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  document: { getElementById: () => stubElement(), querySelector: () => stubElement(), querySelectorAll: () => [],
    createElement: () => stubElement(), createRange: () => ({ selectNodeContents() {} }), addEventListener() {}, body: stubElement() },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
  window: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }), print() {} },
  navigator: { clipboard: { writeText: async () => {} } },
  __x: {},
};
sandbox.global = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(blockInhalt('vendor-xlsx'), sandbox, { filename: 'vendor-xlsx.js' });
vm.runInContext(blockInhalt('app-logic') + '\n;globalThis.__x.styledSheetAusZeilen = styledSheetAusZeilen;'
  + '\n;globalThis.__x.AUTORISIERT_HINWEIS = AUTORISIERT_HINWEIS;', sandbox, { filename: 'app-logic.js' });
const { styledSheetAusZeilen, AUTORISIERT_HINWEIS } = sandbox.__x;
const XLSX = sandbox.XLSX;

const BRAND = [
  ['space_id', 'brand', 'waehrung', 'anzahl_transaktionen', 'unsettled_anzahl', 'brutto_gross', 'autorisiert_gross', 'transaction_fee_total', 'netto', 'tip_total'],
  ['90001', 'Visa', 'CHF', '12', '0', '1234.50000000', '1300.00000000', '3.10000000', '1231.40000000', '0.00000000'],
  ['90001', 'TWINT', 'CHF', '3', '3', '40.00000000', '40.00000000', '0.00000000', '40.00000000', '0.00000000'],
];
const EXPORT = [
  ['id', 'brand', 'waehrung', 'brutto_gross'],
  ['1', 'Visa', 'CHF', '12.00000000'],
];

function zeilen(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true });
}

test('brand-Ergebnis: Leerzeile, dann Hinweis G2 ueber die Tabellenbreite; autorisiert_gross als Betrag', () => {
  const ws = styledSheetAusZeilen(BRAND);
  const z = zeilen(ws);
  assert.strictEqual(z.length, 5);
  assert.strictEqual(z[3].length, 0, 'Leerzeile');
  assert.strictEqual(z[4][0], AUTORISIERT_HINWEIS);
  assert.deepStrictEqual(plain(ws['!merges']), [{ s: { r: 4, c: 0 }, e: { r: 4, c: 9 } }]);
  assert.strictEqual(ws.A5.s.font.italic, true);
  // Spalte autorisiert_gross (G) ist typisiert: Zahl mit Waehrungsformat
  assert.strictEqual(ws.G2.t, 'n');
  assert.strictEqual(ws.G2.v, 1300);
  assert.strictEqual(ws.G2.z, '#,##0.00" CHF"');
  // Finalisierung: Breiten gemessen, Hinweis blaeht Spalte A nicht auf
  assert.ok(ws['!cols'][0].wch < 20);
  assert.ok(ws['!margins']);
});

test('Ergebnis ohne autorisiert_gross (export/card/settlement): keine Hinweiszeile', () => {
  const ws = styledSheetAusZeilen(EXPORT);
  const z = zeilen(ws);
  assert.strictEqual(z.length, 2);
  assert.ok(!JSON.stringify(z).includes('Autorisiert'));
  assert.strictEqual(ws['!merges'], undefined);
});
