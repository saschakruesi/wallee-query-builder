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
