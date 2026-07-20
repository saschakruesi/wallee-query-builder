// Extrahiert den <script>-Block aus der Single-File-App und laedt ihn in Node,
// damit die SQL-Builder ohne Browser getestet werden koennen.
// Einzige Stelle im Projekt, die DOM-Wissen enthaelt.

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
  'loadState',
  'saveState',
  'STORAGE_KEY',
  'STORAGE_KEY_OLD',
];

// options.seedLocalStorage: { [key]: string } - wird VOR dem Laden des Scripts in
// localStorage geschrieben, damit loadState() (das beim Init des Scripts einmalig
// laeuft) Migrationsszenarien sieht, statt immer von einem leeren Storage zu starten.
function loadBuilders(options = {}) {
  const html = fs.readFileSync(APP, 'utf8');
  const scriptCount = (html.match(/<script/g) || []).length;
  if (scriptCount !== 1) {
    throw new Error(`Erwartet genau 1 <script>-Tag in ${APP}, gefunden: ${scriptCount}`);
  }
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  if (!match) throw new Error('Kein <script>-Block in ' + APP + ' gefunden');

  // Der Script-Block deklariert alles mit const/function im Modul-Scope.
  // Wir haengen einen Export-Epilog an, der die Builder nach aussen reicht.
  // "state" ist ein let im Modul-Scope und wird von loadState() per Reassignment
  // ersetzt - ein einmalig eingesammelter Wert waere nach einem erneuten loadState()
  // veraltet. Deshalb zusaetzlich eine lebende getState()-Closure exportieren.
  const epilog = '\n;(function(){' +
    EXPORTED.map(n => `try { globalThis.__x.${n} = ${n}; } catch (e) {}`).join('\n') +
    '\ntry { globalThis.__x.getState = function () { return state; }; } catch (e) {}' +
    '})();';

  const localStorage = makeLocalStorage();
  if (options.seedLocalStorage) {
    Object.keys(options.seedLocalStorage).forEach(key => {
      localStorage.setItem(key, options.seedLocalStorage[key]);
    });
  }

  const sandbox = {
    document: makeDocument(),
    localStorage,
    window: { getSelection: () => ({ removeAllRanges: () => {}, addRange: () => {} }) },
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    __x: {},
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(match[1] + epilog, sandbox, { filename: 'query-builder-script.js' });

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

module.exports = { loadBuilders };
