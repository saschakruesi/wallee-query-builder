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

// Der Abschnitt EINES Blocks: vom Titel bis zur naechsten <h3>-Ueberschrift.
// Vorher schnitten die Tests hier eine feste Zeichenzahl heraus ("die ersten
// 800"); seit Iteration 2 steht zwischen Titel und Tabelle je nach Block ein
// Kuchen, und die Fenstergroesse entschied dann darueber, ob ein Test noch
// etwas findet. Die Blockgrenze ist die Aussage, die gemeint war.
function blockAbschnitt(html, titel) {
  const start = html.indexOf(titel);
  assert.notStrictEqual(start, -1, `Block "${titel}" fehlt in der Ausgabe`);
  const rest = html.slice(start);
  const ende = rest.indexOf('<h3>');
  return ende === -1 ? rest : rest.slice(0, ende);
}

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
  assert.match(app.svgBalken([1], { farbe: 'accent-dark' }), /fill="var\(--accent-dark\)"/);
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

test('Eine Zahl mit unbekanntem Format wird sichtbar falsch, nicht still falsch', () => {
  const { app } = starte();
  // Genau der Fall, den Task 4 mit dem Sentinel 'gemischt' provoziert: wer den
  // Umweg ueber reportingZellFormat() vergisst, darf keine rohe 1e-8-Einheit
  // hinschreiben, die wie ein Messwert aussieht.
  //
  // Der Marker ist bewusst WEDER der Strich NOCH die leere Zelle: beide sind in
  // denselben Spalten schon vergeben (— = kein Nenner auf dem Schirm,
  // '' = Fortsetzungszeile einer Waehrungsgruppe in CSV/Excel). Ein Fehler
  // waere sonst von einer gueltigen Aussage nicht zu unterscheiden.
  assert.strictEqual(app.reportingZellText(4229859000000, 'gemischt'), '#FORMAT?');
  assert.strictEqual(app.reportingZellText(1403, 'nochnichterfunden'), '#FORMAT?');
  assert.strictEqual(app.reportingZellZahl(4229859000000, 'gemischt'), '#FORMAT?');
  // Text bleibt Text: das Format ist dort ohnehin nur eine Ausrichtungsfrage.
  assert.strictEqual(app.reportingZellText('Visa', 'gemischt'), 'Visa');
});

test('Der Fehlermarker ist von den beiden gueltigen Aussagen unterscheidbar', () => {
  const { app } = starte();
  // Die drei Faelle stehen nebeneinander, damit keiner still auf einen anderen
  // zusammenfaellt - genau das war der Fehler der ersten Fassung.
  assert.strictEqual(app.reportingZellText(null, 'zahl'), '—', 'kein Nenner');
  assert.strictEqual(app.reportingZellText('', 'zahl'), '', 'Fortsetzungszeile');
  assert.strictEqual(app.reportingZellText(7, 'gemischt'), '#FORMAT?', 'Formatfehler');
  assert.strictEqual(app.reportingZellZahl(null, 'zahl'), '');
  assert.strictEqual(app.reportingZellZahl('', 'zahl'), '');
  assert.strictEqual(app.reportingZellZahl(7, 'gemischt'), '#FORMAT?');
});

test('Das Format "text" ist gueltig und der Vorgabewert, kein Fehlerfall', () => {
  const { app } = starte();
  // reportingSpalte(label) setzt 'text', wenn kein Format angegeben ist, und
  // reportingZellFormat() liefert es fuer eine fehlende Kopfspalte. Eine Zahl
  // darunter ist deshalb keine Fehlbedienung - sie war einen
  // reportingSpalte('Terminal-ID') davon entfernt, still geleert zu werden.
  assert.strictEqual(app.reportingZellText(1403, 'text'), '1403');
  assert.strictEqual(app.reportingZellZahl(1403, 'text'), 1403);
  // Und der Vorgabeweg selbst: eine Spalte ohne Format ist eine text-Spalte,
  // eine fehlende Kopfspalte ebenso.
  const block = { kopf: [{ label: 'Nur eine Spalte', format: 'text' }], zeilen: [[1403]] };
  assert.strictEqual(app.reportingZellFormat(block, 0, 0), 'text');
  assert.strictEqual(app.reportingZellFormat(block, 0, 9), 'text', 'fehlende Kopfspalte');
  assert.strictEqual(app.reportingZellText(1403, app.reportingZellFormat(block, 0, 9)), '1403');
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
  const zm = blockAbschnitt(html, 'POS · Zahlungsmittel');
  assert.match(zm, /<table/);
  assert.doesNotMatch(zm, /<details>/, 'kurze Tabellen stehen ohne Klappe da');
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
  //   Umsatz           -> "3089116000000" statt "30’891.16"
  assert.match(html, /<h3>POS · Kennzahlen<\/h3><div class="kpi-kacheln">/,
    'Kacheln sind Kacheln, keine zweispaltige Tabelle');
  assert.match(html, /1’403/, 'Zaehler mit Schweizer Tausendertrennung');
  assert.match(html, /CHF 30’891\.16/,
    'Betrag aus 1e-8-Einheiten heruntergerechnet, MIT seiner Waehrung - eine '
    + 'Kachel ohne Einheit ist eine Zahl ohne Aussage');
  assert.doesNotMatch(html, /3089116000000/, 'Rohe 1e-8-Einheiten duerfen nie sichtbar werden');
  assert.doesNotMatch(html, /gemischt/, 'Das Sentinel-Format darf nirgends durchschlagen');
});

test('Prozente stehen mit einer Nachkommastelle da', () => {
  const { el } = mitFixture();
  const html = el('reportingReportOutput').innerHTML;
  assert.match(html, /96\.7 %/);
  assert.doesNotMatch(html, /96\.70014/, 'Volle Genauigkeit gehoert ins Modell, nicht auf den Schirm');
});

test('Der Karten-Hinweis nennt keine Markenliste', () => {
  const { el } = mitFixture();
  const html = el('reportingReportOutput').innerHTML;

  // Der Hinweis erklaert den Nenner von K5/K6/P1. Wer darin Marken aufzaehlt,
  // schreibt eine Liste fest, die der Connector bestimmt und nicht die
  // Zahlungsart: PostFinance Card trug am POS Karten-Labels und im
  // E-Commerce keine - dieselbe Marke, zwei Antworten. Genau daran ist der
  // alte Satz veraltet, und zwar unbemerkt, weil ihn nichts geprueft hat.
  //
  // Geprueft wird der SATZ, nicht die Seite: eine Liste laesst sich in beliebiger
  // Zeichensetzung schreiben ("TWINT und PostFinance Card und Lunch Check"), und
  // jedes Muster auf Komma oder Klammer haette genau daran vorbeigesehen. Statt
  // Schreibweisen zu erraten, darf in diesem Satz ueberhaupt kein Markenname
  // ausser dem einen Beispiel vorkommen.
  const hinweise = [...html.matchAll(/<p class="hint">([^<]*)<\/p>/g)].map(m => m[1])
    .filter(h => h.includes('Zahlungsmittel ohne Karten-Labels'));
  // K5 (Kartentyp), K6 (Kartenherkunft) und P1 (Debit/Kredit) teilen sich den
  // Satz - findet die Suche weniger, prueft die Schleife unten zu wenig.
  assert.ok(hinweise.length >= 3,
    'erwartet: der Karten-Hinweis unter K5, K6 und P1, gefunden ' + hinweise.length);

  hinweise.forEach(h => {
    assert.match(h, /Welche das sind, hängt vom Acquirer ab/,
      'der Hinweis muss sagen, dass die Menge connectorabhaengig ist');
    // Ein einzelnes Beispiel bleibt erlaubt und ist als solches gekennzeichnet -
    // sonst bliebe offen, wohin der fehlende Umsatz verschwunden ist.
    assert.match(h, /zum Beispiel TWINT/);
    ['PostFinance', 'Lunch Check', 'Reka', 'Boncard', 'PowerPay', 'Rechnung',
      'Visa', 'Mastercard'].forEach(marke => {
      assert.ok(!h.includes(marke),
        `Der Karten-Hinweis darf ${marke} nicht nennen, in welcher Form auch immer: ${h}`);
    });
  });

  // Gegenprobe, dass hier nicht bloss der Satz geprueft wird: die Marke selbst
  // gehoert sehr wohl in die Tabellen. ACHTUNG - diese Zusicherung haelt die
  // Kartenbasis NICHT: PostFinance Card steht im Zahlungsmittel-Block, ob es
  // als Karte zaehlt oder nicht, und bleibt deshalb auch ohne den
  // PostFinance-Token in KARTEN_BRANDS gruen. Die Kartenbasis nagelt
  // test/reporting-model.test.js fest (pos.kartentyp.basis === 1243).
  assert.match(html, /PostFinance Card/, 'die Marke selbst gehoert in die Tabellen');
});

test('Balken-Bloecke zeichnen ein inline-SVG neben ihrer Tabelle', () => {
  const { el } = mitFixture();
  const html = el('reportingReportOutput').innerHTML;
  assert.match(html, /POS · Verlauf/);
  assert.match(html, /<svg\b/, 'Balken als inline-SVG, kein Chart-Vendor');
  assert.match(html, /<rect\b/);
  // Die Bildunterschrift sagt, worauf der Balken skaliert - ohne sie laesst
  // sich seine Hoehe nicht lesen. Der Zaehler auf sein eigenes Maximum, die
  // Quote auf die feste 0-100-Achse.
  assert.match(html, /Attempts · Maximum 707/);
  assert.match(html, /Erfolg % · Skala 0–100 %/);
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
  assert.match(csv, /30891\.16/, 'Betrag als Dezimalzahl, Punkt als Trenner');
  assert.doesNotMatch(csv, /3089116000000/, 'nicht die rohen 1e-8-Einheiten');
  assert.doesNotMatch(csv, /96\.70014/, 'Prozent auf eine Nachkommastelle');
  assert.doesNotMatch(csv, /1\.102120/, 'Faktor auf zwei Stellen, wie auf dem Schirm');
  assert.match(csv, /\r\nVisa;697;49\.7;96\.7;3\.3;CHF;16150\.7;52\.3;23\.96\r\n/,
    'Datenzeile durchgehend maschinenlesbar: keine Tausendertrennung, kein Prozentzeichen');
  // Tausendertrennung gibt es nur in der Hinweis-PROSA unter der Tabelle
  // ("Grundlage: 1’243 …") - das ist Fliesstext, keine Zelle. Eine Prosa-Zeile
  // ist genau EIN quotiertes Feld; erst mehrere Felder machen eine Datenzeile.
  // Ohne diese zweite Bedingung schlug der Waechter an, sobald die Prosa selbst
  // ein Semikolon enthielt - und meldete dann "Datenzeile mit Tausendertrennung"
  // ueber korrekt quotierten Fliesstext, der jeden Import unbeschadet uebersteht.
  // Er beschuldigte also das Falsche und zwang die Formulierung des Hinweises,
  // statt die CSV zu schuetzen.
  const istProsa = z => /^"[^"]*"$/.test(z);
  const datenzeilen = csv.split('\r\n').filter(z => z.indexOf(';') >= 0 && !istProsa(z));
  assert.ok(datenzeilen.length > 0, 'ohne Datenzeilen prueft die Schleife nichts');
  datenzeilen.forEach(z => {
    assert.doesNotMatch(z, /’/, `Datenzeile mit Tausendertrennung bricht jeden Import: ${z}`);
  });
});

// --- Ablehngruende im Klartext (Iteration 2, §1) -----------------------------

test('Der Bildschirm zeigt Namen, Kategorie, Bedeutung und Empfehlung', () => {
  const { el } = mitFixture();
  const html = el('reportingReportOutput').innerHTML;
  // Die Fixture fuehrt echte Katalog-IDs; genau dafuer ist die Task da.
  assert.match(html, />3-D Secure Failure</);
  assert.match(html, />Security Decline</);
  assert.match(html, /Nicht wiederholen/, 'Empfehlung RETRY_NO in deutscher Beschriftung');
  assert.match(html, /hochriskant/, 'Bedeutung aus dem Katalog');
  // Der POS-Grund traegt die korrigierte Kategorie, nicht die des Katalogs.
  const k8 = blockAbschnitt(html, 'POS · Ablehngründe');
  assert.match(k8, />Endnutzer</,
    'Transaction declined steht im Katalog als Configuration und wird korrigiert');
  // Und nirgends mehr eine nackte ID als Grund - das ist der Zweck der Task.
  assert.doesNotMatch(html, />#\d+</);
});

test('Der Kategorie-Block steht mit deutschen Beschriftungen auf dem Schirm', () => {
  const { el } = mitFixture();
  const html = el('reportingReportOutput').innerHTML;
  const block = blockAbschnitt(html, 'E-Com · Ablehngründe nach Kategorie');
  assert.match(block, />Endnutzer</);
  assert.match(block, />Vorübergehend</);
  assert.match(block, />Entwickler</);
});

test('Der Hinweisblock der Ablehncodes rendert ohne leere Tabelle', () => {
  const { app } = starte();
  // Form, die reportingKanalBloecke im E-Commerce unter der Schwelle liefert:
  // kein Kopf, keine Zeilen, nur die Aussage. Eine leere Tabelle waere ein
  // Rahmen um ein Nichts - dieselbe Regel wie beim Block "Keine Daten".
  const html = app.reportingBlockHtml({
    titel: 'E-Com · Ablehncodes', kanal: 'ECOM', typ: 'tabelle',
    kopf: [], zeilen: [],
    hinweis: 'Der Processor liefert für diesen Space keinen Response Code '
      + '(9 von 10 Fehlschlägen ohne Code).',
  });
  assert.match(html, /<h3>E-Com · Ablehncodes<\/h3>/);
  assert.match(html, /9 von 10 Fehlschlägen/);
  assert.doesNotMatch(html, /<table/);
});

test('Die „Übrige“-Zeile ueberlebt CSV und PDF - vier Ausgaben, eine Quelle', () => {
  const { app } = starte();
  const { REPORTING_GRUENDE_MAX } = app;
  // Modell von Hand: ein Grund mehr als Schwelle+1, damit die Sammelzeile
  // entsteht - die Fixture hat dafuer zu wenige Gruende.
  const dim = [];
  for (let i = 0; i < REPORTING_GRUENDE_MAX + 2; i += 1) {
    dim.push({
      spaceId: '90001', channel: 'POS', brand: 'Visa', wallet: '-', waehrung: 'CHF',
      attemptState: 'FAILED', failureReasonId: String(2000 + i), authResponseCode: 'UNKNOWN',
      issuerCountry: 'CH', cardCategory: 'CLASSIC', funding: 'DEBIT', panType: 'UNKNOWN',
      eci: 'UNKNOWN', dcc: false, tdsStarted: false, tdsCavv: false,
      terminalIdentifier: 'UNKNOWN', terminalName: 'UNKNOWN',
      attempts: 20 - i, betrag: 0, betragFailed: 100, refund: 0, tip: 0,
    });
  }
  const modell = app.buildReportingModel({ dim, time: [], conv: [] }, { merchantCountry: 'CH' });
  const csv = app.buildReportingReportCsv(modell, {});
  assert.ok(csv.includes('Übrige (2 Gründe)'), 'Sammelzeile fehlt im CSV');
  const pdf = app.reportingPdfBloecke(modell, {});
  const gruende = pdf.tabellen.find(t => /Ablehngründe$/.test(t.titel));
  assert.ok(gruende, 'K8-Abschnitt fehlt im PDF');
  assert.ok(gruende.rows.some(r => r[0] === 'Übrige (2 Gründe)'), 'Sammelzeile fehlt im PDF');
});

// --- 3DS: die trotzdem autorisierten Versuche (v5.12.1, §3.6) ---------------

// Der Kern des Fixes: die Zahl darf nicht bloss aus dem Akzeptanz-Nenner
// verschwinden, sie muss ueberall SICHTBAR sein. Genau das war der Fehler bis
// v5.12.0 - dort lief der Erfolg stumm in die Quote. Geprueft in allen vier
// Ausgaben aus einer Quelle; XLSX steht in test/reporting-xlsx.test.js, weil
// nur dort der Vendor geladen ist.
const AUTORISIERT_ZEILE = '3DS gestartet ohne CAVV, trotzdem autorisiert';
// Der Sollwert kommt aus der Fixture: 11 erfolgreiche Attempts mit
// tds_started = true und tds_cavv = false (E-Com-Visa-Zeile, siehe
// test/fixtures/generate-reporting-beispiel.mjs).
const AUTORISIERT_N = 11;

// Der Zeilentext geht als Muster in eine RegExp - er kommt aus einer Konstante
// und traegt heute kein Metazeichen, aber ein spaeteres "(§3.6)" darin waere
// sonst ein stiller Syntaxfehler statt eines fehlgeschlagenen Vergleichs.
const regexEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('«trotzdem autorisiert» steht mit der richtigen Zahl auf dem Schirm', () => {
  const { el } = mitFixture();
  const abschnitt = blockAbschnitt(el('reportingReportOutput').innerHTML, 'E-Com · 3DS-Akzeptanz');
  assert.ok(abschnitt.includes(AUTORISIERT_ZEILE), 'Zeile fehlt auf dem Schirm');
  // Als ZAEHLER, nicht als Prozentwert: die Wert-Spalte des Blocks steht auf
  // 'gemischt', das Format kommt je Zelle aus zellFormate. Ein '11.0 %' hier
  // hiesse, dass jemand am Spaltenkopf statt an reportingZellFormat() liest.
  assert.match(abschnitt, new RegExp(regexEscape(AUTORISIERT_ZEILE) + '</td><td[^>]*>' + AUTORISIERT_N + '</td>'));
  // Der Hinweis erklaert den Eimer und beide Nenner (§3.6 Punkt 3).
  assert.match(abschnitt, /kein Kryptogramm/);
  assert.match(abschnitt, /EMVCo-Felder im Analytics-Export nicht ankommen/);
  assert.match(abschnitt, /nimmt die trotzdem autorisierten Versuche aus dem Nenner/);
});

test('«trotzdem autorisiert» steht in CSV und PDF', () => {
  const { app } = mitFixture();
  const modell = app.reportingModellAktuell();
  const optionen = app.reportingExportOptionen();
  const csv = app.buildReportingReportCsv(modell, optionen);
  assert.ok(csv.includes(`${AUTORISIERT_ZEILE};${AUTORISIERT_N}`),
    'Zeile fehlt im CSV oder traegt dort ein anderes Format');
  const pdf = app.reportingPdfBloecke(modell, optionen);
  const block = pdf.tabellen.find(t => /3DS-Akzeptanz$/.test(t.titel));
  assert.ok(block, '3DS-Akzeptanz fehlt im PDF');
  const zeile = block.rows.find(r => r[0] === AUTORISIERT_ZEILE);
  assert.ok(zeile, 'Zeile fehlt im PDF');
  assert.strictEqual(zeile[1], String(AUTORISIERT_N));
});

test('Der 3DS-Status-Eimer heisst nach der Messung, nicht nach einem Ausgang', () => {
  const { app, el } = mitFixture();
  const abschnitt = blockAbschnitt(el('reportingReportOutput').innerHTML, 'E-Com · 3DS-Status');
  assert.ok(abschnitt.includes('3DS gestartet, kein CAVV'), 'neue Beschriftung fehlt');
  // Und die Gegenprobe ueber die GANZE Ausgabe: die alte Beschriftung darf
  // nirgends mehr stehen, auch nicht in einem Kuchen-Segment oder einem
  // Hinweis. Sie behauptete einen Ausgang, den die Daten nicht hergeben.
  assert.ok(!el('reportingReportOutput').innerHTML.includes('Fehlgeschlagen / abgebrochen'),
    'die widerlegte Beschriftung ist zurueck');
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

function verlaufZeile(mode) {
  const { app, el } = starte({
    wallee_query_builder_v6: JSON.stringify({ mode }),
    wallee_query_history_v1: VERLAUF(mode),
  });
  app.renderHistory();
  const zeilen = el('queryHistoryBody').children;
  assert.strictEqual(zeilen.length, 1, `Kein Verlaufseintrag im Modus ${mode}`);
  return zeilen[0].innerHTML;
}

test('Die uebrigen Modi behalten ihren Excel-Knopf', () => {
  // Gegenprobe: sonst waere der Test oben auch dann gruen, wenn der
  // Excel-Knopf ueberall verschwunden ist.
  ['brand', 'export', 'card'].forEach(mode => {
    assert.match(verlaufZeile(mode), /data-act="xlsx"/, `Modus ${mode} ohne Excel-Knopf`);
  });
});

test('Terminal und Settlement bleiben ohne Excel-Knopf', () => {
  // MODI_MIT_REPORT_PANEL ist die EINZIGE Zeile dieses Schritts, die einen
  // ausgelieferten Modus beruehrt. Ohne diese beiden Faelle koennte jemand
  // 'terminal'/'settlement' aus der Liste nehmen - der Excel-Knopf kaeme in
  // zwei fertigen Modi zurueck (echte Verhaltensaenderung), und die Suite
  // bliebe gruen: der Test darueber deckt nur 'reporting' ab, der daneben nur
  // die Modi, die den Knopf haben SOLLEN.
  ['terminal', 'settlement'].forEach(mode => {
    assert.doesNotMatch(verlaufZeile(mode), /data-act="xlsx"/,
      `Modus ${mode} darf den Excel-Knopf nicht zurueckbekommen`);
  });
});

// --- Kuchendiagramme: Geometrie und SVG (SPEC-ITERATION-2 §2.2) -------------
//
// Die Geometrie liegt bewusst in EINER reinen Funktion (kuchenSegmente), aus
// der Bildschirm UND PDF bauen. Deshalb steht sie hier neben dem SVG und nicht
// im Vendor-Test: sie braucht jsPDF nicht.

// Attribute der <path>-Elemente eines Kuchens einsammeln - dieselbe Absicht wie
// rects() weiter oben: ueber Geometrie reden, nicht ueber Zeichenketten.
function pfade(svg) {
  return [...svg.matchAll(/<path d="([^"]*)" fill="([^"]*)"><\/path>/g)]
    .map(m => ({ d: m[1], fill: m[2] }));
}
function texte(svg) {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
}
// Ein Segment, wie die Blockschicht es liefert.
const seg = (label, wert, anteil, farbe) => ({ label, wert, anteil, farbe: farbe || 'tuerkis' });

test('kuchenSegmente: die Winkel summieren auf genau 360 Grad', () => {
  const { app } = starte();
  // Bewusst Werte, deren Anteile periodisch sind (1/3, 7/13, ...): genau dort
  // liesse eine Summe gerundeter Anteile einen Haarriss im Ring.
  [[1, 1, 1], [7, 11, 13], [5], [3, 3, 3, 3, 3, 3, 3]].forEach(werte => {
    const teile = plain(app.kuchenSegmente(werte.map((w, i) => seg(`S${i}`, w, 0)), 80, 44));
    const summe = teile.reduce((a, s) => a + s.winkel, 0);
    assert.strictEqual(summe, 360, `Winkelsumme bei [${werte}]`);
    // Lueckenlos: jedes Segment faengt da an, wo das vorige aufhoert.
    teile.forEach((s, i) => {
      if (i > 0) assert.strictEqual(s.start, teile[i - 1].ende);
    });
    assert.strictEqual(teile[0].start, 0);
    assert.strictEqual(teile[teile.length - 1].ende, 360);
  });
});

test('kuchenSegmente: die vier Bogenpunkte liegen auf ihren Kreisen', () => {
  const { app } = starte();
  const r = 80;
  const rInnen = 44;
  const teile = plain(app.kuchenSegmente([seg('A', 3, 75), seg('B', 1, 25)], r, rInnen));
  const radius = p => Math.sqrt(p.x * p.x + p.y * p.y);
  teile.forEach(s => {
    // §2.2 nennt genau diese vier Punkte; alles Weitere (die Teilboegen) haengt
    // an denselben Winkeln.
    assert.ok(Math.abs(radius(s.aussenStart) - r) < 1e-9, 'aussenStart');
    assert.ok(Math.abs(radius(s.aussenEnde) - r) < 1e-9, 'aussenEnde');
    assert.ok(Math.abs(radius(s.innenStart) - rInnen) < 1e-9, 'innenStart');
    assert.ok(Math.abs(radius(s.innenEnde) - rInnen) < 1e-9, 'innenEnde');
  });
  // 0 Grad ist 12 Uhr, gezaehlt wird im Uhrzeigersinn: das erste Segment
  // beginnt oben, y zeigt nach unten.
  assert.ok(Math.abs(teile[0].aussenStart.x) < 1e-9);
  assert.strictEqual(Math.round(teile[0].aussenStart.y), -r);
});

test('kuchenSegmente teilt jeden Bogen in Stuecke von hoechstens 90 Grad', () => {
  const { app } = starte();
  const teile = plain(app.kuchenSegmente(
    [seg('gross', 11, 91.7), seg('klein', 1, 8.3)], 80, 44));
  teile.forEach(s => {
    for (let i = 1; i < s.winkelPunkte.length; i += 1) {
      assert.ok(s.winkelPunkte[i] - s.winkelPunkte[i - 1] <= 90 + 1e-9,
        'Teilbogen ueber 90 Grad - die Bezier-Naeherung des PDF wird dort ungenau');
    }
  });
  assert.strictEqual(teile[0].aussen.length, 5, '330 Grad ergeben vier Teilboegen');
  assert.strictEqual(teile[1].aussen.length, 2, '30 Grad bleiben ein Stueck');
});

test('100 % ergibt einen vollen Ring, kein zerbrochener Pfad und kein NaN', () => {
  const { app } = starte();
  const svg = app.svgKuchen([seg('Visa', 42, 100)], { groesse: 180 });
  const p = pfade(svg);
  assert.strictEqual(p.length, 1);
  assert.ok(!/NaN/.test(svg), 'kein NaN im d-Attribut');
  // Ein EINZELNER Bogen von 360 Grad haette denselben Anfangs- und Endpunkt
  // und zeichnete gar nichts - deshalb vier Teilboegen aussen und vier innen.
  assert.strictEqual((p[0].d.match(/A /g) || []).length, 8);
  assert.match(p[0].d, /^M /);
  assert.match(p[0].d, / Z$/);
  assert.deepStrictEqual(texte(svg), ['100.0 %']);
});

test('svgKuchen zeichnet ohne Segmente gar nichts', () => {
  const { app } = starte();
  // Gleiche Entscheidung wie bei svgBalken: ein leerer Ring waere ein Rahmen
  // um ein Nichts.
  assert.strictEqual(app.svgKuchen([], {}), '');
  assert.strictEqual(app.svgKuchen(null, {}), '');
  // Lauter Nullen: es gibt nichts zu verteilen, und eine Division waere NaN.
  assert.strictEqual(app.svgKuchen([seg('A', 0, 0), seg('B', 0, 0)], {}), '');
});

test('svgKuchen faerbt ausschliesslich ueber die CSS-Variablen', () => {
  const { app } = starte();
  const svg = app.svgKuchen([seg('A', 3, 75, 'orange'), seg('B', 1, 25, 'grau')], {});
  assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,8}\b/, 'kein Inline-Hex im SVG');
  assert.deepStrictEqual(pfade(svg).map(p => p.fill),
    ['var(--kuchen-2)', 'var(--kuchen-grau)']);
  // Whitelist wie bei den Balken: ein freier Farbwert kommt nicht durch,
  // sondern faellt auf Grau zurueck. Sonst waere die Hausregel "Farben nur
  // ueber :root" nur noch eine Bitte.
  const bunt = app.svgKuchen([seg('A', 1, 100, '#ff0000')], {});
  assert.doesNotMatch(bunt, /#ff0000/i);
  assert.strictEqual(pfade(bunt)[0].fill, 'var(--kuchen-grau)');
});

test('Ab 12 Grad steht die Prozentzahl im Segment, darunter nur in der Legende', () => {
  const { app } = starte();
  // 3.4 % sind 12.2 Grad (knapp drueber), 3.2 % sind 11.5 Grad (knapp drunter).
  const svg = app.svgKuchen([seg('A', 966, 96.6), seg('B', 34, 3.4)], {});
  assert.deepStrictEqual(texte(svg), ['96.6 %', '3.4 %']);
  const knapp = app.svgKuchen([seg('A', 968, 96.8), seg('B', 32, 3.2)], {});
  assert.deepStrictEqual(texte(knapp), ['96.8 %'],
    'ein Segment unter 12 Grad traegt keine Zahl - sie passt dort nicht hinein');
  // Die Flaeche bleibt trotzdem, nur die Beschriftung entfaellt.
  assert.strictEqual(pfade(knapp).length, 2);
});

test('Die Prozentzahl ist die des Modells, nicht aus dem Winkel zurueckgerechnet', () => {
  const { app } = starte();
  // Konstruierter Widerspruch: gleiche Werte (also je 180 Grad), aber Anteile
  // 90/10. Wer die Zahl aus dem Winkel herleitete, schriebe zweimal 50 % hin.
  const svg = app.svgKuchen([seg('A', 1, 90), seg('B', 1, 10)], {});
  assert.deepStrictEqual(texte(svg), ['90.0 %', '10.0 %']);
  const teile = plain(app.kuchenSegmente([seg('A', 1, 90), seg('B', 1, 10)], 80, 44));
  assert.deepStrictEqual(teile.map(s => s.winkel), [180, 180]);
});

// --- Blockschicht: 2-%-Regel und Farbvergabe -------------------------------

test('„Übrige“ entsteht erst ab zwei kleinen Segmenten und traegt deren Summe', () => {
  const { app } = starte();
  const e = (label, wert, anteil) => ({ label, wert, anteil });
  // Ein einzelnes kleines Segment behaelt seinen Namen: "Uebrige" braeuchte
  // dieselbe Zeile und sagte weniger - dieselbe Regel wie reportingUebrige().
  const eins = plain(app.reportingKuchenSegmente([e('Visa', 980, 98), e('Reka', 20, 1.5)]));
  assert.deepStrictEqual(eins.map(s => s.label), ['Visa', 'Reka']);
  // Zwei kleine: sie verschmelzen, und zwar mit der SUMME beider Werte.
  const zwei = plain(app.reportingKuchenSegmente(
    [e('Visa', 960, 96), e('Reka', 20, 1.5), e('Boncard', 20, 1.5), e('TWINT', 0, 1)]));
  assert.deepStrictEqual(zwei.map(s => s.label), ['Visa', 'Übrige']);
  assert.strictEqual(zwei[1].wert, 40);
  assert.strictEqual(Math.round(zwei[1].anteil * 10) / 10, 4);
  assert.strictEqual(zwei[1].farbe, 'grau', '„Übrige“ ist immer Grau');
});

test('Die 2-%-Regel ist nach OBEN festgenagelt: knapp drueber bleibt eigenes Segment', () => {
  // Die drei Tests daneben arbeiten mit 1.5 % und 1 %; eine Anhebung der
  // Schwelle auf 5 liesse sie alle gruen - und klappte in JEDEM Report still
  // Marken und Gruende in den grauen Wedge, ohne dass irgendwo etwas rot wird.
  // Deshalb hier die Gegenrichtung: knapp UEBER der Schwelle bleibt ein
  // Segment eigenstaendig.
  const { app } = starte();
  assert.strictEqual(app.REPORTING_KUCHEN_MIN_ANTEIL, 2);
  const e = (label, wert, anteil) => ({ label, wert, anteil });
  // 2.1 % und 2.0 % liegen drueber bzw. genau auf der Schwelle (der Vergleich
  // ist `< MIN`, die Schwelle selbst zaehlt also noch als eigenes Segment);
  // 1.9 % liegt darunter. Waere MIN groesser als 2, verschwaenden die ersten
  // beiden hier in „Übrige“ - und der Test faellt.
  const seg = plain(app.reportingKuchenSegmente([
    e('Visa', 940, 94), e('Reka', 21, 2.1), e('Boncard', 20, 2), e('TWINT', 19, 1.9),
  ]));
  assert.deepStrictEqual(seg.map(s => s.label), ['Visa', 'Reka', 'Boncard', 'TWINT'],
    'ein einzelnes kleines Segment wird ohnehin nicht eingeklappt');
  // Zweiter kleiner Eintrag: jetzt greift die Regel - aber nur fuer die beiden
  // unter der Schwelle, nicht fuer die knapp darueber.
  const seg2 = plain(app.reportingKuchenSegmente([
    e('Visa', 938, 93.8), e('Reka', 21, 2.1), e('Boncard', 20, 2),
    e('TWINT', 19, 1.9), e('Lunch Check', 2, 0.2),
  ]));
  assert.deepStrictEqual(seg2.map(s => s.label), ['Visa', 'Reka', 'Boncard', 'Übrige']);
  assert.strictEqual(seg2[3].wert, 21, 'nur TWINT und Lunch Check');
});

test('Die 2-%-Regel stellt keine zweite „Übrige“ neben eine vorhandene', () => {
  const { app } = starte();
  const e = (label, wert, anteil) => ({ label, wert, anteil });
  // Die Lage aus Referenzfall B: die Tabelle traegt ab REPORTING_GRUENDE_MAX
  // schon eine Sammelzeile "Übrige (11 Gründe)", und darunter liegen weitere
  // Zeilen unter 2 %. Wuerde die 2-%-Regel ihre eigene Sammelzeile daneben
  // stellen, stuenden zwei graue Wedges im Ring, beide "Übrige" beschriftet
  // und nicht auseinanderzuhalten.
  const seg = plain(app.reportingKuchenSegmente([
    e('3-D Secure Failure', 600, 60), e('Transaction declined', 300, 30),
    e('Card Expired', 15, 1.5), e('Life Cycle Decline', 15, 1.5),
    e('Übrige (11 Gründe)', 70, 7),
  ]));
  assert.deepStrictEqual(seg.map(s => s.label),
    ['3-D Secure Failure', 'Transaction declined', 'Übrige']);
  assert.strictEqual(seg.filter(s => s.farbe === 'grau').length, 1,
    'genau ein grauer Wedge');
  // Hineinaddiert, nicht danebengestellt: Wert und Anteil sind die Summe
  // beider, die Segmentsumme bleibt die der Tabelle.
  assert.strictEqual(seg[2].wert, 100);
  assert.strictEqual(Math.round(seg[2].anteil * 10) / 10, 10);
  assert.strictEqual(seg.reduce((a, s) => a + s.wert, 0), 1000);
  // Die Zahl im Namen faellt weg: die Zeile enthaelt jetzt 13 Gruende, nicht
  // 11 - eine Zahl, die nicht mehr stimmt, ist schlechter als keine.
  assert.doesNotMatch(seg[2].label, /\d/);
  // Gegenprobe: greift die 2-%-Regel gar nicht, bleibt die Tabellenzeile
  // samt ihrer Anzahl unangetastet.
  const ohne = plain(app.reportingKuchenSegmente([
    e('3-D Secure Failure', 600, 60), e('Transaction declined', 330, 33),
    e('Übrige (11 Gründe)', 70, 7),
  ]));
  assert.strictEqual(ohne[2].label, 'Übrige (11 Gründe)');
  assert.strictEqual(ohne[2].wert, 70);
});

test('Farben: feste Kategorien fest, offene Listen der Reihe nach, Grau extra', () => {
  const { app } = starte();
  const f = labels => plain(app.reportingKuchenFarben(labels));
  // Dieselbe Kategorie hat in jedem Report dieselbe Farbe - auch wenn sie in
  // anderer Reihenfolge dasteht (das Funding-Modell liefert Kredit vor Debit).
  assert.deepStrictEqual(f(['Debit', 'Kredit']), ['tuerkis', 'orange']);
  assert.deepStrictEqual(f(['Kredit', 'Debit']), ['orange', 'tuerkis']);
  assert.deepStrictEqual(f(['Business', 'Privat', 'Unbekannt']),
    ['tuerkis', 'orange', 'grau']);
  // Offene Liste: der Reihe nach durch die sechs Farben, absteigend nach
  // Anteil - so, wie die Bloecke ihre Zeilen liefern.
  assert.deepStrictEqual(f(['Visa', 'Mastercard', 'TWINT']),
    ['tuerkis', 'orange', 'schwarz']);
  // "Unbekannt" und "Uebrige" sind immer Grau und verbrauchen keine der sechs:
  // Mastercard bekommt Orange, nicht Schwarz.
  assert.deepStrictEqual(f(['Visa', 'Unbekannt', 'Mastercard', 'Übrige (7 Gründe)']),
    ['tuerkis', 'grau', 'orange', 'grau']);
  // Gemischt: die feste Zuordnung gewinnt, die offene Liste weicht ihr aus -
  // sonst stuenden zwei Segmente desselben Kuchens in derselben Farbe da.
  assert.deepStrictEqual(f(['Domestisch', 'Fremdes Label']), ['tuerkis', 'orange']);
  // "Unbekannt" kommt in zwei Schreibweisen vor: uebersetzt in den
  // Eimer-Bloecken, als Rohwert 'UNKNOWN' in den offenen Listen (eine Brand
  // ohne Namen). Beide meinen dasselbe und muessen gleich aussehen - sonst
  // ist derselbe Sachverhalt im Kartentyp-Kuchen grau und im
  // Zahlungsmittel-Kuchen tuerkis.
  assert.deepStrictEqual(f(['Visa', 'UNKNOWN', 'Mastercard']),
    ['tuerkis', 'grau', 'orange']);
});

// Die Farbsuche laeuft ueber den ANGEZEIGTEN TEXT (reportingKuchenFesteFarbe),
// nicht ueber den Modell-Schluessel. Ein neues Label, das wortgleich mit einem
// Katalognamen ist, faerbt damit rueckwirkend einen Kuchen eines ANDEREN
// Berichts um. Genau das ist in Iteration 2 passiert: die 3DS-Eimer
// TDS_FAILURE/TDS_TIMEOUT heissen wie die Ablehngruende 1568360440179 und
// 1568360434240, und die Farbfolge des Aggregat-K8-Kuchens verschob sich
// gegenueber v5.12.1. Die beiden Tests unten sind das, was gefehlt hat: einer
// haelt die Folge fuer genau diese Namen fest, der andere verbietet die
// Kollision fuer jedes kuenftige Label.
test('K8-Kuchen: die Ablehngruende bleiben eine offene Liste und rotieren', () => {
  const { app } = starte();
  const f = labels => plain(app.reportingKuchenFarben(labels));
  // Die Namen stehen so im K8-Block des Aggregats - aus dem eingebetteten
  // Katalog, nicht aus einem 3DS-Eimersatz.
  assert.deepStrictEqual(
    f(['3-D Secure Failure', 'Transaction declined', '3-D Secure Timeout']),
    ['tuerkis', 'orange', 'schwarz'],
    'K8 ist eine offene Liste: erste Zeile tuerkis, danach der Reihe nach');
  // Und die Reihenfolge entscheidet, nicht der Name: waere eine feste Farbe
  // hinterlegt, bliebe „3-D Secure Failure“ auch an zweiter Stelle tuerkis.
  assert.deepStrictEqual(
    f(['Transaction declined', '3-D Secure Failure']), ['tuerkis', 'orange']);
});

test('Kein festes Kuchen-Label kollidiert mit einem Katalognamen', () => {
  const { app } = starte();
  const namen = new Set(Object.values(plain(app.FAILURE_REASONS)).map(e => e[0]));
  Object.keys(plain(app.REPORTING_KUCHEN_FARBE)).forEach(k => {
    const label = app.reportingLabel(k);
    assert.strictEqual(namen.has(label), false,
      `„${label}“ (${k}) ist zugleich ein Katalogname - eine feste Farbe hier `
      + 'faerbt den Ablehngrund-Kuchen des Aggregats um');
  });
});

test('Die Farb-Whitelist fuehrt zu jedem Schluessel beide Darstellungen', () => {
  const { app } = starte();
  const farben = plain(app.SVG_KUCHEN_FARBEN);
  const reihe = plain(app.SVG_KUCHEN_REIHE);
  Object.keys(farben).forEach(k => {
    // CSS-Variable fuer den Bildschirm, Hex fuer jsPDF - an EINER Stelle.
    assert.match(farben[k].css, /^var\(--kuchen-[\w-]+\)$/, k);
    assert.match(farben[k].hex, /^#[0-9a-f]{6}$/, k);
    assert.ok(farben[k].text, `${k} ohne Textfarbe`);
  });
  // Die Vorgabe aus §2.2: sechs Farben plus Grau, keine mehr.
  assert.strictEqual(Object.keys(farben).length, 7);
  assert.strictEqual(reihe.length, 6);
  assert.strictEqual(reihe.includes('grau'), false,
    'Grau ist fuer „Unbekannt“/„Übrige“ reserviert und verbraucht keine der sechs');
  reihe.forEach(k => assert.ok(farben[k], `${k} steht nicht in der Whitelist`));
  // Und die feste Zuordnung zeigt ausschliesslich auf bekannte Schluessel.
  Object.values(plain(app.REPORTING_KUCHEN_FARBE)).forEach(k =>
    assert.ok(farben[k], `feste Zuordnung auf unbekannte Farbe ${k}`));
});

// --- Bildschirm ------------------------------------------------------------

test('Der Kuchen steht ueber der Tabelle, im selben Block', () => {
  const { el } = mitFixture();
  const html = el('reportingReportOutput').innerHTML;
  const block = blockAbschnitt(html, 'POS · Kartentyp');
  assert.ok(block.indexOf('<svg') < block.indexOf('<table'),
    'der Kuchen gehoert vor die Tabelle - wie das Balken-SVG heute');
  assert.match(block, /class="kuchen-reihe"/);
  // Legende: eine Zeile je Segment, Farbe als CSS-Variable.
  assert.strictEqual((block.match(/class="kuchen-farbe"/g) || []).length, 3);
  assert.match(block, /style="background:var\(--kuchen-1\)"/);
  assert.match(block, />Business</);
});

test('Das aria-label traegt die Legende als Text', () => {
  const { el } = mitFixture();
  const block = blockAbschnitt(el('reportingReportOutput').innerHTML, 'POS · Kartentyp');
  // Ein Ring aus Pfaden sagt einem Screenreader nichts; der Text daneben ist
  // genau die Aussage der Grafik.
  const m = block.match(/aria-label="([^"]*)"/);
  assert.ok(m, 'Kuchen ohne aria-label');
  assert.match(m[1], /^Anteil je Kartentyp: /);
  assert.match(m[1], /Business \d/);
  assert.match(m[1], /Unbekannt \d/);
});

test('Der Zahlungsmittel-Block zeigt zwei Kuchen nebeneinander', () => {
  const { el } = mitFixture();
  const block = blockAbschnitt(el('reportingReportOutput').innerHTML, 'POS · Zahlungsmittel');
  assert.strictEqual((block.match(/class="kuchen-block"/g) || []).length, 2);
  assert.match(block, /Zahlungsversuche je Zahlungsmittel/);
  // Der Betrags-Kuchen nennt seine Waehrung: ueber Waehrungen hinweg zu
  // addieren ist in diesem Modus verboten (SPEC 2.7).
  assert.match(block, /Umsatz je Zahlungsmittel \(CHF\)/);
});

test('Bloecke ohne Kuchen bleiben ohne Kuchen', () => {
  const { el } = mitFixture();
  const html = el('reportingReportOutput').innerHTML;
  ['POS · Verlauf', 'POS · Stunden', 'POS · Top-10 Länder', 'E-Com · Conversion',
    'E-Com · Wallets', 'E-Com · Ablehngründe je Brand', 'POS · Beträge je Währung',
  ].forEach(titel => {
    assert.doesNotMatch(blockAbschnitt(html, titel), /class="kuchen-reihe"/,
      `${titel} steht nicht in der Kuchen-Liste von §2.1`);
  });
  // Gegenprobe zum Balken: der Verlauf behaelt seines.
  assert.match(blockAbschnitt(html, 'POS · Verlauf'), /class="balken-block"/);
});
