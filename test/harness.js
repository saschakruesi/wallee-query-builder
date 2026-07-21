// Extrahiert den App-Logik-Block aus der Single-File-App und laedt ihn in Node,
// damit die SQL- und Report-Funktionen ohne Browser getestet werden koennen.
// Einzige Stelle im Projekt, die DOM-Wissen enthaelt.
//
// Die HTML-Datei enthaelt seit v4 zwei <script>-Bloecke: den eingebetteten
// SheetJS-Vendor-Block (id="vendor-xlsx", ~930 KB minified) und den App-Code
// (id="app-logic"). Getestet wird ausschliesslich der App-Block - SheetJS wird
// nur im DOM-/Event-Pfad benutzt (XLSX-Export) und ist fuer die reinen
// Funktionen irrelevant. Deshalb wird hier gezielt ueber die id extrahiert,
// statt "der einzige <script>-Block" anzunehmen.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = path.join(__dirname, '..', 'wallee_query_builder_v2.html');

// Ein No-Op-Element, das jeden Zugriff des App-Scripts vertraegt.
function makeElement() {
  const el = {
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    dataset: {},
    style: {},
    classList: {
      toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false,
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    appendChild: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    removeAttribute: () => {},
    focus: () => {},
    blur: () => {},
    select: () => {},
    closest: () => null,
    querySelector: () => makeElement(),
    querySelectorAll: () => [],
  };
  return el;
}

function makeDocument() {
  return {
    getElementById: () => makeElement(),
    querySelector: () => makeElement(),
    querySelectorAll: () => [],          // hat forEach, weil Array
    createElement: () => makeElement(),
    createRange: () => ({ selectNodeContents: () => {} }),
    addEventListener: () => {},
    body: makeElement(),
  };
}

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

// Namen, die das App-Script auf globalThis legen soll, damit wir sie testen koennen.
const EXPORTED = [
  'buildBrandQuery',
  'buildTerminalQuery',
  'buildExportQuery',
  'buildCardQuery',
  'buildSettlementQuery',
  'EXPORT_COLUMNS',
  'defaultColumns',
  'spaceInClause',
  'txCte',
  'cardCte',
  'tipCte',
  'settleExistsCte',
  'loadState',
  'saveState',
  'STORAGE_KEY',
  'STORAGE_KEY_OLD',
  // Report-Kern (v4), ebenfalls reine Funktionen
  'parseReportCsv',
  'csvZuZeilen',
  'parseAmount',
  'AMOUNT_SCALE',
  'autoOutletGroup',
  'autoBrandGroup',
  'buildReportModel',
  'formatAmountCH',
  'formatIntCH',
  'mergeReportConfig',
  'loadReportConfig',
  'saveReportConfig',
  'REPORT_CFG_KEY',
  // DOM-gebunden, aber ueber einen DOM-Ersatz testbar (test/report-render.test.js)
  'ingestReportCsv',
  'renderReport',
  'reportExportBloecke',
  'buildReportCsv',
  'exportReportXlsx',
  // API-Anbindung (Task 11), reine Helfer
  'normalisiereProxyUrl',
  'proxyEndpunkt',
  'deuteHealth',
  'leseQueryToken',
  'leseQueryStatus',
  'istEndzustand',
  'istErfolg',
  'apiPollConfig',
  'leseCredentials',
  'speichereCredentials',
  'holeErgebnisText',
  // Verlauf (Task 5), reine Funktionen
  'HISTORY_KEY',
  'HISTORY_MAX',
  'modusLabel',
  'historyEintragBauen',
  'historyEinfuegen',
  'historyFuerModus',
  'historyLaden',
  'historySpeichern',
];

// Schneidet den Inhalt von <script id="..."> ... </script> aus dem HTML.
// Bewusst per indexOf statt per Regex: der Vendor-Block ist ~930 KB gross, ein
// greedy [\s\S]* daneben ist unnoetig teuer und bei mehreren Bloecken auch noch
// mehrdeutig. Der Vendor-Block enthaelt selbst kein "</script" (beim Einbetten
// geprueft), deshalb ist das erste "</script>" nach dem Opening-Tag das richtige.
function extractScript(html, id) {
  const openTag = `<script id="${id}">`;
  const start = html.indexOf(openTag);
  if (start === -1) {
    throw new Error(`Kein <script id="${id}">-Block in ${APP} gefunden`);
  }
  if (html.indexOf(openTag, start + openTag.length) !== -1) {
    throw new Error(`Mehr als ein <script id="${id}">-Block in ${APP}`);
  }
  const from = start + openTag.length;
  const end = html.indexOf('</script>', from);
  if (end === -1) {
    throw new Error(`Kein schliessendes </script> fuer id="${id}" in ${APP}`);
  }
  return html.slice(from, end);
}

// options.seedLocalStorage: { [key]: string } - wird VOR dem Laden des Scripts in
// localStorage geschrieben, damit loadState() (das beim Init des Scripts einmalig
// laeuft) Migrationsszenarien sieht, statt immer von einem leeren Storage zu starten.
function loadBuilders(options = {}) {
  const html = fs.readFileSync(APP, 'utf8');
  const appScript = extractScript(html, 'app-logic');

  // Der Script-Block deklariert alles mit const/function im Modul-Scope.
  // Wir haengen einen Export-Epilog an, der die Builder nach aussen reicht.
  // "state" ist ein let im Modul-Scope und wird von loadState() per Reassignment
  // ersetzt - ein einmalig eingesammelter Wert waere nach einem erneuten loadState()
  // veraltet. Deshalb zusaetzlich eine lebende getState()-Closure exportieren.
  const epilog = '\n;(function(){' +
    EXPORTED.map(n => `try { globalThis.__x.${n} = ${n}; } catch (e) {}`).join('\n') +
    '\ntry { globalThis.__x.getState = function () { return state; }; } catch (e) {}' +
    '})();';

  // options.blockLocalStorage: simuliert den Private Mode, in dem jeder Zugriff
  // auf localStorage wirft. Die App muss dann ohne Persistenz weiterlaufen,
  // statt beim Start oder beim Speichern zu crashen.
  const localStorage = options.blockLocalStorage
    ? {
      getItem() { throw new Error('localStorage blockiert'); },
      setItem() { throw new Error('localStorage blockiert'); },
      removeItem() { throw new Error('localStorage blockiert'); },
      clear() { throw new Error('localStorage blockiert'); },
    }
    : makeLocalStorage();
  if (options.seedLocalStorage) {
    Object.keys(options.seedLocalStorage).forEach(key => {
      localStorage.setItem(key, options.seedLocalStorage[key]);
    });
  }

  const sandbox = {
    // options.document: reicherer DOM-Ersatz fuer Tests, die tatsaechlich
    // gerenderte Struktur pruefen (siehe test/report-render.test.js). Ohne
    // diese Option bleibt es beim No-Op-Stub, der nur verhindern soll, dass
    // das Script beim Laden stolpert.
    document: options.document || makeDocument(),
    localStorage,
    window: { getSelection: () => ({ removeAllRanges: () => {}, addRange: () => {} }) },
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    // options.fetch: gefaelschtes fetch fuer Tests der API-Anbindung. Ohne die
    // Option gibt es kein fetch im Sandbox - reiner SQL-/Report-Code braucht es
    // nicht, und ein echtes fetch soll aus Tests nie ins Netz gehen.
    fetch: options.fetch,
    AbortController,
    __x: {},
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(appScript + epilog, sandbox, { filename: 'query-builder-script.js' });

  const missing = ['buildBrandQuery', 'buildTerminalQuery', 'buildExportQuery']
    .filter(n => typeof sandbox.__x[n] !== 'function');
  if (missing.length) {
    throw new Error('Builder nicht exportiert: ' + missing.join(', '));
  }
  // Nicht Teil der App, nur fuer Tests: direkter Zugriff auf den localStorage-Stub
  // dieser Sandbox, um Persistenz (z. B. nach einer Migration) zu verifizieren.
  sandbox.__x._localStorage = localStorage;
  return sandbox.__x;
}

// Objekte und Arrays, die im vm-Kontext entstehen, haben die Intrinsics jenes
// Realms - ihr Prototyp ist nicht derselbe wie hier draussen. assert.deepStrictEqual
// vergleicht auch den Prototyp und meldet dann "same structure but not
// reference-equal", obwohl der Inhalt stimmt. plain() zieht den Wert per
// JSON-Runde in diesen Realm herueber, damit strikte Vergleiche moeglich sind.
// Nur fuer reine Datenstrukturen gedacht (der Report-Kern liefert genau solche).
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { loadBuilders, plain };
