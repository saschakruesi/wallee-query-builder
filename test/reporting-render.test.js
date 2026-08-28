// Ausgabe des Reporting-Reports: Bildschirm-Render, Balken-SVG, CSV- und
// PDF-Bloecke sowie die Verlaufszeile des Modus.
//
// Gemeinsamer Nenner aller Tests: die Bloecke aus reportingExportBloecke sind
// ROH (Betraege als 1e-8-Ganzzahlen, Prozente ungerundet). Formatiert wird
// ausschliesslich hier, in der Ausgabe - und das Format jeder Zelle kommt ueber
// reportingZellFormat(), nie ueber kopf[c].format. Task 4 hat die Wert-Spalte
// der Kacheln deshalb auf das nicht renderbare 'gemischt' gesetzt: wer den
// Umweg vergisst, schreibt 4229859000000 als Anzahl hin. Mehrere Tests unten
// sind genau darauf gemuenzt.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadBuilders, plain } = require('./harness');
const { makeDocument } = require('./dom-stub');

const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'reporting-beispiel.csv'), 'utf8');

// Kopfzeile allein: parst sauber, liefert aber keine Zeile - der Weg zu einem
// Modell ohne Daten (hatDaten === false).
const NUR_KOPF = FIXTURE.split('\n')[0] + '\n';

function starte(seed) {
  const dokument = makeDocument();
  const app = loadBuilders({ document: dokument, seedLocalStorage: seed });
  return { app, dokument, el: id => dokument.getElementById(id) };
}

function mitFixture() {
  const s = starte({ wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }) });
  assert.strictEqual(s.app.ingestReportingCsv(FIXTURE), true, 'Fixture muss lesbar sein');
  return s;
}

const sichtbar = el => !el.classList.contains('hidden');

// --- svgBalken: reine Funktion ---------------------------------------------

// Attribut-Werte eines Tags einsammeln, damit die Tests ueber die Geometrie
// reden koennen statt ueber Zeichenketten.
function rects(svg) {
  return [...svg.matchAll(/<rect\b[^>]*>/g)].map(m => {
    const roh = m[0];
    const attr = {};
    [...roh.matchAll(/([a-z-]+)="([^"]*)"/g)].forEach(a => { attr[a[1]] = a[2]; });
    return attr;
  });
}

test('svgBalken liefert ein <svg> mit genau einem <rect> je Wert', () => {
  const { app } = starte();
  const svg = app.svgBalken([1, 2, 3, 4], { breite: 200, hoehe: 50 });
  assert.match(svg, /^<svg\b/, 'muss mit <svg beginnen');
  assert.match(svg, /<\/svg>$/);
  assert.strictEqual(rects(svg).length, 4);
});

test('svgBalken skaliert 0 bis Maximum', () => {
  const { app } = starte();
  const r = rects(app.svgBalken([10, 5, 0], { breite: 300, hoehe: 100 }));
  assert.strictEqual(Number(r[0].height), 100, 'Das Maximum fuellt die volle Hoehe');
  assert.strictEqual(Number(r[1].height), 50, 'Der halbe Wert die halbe Hoehe');
  assert.strictEqual(Number(r[2].height), 0, 'Die Null hat keine Hoehe');
  // Balken stehen auf der Grundlinie, nicht in der Luft.
  r.forEach(b => assert.strictEqual(Number(b.y) + Number(b.height), 100));
});

test('svgBalken haelt eine Reihe aus lauter Nullen aus', () => {
  const { app } = starte();
  const svg = app.svgBalken([0, 0, 0], { breite: 90, hoehe: 30 });
  const r = rects(svg);
  assert.strictEqual(r.length, 3, 'Auch eine Nullreihe bekommt ihre Balken');
  r.forEach(b => assert.strictEqual(Number(b.height), 0));
  assert.doesNotMatch(svg, /NaN|Infinity/, 'Division durch das Maximum 0 darf nicht durchschlagen');
});

test('svgBalken haelt einen einzelnen Wert aus', () => {
  const { app } = starte();
  const r = rects(app.svgBalken([7], { breite: 120, hoehe: 40 }));
  assert.strictEqual(r.length, 1);
  assert.strictEqual(Number(r[0].height), 40, 'Ein einziger Wert IST das Maximum');
  assert.ok(Number(r[0].width) > 0, 'Der einzige Balken braucht eine Breite');
});

test('svgBalken zeichnet ohne Werte gar nichts', () => {
  const { app } = starte();
  // Ein leeres <svg> waere ein Rahmen um ein Nichts - die Ausgabe laesst den
  // Balken dann lieber ganz weg.
  assert.strictEqual(app.svgBalken([], { breite: 100, hoehe: 20 }), '');
  assert.strictEqual(app.svgBalken(null, {}), '');
});

test('svgBalken faerbt ausschliesslich ueber die CSS-Variablen', () => {
  const { app } = starte();
  const svg = app.svgBalken([3, 1], { breite: 60, hoehe: 20 });
  assert.match(svg, /var\(--/, 'Farbe kommt aus dem :root-Block');
  assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,8}\b/, 'kein Inline-Hex im SVG');
  // Die Farbe kommt aus einer Whitelist, nicht direkt aus der Option: sonst
  // koennte ein Aufrufer ein Inline-Hex ins SVG schreiben und die Regel
  // "Farben nur ueber die :root-Variablen" waere nur noch eine Bitte.
  const bunt = app.svgBalken([3, 1], { farbe: '#ff0000' });
  assert.doesNotMatch(bunt, /#ff0000/i);
  assert.match(bunt, /fill="var\(--accent\)"/, 'unbekannte Farbe faellt auf --accent zurueck');
  assert.match(app.svgBalken([1], { farbe: 'danger' }), /fill="var\(--danger\)"/);
});

// --- Welche Spalten als Balken taugen --------------------------------------

// Ein 'balken'-Block, wie ihn der Verlauf mit zwei Waehrungen liefert: die
// zweite Zeile ist eine Fortsetzung der ersten (leere erste Spalte).
const VERLAUF_BLOCK = {
  titel: 'X · Verlauf', kanal: 'POS', typ: 'balken', hinweis: '',
  kopf: [
    { label: 'Tag', format: 'text' }, { label: 'Attempts', format: 'zahl' },
    { label: 'Erfolgreich', format: 'zahl' }, { label: 'Erfolg %', format: 'pct' },
    { label: 'Währung', format: 'text' }, { label: 'Umsatz', format: 'betrag' },
  ],
  zeilen: [
    ['2026-07-01', 10, 8, 80, 'CHF', 100000000],
    ['', '', '', '', 'EUR', 200000000],
    ['2026-07-02', 20, 20, 100, 'CHF', 300000000],
  ],
};

test('reportingBalkenSerien ueberspringt die Fortsetzungszeilen', () => {
  const { app } = starte();
  const s = plain(app.reportingBalkenSerien(VERLAUF_BLOCK));
  // Zwei Tage, nicht drei: die EUR-Zeile gehoert zum 1. Juli und haette auf
  // der Achse keinen eigenen Platz.
  assert.deepStrictEqual(s.achse, ['2026-07-01', '2026-07-02']);
  assert.deepStrictEqual(s.serien[0].werte, [10, 20]);
});

test('reportingBalkenSerien nimmt Zaehler und Quote, in dieser Reihenfolge', () => {
  const { app } = starte();
  const s = plain(app.reportingBalkenSerien(VERLAUF_BLOCK));
  assert.strictEqual(s.serien.length, 2);
  assert.strictEqual(s.serien[0].label, 'Attempts');
  assert.strictEqual(s.serien[1].label, 'Erfolg %');
  assert.strictEqual(s.serien[1].max, 100, 'Quoten gehoeren auf eine feste 0-100-Achse');
});

test('reportingBalkenSerien laesst eine Quote ohne Grundlage weg', () => {
  const { app } = starte();
  // Genau die Stundenachse: Stunden ohne Versuch haben keine Erfolgsquote
  // (null = kein Nenner). Ein Nullbalken behauptete dort 0 % Erfolg - eine
  // Messung, die es nicht gibt.
  const block = {
    kopf: [
      { label: 'Stunde', format: 'zahl' }, { label: 'Attempts', format: 'zahl' },
      { label: 'Erfolg %', format: 'pct' },
    ],
    zeilen: [[0, 0, null], [1, 10, 90]],
  };
  const s = plain(app.reportingBalkenSerien(block));
  assert.strictEqual(s.serien.length, 1, 'nur der Zaehler');
  assert.strictEqual(s.serien[0].label, 'Attempts');
  assert.deepStrictEqual(s.serien[0].werte, [0, 10]);
});

test('svgBalken nimmt eine feste Obergrenze entgegen', () => {
  const { app } = starte();
  // Erfolgsquoten gehoeren auf eine 0-100-Achse: sonst sieht ein Tag mit 61 %
  // neben lauter 60ern wie ein Volltreffer aus.
  const r = rects(app.svgBalken([50, 25], { breite: 100, hoehe: 100, max: 100 }));
  assert.strictEqual(Number(r[0].height), 50);
  assert.strictEqual(Number(r[1].height), 25);
});

// --- Zellformatierung ------------------------------------------------------

test('formatProzentCH rundet auf eine Nachkommastelle', () => {
  const { app } = starte();
  assert.strictEqual(app.formatProzentCH(96.70014347202296), '96.7');
  assert.strictEqual(app.formatProzentCH(3.2998565279770418), '3.3');
  assert.strictEqual(app.formatProzentCH(0), '0.0');
  assert.strictEqual(app.formatProzentCH(100), '100.0');
});

test('reportingZellText formatiert je Format, nicht je Zufall', () => {
  const { app } = starte();
  const f = app.reportingZellText;
  assert.strictEqual(f(1403, 'zahl'), '1’403');
  assert.strictEqual(f(2067188000000, 'betrag'), '20’671.88');
  assert.strictEqual(f(96.70014347202296, 'pct'), '96.7 %');
  assert.strictEqual(f(1.105793450881612, 'faktor'), '1.11');
  assert.strictEqual(f('Visa', 'text'), 'Visa');
});

test('reportingZellText unterscheidet "keine Grundlage" von "gehoert zur Zeile darueber"', () => {
  const { app } = starte();
  const f = app.reportingZellText;
  // null = Nenner 0 (Task 4 §1.3). Ein leeres Feld liesse offen, ob gemessen
  // wurde und nichts war, oder ob gar nicht gemessen werden konnte.
  assert.strictEqual(f(null, 'pct'), '—');
  assert.strictEqual(f(null, 'betrag'), '—');
  // '' = Fortsetzungszeile einer Waehrungsgruppe - da gehoert nichts hin.
  assert.strictEqual(f('', 'pct'), '');
  assert.strictEqual(f('', 'zahl'), '');
});

// --- Bildschirm-Render -----------------------------------------------------

test('Der Render gliedert nach Kanal und zeigt jeden Block', () => {
  const { el } = mitFixture();
  const html = el('reportingReportOutput').innerHTML;
  assert.match(html, /Reporting/, 'Titelblock');
  assert.match(html, /POS · Kennzahlen/);
  assert.match(html, /E-Com · Conversion/);
  assert.match(html, /Andere · Zahlungsmittel/);
  assert.match(html, /Zeitraum \(Daten\)/, 'Titelblock-Zeilen stehen wirklich da');
});

test('Jeder Kanal bekommt genau eine Ueberschrift, der Titelblock keine', () => {
  const { el } = mitFixture();
  const html = el('reportingReportOutput').innerHTML;
  const ueberschriften = [...html.matchAll(/<h2 class="report-kanal">([^<]*)<\/h2>/g)].map(m => m[1]);
  // Die Kanal-Zugehoerigkeit steht zwar auch in jedem Blocktitel ("POS · …"),
  // aber nur damit die XLSX-Blattnamen eindeutig bleiben. Gruppiert wird ueber
  // block.kanal - und das muss auf dem Schirm sichtbar sein.
  assert.deepStrictEqual(ueberschriften, ['POS', 'E-Com', 'Andere']);
});

test('Lange Tabellen stehen eingeklappt, die kurzen offen', () => {
  const { el } = mitFixture();
  const html = el('reportingReportOutput').innerHTML;
  // Die Stundenachse hat immer 24 Zeilen, der Verlauf kann ueber ein Jahr
  // laufen - beides erschluege die Uebersicht.
  assert.match(html, /<details><summary>Tabelle \(24 Zeilen\)<\/summary><table/);
  // Die Zahlungsmittel-Tabelle (5 Zeilen) bleibt offen.
  const zm = html.slice(html.indexOf('POS · Zahlungsmittel'));
  assert.match(zm.slice(0, 200), /<table/, 'kurze Tabellen stehen ohne Klappe da');
});

test('Ein Block mit zellFormate wird Zelle fuer Zelle formatiert', () => {
  const { app } = starte();
  // reportingExportBloecke traegt zellFormate heute nur an den Kacheln. Die
  // Tabellen-Ausgabe muss trotzdem darueber laufen: ein spaeterer Block mit
  // gemischter Spalte darf nicht still falsch gerendert werden.
  const html = app.reportingBlockHtml({
    titel: 'Test', kanal: 'POS', typ: 'tabelle', hinweis: '',
    kopf: [{ label: 'Angabe', format: 'text' }, { label: 'Wert', format: 'gemischt' }],
    zeilen: [['Anzahl', 1403], ['Umsatz', 4229859000000]],
    zellFormate: [['text', 'zahl'], ['text', 'betrag']],
  });
  assert.match(html, />1’403</);
  assert.match(html, />42’298\.59</);
  assert.doesNotMatch(html, /4229859000000/);
});

test('Kacheln lesen ihr Format je Zelle, nicht aus dem Spaltenkopf', () => {
  const { el } = mitFixture();
  const html = el('reportingReportOutput').innerHTML;
  // Die Wert-Spalte der Kacheln traegt kopf[1].format === 'gemischt'. Wer
  // darueber rendert, bekommt fuer beide Zellen String(wert):
  //   Zahlungsversuche -> "1403" statt "1’403"
  //   Umsatz           -> "4229859000000" statt "42’298.59"
  assert.match(html, /<h3>POS · Kennzahlen<\/h3><div class="kpi-kacheln">/,
    'Kacheln sind Kacheln, keine zweispaltige Tabelle');
  assert.match(html, /1’403/, 'Zaehler mit Schweizer Tausendertrennung');
  assert.match(html, /CHF 42’298\.59/,
    'Betrag aus 1e-8-Einheiten heruntergerechnet, MIT seiner Waehrung - eine '
    + 'Kachel ohne Einheit ist eine Zahl ohne Aussage');
  assert.doesNotMatch(html, /4229859000000/, 'Rohe 1e-8-Einheiten duerfen nie sichtbar werden');
  assert.doesNotMatch(html, /gemischt/, 'Das Sentinel-Format darf nirgends durchschlagen');
});

test('Prozente stehen mit einer Nachkommastelle da', () => {
  const { el } = mitFixture();
  const html = el('reportingReportOutput').innerHTML;
  assert.match(html, /96\.7 %/);
  assert.doesNotMatch(html, /96\.70014/, 'Volle Genauigkeit gehoert ins Modell, nicht auf den Schirm');
});

test('Balken-Bloecke zeichnen ein inline-SVG neben ihrer Tabelle', () => {
  const { el } = mitFixture();
  const html = el('reportingReportOutput').innerHTML;
  assert.match(html, /POS · Verlauf/);
  assert.match(html, /<svg\b/, 'Balken als inline-SVG, kein Chart-Vendor');
  assert.match(html, /<rect\b/);
  // Die Tabelle bleibt daneben stehen - das SVG ist die Zugabe, nicht der Ersatz.
  assert.match(html, /2026-07-01/);
});

test('Der Render schreibt kein Inline-Hex in die Ausgabe', () => {
  const { el } = mitFixture();
  // Alle Farbentscheide laufen ueber die :root-Variablen (CLAUDE.md, "Optik").
  assert.doesNotMatch(el('reportingReportOutput').innerHTML, /#[0-9a-fA-F]{3,8}\b/);
});

test('Ein Hinweisblock erscheint als Text, nicht als leere Tabelle', () => {
  const { app, el } = starte({ wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }) });
  assert.strictEqual(app.ingestReportingCsv(NUR_KOPF), true, 'Kopfzeile allein ist ein gueltiges, leeres Ergebnis');
  const html = el('reportingReportOutput').innerHTML;
  assert.match(html, /Keine Daten/);
  // Genau eine Tabelle: der Titelblock. Der Hinweisblock hat kopf: [] und
  // zeilen: [] - eine Tabelle daraus waere ein Kopf ohne Spalten.
  assert.strictEqual((html.match(/<table/g) || []).length, 1);
});

test('Ohne Modell bleibt die Ausgabe leer und die Aktionen verschwinden', () => {
  const { app, el } = mitFixture();
  el('reportingReportActions').classList.remove('hidden');   // Ausgangszustand herstellen
  assert.strictEqual(app.ingestReportingCsv('kein;csv'), false);
  assert.strictEqual(el('reportingReportOutput').innerHTML, '');
  assert.ok(!sichtbar(el('reportingReportActions')));
});

// --- CSV -------------------------------------------------------------------

test('Der CSV-Export sitzt auf denselben Bloecken auf', () => {
  const { app } = mitFixture();
  const csv = app.buildReportingReportCsv(app.reportingModellAktuell(), app.reportingExportOptionen());
  assert.match(csv, /^﻿/, 'BOM, sonst liest Excel unter Windows Latin-1');
  assert.match(csv, /POS · Kennzahlen/);
  assert.match(csv, /E-Com · Verlauf/);
  assert.match(csv, /;/, 'Semikolon-getrennt wie die uebrigen Report-CSVs');
  // Der Hinweis eines Blocks traegt die Lesart seiner Zahlen (welcher Nenner,
  // was PENDING bedeutet). Ohne ihn ist die Tabelle daneben missverstaendlich.
  assert.match(csv, /Quoten zählen nur Versuche mit Endzustand/);
});

test('Die CSV traegt maschinenlesbare Zahlen, keine formatierten Woerter', () => {
  const { app } = mitFixture();
  const csv = app.buildReportingReportCsv(app.reportingModellAktuell(), app.reportingExportOptionen());
  assert.match(csv, /42298\.59/, 'Betrag als Dezimalzahl, Punkt als Trenner');
  assert.doesNotMatch(csv, /4229859000000/, 'nicht die rohen 1e-8-Einheiten');
  assert.doesNotMatch(csv, /96\.70014/, 'Prozent auf eine Nachkommastelle');
  assert.doesNotMatch(csv, /1\.105793/, 'Faktor auf zwei Stellen, wie auf dem Schirm');
  assert.match(csv, /\r\nVisa;697;49\.7;96\.7;3\.3;CHF;20671\.88;48\.9;30\.67\r\n/,
    'Datenzeile durchgehend maschinenlesbar: keine Tausendertrennung, kein Prozentzeichen');
  // Tausendertrennung gibt es nur in der Hinweis-PROSA unter der Tabelle
  // ("Grundlage: 1’147 …") - das ist Fliesstext, keine Zelle.
  csv.split('\r\n').filter(z => z.indexOf(';') >= 0).forEach(z => {
    assert.doesNotMatch(z, /’/, `Datenzeile mit Tausendertrennung bricht jeden Import: ${z}`);
  });
});

// --- PDF-Bloecke -----------------------------------------------------------

test('reportingPdfBloecke liefert Titel, Kopfzeilen und Tabellen', () => {
  const { app } = mitFixture();
  const p = app.reportingPdfBloecke(app.reportingModellAktuell(), app.reportingExportOptionen());
  assert.match(p.titel, /REPORTING/);
  assert.ok(p.kopfzeilen.length > 0, 'Zeitraum/Spaces gehoeren in den Kopf');
  assert.ok(p.kopfzeilen.some(z => /Zeitraum/.test(z)));
  assert.ok(p.tabellen.length > 5);
  // Die Prosa des Titelblocks haengt als eigener Abschnitt darunter: er hat
  // keine Spalten, und autoTable bekaeme sonst einen Kopf ohne Spalten.
  const grundlagen = p.tabellen[0];
  assert.strictEqual(grundlagen.titel, 'Grundlagen');
  assert.strictEqual(grundlagen.nurHinweis, true);
  assert.deepStrictEqual(plain(grundlagen.header), []);
  assert.match(grundlagen.hinweis, /Zahlungsversuch/);
  // Alle uebrigen Abschnitte haben Spalten und sind echte Tabellen.
  p.tabellen.slice(1).forEach(t => assert.strictEqual(t.nurHinweis, false, t.titel));
});

test('Jeder Kanal faengt im PDF auf einer frischen Seite an', () => {
  const { app } = mitFixture();
  const p = app.reportingPdfBloecke(app.reportingModellAktuell(), app.reportingExportOptionen());
  const kanalStart = p.tabellen.filter(t => t.seitenumbruchDavor).map(t => t.titel);
  assert.strictEqual(kanalStart.length, 3, 'POS, E-Com, Andere - drei Kapitel');
  assert.match(kanalStart[0], /POS/);
  assert.match(kanalStart[1], /E-Com/);
  assert.match(kanalStart[2], /Andere/);
});

test('Die PDF-Zeilen sind fertig formatierte Strings', () => {
  const { app } = mitFixture();
  const p = app.reportingPdfBloecke(app.reportingModellAktuell(), app.reportingExportOptionen());
  p.tabellen.forEach(t => t.rows.forEach(r => r.forEach(z => {
    assert.strictEqual(typeof z, 'string', `${t.titel}: jsPDF/autotable bekommt nur Strings`);
  })));
  const alle = JSON.stringify(p.tabellen);
  assert.match(alle, /1’403/, 'Kacheln ueber reportingZellFormat, nicht ueber den Spaltenkopf');
  assert.doesNotMatch(alle, /4229859000000/);
  assert.match(alle, /96\.7 %/);
});

test('Die Ausrichtung folgt dem Format der Spalte', () => {
  const { app } = mitFixture();
  const p = app.reportingPdfBloecke(app.reportingModellAktuell(), app.reportingExportOptionen());
  const zm = p.tabellen.find(t => /Zahlungsmittel/.test(t.titel) && /POS/.test(t.titel));
  assert.ok(zm, 'POS-Zahlungsmittel muss es geben');
  assert.strictEqual(zm.ausrichtung[0], 'left', 'Brand ist Text');
  assert.strictEqual(zm.ausrichtung[1], 'right', 'Attempts sind eine Zahl');
});

// --- Verlauf (Step 8) ------------------------------------------------------

test('modusLabel kennt den Reporting-Modus', () => {
  const { app } = starte();
  assert.strictEqual(app.modusLabel('reporting'), 'Reporting');
});

const VERLAUF = mode => JSON.stringify([{
  id: 'tok1', mode, token: 'tok1', submittedAt: '2026-08-01T10:00:00.000Z',
  spacesSummary: 'Space 90001', timeframeSummary: '2026-07-01 → 2026-07-31',
  filterSummary: '', status: 'SUCCESS', account: '',
}]);

test('Die Verlaufszeile im Reporting-Modus bietet nur die Roh-CSV', () => {
  const { app, el } = starte({
    wallee_query_builder_v6: JSON.stringify({ mode: 'reporting' }),
    wallee_query_history_v1: VERLAUF('reporting'),
  });
  app.renderHistory();
  const zeilen = el('queryHistoryBody').children;
  assert.strictEqual(zeilen.length, 1, 'Der Eintrag muss im eigenen Modus auftauchen');
  const html = zeilen[0].innerHTML;
  assert.match(html, /data-act="csv"/, 'Roh-CSV bleibt');
  assert.doesNotMatch(html, /data-act="xlsx"/,
    'Excel laeuft ueber das Report-Panel, wie bei terminal und settlement');
  assert.match(html, /Reporting/, 'und der Modus steht mit seinem Anzeigenamen da');
  assert.doesNotMatch(html, />reporting</, 'nicht der rohe Schluessel');
});

test('Die uebrigen Modi behalten ihren Excel-Knopf', () => {
  // Gegenprobe: sonst waere der Test oben auch dann gruen, wenn der
  // Excel-Knopf ueberall verschwunden ist.
  const { app, el } = starte({
    wallee_query_builder_v6: JSON.stringify({ mode: 'brand' }),
    wallee_query_history_v1: VERLAUF('brand'),
  });
  app.renderHistory();
  assert.match(el('queryHistoryBody').children[0].innerHTML, /data-act="xlsx"/);
});
