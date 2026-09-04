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

// --- Der Build-Schritt fuer FAILURE_REASONS (Iteration 2, Task 1) ------------
//
// tools/build-failure-reasons.mjs schreibt die 2'254 Ablehngruende zwischen die
// Markerkommentare in wallee_query_builder.html. Er gehoert hierher und nicht
// in die Reporting-Tests, weil er dasselbe schuetzt wie der Rest dieser Datei:
// die Unversehrtheit der Single-File-App beim Einbetten - inklusive der
// $&-Falle, die oben fuer den Vendor-Code beschrieben ist.

const os = require('node:os');
const { execFileSync: run } = require('node:child_process');

const TOOL = path.join(__dirname, '..', 'tools', 'build-failure-reasons.mjs');
const KATALOG = path.join(__dirname, '..', 'dashboard', 'catalog', 'failure-reasons.json');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wqb-failure-reasons-'));
}

// Minimale Ziel-Datei: nur die beiden Marker, mit Platzhalter dazwischen.
function zielDatei(dir, inhalt) {
  const p = path.join(dir, 'ziel.html');
  fs.writeFileSync(p, inhalt !== undefined ? inhalt
    : 'davor\n  /* FAILURE_REASONS:BEGIN */\n  const FAILURE_REASONS = {};\n  /* FAILURE_REASONS:END */\ndanach\n');
  return p;
}

function generierteZeile(html) {
  const m = /\/\* FAILURE_REASONS:BEGIN \*\/\n(.*)\n\s*\/\* FAILURE_REASONS:END \*\//.exec(html);
  assert.ok(m, 'Kein generierter Block zwischen den Markern gefunden');
  return m[1];
}

test('Build-Schritt erzeugt den Block, sortiert und als [name, kategorie]-Paar', () => {
  const dir = tempDir();
  const ziel = zielDatei(dir);
  const katalog = path.join(dir, 'katalog.json');
  fs.writeFileSync(katalog, JSON.stringify({
    2: { name: 'Zweiter', category: 'Internal' },
    10: { name: 'Zehnter', category: 'Temporary Issue' },
    1: { name: 'Erster', category: 'End User' },
    3: { name: 'Dritter', category: 'Developer' },
  }));
  run(process.execPath, [TOOL, ziel, katalog]);
  const zeile = generierteZeile(fs.readFileSync(ziel, 'utf8'));
  // String-Sortierung der IDs: '1' < '10' < '2' - Absicht, sie macht den Diff
  // eines erneuten Laufs stabil, sie ist keine Zahlensortierung.
  assert.strictEqual(zeile,
    '  const FAILURE_REASONS = {"1":["Erster","E"],"10":["Zehnter","T"],'
    + '"2":["Zweiter","I"],"3":["Dritter","D"]};');
  // Umgebender Text bleibt unangetastet.
  const html = fs.readFileSync(ziel, 'utf8');
  assert.ok(html.startsWith('davor\n'));
  assert.ok(html.endsWith('danach\n'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Build-Schritt ist idempotent und uebersteht ein $& im Namen', () => {
  const dir = tempDir();
  const ziel = zielDatei(dir);
  const katalog = path.join(dir, 'katalog.json');
  // Genau die Falle, an der der Vendor-Code einmal still zerbrochen ist: mit
  // einem Ersatz-STRING statt einer Replacer-Funktion setzte replace() an
  // dieser Stelle den ganzen gefundenen Block ein.
  fs.writeFileSync(katalog, JSON.stringify({
    1: { name: 'Payment $& declined', category: 'End User' },
    2: { name: "Backtick $` and $' and $1", category: 'Developer' },
  }));
  run(process.execPath, [TOOL, ziel, katalog]);
  const erst = fs.readFileSync(ziel, 'utf8');
  assert.ok(erst.includes('"Payment $& declined"'), erst);
  assert.ok(erst.includes('Backtick $` and $\' and $1'), erst);
  // Zweiter Lauf aendert nichts mehr.
  const aus = run(process.execPath, [TOOL, ziel, katalog], { encoding: 'utf8' });
  assert.match(aus, /unveraendert/);
  assert.strictEqual(fs.readFileSync(ziel, 'utf8'), erst);
  // Und das Ergebnis ist gueltiges JavaScript.
  assert.doesNotThrow(() => new vm.Script(generierteZeile(erst), { filename: 'failure-reasons.js' }));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Build-Schritt bricht ab, wenn die Marker fehlen oder doppelt sind', () => {
  const dir = tempDir();
  const katalog = path.join(dir, 'katalog.json');
  fs.writeFileSync(katalog, JSON.stringify({ 1: { name: 'X', category: 'End User' } }));
  const scheitert = (inhalt) => {
    const ziel = zielDatei(dir, inhalt);
    assert.throws(() => run(process.execPath, [TOOL, ziel, katalog], { stdio: 'pipe' }));
    // Und die Datei bleibt unberuehrt - lieber gar nichts als halb geschrieben.
    assert.strictEqual(fs.readFileSync(ziel, 'utf8'), inhalt);
  };
  scheitert('gar keine Marker\n');
  scheitert('/* FAILURE_REASONS:BEGIN */\nohne Ende\n');
  scheitert('/* FAILURE_REASONS:BEGIN */\nx\n/* FAILURE_REASONS:END */\n'
    + '/* FAILURE_REASONS:BEGIN */\ny\n/* FAILURE_REASONS:END */\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Build-Schritt bricht bei einer unbekannten Kategorie ab, statt "" zu schreiben', () => {
  // Frueher schrieb der Schritt fuer eine Kategorie ausserhalb von KUERZEL
  // stillschweigend '' - die App liest das als UNKNOWN. Zur Laufzeit ist das
  // der richtige Rueckfall fuer eine einzelne unbekannte ID; hier waere es
  // der falsche: ergaenzt wallee den Katalog um eine sechste Kategorie, liefen
  // nach dem naechsten Scrape ALLE ihre Gruende als "Unbekannt" durch den
  // Block «Ablehngruende nach Kategorie» - bei belegter Kategorie.
  const dir = tempDir();
  const ziel = zielDatei(dir);
  const vorher = fs.readFileSync(ziel, 'utf8');
  const katalog = path.join(dir, 'katalog.json');
  const scheitert = (eintrag, erwartet) => {
    fs.writeFileSync(katalog, JSON.stringify({ 1: { name: 'X', category: 'End User' }, 2: eintrag }));
    let ausgabe = '';
    assert.throws(() => run(process.execPath, [TOOL, ziel, katalog], { stdio: 'pipe' }),
      err => { ausgabe = String(err.stderr || ''); return true; });
    assert.match(ausgabe, erwartet);
    assert.match(ausgabe, /ID 2/, 'die betroffene ID gehoert in die Meldung');
    // Und die Zieldatei bleibt unberuehrt - lieber gar nichts als eine
    // Tabelle, in der eine ganze Kategorie fehlt.
    assert.strictEqual(fs.readFileSync(ziel, 'utf8'), vorher);
  };
  scheitert({ name: 'Neu', category: 'Was Neues' }, /Unbekannte Kategorie "Was Neues"/);
  scheitert({ name: 'Neu' }, /Unbekannte Kategorie "\(fehlt\)"/);
  scheitert({ name: 'Neu', category: '' }, /Unbekannte Kategorie "\(fehlt\)"/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Der eingecheckte Block ist der aktuelle Stand des Katalogs', () => {
  // Waechter gegen Drift: wer dashboard/catalog/failure-reasons.json neu
  // scrapt und den Build-Schritt vergisst, faellt hier auf - nicht erst, wenn
  // ein Haendler im Report eine ID ohne Namen sieht.
  const dir = tempDir();
  const ziel = path.join(dir, 'app.html');
  fs.copyFileSync(APP, ziel);
  const aus = run(process.execPath, [TOOL, ziel, KATALOG], { encoding: 'utf8' });
  assert.match(aus, /unveraendert/,
    'wallee_query_builder.html ist nicht auf dem Stand des Katalogs - '
    + 'node tools/build-failure-reasons.mjs laufen lassen');
  fs.rmSync(dir, { recursive: true, force: true });
});
