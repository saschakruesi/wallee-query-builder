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

const APP = path.join(__dirname, '..', 'wallee_query_builder.html');

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
  // Reporting-Modus (v5.11), reine Funktionen
  'buildReportingQuery',
  'labelExpr',
  'SALES_CHANNEL_POS',
  'SALES_CHANNEL_ECOM',
  'ATTEMPT_ENVIRONMENT',
  'DESC_ISSUER_COUNTRY',
  'DESC_CARD_TYPE',
  'DESC_CARD_CATEGORY',
  'DESC_AUTH_RESPONSE_POS',
  'DESC_AUTH_RESPONSE_ECOM',
  'DESC_DCC_CURRENCY',
  'DESC_PAN_TYPE',
  'DESC_TDS_STARTED',
  'DESC_TDS_CAVV',
  'DESC_ECI',
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
  // Settlement-Report (v5.8), reine Funktionen
  'parseSettlementCsv',
  // Reporting-Modus (v5.11), reine Funktionen
  'parseReportingCsv',
  'REPORTING_PFLICHT',
  // Reporting-Modell (Task 3)
  'buildReportingModel',
  'klassifiziereHerkunft',
  'klassifiziereKartentyp',
  'klassifiziereTds',
  'istKartenBrand',
  'EUROPA_REGION',
  'KARTEN_BRANDS',
  'KARTEN_BUSINESS_REGEX',
  'ISO_RESPONSE_CODES',
  'FAILURE_REASONS',
  // Reporting-Report Export-Bloecke (Task 4). Bewusst nur die beiden
  // Funktionen: die Konstanten (REPORTING_TOP_N, REPORTING_KANAL_LABEL,
  // REPORTING_TOP_JE_BRAND) haben ausserhalb der App keinen Konsumenten -
  // Task 5 laeuft im selben Script-Block und sieht sie ohnehin.
  'reportingExportBloecke',
  'reportingZellFormat',
  // Reporting-Verdrahtung (Task 5): zwei reine Regeln plus der Ingest-Pfad.
  // reportingModellAktuell() ist die Testnaht auf das zuletzt gebaute Modell -
  // gleiche Rolle wie getState() beim State.
  'reportingKanalFilter',
  'reportingTerminalPanelSichtbar',
  'ingestReportingCsv',
  'uebergibReportingCsv',
  'renderReportingReport',
  'reportingModellAktuell',
  // Zeitraum/Spaces fuer die Bloecke - Step 7 haengt daran (siehe §6.2 des Berichts).
  'reportingExportOptionen',
  'aktualisiereReportingInputs',
  // Reporting-Ausgabe (Task 5b): Zellformatierung, Balken-SVG, CSV und
  // PDF-Layout. Alles reine Funktionen; nur der XLSX-Schreiber braucht den
  // Vendor-Block und wird deshalb in test/reporting-xlsx.test.js separat
  // geladen (Muster test/report-xlsx.test.js).
  'formatProzentCH',
  'reportingZellText',
  'svgBalken',
  'reportingBalkenSerien',
  'buildReportingReportCsv',
  'reportingPdfBloecke',
  // Naht auf die Ausgabe EINES Blocks - nur so laesst sich ein von Hand
  // gebauter Block mit zellFormate durch den Bildschirm-Pfad schicken
  // (reportingExportBloecke traegt zellFormate heute nur an den Kacheln).
  'reportingBlockHtml',
  'buildSettlementReportModel',
  'settlementExportBloecke',
  'buildSettlementReportCsv',
  'zellTyp',
  'xlsxBlattName',
  'settlementPdfBloecke',
  'ingestSettlementCsv',
  'renderSettlementReport',
  'uebergibSettlementCsv',
  'aktiverAccount',
  'berichtsEndeCH',
  'berichtsEndeTag',
  'formatZahlCH',
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
  'mitAccount',
  'deuteHealth',
  'leseQueryToken',
  'leseQueryStatus',
  'istEndzustand',
  'istErfolg',
  'apiPollConfig',
  'leseCredentials',
  'speichereCredentials',
  'holeErgebnisText',
  'mergeSyncTerminals',
  'syncButtonZustand',
  'spaceLabelBauen',
  'terminalGehoertZuSpace',
  'setzeAuswahlFuerSpace',
  // Verlauf (Task 5), reine Funktionen
  'HISTORY_KEY',
  'HISTORY_MAX',
  'modusLabel',
  'historyEintragBauen',
  'historyEinfuegen',
  'historyFuerModus',
  'historyLaden',
  'historySpeichern',
  // DOM-gebunden, aber ueber den DOM-Ersatz pruefbar: welche Knoepfe eine
  // Verlaufszeile je Modus traegt (Task 5b, Step 8).
  'renderHistory',
  'submitUndReport',
  // Self-Update (Task 3), reine Funktion
  'istNeuer',
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
