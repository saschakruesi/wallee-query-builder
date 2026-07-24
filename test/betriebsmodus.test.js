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

test('alter report-Modus migriert zu terminal', () => {
  // Der eigenstaendige Report-Tab ist aufgeloest (Terminal-Report ist jetzt
  // die Ausgabe von 'terminal'). Ein alter State mit mode:'report' darf nicht
  // auf 'brand' zurueckfallen, sondern muss gezielt nach 'terminal' migrieren.
  const x = loadBuilders({ seedLocalStorage: { 'wallee_query_builder_v5': JSON.stringify({ mode: 'report' }) } });
  assert.strictEqual(x.getState().mode, 'terminal');
});

test('STORAGE_KEY ist v6', () => {
  const x = loadBuilders();
  assert.strictEqual(x.STORAGE_KEY, 'wallee_query_builder_v6');
});

// --- Einstellungs-Dialog ---------------------------------------------------
// Die Einstellungen gelten modusuebergreifend, deshalb sitzen sie hinter dem
// Zahnrad im Kopf und nicht in einem der Tab-Panels.

test('Einstellungen sind beim Start geschlossen', () => {
  const { el } = starte();
  assert.ok(!sichtbar(el('settingsOverlay')), 'Dialog darf nicht offen starten');
  assert.strictEqual(el('settingsBtn').getAttribute('aria-expanded'), 'false');
});

test('Zahnrad oeffnet den Dialog, X schliesst ihn', () => {
  const { el } = starte();

  el('settingsBtn').dispatch('click');
  assert.ok(sichtbar(el('settingsOverlay')));
  assert.strictEqual(el('settingsBtn').getAttribute('aria-expanded'), 'true');

  el('settingsCloseBtn').dispatch('click');
  assert.ok(!sichtbar(el('settingsOverlay')));
  assert.strictEqual(el('settingsBtn').getAttribute('aria-expanded'), 'false');
});

test('Klick auf den Hintergrund schliesst, Klick im Dialog nicht', () => {
  const { el } = starte();
  const overlay = el('settingsOverlay');

  el('settingsBtn').dispatch('click');
  // Klick im Dialog: target ist nicht das Overlay selbst.
  overlay.dispatch('click', { target: el('apiModeToggle') });
  assert.ok(sichtbar(overlay), 'ein Klick im Dialog darf ihn nicht schliessen');

  overlay.dispatch('click', { target: overlay });
  assert.ok(!sichtbar(overlay), 'Klick auf den Hintergrund schliesst');
});

test('ESC schliesst den Dialog', () => {
  const { dokument, el } = starte();

  el('settingsBtn').dispatch('click');
  assert.ok(sichtbar(el('settingsOverlay')));

  dokument.dispatch('keydown', { key: 'Escape' });
  assert.ok(!sichtbar(el('settingsOverlay')));
});

test('ESC bei geschlossenem Dialog tut nichts', () => {
  const { dokument, el } = starte();
  assert.doesNotThrow(() => dokument.dispatch('keydown', { key: 'Escape' }));
  assert.ok(!sichtbar(el('settingsOverlay')));
});

test('Einstellungen sind unabhaengig vom aktiven Modus erreichbar', () => {
  // Der Betriebsmodus gilt fuer alle Tabs - auch im Terminal-Report muss man
  // an die Einstellungen kommen.
  ['brand', 'terminal', 'export', 'card', 'settlement'].forEach(modus => {
    const { el } = starte({ wallee_query_builder_v5: JSON.stringify({ mode: modus }) });
    el('settingsBtn').dispatch('click');
    assert.ok(sichtbar(el('settingsOverlay')), `Dialog nicht erreichbar im Modus ${modus}`);
  });
});

test('Settlement-State: neue Felder mit Defaults, kein STORAGE_KEY-Bump noetig', () => {
  const { getState, STORAGE_KEY } = loadBuilders();
  const st = getState();
  assert.strictEqual(st.settlementAccountId, '');
  assert.strictEqual(st.settlementSuperUser, false);
  assert.strictEqual(st.settlementDetail, true);
  assert.strictEqual(STORAGE_KEY, 'wallee_query_builder_v6', 'Die Aenderung ist additiv - kein Bump');
});

test('Settlement-State: alter State ohne die neuen Felder bekommt die Defaults', () => {
  const alt = JSON.stringify({
    mode: 'settlement',
    settlementByTerminal: true,
    spaces: [{ id: '123', label: '', selected: true }],
  });
  const { getState } = loadBuilders({
    seedLocalStorage: { wallee_query_builder_v6: alt },
  });
  const st = getState();
  assert.strictEqual(st.mode, 'settlement');
  assert.strictEqual(st.settlementAccountId, '');
  assert.strictEqual(st.settlementSuperUser, false);
  assert.strictEqual(st.settlementDetail, true);
});
