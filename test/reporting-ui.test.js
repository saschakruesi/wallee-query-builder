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
  const { app, dokument, el } = starte({
    wallee_query_builder_v6: JSON.stringify({
      mode: 'reporting', spaces: [{ id: '40402', label: '', selected: true }],
    }),
  });
  assert.ok(!aktiv(el('terminalSection')), 'Ausgangslage: keine Aufschluesselung');
  assert.doesNotMatch(sql(app, dokument), /paymentterminal/);

  el('reportingByTerminal').checked = true;
  el('reportingByTerminal').dispatch('change');
  assert.strictEqual(app.getState().reportingByTerminal, true);
  assert.ok(aktiv(el('terminalSection')), 'Aufschluesselung blendet das Terminal-Panel ein');
  // Die Klasse allein reicht nicht: ohne generate() im Handler stuende im
  // Kopierfeld weiter das SQL ohne Terminal-Aufschluesselung.
  assert.match(sql(app, dokument), /paymentterminal/,
    'Die Umschaltung muss das SQL neu erzeugen, nicht nur das Panel einblenden');

  el('reportingChannelEcom').checked = true;
  el('reportingChannelEcom').dispatch('change');
  assert.strictEqual(app.getState().reportingChannel, 'ECOM');
  assert.ok(!aktiv(el('terminalSection')), 'E-Commerce hat keine Terminals');
  assert.doesNotMatch(sql(app, dokument), /paymentterminal/,
    'Mit dem Panel verschwindet auch die Aufschluesselung aus dem SQL');

  el('reportingChannelBoth').checked = true;
  el('reportingChannelBoth').dispatch('change');
  assert.strictEqual(app.getState().reportingChannel, 'BOTH');
  assert.ok(aktiv(el('terminalSection')), 'Bei "Beide" ist der POS-Teil wieder betroffen');
  assert.match(sql(app, dokument), /paymentterminal/);
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
  // Der DOM-Stub uebernimmt die Klassen aus dem Markup nicht - ohne diesen
  // Ausgangszustand waere "ist sichtbar" auch dann wahr, wenn der Ingest die
  // Aktionen gar nicht freischaltet.
  el('reportingReportActions').classList.add('hidden');
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

test('Die Statuszeile meldet Werte im unerwarteten Format', () => {
  // Der einzige Verlustkanal ohne Zaehler war bisher das Zahlen-/Boolean-Format
  // - und er trifft genau die Kennzahlen, die dann als saubere Nullen
  // dastuenden (DCC 0 %, 3DS "nicht angefordert"). Die Meldung muss beim ersten
  // Import kommen, nicht erst beim Vergleich mit dem Portal.
  const { app, el } = starte({
    wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }),
  });
  const kaputt = FIXTURE.replace(/"true"/g, '"1"').replace(/"false"/g, '"0"');
  assert.strictEqual(app.ingestReportingCsv(kaputt), true, 'lesbar bleibt sie trotzdem');
  assert.match(el('reportingStatus').textContent, /Werte im unerwarteten Format/);
  // Gegenprobe: die unveraenderte Fixture darf nichts melden, sonst waere der
  // Hinweis ein Dauerzustand und niemand liest ihn mehr.
  assert.strictEqual(app.ingestReportingCsv(FIXTURE), true);
  assert.doesNotMatch(el('reportingStatus').textContent, /unerwarteten Format/);
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
  // Bewusst aus einem ANDEREN Modus heraus: startete der Test in 'reporting',
  // waere die Zusicherung auf state.mode auch ohne das setMode() im Ingest
  // gruen - getState() ist eine lebende Closure.
  const { app, el } = starte({
    wallee_query_builder_v6: JSON.stringify({ mode: 'brand' }),
  });
  el('reportingReportActions').classList.add('hidden');   // Markup-Ausgangszustand
  assert.strictEqual(app.uebergibReportingCsv(FIXTURE), true);
  assert.strictEqual(app.getState().mode, 'reporting', 'Der Ingest schaltet in den eigenen Modus');
  assert.ok(sichtbar(el('reportingReportActions')));
  assert.ok(aktiv(el('reportingSection')), 'und blendet dessen Panels ein');
  assert.ok(aktiv(el('reportingReportSection')));
});

// --- Account-Override greift nur im Settlement-Modus -----------------------
// Der Super-User-Flip steht im Settlement-Panel und meint den Account, in dem
// der SETTLEMENT-Report laufen soll. Reporting filtert wie brand/terminal nach
// spaceid: ein fremder Account kennt diese Spaces nicht, die Query liefe im
// falschen Kontext und kaeme leer zurueck - genau die Regression aus v5.10.0,
// die damals monatelang unbemerkt blieb, weil kein Test "Flip an UND anderer
// Modus" abdeckte. Die bestehenden Schleifen in api-anbindung/history decken
// die vier alten Modi ab; reporting wird hier nachgezogen.
test('Super-User-Override greift im Reporting-Modus nicht', () => {
  const { app } = starte({
    wallee_query_builder_v6: JSON.stringify({
      mode: 'reporting', settlementSuperUser: true, settlementAccountId: '99999',
    }),
  });
  assert.strictEqual(app.aktiverAccount(), '',
    'Ein fremder Account wuerde die Space-Filter der Reporting-Query ins Leere laufen lassen');
  assert.strictEqual(
    app.historyEintragBauen('reporting', 'tok', app.getState(), '2026-01-01T00:00:00Z', 'SUCCESS').account,
    '',
    'Sonst liefe der spaetere Download-by-Token im falschen Account');
});

test('Im Settlement-Modus gilt der Override weiterhin', () => {
  // Gegenprobe: der Test oben darf nicht dadurch gruen sein, dass der Override
  // ueberhaupt nicht mehr wirkt.
  const { app } = starte({
    wallee_query_builder_v6: JSON.stringify({
      mode: 'settlement', settlementSuperUser: true, settlementAccountId: '99999',
    }),
  });
  assert.strictEqual(app.aktiverAccount(), '99999');
});

// --- Verlaufszeile: der Modus hat einen eigenen Filter ---------------------
test('Die Verlaufszeile nennt den Kanal - und Terminals nur, wo sie gelten', () => {
  // Ohne eigenen Zweig stuende im Verlauf gar kein Filter, obwohl der Kanal die
  // Query nachweislich einschraenkt. Und die Terminal-Auswahl darf nur dann
  // auftauchen, wenn sie ueberhaupt gilt (dieselbe Bedingung wie in
  // generate()): sonst verspraeche die Zeile eine Einschraenkung, die es
  // nicht gibt.
  const { app } = starte();
  const st = (over) => Object.assign({
    spaces: ['90001'], startDate: '2026-07-01', endDate: '2026-07-31',
    terminals: [{ identifier: 'T-1', selected: true }, { identifier: 'T-2', selected: false }],
    reportingChannel: 'BOTH', reportingByTerminal: false,
  }, over);
  const filter = over =>
    app.historyEintragBauen('reporting', 'tok', st(over), '2026-01-01T00:00:00Z').filterSummary;

  assert.strictEqual(filter({}), 'alle Kanäle');
  assert.strictEqual(filter({ reportingChannel: 'POS' }), 'POS');
  assert.strictEqual(filter({ reportingChannel: 'ECOM' }), 'E-Commerce');
  // Terminal-Aufschluesselung an: die Auswahl gilt und gehoert in die Zeile.
  assert.strictEqual(filter({ reportingChannel: 'POS', reportingByTerminal: true }),
    'POS · 1 Terminal(s)');
  // Im E-Commerce gibt es keine Terminals - das Panel ist dort auch mit
  // gesetzter Checkbox aus, und die Zeile darf nichts anderes behaupten.
  assert.strictEqual(filter({ reportingChannel: 'ECOM', reportingByTerminal: true }),
    'E-Commerce');
});

// --- CSV-Import ist mit der Tastatur erreichbar ----------------------------
test('Der CSV-Import laeuft ueber einen echten Button, nicht ueber ein <label>', () => {
  // Ein <label for> ist nicht fokussierbar, und der versteckte File-Input steht
  // in keiner Tab-Reihenfolge: der Import waere nur mit der Maus erreichbar -
  // im Kopieren-Modus (dem Default) der einzige Weg zu Daten.
  const { el } = starte({ wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }) });
  let geklickt = 0;
  el('reportingCsvImport').click = () => { geklickt++; };
  el('reportingCsvImportBtn').dispatch('click');
  assert.strictEqual(geklickt, 1, 'Der Button muss den File-Dialog oeffnen');
});

// --- Haendler-Land: kein stiller Rueckfall --------------------------------
test('Ein geleertes Haendler-Land behaelt den zuletzt gueltigen Wert', () => {
  // Der Rumpf waehrend des Tippens darf nicht ins Modell, aber ein stiller
  // Rueckfall auf CH wuerde im Kopf des Reports "Haendler-Land: CH" behaupten,
  // waehrend das Feld leer dasteht.
  const { app, el } = starte({
    wallee_query_builder_v6: JSON.stringify({
      mode: 'reporting', reportingMerchantCountry: 'DE',
    }),
  });
  el('reportingMerchantCountry').value = '';
  el('reportingMerchantCountry').dispatch('input');
  assert.strictEqual(app.getState().reportingMerchantCountry, 'DE');

  el('reportingMerchantCountry').value = 'F';
  el('reportingMerchantCountry').dispatch('input');
  assert.strictEqual(app.getState().reportingMerchantCountry, 'DE',
    'Ein einzelner Buchstabe ist kein Land');

  el('reportingMerchantCountry').value = 'fr';
  el('reportingMerchantCountry').dispatch('input');
  assert.strictEqual(app.getState().reportingMerchantCountry, 'FR');
});

test('Ein Kanalwechsel schreibt nicht ins Haendler-Land-Feld', () => {
  const { el } = starte({ wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }) });
  el('reportingMerchantCountry').value = '';
  el('reportingMerchantCountry').dispatch('input');

  el('reportingChannelPos').checked = true;
  el('reportingChannelPos').dispatch('change');
  assert.strictEqual(el('reportingMerchantCountry').value, '',
    'Der Radio-Handler darf dem Nutzer keinen Wert in die Box schreiben');
});

test('Ein gueltiges Haendler-Land rechnet das bereits geladene Modell neu', () => {
  // Das Land steckt nicht in der Query, sondern nur im Modell: ohne den
  // Neuaufbau zeigte der Report weiter die Einstufung des alten Landes, ohne
  // dass irgendetwas darauf hinwiese.
  const { app, el } = starte({
    wallee_query_builder_v6: JSON.stringify({
      mode: 'reporting', reportingMerchantCountry: 'CH',
    }),
  });
  app.ingestReportingCsv(FIXTURE);
  assert.strictEqual(app.reportingModellAktuell().merchantCountry, 'CH');

  el('reportingMerchantCountry').value = 'fr';
  el('reportingMerchantCountry').dispatch('input');
  assert.strictEqual(app.reportingModellAktuell().merchantCountry, 'FR',
    'Das Modell muss dem neuen Haendler-Land folgen');
});

// --- Persistenz -----------------------------------------------------------
// getState() ist eine lebende Closure: eine Zusicherung darauf sieht ein
// fehlendes saveState() NICHT. Deshalb gegen den localStorage-Stub pruefen,
// wie es die Migrationstests tun.
function gespeichert(app) {
  return JSON.parse(app._localStorage.getItem(app.STORAGE_KEY) || '{}');
}

test('Alle drei Reporting-Bedienelemente schreiben ihren Wert in den Speicher', () => {
  const { app, el } = starte({ wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }) });

  el('reportingMerchantCountry').value = 'fr';
  el('reportingMerchantCountry').dispatch('input');
  assert.strictEqual(gespeichert(app).reportingMerchantCountry, 'FR',
    'Ohne saveState() waere das Land nach einem Neuladen wieder weg');

  el('reportingByTerminal').checked = true;
  el('reportingByTerminal').dispatch('change');
  assert.strictEqual(gespeichert(app).reportingByTerminal, true);

  el('reportingChannelPos').checked = true;
  el('reportingChannelPos').dispatch('change');
  assert.strictEqual(gespeichert(app).reportingChannel, 'POS');
});

// --- Haendler-Land: das Feld bleibt nicht leer stehen ----------------------
test('Beim Verlassen des Landfeldes kommt der gueltige Wert zurueck', () => {
  // Der input-Handler laesst einen Rumpf bewusst stehen, ohne ihn zu
  // uebernehmen. Ohne den blur-Abgleich zeigte das Feld den Rest der Sitzung
  // nichts an, waehrend der Report-Kopf "Haendler-Land: DE" ausweist.
  const { el } = starte({
    wallee_query_builder_v6: JSON.stringify({
      mode: 'reporting', reportingMerchantCountry: 'DE',
    }),
  });
  el('reportingMerchantCountry').value = '';
  el('reportingMerchantCountry').dispatch('input');
  assert.strictEqual(el('reportingMerchantCountry').value, '', 'waehrend des Tippens leer');

  el('reportingMerchantCountry').dispatch('blur');
  assert.strictEqual(el('reportingMerchantCountry').value, 'DE',
    'Feld und Modell duerfen nicht auseinanderlaufen');
});

// --- Was beim Laden aus dem State in die Bedienelemente zurueckkommt -------
// Eine Zusicherung auf getState() sieht NICHT, ob die Eingabefelder den
// gespeicherten Stand auch anzeigen: nach einem Neuladen stuende sonst der
// Markup-Default in der Maske, waehrend der State etwas anderes sagt - und die
// Query liefe nach dem sichtbaren Wert, nicht nach dem gewaehlten.
test('Beim Laden zeigen die Bedienelemente den gespeicherten Stand', () => {
  const { el } = starte({
    wallee_query_builder_v6: JSON.stringify({
      mode: 'reporting', reportingChannel: 'ECOM',
      reportingMerchantCountry: 'DE', reportingByTerminal: true,
    }),
  });
  assert.strictEqual(el('reportingChannelEcom').checked, true);
  assert.strictEqual(el('reportingChannelBoth').checked, false,
    'Der Markup-Default darf nicht angehakt stehenbleiben');
  assert.strictEqual(el('reportingChannelPos').checked, false);
  assert.strictEqual(el('reportingMerchantCountry').value, 'DE');
  assert.strictEqual(el('reportingByTerminal').checked, true);
});

test('Ein Kanalwechsel nimmt den Haken bei den beiden anderen Radios weg', () => {
  const { el } = starte({ wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }) });
  assert.strictEqual(el('reportingChannelBoth').checked, true);

  el('reportingChannelPos').checked = true;
  el('reportingChannelPos').dispatch('change');
  assert.strictEqual(el('reportingChannelBoth').checked, false);
  assert.strictEqual(el('reportingChannelEcom').checked, false);
});

// --- Optionen fuer die Export-Bloecke -------------------------------------
// Der GEWAEHLTE Zeitraum und die Spaces stehen nur hier - das Modell kennt nur
// den belegten Zeitraum. Step 7 haengt daran (§6.2); ohne diese Zusicherung
// koennte der Ingest sie fallen lassen, ohne dass etwas anschlaegt.
test('reportingExportOptionen traegt gewaehlten Zeitraum und Spaces', () => {
  const { app } = starte({
    wallee_query_builder_v6: JSON.stringify({
      mode: 'reporting',
      spaces: [{ id: '40402', label: '', selected: true },
        { id: '12622', label: '', selected: true },
        { id: '99999', label: '', selected: false }],
      startDate: '2026-07-01', startTime: '00:00:00',
      endDate: '2026-08-01', endTime: '00:00:00',
    }),
  });
  app.ingestReportingCsv(FIXTURE);
  const opt = plain(app.reportingExportOptionen());
  assert.deepStrictEqual(opt.spaces, ['40402', '12622'],
    'Nur die angehakten Spaces, in der Reihenfolge der Liste');
  assert.strictEqual(opt.zeitraum.start, '2026-07-01 00:00:00');
  assert.strictEqual(opt.zeitraum.end, '2026-08-01 00:00:00');
});

test('Ein Fehler nach einem geglueckten Ingest raeumt den alten Report weg', () => {
  // Sonst stuende der Report der vorigen Abfrage weiter auf dem Bildschirm,
  // waehrend die Statuszeile einen Fehler meldet - veraltete Zahlen, die wie
  // aktuelle aussehen. Der Fehlerpfad muss deshalb aus einem VORHANDENEN
  // Modell heraus geprueft werden, nicht aus dem leeren Ausgangszustand.
  const { app, el } = starte({
    wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }),
  });
  assert.strictEqual(app.ingestReportingCsv(FIXTURE), true);
  assert.ok(app.reportingModellAktuell(), 'Vorbedingung: es gibt ein Modell');

  assert.strictEqual(app.ingestReportingCsv(''), false);
  assert.strictEqual(app.reportingModellAktuell(), null, 'Das alte Modell muss weg sein');
  assert.ok(!sichtbar(el('reportingReportActions')));
  assert.strictEqual(el('reportingStatus').dataset.art, 'fehler');
});

// --- Unbekannte Ablehngruende nachladen (Iteration 2, Task 2) -------------
// Der eingebettete Katalog ist der Stand des letzten Scrapes. Eine ID, die
// wallee seither neu vergeben hat, steht als '#<id>' im Report; im API-Modus
// holt der Proxy den Namen von der oeffentlichen Doku-Seite nach.

// Dieselbe Fixture, aber mit einer ID, die der Katalog nicht kennt. Bewusst
// eine ERSETZUNG statt einer zusaetzlichen Zeile: so bleiben alle Summen und
// Anteile der Fixture unveraendert, und der Unterschied ist genau der Name.
const FIXTURE_NEUE_ID = FIXTURE.replace(/1568360440179/g, '9999999999999');

// starte() mit gefaelschtem fetch. Die App ruft beim Init noch anderes ab
// (Health, Credentials, Update-Check) - gezaehlt wird deshalb nur, was an die
// Route /failure-reasons geht.
function starteMitProxy(seed, antwort) {
  const rufe = [];
  const dokument = makeDocument();
  const app = loadBuilders({
    document: dokument,
    seedLocalStorage: seed,
    fetch: async (url) => {
      const s = String(url);
      if (s.indexOf('/failure-reasons') !== -1) {
        rufe.push(s);
        return antwort(s);
      }
      return { status: 200, json: async () => ({ ok: true }) };
    },
  });
  return { app, dokument, el: id => dokument.getElementById(id), rufe };
}

const apiSeed = (over) => ({
  wallee_query_builder_v6: JSON.stringify(Object.assign(
    { mode: 'reporting', apiMode: true }, over || {})),
});

const treffer = (id, name, category) => ({
  status: 200,
  json: async () => ({ ok: true, reasons: [{ id, name, category, description: '' }] }),
});

test('reportingUnbekannteGruende findet genau die IDs, die als #<id> dastuenden', () => {
  const { app } = starte();
  const rows = { dim: [
    { failureReasonId: '1568360440179' },   // im Katalog
    { failureReasonId: '9999999999999' },   // nicht im Katalog
    { failureReasonId: '9999999999999' },   // Dublette
    { failureReasonId: 'UNKNOWN' },         // gar kein Grund (Erfolg/leeres Feld)
    { failureReasonId: '' },
  ] };
  assert.deepStrictEqual(plain(app.reportingUnbekannteGruende(rows, null)), ['9999999999999']);

  // Was bereits nachgeladen ist, faellt heraus - sonst liefe die Route bei
  // jedem Modellneubau erneut.
  assert.deepStrictEqual(
    plain(app.reportingUnbekannteGruende(rows, { 9999999999999: ['Neuer Grund', 'T'] })), []);

  // Kein dim-Block, keine Zeilen: nichts zu tun, kein Wurf.
  assert.deepStrictEqual(plain(app.reportingUnbekannteGruende(null, null)), []);
  assert.deepStrictEqual(plain(app.reportingUnbekannteGruende({ dim: [] }, null)), []);
});

test('reportingFailureNachtrag uebersetzt die Doku-Kategorie und laesst Leeres weg', () => {
  const { app } = starte();
  const t = plain(app.reportingFailureNachtrag([
    { id: '111', name: '3-D Secure Failure', category: 'End User' },
    { id: '222', name: 'Kommunikationsfehler', category: 'Temporary Issue' },
    { id: '333', name: 'Ohne Kategorie', category: '' },
    // name: null heisst "auch die Doku kennt die ID nicht". Ihn zu uebernehmen
    // hiesse, den Namen '#<id>' durch nichts zu ersetzen und nie wieder
    // nachzufragen.
    { id: '444', name: null, category: 'End User' },
    { id: 'abc', name: 'Keine Zahl', category: 'End User' },
    null,
  ]));
  assert.deepStrictEqual(t, {
    111: ['3-D Secure Failure', 'END_USER'],
    222: ['Kommunikationsfehler', 'TEMPORARY'],
    333: ['Ohne Kategorie', ''],
  });
  assert.deepStrictEqual(plain(app.reportingFailureNachtrag(null)), {});
});

test('Nach dem Ingest werden unbekannte Gruende nachgeladen und ins Modell gebaut', async () => {
  const { app, rufe } = starteMitProxy(apiSeed(),
    () => treffer('9999999999999', 'Neuer Ablehngrund', 'Temporary Issue'));

  assert.strictEqual(app.ingestReportingCsv(FIXTURE_NEUE_ID), true);
  // Vor dem Nachladen steht der Rohwert da - genau das, was der Kunde im
  // Kopieren-Modus sieht.
  assert.strictEqual(
    app.reportingModellAktuell().kanaele.ECOM.failures[0].name, '#9999999999999');

  assert.strictEqual(await app.reportingNachladeAbwarten(), true);
  assert.strictEqual(rufe.length, 1, 'genau EIN Aufruf fuer alle unbekannten IDs');
  assert.match(rufe[0], /\/failure-reasons\?ids=9999999999999$/);

  const grund = app.reportingModellAktuell().kanaele.ECOM.failures[0];
  assert.strictEqual(grund.name, 'Neuer Ablehngrund');
  assert.strictEqual(grund.kategorie, 'TEMPORARY', 'die Doku-Kategorie kommt mit');
  // Das Modell wird aus den bereits geparsten Zeilen neu gebaut, nicht neu
  // abgerufen - Zahlen und Anteile bleiben deshalb unveraendert.
  assert.strictEqual(grund.attempts,
    app.reportingModellAktuell().kanaele.ECOM.failures[0].attempts);
});

test('Ein zweiter Ingest fragt nicht erneut nach - die Tabelle haengt an der App', async () => {
  const { app, rufe } = starteMitProxy(apiSeed(),
    () => treffer('9999999999999', 'Neuer Ablehngrund', 'End User'));
  app.ingestReportingCsv(FIXTURE_NEUE_ID);
  await app.reportingNachladeAbwarten();
  assert.strictEqual(rufe.length, 1);

  app.ingestReportingCsv(FIXTURE_NEUE_ID);
  await app.reportingNachladeAbwarten();
  assert.strictEqual(rufe.length, 1, 'die ID ist bekannt, es gibt nichts nachzuschlagen');
  assert.strictEqual(
    app.reportingModellAktuell().kanaele.ECOM.failures[0].name, 'Neuer Ablehngrund');
});

test('Ein Wechsel des Haendler-Landes verliert die nachgeladenen Namen nicht', async () => {
  // Der Modellneubau ist derselbe Pfad, den das Landfeld schon benutzt. Haengte
  // die Tabelle am Modell statt an der App, stuende nach dem Umschalten wieder
  // '#<id>' da - und die Route liefe ein zweites Mal.
  const { app, el, rufe } = starteMitProxy(apiSeed(),
    () => treffer('9999999999999', 'Neuer Ablehngrund', 'End User'));
  app.ingestReportingCsv(FIXTURE_NEUE_ID);
  await app.reportingNachladeAbwarten();

  el('reportingMerchantCountry').value = 'DE';
  el('reportingMerchantCountry').dispatch('input');
  assert.strictEqual(app.reportingModellAktuell().merchantCountry, 'DE');
  assert.strictEqual(
    app.reportingModellAktuell().kanaele.ECOM.failures[0].name, 'Neuer Ablehngrund');
  assert.strictEqual(rufe.length, 1);
});

test('Im Kopieren-Modus wird nichts nachgeladen', async () => {
  // Dort gibt es keinen Proxy. Genau dafuer ist der eingebettete Katalog da;
  // was er nicht kennt, bleibt '#<id>'.
  const { app, rufe } = starteMitProxy(
    { wallee_query_builder_v6: JSON.stringify({ mode: 'reporting', apiMode: false }) },
    () => treffer('9999999999999', 'Neuer Ablehngrund', 'End User'));
  assert.strictEqual(app.ingestReportingCsv(FIXTURE_NEUE_ID), true);
  assert.strictEqual(await app.reportingNachladeAbwarten(), false);
  assert.strictEqual(rufe.length, 0);
  assert.strictEqual(
    app.reportingModellAktuell().kanaele.ECOM.failures[0].name, '#9999999999999');
});

test('Ein Fehlschlag laesst den Report stehen, statt ihn zu verhindern', async () => {
  // Drei Wege, auf denen es schiefgehen kann - keiner darf werfen und keiner
  // darf den Report anfassen. Haltung der ganzen App: Rueckfall, nie Blockade.
  const faelle = {
    'Proxy weg': () => { throw new Error('Failed to fetch'); },
    '400 vom Proxy': () => ({ status: 400, json: async () => ({ ok: false, fehler: 'x' }) }),
    'Antwort ohne reasons': () => ({ status: 200, json: async () => ({ ok: true }) }),
    'Doku kennt die ID auch nicht': () => ({
      status: 200,
      json: async () => ({ ok: true, reasons: [{ id: '9999999999999', name: null }] }),
    }),
  };
  for (const [was, antwort] of Object.entries(faelle)) {
    const { app, el } = starteMitProxy(apiSeed(), antwort);
    assert.strictEqual(app.ingestReportingCsv(FIXTURE_NEUE_ID), true, was);
    assert.strictEqual(await app.reportingNachladeAbwarten(), false, was);
    assert.ok(app.reportingModellAktuell(), `${was}: das Modell steht weiterhin`);
    assert.strictEqual(
      app.reportingModellAktuell().kanaele.ECOM.failures[0].name, '#9999999999999', was);
    assert.strictEqual(el('reportingStatus').dataset.art, 'erfolg',
      `${was}: die Statuszeile meldet weiterhin den geglueckten Ingest`);
  }
});

test('Mehr als 50 unbekannte IDs: die ersten 50, kein Nachschlagen in Schleife', async () => {
  // Der Doku-Server ist nicht unser Server. Der Rest bleibt '#<id>' - sichtbar
  // und nachvollziehbar, statt in einer Kette von Abrufen aufzuloesen.
  //
  // Die Vorlage ist die eine FAILED-Zeile der Fixture, 60-mal geklont und je
  // mit einer anderen unbekannten ID versehen. Zaehlwerte und Betraege werden
  // dadurch groesser als in der Fixture - hier zaehlt allein, wie viele IDS in
  // den Aufruf gehen.
  const zeilen = FIXTURE_NEUE_ID.split('\n');
  const vorlage = zeilen.find(z => z.indexOf('"9999999999999"') !== -1);
  const viele = FIXTURE_NEUE_ID.trimEnd() + '\n'
    + Array.from({ length: 60 }, (_, i) =>
      vorlage.replace('"9999999999999"', `"${9000000000000 + i}"`)).join('\n') + '\n';

  const { app, rufe } = starteMitProxy(apiSeed(),
    () => ({ status: 200, json: async () => ({ ok: true, reasons: [] }) }));
  assert.strictEqual(app.ingestReportingCsv(viele), true);
  await app.reportingNachladeAbwarten();

  assert.strictEqual(rufe.length, 1, 'ein Aufruf, nicht zwei fuer den Rest');
  const ids = rufe[0].split('ids=')[1].split(',');
  assert.strictEqual(ids.length, 50);
  assert.strictEqual(app.REPORTING_NACHLADEN_MAX, 50,
    'muss zu FAILURE_MAX_IDS im Proxy passen, sonst antwortet der mit 400');
  // Die 61 unbekannten IDs (die eine der Fixture plus 60 geklonte) sind
  // tatsaechlich alle da - der Aufruf ist also gekuerzt, nicht die Erkennung.
  const rows = { dim: Array.from({ length: 61 }, (_, i) => ({ failureReasonId: String(9000000000000 + i) })) };
  assert.strictEqual(app.reportingUnbekannteGruende(rows, null).length, 61);
});

test('Eine krumme ID kostet nicht den Nachschlag der uebrigen', async () => {
  // Die IDs kommen ungeprueft aus dem CSV. Der Proxy weist die GANZE Liste mit
  // 400 ab, sobald ein Eintrag keine Zahl ist - eine einzige krumme Zeile
  // liesse sonst alle anderen Gruende als '#<id>' stehen. Nachschlagen liesse
  // sie sich ohnehin nicht: die Doku-URL besteht aus Ziffern.
  const zeilen = FIXTURE_NEUE_ID.split('\n');
  const vorlage = zeilen.find(z => z.indexOf('"9999999999999"') !== -1);
  const mitMuell = FIXTURE_NEUE_ID.trimEnd() + '\n'
    + vorlage.replace('"9999999999999"', '"nicht-numerisch"') + '\n';

  const { app, rufe } = starteMitProxy(apiSeed(),
    () => treffer('9999999999999', 'Neuer Ablehngrund', 'End User'));
  assert.strictEqual(app.ingestReportingCsv(mitMuell), true);
  await app.reportingNachladeAbwarten();

  assert.strictEqual(rufe.length, 1);
  assert.match(rufe[0], /ids=9999999999999$/, 'nur die numerische ID geht in den Aufruf');
  assert.strictEqual(
    app.reportingModellAktuell().kanaele.ECOM.failures.find(f => f.id === '9999999999999').name,
    'Neuer Ablehngrund');
});

test('Ein Parserfehler setzt auch den Nachladelauf zurueck', async () => {
  // Sonst gaebe reportingNachladeAbwarten() den Lauf des vorigen, geglueckten
  // Ingests zurueck - eine Testnaht, die auf einen Zustand zeigt, den es nicht
  // mehr gibt.
  const { app } = starteMitProxy(apiSeed(),
    () => treffer('9999999999999', 'Neuer Ablehngrund', 'End User'));
  app.ingestReportingCsv(FIXTURE_NEUE_ID);
  assert.strictEqual(await app.reportingNachladeAbwarten(), true);

  assert.strictEqual(app.ingestReportingCsv(''), false);
  assert.strictEqual(await app.reportingNachladeAbwarten(), false);
});
