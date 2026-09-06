// 3DS-Failure-Seite (Iteration 2, Task 4c): die Blockschicht und die beiden
// reinen Ausgaben CSV und PDF.
//
// reportingTdsExportBloecke ist die EINE Quelle, aus der Bildschirm, CSV,
// Excel und PDF gespeist werden - dieselbe Bauweise wie reportingExportBloecke
// beim Aggregat. Diese Datei prueft die Blockschicht (Reihenfolge, Spalten,
// Kuchen, Hinweise) und die beiden Ausgaben, die ohne DOM und ohne Vendor
// auskommen; der Bildschirm steht in test/reporting-tds-render.test.js, der
// XLSX-Pfad in test/reporting-tds-xlsx.test.js.
//
// Drei Dinge stehen im Mittelpunkt, weil sie stumm falsch sein koennen:
//
//   1. ROHWERTE. In den Bloecken stehen Betraege als 1e-8-Ganzzahlen und
//      Prozente ungerundet. Eine formatierte Zeichenkette dort waere ein
//      Fehler, den keine Ausgabe mehr rueckgaengig machen kann - ein Test
//      unten sucht deshalb gezielt nach dem Schweizer Tausenderzeichen und
//      dem Prozentzeichen in den Zellen.
//   2. Die BESCHRIFTUNGEN. reportingLabel() gibt Unbekanntes unveraendert
//      zurueck; ohne Eintrag in REPORTING_LABEL stuende "S10_60" im fertigen
//      Report, und nichts wuerde rot. Jede neue Beschriftung ist einzeln
//      festgenagelt, und ein Waechter sucht rohe Eimer-Schluessel in allen
//      Bloecken.
//   3. Die Kachel mit ABWEICHENDER Grundgesamtheit. "Anteil an Versuchen mit
//      3DS-Anforderung" zaehlt kpi.mitTdsStart, nicht kpi.failures - ohne
//      Hinweis liest sie sich wie ein Anteil der Zeile darueber.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadBuilders, plain } = require('./harness');

const B = loadBuilders();

const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'reporting-tds-beispiel.csv'), 'utf8');

// Die Zeilen kommen durch den ECHTEN Parser - wie in reporting-tds-model.
function fixtureZeilen() {
  const r = B.parseReportingTdsCsv(FIXTURE);
  assert.strictEqual(r.error, null);
  return r.rows;
}
const ZEILEN = fixtureZeilen();

// Dasselbe minimale Kanal-Modell wie in reporting-tds-model.test.js: 200
// gescheiterte Attempts gegen 300 + 100 = 400 mit angefordertem 3DS.
const AGGREGAT = {
  kpi: { fehlgeschlagen: 200 },
  tds: {
    gruppen: [
      { schluessel: 'AUTHENTICATED', attempts: 300 },
      { schluessel: 'STARTED_NO_CAVV', attempts: 100 },
      { schluessel: 'WALLET_CRYPTOGRAM', attempts: 50 },
      { schluessel: 'NOT_REQUESTED', attempts: 900 },
    ],
  },
};

function modell(optionen) {
  return B.buildReportingTdsModel(ZEILEN, optionen || {});
}
function bloecke(optionen, exportOptionen) {
  return B.reportingTdsExportBloecke(modell(optionen), exportOptionen || {});
}
function block(liste, titel) {
  const b = liste.find(x => x.titel === titel);
  assert.ok(b, `Block "${titel}" fehlt`);
  return b;
}
function zeile(b, name) {
  const z = b.zeilen.find(r => r[0] === name);
  assert.ok(z, `Zeile "${name}" fehlt im Block "${b.titel}"`);
  return z;
}
function jedeZelle(liste, fn) {
  liste.forEach(b => b.zeilen.forEach((z, r) => z.forEach((wert, c) => fn(wert, b, r, c))));
}

// --- Reihenfolge und Aufbau -------------------------------------------------

test('Blockfolge nach §3.5: Kacheln, Grund/Einordnung, Dauer, Betrag, Achsen, Balken, Liste', () => {
  assert.deepStrictEqual(plain(bloecke().map(b => b.titel)), [
    '3DS-Failures',
    'Kennzahlen',
    'Ablehngründe',
    'Einordnung',
    'Dauer bis zum Abbruch',
    'Betrag je Währung',
    'Zahlungsmittel',
    'Wallet',
    'Issuer-Land',
    'BIN (Herausgeber)',
    'PAN-Quelle',
    'ECI',
    'Attempt Retry',
    'Verlauf',
    'Stunden',
    'Transaktionen',
  ]);
});

test('Der Titelblock traegt kanal "" - daran erkennt ihn das PDF; alles andere den Seiten-Kanal', () => {
  const liste = bloecke();
  assert.strictEqual(liste[0].kanal, '');
  liste.slice(1).forEach(b => assert.strictEqual(b.kanal, B.REPORTING_TDS_KANAL,
    `Block "${b.titel}" traegt einen fremden Kanal`));
});

test('Ohne Daten: Titelblock plus EIN Hinweisblock, keine leeren Tabellen', () => {
  const leer = B.reportingTdsExportBloecke(B.buildReportingTdsModel([], {}), {});
  assert.deepStrictEqual(plain(leer.map(b => b.titel)), ['3DS-Failures', 'Keine Daten']);
  // Die eine Ausnahme von "Block ohne Grundlage entfaellt": die Abwesenheit
  // ist hier selbst die Aussage, deshalb ein Hinweisblock ohne Spalten.
  assert.deepStrictEqual(plain(leer[1].kopf), []);
  assert.deepStrictEqual(plain(leer[1].zeilen), []);
  assert.match(leer[1].hinweis, /kein Zahlungsversuch/);
});

test('Ein halbes Modell wirft nicht, sondern ergibt den leeren Bericht', () => {
  assert.deepStrictEqual(plain(B.reportingTdsExportBloecke(null, {}).map(b => b.titel)),
    ['3DS-Failures', 'Keine Daten']);
  assert.deepStrictEqual(plain(B.reportingTdsExportBloecke(undefined).map(b => b.titel)),
    ['3DS-Failures', 'Keine Daten']);
  // Ein Objekt mit kpi, aber ohne zeitraum: der erste Zugriff auf zeitraum.von
  // waere ein Wurf mitten in der Ausgabe.
  assert.deepStrictEqual(
    plain(B.reportingTdsExportBloecke({ kpi: { failures: 3 } }, {}).map(b => b.titel)),
    ['3DS-Failures', 'Keine Daten']);
});

test('Titelblock: gewaehlter und belegter Zeitraum stehen nebeneinander', () => {
  const b = block(bloecke({}, {}), '3DS-Failures');
  assert.deepStrictEqual(plain(zeile(b, 'Zeitraum (Auswahl)')), ['Zeitraum (Auswahl)', '—']);
  // Belegter Bereich der Fixture: 04.07. bis 30.07.2026, das sind 27 Tage.
  assert.deepStrictEqual(plain(zeile(b, 'Zeitraum (Daten)')),
    ['Zeitraum (Daten)', '04.07.2026 – 30.07.2026 (27 Tage)']);
  assert.deepStrictEqual(plain(zeile(b, 'Spaces')), ['Spaces', '90001, 90002']);
  assert.deepStrictEqual(plain(zeile(b, 'Währungen')), ['Währungen', 'CHF, EUR']);
});

test('Die Spaces des Pickers gehen vor denen der Daten', () => {
  const b = block(bloecke({}, { spaces: ['90001', '90002', '90003'] }), '3DS-Failures');
  // 90003 hat keine Zeile geliefert - und genau das soll man sehen: gewaehlt
  // war er trotzdem.
  assert.strictEqual(zeile(b, 'Spaces')[1], '90001, 90002, 90003');
});

// --- Kacheln ----------------------------------------------------------------

test('Kacheln: Zahlen von Hand an der Fixture', () => {
  const b = block(bloecke({ aggregat: AGGREGAT }), 'Kennzahlen');
  // 8 Zeilen auf 7 Transaktionen (7000001 hat zwei Fehlschlaege).
  assert.strictEqual(zeile(b, '3DS-Failures gesamt')[1], 8);
  assert.strictEqual(zeile(b, 'Betroffene Transaktionen')[1], 7);
  assert.strictEqual(zeile(b, 'Anteil an allen gescheiterten Versuchen')[1], (8 / 200) * 100);
  // Zaehler ist mitTdsStart (8 von 8 Fixture-Zeilen tragen einen Start).
  assert.strictEqual(zeile(b, 'Anteil an Versuchen mit 3DS-Anforderung')[1], (8 / 400) * 100);
  // Eine Transaktion mit >= 2 Versuchen, eine am Ende bezahlte (7000006,
  // FULFILL) - je 1 von 7.
  assert.strictEqual(zeile(b, 'Wiederholer (Transaktionen)')[1], (1 / 7) * 100);
  assert.strictEqual(zeile(b, 'Am Ende doch bezahlt (Transaktionen)')[1], (1 / 7) * 100);
  // Fuenf Bestellungen (ORD-1001..1003, ORD-2001, ORD-2002), davon zwei mit
  // >= 2 3DS-Fehlschlaegen, davon eine am Ende bezahlt.
  assert.strictEqual(zeile(b, 'Bestellungen')[1], 5);
  assert.strictEqual(zeile(b, 'Bestellungen mit ≥ 2 3DS-Fehlschlägen')[1], 2);
  assert.strictEqual(zeile(b, 'Mehrfach gescheiterte Bestellungen (Anteil)')[1], (2 / 5) * 100);
  assert.strictEqual(zeile(b, 'Mehrfach gescheitert und am Ende bezahlt')[1], (1 / 2) * 100);
});

test('Betroffenes Volumen: je Waehrung eine Kachel, in 1e-8-Einheiten, mit ihrer Einheit', () => {
  const b = block(bloecke(), 'Kennzahlen');
  const volumen = b.zeilen.filter(z => z[0] === 'Betroffenes Volumen');
  // CHF 129 + 129 + 54.90 + 22.50 + 78.40 = 413.80; EUR 310 + 310 + 89.95 = 709.95.
  assert.deepStrictEqual(plain(volumen), [
    ['Betroffenes Volumen', 41380000000, 'CHF'],
    ['Betroffenes Volumen', 70995000000, 'EUR'],
  ]);
});

test('Die Wert-Spalte der Kacheln steht auf dem nicht renderbaren "gemischt"', () => {
  const b = block(bloecke(), 'Kennzahlen');
  assert.strictEqual(b.kopf[1].format, 'gemischt');
  assert.strictEqual(b.typ, 'kacheln');
  // Das echte Format steht je Zelle - und zwar fuer JEDE Zeile, sonst faellt
  // eine davon auf 'gemischt' zurueck und die Ausgabe schreibt #FORMAT?.
  assert.strictEqual(b.zellFormate.length, b.zeilen.length);
  b.zeilen.forEach((z, r) => {
    const f = B.reportingZellFormat(b, r, 1);
    assert.notStrictEqual(f, 'gemischt', `Zeile "${z[0]}" hat kein eigenes Zellformat`);
  });
});

test('Die Kachel mit abweichender Grundgesamtheit benennt sie - mit beiden Zahlen', () => {
  const b = block(bloecke({ aggregat: AGGREGAT }), 'Kennzahlen');
  assert.match(b.hinweis, /ANDERE Grundgesamtheit/);
  // 8 Zeilen mit Startzeitpunkt von 400 Karten-Versuchen mit 3DS-Anforderung.
  assert.match(b.hinweis, /8 Zeilen mit gestartetem\s+3DS-Prozess von 400 Karten-Versuchen/);
  // Und ausdruecklich: NICHT die Zahl darueber.
  assert.match(b.hinweis, /nicht die 3DS-Failures insgesamt \(8\)/);
  // Der zweite Grund, warum die beiden Zahlen nicht zusammenfallen: der
  // Zaehler zaehlt jede Marke, der Nenner nur Marken mit Karten-Labels
  // (KARTEN_BRANDS). Der Anteil kann dadurch ueber 100 % steigen - ohne
  // Erklaerung liest sich das wie ein Rechenfehler.
  assert.match(b.hinweis, /über 100 % steigen/);
});

test('Der Kachel-Hinweis sagt, warum zu den Bestellungen kein Betrag steht', () => {
  // §3.8 nennt "der Betrag, der nicht verloren ist" als Ziel der Kachel. Er
  // ist aus diesen Zeilen ohne Doppelzaehlung nicht bildbar; das stand bisher
  // nur im Modell-Kommentar, also nur fuer den Leser des Quelltexts.
  const b = block(bloecke(), 'Kennzahlen');
  assert.match(b.hinweis, /kein Betrag/);
  assert.match(b.hinweis, /trägt den vollen Betrag der Bestellung erneut/);
});

test('Ohne Aggregat fehlen beide Anteils-Kacheln - und der Hinweis sagt warum', () => {
  const b = block(bloecke(), 'Kennzahlen');
  assert.strictEqual(b.zeilen.some(z => /^Anteil an /.test(String(z[0]))), false);
  assert.match(b.hinweis, /solange kein Aggregat-Ergebnis/);
});

test('Am Limit steht "mindestens" in der Ausgabe, im Block aber die rohe Zahl', () => {
  const m = B.buildReportingTdsModel([], {});
  m.hatDaten = true;
  m.abgeschnitten = true;
  m.kpi.failures = 20000;
  const liste = B.reportingTdsExportBloecke(m, {});
  const b = block(liste, 'Kennzahlen');
  const z = zeile(b, '3DS-Failures gesamt');
  // Roh: eine Zahl, kein String - CSV und Excel sollen damit rechnen koennen.
  assert.strictEqual(z[1], 20000);
  const format = B.reportingZellFormat(b, b.zeilen.indexOf(z), 1);
  assert.strictEqual(format, 'mindestens');
  // Erst die Ausgabeschicht macht daraus die Untergrenze.
  assert.strictEqual(B.reportingZellText(20000, 'mindestens'), 'mindestens 20’000');
  assert.strictEqual(B.reportingZellZahl(20000, 'mindestens'), 20000);
  // Und das Limit steht als Zahl im Hinweis - sowohl im Titelblock als auch
  // an den Kacheln, denn beide werden einzeln gelesen.
  assert.match(block(liste, '3DS-Failures').hinweis, /Höchstzahl von 20’000 Zeilen/);
  assert.match(b.hinweis, /20’000 Zeilen abgeschnitten/);
  // Und der Vorbehalt fuer die PROZENTE muss an diesem Block stehen, nicht
  // nur im Titelblock: sechs der Kacheln sind Anteile, und "Untergrenze"
  // gilt fuer sie gerade NICHT.
  assert.match(b.hinweis, /Prozentwerte/);
  assert.match(b.hinweis, /keine Untergrenzen, sondern Schätzungen/);
});

test('Am Limit ist auch die Prosa eine Untergrenze, nicht nur die Kachel', () => {
  // Der Widerspruch, den es zu vermeiden gilt: die Kachel weist "mindestens
  // 8" aus, waehrend der Hinweis darunter "die 8 Fehlschläge" schreibt - zwei
  // Aussagen ueber denselben Wert, von denen eine falsch ist. Die Nenner aus
  // dem AGGREGAT sind davon ausgenommen: die Liste ist gekappt, das Aggregat
  // nicht.
  const m = modell({ aggregat: AGGREGAT });
  m.abgeschnitten = true;
  const hinweis = block(B.reportingTdsExportBloecke(m, {}), 'Kennzahlen').hinweis;
  assert.match(hinweis, /die mindestens 8 Fehlschläge/);
  assert.match(hinweis, /mindestens 7 Transaktionen/);
  assert.match(hinweis, /nicht die 3DS-Failures insgesamt \(mindestens 8\)/);
  assert.match(hinweis, /zu den 200 gescheiterten Versuchen/,
    'der Nenner aus dem Aggregat bleibt exakt');

  // Und ohne Limit steht nirgends ein "mindestens" in dieser Prosa.
  const voll = block(bloecke({ aggregat: AGGREGAT }), 'Kennzahlen').hinweis;
  assert.match(voll, /die 8 Fehlschläge/);
  assert.doesNotMatch(voll, /mindestens/);
});

test('Am Limit nennt der Kachel-Hinweis die Anteile ans Aggregat als zu klein', () => {
  // "Anteil an allen gescheiterten Versuchen" ist gekappter Zaehler ueber
  // vollem Aggregat-Nenner - systematisch zu klein, kein Rundungsrauschen.
  // Ohne Aggregat gibt es die beiden Kacheln nicht, dann darf der Satz auch
  // nicht dastehen.
  const mitAggregat = modell({ aggregat: AGGREGAT });
  mitAggregat.abgeschnitten = true;
  assert.match(block(B.reportingTdsExportBloecke(mitAggregat, {}), 'Kennzahlen').hinweis,
    /systematisch zu klein/);

  const ohneAggregat = modell();
  ohneAggregat.abgeschnitten = true;
  assert.doesNotMatch(block(B.reportingTdsExportBloecke(ohneAggregat, {}), 'Kennzahlen').hinweis,
    /systematisch zu klein/);
});

test('Sind alle Zeitstempel unlesbar, nennt der Kachel-Block die verlorenen Zeilen', () => {
  // Der Fall, den die Bloecke Verlauf und Stunden selbst nicht melden koennen:
  // sie entstehen nur mit Daten. Ist JEDES created_on unlesbar, entfallen
  // beide - und ohne diesen Nachtrag stuende die Zahl der nicht
  // einsortierbaren Zeilen nirgends. Der Bericht saehe vollstaendig aus.
  // Hier mit der echten Fixture nachgestellt: dieselben acht Zeilen, das
  // Datum in einer Schreibweise, die der Parser nicht deutet.
  const kaputt = FIXTURE.replace(
    /"(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})\.000"/g, '"$3/$2/$1 $4"');
  const r = B.parseReportingTdsCsv(kaputt);
  assert.strictEqual(r.error, null);
  const m = B.buildReportingTdsModel(r.rows, {});
  // Vorbedingung: acht Zeilen sind da, aber keine einzige hat einen Tag.
  assert.strictEqual(m.kpi.failures, 8);
  assert.strictEqual(m.kpi.ohneTag, 8);
  assert.strictEqual(m.kpi.ohneStunde, 8);

  const liste = B.reportingTdsExportBloecke(m, {});
  const titel = liste.map(b => b.titel);
  assert.strictEqual(titel.includes('Verlauf'), false);
  assert.strictEqual(titel.includes('Stunden'), false);
  // Und trotzdem steht die Zahl in der Ausgabe - im Kachel-Block, bei den
  // uebrigen Verlustkanaelen.
  const hinweis = block(liste, 'Kennzahlen').hinweis;
  assert.match(hinweis, /8 Zeilen ohne brauchbares Datum/);
  assert.match(hinweis, /8 Zeilen ohne brauchbare Stunde/);
});

test('Ohne Limit-Treffer bleibt es beim gewoehnlichen Zaehler-Format', () => {
  const b = block(bloecke(), 'Kennzahlen');
  assert.strictEqual(B.reportingZellFormat(b, 0, 1), 'zahl');
  assert.doesNotMatch(b.hinweis, /mindestens/);
});

test('Die drei Verlust-Zaehler stehen einzeln im Hinweis, nie als eine Zahl', () => {
  const m = modell();
  m.kpi.ohneTransaktion = 3;
  m.bestellungen.ohneBestellnummer = 4;
  m.bestellungen.ohneBestellzaehler = 5;
  const b = block(B.reportingTdsExportBloecke(m, {}), 'Kennzahlen');
  assert.match(b.hinweis, /3 Zeilen ohne Transaktions-ID/);
  assert.match(b.hinweis, /4 Zeilen tragen keine Bestellnummer/);
  // "ohne Bestellnummer" und "mit Nummer, ohne Zaehler" sind verschiedene
  // Aussagen - eine gemeinsame Beschriftung widerspraeche einer der beiden.
  assert.match(b.hinweis, /5 Zeilen tragen eine Bestellnummer, aber keine Bestell-Zähler/);
});

// --- Beschriftungen ---------------------------------------------------------

test('Jede neue Eimer-Beschriftung ist in REPORTING_LABEL eingetragen', () => {
  // reportingLabel() gibt Unbekanntes UNVERAENDERT zurueck - ein fehlender
  // Eintrag faellt nirgends auf, er landet als roher Schluessel im Report.
  assert.deepStrictEqual(plain({
    TDS_FAILURE: B.reportingLabel('TDS_FAILURE'),
    TDS_TIMEOUT: B.reportingLabel('TDS_TIMEOUT'),
    ANDERER_GRUND: B.reportingLabel('ANDERER_GRUND'),
    UNTER_10S: B.reportingLabel('UNTER_10S'),
    S10_60: B.reportingLabel('S10_60'),
    MIN1_5: B.reportingLabel('MIN1_5'),
    UEBER_5MIN: B.reportingLabel('UEBER_5MIN'),
    UNTER_50: B.reportingLabel('UNTER_50'),
    B50_200: B.reportingLabel('B50_200'),
    B200_500: B.reportingLabel('B200_500'),
    UEBER_500: B.reportingLabel('UEBER_500'),
    UNBEKANNT: B.reportingLabel('UNBEKANNT'),
  }), {
    TDS_FAILURE: '3-D Secure Failure',
    TDS_TIMEOUT: '3-D Secure Timeout',
    ANDERER_GRUND: 'Anderer Grund, 3DS abgebrochen',
    UNTER_10S: '< 10 s',
    S10_60: '10–60 s',
    MIN1_5: '1–5 min',
    UEBER_5MIN: '> 5 min',
    UNTER_50: '< 50',
    B50_200: '50–200',
    B200_500: '200–500',
    UEBER_500: '> 500',
    UNBEKANNT: 'Unbekannt',
  });
});

test('"Kein Wallet" und "Unbekannt" sind zwei verschiedene Aussagen', () => {
  // Der Wert '-' ist der COALESCE-Ersatz der Query fuer "kein Wallet" und
  // damit eine MESSUNG; UNKNOWN heisst "kein Wert". Zwei Eimer, zwei Namen -
  // gleich beschriftet nebeneinander laesen sie sich wie ein Fehler.
  assert.strictEqual(B.reportingLabel('-'), 'Kein Wallet');
  assert.strictEqual(B.reportingLabel(B.REPORTING_UNBEKANNT), 'Unbekannt');
  assert.notStrictEqual(B.reportingLabel('-'), B.reportingLabel(B.REPORTING_UNBEKANNT));
});

test('Der Wallet-Hinweis nennt die andere Grundgesamtheit des Aggregat-Blocks', () => {
  // Dieselbe Achse bedeutet in den zwei Panels desselben Modus Verschiedenes:
  // das Aggregat wirft '-' und UNKNOWN weg (es misst "wie viel laeuft ueber
  // ein Wallet"), diese Liste fuehrt beide als eigene Eimer. Beides ist
  // begruendet - aber ohne den Halbsatz haelt der Leser die Differenz zwischen
  // den zwei Tabellen fuer einen Fehler.
  const h = block(bloecke(), 'Wallet').hinweis;
  assert.match(h, /Anders als der Wallet-Block des Reporting-Reports/);
  assert.match(h, /nur Versuche MIT Wallet/);
  // Und ohne Ortsangabe: der Hinweis steht auch im eigenen PDF und in der
  // eigenen Excel-Mappe, wo der Reporting-Report nicht danebensteht.
  assert.doesNotMatch(h, /darüber/);
});

test('Kein Block traegt einen rohen Eimer-Schluessel', () => {
  const schluessel = []
    .concat(B.REPORTING_TDS_GRUENDE, B.REPORTING_TDS_DAUER, B.REPORTING_TDS_BETRAG, ['-'])
    // UNKNOWN steht in den offenen Listen als Rohwert im Modell und wird in
    // der Blockschicht uebersetzt - deshalb gehoert es mit in die Sperrliste.
    .concat([B.REPORTING_UNBEKANNT]);
  jedeZelle(bloecke({ aggregat: AGGREGAT }), (wert, b, r, c) => {
    if (typeof wert !== 'string') return;
    assert.strictEqual(schluessel.indexOf(wert), -1,
      `Roher Schluessel "${wert}" in Block "${b.titel}", Zeile ${r}, Spalte ${c}`);
  });
});

// --- Rohwerte ---------------------------------------------------------------

test('In den Bloecken stehen Rohwerte - keine formatierte Zeichenkette', () => {
  jedeZelle(bloecke({ aggregat: AGGREGAT }), (wert, b, r, c) => {
    if (typeof wert !== 'string') return;
    // Das Schweizer Tausenderzeichen und ein angehaengtes Prozentzeichen sind
    // die beiden Spuren, die eine in der Blockschicht formatierte Zahl
    // hinterliesse. Beides gehoert ausschliesslich in die Ausgabe.
    assert.doesNotMatch(wert, /\d’\d/, `formatierte Zahl in "${b.titel}" [${r}][${c}]: ${wert}`);
    assert.doesNotMatch(wert, /^-?[\d.]+ %$/, `Prozent-String in "${b.titel}" [${r}][${c}]`);
  });
});

test('Betraege bleiben 1e-8-Einheiten, Prozente ungerundet', () => {
  const liste = bloecke();
  // 78.40 CHF der Zeile ORD-1003 - als Ganzzahl, nicht als 78.4.
  const tx = block(liste, 'Transaktionen');
  const betragSpalte = tx.kopf.findIndex(k => k.label === 'Betrag');
  assert.ok(tx.zeilen.some(z => z[betragSpalte] === 7840000000));
  // EUR-Betragsklassen: 1 von 3 und 2 von 3 - in voller Genauigkeit.
  const betrag = block(liste, 'Betrag je Währung');
  assert.ok(betrag.zeilen.some(z => z[3] === (1 / 3) * 100));
  assert.ok(betrag.zeilen.some(z => z[3] === (2 / 3) * 100));
});

// --- Feste Eimersaetze gegen offene Listen -----------------------------------

test('Einordnung: drei feste Eimer plus Total, auch der leere bleibt stehen', () => {
  const b = block(bloecke(), 'Einordnung');
  // 5x 3-D Secure Failure, 2x Timeout, 1x anderer Grund (ID 1460695272591).
  assert.deepStrictEqual(plain(b.zeilen), [
    ['3-D Secure Failure', 5, 62.5],
    ['3-D Secure Timeout', 2, 25],
    ['Anderer Grund, 3DS abgebrochen', 1, 12.5],
    [B.REPORTING_TOTAL_ZEILE, 8, 100],
  ]);
});

test('Dauer: fuenf feste Eimer, der leere mit 0 - dass es keinen gab, ist die Aussage', () => {
  const b = block(bloecke(), 'Dauer bis zum Abbruch');
  // 3 s / 21 s / 26 s / 46 s / 46 s / 17 s / 341 s / ohne Ende.
  assert.deepStrictEqual(plain(b.zeilen), [
    ['< 10 s', 1, 12.5],
    ['10–60 s', 5, 62.5],
    ['1–5 min', 0, 0],
    ['> 5 min', 1, 12.5],
    ['Unbekannt', 1, 12.5],
    [B.REPORTING_TOTAL_ZEILE, 8, 100],
  ]);
});

test('Der Dauer-Hinweis sagt, was er ersetzt und warum', () => {
  const b = block(bloecke(), 'Dauer bis zum Abbruch');
  assert.match(b.hinweis, /ERSETZT/);
  assert.match(b.hinweis, /EMVCo/);
  assert.match(b.hinweis, /2026-09-04/);
  assert.match(b.hinweis, /sofort abgebrochen/);
  assert.match(b.hinweis, /Timeout/);
});

test('Betrag je Waehrung: je Waehrung ein eigener Satz, nie eine Zeile darueber hinweg', () => {
  const b = block(bloecke(), 'Betrag je Währung');
  // CHF: 22.50 unter 50, die uebrigen vier in 50-200. EUR: 89.95 in 50-200,
  // 2x 310 in 200-500. Die Waehrung steht nur in der ersten Zeile ihrer
  // Gruppe - leer heisst "gehoert zur Zeile darueber".
  assert.deepStrictEqual(plain(b.zeilen), [
    ['CHF', '< 50', 1, 20],
    ['', '50–200', 4, 80],
    ['', '200–500', 0, 0],
    ['', '> 500', 0, 0],
    ['', 'Unbekannt', 0, 0],
    ['', B.REPORTING_TOTAL_ZEILE, 5, 100],
    ['EUR', '< 50', 0, 0],
    ['', '50–200', 1, (1 / 3) * 100],
    ['', '200–500', 2, (2 / 3) * 100],
    ['', '> 500', 0, 0],
    ['', 'Unbekannt', 0, 0],
    ['', B.REPORTING_TOTAL_ZEILE, 3, 100],
  ]);
  // Es gibt keine Zeile ueber beide Waehrungen - die Summe 8 taucht nirgends auf.
  assert.strictEqual(b.zeilen.some(z => z[2] === 8), false);
});

test('Eine offene Liste ohne Aussage entfaellt, der feste Eimersatz nie', () => {
  // Alle Label-Achsen auf UNKNOWN: die offenen Listen verschwinden, Einordnung
  // und Dauer stehen weiter da.
  const m = modell();
  const feld = { brands: 'brand', wallets: 'wallet', laender: 'land', bins: 'bin',
    panTypes: 'panType', eci: 'eci', retry: 'attemptRetry' };
  Object.keys(feld).forEach(name => {
    m[name] = [{ [feld[name]]: B.REPORTING_UNBEKANNT, anzahl: 8, anteil: 100 }];
  });
  const titel = plain(B.reportingTdsExportBloecke(m, {}).map(b => b.titel));
  ['Zahlungsmittel', 'Wallet', 'Issuer-Land', 'BIN (Herausgeber)', 'PAN-Quelle', 'ECI',
    'Attempt Retry']
    .forEach(t => assert.strictEqual(titel.indexOf(t), -1, `"${t}" sagt nichts und muss entfallen`));
  ['Einordnung', 'Dauer bis zum Abbruch', 'Betrag je Währung']
    .forEach(t => assert.notStrictEqual(titel.indexOf(t), -1, `"${t}" ist fest und muss bleiben`));
});

// --- Offene Listen: Kuerzen --------------------------------------------------

test('Ablehngruende: vollstaendig mit Sammelzeile, die Anteile gehen auf 100 % auf', () => {
  // 14 Gruende: die ersten zwoelf einzeln (REPORTING_GRUENDE_MAX), die
  // restlichen zwei als "Uebrige (2 Gruende)". Der Zaehler heisst im
  // 3DS-Modell anzahl, nicht attempts - reportingUebrige liest das Feld.
  const m = modell();
  m.gruende = Array.from({ length: 14 }, (_, i) => ({
    id: String(1000 + i), anzahl: 20 - i, anteil: ((20 - i) / 189) * 100,
    name: `Grund ${i}`, einordnung: 'ANDERER_GRUND',
  }));
  m.kpi.failures = 189;               // 20 + 19 + ... + 7 = (7 + 20) * 14 / 2
  const b = block(B.reportingTdsExportBloecke(m, {}), 'Ablehngründe');
  assert.strictEqual(b.zeilen.length, 13);
  const letzte = b.zeilen[12];
  assert.strictEqual(letzte[0], 'Übrige (2 Gründe)');
  // 8 + 7 = 15 der 189 Fehlschlaege.
  assert.strictEqual(letzte[2], 15);
  assert.strictEqual(letzte[3], (15 / 189) * 100);
  // Die Spalte summiert auf die Gesamtzahl.
  assert.strictEqual(b.zeilen.reduce((a, z) => a + z[2], 0), 189);
});

test('Bei genau einem uebrigen Grund entsteht keine Sammelzeile', () => {
  const m = modell();
  m.gruende = Array.from({ length: 13 }, (_, i) => ({
    id: String(1000 + i), anzahl: 1, anteil: 100 / 13, name: `Grund ${i}`,
    einordnung: 'ANDERER_GRUND',
  }));
  m.kpi.failures = 13;
  const b = block(B.reportingTdsExportBloecke(m, {}), 'Ablehngründe');
  // "Uebrige (1 Grund)" braucht dieselbe Zeile wie der Grund selbst.
  assert.strictEqual(b.zeilen.length, 13);
  assert.strictEqual(b.zeilen.some(z => /^Übrige/.test(String(z[0]))), false);
});

test('Laender und BIN werden auf Top-10 gekuerzt, mit Fussnote', () => {
  const m = modell();
  m.laender = Array.from({ length: 12 }, (_, i) => ({ land: `L${i}`, anzahl: 12 - i, anteil: 1 }));
  m.bins = Array.from({ length: 15 }, (_, i) => ({ bin: `4242${i}`, anzahl: 15 - i, anteil: 1 }));
  const liste = B.reportingTdsExportBloecke(m, {});
  const land = block(liste, 'Issuer-Land');
  assert.strictEqual(land.zeilen.length, 10);
  assert.match(land.hinweis, /2 weitere Einträge sind nicht dargestellt/);
  const bin = block(liste, 'BIN (Herausgeber)');
  assert.strictEqual(bin.zeilen.length, 10);
  assert.match(bin.hinweis, /5 weitere Einträge sind nicht dargestellt/);
});

test('Der BIN-Block sagt, dass er den Herausgeber und nicht die Karte meint', () => {
  const b = block(bloecke(), 'BIN (Herausgeber)');
  assert.match(b.hinweis, /HERAUSGEBER/);
  assert.match(b.hinweis, /Herausgebernamen führt wallee nirgends/);
  assert.match(b.hinweis, /BIN-Tabelle/);
});

test('Attempt Retry ist als GEMESSENE Empfehlung des Schemes gekennzeichnet', () => {
  const b = block(bloecke(), 'Attempt Retry');
  assert.match(b.hinweis, /MITGELIEFERTE/);
  // Und ausdruecklich von der kuratierten Empfehlung des Aggregats getrennt -
  // schon im Spaltennamen, damit es nicht allein am Hinweis haengt.
  assert.match(b.hinweis, /nicht die kuratierte Empfehlung/);
  assert.strictEqual(b.kopf[0].label, 'Empfehlung des Schemes');
});

// --- Kuchen ------------------------------------------------------------------

test('Kuchen bekommen genau die fuenf vorgesehenen Bloecke', () => {
  const mit = bloecke().filter(b => b.kuchen).map(b => b.titel);
  assert.deepStrictEqual(plain(mit),
    ['Ablehngründe', 'Einordnung', 'Dauer bis zum Abbruch', 'Zahlungsmittel', 'PAN-Quelle']);
});

test('Die Gegenliste traegt kein kuchen-Feld', () => {
  const ohne = ['3DS-Failures', 'Kennzahlen', 'Betrag je Währung', 'Wallet', 'Issuer-Land',
    'BIN (Herausgeber)', 'ECI', 'Attempt Retry', 'Verlauf', 'Stunden', 'Transaktionen'];
  const liste = bloecke();
  ohne.forEach(t => {
    const b = block(liste, t);
    // Das Feld fehlt ganz - ein leeres Array muesste jede Ausgabe erst pruefen.
    assert.strictEqual(Object.prototype.hasOwnProperty.call(b, 'kuchen'), false,
      `Block "${t}" traegt einen Kuchen`);
  });
});

test('Die Segmente eines Kuchens sind die Zeilen seiner Tabelle - ohne Total', () => {
  const b = block(bloecke(), 'Dauer bis zum Abbruch');
  const k = b.kuchen[0];
  // Der leere Eimer "1-5 min" (0 Versuche) ergibt kein Segment - ein Segment
  // mit 0 Grad ist nicht zu sehen und verlaengert nur die Legende. Die
  // Total-Zeile ist die Summe, nicht ein Segment.
  assert.deepStrictEqual(plain(k.segmente.map(s => [s.label, s.wert])), [
    ['< 10 s', 1], ['10–60 s', 5], ['> 5 min', 1], ['Unbekannt', 1],
  ]);
  assert.strictEqual(k.segmente.reduce((a, s) => a + s.wert, 0), 8);
});

test('"Unbekannt" ist grau, die festen Eimer tragen ihre feste Farbe', () => {
  const b = block(bloecke(), 'Dauer bis zum Abbruch');
  const farbe = label => b.kuchen[0].segmente.find(s => s.label === label).farbe;
  assert.strictEqual(farbe('Unbekannt'), 'grau');
  assert.strictEqual(farbe('< 10 s'), B.REPORTING_KUCHEN_FARBE.UNTER_10S);
  assert.strictEqual(farbe('10–60 s'), B.REPORTING_KUCHEN_FARBE.S10_60);
  // Jede Farbe kommt aus der Whitelist, keine ist frei gesetzt.
  b.kuchen[0].segmente.forEach(s => assert.ok(B.SVG_KUCHEN_FARBEN[s.farbe],
    `Farbe "${s.farbe}" steht nicht in SVG_KUCHEN_FARBEN`));
});

test('Segmente unter 2 % klappen in der Blockschicht zu "Uebrige"', () => {
  const m = modell();
  m.kpi.failures = 1000;
  m.brands = [
    { brand: 'Visa', anzahl: 960, anteil: 96 },
    { brand: 'Mastercard', anzahl: 20, anteil: 2 },     // genau 2 % bleibt stehen
    { brand: 'Amex', anzahl: 10, anteil: 1 },
    { brand: 'Diners', anzahl: 10, anteil: 1 },
  ];
  const b = block(B.reportingTdsExportBloecke(m, {}), 'Zahlungsmittel');
  assert.deepStrictEqual(plain(b.kuchen[0].segmente.map(s => [s.label, s.wert, s.anteil])), [
    ['Visa', 960, 96], ['Mastercard', 20, 2], ['Übrige', 20, 2],
  ]);
  // Die Tabelle bleibt vollstaendig - eingeklappt wird nur der Kuchen.
  assert.strictEqual(b.zeilen.length, 4);
});

test('Ein EINZELNES kleines Segment wird nicht eingeklappt', () => {
  const m = modell();
  m.kpi.failures = 1000;
  m.brands = [
    { brand: 'Visa', anzahl: 990, anteil: 99 },
    { brand: 'Amex', anzahl: 10, anteil: 1 },
  ];
  const b = block(B.reportingTdsExportBloecke(m, {}), 'Zahlungsmittel');
  // "Uebrige" braeuchte dieselbe Zeile wie der Eintrag und sagte weniger.
  assert.deepStrictEqual(plain(b.kuchen[0].segmente.map(s => s.label)), ['Visa', 'Amex']);
});

// --- Zeilentabelle -----------------------------------------------------------

test('Zeilentabelle: die Spalten aus §3.5, Waehrung vor dem Betrag', () => {
  const b = block(bloecke(), 'Transaktionen');
  assert.deepStrictEqual(plain(b.kopf.map(k => k.label)), [
    'Datum', 'Transaktion', 'Referenz', 'Brand', 'Wallet', 'Währung', 'Betrag', 'Grund',
    'Dauer (s)', 'Versuch', 'Endstand Tx', 'Issuer-Land', B.REPORTING_TDS_LINK_TEXT,
  ]);
  // Die Waehrung steht nicht in der Aufzaehlung von §3.5 und ist trotzdem da:
  // eine Betragszahl ohne ihre Einheit ist keine Aussage, und diese Liste
  // traegt Zeilen mehrerer Waehrungen.
  assert.strictEqual(b.kopf[6].format, 'betrag');
  assert.strictEqual(b.kopf[12].format, 'link');
});

test('Zeilentabelle: neueste zuerst, mit den abgeleiteten Feldern des Modells', () => {
  const b = block(bloecke(), 'Transaktionen');
  assert.strictEqual(b.zeilen.length, 8);
  // Juengste Zeile der Fixture: 30.07. 14:05, ORD-1003, 78.40 CHF, 17 s.
  assert.deepStrictEqual(plain(b.zeilen[0]), [
    '2026-07-30 14:05:09.000', '7000007', 'ORD-1003', 'Visa', 'Kein Wallet', 'CHF',
    7840000000, '3-D Secure Failure', 17, '1/1', 'FAILED', 'CH',
    'https://app-wallee.com/s/90001/payment/transaction/view/7000007',
  ]);
});

test('Eine Zeile ohne Dauer traegt null - "keine Messung", nicht 0', () => {
  const b = block(bloecke(), 'Transaktionen');
  // Zeile 8000004 (Transaktion 7000003) hat keinen Endzeitpunkt.
  const z = b.zeilen.find(r => r[1] === '7000003');
  assert.strictEqual(z[8], null);
  // Die Ausgabe macht daraus den Strich, nicht die 0.
  assert.strictEqual(B.reportingZellText(null, 'zahl'), '—');
});

// --- Der Link ----------------------------------------------------------------

test('reportingLinkZiel nimmt nur Adressen, die tdsDashboardUrl gebaut hat', () => {
  const echt = B.tdsDashboardUrl('90001', '7000001');
  assert.strictEqual(B.reportingLinkZiel(echt), echt);
  assert.strictEqual(B.reportingLinkZiel(''), '');
  assert.strictEqual(B.reportingLinkZiel(null), '');
  // Alles, was nicht mit dem geprueften Praefix beginnt, wird kein Link -
  // das ist die zweite Naht gegen ein href aus fremdem Text.
  assert.strictEqual(B.reportingLinkZiel('javascript:alert(1)'), '');
  assert.strictEqual(B.reportingLinkZiel('https://example.com/s/1/payment'), '');
  assert.strictEqual(B.reportingLinkZiel(' https://app-wallee.com/s/1'), '');
});

test('Die Link-Spalte heisst in CSV und Excel dashboard_url, auf dem Bildschirm Öffnen', () => {
  const spalte = { label: B.REPORTING_TDS_LINK_TEXT, format: 'link' };
  assert.strictEqual(B.reportingKopfLabel(spalte, true), 'dashboard_url');
  assert.strictEqual(B.reportingKopfLabel(spalte, false), 'Öffnen');
  // Fuer jede andere Spalte gilt der Name des Blocks, in beiden Richtungen.
  const text = { label: 'Brand', format: 'text' };
  assert.strictEqual(B.reportingKopfLabel(text, true), 'Brand');
  assert.strictEqual(B.reportingKopfLabel(text, false), 'Brand');
  // Die Nachschlagetabelle wird ueber hasOwnProperty gelesen, wie
  // reportingLabel und reportingFailureEintrag daneben: eine blosse
  // Property-Lesung faende die geerbten Namen des Prototyps, und eine Spalte
  // mit dem Format 'toString' bekaeme eine FUNKTION als Spaltenkopf.
  ['toString', 'constructor', 'valueOf', '__proto__'].forEach(format => {
    const erbe = { label: 'Geerbt', format };
    assert.strictEqual(B.reportingKopfLabel(erbe, true), 'Geerbt', `Format "${format}"`);
  });
  // Und eine Spalte ganz ohne Format bleibt ebenfalls bei ihrem Namen.
  assert.strictEqual(B.reportingKopfLabel({ label: 'Ohne' }, true), 'Ohne');
});

// --- CSV ---------------------------------------------------------------------

function csvZeilen(optionen) {
  return B.buildReportingTdsCsv(modell(optionen), {}).split('\r\n');
}

test('CSV: Blocktitel, Spaltenkopf, Zeilen, Hinweis - mit BOM', () => {
  const csv = B.buildReportingTdsCsv(modell(), {});
  assert.ok(csv.startsWith('﻿'));
  const z = csv.split('\r\n');
  assert.strictEqual(z[0], '﻿3DS-Failures');
  assert.strictEqual(z[1], 'Angabe;Wert');
});

test('CSV: die Link-Spalte heisst dashboard_url und traegt die Adresse', () => {
  const z = csvZeilen();
  const kopf = z.find(l => l.indexOf('dashboard_url') !== -1);
  assert.ok(kopf, 'Spaltenkopf dashboard_url fehlt');
  assert.ok(kopf.endsWith(';dashboard_url'));
  assert.ok(z.some(l => l.indexOf(
    ';https://app-wallee.com/s/90001/payment/transaction/view/7000007') !== -1));
});

test('CSV: Zahlen bleiben Zahlen, Prozente auf eine Nachkommastelle gerundet', () => {
  const z = csvZeilen();
  // 78.40 CHF steht als 78.4, nicht als 1e-8-Einheit und nicht als "78.40 CHF".
  assert.ok(z.some(l => l.indexOf(';78.4;') !== -1));
  // 1/3 -> 33.3: gerundet wird auch hier, damit alle vier Ausgaben dieselbe
  // Zahl zeigen.
  assert.ok(z.some(l => l === 'EUR;< 50;0;0'));
  assert.ok(z.some(l => l === ';50–200;1;33.3'));
});

// --- PDF ---------------------------------------------------------------------

test('PDF: Titelblock wird Dokumentkopf, seine Prosa ein Abschnitt "Grundlagen"', () => {
  const p = B.reportingTdsPdfBloecke(modell(), {});
  assert.match(p.titel, /3DS-FAILURES/);
  assert.strictEqual(p.kopfzeilen[0], 'Bericht: Gescheiterte Zahlungsversuche mit 3-D Secure');
  assert.strictEqual(p.tabellen[0].titel, 'Grundlagen');
  assert.strictEqual(p.tabellen[0].nurHinweis, true);
  // Der erste Sachabschnitt beginnt auf einer frischen Seite.
  assert.strictEqual(p.tabellen[1].titel, 'Kennzahlen');
  assert.strictEqual(p.tabellen[1].seitenumbruchDavor, true);
  assert.strictEqual(p.tabellen[2].seitenumbruchDavor, false);
});

test('PDF: die Zellen sind FERTIGE Strings, mit dem Format ihrer Zelle', () => {
  const p = B.reportingTdsPdfBloecke(modell({ aggregat: AGGREGAT }), {});
  const kennzahlen = p.tabellen.find(t => t.titel === 'Kennzahlen');
  // Der Kachel-Block mischt Zaehler, Prozente und Betraege in EINER Spalte -
  // wer reportingZellFormat() vergisst, schreibt hier 41380000000 hin.
  assert.deepStrictEqual(plain(kennzahlen.rows[0]), ['3DS-Failures gesamt', '8', '']);
  assert.ok(kennzahlen.rows.some(r => r[0] === 'Betroffenes Volumen' && r[1] === '413.80'));
  assert.ok(kennzahlen.rows.some(r => r[0] === 'Wiederholer (Transaktionen)' && r[1] === '14.3 %'));
});

test('PDF: die Link-Spalte fehlt, und der Hinweis sagt wo sie steht', () => {
  const p = B.reportingTdsPdfBloecke(modell(), {});
  const tx = p.tabellen.find(t => t.titel === 'Transaktionen');
  assert.strictEqual(tx.header.indexOf(B.REPORTING_TDS_LINK_TEXT), -1);
  assert.strictEqual(tx.header.indexOf('dashboard_url'), -1);
  assert.strictEqual(tx.header.length, 12);
  tx.rows.forEach(r => {
    assert.strictEqual(r.length, 12);
    assert.strictEqual(r.some(zelle => String(zelle).indexOf('app-wallee.com') !== -1), false);
  });
  assert.match(tx.hinweis, /nicht im PDF/);
  // Die Ausrichtung wird mitgekuerzt, sonst lage sie um eine Spalte daneben.
  assert.strictEqual(tx.ausrichtung.length, 12);
});

test('PDF: die Zeilentabelle bricht bei der Konstante ab und sagt es', () => {
  const m = modell();
  const eine = m.zeilen[0];
  // Eine Zeile mehr als der Deckel erlaubt.
  m.zeilen = Array.from({ length: B.REPORTING_TDS_PDF_ZEILEN + 1 }, () => eine);
  const p = B.reportingTdsPdfBloecke(m, {});
  const tx = p.tabellen.find(t => t.titel === 'Transaktionen');
  assert.strictEqual(tx.rows.length, B.REPORTING_TDS_PDF_ZEILEN);
  assert.match(tx.hinweis, /ersten 500 von 501 Zeilen/);
  assert.match(tx.hinweis, /Vollständige Liste im Excel\/CSV/);
});

test('PDF: genau am Deckel wird nichts gekuerzt und nichts behauptet', () => {
  const m = modell();
  const eine = m.zeilen[0];
  m.zeilen = Array.from({ length: B.REPORTING_TDS_PDF_ZEILEN }, () => eine);
  const tx = B.reportingTdsPdfBloecke(m, {}).tabellen.find(t => t.titel === 'Transaktionen');
  assert.strictEqual(tx.rows.length, B.REPORTING_TDS_PDF_ZEILEN);
  assert.doesNotMatch(tx.hinweis, /Vollständige Liste/);
});

test('PDF: die Kuchen werden durchgereicht, die uebrigen Bloecke tragen null', () => {
  const p = B.reportingTdsPdfBloecke(modell(), {});
  const mit = p.tabellen.filter(t => t.kuchen).map(t => t.titel);
  assert.deepStrictEqual(plain(mit),
    ['Ablehngründe', 'Einordnung', 'Dauer bis zum Abbruch', 'Zahlungsmittel', 'PAN-Quelle']);
});
