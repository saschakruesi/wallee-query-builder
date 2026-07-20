// Prueft die Umschaltung zwischen Kopieren- und API-Modus.
//
// Der Kopieren-Modus ist der Default und muss ohne jede Installation
// funktionieren - deshalb ist hier vor allem wichtig, dass er unveraendert
// bleibt und niemand versehentlich im API-Modus landet.

const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders } = require('./harness');
const { makeDocument } = require('./dom-stub');

function starte(seed) {
  const dokument = makeDocument();
  const app = loadBuilders({
    document: dokument,
    seedLocalStorage: seed,
  });
  return { app, dokument, el: id => dokument.getElementById(id) };
}

const sichtbar = el => !el.classList.contains('hidden');

test('Default ist der Kopieren-Modus', () => {
  const { app } = starte();
  const state = app.getState();

  assert.strictEqual(state.apiMode, false, 'API-Modus darf nicht der Default sein');
  assert.strictEqual(state.proxyUrl, 'http://localhost:8787');
});

test('Kopieren-Modus: SQL sichtbar, kein Submit-Button', () => {
  const { el } = starte();

  assert.ok(sichtbar(el('sqlOutput')), 'SQL muss sichtbar sein');
  assert.ok(sichtbar(el('copyBtn')), 'Kopieren-Button muss da sein');
  assert.ok(sichtbar(el('sqlEinfuegenHinweis')), 'Hinweis zum Einfuegen ins Portal muss da sein');
  assert.ok(!sichtbar(el('submitBtn')), 'Submit gehoert nicht in den Kopieren-Modus');
  assert.ok(!sichtbar(el('sqlToggleBtn')), 'Toggle gehoert nicht in den Kopieren-Modus');
  assert.ok(!sichtbar(el('apiSettings')), 'Proxy-Einstellungen bleiben eingeklappt');
});

test('API-Modus einschalten: Submit wird zur Hauptaktion, SQL klappt zu', () => {
  const { app, el } = starte();

  el('apiModeToggle').checked = true;
  el('apiModeToggle').dispatch('change');

  assert.strictEqual(app.getState().apiMode, true);
  assert.ok(sichtbar(el('submitBtn')), 'Submit muss erscheinen');
  assert.ok(sichtbar(el('sqlToggleBtn')), 'Toggle muss erscheinen');
  assert.ok(sichtbar(el('apiSettings')), 'Proxy-Einstellungen muessen erscheinen');
  assert.ok(!sichtbar(el('sqlOutput')), 'SQL soll zunaechst eingeklappt sein');
  assert.ok(!sichtbar(el('sqlEinfuegenHinweis')), 'Portal-Hinweis passt nicht zum API-Modus');
});

test('Toggle "Query anzeigen" klappt das SQL auf und wieder zu', () => {
  const { app, el } = starte();
  el('apiModeToggle').checked = true;
  el('apiModeToggle').dispatch('change');

  const toggle = el('sqlToggleBtn');
  assert.strictEqual(toggle.textContent, 'Query anzeigen');
  assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');

  toggle.dispatch('click');
  assert.ok(sichtbar(el('sqlOutput')), 'SQL muss nach dem Klick sichtbar sein');
  assert.strictEqual(toggle.textContent, 'Query ausblenden');
  assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(sichtbar(el('copyBtn')), 'bei sichtbarem SQL soll auch Kopieren gehen');

  toggle.dispatch('click');
  assert.ok(!sichtbar(el('sqlOutput')));
  assert.strictEqual(app.getState().sqlSichtbar, false);
});

test('Zurueck auf Kopieren-Modus stellt den Ausgangszustand wieder her', () => {
  const { el } = starte();
  el('apiModeToggle').checked = true;
  el('apiModeToggle').dispatch('change');
  el('apiModeToggle').checked = false;
  el('apiModeToggle').dispatch('change');

  assert.ok(sichtbar(el('sqlOutput')));
  assert.ok(sichtbar(el('sqlEinfuegenHinweis')));
  assert.ok(!sichtbar(el('submitBtn')));
  assert.ok(!sichtbar(el('apiSettings')));
});

test('Betriebsmodus und Proxy-URL werden gespeichert', () => {
  const { app, el } = starte();

  el('apiModeToggle').checked = true;
  el('apiModeToggle').dispatch('change');
  el('proxyUrlInput').value = 'http://localhost:9999';
  el('proxyUrlInput').dispatch('input');

  const gespeichert = JSON.parse(app._localStorage.getItem(app.STORAGE_KEY));
  assert.strictEqual(gespeichert.apiMode, true);
  assert.strictEqual(gespeichert.proxyUrl, 'http://localhost:9999');
});

test('gespeicherter API-Modus wird beim Start wiederhergestellt', () => {
  const { app, el } = starte({
    wallee_query_builder_v5: JSON.stringify({
      mode: 'brand', apiMode: true, proxyUrl: 'http://localhost:9999', sqlSichtbar: true,
    }),
  });

  assert.strictEqual(app.getState().apiMode, true);
  assert.strictEqual(el('proxyUrlInput').value, 'http://localhost:9999');
  assert.ok(sichtbar(el('submitBtn')), 'Submit muss nach dem Laden direkt da sein');
  assert.ok(sichtbar(el('sqlOutput')), 'aufgeklappter Zustand muss erhalten bleiben');
});

test('alter State ohne die neuen Felder faellt sauber auf den Kopieren-Modus', () => {
  // Ein State aus v3 des Builders kennt apiMode/proxyUrl nicht. Er darf
  // deswegen weder crashen noch versehentlich im API-Modus landen.
  const { app, el } = starte({
    wallee_query_builder_v5: JSON.stringify({ mode: 'terminal', spaces: [{ id: '73192', selected: true }] }),
  });

  assert.strictEqual(app.getState().apiMode, false);
  assert.strictEqual(app.getState().proxyUrl, 'http://localhost:8787');
  assert.ok(!sichtbar(el('submitBtn')));
});

test('Report-Modus ueberlebt einen Neustart', () => {
  // Regression: die Modus-Whitelist in loadState() kannte 'report' zunaechst
  // nicht, der Tab waere nach jedem Neuladen auf 'brand' zurueckgesprungen.
  const { app } = starte({
    wallee_query_builder_v5: JSON.stringify({ mode: 'report' }),
  });
  assert.strictEqual(app.getState().mode, 'report');
});
