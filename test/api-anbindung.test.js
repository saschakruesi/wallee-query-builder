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

// --- Antwort-Parser (Submit/Status) ---------------------------------------
// Feldnamen aus dem python-sdk (SubmittedAnalyticsQueryExecution).

test('leseQueryToken liest portalQueryToken', () => {
  assert.strictEqual(rein.leseQueryToken({ portalQueryToken: 'tok-1' }), 'tok-1');
  assert.strictEqual(rein.leseQueryToken({ queryToken: 'tok-2' }), 'tok-2', 'Fallback');
  assert.strictEqual(rein.leseQueryToken({ token: 'tok-3' }), 'tok-3', 'Fallback');
  assert.strictEqual(rein.leseQueryToken(null), '');
  assert.strictEqual(rein.leseQueryToken({}), '');
});

test('leseQueryStatus normalisiert auf Grossbuchstaben', () => {
  assert.strictEqual(rein.leseQueryStatus({ status: 'success' }), 'SUCCESS');
  assert.strictEqual(rein.leseQueryStatus({ status: 'PROCESSING' }), 'PROCESSING');
  assert.strictEqual(rein.leseQueryStatus({ status: { status: 'FAILED' } }), 'FAILED',
    'auch ein verschachteltes status-Objekt');
  assert.strictEqual(rein.leseQueryStatus({}), '');
});

test('istEndzustand/istErfolg', () => {
  assert.ok(rein.istEndzustand('SUCCESS'));
  assert.ok(rein.istEndzustand('FAILED'));
  assert.ok(rein.istEndzustand('CANCELLED'));
  assert.ok(!rein.istEndzustand('PROCESSING'));
  assert.ok(rein.istErfolg('SUCCESS'));
  assert.ok(!rein.istErfolg('FAILED'));
});

// --- Submit -> Poll -> Report ueber ein gefaelschtes fetch ----------------
// Ein Router, der auf Pfad und Methode antwortet. So laesst sich der ganze
// Ablauf ohne Netz durchspielen, inklusive Statuswechsel ueber mehrere Polls.

const fs2 = require('node:fs');
const path2 = require('node:path');
const CSV = fs2.readFileSync(path2.join(__dirname, 'fixtures', 'beispiel-daten.csv'), 'utf8');

function textAntwort(status, text) {
  return { status, text: async () => text, json: async () => JSON.parse(text) };
}

// erstelltRouter({ statusFolge, submitStatus }) simuliert:
//  - POST /submit  -> { portalQueryToken, status: submitStatus }
//  - GET  /status  -> naechster Wert aus statusFolge
//  - GET  /result  -> die Fixture-CSV
function apiRouter(opt) {
  const folge = (opt.statusFolge || ['PROCESSING', 'SUCCESS']).slice();
  return async (url, o) => {
    const u = String(url);
    const m = (o && o.method) || 'GET';
    if (u.endsWith('/health')) return jsonAntwort(200, { ok: true, zugangsdaten: true });
    if (u.endsWith('/submit') && m === 'POST') {
      return jsonAntwort(opt.submitStatus || 200,
        { portalQueryToken: 'tok-xyz', status: opt.submitStatusWert || 'PROCESSING' });
    }
    if (u.includes('/status/')) {
      const naechster = folge.length > 1 ? folge.shift() : folge[0];
      return jsonAntwort(200, { status: naechster });
    }
    if (u.includes('/result/')) return textAntwort(200, opt.csv || CSV);
    if (u.includes('/query/') && m === 'DELETE') return jsonAntwort(200, { ok: true });
    return jsonAntwort(404, { ok: false, fehler: 'unbekannt' });
  };
}

async function starteApiModus(router, seed) {
  const ctx = starteMitFetch(router, seed || { wallee_query_builder_v5: JSON.stringify({ apiMode: true, mode: 'brand' }) });
  // Poll-Intervall herabsetzen, sonst wartet jede Runde 1.5s.
  ctx.app.apiPollConfig.intervallMs = 5;
  await ruhe();  // Health-Check beim Start abwarten
  return ctx;
}

// Gibt der Poll-Schleife (jetzt 5ms-Takt) Zeit, mehrere Runden zu drehen.
const langeRuhe = () => new Promise(r => setTimeout(r, 80));

test('Submit fuehrt SQL aus und uebernimmt das Ergebnis in den Report', async () => {
  const { el } = await starteApiModus(apiRouter({ statusFolge: ['PROCESSING', 'SUCCESS'] }));
  el('sqlOutput').textContent = 'SELECT 1';

  el('submitBtn').dispatch('click');
  await langeRuhe();

  assert.match(el('submitFortschrittText').textContent, /Report erstellt/i);
  // In den Report-Tab gewechselt und der Report gefuellt.
  assert.strictEqual(el('reportOutput').children.length > 0, true, 'Report muss gefuellt sein');
  assert.match(el('reportOutput').textContent, /62’756\.16/, 'Gesamttotal der Fixture');
});

test('Submit sendet das SQL im Feld sql', async () => {
  const gesehen = [];
  const router = apiRouter({});
  const { el } = await starteApiModus(async (url, o) => {
    if (String(url).endsWith('/submit')) gesehen.push(JSON.parse(o.body));
    return router(url, o);
  });
  el('sqlOutput').textContent = 'SELECT 42';

  el('submitBtn').dispatch('click');
  await langeRuhe();

  assert.strictEqual(gesehen.length, 1);
  assert.strictEqual(gesehen[0].sql, 'SELECT 42', 'der Body traegt das Feld sql');
});

test('Submit pollt, bis der Endzustand erreicht ist', async () => {
  let statusAbfragen = 0;
  const router = apiRouter({ statusFolge: ['PROCESSING', 'PROCESSING', 'SUCCESS'] });
  const { el } = await starteApiModus(async (url, o) => {
    if (String(url).includes('/status/')) statusAbfragen++;
    return router(url, o);
  });
  el('sqlOutput').textContent = 'SELECT 1';

  el('submitBtn').dispatch('click');
  await langeRuhe();

  assert.ok(statusAbfragen >= 2, `mehrfach pollen erwartet, war ${statusAbfragen}`);
  assert.match(el('submitFortschrittText').textContent, /Report erstellt/i);
});

test('FAILED-Status fuehrt zu einer Fehlermeldung, kein Report', async () => {
  const { el } = await starteApiModus(apiRouter({ statusFolge: ['PROCESSING', 'FAILED'] }));
  el('sqlOutput').textContent = 'SELECT kaputt';

  el('submitBtn').dispatch('click');
  await langeRuhe();

  assert.match(el('submitFortschrittText').textContent, /FAILED/);
  assert.ok(el('submitFortschritt').classList.contains('fehler'));
  assert.strictEqual(el('reportOutput').children.length, 0, 'bei FAILED darf kein Report entstehen');
});

test('Submit-Fehler (kein Token) wird gemeldet', async () => {
  const { el } = await starteApiModus(async (url, o) => {
    if (String(url).endsWith('/submit')) return jsonAntwort(200, { status: 'PROCESSING' }); // kein Token
    if (String(url).endsWith('/health')) return jsonAntwort(200, { ok: true, zugangsdaten: true });
    return jsonAntwort(404, {});
  });
  el('sqlOutput').textContent = 'SELECT 1';

  el('submitBtn').dispatch('click');
  await langeRuhe();

  assert.match(el('submitFortschrittText').textContent, /Query-Token/);
  assert.ok(el('submitFortschritt').classList.contains('fehler'));
});

test('Result wird erst bei SUCCESS abgerufen (jeder Abruf zaehlt als Download)', async () => {
  let resultAbrufe = 0;
  const router = apiRouter({ statusFolge: ['PROCESSING', 'PROCESSING', 'SUCCESS'] });
  const { el } = await starteApiModus(async (url, o) => {
    if (String(url).includes('/result/')) resultAbrufe++;
    return router(url, o);
  });
  el('sqlOutput').textContent = 'SELECT 1';

  el('submitBtn').dispatch('click');
  await langeRuhe();

  assert.strictEqual(resultAbrufe, 1, 'genau einmal, und erst nach SUCCESS');
});

test('Abbrechen stoppt den Lauf und meldet es dem Proxy', async () => {
  let deleteGerufen = false;
  // Status bleibt auf PROCESSING, damit wir mitten im Poll abbrechen koennen.
  const router = apiRouter({ statusFolge: ['PROCESSING'] });
  const { el } = await starteApiModus(async (url, o) => {
    if (String(url).includes('/query/') && o.method === 'DELETE') deleteGerufen = true;
    return router(url, o);
  });
  el('sqlOutput').textContent = 'SELECT 1';

  el('submitBtn').dispatch('click');
  await ruhe();                       // Submit durch, erster Poll laeuft
  el('submitAbbrechenBtn').dispatch('click');
  await langeRuhe();

  assert.ok(deleteGerufen, 'Abbrechen muss dem Proxy per DELETE Bescheid geben');
  assert.match(el('submitFortschrittText').textContent, /Abgebrochen/);
  assert.strictEqual(el('reportOutput').children.length, 0, 'kein Report nach Abbruch');
});
