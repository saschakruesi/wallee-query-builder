// Prueft den Render-Pfad des Terminal-Reports: aus einer CSV muss sichtbarer,
// korrekt formatierter Text entstehen.
//
// Der Standard-DOM-Stub im Harness ist ein No-Op - er verhindert nur, dass das
// Script beim Laden stolpert, und wuerde jeden Renderfehler verschlucken. Hier
// steht deshalb ein minimaler DOM-Ersatz, der Kinder und Textinhalte wirklich
// behaelt, sodass wir den gerenderten Text auslesen koennen. Kein jsdom - das
// Projekt bleibt ohne npm-Abhaengigkeiten.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadBuilders } = require('./harness');
const { makeDocument, alleTags } = require('./dom-stub');

// --- Testlauf --------------------------------------------------------------

const dokument = makeDocument();
const app = loadBuilders({ document: dokument });
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'beispiel-daten.csv'), 'utf8');

// ingestReportCsv und renderReport haengen am DOM, deshalb ueber das Harness
// exportiert (siehe EXPORTED in test/harness.js).
const { ingestReportCsv } = app;
const reportOutput = dokument.getElementById('reportOutput');

test('CSV laden erzeugt einen sichtbaren Report', () => {
  const ok = ingestReportCsv(FIXTURE);
  assert.strictEqual(ok, true, 'Fixture muss angenommen werden');
  assert.ok(reportOutput.children.length > 0, 'Report-Ausgabe darf nicht leer sein');
});

test('Gerenderter Report enthaelt alle vier Bloecke', () => {
  ingestReportCsv(FIXTURE);
  const text = reportOutput.textContent;

  ['Detail', 'Total Outlet-Gruppen', 'Total Brand-Gruppen', 'Gesamttotal']
    .forEach(titel => assert.ok(text.includes(titel), `Block "${titel}" fehlt`));
});

test('Gerenderter Report zeigt das Gesamttotal im Schweizer Format', () => {
  ingestReportCsv(FIXTURE);
  const text = reportOutput.textContent;

  // Sollzahlen der Fixture, wie in test/report.test.js festgehalten.
  assert.ok(text.includes('62’756.16'), 'Gesamttotal Complete Demand fehlt oder ist falsch formatiert');
  assert.ok(text.includes('793.46'), 'Gesamttotal Tip fehlt');
  assert.ok(text.includes('2’070'), 'Gesamttotal Anzahl fehlt oder ohne Tausendertrennung');
});

test('Gerenderter Report zeigt beide Brand-Gruppen und alle Outlet-Gruppen', () => {
  ingestReportCsv(FIXTURE);
  const text = reportOutput.textContent;

  assert.ok(text.includes('Lunch-Check'), 'Brand-Gruppe Lunch-Check fehlt');
  assert.ok(text.includes('Wallee'), 'Brand-Gruppe Wallee fehlt');
  ['Bar', 'Bistro', 'Dachgarten', 'Empfang', 'Galerie', 'Kiosk',
    'Saal Nord', 'Saal Süd', 'Terrasse', 'Weinkeller']
    .forEach(o => assert.ok(text.includes(o), `Outlet-Gruppe "${o}" fehlt`));
});

test('fehlerhafte CSV rendert keinen Report, sondern eine Meldung', () => {
  const ok = ingestReportCsv('"terminal_identifier","brand"\n"T1","Visa"\n');
  assert.strictEqual(ok, false);
  assert.strictEqual(reportOutput.children.length, 0, 'Bei Fehler darf kein Report stehenbleiben');

  const status = dokument.getElementById('reportStatus');
  assert.match(status.textContent, /tip_total/, 'Meldung muss die fehlende Spalte nennen');
});

test('Report wird nach einem Fehler mit gueltiger CSV wieder aufgebaut', () => {
  ingestReportCsv('kaputt');
  assert.strictEqual(reportOutput.children.length, 0);

  assert.strictEqual(ingestReportCsv(FIXTURE), true);
  assert.ok(reportOutput.textContent.includes('62’756.16'), 'Report muss sich erholen');
});

// --- Reaktivitaet: Gruppennamen bearbeiten ---------------------------------
// Der eigentliche Kern der Bedienung: einen Gruppennamen aendern, und der
// Report rechnet sofort neu. Zwei Gruppen auf denselben Namen gesetzt muessen
// zusammenfallen.

const outletCfg = dokument.getElementById('reportOutletCfg');

// Findet in einer Konfig-Zeile das Eingabefeld und das Label davor.
function cfgFelder(container) {
  return container.children.map(row => ({
    label: row.children[0].textContent,
    input: row.children[1],
  }));
}

function setzeGruppe(feld, name) {
  feld.input.value = name;
  feld.input.dispatch('input');
}

const outletUeberschriften = () => alleTags(reportOutput, 'h4').map(h => h.textContent);

test('Gruppenname aendern rechnet den Report neu', () => {
  ingestReportCsv(FIXTURE);
  const felder = cfgFelder(outletCfg);
  assert.ok(felder.length > 0, 'Konfig-Zeilen muessen gerendert sein');

  const bar1 = felder.find(f => f.label.startsWith('Bar 1'));
  assert.ok(bar1, 'Terminal "Bar 1" muss in der Konfig stehen');

  setzeGruppe(bar1, 'Hauptbar');
  assert.ok(reportOutput.textContent.includes('Hauptbar'),
    'neuer Gruppenname muss im Report auftauchen');
});

test('zwei Gruppen auf denselben Namen werden im Report zusammengefuehrt', () => {
  ingestReportCsv(FIXTURE);
  const vorher = outletUeberschriften();
  assert.ok(vorher.includes('Saal Nord') && vorher.includes('Saal Süd'),
    'Ausgangslage: zwei getrennte Gruppen');

  cfgFelder(outletCfg)
    .filter(f => f.label.startsWith('Saal '))
    .forEach(f => setzeGruppe(f, 'Saal'));

  const nachher = outletUeberschriften();
  assert.ok(nachher.includes('Saal'), 'gemeinsame Gruppe "Saal" muss erscheinen');
  assert.ok(!nachher.includes('Saal Nord'), 'Gruppe "Saal Nord" darf es nicht mehr geben');
  assert.ok(!nachher.includes('Saal Süd'), 'Gruppe "Saal Süd" darf es nicht mehr geben');
  assert.strictEqual(nachher.length, vorher.length - 1, 'aus zwei Gruppen wird eine');

  // Umgruppieren darf das Gesamttotal nicht veraendern.
  assert.ok(reportOutput.textContent.includes('62’756.16'), 'Gesamttotal muss unveraendert bleiben');
});

test('geaenderte Gruppennamen ueberleben ein erneutes Laden derselben CSV', () => {
  ingestReportCsv(FIXTURE);
  const kiosk = cfgFelder(outletCfg).find(f => f.label.startsWith('Kiosk'));
  setzeGruppe(kiosk, 'Aussenstelle');

  // Neu laden: die gespeicherte Zuordnung muss greifen (Persistenz ueber die
  // stabile TID, nicht ueber den Terminalnamen).
  ingestReportCsv(FIXTURE);
  assert.ok(reportOutput.textContent.includes('Aussenstelle'),
    'gespeicherte Zuordnung muss beim erneuten Laden greifen');
  assert.ok(!reportOutput.textContent.includes('Kiosk\n'), 'alte Auto-Gruppe darf nicht zurueckkehren');
});

test('leerer Gruppenname faellt auf den Auto-Vorschlag zurueck', () => {
  ingestReportCsv(FIXTURE);
  const galerie = cfgFelder(outletCfg).find(f => f.label.startsWith('Galerie'));

  setzeGruppe(galerie, '');
  // Leerer Name darf keine namenlose Gruppe erzeugen; beim naechsten Laden
  // greift wieder der Vorschlag.
  ingestReportCsv(FIXTURE);
  assert.ok(reportOutput.textContent.includes('Galerie'),
    'nach leerem Namen muss der Auto-Vorschlag zurueckkommen');
});
