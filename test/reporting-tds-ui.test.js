// Verdrahtung der 3DS-Failure-Seite (Iteration 2, Task 4d): die zweite
// Abfrage, ihr Verlaufseintrag, das Panel, der Ingest und die Export-Leiste.
//
// Muster test/reporting-ui.test.js - dieselbe Aufteilung: die eine Regel, die
// waehrend des Modus umschlagen kann (wird die zweite Abfrage ueberhaupt
// abgesetzt), steht als reine Funktion daneben und wird hier einzeln
// festgenagelt; alles Uebrige laeuft ueber den DOM-Ersatz.
//
// Vier Dinge stehen im Mittelpunkt, weil sie stumm falsch sein koennen:
//
//   1. Bei Kanal POS darf die zweite Abfrage GAR NICHT laufen. Sie filtert
//      fest auf E-Commerce, kaeme also leer zurueck - und eine leere Seite
//      saehe aus wie "keine 3DS-Fehlschlaege".
//   2. Beide Abfragen muessen denselben Zeitraum und dieselben Spaces sehen.
//      Sonst rechnen die zwei Anteils-Kacheln gegen eine Grundgesamtheit, zu
//      der die Liste darunter nicht gehoert.
//   3. aktiverAccount() muss fuer 'reporting-tds' leer bleiben - die
//      Regression aus v5.10.0, fuer die vier alten Modi laengst festgenagelt.
//   4. Ein Fehlschlag der zweiten Abfrage darf den Aggregat-Report nicht
//      mitnehmen. Rueckfall statt Blockade.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadBuilders, plain } = require('./harness');
const { makeDocument } = require('./dom-stub');

const TDS_CSV = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'reporting-tds-beispiel.csv'), 'utf8');
const AGG_CSV = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'reporting-beispiel.csv'), 'utf8');

function starte(seed, optionen) {
  const dokument = makeDocument();
  const app = loadBuilders(Object.assign(
    { document: dokument, seedLocalStorage: seed }, optionen || {}));
  return { app, dokument, el: id => dokument.getElementById(id) };
}

const REPORTING = ueber => JSON.stringify(Object.assign({
  mode: 'reporting',
  spaces: [{ id: '90001', label: '', selected: true }],
  startDate: '2026-07-01', startTime: '00:00:00',
  endDate: '2026-08-01', endTime: '00:00:00',
}, ueber || {}));

const aktiv = el => el.classList.contains('active');
const sichtbar = el => !el.classList.contains('hidden');

// Eine Zeilenliste beliebiger Laenge im Format der Fixture. Bewusst minimal
// befuellt (nur die drei Schluessel und das Datum): der Parser verlangt alle
// 29 Pflichtspalten in der Kopfzeile, aber keine Werte darin - und 20'000
// vollstaendige Zeilen waeren ein Fixture-String von mehreren Megabyte, nur
// um einen Zaehler zu erreichen.
function vieleZeilen(n) {
  const kopf = TDS_CSV.split('\n')[0];
  const spalten = kopf.split(',').length;
  const zeilen = [kopf];
  for (let i = 1; i <= n; i++) {
    const felder = new Array(spalten).fill('');
    felder[0] = '"90001"';                              // space_id
    felder[1] = `"9${String(i).padStart(6, '0')}"`;     // attempt_id
    felder[2] = `"7${String(i).padStart(6, '0')}"`;     // transaction_id
    felder[3] = '"2026-07-04 20:11:03.000"';            // created_on
    felder[9] = '"1568360440179"';                      // failure_reason_id
    zeilen.push(felder.join(','));
  }
  return zeilen.join('\n') + '\n';
}

// --- Die Kanal-Regel -------------------------------------------------------

test('Bei Kanal POS wird die zweite Abfrage gar nicht abgesetzt', () => {
  // Die 3DS-Query filtert fest auf E-Commerce (§3.3). Am POS kaeme sie
  // zwangslaeufig mit null Zeilen zurueck - und eine Seite, die "kein
  // Zahlungsversuch mit 3-D Secure ist gescheitert" meldet, waere dort eine
  // Aussage ueber Daten, die nie abgefragt wurden.
  const { app } = starte();
  assert.strictEqual(app.reportingTdsQueryNoetig('POS'), false);
  assert.strictEqual(app.reportingTdsQueryNoetig('ECOM'), true);
  assert.strictEqual(app.reportingTdsQueryNoetig('BOTH'), true);
});

test('Eine unbekannte Kanalwahl verhaelt sich wie "Beide"', () => {
  // Gleiche Haltung wie reportingKanalFilter: unbekannt heisst "kein
  // Kanalfilter", E-Commerce ist dann enthalten.
  const { app } = starte();
  assert.strictEqual(app.reportingTdsQueryNoetig(''), true);
  assert.strictEqual(app.reportingTdsQueryNoetig('IRGENDWAS'), true);
  assert.strictEqual(app.reportingTdsQueryNoetig(undefined), true);
});

// --- Eine Quelle fuer Zeitraum und Spaces ---------------------------------

test('abfrageFilter liest Zeitraum und Spaces genau einmal aus dem State', () => {
  const { app } = starte({ wallee_query_builder_v6: REPORTING({
    spaces: [
      { id: '90001', label: '', selected: true },
      { id: '90002', label: '', selected: true },
      { id: '90003', label: '', selected: false },
    ],
  }) });
  const f = plain(app.abfrageFilter());
  assert.strictEqual(f.start, '2026-07-01 00:00:00');
  assert.strictEqual(f.end, '2026-08-01 00:00:00');
  assert.deepStrictEqual(f.spaceIds, ['90001', '90002']);
});

test('Beide Reporting-Ausgaben tragen denselben Zeitraum und dieselben Spaces', () => {
  // Der eigentliche Punkt: die Anteils-Kacheln der 3DS-Seite rechnen gegen
  // die Grundgesamtheit des Aggregats. Weichen die zwei Koepfe voneinander
  // ab, ist der Nenner ein anderer - und niemand koennte es der Seite ansehen.
  const { app } = starte({ wallee_query_builder_v6: REPORTING() });
  const filter = app.abfrageFilter();
  app.ingestReportingCsv(AGG_CSV, filter);
  app.ingestReportingTdsCsv(TDS_CSV, filter);
  assert.deepStrictEqual(plain(app.reportingTdsExportOptionen()),
    plain(app.reportingExportOptionen()));
});

// --- Panel und Ingest ------------------------------------------------------

test('Das 3DS-Panel bleibt aus, solange es nichts zu zeigen gibt', () => {
  // Ohne Modell und ohne Statuszeile steht dort nichts als eine leere
  // Ueberschrift - und der Reporting-Modus hat auch ohne 3DS-Liste seinen
  // vollen Bericht.
  const { el } = starte({ wallee_query_builder_v6: REPORTING() });
  assert.ok(!aktiv(el('reportingTdsSection')));
});

test('ingestReportingTdsCsv baut das Modell, zeigt das Panel und schaltet die Exporte frei', () => {
  const { app, el } = starte({ wallee_query_builder_v6: REPORTING() });
  // Der DOM-Stub uebernimmt die Klassen aus dem Markup nicht - ohne diesen
  // Ausgangszustand waere "ist sichtbar" auch dann wahr, wenn der Ingest die
  // Aktionen gar nicht freischaltet.
  el('reportingTdsActions').classList.add('hidden');

  assert.strictEqual(app.ingestReportingTdsCsv(TDS_CSV), true);
  assert.ok(aktiv(el('reportingTdsSection')), 'Mit einem Modell erscheint das Panel');
  assert.ok(sichtbar(el('reportingTdsActions')), 'Export-Leiste erst mit einem Modell');
  assert.ok(el('reportingTdsOutput').innerHTML.length > 0, 'Es muss etwas gerendert werden');
  // Acht Zeilen, sieben verschiedene Transaktionen (8000001 und 8000002
  // gehoeren beide zu 7000001) - von Hand an der Fixture ausgezaehlt.
  assert.strictEqual(app.reportingTdsModellAktuell().kpi.failures, 8);
  assert.strictEqual(app.reportingTdsModellAktuell().kpi.transaktionen, 7);
  assert.match(el('reportingTdsStatus').textContent, /8 3DS-Fehlschläge · 7 Transaktionen/);
});

test('Ohne Aggregat entstehen die beiden Anteils-Kacheln nicht - und nichts wirft', () => {
  const { app, el } = starte({ wallee_query_builder_v6: REPORTING() });
  assert.doesNotThrow(() => { app.ingestReportingTdsCsv(TDS_CSV); });
  const m = app.reportingTdsModellAktuell();
  assert.strictEqual(m.kpi.hatAggregat, false);
  assert.strictEqual(m.kpi.anteilAnFailed, null, 'Nie 0 % - das waere eine Messung');
  assert.doesNotMatch(el('reportingTdsOutput').innerHTML, /Anteil an allen gescheiterten/);
});

test('Mit geladenem Aggregat tragen die Kacheln dessen E-Com-Grundgesamtheit', () => {
  const { app, el } = starte({ wallee_query_builder_v6: REPORTING() });
  app.ingestReportingCsv(AGG_CSV);
  app.ingestReportingTdsCsv(TDS_CSV);
  const m = app.reportingTdsModellAktuell();
  assert.strictEqual(m.kpi.hatAggregat, true);
  // Der Nenner ist das KANAL-Modell des E-Commerce, nicht das Gesamtmodell:
  // die Zahl muss die fehlgeschlagenen E-Com-Attempts der Aggregat-Fixture
  // sein, nicht die aller Kanaele.
  const ecom = app.reportingModellAktuell().kanaele.ECOM;
  assert.strictEqual(m.kpi.basisFailed, ecom.kpi.fehlgeschlagen);
  assert.match(el('reportingTdsOutput').innerHTML, /Anteil an allen gescheiterten/);
});

test('Wird das Aggregat neu gebaut, zieht das 3DS-Modell mit', () => {
  // Sonst stuenden in den zwei Anteils-Kacheln Prozente aus einem Nenner, den
  // es nicht mehr gibt - und zwar unauffaellig, weil die Zahlen plausibel
  // bleiben.
  const { app, el } = starte({ wallee_query_builder_v6: REPORTING() });
  app.ingestReportingTdsCsv(TDS_CSV);
  assert.strictEqual(app.reportingTdsModellAktuell().kpi.hatAggregat, false);

  app.ingestReportingCsv(AGG_CSV);
  assert.strictEqual(app.reportingTdsModellAktuell().kpi.hatAggregat, true,
    'Der Aggregat-Ingest muss das 3DS-Modell mitziehen');

  // Und in die andere Richtung: faellt das Aggregat weg, fallen auch die
  // Kacheln weg, statt mit dem alten Nenner stehenzubleiben.
  assert.strictEqual(app.ingestReportingCsv('kaputt;kein;csv'), false);
  assert.strictEqual(app.reportingTdsModellAktuell().kpi.hatAggregat, false);
  assert.doesNotMatch(el('reportingTdsOutput').innerHTML, /Anteil an allen gescheiterten/);
});

test('Das Haendler-Land baut auch das 3DS-Modell neu', () => {
  // Das Land steckt nur im Aggregat-Modell - aber ueber dessen Neubau haengt
  // der Nenner der 3DS-Kacheln daran.
  const { app, el } = starte({
    wallee_query_builder_v6: REPORTING({ reportingMerchantCountry: 'CH' }),
  });
  app.ingestReportingCsv(AGG_CSV);
  app.ingestReportingTdsCsv(TDS_CSV);
  const vorher = app.reportingTdsModellAktuell();

  el('reportingMerchantCountry').value = 'fr';
  el('reportingMerchantCountry').dispatch('input');
  assert.notStrictEqual(app.reportingTdsModellAktuell(), vorher,
    'Das 3DS-Modell muss neu gebaut worden sein, nicht bloss stehen geblieben');
  assert.strictEqual(app.reportingTdsModellAktuell().kpi.hatAggregat, true);
});

test('Ein Parserfehler wird gemeldet, statt zu werfen - und das Panel zeigt ihn', () => {
  // Ohne die zweite Bedingung in aktualisiereReportingTdsPanel() waere die
  // Meldung unsichtbar: kein Modell, also kein Panel, in dem sie stuende.
  const { app, el } = starte({ wallee_query_builder_v6: REPORTING() });
  let ok;
  assert.doesNotThrow(() => { ok = app.ingestReportingTdsCsv(''); });
  assert.strictEqual(ok, false);
  assert.strictEqual(el('reportingTdsStatus').dataset.art, 'fehler');
  assert.ok(el('reportingTdsStatus').textContent.length > 0);
  assert.ok(aktiv(el('reportingTdsSection')), 'Die Fehlermeldung braucht ein sichtbares Panel');
  assert.ok(!sichtbar(el('reportingTdsActions')), 'Ohne Modell keine Export-Aktionen');
});

test('Das Panel bleibt in einem anderen Modus aus, auch mit Modell', () => {
  const { app, el } = starte({ wallee_query_builder_v6: REPORTING() });
  app.ingestReportingTdsCsv(TDS_CSV);
  assert.ok(aktiv(el('reportingTdsSection')));
  app.setMode('brand');
  assert.ok(!aktiv(el('reportingTdsSection')));
  app.setMode('reporting');
  assert.ok(aktiv(el('reportingTdsSection')), 'und kommt beim Zurueckschalten wieder');
});

// --- CSV-Import ------------------------------------------------------------

test('Der 3DS-Import laeuft ueber einen echten Button, nicht ueber ein <label>', () => {
  // Ein <label for> ist nicht fokussierbar und der versteckte File-Input steht
  // in keiner Tab-Reihenfolge - der Import waere nur mit der Maus erreichbar.
  // Im Kopieren-Modus (dem Default) ist er der einzige Weg zu einem Modell.
  const { el } = starte({ wallee_query_builder_v6: REPORTING() });
  let geklickt = 0;
  el('reportingTdsCsvImport').click = () => { geklickt++; };
  el('reportingTdsCsvImportBtn').dispatch('click');
  assert.strictEqual(geklickt, 1, 'Der Button muss den File-Dialog oeffnen');
});

test('Der Import-Knopf steht ausserhalb der Export-Leiste', () => {
  // Die Leiste ist versteckt, solange es kein Modell gibt - laege der Import
  // darin, waere er der Weg zu einem Modell, den man nur mit einem Modell
  // erreicht.
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'wallee_query_builder.html'), 'utf8');
  const leiste = html.slice(html.indexOf('id="reportingTdsActions"'));
  const bisEnde = leiste.slice(0, leiste.indexOf('</div>'));
  assert.doesNotMatch(bisEnde, /reportingTdsCsvImportBtn/,
    'Der Import darf nicht in der versteckten Export-Leiste liegen');
});

test('uebergibReportingTdsCsv schaltet in den Reporting-Modus', () => {
  // Bewusst aus einem ANDEREN Modus heraus: startete der Test in 'reporting',
  // waere die Zusicherung auch ohne das setMode() im Ingest gruen -
  // getState() ist eine lebende Closure.
  const { app, el } = starte({ wallee_query_builder_v6: JSON.stringify({ mode: 'brand' }) });
  assert.strictEqual(app.uebergibReportingTdsCsv(TDS_CSV), true);
  assert.strictEqual(app.getState().mode, 'reporting');
  assert.ok(aktiv(el('reportingTdsSection')));
});

// --- Statuszeile -----------------------------------------------------------

test('Die Statuszeile meldet Werte im unerwarteten Format', () => {
  // Derselbe Verlustkanal wie beim Aggregat, und hier trifft er die Kernachse
  // der Seite: passt die Schreibweise der beiden 3DS-Zeitpunkte nicht, steht
  // die Dauer vollstaendig auf "Unbekannt" - plausibel aussehend.
  const { app, el } = starte({ wallee_query_builder_v6: REPORTING() });
  const kaputt = TDS_CSV.replace(/"true"/g, '"1"').replace(/"false"/g, '"0"');
  assert.strictEqual(app.ingestReportingTdsCsv(kaputt), true, 'lesbar bleibt sie trotzdem');
  assert.match(el('reportingTdsStatus').textContent, /Werte im unerwarteten Format/);

  // Gegenprobe: die unveraenderte Fixture darf nichts melden, sonst waere der
  // Hinweis ein Dauerzustand und niemand liest ihn mehr.
  assert.strictEqual(app.ingestReportingTdsCsv(TDS_CSV), true);
  assert.doesNotMatch(el('reportingTdsStatus').textContent, /unerwarteten Format/);
});

test('Der Zaehler des Parsers ueberlebt einen Modellneubau', () => {
  // Er lebt an der DATEI, nicht am Modell: ein Modellneubau laesst die
  // Statuszeile unangetastet. Wuerde sie dort mitgeschrieben, verschwaende
  // der Hinweis beim ersten Wechsel des Haendler-Lands - und mit ihm der
  // einzige Beleg dafuer, dass die Zahlen nicht stimmen.
  const { app, el } = starte({ wallee_query_builder_v6: REPORTING() });
  app.ingestReportingTdsCsv(TDS_CSV.replace(/"true"/g, '"1"'));
  assert.match(el('reportingTdsStatus').textContent, /Werte im unerwarteten Format/);
  app.ingestReportingCsv(AGG_CSV);      // baut das 3DS-Modell mit neu
  assert.match(el('reportingTdsStatus').textContent, /Werte im unerwarteten Format/);
});

test('Keine Zeilen ist eine Aussage, kein Fehler', () => {
  // Genau die Frage, mit der jemand diese Seite oeffnet. Die Kopfzeile allein
  // ist fuer den Parser kein Fehlerfall (siehe 4a); die Statuszeile muss das
  // in Worte fassen, statt eine leere Seite stehen zu lassen.
  const { app, el } = starte({ wallee_query_builder_v6: REPORTING() });
  assert.strictEqual(app.ingestReportingTdsCsv(TDS_CSV.split('\n')[0] + '\n'), true);
  assert.strictEqual(el('reportingTdsStatus').dataset.art, 'info');
  assert.match(el('reportingTdsStatus').textContent, /gescheitert/);
});

test('Am Limit sagt die Statuszeile, dass die Liste unvollstaendig ist', () => {
  // REPORTING_TDS_LIMIT Zeilen koennen der Zufall sein - deshalb "erreicht"
  // und "Untergrenzen", nicht "abgeschnitten". Ohne den Hinweis liest sich
  // die Zahl darueber wie eine Messung.
  const { app, el } = starte({ wallee_query_builder_v6: REPORTING() });
  assert.strictEqual(app.ingestReportingTdsCsv(vieleZeilen(app.REPORTING_TDS_LIMIT)), true);
  assert.strictEqual(app.reportingTdsModellAktuell().abgeschnitten, true);
  assert.match(el('reportingTdsStatus').textContent, /Höchstzahl von 20’000 Zeilen erreicht/);
  assert.match(el('reportingTdsStatus').textContent, /Untergrenzen/);
});

// --- Der Bildschirm-Deckel -------------------------------------------------

test('Die Zeilentabelle wird auf dem Bildschirm gedeckelt und sagt es', () => {
  // Das <details> klappt die Tabelle nur zu, gebaut wird der ganze
  // Markup-String trotzdem. Bei 20'000 Zeilen a 13 Spalten waeren das
  // mehrere Megabyte, die der Browser beim Einhaengen vollstaendig parsen
  // muss - nur damit sie zugeklappt dastehen.
  const deckel = loadBuilders().REPORTING_TDS_SCREEN_ZEILEN;
  const { app, el } = starte({ wallee_query_builder_v6: REPORTING() });
  app.ingestReportingTdsCsv(vieleZeilen(deckel + 20));

  const html = el('reportingTdsOutput').innerHTML;
  // Die Zeilentabelle ist die einzige mit einer Link-Spalte; ihre Zeilen sind
  // damit an den Transaktions-IDs abzaehlbar.
  const treffer = html.match(/>7000\d{3}</g) || [];
  assert.strictEqual(treffer.length, deckel,
    `Auf dem Bildschirm duerfen hoechstens ${deckel} Zeilen stehen`);
  assert.match(html, /Auf dem Bildschirm stehen die ersten 500 von 520 Zeilen/);
  assert.match(html, /Vollständige Liste im Excel\/CSV/);
});

test('Unterhalb des Deckels steht kein Hinweis', () => {
  // Gegenprobe: sonst waere der Hinweis ein Dauerzustand.
  const { app, el } = starte({ wallee_query_builder_v6: REPORTING() });
  app.ingestReportingTdsCsv(TDS_CSV);
  assert.doesNotMatch(el('reportingTdsOutput').innerHTML, /Auf dem Bildschirm stehen die ersten/);
});

test('CSV und Excel bleiben vollstaendig - der Deckel gilt nur der Anzeige', () => {
  const B = loadBuilders();
  const deckel = B.REPORTING_TDS_SCREEN_ZEILEN;
  const { app } = starte({ wallee_query_builder_v6: REPORTING() });
  app.ingestReportingTdsCsv(vieleZeilen(deckel + 20));
  const csv = B.buildReportingTdsCsv(
    app.reportingTdsModellAktuell(), app.reportingTdsExportOptionen());
  // Ueber die Dashboard-Adresse gezaehlt: die Transaktions-ID steht in der
  // Zeile zweimal (eigene Spalte und Link), der Link-Pfad genau einmal.
  const treffer = csv.match(/\/view\/7\d{6}/g) || [];
  assert.strictEqual(treffer.length, deckel + 20, 'Im CSV steht jede Zeile');
  assert.doesNotMatch(csv, /Auf dem Bildschirm stehen die ersten/);
});

// --- Account-Override: die Regression aus v5.10.0 -------------------------

test('Super-User-Override greift fuer die 3DS-Abfrage nicht', () => {
  // Der Flip steht im Settlement-Panel und meint den Account, in dem der
  // SETTLEMENT-Report laufen soll. Die 3DS-Query filtert wie brand/terminal/
  // reporting nach spaceid: ein fremder Account kennt diese Spaces nicht, die
  // Query liefe im falschen Kontext und kaeme mit null Zeilen zurueck - und
  // die Seite meldete dann "kein Zahlungsversuch ist gescheitert".
  const { app } = starte({ wallee_query_builder_v6: JSON.stringify({
    mode: 'reporting-tds', settlementSuperUser: true, settlementAccountId: '99999',
  }) });
  // Der Modus ist keine gueltige Bedienwahl - loadState faellt deshalb auf
  // 'brand' zurueck; entscheidend ist die Funktion selbst.
  assert.strictEqual(app.aktiverAccount(), '');
  const st = Object.assign({}, app.getState(), { mode: 'reporting-tds' });
  assert.strictEqual(
    app.historyEintragBauen('reporting-tds', 'tok', st, '2026-01-01T00:00:00Z', 'SUCCESS').account,
    '',
    'Sonst liefe der spaetere Download-by-Token im falschen Account');
});

test('Im Settlement-Modus gilt der Override weiterhin', () => {
  // Gegenprobe: der Test oben darf nicht dadurch gruen sein, dass der Override
  // ueberhaupt nicht mehr wirkt.
  const { app } = starte({ wallee_query_builder_v6: JSON.stringify({
    mode: 'settlement', settlementSuperUser: true, settlementAccountId: '99999',
  }) });
  assert.strictEqual(app.aktiverAccount(), '99999');
});

// --- Der Verlaufseintrag ---------------------------------------------------

test('Der 3DS-Eintrag steht im Verlauf des Reporting-Modus und bietet nur Roh-CSV', () => {
  // 'reporting-tds' ist kein Bedienmodus - es gibt keinen Knopf, mit dem man
  // dorthin umschaltet. Ohne die Zuordnung in HISTORY_NEBENMODI waere der
  // Eintrag unsichtbar, obwohl er der einzige Weg zum Roh-CSV der zweiten
  // Abfrage ist.
  const eintrag = (mode, token) => ({
    id: token, mode, token, submittedAt: '2026-08-01T10:00:00.000Z',
    spacesSummary: 'Space 90001', timeframeSummary: '2026-07-01 → 2026-07-31',
    filterSummary: '', status: 'SUCCESS', account: '',
  });
  const { app, el } = starte({
    wallee_query_builder_v6: REPORTING(),
    wallee_query_history_v1: JSON.stringify([
      eintrag('reporting-tds', 'tok-tds'), eintrag('reporting', 'tok-agg'),
    ]),
  });
  app.renderHistory();
  const zeilen = el('queryHistoryBody').children;
  assert.strictEqual(zeilen.length, 2, 'Beide Abfragen desselben Laufs gehoeren in denselben Verlauf');

  const tds = zeilen[0].innerHTML;
  assert.match(tds, /3DS-Failures/, 'mit dem Anzeigenamen');
  assert.doesNotMatch(tds, />reporting-tds</, 'nicht der rohe Schluessel');
  assert.match(tds, /data-act="csv"/, 'Roh-CSV bleibt');
  assert.doesNotMatch(tds, /data-act="xlsx"/,
    'Excel laeuft ueber das Panel, wie bei den drei anderen Report-Modi');
});

test('Der 3DS-Eintrag taucht in keinem anderen Modus auf', () => {
  const { app, el } = starte({
    wallee_query_builder_v6: JSON.stringify({ mode: 'brand' }),
    wallee_query_history_v1: JSON.stringify([{
      id: 'tok-tds', mode: 'reporting-tds', token: 'tok-tds',
      submittedAt: '2026-08-01T10:00:00.000Z', spacesSummary: '', timeframeSummary: '',
      filterSummary: '', status: 'SUCCESS', account: '',
    }]),
  });
  app.renderHistory();
  assert.strictEqual(el('queryHistoryBody').children.length, 1);
  assert.match(el('queryHistoryBody').children[0].innerHTML, /Noch keine Abfragen/);
});

test('Die Verlaufszeile sagt, was die zweite Abfrage ist', () => {
  // Sie kennt weder Kanalwahl noch Terminals - sie filtert fest auf
  // E-Commerce. Die Zeile darf deshalb keine Einschraenkung versprechen, die
  // die Query nicht traegt (dieselbe Ueberlegung wie beim Kanal-Zweig des
  // Aggregats).
  const { app } = starte();
  const st = {
    spaces: [{ id: '90001', selected: true }],
    startDate: '2026-07-01', endDate: '2026-07-31',
    terminals: [{ identifier: 'T-1', selected: true }],
    reportingChannel: 'POS', reportingByTerminal: true,
  };
  const e = app.historyEintragBauen('reporting-tds', 'tok', st, '2026-01-01T00:00:00Z', 'SUCCESS');
  assert.strictEqual(e.mode, 'reporting-tds');
  assert.strictEqual(e.filterSummary, '3DS-Failures · E-Commerce');
  assert.doesNotMatch(e.filterSummary, /Terminal/,
    'Terminals gelten hier nicht - die Zeile darf sie nicht nennen');
  assert.strictEqual(e.spacesSummary, 'Space 90001', 'Die Spaces gelten sehr wohl');
});

// --- Der Lauf ueber ein gefaelschtes fetch --------------------------------
// Muster test/api-anbindung.test.js: ein Router, der auf Pfad und Methode
// antwortet, damit sich Submit -> Poll -> Result ohne Netz durchspielen laesst.

function jsonAntwort(status, objekt) { return { status, json: async () => objekt }; }
function textAntwort(status, text) {
  return { status, text: async () => text, json: async () => JSON.parse(text) };
}

// zweiterSubmit: was die ZWEITE /submit-Anfrage beantwortet (null = wie die
// erste). So laesst sich ein Fehlschlag genau der 3DS-Abfrage nachstellen.
function router(opt) {
  const o = opt || {};
  let submits = 0;
  const sqls = [];
  const fn = async (url, req) => {
    const u = String(url);
    const m = (req && req.method) || 'GET';
    if (u.endsWith('/health')) return jsonAntwort(200, { ok: true, zugangsdaten: true });
    if (u.endsWith('/submit') && m === 'POST') {
      submits++;
      sqls.push(JSON.parse(req.body).sql);
      if (submits === 2 && o.zweiterSubmit) return o.zweiterSubmit;
      return jsonAntwort(201, { queryToken: 'tok-' + submits });
    }
    if (u.includes('/status/')) return jsonAntwort(200, { status: 'SUCCESS' });
    if (u.includes('/result/')) {
      const token = u.split('/result/')[1].split('?')[0];
      if (token === 'tok-2' && o.zweitesResultStatus) {
        return textAntwort(o.zweitesResultStatus, '');
      }
      return textAntwort(200, token === 'tok-2' ? TDS_CSV : AGG_CSV);
    }
    if (u.includes('/query/') && m === 'DELETE') return jsonAntwort(200, { ok: true });
    return jsonAntwort(404, { ok: false, fehler: 'unbekannt' });
  };
  fn.sqls = sqls;
  fn.submits = () => submits;
  return fn;
}

const ruhe = () => new Promise(r => setTimeout(r, 60));

function starteApi(seedUeber, opt) {
  const rt = router(opt);
  const ctx = starte(
    { wallee_query_builder_v6: REPORTING(Object.assign({ apiMode: true }, seedUeber || {})) },
    { fetch: rt });
  ctx.rt = rt;
  ctx.app.apiPollConfig.retryStandardSek = 0.005;
  return ctx;
}

test('Submit im Reporting-Modus setzt beide Abfragen ab und befuellt beide Panels', async () => {
  const { app, el, rt } = starteApi({ reportingChannel: 'BOTH' });
  await ruhe();                       // Health-Check beim Start
  el('sqlOutput').textContent = 'SELECT 1';
  el('submitBtn').dispatch('click');
  await ruhe();

  assert.strictEqual(rt.submits(), 2, 'Aggregat und 3DS-Liste');
  assert.match(rt.sqls[1], /ca\.saleschannel = 1582816223150/,
    'Die zweite Abfrage filtert fest auf E-Commerce');
  assert.ok(app.reportingModellAktuell(), 'Aggregat-Modell steht');
  assert.ok(app.reportingTdsModellAktuell(), '3DS-Modell steht');
  assert.ok(aktiv(el('reportingTdsSection')));
});

test('Beide Abfragen sehen denselben Zeitraum und dieselben Spaces', async () => {
  const { el, rt } = starteApi({ reportingChannel: 'ECOM' });
  await ruhe();
  el('sqlOutput').textContent = 'SELECT 1';
  el('submitBtn').dispatch('click');
  await ruhe();

  // Der Zeitraum stammt aus derselben Quelle wie das SQL im Kopierfeld; hier
  // wird er an der zweiten Query nachgemessen (die erste ist im Test ein
  // Platzhalter, weil submitUndReport das SQL aus dem Feld nimmt).
  assert.match(rt.sqls[1], /2026-07-01 00:00:00/);
  assert.match(rt.sqls[1], /2026-08-01 00:00:00/);
  assert.match(rt.sqls[1], /ca\.spaceid = 90001/);
});

test('Bei Kanal POS bleibt es bei einer Abfrage', async () => {
  const { app, el, rt } = starteApi({ reportingChannel: 'POS' });
  await ruhe();
  el('sqlOutput').textContent = 'SELECT 1';
  el('submitBtn').dispatch('click');
  await ruhe();

  assert.strictEqual(rt.submits(), 1, 'Am POS gibt es keine 3DS-Liste');
  assert.strictEqual(app.reportingTdsModellAktuell(), null);
  assert.ok(!aktiv(el('reportingTdsSection')),
    'Und keine Seite, die "keine 3DS-Fehlschlaege" behauptet');
});

test('Ein Fehlschlag der zweiten Abfrage laesst den Aggregat-Report stehen', async () => {
  const { app, el } = starteApi({ reportingChannel: 'BOTH' },
    { zweiterSubmit: jsonAntwort(500, { fehler: 'Analytics kaputt' }) });
  await ruhe();
  el('sqlOutput').textContent = 'SELECT 1';
  el('submitBtn').dispatch('click');
  await ruhe();

  assert.ok(app.reportingModellAktuell(), 'Der Aggregat-Report muss stehen bleiben');
  assert.ok(el('reportingReportOutput').innerHTML.length > 0);
  assert.strictEqual(app.reportingTdsModellAktuell(), null);
  // Und die 3DS-Statuszeile sagt, warum die Seite fehlt - statt sie
  // kommentarlos wegzulassen.
  assert.strictEqual(el('reportingTdsStatus').dataset.art, 'fehler');
  assert.match(el('reportingTdsStatus').textContent, /3DS-Liste/);
});

test('204 auf die zweite Abfrage ist eine Aussage, kein Fehler', async () => {
  // "Die Query lieferte keine Zeilen" heisst hier: es ist kein
  // 3DS-Zahlungsversuch gescheitert. Genau die Frage, mit der jemand diese
  // Seite oeffnet.
  const { app, el } = starteApi({ reportingChannel: 'ECOM' }, { zweitesResultStatus: 204 });
  await ruhe();
  el('sqlOutput').textContent = 'SELECT 1';
  el('submitBtn').dispatch('click');
  await ruhe();

  assert.ok(app.reportingTdsModellAktuell(), 'Ein leeres Modell ist auch ein Modell');
  assert.strictEqual(app.reportingTdsModellAktuell().hatDaten, false);
  assert.strictEqual(el('reportingTdsStatus').dataset.art, 'info');
});

test('Die zweite Abfrage schreibt einen eigenen Verlaufseintrag mit eigenem Token', async () => {
  const { app, el } = starteApi({ reportingChannel: 'BOTH' });
  await ruhe();
  el('sqlOutput').textContent = 'SELECT 1';
  el('submitBtn').dispatch('click');
  await ruhe();

  const verlauf = plain(app.historyLaden());
  assert.strictEqual(verlauf.length, 2, 'Zwei Abfragen, zwei Eintraege');
  const tds = verlauf.find(e => e.mode === 'reporting-tds');
  const agg = verlauf.find(e => e.mode === 'reporting');
  assert.ok(tds && agg, 'Beide Modi muessen vorkommen');
  assert.strictEqual(tds.token, 'tok-2');
  assert.strictEqual(agg.token, 'tok-1');
  assert.strictEqual(tds.account, '', 'Der Account-Override gilt hier nicht');
  assert.strictEqual(tds.filterSummary, '3DS-Failures · E-Commerce');
});
