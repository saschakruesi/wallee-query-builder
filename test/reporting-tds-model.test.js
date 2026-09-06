// 3DS-Failure-Seite (Iteration 2, Task 4b): das Modell.
//
// Grundlage ist die Fixture aus 4a - acht Zeilen, jede fuer einen fachlich
// interessanten Fall. Alle Erwartungswerte hier sind AN DER FIXTURE VON HAND
// gerechnet und stehen mit ihrer Rechnung im Kommentar; aus der Implementierung
// abgeschrieben ist keiner. Ein Test, der nur wiederholt, was der Code tut,
// haelt jede Aenderung fuer richtig.
//
// Zwei Dinge stehen im Mittelpunkt, weil sie stumm falsch sein koennen:
//
//   1. Die beiden Bestell-Zaehler. Die Kachel "Bestellungen mit >= 2
//      3DS-Fehlschlaegen" rechnet gegen tdsFehlschlaegeDerBestellung. Gegen
//      versucheDerBestellung gerechnet zaehlte sie eine Bestellung mit, die
//      nach einem einzigen Fehlschlag erfolgreich war - in dem Space, fuer den
//      die Seite gedacht ist, waere das der Regelfall. Die Fixture enthaelt
//      genau diesen Fall (ORD-1003: versuche = 2, Fehlschlaege = 1), und die
//      beiden Zahlen unterscheiden sich dadurch.
//
//   2. Die Zaehleinheit. "Am Ende doch bezahlt" und der Wiederholer-Anteil
//      zaehlen TRANSAKTIONEN, nicht Zeilen; die Fixture traegt eine Transaktion
//      mit zwei Fehlschlaegen, an der sich der Unterschied zeigt (8 Zeilen,
//      aber 7 Transaktionen).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadBuilders, plain } = require('./harness');

const B = loadBuilders();

const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'reporting-tds-beispiel.csv'), 'utf8');

// Die Zeilen kommen durch den ECHTEN Parser, nicht aus einer nachgebauten
// Objektform: nur so kann der Test nicht gegen eine Zeilenform gruen bleiben,
// die es gar nicht mehr gibt.
function fixtureZeilen() {
  const r = B.parseReportingTdsCsv(FIXTURE);
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.unbrauchbareWerte, 0);
  return r.rows;
}

const ZEILEN = fixtureZeilen();
// Vorlage fuer die Grenzfaelle weiter unten. Aus derselben Quelle wie oben -
// eine von Hand gepflegte Zeilenform waere eine zweite Definition der
// Schnittstelle zwischen Parser und Modell.
const VORLAGE = ZEILEN[0];
const zeile = over => Object.assign({}, VORLAGE, over);

function modell(rows, optionen) {
  return B.buildReportingTdsModel(rows === undefined ? ZEILEN : rows, optionen || {});
}

// Summe einer Aufschluesselung, egal ob offene Liste oder fester Eimersatz.
const summe = liste => liste.reduce((a, e) => a + e.anzahl, 0);

// --- Kacheln (§3.5 Punkt 1) ------------------------------------------------

test('Kacheln: Zeilen, Transaktionen, Wiederholer und "am Ende bezahlt"', () => {
  const m = modell();
  // 8 Zeilen in der Fixture.
  assert.strictEqual(m.kpi.failures, 8);
  // 7 verschiedene transaction_id: 7000001 traegt ZWEI Zeilen (8000001 und
  // 8000002), die uebrigen sechs je eine.
  assert.strictEqual(m.kpi.transaktionen, 7);
  // Genau 7000001 hat attempts_der_transaktion = 2.
  assert.strictEqual(m.kpi.wiederholer, 1);
  assert.strictEqual(m.kpi.wiederholerAnteil, (1 / 7) * 100);
  // Genau eine Transaktion steht auf FULFILL (7000006, Zeile 8000007).
  assert.strictEqual(m.kpi.amEndeBezahlt, 1);
  assert.strictEqual(m.kpi.amEndeBezahltAnteil, (1 / 7) * 100);
  // Keine Zeile ohne Transaktions-ID.
  assert.strictEqual(m.kpi.ohneTransaktion, 0);
});

test('"Am Ende doch bezahlt" und Wiederholer zaehlen Transaktionen, nicht Zeilen', () => {
  const m = modell();
  // Der Beweis haengt an der Transaktion mit zwei Fehlschlaegen: ueber Zeilen
  // gerechnet waere der Nenner 8 und der Wiederholer-Zaehler 2 (beide Zeilen
  // tragen attemptsDerTransaktion = 2) - also 25 % statt 1/7 = 14.29 %.
  assert.notStrictEqual(m.kpi.transaktionen, m.kpi.failures);
  assert.notStrictEqual(m.kpi.wiederholerAnteil, (2 / 8) * 100);
  assert.notStrictEqual(m.kpi.amEndeBezahltAnteil, (1 / 8) * 100);

  // Und dieselbe Rechnung noch einmal an zwei Zeilen EINER bezahlten
  // Transaktion: eine Transaktion, ein Zaehler, 100 % - nicht zwei von zwei
  // Zeilen, was zufaellig dasselbe ergaebe, sondern eins von eins.
  const zwei = [
    zeile({ attemptId: 'a1', transactionId: 'tx1', transactionState: 'COMPLETED' }),
    zeile({ attemptId: 'a2', transactionId: 'tx1', transactionState: 'COMPLETED' }),
  ];
  const m2 = modell(zwei);
  assert.strictEqual(m2.kpi.failures, 2);
  assert.strictEqual(m2.kpi.transaktionen, 1);
  assert.strictEqual(m2.kpi.amEndeBezahlt, 1);
});

test('COMPLETED zaehlt wie FULFILL, jeder andere Zustand nicht', () => {
  const m = modell([
    zeile({ attemptId: 'a1', transactionId: 't1', transactionState: 'FULFILL' }),
    zeile({ attemptId: 'a2', transactionId: 't2', transactionState: 'COMPLETED' }),
    zeile({ attemptId: 'a3', transactionId: 't3', transactionState: 'FAILED' }),
    zeile({ attemptId: 'a4', transactionId: 't4', transactionState: 'UNKNOWN' }),
  ]);
  assert.strictEqual(m.kpi.amEndeBezahlt, 2);
  assert.strictEqual(m.kpi.amEndeBezahltAnteil, 50);
});

test('Zeilen ohne Transaktions-ID bilden keine Sammel-Transaktion', () => {
  // Alle unter dem Schluessel '' zu buendeln ergaebe eine Riesen-Transaktion
  // mit erfundenen Kennzahlen. Sie werden gezaehlt und bleiben draussen.
  const m = modell([
    zeile({ attemptId: 'a1', transactionId: '' }),
    zeile({ attemptId: 'a2', transactionId: '' }),
    zeile({ attemptId: 'a3', transactionId: 't1' }),
  ]);
  assert.strictEqual(m.kpi.failures, 3);
  assert.strictEqual(m.kpi.transaktionen, 1);
  assert.strictEqual(m.kpi.ohneTransaktion, 2);
});

test('Betroffenes Volumen steht je Waehrung, nie als Summe darueber', () => {
  const m = modell();
  // CHF: 129.00 + 129.00 + 54.90 + 22.50 + 78.40 = 413.80
  // EUR: 310.00 + 310.00 + 89.95 = 709.95
  assert.deepStrictEqual(plain(m.waehrungen), [
    { waehrung: 'CHF', anzahl: 5, betrag: 41380000000, anteil: 62.5 },
    { waehrung: 'EUR', anzahl: 3, betrag: 70995000000, anteil: 37.5 },
  ]);
  // Es gibt bewusst keine Gesamtsumme ueber Waehrungen hinweg (SPEC 2.7).
  assert.ok(!('betrag' in m.kpi), 'kpi darf keinen waehrungsuebergreifenden Betrag tragen');
});

test('Die Waehrungs-AUFZAEHLUNG kennt kein UNKNOWN, die Verteilung schon', () => {
  // kpi.waehrungen ist eine Liste von Waehrungscodes - so fuehrt sie auch das
  // Gesamtmodell des Aggregats, und dort steht UNKNOWN nicht drin. Der Eimer
  // ist keine Waehrung; in einer Liste, die sonst nur ISO-Codes enthaelt,
  // laese er sich wie einer.
  const m = modell([
    zeile({ attemptId: 'a1', transactionId: 't1', waehrung: 'CHF' }),
    zeile({ attemptId: 'a2', transactionId: 't2', waehrung: 'UNKNOWN' }),
  ]);
  assert.deepStrictEqual(plain(m.kpi.waehrungen), ['CHF']);
  // Die VERTEILUNGEN behalten ihn: dass eine Zeile ohne Waehrungsangabe kam,
  // ist eine Messung und gehoert ausgewiesen - und die Anteile summieren nur
  // mit ihr auf 100 %.
  assert.deepStrictEqual(plain(m.waehrungen.map(w => w.waehrung)), ['CHF', 'UNKNOWN']);
  assert.deepStrictEqual(plain(m.betraege.map(b => b.waehrung)), ['CHF', 'UNKNOWN']);
  assert.strictEqual(summe(m.waehrungen), m.kpi.failures);
});

// --- Die beiden Nenner aus dem Aggregat ------------------------------------

// Ein minimales Kanal-Modell. Die Zahlen sind so gewaehlt, dass sich die
// beiden Nenner nicht verwechseln lassen: 200 gescheiterte Attempts gegen
// 300 + 100 = 400 mit angefordertem 3DS.
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

test('Ohne Aggregat sind beide Anteils-Kacheln null, nicht 0', () => {
  const m = modell(ZEILEN, {});
  assert.strictEqual(m.kpi.anteilAnFailed, null);
  assert.strictEqual(m.kpi.anteilAnTdsAngefordert, null);
  assert.strictEqual(m.kpi.hatAggregat, false);
  // Und ausdruecklich auch bei einer null-Option, nicht nur bei einer
  // fehlenden - das ist der Fall, den die App liefert, wenn das Aggregat
  // nicht gelaufen ist.
  const m2 = modell(ZEILEN, { aggregat: null });
  assert.strictEqual(m2.kpi.anteilAnFailed, null);
  assert.strictEqual(m2.kpi.anteilAnTdsAngefordert, null);
});

test('Mit Aggregat: Anteil an allen FAILED und an allen mit 3DS-Anforderung', () => {
  const m = modell(ZEILEN, { aggregat: AGGREGAT });
  assert.strictEqual(m.kpi.hatAggregat, true);
  assert.strictEqual(m.kpi.basisFailed, 200);
  // 300 AUTHENTICATED + 100 STARTED_NO_CAVV. WALLET_CRYPTOGRAM (kein Start,
  // das Kryptogramm kommt aus dem Wallet) und NOT_REQUESTED gehoeren NICHT
  // dazu - stuenden sie im Nenner, waere er 1350 und die Kachel behauptete
  // einen Anteil an einer Menge, in der 3DS nie angefordert wurde.
  assert.strictEqual(m.kpi.basisTdsAngefordert, 400);
  assert.strictEqual(m.kpi.anteilAnFailed, (8 / 200) * 100);
  // Alle acht Fixture-Zeilen tragen einen Startzeitpunkt, Zaehler und
  // Zeilenzahl fallen hier also zusammen.
  assert.strictEqual(m.kpi.mitTdsStart, 8);
  assert.strictEqual(m.kpi.anteilAnTdsAngefordert, (8 / 400) * 100);
});

test('Der 3DS-Anteil zaehlt nur Zeilen mit Startzeitpunkt, die Failed-Quote alle', () => {
  // Der Nenner "3DS angefordert" sind die Attempts mit GESTARTETEM Prozess.
  // Die Definition der Liste (§3.2, erster Zweig) nimmt aber auch Zeilen auf,
  // die kein tds_started-Label tragen: ein Attempt mit dem Grund "3-D Secure
  // Failure" und leerem Start-Label kommt herein und steht im Aggregat unter
  // NOT_REQUESTED, also NICHT im Nenner. Ueber die ganze Liste gerechnet
  // stuenden solche Zeilen nur im Zaehler.
  //
  // Von Hand: drei Zeilen, davon eine ohne Startzeitpunkt.
  //   anteilAnFailed        = 3 / 200 * 100 = 1.5 %  (ganze Liste)
  //   mitTdsStart           = 2
  //   anteilAnTdsAngefordert = 2 / 400 * 100 = 0.5 %  (nicht 3 / 400 = 0.75 %)
  const m = modell([
    zeile({ attemptId: 'a1', transactionId: 't1' }),
    zeile({ attemptId: 'a2', transactionId: 't2' }),
    zeile({ attemptId: 'a3', transactionId: 't3', tdsStartedOn: '', tdsFinishedOn: '' }),
  ], { aggregat: AGGREGAT });
  assert.strictEqual(m.kpi.failures, 3);
  assert.strictEqual(m.kpi.mitTdsStart, 2);
  assert.strictEqual(m.kpi.anteilAnFailed, (3 / 200) * 100);
  assert.strictEqual(m.kpi.anteilAnTdsAngefordert, (2 / 400) * 100);
  // Und die Zahl steht im Modell, damit die Ausgabe die abweichende
  // Grundgesamtheit benennen kann statt sie zu verschweigen.
  assert.ok(m.kpi.mitTdsStart < m.kpi.failures);
});

test('Ein unlesbarer Startzeitpunkt zaehlt trotzdem als "3DS gestartet"', () => {
  // Gemessen wird die ANWESENHEIT des Labels, nicht seine Lesbarkeit: ein
  // Attempt mit unlesbarem Startzeitpunkt hat 3DS trotzdem gestartet und
  // steckt im Nenner des Aggregats. Ihn aus dem Zaehler zu nehmen machte die
  // Kachel wieder kleiner als sie ist - nur in die andere Richtung.
  const m = modell([
    zeile({ attemptId: 'a1', transactionId: 't1', tdsStartedOn: 'sofort', tdsFinishedOn: '' }),
  ], { aggregat: AGGREGAT });
  assert.strictEqual(m.kpi.mitTdsStart, 1);
  // Eine Dauer ergibt der Wert deshalb noch lange nicht.
  assert.strictEqual(m.zeilen[0].dauerSekunden, null);
});

test('Der 3DS-Nenner ist derselbe, aus dem das Aggregat seinen Anteil bildet', () => {
  // Der Stub oben ist von Hand gebaut; dieser Test haelt ihn gegen das echte
  // Kanal-Modell. Ohne ihn koennte der Stub eine Schluesselschreibweise
  // erfinden, die es im Aggregat gar nicht gibt - der Nenner faende dann
  // nichts und stuende dauerhaft auf 0, ohne dass ein Test es merkt.
  const agg = B.parseReportingCsv(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'reporting-beispiel.csv'), 'utf8'));
  assert.strictEqual(agg.error, null);
  const ecom = B.buildReportingModel(agg.rows, {}).kanaele.ECOM;
  const m = modell(ZEILEN, { aggregat: ecom });

  assert.strictEqual(m.kpi.basisFailed, ecom.kpi.fehlgeschlagen);
  // Die Probe: der Angefordert-Anteil des Aggregats ist genau
  // basisTdsAngefordert / kartenAttempts. Stimmt das, hat dieses Modell
  // dieselben zwei Eimer genommen wie das Aggregat.
  assert.strictEqual(
    m.kpi.basisTdsAngefordert / ecom.kpi.kartenAttempts * 100,
    ecom.tds.angefordertAnteil);
  assert.ok(m.kpi.basisTdsAngefordert > 0);
});

test('Ein Aggregat ohne Fehlschlaege ergibt null, nicht eine Division durch 0', () => {
  const m = modell(ZEILEN, { aggregat: { kpi: { fehlgeschlagen: 0 }, tds: { gruppen: [] } } });
  assert.strictEqual(m.kpi.anteilAnFailed, null);
  assert.strictEqual(m.kpi.anteilAnTdsAngefordert, null);
});

// --- Bestellebene (§3.8) ---------------------------------------------------

test('Bestellungen mit >= 2 3DS-Fehlschlaegen - gegen den richtigen Zaehler', () => {
  const m = modell();
  // Fuenf Bestellungen in der Fixture, je (space_id, merchant_reference):
  //   (90001, ORD-1001) Fehlschlaege 2, am Ende bezahlt
  //   (90001, ORD-1002) Fehlschlaege 1
  //   (90001, ORD-1003) Fehlschlaege 1  - aber versuche_der_bestellung = 2
  //   (90002, ORD-2001) Fehlschlaege 2, nicht bezahlt
  //   (90002, ORD-2002) Fehlschlaege 1
  assert.strictEqual(m.bestellungen.gesamt, 5);
  assert.strictEqual(m.bestellungen.mehrfach, 2);
  assert.strictEqual(m.bestellungen.mehrfachAnteil, (2 / 5) * 100);
  assert.strictEqual(m.bestellungen.mehrfachBezahlt, 1);
  assert.strictEqual(m.bestellungen.mehrfachBezahltAnteil, 50);

  // Der eigentliche Punkt: gegen versucheDerBestellung gerechnet waeren es
  // DREI (ORD-1003 kaeme mit 2 Versuchen dazu, bei einem einzigen Fehlschlag).
  const gegenVersuche = new Set(ZEILEN
    .filter(z => z.versucheDerBestellung >= 2)
    .map(z => z.spaceId + '/' + z.merchantReference));
  assert.strictEqual(gegenVersuche.size, 3);
  assert.notStrictEqual(m.bestellungen.mehrfach, gegenVersuche.size);
});

test('Zeilen ohne Bestellnummer zaehlen in keine Bestell-Zahl, sondern eigens', () => {
  const m = modell();
  // Eine Zeile der Fixture (8000004) hat keine Bestellnummer; die Query
  // gruppiert sie nicht und laesst beide Zaehler auf NULL.
  assert.strictEqual(m.bestellungen.ohneBestellnummer, 1);
  // Sie steckt in keiner der fuenf Bestellungen: 8 Zeilen, davon 7 mit
  // Bestellnummer, verteilt auf 5 Bestellungen.
  const mitNummer = ZEILEN.filter(z => z.merchantReference !== '').length;
  assert.strictEqual(mitNummer, 7);
  assert.strictEqual(m.bestellungen.gesamt, 5);
});

test('Dieselbe Bestellnummer in zwei Spaces ist nicht dieselbe Bestellung', () => {
  const m = modell([
    zeile({ attemptId: 'a1', transactionId: 't1', spaceId: '90001', merchantReference: 'ORD-9',
      versucheDerBestellung: 2, tdsFehlschlaegeDerBestellung: 2, bestellungAmEndeBezahlt: true }),
    zeile({ attemptId: 'a2', transactionId: 't2', spaceId: '90002', merchantReference: 'ORD-9',
      versucheDerBestellung: 2, tdsFehlschlaegeDerBestellung: 2, bestellungAmEndeBezahlt: false }),
  ]);
  assert.strictEqual(m.bestellungen.gesamt, 2);
  assert.strictEqual(m.bestellungen.mehrfach, 2);
  assert.strictEqual(m.bestellungen.mehrfachBezahlt, 1);
});

test('Eine fehlende Bestellnummer ergibt keine Bestellung namens "undefined"', () => {
  const m = modell([
    zeile({ attemptId: 'a1', transactionId: 't1', merchantReference: undefined }),
    zeile({ attemptId: 'a2', transactionId: 't2', merchantReference: undefined }),
  ]);
  assert.strictEqual(m.bestellungen.gesamt, 0);
  assert.strictEqual(m.bestellungen.ohneBestellnummer, 2);
});

test('Eine Zeile mit Nummer, aber ohne Zaehler ist nicht gruppierbar', () => {
  // Aus dieser Query kann das nicht kommen (beide Zaehler haengen an der
  // Nummer), aus einem importierten CSV schon. Dann fehlt die Grundlage fuer
  // die Quote, und die Zeile gehoert in keine der beiden Bestell-Zahlen -
  // nicht in einen Nenner, dessen Gruppe es so nicht gibt.
  //
  // Sie gehoert aber auch NICHT unter "ohne Bestellnummer": sie traegt eine
  // ('ORD-X'). Diese Zeile unter der Beschriftung "n Zeilen ohne
  // Bestellnummer" auszuweisen waere eine Aussage, der die Zeile selbst
  // widerspricht - deshalb ein zweiter Zaehler.
  const m = modell([
    zeile({ attemptId: 'a1', transactionId: 't1', merchantReference: 'ORD-X',
      versucheDerBestellung: null, tdsFehlschlaegeDerBestellung: null }),
  ]);
  assert.strictEqual(m.bestellungen.gesamt, 0);
  assert.strictEqual(m.bestellungen.ohneBestellnummer, 0);
  assert.strictEqual(m.bestellungen.ohneBestellzaehler, 1);
  assert.strictEqual(m.bestellungen.mehrfachAnteil, null);
});

test('Die beiden Ausschluss-Zaehler der Bestellebene trennen ihre Faelle', () => {
  // Drei Zeilen, drei Faelle: eine gruppierbare Bestellung, eine Zeile ohne
  // Nummer, eine Zeile mit Nummer und ohne Zaehler. Von Hand: gesamt = 1
  // (eine gruppierbare Bestellung), ohneBestellnummer = 1,
  // ohneBestellzaehler = 1 - jede ausgeschlossene Zeile in genau einem Topf.
  const m = modell([
    zeile({ attemptId: 'a1', transactionId: 't1', merchantReference: 'ORD-A',
      versucheDerBestellung: 1, tdsFehlschlaegeDerBestellung: 1 }),
    zeile({ attemptId: 'a2', transactionId: 't2', merchantReference: '',
      versucheDerBestellung: null, tdsFehlschlaegeDerBestellung: null }),
    zeile({ attemptId: 'a3', transactionId: 't3', merchantReference: 'ORD-C',
      versucheDerBestellung: 2, tdsFehlschlaegeDerBestellung: null }),
  ]);
  assert.strictEqual(m.bestellungen.gesamt, 1);
  assert.strictEqual(m.bestellungen.ohneBestellnummer, 1);
  assert.strictEqual(m.bestellungen.ohneBestellzaehler, 1);
  // Und keine der beiden ausgeschlossenen Zeilen steckt in einer Quote.
  assert.strictEqual(m.bestellungen.mehrfach, 0);
});

// --- Grund und Einordnung (§3.2) -------------------------------------------

test('Grund-Achse: Name aus der Tabelle, absteigend, vollstaendig', () => {
  const m = modell();
  // 5 x 3-D Secure Failure, 2 x Timeout, 1 x ein anderer Grund.
  assert.deepStrictEqual(plain(m.gruende.map(g => [g.id, g.anzahl, g.name])), [
    ['1568360440179', 5, '3-D Secure Failure'],
    ['1568360434240', 2, '3-D Secure Timeout'],
    ['1460695272591', 1, 'Cancellation Initiated by User'],
  ]);
  assert.strictEqual(summe(m.gruende), 8);
});

test('Die Dreiteilung erklaert, warum eine Zeile auf der Seite steht', () => {
  const m = modell();
  assert.deepStrictEqual(plain(m.einordnung.gruppen), [
    { schluessel: 'TDS_FAILURE', anzahl: 5, anteil: 62.5 },
    { schluessel: 'TDS_TIMEOUT', anzahl: 2, anteil: 25 },
    { schluessel: 'ANDERER_GRUND', anzahl: 1, anteil: 12.5 },
  ]);
  assert.strictEqual(m.einordnung.basis, 8);
  // Die dritte Zeile ist die, die ueber den ZWEITEN Zweig der Definition
  // hereinkommt: anderer Ablehngrund, 3DS gestartet, kein CAVV.
  const anderer = ZEILEN.filter(z => B.klassifiziereTdsGrund(z.failureReasonId) === 'ANDERER_GRUND');
  assert.strictEqual(anderer.length, 1);
  assert.strictEqual(anderer[0].tdsCavv, false);
  assert.notStrictEqual(anderer[0].tdsStartedOn, '');
});

test('Einordnung und Query-Liste stammen aus derselben Quelle', () => {
  // Die Query baut ihre IN-Liste aus TDS_FAILURE_REASONS, die Achse
  // unterscheidet die beiden Gruende einzeln. Laufen sie auseinander, zeigt
  // die Liste Zeilen, die die Achse als "anderer Grund" fuehrt.
  assert.deepStrictEqual(plain([...B.TDS_FAILURE_REASONS]),
    [B.TDS_GRUND_FAILURE, B.TDS_GRUND_TIMEOUT]);
  assert.strictEqual(B.klassifiziereTdsGrund(B.TDS_GRUND_FAILURE), 'TDS_FAILURE');
  assert.strictEqual(B.klassifiziereTdsGrund(B.TDS_GRUND_TIMEOUT), 'TDS_TIMEOUT');
  assert.strictEqual(B.klassifiziereTdsGrund('1460695272591'), 'ANDERER_GRUND');
  assert.strictEqual(B.klassifiziereTdsGrund('UNKNOWN'), 'ANDERER_GRUND');
  assert.strictEqual(B.klassifiziereTdsGrund(null), 'ANDERER_GRUND');
});

// --- Dauer bis zum Abbruch (§3.5) ------------------------------------------

test('Dauer-Eimer: die Grenzen liegen dort, wo sie heissen', () => {
  // Die Grenzen kommen aus der Konstanten, nicht aus einer zweiten Handliste.
  assert.deepStrictEqual(plain([...B.TDS_DAUER_GRENZEN_SEK]), [10, 60, 300]);
  // Halboffen: jede Grenze gehoert zum OBEREN Eimer. Je ein Wert knapp
  // darunter, auf der Grenze und knapp darueber.
  assert.strictEqual(B.klassifiziereTdsDauer(0), 'UNTER_10S');
  assert.strictEqual(B.klassifiziereTdsDauer(9.999), 'UNTER_10S');
  assert.strictEqual(B.klassifiziereTdsDauer(10), 'S10_60');
  assert.strictEqual(B.klassifiziereTdsDauer(59.999), 'S10_60');
  assert.strictEqual(B.klassifiziereTdsDauer(60), 'MIN1_5');
  assert.strictEqual(B.klassifiziereTdsDauer(299.999), 'MIN1_5');
  assert.strictEqual(B.klassifiziereTdsDauer(300), 'UEBER_5MIN');
  assert.strictEqual(B.klassifiziereTdsDauer(3600), 'UEBER_5MIN');
});

test('Dauer: leer, unlesbar und negativ sind alle "unbekannt"', () => {
  // Eine negative Dauer ist keine Messung - sie gehoert NICHT in den
  // kleinsten Eimer, wo sie sich als "sofort abgebrochen" ausgaebe.
  assert.strictEqual(B.tdsDauerSekunden('', ''), null);
  assert.strictEqual(B.tdsDauerSekunden('2026-07-04T20:10:41+02:00', ''), null);
  assert.strictEqual(B.tdsDauerSekunden('04.07.2026 20:10', '2026-07-04T20:11:02+02:00'), null);
  assert.strictEqual(
    B.tdsDauerSekunden('2026-07-04T20:11:02+02:00', '2026-07-04T20:10:41+02:00'), null);
  assert.strictEqual(B.klassifiziereTdsDauer(null), 'UNBEKANNT');
  assert.strictEqual(B.klassifiziereTdsDauer(-1), 'UNBEKANNT');

  const m = modell([
    zeile({ attemptId: 'a1', transactionId: 't1', tdsStartedOn: '', tdsFinishedOn: '' }),
    zeile({ attemptId: 'a2', transactionId: 't2', tdsStartedOn: 'gestern', tdsFinishedOn: 'heute' }),
    zeile({ attemptId: 'a3', transactionId: 't3',
      tdsStartedOn: '2026-07-04T20:11:02+02:00', tdsFinishedOn: '2026-07-04T20:10:41+02:00' }),
  ]);
  const eimer = k => m.dauer.gruppen.find(g => g.schluessel === k).anzahl;
  assert.strictEqual(eimer('UNBEKANNT'), 3);
  assert.strictEqual(eimer('UNTER_10S'), 0);
  // Und die Zeilenliste zeigt dafuer keine erfundene Zahl.
  assert.deepStrictEqual(m.zeilen.map(z => z.dauerSekunden), [null, null, null]);
});

test('Dauer-Eimer an der Fixture, von Hand nachgerechnet', () => {
  const m = modell();
  // 8000001 20:10:41 -> 20:11:02 = 21 s
  // 8000002 20:13:20 -> 20:13:46 = 26 s
  // 8000003 09:02:11 -> 09:02:14 =  3 s
  // 8000004 kein Endzeitpunkt         -> unbekannt
  // 8000005 12:29:12 -> 12:29:58 = 46 s
  // 8000006 12:40:33 -> 12:41:19 = 46 s
  // 8000007 07:10:02 -> 07:15:43 = 341 s
  // 8000008 14:04:51 -> 14:05:08 = 17 s
  assert.deepStrictEqual(plain(m.dauer.gruppen.map(g => [g.schluessel, g.anzahl])), [
    ['UNTER_10S', 1], ['S10_60', 5], ['MIN1_5', 0], ['UEBER_5MIN', 1], ['UNBEKANNT', 1],
  ]);
  assert.strictEqual(summe(m.dauer.gruppen), 8);
});

test('Beide belegten Zeitschreibweisen ergeben dieselbe Dauer', () => {
  // created_on kommt aus Athena mit Leerzeichen, die 3DS-Zeitpunkte aus einem
  // dateTimeContent-Label. Die Dauer darf nicht davon abhaengen, welche der
  // beiden Schreibweisen ein Connector liefert.
  assert.strictEqual(
    B.tdsDauerSekunden('2026-07-04 20:10:41', '2026-07-04 20:11:02'), 21);
  assert.strictEqual(
    B.tdsDauerSekunden('2026-07-04T20:10:41+02:00', '2026-07-04T20:11:02+02:00'), 21);
  // Auch ueber eine Zeitzonengrenze hinweg, wenn beide Seiten sie tragen.
  assert.strictEqual(
    B.tdsDauerSekunden('2026-07-04T18:10:41Z', '2026-07-04T20:11:02+02:00'), 21);
});

test('Gemischte Zonen-Schreibweisen ergeben "unbekannt", keine verschobene Dauer', () => {
  // Date.parse liest einen Wert OHNE Zonenangabe als Lokalzeit, einen MIT
  // Zone absolut. Traegt nur eine der beiden Seiten eine Zone, ist die
  // Differenz um den UTC-Versatz des Browsers verschoben: der Abbruch nach
  // 21 s unten laese sich in Zuerich als 3621 s und landete in "> 5 min" -
  // also als "Timeout" statt "sofort abgebrochen", die Umkehrung genau der
  // Aussage, fuer die diese Achse existiert. Die Schreibweise der beiden
  // 3DS-Zeitpunkte ist NICHT gemessen, der Fall also nicht ausgeschlossen.
  //
  // Der Test rechnet bewusst nicht die verschobene Zahl nach - sie haengt an
  // der Zeitzone des Testlaeufers. Verlangt ist, dass es GAR KEINE Zahl gibt.
  assert.strictEqual(
    B.tdsDauerSekunden('2026-07-04T20:10:41+02:00', '2026-07-04T20:11:02'), null);
  assert.strictEqual(
    B.tdsDauerSekunden('2026-07-04 20:10:41', '2026-07-04T20:11:02Z'), null);
  // Und die Zeile landet damit im Eimer "unbekannt", nicht in einem, den sie
  // sich aus dem Zeitzonen-Versatz verdient hat.
  const m = modell([zeile({
    attemptId: 'a1', transactionId: 't1',
    tdsStartedOn: '2026-07-04T20:10:41+02:00', tdsFinishedOn: '2026-07-04 20:11:02',
  })]);
  assert.strictEqual(m.zeilen[0].dauerSekunden, null);
  assert.strictEqual(m.dauer.gruppen.find(g => g.schluessel === 'UNBEKANNT').anzahl, 1);
});

// --- Betrags-Eimer (§3.5) --------------------------------------------------

test('Betrags-Eimer: Grenzen aus der Konstanten, halboffen wie bei der Dauer', () => {
  assert.deepStrictEqual(plain([...B.TDS_BETRAG_GRENZEN]), [50, 200, 500]);
  const E = 100000000; // 1e-8-Einheiten je Waehrungseinheit
  assert.strictEqual(B.klassifiziereTdsBetrag(0), 'UNTER_50');
  assert.strictEqual(B.klassifiziereTdsBetrag(50 * E - 1), 'UNTER_50');
  assert.strictEqual(B.klassifiziereTdsBetrag(50 * E), 'B50_200');
  assert.strictEqual(B.klassifiziereTdsBetrag(200 * E - 1), 'B50_200');
  assert.strictEqual(B.klassifiziereTdsBetrag(200 * E), 'B200_500');
  assert.strictEqual(B.klassifiziereTdsBetrag(500 * E - 1), 'B200_500');
  assert.strictEqual(B.klassifiziereTdsBetrag(500 * E), 'UEBER_500');
});

test('Ein negativer oder unlesbarer Betrag ist "unbekannt", nicht der kleinste Eimer', () => {
  // Derselbe Grundsatz wie bei der Dauer: "keine Messung" ist ein eigener Ort.
  // Ein negativer Betrag in "< 50" saehe aus wie ein gemessener Kleinbetrag.
  assert.strictEqual(B.klassifiziereTdsBetrag(-1), 'UNBEKANNT');
  assert.strictEqual(B.klassifiziereTdsBetrag(-500 * 100000000), 'UNBEKANNT');
  assert.strictEqual(B.klassifiziereTdsBetrag(null), 'UNBEKANNT');
  assert.strictEqual(B.klassifiziereTdsBetrag(NaN), 'UNBEKANNT');
  assert.strictEqual(B.klassifiziereTdsBetrag('129'), 'UNBEKANNT');
  // 0 bleibt eine gueltige Messung und damit der kleinste Eimer.
  assert.strictEqual(B.klassifiziereTdsBetrag(0), 'UNTER_50');
  // Der Eimer steht als letzter im festen Satz, damit die Eimer auch mit ihm
  // vollstaendig auf die Zeilen der Waehrung aufteilen.
  assert.deepStrictEqual(plain([...B.REPORTING_TDS_BETRAG]),
    ['UNTER_50', 'B50_200', 'B200_500', 'UEBER_500', 'UNBEKANNT']);
  const m = modell([zeile({ attemptId: 'a1', transactionId: 't1', waehrung: 'CHF', betrag: -1 })]);
  assert.deepStrictEqual(plain(m.betraege[0].gruppen.map(g => g.anzahl)), [0, 0, 0, 0, 1]);
  assert.strictEqual(summe(m.betraege[0].gruppen), m.betraege[0].basis);
});

test('Betrags-Eimer stehen je Waehrung und summieren auf deren Zeilenzahl', () => {
  const m = modell();
  // CHF: 22.50 unter 50; 54.90, 78.40, 129.00, 129.00 in 50-200.
  // EUR:  89.95 in 50-200; 310.00 und 310.00 in 200-500.
  assert.deepStrictEqual(plain(m.betraege.map(b => [b.waehrung, b.basis,
    b.gruppen.map(g => g.anzahl)])), [
    ['CHF', 5, [1, 4, 0, 0, 0]],
    ['EUR', 3, [0, 1, 2, 0, 0]],
  ]);
  m.betraege.forEach(b => {
    assert.strictEqual(summe(b.gruppen), b.basis,
      `Die Eimer der Waehrung ${b.waehrung} muessen ihre Zeilen vollstaendig aufteilen`);
    // Und die Basis ist die Zeilenzahl derselben Waehrung im Volumen-Block.
    assert.strictEqual(b.basis, m.waehrungen.find(w => w.waehrung === b.waehrung).anzahl);
  });
  // Ueber Waehrungen hinweg gibt es keinen gemeinsamen Eimersatz - 50 CHF und
  // 50 EUR sind nicht dasselbe (SPEC 2.7).
  assert.strictEqual(m.betraege.length, 2);
});

// --- Die uebrigen Aufschluesselungen ---------------------------------------

test('Brand, Land, PAN-Quelle, ECI, Wallet, BIN und Retry - von Hand gezaehlt', () => {
  const m = modell();
  assert.deepStrictEqual(plain(m.brands.map(e => [e.brand, e.anzahl])),
    [['Visa', 4], ['Mastercard', 3], ['UNKNOWN', 1]]);
  // Gleichstaende laufen alphabetisch: DE, FR, UNKNOWN je 1.
  assert.deepStrictEqual(plain(m.laender.map(e => [e.land, e.anzahl])),
    [['CH', 3], ['IT', 2], ['DE', 1], ['FR', 1], ['UNKNOWN', 1]]);
  assert.deepStrictEqual(plain(m.panTypes.map(e => [e.panType, e.anzahl])),
    [['PAN_PLAIN', 5], ['DEVICE_TOKEN_APPLE_PAY', 2], ['UNKNOWN', 1]]);
  assert.deepStrictEqual(plain(m.eci.map(e => [e.eci, e.anzahl])),
    [['UNKNOWN', 6], ['02', 2]]);
  // '-' ist der Wert der Query fuer "kein Wallet" und damit eine MESSUNG -
  // er bleibt ein eigener Eimer und wird nicht mit UNKNOWN verschmolzen.
  assert.deepStrictEqual(plain(m.wallets.map(e => [e.wallet, e.anzahl])),
    [['-', 6], ['Apple Pay', 2]]);
  assert.deepStrictEqual(plain(m.bins.map(e => [e.bin, e.anzahl])),
    [['424242', 3], ['555544', 2], ['400011', 1], ['535353', 1], ['UNKNOWN', 1]]);
  assert.deepStrictEqual(plain(m.retry.map(e => [e.attemptRetry, e.anzahl])),
    [['No Retry', 3], ['Retry Later', 3], ['UNKNOWN', 2]]);
});

test('Jede Aufschluesselung teilt die Zeilen vollstaendig auf', () => {
  const m = modell();
  const achsen = {
    gruende: m.gruende, einordnung: m.einordnung.gruppen, dauer: m.dauer.gruppen,
    brands: m.brands, laender: m.laender, panTypes: m.panTypes, eci: m.eci,
    wallets: m.wallets, bins: m.bins, retry: m.retry,
    verlauf: m.verlauf, stunden: m.stunden,
  };
  Object.keys(achsen).forEach(name => {
    assert.strictEqual(summe(achsen[name]), m.kpi.failures,
      `Die Achse ${name} muss auf die Gesamtzahl summieren`);
  });
  // Und die Anteile jeder Achse auf 100 % - bis auf Gleitkomma-Rauschen.
  Object.keys(achsen).forEach(name => {
    const a = achsen[name];
    if (!a.length || a[0].anteil === undefined) return;
    assert.ok(Math.abs(a.reduce((s, e) => s + e.anteil, 0) - 100) < 1e-9,
      `Die Anteile der Achse ${name} muessen auf 100 % summieren`);
  });
});

test('Nichts wird gekuerzt - das macht erst die Blockschicht', () => {
  // Fuenfzehn verschiedene BINs; das Modell gibt alle fuenfzehn zurueck.
  const viele = Array.from({ length: 15 }, (_, i) => zeile({
    attemptId: 'a' + i, transactionId: 't' + i, cardIssuerNumber: '4000' + i,
  }));
  const m = modell(viele);
  assert.strictEqual(m.bins.length, 15);
  assert.strictEqual(summe(m.bins), 15);
});

// --- Verlauf und Stunden ---------------------------------------------------

test('Tag und Stunde kommen aus den Feldern des Zeitstempels', () => {
  const m = modell();
  // 2026-07-04 bis 2026-07-30 = 27 Kalendertage, lueckenlos aufgefuellt.
  assert.deepStrictEqual(plain(m.zeitraum),
    { von: '2026-07-04', bis: '2026-07-30', tage: 27, lueckenlos: true });
  assert.strictEqual(m.verlauf.length, 27);
  assert.strictEqual(m.verlauf[0].tag, '2026-07-04');
  assert.strictEqual(m.verlauf[0].anzahl, 2);
  // Ein Tag ohne Fehlschlag steht mit 0 da - gemessen, nicht unbekannt.
  assert.strictEqual(m.verlauf.find(v => v.tag === '2026-07-05').anzahl, 0);

  // Stunden immer vollstaendig 0-23. Die belegten sind die Stunden der
  // Zeitstempel selbst, ohne Zeitzonen-Umrechnung: 20, 20, 9, 18, 12, 12, 7, 14.
  assert.strictEqual(m.stunden.length, 24);
  assert.deepStrictEqual(
    plain(m.stunden.filter(s => s.anzahl).map(s => [s.stunde, s.anzahl])),
    [[7, 1], [9, 1], [12, 2], [14, 1], [18, 1], [20, 2]]);
});

test('Unbrauchbare Zeitstempel fallen sichtbar heraus, statt in Eimer 0', () => {
  const m = modell([
    zeile({ attemptId: 'a1', transactionId: 't1', createdOn: '' }),
    zeile({ attemptId: 'a2', transactionId: 't2', createdOn: 'gestern frueh' }),
    // Tag unbrauchbar (den 45. Dezember gibt es nicht), Stunde lesbar.
    zeile({ attemptId: 'a3', transactionId: 't3', createdOn: '2026-13-45 08:00:00' }),
    zeile({ attemptId: 'a4', transactionId: 't4', createdOn: '2026-07-04 08:00:00' }),
  ]);
  // Die beiden Zaehler messen ihre eigene Frage: die dritte Zeile hat keinen
  // Tag, aber eine Stunde. Ein gemeinsamer Zaehler haette sie doppelt
  // verworfen oder gar nicht.
  assert.strictEqual(m.kpi.ohneTag, 3);
  assert.strictEqual(m.kpi.ohneStunde, 2);
  // Stunde 0 bleibt leer - die unbrauchbaren Zeilen liegen nicht dort.
  assert.strictEqual(m.stunden[0].anzahl, 0);
  assert.strictEqual(m.stunden[8].anzahl, 2);
  assert.strictEqual(m.verlauf.length, 1);
});

// --- Zeilenliste (§3.5 Punkt 3) --------------------------------------------

test('Ein Zeitstempel mit angehaengtem Muell gilt ueberall als unlesbar', () => {
  // Es darf nur EINE Antwort auf "ist das ein Zeitstempel" geben: bekaeme die
  // Zeile hier Tag und Stunde, waehrend die Sortierung sie als unlesbar ans
  // Ende schiebt, stuende sie in der Tabelle ganz unten und im Verlauf
  // mittendrin - ohne dass irgendwo etwas rot wird.
  const m = modell([
    zeile({ attemptId: 'a1', transactionId: 't1', createdOn: '2026-07-04 20:11:03 Uhr' }),
    zeile({ attemptId: 'a2', transactionId: 't2', createdOn: '2026-07-04 20:11:03' }),
  ]);
  assert.strictEqual(m.kpi.ohneTag, 1);
  assert.strictEqual(m.kpi.ohneStunde, 1);
  assert.strictEqual(m.verlauf.length, 1);
  assert.deepStrictEqual(plain(m.zeilen.map(z => z.attemptId)), ['a2', 'a1']);
});

test('Der Dauer-Eimer einer Zeile und ihre ausgewiesene Dauer sind derselbe Wert', () => {
  // Beide entstehen aus demselben abgeleiteten Feld, nicht aus zwei
  // Herleitungen, die gleich aussehen. Der Test rechnet die Eimer aus den
  // Zeilen nach und haelt sie gegen die Achse.
  const m = modell();
  const nachgerechnet = new Map();
  m.zeilen.forEach(z => {
    const k = B.klassifiziereTdsDauer(z.dauerSekunden);
    nachgerechnet.set(k, (nachgerechnet.get(k) || 0) + 1);
  });
  m.dauer.gruppen.forEach(g => {
    assert.strictEqual(g.anzahl, nachgerechnet.get(g.schluessel) || 0,
      `Der Eimer ${g.schluessel} muss zu den Dauern der Zeilen passen`);
  });
});

test('Die Zeilenliste kommt vor-sortiert, neueste zuerst', () => {
  const m = modell();
  assert.deepStrictEqual(plain(m.zeilen.map(z => z.attemptId)), [
    '8000008', '8000007', '8000006', '8000005', '8000004', '8000003', '8000002', '8000001',
  ]);
  // Vollstaendig - sortiert wird, nicht gefiltert.
  assert.strictEqual(m.zeilen.length, 8);
});

test('Gleicher Zeitstempel: die Reihenfolge ist trotzdem bestimmt', () => {
  const gleich = ['a1', 'a3', 'a2'].map(id => zeile({
    attemptId: id, transactionId: 't' + id, createdOn: '2026-07-04 20:11:03.000',
  }));
  assert.deepStrictEqual(modell(gleich).zeilen.map(z => z.attemptId), ['a3', 'a2', 'a1']);
});

test('Gleicher Zeitstempel: der Tie-Break sortiert numerisch wie die Query', () => {
  // Die Query sortiert `attempt_id DESC`, und die IDs sind bigint - '10' steht
  // dort VOR '9'. Ein String-Vergleich drehte das um, und die Zeilenliste auf
  // dem Bildschirm stuende anders da als das Roh-CSV, das aus derselben
  // Abfrage stammt. Die Stellenzahl ist dabei der Punkt: '8000010' und
  // '8000009' unterscheiden sich lexikografisch richtig, '9' und '10' nicht.
  const ids = ['9', '10', '8000009', '8000010'];
  const gleich = ids.map(id => zeile({
    attemptId: id, transactionId: 't' + id, createdOn: '2026-07-04 20:11:03.000',
  }));
  assert.deepStrictEqual(modell(gleich).zeilen.map(z => z.attemptId),
    ['8000010', '8000009', '10', '9']);
  // Eine ID, die keine reine Ziffernfolge ist, soll es nicht geben (die Spalte
  // ist bigint) - sie darf aber nichts umwerfen. idCmp stellt sie hinter die
  // Zahlen, in der absteigenden Liste hier also nach vorn.
  const gemischt = ['7', 'a', '12'].map(id => zeile({
    attemptId: id, transactionId: 't' + id, createdOn: '2026-07-04 20:11:03.000',
  }));
  assert.deepStrictEqual(modell(gemischt).zeilen.map(z => z.attemptId), ['a', '12', '7']);
});

test('Zeilen mit unlesbarem Zeitstempel stehen am Ende, nicht mittendrin', () => {
  // Sie sind nicht "aelter", sie sind unbekannt - in die Mitte gerutscht
  // sortierten sie sich zwischen Tage, zu denen sie nichts sagen.
  const m = modell([
    zeile({ attemptId: 'a1', transactionId: 't1', createdOn: 'irgendwann' }),
    zeile({ attemptId: 'a2', transactionId: 't2', createdOn: '2026-07-04 08:00:00' }),
    zeile({ attemptId: 'a3', transactionId: 't3', createdOn: '2026-07-20 08:00:00' }),
  ]);
  assert.deepStrictEqual(m.zeilen.map(z => z.attemptId), ['a3', 'a2', 'a1']);
});

test('Die Zeilen tragen die abgeleiteten Felder, aber keine Formatierung', () => {
  const m = modell();
  const z = m.zeilen.find(x => x.attemptId === '8000001');
  assert.strictEqual(z.grundName, '3-D Secure Failure');
  assert.strictEqual(z.grundEinordnung, 'TDS_FAILURE');
  // 20:10:41 -> 20:11:02, als Zahl und nicht als "21 s".
  assert.strictEqual(z.dauerSekunden, 21);
  assert.strictEqual(z.dashboardUrl,
    'https://app-wallee.com/s/90001/payment/transaction/view/7000001');
  // Die Rohwerte bleiben unveraendert daneben stehen.
  assert.strictEqual(z.betrag, 12900000000);
  assert.strictEqual(z.createdOn, '2026-07-04 20:11:03.000');
  assert.strictEqual(z.tdsVersion, '2.2.0');
});

test('failureReasons des Aufrufers gewinnt ueber den eingebetteten Katalog', () => {
  const m = modell(ZEILEN, { failureReasons: { '1568360440179': 'Eigener Name' } });
  assert.strictEqual(m.gruende.find(g => g.id === '1568360440179').name, 'Eigener Name');
  assert.strictEqual(m.zeilen.find(z => z.attemptId === '8000001').grundName, 'Eigener Name');
});

// --- Dashboard-Link (§3.4) -------------------------------------------------

test('tdsDashboardUrl baut die Adresse nur aus geprueften Ziffern', () => {
  assert.strictEqual(B.tdsDashboardUrl('90001', '7000001'),
    'https://app-wallee.com/s/90001/payment/transaction/view/7000001');
  // Eine ungepruefte ID im Pfad waere der Weg, an app-wallee.com eine fremde
  // Adresse anzuhaengen. Ungueltig ergibt den leeren String - die Ausgabe
  // zeigt dann keinen Link statt eines, der ins Leere fuehrt.
  assert.strictEqual(B.tdsDashboardUrl('90001/../../x', '7000001'), '');
  assert.strictEqual(B.tdsDashboardUrl('90001', 'UNKNOWN'), '');
  assert.strictEqual(B.tdsDashboardUrl('', '7000001'), '');
  assert.strictEqual(B.tdsDashboardUrl('90001', ''), '');
  assert.strictEqual(B.tdsDashboardUrl(null, null), '');
  assert.strictEqual(B.tdsDashboardUrl('90001', '70000 01'), '');
});

test('Eine Zeile ohne verwertbare IDs bekommt keinen Link', () => {
  const m = modell([zeile({ attemptId: 'a1', spaceId: '', transactionId: '' })]);
  assert.strictEqual(m.zeilen[0].dashboardUrl, '');
});

// --- Abschneide-Flag -------------------------------------------------------

test('Das Abschneide-Flag greift genau bei Erreichen des Limits', () => {
  const limit = B.REPORTING_TDS_LIMIT;
  const bauen = n => Array.from({ length: n }, (_, i) => zeile({
    attemptId: 'a' + i, transactionId: 't' + i, merchantReference: 'ORD-' + i,
  }));
  const knappDrunter = modell(bauen(limit - 1));
  assert.strictEqual(knappDrunter.abgeschnitten, false);
  assert.strictEqual(knappDrunter.limit, limit);

  const genau = modell(bauen(limit));
  assert.strictEqual(genau.abgeschnitten, true);
  assert.strictEqual(genau.kpi.failures, limit);
});

// --- Leeres Ergebnis -------------------------------------------------------

test('Keine Zeilen: alles 0 bzw. leer, Quoten null - und hatDaten false', () => {
  const m = modell([]);
  assert.strictEqual(m.hatDaten, false);
  assert.strictEqual(m.kpi.failures, 0);
  assert.strictEqual(m.kpi.transaktionen, 0);
  // Quoten ohne Grundlage sind null ("kein Messwert"), nicht 0.
  assert.strictEqual(m.kpi.wiederholerAnteil, null);
  assert.strictEqual(m.kpi.amEndeBezahltAnteil, null);
  assert.strictEqual(m.bestellungen.mehrfachAnteil, null);
  assert.strictEqual(m.bestellungen.mehrfachBezahltAnteil, null);
  assert.deepStrictEqual(plain(m.waehrungen), []);
  assert.deepStrictEqual(plain(m.betraege), []);
  assert.deepStrictEqual(plain(m.verlauf), []);
  assert.strictEqual(m.stunden.length, 24);
  assert.strictEqual(m.abgeschnitten, false);
  // Die festen Eimersaetze bleiben trotzdem stehen: dass es keinen Timeout
  // gab, ist selbst eine Aussage. Ihr Anteil ist 0, nicht null.
  assert.strictEqual(m.einordnung.gruppen.length, B.REPORTING_TDS_GRUENDE.length);
  assert.strictEqual(m.dauer.gruppen.length, B.REPORTING_TDS_DAUER.length);
  assert.strictEqual(m.einordnung.gruppen[0].anteil, 0);
});

test('Nicht-Array oder fehlende Zeilen werfen nicht', () => {
  assert.strictEqual(B.buildReportingTdsModel(undefined, undefined).kpi.failures, 0);
  assert.strictEqual(B.buildReportingTdsModel(null, {}).kpi.failures, 0);
});

// --- Was das Modell bewusst NICHT hat --------------------------------------

test('Challenge-Status, ACS, 3DS-Version und tds_flow sind keine Achsen', () => {
  // Alle drei fehlen aus GEMESSENEN Gruenden (Discovery Q2 vom 2026-09-04 bzw.
  // Static-Value-IDs ohne Aufloesung), nicht aus Zeitmangel. Der Test haelt
  // fest, dass sie nicht "vorsorglich" zurueckkommen - eine Achse, die
  // dauerhaft leer bleibt, sieht aus wie eine Messung.
  //
  // Geprueft wird der GANZE Modellbaum, nicht bloss die oberste Ebene: eine
  // Achse entsteht auch als Eimer in dauer.gruppen, als Eintrag einer offenen
  // Liste oder als Feld an einer Zeile. Ueber Object.keys(m) allein liefe ein
  // spaeter eingebauter Eimer 'CHALLENGE_TIMEOUT' glatt durch - und der Test
  // bestuende auch gegen ein leeres Modell.
  const m = modell();
  // Die Zeilenliste bleibt bewusst draussen: sie ist keine Achse, sondern die
  // Rohtabelle, und sie FUEHRT die 3DS-Version als Spalte (siehe unten).
  const ohneZeilen = Object.assign({}, m);
  delete ohneZeilen.zeilen;
  const gesehen = [];
  (function sammle(v, tiefe) {
    if (tiefe > 8 || v === null || v === undefined) return;
    if (typeof v === 'string') { gesehen.push(v); return; }
    if (Array.isArray(v)) { v.forEach(e => sammle(e, tiefe + 1)); return; }
    if (typeof v !== 'object') return;
    Object.keys(v).forEach(k => { gesehen.push(k); sammle(v[k], tiefe + 1); });
  }(ohneZeilen, 0));
  // Dazu die festen Eimersaetze aus DERSELBEN Quelle wie der Code: ein neuer
  // Eimer landet dort, auch wenn die Fixture ihn nicht belegt.
  const namen = gesehen.concat(
    [...B.REPORTING_TDS_GRUENDE], [...B.REPORTING_TDS_DAUER], [...B.REPORTING_TDS_BETRAG]);
  const heuhaufen = namen.join(' ');
  [/challenge/i, /acs/i, /flow/i, /tdsversion/i, /tds_version/i, /statusreason/i, /transstatus/i]
    .forEach(muster => assert.ok(!muster.test(heuhaufen),
      `Das Modell darf keine Achse ${muster} tragen`));

  // Gegenprobe, damit der Test nicht vakuum-gruen ist: er muss die Namen
  // ueberhaupt sehen. Waere der Sammler kaputt, bestuende er gegen alles -
  // auch gegen ein leeres Modell.
  assert.ok(namen.indexOf('dauer') !== -1, 'Der Sammler muss die oberste Ebene sehen');
  assert.ok(namen.indexOf('gruppen') !== -1, 'Der Sammler muss verschachtelte Ebenen sehen');
  assert.ok(namen.indexOf('UEBER_5MIN') !== -1, 'Der Sammler muss Eimerschluessel sehen');
  assert.ok(namen.indexOf('CHALLENGE_TIMEOUT') === -1);

  // Die 3DS-Version bleibt als SPALTE in der Zeilenliste erhalten (der
  // wallee-Support kann sie nutzen) - nur als Achse gibt es sie nicht.
  assert.strictEqual(m.zeilen[0].tdsVersion, '2.2.0');
});
