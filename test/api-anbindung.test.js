// Tests fuer die API-Anbindung in der App (Task 11): URL-Normalisierung,
// Health-Auswertung und - ueber ein gefaelschtes fetch - der Health-Check samt
// Fallback, ohne je ins Netz zu gehen.

const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders, plain } = require('./harness');
const { makeDocument } = require('./dom-stub');

// --- Reine Helfer ----------------------------------------------------------

const rein = loadBuilders();

test('normalisiereProxyUrl schneidet Trailing-Slashes ab', () => {
  assert.strictEqual(rein.normalisiereProxyUrl('http://localhost:8787/'), 'http://localhost:8787');
  assert.strictEqual(rein.normalisiereProxyUrl('http://localhost:8787///'), 'http://localhost:8787');
  assert.strictEqual(rein.normalisiereProxyUrl('  http://localhost:8787  '), 'http://localhost:8787');
});

test('normalisiereProxyUrl faellt bei leerer Eingabe auf den Default', () => {
  assert.strictEqual(rein.normalisiereProxyUrl(''), 'http://localhost:8787');
  assert.strictEqual(rein.normalisiereProxyUrl(null), 'http://localhost:8787');
  assert.strictEqual(rein.normalisiereProxyUrl('   '), 'http://localhost:8787');
});

test('proxyEndpunkt haengt den Pfad sauber an - kein doppelter Slash', () => {
  assert.strictEqual(rein.proxyEndpunkt('http://localhost:8787/', '/health'),
    'http://localhost:8787/health');
  assert.strictEqual(rein.proxyEndpunkt('http://localhost:9999', '/setup'),
    'http://localhost:9999/setup');
});

test('deuteHealth: 200 mit ok und Zugangsdaten heisst bereit', () => {
  assert.deepStrictEqual(plain(rein.deuteHealth(200, { ok: true, zugangsdaten: true })),
    { erreichbar: true, bereit: true });
});

test('deuteHealth: 200 mit ok, aber ohne Zugangsdaten heisst erreichbar, nicht bereit', () => {
  assert.deepStrictEqual(plain(rein.deuteHealth(200, { ok: true, zugangsdaten: false })),
    { erreichbar: true, bereit: false });
});

test('deuteHealth: alles andere ist nicht erreichbar', () => {
  assert.deepStrictEqual(plain(rein.deuteHealth(500, { ok: false })),
    { erreichbar: false, bereit: false });
  assert.deepStrictEqual(plain(rein.deuteHealth(200, null)),
    { erreichbar: false, bereit: false });
  assert.deepStrictEqual(plain(rein.deuteHealth(404, { ok: true })),
    { erreichbar: false, bereit: false });
});

// --- Health-Check und Fallback ueber ein gefaelschtes fetch ---------------

// Baut eine App-Instanz mit kontrolliertem fetch. rufe merkt sich jeden Aufruf.
function starteMitFetch(fetchImpl, seed) {
  const rufe = [];
  const dokument = makeDocument();
  const app = loadBuilders({
    document: dokument,
    seedLocalStorage: seed,
    fetch: async (url, opts) => {
      rufe.push({ url, opts });
      return fetchImpl(url, opts);
    },
  });
  return { app, dokument, rufe, el: id => dokument.getElementById(id) };
}

function jsonAntwort(status, objekt) {
  return { status, json: async () => objekt };
}

const sichtbar = el => !el.classList.contains('hidden');

// Wartet, bis die im Handler gestarteten Promises durchgelaufen sind.
const ruhe = () => new Promise(r => setTimeout(r, 10));

test('API-Modus aktivieren pingt /health mit dem Zusatz-Header', async () => {
  const { el, rufe } = starteMitFetch(() => jsonAntwort(200, { ok: true, zugangsdaten: true }));

  el('apiModeToggle').checked = true;
  el('apiModeToggle').dispatch('change');
  await ruhe();

  const health = rufe.find(r => String(r.url).endsWith('/health'));
  assert.ok(health, '/health muss beim Aktivieren abgefragt werden');
  assert.strictEqual(health.opts.headers['x-wallee-proxy'], '1',
    'ohne den Zusatz-Header weist der Proxy die Anfrage mit 403 ab');
});

test('bereiter Proxy: Statusmeldung ist positiv', async () => {
  const { el } = starteMitFetch(() => jsonAntwort(200, { ok: true, zugangsdaten: true }));
  el('apiModeToggle').checked = true;
  el('apiModeToggle').dispatch('change');
  await ruhe();

  assert.match(el('proxyStatus').textContent, /erreichbar und einsatzbereit/i);
  assert.strictEqual(el('proxyStatus').dataset.art, 'ok');
});

test('Proxy laeuft, aber ohne Zugangsdaten: Hinweis auf Setup', async () => {
  const { el } = starteMitFetch(() => jsonAntwort(200, { ok: true, zugangsdaten: false }));
  el('apiModeToggle').checked = true;
  el('apiModeToggle').dispatch('change');
  await ruhe();

  assert.strictEqual(el('proxyStatus').dataset.art, 'warn');
  assert.match(el('proxyStatus').textContent, /Zugangsdaten/);
});

test('Proxy nicht erreichbar: klarer Hinweis mit Startbefehl, kein Wurf', async () => {
  const { el } = starteMitFetch(() => { throw new Error('ECONNREFUSED'); });
  el('apiModeToggle').checked = true;
  el('apiModeToggle').dispatch('change');
  await ruhe();

  assert.strictEqual(el('proxyStatus').dataset.art, 'fehler');
  assert.match(el('proxyStatus').textContent, /node wallee-proxy\.mjs/,
    'die Meldung muss sagen, wie man den Proxy startet');
  assert.match(el('proxyStatus').textContent, /Kopiermodus/,
    'und dass man ersatzweise im Kopiermodus arbeiten kann');
});

test('Submit prueft den Proxy vor der Ausfuehrung', async () => {
  const { el, rufe } = starteMitFetch(() => jsonAntwort(200, { ok: true, zugangsdaten: true }));
  el('apiModeToggle').checked = true;
  el('apiModeToggle').dispatch('change');
  await ruhe();
  const vorher = rufe.length;

  el('submitBtn').dispatch('click');
  await ruhe();

  assert.ok(rufe.length > vorher, 'Submit muss den Proxy erneut pruefen');
  assert.ok(rufe.slice(vorher).some(r => String(r.url).endsWith('/health')));
});

test('Submit bei totem Proxy blockiert nicht, sondern oeffnet die Einstellungen', async () => {
  const { el } = starteMitFetch(() => { throw new Error('ECONNREFUSED'); },
    { wallee_query_builder_v5: JSON.stringify({ apiMode: true, mode: 'brand' }) });

  // Dialog erst schliessen, damit der Effekt sichtbar wird.
  el('settingsBtn').dispatch('click');
  el('settingsCloseBtn').dispatch('click');
  assert.ok(!sichtbar(el('settingsOverlay')));

  el('submitBtn').dispatch('click');
  await ruhe();

  assert.strictEqual(el('proxyStatus').dataset.art, 'fehler');
  assert.ok(sichtbar(el('settingsOverlay')),
    'bei totem Proxy sollen die Einstellungen aufgehen, statt still zu scheitern');
  // Der Submit-Button darf danach nicht dauerhaft deaktiviert bleiben.
  assert.notStrictEqual(el('submitBtn').disabled, true);
});

test('Setup-Link zeigt auf die konfigurierte Proxy-URL', async () => {
  const { el } = starteMitFetch(() => jsonAntwort(200, { ok: true, zugangsdaten: true }));
  el('apiModeToggle').checked = true;
  el('apiModeToggle').dispatch('change');
  await ruhe();

  assert.strictEqual(el('proxySetupLink').href, 'http://localhost:8787/setup');

  el('proxyUrlInput').value = 'http://localhost:9000';
  el('proxyUrlInput').dispatch('input');
  assert.strictEqual(el('proxySetupLink').href, 'http://localhost:9000/setup');
});

test('Kopiermodus fragt den Proxy nie ab', async () => {
  const { el, rufe } = starteMitFetch(() => jsonAntwort(200, { ok: true, zugangsdaten: true }));
  // Bleibt im Default-Kopiermodus.
  assert.strictEqual(el('apiModeToggle').checked, false);
  await ruhe();
  assert.strictEqual(rufe.length, 0, 'ohne API-Modus darf es keinen Netzaufruf geben');
});
