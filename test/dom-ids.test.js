// Prueft, dass jede im App-Code per getElementById angesprochene ID im Markup
// wirklich existiert.
//
// Hintergrund: der DOM-Stub in test/harness.js liefert fuer JEDE ID irgendein
// No-Op-Element zurueck. Eine verwaiste Referenz - falsch geschriebene oder
// geloeschte ID - faellt den Builder-Tests deshalb nie auf, sondern erst im
// Browser, wo dann still gar nichts passiert. Dieser Test schliesst die Luecke
// statisch, ohne DOM.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'wallee_query_builder.html');
const html = fs.readFileSync(APP, 'utf8');

// Nur der Markup-Teil bis zum Vendor-Block - der minifizierte SheetJS-Code
// enthaelt massenhaft Strings, die wie IDs aussehen.
const markup = html.slice(0, html.indexOf('<script id="vendor-xlsx">'));

const appOpen = '<script id="app-logic">';
const appFrom = html.indexOf(appOpen) + appOpen.length;
const appCode = html.slice(appFrom, html.indexOf('</script>', appFrom));

function vorhandeneIds() {
  const ids = new Set();
  const re = /\sid="([^"]+)"/g;
  let m;
  while ((m = re.exec(markup)) !== null) ids.add(m[1]);
  return ids;
}

function angefragteIds() {
  const ids = new Set();
  const re = /getElementById\(\s*'([^']+)'\s*\)/g;
  let m;
  while ((m = re.exec(appCode)) !== null) ids.add(m[1]);
  return ids;
}

test('jede per getElementById angefragte ID existiert im Markup', () => {
  const vorhanden = vorhandeneIds();
  const angefragt = angefragteIds();
  assert.ok(angefragt.size > 20, `Zu wenige IDs gefunden (${angefragt.size}) - Regex greift nicht`);

  const verwaist = [...angefragt].filter(id => !vorhanden.has(id)).sort();
  assert.deepStrictEqual(verwaist, [], 'Verwaiste getElementById-Referenzen: ' + verwaist.join(', '));
});

test('Terminal-Report ist im terminal-Modus aufgegangen, kein eigener Report-Tab mehr', () => {
  // Der eigenstaendige Report-Tab wurde aufgeloest (siehe CLAUDE.md): der
  // 'terminal'-Modus heisst jetzt "Terminal-Report" und zeigt Filter + Report
  // im selben Panel. Ein eigener data-mode="report"-Button darf nicht mehr
  // existieren, das reportSection-Panel (jetzt ohne CSV-Upload) bleibt.
  assert.doesNotMatch(markup, /data-mode="report"/, 'Report-Button haette entfernt werden muessen');
  assert.match(markup, /id="reportSection"/, 'Report-Panel fehlt');
  assert.doesNotMatch(markup, /id="reportDropzone"/, 'CSV-Upload-Dropzone haette entfernt werden muessen');
  assert.doesNotMatch(markup, /id="reportFileInput"/, 'CSV-Datei-Input haette entfernt werden muessen');
});

test('Sync-UI: die erwarteten Element-IDs sind im Markup', () => {
  ['syncTerminalsBtn', 'syncInfoMarker', 'syncInfoOverlay',
   'syncInfoOverlaySettingsLink', 'syncInfoOverlayClose'].forEach(id => {
    assert.match(markup, new RegExp(`id="${id}"`), `ID ${id} fehlt im Markup`);
  });
});

test('Self-Update: die erwarteten Element-IDs sind im Markup', () => {
  ['updateBanner','updateBannerText','updateBannerBtn','updateSection','updateCurrentVersion',
   'updateLatestVersion','updateNowBtn','updateCheckBtn','updateProgress','updateProgressBar',
   'updateStatus'].forEach(id => {
    assert.match(markup, new RegExp(`id="${id}"`), `ID ${id} fehlt im Markup`);
  });
});

test('Terminal-Filter wurde entfernt - Auswahl laeuft ueber den Space-Klick oben', () => {
  // Der Filter unter der Terminal-Liste ist bewusst wieder ausgebaut: die
  // Terminals einer Space werden ueber das Anklicken der Space oben an-/abgewaehlt.
  assert.doesNotMatch(markup, /id="terminalFilter"/, 'Filterfeld haette entfernt werden muessen');
  assert.doesNotMatch(markup, /id="terminalVisibleCount"/, 'Sichtbar-Zaehler haette entfernt werden muessen');
  assert.match(markup, /id="terminalList"/, 'Terminal-Liste bleibt');
});

test('Settlement-Modus: neue IDs vorhanden, settlementByTerminal entfernt', () => {
  const vorhanden = vorhandeneIds();
  ['spaceSection', 'settlementAccountInput', 'settlementSuperUserToggle',
    'settlementDetailToggle', 'settlementReportSection', 'settlementReportStatus',
    'settlementReportOutput', 'settlementCsvBtn', 'settlementXlsxBtn', 'settlementPdfBtn',
  ].forEach(id => assert.ok(vorhanden.has(id), `ID ${id} fehlt im Markup`));
  assert.ok(!vorhanden.has('settlementByTerminal'),
    'settlementByTerminal ist ersatzlos entfallen');
});

// --- Kuchenfarben: :root im CSS gegen SVG_KUCHEN_FARBEN im App-Code --------
//
// Jede Farbe der Kuchen steht doppelt: als CSS-Variable im :root (Bildschirm,
// Hausregel "Farben nur ueber :root") und als Hexwert in SVG_KUCHEN_FARBEN
// (jsPDF kennt keine CSS-Variablen). Der Kommentar an beiden Stellen verspricht
// ausdruecklich, dass Bildschirm und PDF DIESELBE Farbe zeigen - genau das
// laesst sich zur Laufzeit nirgends pruefen: das SVG traegt nur var(--kuchen-2),
// und ob diese Variable ueberhaupt existiert und was in ihr steht, entscheidet
// erst der Browser. Ein Tippfehler faellt so weder den Builder- noch den
// Render-Tests auf. Dieser Waechter schliesst die Luecke statisch, im selben
// Sinn wie der ID-Abgleich oben.

function rootVariablen() {
  const block = /:root\s*\{([\s\S]*?)\}/.exec(markup);
  assert.ok(block, ':root-Block nicht gefunden');
  const vars = new Map();
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(block[1])) !== null) vars.set(m[1], m[2].trim().toLowerCase());
  return vars;
}

// Statisch aus dem Quelltext gelesen, nicht ausgefuehrt: der Waechter soll
// genau das pruefen, was in der Datei steht.
function kuchenFarbTabelle() {
  const block = /const SVG_KUCHEN_FARBEN = \{([\s\S]*?)\n  \};/.exec(appCode);
  assert.ok(block, 'SVG_KUCHEN_FARBEN nicht gefunden - Form geaendert?');
  const eintraege = [];
  const re = /(\w+):\s*\{\s*css:\s*'([^']+)',\s*hex:\s*'([^']+)',\s*text:\s*'([^']+)'\s*\}/g;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    eintraege.push({ schluessel: m[1], css: m[2], hex: m[3], text: m[4] });
  }
  return eintraege;
}

test('Kuchenfarben: jede CSS-Variable existiert und traegt genau den Hexwert daneben', () => {
  const vars = rootVariablen();
  const tabelle = kuchenFarbTabelle();
  // Sechs Farben plus Grau (§2.2). Faengt ab, dass die Regex oben klaglos
  // nichts findet und der Test damit gar nichts mehr pruefte.
  assert.strictEqual(tabelle.length, 7, 'nicht alle Eintraege erkannt');

  tabelle.forEach(e => {
    const name = /^var\((--[\w-]+)\)$/.exec(e.css);
    assert.ok(name, `${e.schluessel}: css ist keine reine CSS-Variable (${e.css})`);
    assert.ok(vars.has(name[1]), `${e.schluessel}: ${name[1]} fehlt im :root`);
    // Der Kern: Bildschirm und PDF zeigen dieselbe Farbe.
    assert.strictEqual(vars.get(name[1]), e.hex.toLowerCase(),
      `${e.schluessel}: ${name[1]} ist ${vars.get(name[1])}, jsPDF bekaeme ${e.hex}`);
  });
});

test('Kuchenfarben: auch die Textfarben zeigen auf definierte CSS-Variablen', () => {
  // Fuer die Beschriftung IM Segment gibt es kein Hex-Gegenstueck (das PDF
  // schreibt keine Zahl ins Segment). Existieren muss die Variable trotzdem -
  // sonst faerbt der Browser den Text schlicht gar nicht ein, und niemand
  // merkt es.
  const vars = rootVariablen();
  kuchenFarbTabelle().forEach(e => {
    const name = /^var\((--[\w-]+)\)$/.exec(e.text);
    assert.ok(name, `${e.schluessel}: text ist keine reine CSS-Variable (${e.text})`);
    assert.ok(vars.has(name[1]), `${e.schluessel}: ${name[1]} fehlt im :root`);
  });
});
