// XLSX-Blatt der 3DS-Failure-Seite end-to-end: eingebettetes xlsx-js-style aus
// der HTML-Datei laden, das Blatt schreiben, die erzeugte Mappe wieder
// EINLESEN und die Werte darin gegen die Sollwerte halten.
//
// Gleiches Vorgehen wie test/reporting-xlsx.test.js - dass eine Datei entsteht,
// heisst noch lange nicht, dass die richtigen Zahlen, Zahlformate und
// Hyperlinks drinstehen. Und nur hier laesst sich pruefen, dass der Kuchen
// NICHT in der Mappe landet: der Vendor kann keine Charts.

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
    // Der Export legt seine Datei ueber createObjectURL ab - so laesst sich die
    // ganze Kette bis zum Download pruefen, nicht nur der Blattschreiber.
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
  '\n;globalThis.__x.parseReportingTdsCsv = parseReportingTdsCsv;' +
  '\n;globalThis.__x.buildReportingTdsModel = buildReportingTdsModel;' +
  '\n;globalThis.__x.reportingTdsExportBloecke = reportingTdsExportBloecke;' +
  '\n;globalThis.__x.reportingTdsXlsxBlatt = reportingTdsXlsxBlatt;' +
  '\n;globalThis.__x.exportReportingXlsx = exportReportingXlsx;' +
  '\n;globalThis.__x.exportReportingTdsXlsx = exportReportingTdsXlsx;' +
  '\n;globalThis.__x.ingestReportingCsv = ingestReportingCsv;' +
  '\n;globalThis.__x.ingestReportingTdsCsv = ingestReportingTdsCsv;',
  sandbox, { filename: 'app-logic.js' },
);

const X = sandbox.__x;
const XLSX = sandbox.XLSX;
const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'reporting-tds-beispiel.csv'), 'utf8');

function modell() {
  const r = X.parseReportingTdsCsv(FIXTURE);
  assert.strictEqual(r.error, null);
  return X.buildReportingTdsModel(r.rows, {});
}

// Blatt schreiben, Mappe binaer erzeugen und wieder einlesen - erst dann steht
// fest, was tatsaechlich in der Datei landet.
function schreibeUndLies(m) {
  const wb = XLSX.utils.book_new();
  X.reportingTdsXlsxBlatt(wb, m || modell(), {});
  const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  // cellNF: sonst fuellt der Reader .z gar nicht. cellStyles: dasselbe fuer .s.
  return { bytes, wb: XLSX.read(bytes, { type: 'array', cellNF: true, cellStyles: true }) };
}

function blattZeilen(wb, name) {
  const ws = wb.Sheets[name];
  assert.ok(ws, `Blatt "${name}" fehlt`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true });
}
function titelZeile(zeilen, name) {
  const t = zeilen.findIndex(z => (z[0] || '') === name);
  assert.notStrictEqual(t, -1, `Abschnitt "${name}" fehlt im Blatt`);
  return t;                     // Titel bei t, Spaltenkopf bei t+1, Daten ab t+2
}

test('XLSX: ein eigenes Blatt «3DS-Failures», alle Abschnitte darin gestapelt', () => {
  const { bytes, wb } = schreibeUndLies();
  assert.strictEqual(bytes[0], 0x50);          // "PK" - ein XLSX ist ein ZIP
  assert.strictEqual(bytes[1], 0x4b);
  assert.deepStrictEqual(plain(wb.SheetNames), ['3DS-Failures']);
  const zeilen = blattZeilen(wb, '3DS-Failures');
  assert.match(String(zeilen[0][0]), /^wallee — 3DS-Failures/);
  // Jeder Block der Liste ist als Abschnitt da - ein Blatt je Block waere ein
  // Dutzend Tabs.
  X.reportingTdsExportBloecke(modell(), {}).forEach(b => titelZeile(zeilen, b.titel));
});

test('XLSX: das Blatt haengt sich an eine BESTEHENDE Mappe', () => {
  // So kann die Verdrahtung es neben die Kanal-Blaetter des Reporting-Reports
  // legen, ohne dass es dafuer einen zweiten Schreiber braucht.
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['x']]);
  XLSX.utils.book_append_sheet(wb, ws, 'Reporting');
  X.reportingTdsXlsxBlatt(wb, modell(), {});
  assert.deepStrictEqual(plain(wb.SheetNames), ['Reporting', '3DS-Failures']);
});

test('XLSX: der Link steht als Hyperlink-Zelle unter dashboard_url', () => {
  const { wb } = schreibeUndLies();
  const ws = wb.Sheets['3DS-Failures'];
  const zeilen = blattZeilen(wb, '3DS-Failures');
  const t = titelZeile(zeilen, 'Transaktionen');
  // Der Spaltenkopf traegt den technischen Namen, nicht "Öffnen" (§3.4).
  const kopf = zeilen[t + 1];
  assert.strictEqual(kopf[12], 'dashboard_url');
  assert.strictEqual(kopf.indexOf('Öffnen'), -1);
  const zelle = ws[XLSX.utils.encode_cell({ r: t + 2, c: 12 })];
  const ziel = 'https://app-wallee.com/s/90001/payment/transaction/view/7000007';
  // Der Zellwert ist die Adresse selbst - so ist sie auch ohne Klick lesbar
  // und exportierbar; .l macht sie in Excel anklickbar.
  assert.strictEqual(zelle.v, ziel);
  assert.ok(zelle.l, 'Hyperlink fehlt');
  assert.strictEqual(zelle.l.Target, ziel);
});

test('XLSX: eine leere Adresse bekommt keinen Hyperlink', () => {
  const m = modell();
  m.zeilen = m.zeilen.map(z => Object.assign({}, z, { dashboardUrl: '' }));
  const { wb } = schreibeUndLies(m);
  const ws = wb.Sheets['3DS-Failures'];
  const t = titelZeile(blattZeilen(wb, '3DS-Failures'), 'Transaktionen');
  const zelle = ws[XLSX.utils.encode_cell({ r: t + 2, c: 12 })];
  // Ein Hyperlink auf "" waere in Excel ein Klick ins Nichts.
  assert.ok(!zelle || !zelle.l, 'leere Adresse darf keinen Hyperlink ergeben');
});

test('XLSX: Betraege sind Zahlen mit Betragsformat, keine 1e-8-Einheiten', () => {
  const { wb } = schreibeUndLies();
  const ws = wb.Sheets['3DS-Failures'];
  const t = titelZeile(blattZeilen(wb, '3DS-Failures'), 'Transaktionen');
  const zelle = ws[XLSX.utils.encode_cell({ r: t + 2, c: 6 })];    // Betrag
  assert.strictEqual(zelle.t, 'n', 'Betrag als Zahl, sonst kann Excel nicht rechnen');
  assert.strictEqual(zelle.v, 78.4);                               // juengste Zeile: ORD-1003
  assert.strictEqual(zelle.z, '#,##0.00');
});

test('XLSX: Prozente tragen 0.0"%" und sind auf eine Stelle gerundet', () => {
  const { wb } = schreibeUndLies();
  const ws = wb.Sheets['3DS-Failures'];
  const t = titelZeile(blattZeilen(wb, '3DS-Failures'), 'Betrag je Währung');
  // EUR-Block: 6 Zeilen CHF (5 Eimer + Total), dann EUR ab t+8; "50-200" ist
  // die zweite EUR-Zeile: 1 von 3 = 33.333... -> 33.3.
  const zelle = ws[XLSX.utils.encode_cell({ r: t + 9, c: 3 })];
  assert.strictEqual(zelle.t, 'n');
  assert.strictEqual(zelle.v, 33.3, 'gerundet, damit 0.0"%" nicht mehr Genauigkeit behauptet');
  assert.strictEqual(zelle.z, '0.0"%"');
});

test('XLSX: die Kachel-Wertspalte laeuft ueber reportingZellFormat', () => {
  const { wb } = schreibeUndLies();
  const ws = wb.Sheets['3DS-Failures'];
  const zeilen = blattZeilen(wb, '3DS-Failures');
  const t = titelZeile(zeilen, 'Kennzahlen');
  const zaehler = ws[XLSX.utils.encode_cell({ r: t + 2, c: 1 })];   // 3DS-Failures gesamt
  assert.strictEqual(zaehler.v, 8);
  assert.strictEqual(zaehler.z, '#,##0');
  // Die Volumen-Kachel weiter unten: ein Betrag, nicht 41380000000.
  const volumen = zeilen.slice(t).find(z => z[0] === 'Betroffenes Volumen');
  assert.ok(volumen, 'Volumen-Kachel fehlt');
  assert.strictEqual(volumen[1], 413.8);
  assert.strictEqual(volumen[2], 'CHF');
});

test('XLSX: am Limit steht die Zahl - die Untergrenze sagt der Hinweis', () => {
  const m = X.buildReportingTdsModel([], {});
  m.hatDaten = true;
  m.abgeschnitten = true;
  m.kpi.failures = 20000;
  const { wb } = schreibeUndLies(m);
  const ws = wb.Sheets['3DS-Failures'];
  const zeilen = blattZeilen(wb, '3DS-Failures');
  const t = titelZeile(zeilen, 'Kennzahlen');
  const zelle = ws[XLSX.utils.encode_cell({ r: t + 2, c: 1 })];
  // In Excel wird gerechnet und sortiert: die Zelle bleibt eine Zahl.
  assert.strictEqual(zelle.t, 'n');
  assert.strictEqual(zelle.v, 20000);
  assert.strictEqual(zelle.z, '#,##0');
  // Dass sie eine Untergrenze ist, steht im Hinweis - und der ist im Blatt.
  const flach = zeilen.map(z => String(z[0] || '')).join('\n');
  assert.match(flach, /Untergrenzen/);
});

test('XLSX: die Kopfzeile jedes Abschnitts ist tuerkis eingefaerbt', () => {
  const { wb } = schreibeUndLies();
  const ws = wb.Sheets['3DS-Failures'];
  const t = titelZeile(blattZeilen(wb, '3DS-Failures'), 'Einordnung');
  const kopf = ws[XLSX.utils.encode_cell({ r: t + 1, c: 0 })];
  assert.strictEqual(kopf.s.patternType, 'solid');
  assert.strictEqual(kopf.s.fgColor.rgb, '11D9CC', '--accent als Kopfflaeche');
  const daten = ws[XLSX.utils.encode_cell({ r: t + 2, c: 0 })];
  assert.notStrictEqual(daten.s && daten.s.fgColor && daten.s.fgColor.rgb, '11D9CC');
});

test('XLSX: der Hinweis eines Blocks geht nicht verloren', () => {
  const { wb } = schreibeUndLies();
  const flach = blattZeilen(wb, '3DS-Failures').map(z => String(z[0] || '')).join('\n');
  assert.match(flach, /Herausgebernamen führt wallee nirgends/);
  assert.match(flach, /ERSETZT/);
});

test('XLSX: kein Blatt traegt eine Zeile aus block.kuchen', () => {
  // §2.2: der eingebettete Vendor kann keine Charts. Geprueft wird dort, wo
  // die Mappe wirklich entsteht.
  const m = modell();
  const bloecke = X.reportingTdsExportBloecke(m, {});
  const mitKuchen = bloecke.filter(b => b.kuchen && b.kuchen.length);
  // Sonst prueft der Test nichts.
  assert.ok(mitKuchen.length >= 3, `nur ${mitKuchen.length} Bloecke mit Kuchen`);

  const { wb } = schreibeUndLies(m);
  const zeilen = blattZeilen(wb, '3DS-Failures');
  const zellen = [];
  wb.SheetNames.forEach(name => {
    blattZeilen(wb, name).forEach(z => z.forEach(w => zellen.push(String(w == null ? '' : w))));
  });

  mitKuchen.forEach(b => {
    b.kuchen.forEach(k => {
      // Titel und Farbschluessel sind die beiden Werte, die NUR der Kuchen
      // fuehrt - eine mitgeschriebene Legende braechte sie mit.
      assert.ok(!zellen.includes(k.titel), `Kuchen-Titel "${k.titel}" steht in der Mappe`);
      k.segmente.forEach(s => assert.ok(!zellen.includes(String(s.farbe)),
        `Farbschluessel "${s.farbe}" steht in der Mappe`));
    });

    // Der Teil, der bei einem echten Fehler braeche. Segment-LABEL und -WERT
    // stehen sehr wohl im Blatt - sie SIND die Zeilen der Tabelle darunter,
    // ein Vergleich auf sie allein waere deshalb immer gruen. Geprueft wird
    // stattdessen der Abschnitt selbst: zwischen Spaltenkopf und Hinweiszeile
    // steht genau die Zeilenliste des Blocks, Zeile fuer Zeile und in ihrer
    // Reihenfolge. Jede zusaetzlich geschriebene Segmentzeile faellt hier auf,
    // auch wenn ihr Label fuer sich genommen unauffaellig aussieht.
    const t = titelZeile(zeilen, b.titel);
    const daten = zeilen.slice(t + 2, t + 2 + b.zeilen.length);
    assert.strictEqual(daten.length, b.zeilen.length, `Abschnitt "${b.titel}" zu kurz`);
    daten.forEach((z, i) => assert.strictEqual(String(z[0] == null ? '' : z[0]),
      String(b.zeilen[i][0]), `Abschnitt "${b.titel}", Zeile ${i}`));
    // Direkt danach folgt der Hinweis des Blocks - und nicht noch ein Segment.
    const danach = zeilen[t + 2 + b.zeilen.length] || [];
    assert.strictEqual(String(danach[0] == null ? '' : danach[0]), b.hinweis,
      `nach den Zeilen von "${b.titel}" steht etwas anderes als sein Hinweis`);
  });
});

// --- Der Export-Knopf (Task 4d) -------------------------------------------
// Bis hierher wurde der BLATTSCHREIBER geprueft. Diese beiden Tests nageln die
// Entscheidung fest, die die Verdrahtung getroffen hat: eine EIGENE Mappe.
//
// Der Grund steht bei exportReportingTdsXlsx ausfuehrlich - kurz: das
// Aggregat traegt bewusst keine personenbezogenen Daten (§3.3) und ist
// deshalb weitergabefaehig, die Zeilenliste traegt Bestellnummern und
// Transaktions-IDs. Laegen beide in einer Mappe, koennte der Haendler den
// Reporting-Report nicht mehr weiterreichen, ohne die Transaktionsliste
// mitzugeben.

const FIXTURE_AGG = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'reporting-beispiel.csv'), 'utf8');

async function exportiere(fn) {
  downloads.length = 0;
  fn();
  assert.strictEqual(downloads.length, 1, 'Export muss genau eine Datei erzeugen');
  const bytes = new Uint8Array(await downloads[0].arrayBuffer());
  return XLSX.read(bytes, { type: 'array' });
}

test('XLSX-Export: die 3DS-Liste bekommt eine eigene Mappe mit genau einem Blatt', async () => {
  assert.strictEqual(X.ingestReportingTdsCsv(FIXTURE), true);
  const wb = await exportiere(() => X.exportReportingTdsXlsx());
  assert.deepStrictEqual(plain(wb.SheetNames), ['3DS-Failures']);
});

test('XLSX-Export: die Reporting-Mappe traegt die 3DS-Liste NICHT mit', async () => {
  // Gegenprobe zur Entscheidung oben: haette jemand das Blatt zusaetzlich in
  // exportReportingXlsx gehaengt, waeren beide Tests einzeln gruen und die
  // Daten trotzdem in einer Datei.
  assert.strictEqual(X.ingestReportingCsv(FIXTURE_AGG), true);
  assert.strictEqual(X.ingestReportingTdsCsv(FIXTURE), true);
  const wb = await exportiere(() => X.exportReportingXlsx());
  assert.strictEqual(wb.SheetNames.indexOf('3DS-Failures'), -1,
    'Die weitergabefaehige Aggregat-Mappe darf die Zeilenliste nicht enthalten');
});
