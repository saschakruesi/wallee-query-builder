// Verdrahtung des Reporting-Modus: Kanal-Abbildung, Panel-Sichtbarkeit,
// SQL-Erzeugung und der Ingest-Pfad.
//
// Die reinen Regeln (Kanal-Abbildung, Terminal-Panel) sind bewusst als eigene
// Funktionen herausgezogen, damit sie ohne DOM pruefbar sind - die
// Panel-Sichtbarkeit haengt nicht nur am Modus, sondern auch an zwei Feldern,
// die sich waehrend des Modus aendern koennen.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadBuilders, plain } = require('./harness');
const { makeDocument } = require('./dom-stub');

const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'reporting-beispiel.csv'), 'utf8');

function starte(seed) {
  const dokument = makeDocument();
  const app = loadBuilders({ document: dokument, seedLocalStorage: seed });
  return { app, dokument, el: id => dokument.getElementById(id) };
}

const aktiv = el => el.classList.contains('active');
const sichtbar = el => !el.classList.contains('hidden');

// --- Kanal-Abbildung -------------------------------------------------------

test('Kanal "Beide" ergibt eine LEERE Kanalliste, nicht [POS, ECOM]', () => {
  // Der Unterschied ist fachlich: eine leere Liste heisst "gar kein
  // saleschannel-Filter", damit ein dritter Kanal als OTHER sichtbar bleibt
  // (SPEC 7). ['POS','ECOM'] wuerde ihn still herausfiltern.
  const { app } = starte();
  assert.deepStrictEqual(plain(app.reportingKanalFilter('BOTH')), []);
  assert.deepStrictEqual(plain(app.reportingKanalFilter('POS')), ['POS']);
  assert.deepStrictEqual(plain(app.reportingKanalFilter('ECOM')), ['ECOM']);
});

test('Unbekannte Kanalwahl verhaelt sich wie "Beide"', () => {
  const { app } = starte();
  assert.deepStrictEqual(plain(app.reportingKanalFilter('')), []);
  assert.deepStrictEqual(plain(app.reportingKanalFilter('IRGENDWAS')), []);
});

// --- Regel fuer das Terminal-Panel ----------------------------------------

test('Terminal-Panel: nur bei Aufschluesselung UND einem Kanal mit Terminals', () => {
  const { app } = starte();
  const f = app.reportingTerminalPanelSichtbar;
  assert.strictEqual(f('POS', true), true);
  assert.strictEqual(f('BOTH', true), true, 'Bei "Beide" haengt der POS-Teil an Terminals');
  assert.strictEqual(f('ECOM', true), false, 'E-Commerce hat keine Terminals');
  assert.strictEqual(f('POS', false), false);
  assert.strictEqual(f('BOTH', false), false);
  assert.strictEqual(f('ECOM', false), false);
});

// --- setMode: Sichtbarkeitsmatrix ------------------------------------------

test('setMode("reporting"): Space-Panel an, Spalten/Karten/Settlement aus', () => {
  const { el } = starte({ wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }) });

  assert.ok(sichtbar(el('spaceSection')), 'Reporting filtert nach Space');
  assert.ok(aktiv(el('reportingSection')), 'Reporting-Panel muss an sein');
  assert.ok(aktiv(el('reportingReportSection')), 'Reporting-Report-Panel muss an sein');
  assert.ok(!aktiv(el('exportSection')), 'Spalten-Panel gehoert nicht zu reporting');
  assert.ok(!aktiv(el('cardSection')), 'Kartensuche gehoert nicht zu reporting');
  assert.ok(!aktiv(el('settlementSection')), 'Settlement gehoert nicht zu reporting');
  assert.ok(!aktiv(el('settlementReportSection')));
  assert.ok(!aktiv(el('reportSection')), 'Terminal-Report gehoert nicht zu reporting');
  assert.ok(!aktiv(el('terminalSection')), 'Ohne Aufschluesselung kein Terminal-Panel');
});

test('In einem anderen Modus bleiben beide Reporting-Panels aus', () => {
  const { el } = starte({ wallee_query_builder_v6: JSON.stringify({ mode: 'brand' }) });
  assert.ok(!aktiv(el('reportingSection')));
  assert.ok(!aktiv(el('reportingReportSection')));
});

test('Terminal-Panel folgt der Checkbox und der Kanalwahl, nicht nur dem Modus', () => {
  const { app, el } = starte({
    wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }),
  });
  assert.ok(!aktiv(el('terminalSection')), 'Ausgangslage: keine Aufschluesselung');

  el('reportingByTerminal').checked = true;
  el('reportingByTerminal').dispatch('change');
  assert.strictEqual(app.getState().reportingByTerminal, true);
  assert.ok(aktiv(el('terminalSection')), 'Aufschluesselung blendet das Terminal-Panel ein');

  el('reportingChannelEcom').checked = true;
  el('reportingChannelEcom').dispatch('change');
  assert.strictEqual(app.getState().reportingChannel, 'ECOM');
  assert.ok(!aktiv(el('terminalSection')), 'E-Commerce hat keine Terminals');

  el('reportingChannelBoth').checked = true;
  el('reportingChannelBoth').dispatch('change');
  assert.strictEqual(app.getState().reportingChannel, 'BOTH');
  assert.ok(aktiv(el('terminalSection')), 'Bei "Beide" ist der POS-Teil wieder betroffen');
});

test('Haendler-Land wird als ISO-2 in Grossbuchstaben gehalten', () => {
  const { app, el } = starte({
    wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }),
  });
  el('reportingMerchantCountry').value = 'de';
  el('reportingMerchantCountry').dispatch('input');
  assert.strictEqual(app.getState().reportingMerchantCountry, 'DE');
});

// --- generate() ------------------------------------------------------------

function sql(app, dokument) {
  void app;
  return dokument.getElementById('sqlOutput').textContent;
}

test('generate() erzeugt im Modus reporting die Reporting-Query', () => {
  const { app, dokument } = starte({
    wallee_query_builder_v6: JSON.stringify({
      mode: 'reporting',
      spaces: [{ id: '40402', label: '', selected: true }],
    }),
  });
  const s = sql(app, dokument);
  assert.match(s, /FROM chargeattempt ca/, 'Basis ist der Charge Attempt');
  assert.match(s, /ca\.environment = 'PRODUCTION'/);
  assert.match(s, /ca\.spaceid = 40402/);
  assert.doesNotMatch(s, /ca\.saleschannel IN/, '"Beide" darf gar nicht nach Kanal filtern');
});

test('generate() setzt den Kanalfilter, sobald ein einzelner Kanal gewaehlt ist', () => {
  const { app, dokument, el } = starte({
    wallee_query_builder_v6: JSON.stringify({
      mode: 'reporting', spaces: [{ id: '40402', label: '', selected: true }],
    }),
  });
  el('reportingChannelPos').checked = true;
  el('reportingChannelPos').dispatch('change');
  assert.match(sql(app, dokument), /ca\.saleschannel IN \(1582819151330\)/);
});

test('generate() haengt Terminals nur an, wenn das Terminal-Panel auch gilt', () => {
  const basis = {
    mode: 'reporting',
    spaces: [{ id: '40402', label: '', selected: true }],
    terminals: [{ id: 'T-1', label: '', selected: true }],
  };
  // Ohne Aufschluesselung ist das Panel unsichtbar - ein aus einem anderen
  // Modus stehengebliebener Haken darf dann nicht still mitfiltern.
  const ohne = starte({ wallee_query_builder_v6: JSON.stringify(basis) });
  assert.doesNotMatch(sql(ohne.app, ohne.dokument), /pt\.identifier/);

  const mit = starte({
    wallee_query_builder_v6: JSON.stringify({ ...basis, reportingByTerminal: true }),
  });
  assert.match(sql(mit.app, mit.dokument), /pt\.identifier = 'T-1'/);
  assert.match(sql(mit.app, mit.dokument), /terminal_identifier/);
});

test('Die uebrigen Modi bekommen weiterhin ihre eigene Query', () => {
  // Regressionsschutz: der neue Zweig in generate() darf keinen anderen Modus
  // umleiten. ca.environment ist der Marker, den nur die Reporting-Query traegt
  // (der card-Modus joint chargeattempt ebenfalls, filtert aber nicht darauf).
  ['brand', 'terminal', 'export', 'card', 'settlement'].forEach(modus => {
    const { app, dokument } = starte({
      wallee_query_builder_v6: JSON.stringify({
        mode: modus, spaces: [{ id: '40402', label: '', selected: true }],
      }),
    });
    const s = sql(app, dokument);
    assert.ok(s.length > 50, `Modus ${modus} erzeugt kein SQL mehr`);
    assert.doesNotMatch(s, /ca\.environment/, `Modus ${modus} darf nicht die Reporting-Query bekommen`);
  });
});

// --- Ingest ----------------------------------------------------------------

test('ingestReportingCsv baut das Modell und schaltet die Aktionen frei', () => {
  const { app, el } = starte({
    wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }),
  });
  const ok = app.ingestReportingCsv(FIXTURE);
  assert.strictEqual(ok, true, 'Die Fixture muss sich lesen lassen');
  assert.ok(sichtbar(el('reportingReportActions')), 'Export-Aktionen erscheinen erst mit Daten');
  assert.ok(el('reportingReportOutput').innerHTML.length > 0, 'Es muss etwas gerendert werden');
  assert.ok(el('reportingStatus').textContent.length > 0, 'Die Statuszeile muss etwas sagen');
});

test('ingestReportingCsv meldet einen Parserfehler, statt zu werfen', () => {
  const { app, el } = starte({
    wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }),
  });
  let ok;
  assert.doesNotThrow(() => { ok = app.ingestReportingCsv(''); });
  assert.strictEqual(ok, false);
  assert.strictEqual(el('reportingStatus').dataset.art, 'fehler');
  assert.ok(!sichtbar(el('reportingReportActions')), 'Ohne Modell keine Export-Aktionen');
});

test('Das Haendler-Land aus dem State geht ins Modell', () => {
  const { app } = starte({
    wallee_query_builder_v6: JSON.stringify({
      mode: 'reporting', reportingMerchantCountry: 'DE',
    }),
  });
  app.ingestReportingCsv(FIXTURE);
  assert.strictEqual(app.reportingModellAktuell().merchantCountry, 'DE');
});

test('CSV-Import im Kopieren-Modus laeuft ueber denselben Ingest', () => {
  const { app, el } = starte({
    wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }),
  });
  assert.strictEqual(app.uebergibReportingCsv(FIXTURE), true);
  assert.ok(sichtbar(el('reportingReportActions')));
  assert.strictEqual(app.getState().mode, 'reporting', 'Der Ingest schaltet in den eigenen Modus');
});
