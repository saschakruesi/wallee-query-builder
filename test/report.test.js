// Tests fuer den Report-Kern: CSV-Parser, Header-Mapping, Auto-Gruppierung und
// Report-Modell. Alles reine Funktionen, kein DOM - siehe test/harness.js.

const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders, plain } = require('./harness');

const app = loadBuilders();
const { parseReportCsv, autoOutletGroup, autoBrandGroup } = app;

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
