// Der Excel-Dialog des Terminal-Reports (SPEC-ITERATION-2 §5.1): oeffnet
// sich nur mit Modell, Abbrechen/Esc/Hintergrund exportieren nicht, "Excel
// erstellen" merkt sich die Variante. Ueber den DOM-Stub, ohne Vendor - der
// Export selbst scheitert hier am fehlenden XLSX und landet in der
// Fehlermeldung, was den Dialog-Ablauf nicht beruehrt.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadBuilders } = require('./harness');
const { makeDocument } = require('./dom-stub');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'beispiel-daten.csv'), 'utf8');
const KEY = 'wallee_terminal_report_xlsx_variante';

function app(options) {
  const dokument = makeDocument();
  // Das Overlay steht im Markup mit class="hidden"; der Stub kennt das Markup
  // nicht, deshalb hier nachgestellt.
  dokument.getElementById('reportXlsxDialogOverlay').classList.add('hidden');
  const a = loadBuilders(Object.assign({ document: dokument }, options || {}));
  const el = id => dokument.getElementById(id);
  return { a, dokument, el,
    overlay: el('reportXlsxDialogOverlay'), btn: el('reportXlsxBtn'),
    full: el('reportXlsxVarianteFull'), kond: el('reportXlsxVarianteKondensiert'),
    ok: el('reportXlsxDialogOk'), cancel: el('reportXlsxDialogCancel'), close: el('reportXlsxDialogClose') };
}
const offen = t => !t.overlay.classList.contains('hidden');

test('ohne Modell oeffnet der Knopf nichts', () => {
  const t = app();
  t.btn.dispatch('click');
  assert.strictEqual(offen(t), false);
});

test('mit Modell: Dialog auf, Full vorausgewaehlt (Erstwert), Abbrechen schliesst', () => {
  const t = app();
  assert.strictEqual(t.a.ingestReportCsv(FIXTURE), true);
  t.btn.dispatch('click');
  assert.strictEqual(offen(t), true);
  assert.strictEqual(t.full.checked, true);
  assert.strictEqual(t.kond.checked, false);
  t.cancel.dispatch('click');
  assert.strictEqual(offen(t), false);
  assert.strictEqual(t.a.loadReportXlsxVariante(), 'full', 'Abbrechen speichert nichts');
});

test('Esc, Schliessen-Knopf und Hintergrund-Klick schliessen ohne Export', () => {
  const t = app();
  t.a.ingestReportCsv(FIXTURE);
  t.btn.dispatch('click');
  t.dokument.dispatch('keydown', { key: 'Escape' });
  assert.strictEqual(offen(t), false);
  t.btn.dispatch('click');
  t.close.dispatch('click');
  assert.strictEqual(offen(t), false);
  t.btn.dispatch('click');
  t.overlay.dispatch('click', { target: t.overlay });
  assert.strictEqual(offen(t), false);
  // Klick IM Dialog schliesst nicht
  t.btn.dispatch('click');
  t.overlay.dispatch('click', { target: t.ok });
  assert.strictEqual(offen(t), true);
});

test('"Excel erstellen" persistiert die Variante und schliesst; naechstes Oeffnen zeigt sie vorausgewaehlt', () => {
  const t = app();
  t.a.ingestReportCsv(FIXTURE);
  t.btn.dispatch('click');
  t.full.checked = false; t.kond.checked = true;
  t.ok.dispatch('click');
  assert.strictEqual(offen(t), false);
  assert.strictEqual(t.a.loadReportXlsxVariante(), 'kondensiert');
  t.btn.dispatch('click');
  assert.strictEqual(t.kond.checked, true);
  assert.strictEqual(t.full.checked, false);
});

test('gespeicherte Variante wird beim Laden gelesen; Unsinn faellt auf full zurueck', () => {
  const a1 = app({ seedLocalStorage: { [KEY]: 'kondensiert' } });
  assert.strictEqual(a1.a.loadReportXlsxVariante(), 'kondensiert');
  a1.a.ingestReportCsv(FIXTURE);
  a1.btn.dispatch('click');
  assert.strictEqual(a1.kond.checked, true);
  const a2 = app({ seedLocalStorage: { [KEY]: 'irgendwas' } });
  assert.strictEqual(a2.a.loadReportXlsxVariante(), 'full');
  assert.strictEqual(a2.a.REPORT_XLSX_VARIANTE_KEY, KEY);
});

test('Private Mode: Laden und Speichern werfen nicht, Dialog laeuft trotzdem', () => {
  const t = app({ blockLocalStorage: true });
  assert.strictEqual(t.a.loadReportXlsxVariante(), 'full');
  assert.doesNotThrow(() => t.a.saveReportXlsxVariante('kondensiert'));
  t.a.ingestReportCsv(FIXTURE);
  t.btn.dispatch('click');
  assert.strictEqual(offen(t), true);
  t.ok.dispatch('click');
  assert.strictEqual(offen(t), false);
});
