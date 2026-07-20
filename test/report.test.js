// Tests fuer den Report-Kern: CSV-Parser, Header-Mapping, Auto-Gruppierung und
// Report-Modell. Alles reine Funktionen, kein DOM - siehe test/harness.js.

const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders, plain } = require('./harness');

const app = loadBuilders();
const { parseReportCsv, autoOutletGroup, autoBrandGroup, buildReportModel,
  formatAmountCH, formatIntCH, mergeReportConfig } = app;

// Kopfzeile so, wie sie der Terminal-Modus des Generators liefert (unsettled_anzahl).
const HEADER_APP = '"space_id","terminal_identifier","terminal_name","brand","waehrung",' +
  '"anzahl_transaktionen","unsettled_anzahl","brutto_gross","transaction_fee_total","netto","tip_total"';

// Kopfzeile aus der SPEC bzw. dem Prototyp (unmatched_anzahl).
const HEADER_SPEC = HEADER_APP.replace('unsettled_anzahl', 'unmatched_anzahl');

function zeile(tid, name, brand, n, unmatched, gross, tip) {
  return `"1","${tid}","${name}","${brand}","CHF","${n}","${unmatched}","${gross}","0.00000000","0.00000000","${tip}"`;
}

test('parseReportCsv liest Kopfzeile und Datenzeilen', () => {
  const csv = [HEADER_APP, zeile('T1', 'Lounge 1', 'Visa', 47, 47, '1436.70000000', '34.70000000')].join('\n');
  const res = parseReportCsv(csv);

  assert.strictEqual(res.error, null);
  assert.strictEqual(res.rows.length, 1);
  assert.deepStrictEqual(plain(res.rows[0]), {
    tid: 'T1',
    name: 'Lounge 1',
    brand: 'Visa',
    currency: 'CHF',
    count: 47,
    unmatched: 47,
    gross: 143670000000,   // Betraege als ganzzahlige 1e-8-Einheiten, siehe unten
    tip: 3470000000,
  });
});

test('Zaehler-Spalte: unsettled_anzahl und unmatched_anzahl sind gleichwertig', () => {
  const zeileA = zeile('T1', 'Lounge 1', 'Visa', 5, 3, '10.00000000', '1.00000000');
  const a = parseReportCsv([HEADER_APP, zeileA].join('\n'));
  const b = parseReportCsv([HEADER_SPEC, zeileA].join('\n'));

  assert.strictEqual(a.error, null);
  assert.strictEqual(b.error, null);
  assert.strictEqual(a.rows[0].unmatched, 3);
  assert.deepStrictEqual(plain(a.rows), plain(b.rows), 'Beide Schreibweisen muessen dasselbe ergeben');
});

test('fehlende Pflichtspalte liefert Fehlerobjekt statt Wurf', () => {
  const ohneTip = HEADER_APP.replace(',"tip_total"', '');
  let res;
  assert.doesNotThrow(() => { res = parseReportCsv(ohneTip + '\n'); });

  assert.ok(res.error, 'Fehlerobjekt erwartet');
  assert.deepStrictEqual(plain(res.error.missing), ['tip_total']);
  assert.match(res.error.message, /tip_total/, 'Meldung muss die Spalte nennen');
  assert.deepStrictEqual(plain(res.rows), []);
});

test('fehlt jede Zaehler-Spalte, wird das als eine fehlende Spalte gemeldet', () => {
  const ohneZaehler = HEADER_APP.replace(',"unsettled_anzahl"', '');
  const res = parseReportCsv(ohneZaehler + '\n');

  assert.ok(res.error);
  assert.deepStrictEqual(plain(res.error.missing), ['unmatched_anzahl / unsettled_anzahl']);
});

test('mehrere fehlende Spalten werden alle gemeldet', () => {
  const res = parseReportCsv('"terminal_identifier","brand"\n');
  assert.ok(res.error);
  assert.deepStrictEqual(plain(res.error.missing), ['terminal_name', 'brutto_gross', 'tip_total',
    'unmatched_anzahl / unsettled_anzahl']);
});

test('Quotes: Kommas im Feld und doppelte Quotes', () => {
  const csv = [
    HEADER_APP,
    '"1","T1","Bar ""Zum Eck"", oben","Visa","CHF","1","0","5.00000000","0","0","0.00000000"',
  ].join('\n');
  const res = parseReportCsv(csv);

  assert.strictEqual(res.error, null);
  assert.strictEqual(res.rows[0].name, 'Bar "Zum Eck", oben');
});

test('CRLF-Zeilenenden und Leerzeile am Dateiende', () => {
  const csv = HEADER_APP + '\r\n' + zeile('T1', 'Lounge 1', 'Visa', 1, 0, '1.00000000', '0.00000000') + '\r\n';
  const res = parseReportCsv(csv);

  assert.strictEqual(res.error, null);
  assert.strictEqual(res.rows.length, 1, 'Leerzeile am Ende darf keine Datenzeile erzeugen');
});

test('leere CSV liefert Fehler statt Absturz', () => {
  const res = parseReportCsv('');
  assert.ok(res.error);
  assert.match(res.error.message, /leer/i);
});

// --- Genauigkeit -----------------------------------------------------------
// Betraege werden bewusst NICHT als Gleitkommazahl gefuehrt, sondern als
// ganzzahlige Einheiten von 1e-8 (die CSV liefert 8 Nachkommastellen). Grund:
// die Summen sind Geldbetraege und muessen auf den Rappen exakt stimmen.
// 0.1 + 0.2 !== 0.3 gilt auch fuer Umsaetze.

test('Betraege werden exakt in 1e-8-Einheiten gelesen', () => {
  const csv = [HEADER_APP, zeile('T1', 'A', 'Visa', 1, 0, '0.10000000', '0.20000000')].join('\n');
  const res = parseReportCsv(csv);

  assert.strictEqual(res.rows[0].gross, 10000000);
  assert.strictEqual(res.rows[0].tip, 20000000);
  // Genau der Fall, der als Gleitkomma schiefgeht:
  assert.strictEqual(res.rows[0].gross + res.rows[0].tip, 30000000);
  assert.notStrictEqual(0.1 + 0.2, 0.3);
});

test('Betraege ohne oder mit wenigen Nachkommastellen', () => {
  const csv = [
    HEADER_APP,
    zeile('T1', 'A', 'Visa', 1, 0, '31', '0'),
    zeile('T2', 'B', 'Visa', 1, 0, '31.5', '0.25'),
  ].join('\n');
  const res = parseReportCsv(csv);

  assert.strictEqual(res.rows[0].gross, 3100000000);
  assert.strictEqual(res.rows[1].gross, 3150000000);
  assert.strictEqual(res.rows[1].tip, 25000000);
});

test('negative Betraege (Refunds) bleiben erhalten', () => {
  const csv = [HEADER_APP, zeile('T1', 'A', 'Visa', 1, 0, '-12.34000000', '0.00000000')].join('\n');
  const res = parseReportCsv(csv);
  assert.strictEqual(res.rows[0].gross, -1234000000);
});

test('unlesbare Zahl wird zu 0 statt NaN', () => {
  const csv = [HEADER_APP, zeile('T1', 'A', 'Visa', 1, 0, '', 'k.A.')].join('\n');
  const res = parseReportCsv(csv);

  assert.strictEqual(res.rows[0].gross, 0);
  assert.strictEqual(res.rows[0].tip, 0);
});

test('Spaltenreihenfolge ist egal, Mapping laeuft ueber den Namen', () => {
  const csv = [
    '"tip_total","brand","terminal_name","unmatched_anzahl","terminal_identifier","brutto_gross"',
    '"1.00000000","Visa","Lounge 1","2","T9","7.00000000"',
  ].join('\n');
  const res = parseReportCsv(csv);

  assert.strictEqual(res.error, null);
  assert.strictEqual(res.rows[0].tid, 'T9');
  assert.strictEqual(res.rows[0].gross, 700000000);
  assert.strictEqual(res.rows[0].count, 0, 'anzahl_transaktionen ist optional');
  assert.strictEqual(res.rows[0].currency, 'CHF', 'waehrung ist optional, Default CHF');
});

// --- Auto-Gruppierung ------------------------------------------------------
// Outlet-Gruppen entstehen aus dem Terminalnamen (abschliessende Ziffern weg),
// Brand-Gruppen aus dem Brand-String. Beide Vorschlaege sind frei
// ueberschreibbar; zusammengefuehrt wird spaeter ueber den Gruppen-NAMEN,
// nicht ueber TID oder Brand.

test('autoOutletGroup entfernt abschliessende Ziffern und Leerzeichen', () => {
  assert.strictEqual(autoOutletGroup('Lounge 1'), 'Lounge');
  assert.strictEqual(autoOutletGroup('Wunderbar 6'), 'Wunderbar');
  assert.strictEqual(autoOutletGroup('Klub Tür 1'), 'Klub Tür');
  assert.strictEqual(autoOutletGroup('Klub Garderobe 2'), 'Klub Garderobe');
});

test('autoOutletGroup laesst Namen ohne abschliessende Ziffern unveraendert', () => {
  assert.strictEqual(autoOutletGroup('Oceanbar'), 'Oceanbar');
  assert.strictEqual(autoOutletGroup('BSE'), 'BSE');
});

test('autoOutletGroup: Ziffern in der Mitte bleiben stehen', () => {
  assert.strictEqual(autoOutletGroup('Bar 21 Lounge'), 'Bar 21 Lounge');
});

test('autoOutletGroup faellt nicht auf einen leeren Namen zurueck', () => {
  // Ein rein numerischer Name wuerde sonst zur leeren Gruppe - dann lieber
  // den Originalnamen behalten, damit die Zeile im Report zuordenbar bleibt.
  assert.strictEqual(autoOutletGroup('123'), '123');
  assert.strictEqual(autoOutletGroup('  '), '–');
  assert.strictEqual(autoOutletGroup(''), '–');
  assert.strictEqual(autoOutletGroup(null), '–');
  assert.strictEqual(autoOutletGroup(undefined), '–');
});

test('autoBrandGroup trennt Lunch Check von allem uebrigen', () => {
  assert.strictEqual(autoBrandGroup('Lunch Check'), 'Lunch-Check');
  assert.strictEqual(autoBrandGroup('Visa'), 'Wallee');
  assert.strictEqual(autoBrandGroup('Mastercard'), 'Wallee');
  assert.strictEqual(autoBrandGroup('TWINT'), 'Wallee');
  assert.strictEqual(autoBrandGroup('PostFinance Card'), 'Wallee');
  assert.strictEqual(autoBrandGroup('Visa V PAY'), 'Wallee');
  assert.strictEqual(autoBrandGroup('Mastercard Maestro'), 'Wallee');
});

test('autoBrandGroup ist robust gegen leere Werte', () => {
  assert.strictEqual(autoBrandGroup(''), 'Wallee');
  assert.strictEqual(autoBrandGroup(null), 'Wallee');
});

// --- Report-Modell gegen den Testdatensatz ---------------------------------
// Die Sollzahlen stammen aus test/fixtures/beispiel-daten.csv. Dieser Datensatz
// ist FREI ERFUNDEN (erzeugt von test/fixtures/generate-beispiel-daten.mjs) -
// der urspruengliche Datensatz aus der SPEC war ein echter Kundenexport und
// gehoert nicht in ein oeffentliches Repository. Nachgebildet sind die
// fachlich relevanten Faelle: 10 Outlet-Gruppen, ein Merge ueber zwei Gruppen,
// und genau eine Lunch-Check-Zeile.
//
// Der Report-Kern wurde zusaetzlich lokal gegen die echten Daten geprueft und
// reproduziert deren Sollzahlen aus SPEC 10 exakt (52'343.04 / 1'804.24 /
// 1'154 / 1'217, 10 Outlet-Gruppen).

const fs = require('node:fs');
const path = require('node:path');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'beispiel-daten.csv'), 'utf8');
const S = 1e8;                                  // 1e-8-Einheiten -> Waehrungseinheit
const chf = units => (units / S).toFixed(2);

function modell(config) {
  const res = parseReportCsv(FIXTURE);
  assert.strictEqual(res.error, null, 'Fixture muss lesbar sein');
  return buildReportModel(res.rows, config || {});
}

test('Fixture: Auto-Gruppierung ergibt 10 Outlet-Gruppen', () => {
  const m = modell();
  assert.strictEqual(m.detail.length, 10);
  assert.deepStrictEqual(plain(m.detail.map(d => d.outlet)), [
    'Bar', 'Bistro', 'Dachgarten', 'Empfang', 'Galerie',
    'Kiosk', 'Saal Nord', 'Saal Süd', 'Terrasse', 'Weinkeller',
  ]);
});

test('Fixture: Brand-Gruppen sind Wallee und Lunch-Check', () => {
  const m = modell();
  assert.deepStrictEqual(plain(m.brandTotals.map(b => b.brandGroup)), ['Lunch-Check', 'Wallee']);
});

test('Fixture: Total Wallee', () => {
  const w = modell().brandTotals.find(b => b.brandGroup === 'Wallee');
  assert.strictEqual(chf(w.completeDemand), '62725.16');
  assert.strictEqual(chf(w.tip), '793.46');
  assert.strictEqual(w.unmatched, 888);
  assert.strictEqual(w.count, 2068);
});

test('Fixture: Total Lunch-Check', () => {
  const lc = modell().brandTotals.find(b => b.brandGroup === 'Lunch-Check');
  assert.strictEqual(chf(lc.completeDemand), '31.00');
  assert.strictEqual(lc.unmatched, 1);
  assert.strictEqual(lc.count, 2);
});

test('Fixture: Gesamttotal', () => {
  const g = modell().grandTotal;
  assert.strictEqual(chf(g.completeDemand), '62756.16');
  assert.strictEqual(chf(g.tip), '793.46');
  assert.strictEqual(g.unmatched, 889);
  assert.strictEqual(g.count, 2070);
});

test('Fixture: Gesamttotal ist exakt die Summe der Brand-Gruppen', () => {
  const m = modell();
  const summe = m.brandTotals.reduce((a, b) => ({
    completeDemand: a.completeDemand + b.completeDemand,
    tip: a.tip + b.tip,
    unmatched: a.unmatched + b.unmatched,
    count: a.count + b.count,
  }), { completeDemand: 0, tip: 0, unmatched: 0, count: 0 });

  // Ganzzahlen, deshalb hier wirklich exakt und nicht nur auf zwei Stellen.
  assert.deepStrictEqual(plain(summe), plain(m.grandTotal));
});

test('Fixture: Outlet-Totals summieren sich zum Gesamttotal', () => {
  const m = modell();
  const summe = m.outletTotals.reduce((a, o) => a + o.completeDemand, 0);
  assert.strictEqual(summe, m.grandTotal.completeDemand);
});

test('Sonderfall Lunch-Check: eigene Brand-Gruppe innerhalb einer Outlet-Gruppe', () => {
  const m = modell();
  const dachgarten = m.detail.find(d => d.outlet === 'Dachgarten');
  const gruppen = dachgarten.subtotals.map(s => s.brandGroup);

  assert.deepStrictEqual(plain(gruppen), ['Lunch-Check', 'Wallee'],
    'Dachgarten muss beide Brand-Gruppen zeigen');
  const lc = dachgarten.subtotals.find(s => s.brandGroup === 'Lunch-Check');
  assert.strictEqual(chf(lc.completeDemand), '31.00');

  // ... und nur dort.
  const andere = m.outletTotals.filter(o => o.brandGroup === 'Lunch-Check');
  assert.deepStrictEqual(plain(andere.map(o => o.outlet)), ['Dachgarten']);
});

test('Merge: zwei Outlet-Gruppen auf denselben Namen werden zusammengefuehrt', () => {
  const res = parseReportCsv(FIXTURE);
  const tids = {};
  res.rows.forEach(r => { tids[r.name] = r.tid; });

  const vorher = modell();
  const saalNord = vorher.detail.find(d => d.outlet === 'Saal Nord');
  const saalSued = vorher.detail.find(d => d.outlet === 'Saal Süd');
  assert.ok(saalNord && saalSued, 'Ausgangslage: zwei getrennte Gruppen');

  // Beide Seiten explizit auf "Saal" - analog zu "Klub Tür"/"Klub Garderobe" -> "Klub".
  const config = { outlet: {
    [tids['Saal Nord 1']]: 'Saal',
    [tids['Saal Nord 2']]: 'Saal',
    [tids['Saal Süd 1']]: 'Saal',
  }, brand: {} };

  const m = buildReportModel(res.rows, config);
  const namen = m.detail.map(d => d.outlet);

  assert.strictEqual(m.detail.length, 9, 'aus zwei Gruppen wird eine');
  assert.ok(namen.includes('Saal'));
  assert.ok(!namen.includes('Saal Nord') && !namen.includes('Saal Süd'));

  // Das Gesamttotal darf sich durch reines Umgruppieren nicht aendern.
  assert.deepStrictEqual(plain(m.grandTotal), plain(vorher.grandTotal));

  const saal = m.detail.find(d => d.outlet === 'Saal');
  assert.strictEqual(saal.terminals.length, 3, 'alle drei Terminals unter "Saal"');
});

test('Merge fuehrt Brand-Gruppen zusammen', () => {
  const res = parseReportCsv(FIXTURE);
  // Alles in eine einzige Brand-Gruppe kippen.
  const brand = {};
  res.rows.forEach(r => { brand[r.brand] = 'Alle Marken'; });

  const m = buildReportModel(res.rows, { outlet: {}, brand });
  assert.strictEqual(m.brandTotals.length, 1);
  assert.strictEqual(m.brandTotals[0].brandGroup, 'Alle Marken');
  assert.strictEqual(m.brandTotals[0].completeDemand, m.grandTotal.completeDemand);
});

test('leere Eingabe ergibt ein leeres, aber wohlgeformtes Modell', () => {
  const m = buildReportModel([], {});
  assert.deepStrictEqual(plain(m.detail), []);
  assert.deepStrictEqual(plain(m.outletTotals), []);
  assert.deepStrictEqual(plain(m.brandTotals), []);
  assert.deepStrictEqual(plain(m.grandTotal), { completeDemand: 0, tip: 0, unmatched: 0, count: 0 });
});

test('Detail: ein Terminal mit mehreren Brands bleibt eine Terminal-Zeile', () => {
  const m = modell();
  const dachgarten = m.detail.find(d => d.outlet === 'Dachgarten');
  const t = dachgarten.terminals.find(x => x.name === 'Dachgarten 2');
  assert.ok(t.brands.length > 1, 'Terminal muss mehrere Brands tragen');
  const tids = dachgarten.terminals.map(x => x.tid);
  assert.strictEqual(new Set(tids).size, tids.length, 'jede TID nur einmal');
});

// --- Schweizer Zahlformat --------------------------------------------------
// Bewusst von Hand statt ueber toLocaleString('de-CH'): das Trennzeichen haengt
// dort von der ICU-Version des jeweiligen Browsers ab (mal U+2019, mal U+0027).
// Bei Geldbetraegen, die der Kunde gegen den Bankauszug haelt, soll die
// Darstellung nicht vom Browser abhaengen.

test('formatAmountCH: Tausendertrennung und zwei Nachkommastellen', () => {
  assert.strictEqual(formatAmountCH(143670000000), '1’436.70');
  assert.strictEqual(formatAmountCH(3100000000), '31.00');
  assert.strictEqual(formatAmountCH(0), '0.00');
  assert.strictEqual(formatAmountCH(5234304000000), '52’343.04');
});

test('formatAmountCH: mehrere Tausendergruppen', () => {
  assert.strictEqual(formatAmountCH(123456789000000), '1’234’567.89');
});

test('formatAmountCH: negative Betraege', () => {
  assert.strictEqual(formatAmountCH(-1234000000), '-12.34');
  assert.strictEqual(formatAmountCH(-143670000000), '-1’436.70');
});

test('formatAmountCH: rundet kaufmaennisch auf zwei Stellen', () => {
  assert.strictEqual(formatAmountCH(1005000), '0.01');    // 0.01005 -> 0.01
  assert.strictEqual(formatAmountCH(1500000), '0.02');    // 0.015   -> 0.02
  assert.strictEqual(formatAmountCH(-1500000), '-0.02');  // symmetrisch
});

test('formatIntCH: Ganzzahlen mit Tausendertrennung', () => {
  assert.strictEqual(formatIntCH(1154), '1’154');
  assert.strictEqual(formatIntCH(0), '0');
  assert.strictEqual(formatIntCH(-5), '-5');
  assert.strictEqual(formatIntCH(1234567), '1’234’567');
});

// --- Konfiguration gegen neue Daten ----------------------------------------

test('mergeReportConfig: gespeicherte Zuordnungen gewinnen, Rest kommt vom Vorschlag', () => {
  const res = parseReportCsv(FIXTURE);
  const tids = {};
  res.rows.forEach(r => { tids[r.name] = r.tid; });

  const gespeichert = {
    outlet: { [tids['Bar 1']]: 'Hauptbar' },
    brand: { 'TWINT': 'Mobile' },
  };
  const cfg = mergeReportConfig(res.rows, gespeichert);

  assert.strictEqual(cfg.outlet[tids['Bar 1']], 'Hauptbar', 'gespeichert');
  assert.strictEqual(cfg.outlet[tids['Bar 2']], 'Bar', 'neu -> Auto-Vorschlag');
  assert.strictEqual(cfg.brand['TWINT'], 'Mobile', 'gespeichert');
  assert.strictEqual(cfg.brand['Visa'], 'Wallee', 'neu -> Auto-Vorschlag');
});

test('mergeReportConfig: ohne gespeicherte Konfig alles per Auto-Vorschlag', () => {
  const res = parseReportCsv(FIXTURE);
  const cfg = mergeReportConfig(res.rows, null);
  const gruppen = new Set(Object.values(cfg.outlet));

  assert.strictEqual(gruppen.size, 10);
  assert.deepStrictEqual(plain([...new Set(Object.values(cfg.brand))].sort()),
    ['Lunch-Check', 'Wallee']);
});

test('mergeReportConfig: Zuordnungen fuer verschwundene Terminals werden nicht mitgeschleppt', () => {
  const res = parseReportCsv(FIXTURE);
  const gespeichert = { outlet: { 'gibt-es-nicht-mehr': 'Alt' }, brand: {} };
  const cfg = mergeReportConfig(res.rows, gespeichert);

  assert.ok(!('gibt-es-nicht-mehr' in cfg.outlet),
    'Konfig soll nur Terminals des aktuellen Datensatzes enthalten');
});

test('mergeReportConfig: leere gespeicherte Namen fallen auf den Vorschlag zurueck', () => {
  const res = parseReportCsv(FIXTURE);
  const tids = {};
  res.rows.forEach(r => { tids[r.name] = r.tid; });
  const cfg = mergeReportConfig(res.rows, { outlet: { [tids['Bar 1']]: '   ' }, brand: {} });

  assert.strictEqual(cfg.outlet[tids['Bar 1']], 'Bar');
});

// --- Private Mode ----------------------------------------------------------
// Bei blockiertem localStorage soll der Report ohne Persistenz weiterlaufen
// statt zu crashen (SPEC 9).

test('blockiertes localStorage laesst die App trotzdem starten', () => {
  assert.doesNotThrow(() => {
    loadBuilders({ blockLocalStorage: true });
  }, 'Das Laden des Scripts darf im Private Mode nicht werfen');
});

test('Report-Konfiguration im Private Mode: lesen und schreiben werfen nicht', () => {
  const blockiert = loadBuilders({ blockLocalStorage: true });

  assert.doesNotThrow(() => {
    const cfg = blockiert.loadReportConfig();
    assert.strictEqual(cfg, null, 'ohne lesbaren Speicher gibt es keine Konfig');
    blockiert.saveReportConfig({ outlet: { T1: 'Bar' }, brand: {} });
  });
});

test('Report funktioniert im Private Mode ohne Persistenz', () => {
  const blockiert = loadBuilders({ blockLocalStorage: true });
  const res = blockiert.parseReportCsv(FIXTURE);
  assert.strictEqual(res.error, null);

  const cfg = blockiert.mergeReportConfig(res.rows, blockiert.loadReportConfig());
  const m = blockiert.buildReportModel(res.rows, cfg);
  assert.strictEqual(m.detail.length, 10, 'Gruppierung muss auch ohne Speicher stimmen');
});
