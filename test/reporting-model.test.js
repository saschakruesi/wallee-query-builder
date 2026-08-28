// Reporting-Modus (v5.11): Parser des Query-Ergebnisses.
// parseReportingCsv ist rein und DOM-frei, deshalb hier ohne DOM-Ersatz.
//
// Massgeblich fuer die Spaltennamen ist buildReportingQuery selbst - der
// Waechtertest unten leitet sie aus der erzeugten SQL ab, nicht aus einer
// zweiten Handliste. KOPF hier ist nur der Baustein fuer die synthetischen
// Testzeilen. Die Terminal-Variante haengt zwei weitere Spalten an; die sind
// optional und werden separat geprueft.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadBuilders, plain } = require('./harness');

// Reihenfolge wie in der Query. Der Parser loest ueber den Header-Index auf,
// die Reihenfolge ist ihm also egal - hier steht sie trotzdem original da,
// damit die Fixture und die Tests dieselbe Datei beschreiben.
const KOPF = [
  'block', 'space_id', 'channel', 'brand', 'wallet', 'waehrung', 'attempt_state',
  'failure_reason_id', 'auth_response_code', 'issuer_country', 'card_category',
  'funding', 'pan_type', 'dcc', 'tds_started', 'tds_cavv', 'eci', 'tag', 'stunde',
  'anzahl_attempts', 'anzahl_transaktionen', 'summe_betrag', 'summe_betrag_failed',
  'summe_refund', 'tx_mit_attempt', 'tx_erfolgreich',
];

const q = v => '"' + String(v == null ? '' : v) + '"';

// Baut eine CSV-Zeile aus einem Objekt mit Spaltennamen als Schluessel; alles
// nicht Genannte bleibt leer (genau das, was die typisierten NULL-Platzhalter
// der Bloecke TIME und CONV in der CSV erzeugen).
// Der Schluessel wird kleingeschrieben nachgeschlagen, damit derselbe
// Zeilenbauer auch fuer die gross geschriebene Kopfzeile funktioniert.
function zeile(werte, kopf = KOPF) {
  return kopf.map(k => {
    const v = werte[k.toLowerCase()];
    return q(v === undefined ? '' : v);
  }).join(',');
}
function csv(zeilen, kopf = KOPF) {
  return [kopf.map(q).join(','), ...zeilen.map(z => zeile(z, kopf))].join('\n') + '\n';
}

const DIM = {
  block: 'DIM', space_id: '90001', channel: 'POS', brand: 'Visa', wallet: '-',
  waehrung: 'CHF', attempt_state: 'SUCCESSFUL', failure_reason_id: '',
  auth_response_code: '00', issuer_country: 'CH', card_category: 'CLASSIC',
  funding: 'DEBIT', pan_type: '', dcc: 'false', tds_started: 'false',
  tds_cavv: 'false', eci: '', anzahl_attempts: '10', anzahl_transaktionen: '10',
  summe_betrag: '200.00000000', summe_betrag_failed: '0.00000000',
  summe_refund: '0.00000000',
};
const TIME = {
  block: 'TIME', space_id: '90001', channel: 'POS', brand: 'Visa', waehrung: 'CHF',
  attempt_state: 'SUCCESSFUL', tag: '2026-07-01', stunde: '13',
  anzahl_attempts: '4', summe_betrag: '80.00000000',
};
const CONV = {
  block: 'CONV', space_id: '90002', channel: 'ECOM', brand: 'Visa', waehrung: 'EUR',
  tx_mit_attempt: '17', tx_erfolgreich: '12',
};

// Liest die Aliasse des ERSTEN SELECT-Blocks (DIM) aus einer erzeugten Query.
// Bewusst aus der SQL statt aus einer zweiten Handliste: zwei von Hand
// gepflegte Listen bleiben zueinander konsistent, auch wenn beide gegen die
// Query falsch sind - genau der Fall, den der Waechter erwischen soll, waere
// der einzige, den er nicht saehe. Der UNION ALL erzwingt fuer alle Bloecke
// dieselben Spalten, deshalb reicht der erste.
function spaltenAusQuery(sql) {
  const von = sql.indexOf('\nSELECT\n');
  const bis = sql.indexOf('\nFROM att', von);
  assert.ok(von >= 0 && bis > von, 'DIM-SELECT-Block in der Query nicht gefunden');
  return sql.slice(von + '\nSELECT\n'.length, bis).split('\n')
    .map(z => z.replace(/--.*$/, '').trim())
    .filter(z => z && z !== ',')
    .map(z => {
      // Letztes "AS <name>" der Zeile gewinnt: CAST(x AS varchar) AS x traegt
      // zwei, und nur das hintere ist der Spaltenname.
      const mitAlias = /\bAS\s+([a-z_][a-z0-9_]*)\s*,?\s*$/i.exec(z);
      if (mitAlias) return mitAlias[1].toLowerCase();
      // Nackte Spalte ohne Alias (space_id, channel, ...).
      const nackt = /^([a-z_][a-z0-9_]*)\s*,?\s*$/i.exec(z);
      return nackt ? nackt[1].toLowerCase() : null;
    })
    .filter(Boolean);
}

const QUERY_ARGS = {
  spaceIds: ['40402'], start: '2026-07-01 00:00:00', end: '2026-08-01 00:00:00',
  channels: [], byTerminal: false, terminalIds: [],
};

test('REPORTING_PFLICHT deckt sich mit der SELECT-Liste von buildReportingQuery', () => {
  const { buildReportingQuery, REPORTING_PFLICHT } = loadBuilders();
  const ausQuery = spaltenAusQuery(buildReportingQuery(QUERY_ARGS));
  // Reihenfolge inklusive: der Parser loest zwar ueber den Namen auf, aber eine
  // vertauschte Liste waere ein Zeichen, dass jemand die Query umgebaut hat.
  assert.deepStrictEqual(plain([...REPORTING_PFLICHT]), ausQuery);
});

test('KOPF der Testzeilen deckt sich mit der SELECT-Liste von buildReportingQuery', () => {
  const { buildReportingQuery } = loadBuilders();
  // Sonst wuerden die synthetischen Zeilen dieser Datei eine CSV beschreiben,
  // die es gar nicht gibt.
  assert.deepStrictEqual(KOPF, spaltenAusQuery(buildReportingQuery(QUERY_ARGS)));
});

test('die Terminal-Variante haengt genau die zwei optionalen Spalten an', () => {
  const { buildReportingQuery, REPORTING_PFLICHT } = loadBuilders();
  const mitTerminal = spaltenAusQuery(
    buildReportingQuery(Object.assign({}, QUERY_ARGS, { byTerminal: true })));
  const zusatz = mitTerminal.filter(k => plain([...REPORTING_PFLICHT]).indexOf(k) === -1);
  assert.deepStrictEqual(zusatz, ['terminal_identifier', 'terminal_name']);
});

test('parseReportingCsv: leerer Text ergibt einen Fehler, wirft aber nicht', () => {
  const { parseReportingCsv } = loadBuilders();
  const r = parseReportingCsv('');
  assert.ok(r.error, 'leerer Text muss einen Fehler ergeben');
  assert.match(r.error.message, /leer/i);
  assert.deepStrictEqual(
    { d: r.rows.dim.length, t: r.rows.time.length, c: r.rows.conv.length },
    { d: 0, t: 0, c: 0 },
  );
});

test('parseReportingCsv: fehlende Pflichtspalte ergibt error statt Wurf', () => {
  const { parseReportingCsv } = loadBuilders();
  const ohneBlock = KOPF.filter(k => k !== 'block');
  const r = parseReportingCsv(csv([DIM], ohneBlock));
  assert.ok(r.error, 'ohne block-Spalte muss ein Fehler kommen');
  assert.match(r.error.message, /block/);
  assert.strictEqual(r.rows.dim.length, 0);
});

test('parseReportingCsv: mehrere fehlende Pflichtspalten werden alle genannt', () => {
  const { parseReportingCsv } = loadBuilders();
  const kopf = KOPF.filter(k => k !== 'summe_betrag' && k !== 'anzahl_attempts');
  const r = parseReportingCsv(csv([DIM], kopf));
  assert.ok(r.error);
  assert.match(r.error.message, /anzahl_attempts/);
  assert.match(r.error.message, /summe_betrag/);
});

test('parseReportingCsv: Terminal-Spalten sind optional', () => {
  const { parseReportingCsv } = loadBuilders();
  const r = parseReportingCsv(csv([DIM]));
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.rows.dim[0].terminalIdentifier, 'UNKNOWN');
});

test('parseReportingCsv: Terminal-Variante fuellt die Terminal-Spalten', () => {
  const { parseReportingCsv } = loadBuilders();
  const kopf = KOPF.slice(0, KOPF.indexOf('tag'))
    .concat(['terminal_identifier', 'terminal_name'], KOPF.slice(KOPF.indexOf('tag')));
  const mitTerm = Object.assign({}, DIM, {
    terminal_identifier: 'T-0815', terminal_name: 'Kasse 1',
  });
  const r = parseReportingCsv(csv([mitTerm], kopf));
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.rows.dim[0].terminalIdentifier, 'T-0815');
  assert.strictEqual(r.rows.dim[0].terminalName, 'Kasse 1');
});

test('parseReportingCsv: verteilt die Zeilen auf dim/time/conv', () => {
  const { parseReportingCsv } = loadBuilders();
  const r = parseReportingCsv(csv([DIM, TIME, CONV, DIM]));
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.rows.dim.length, 2);
  assert.strictEqual(r.rows.time.length, 1);
  assert.strictEqual(r.rows.conv.length, 1);
  assert.strictEqual(r.rows.time[0].tag, '2026-07-01');
  assert.strictEqual(r.rows.time[0].stunde, 13);
  assert.strictEqual(r.rows.conv[0].txMitAttempt, 17);
  assert.strictEqual(r.rows.conv[0].txErfolgreich, 12);
});

test('parseReportingCsv: unbekannter block-Wert wird nicht eingemischt, sondern gezaehlt', () => {
  const { parseReportingCsv } = loadBuilders();
  const fremd = Object.assign({}, DIM, { block: 'FOO' });
  const r = parseReportingCsv(csv([DIM, fremd]));
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.rows.dim.length, 1);
  assert.strictEqual(r.rows.time.length, 0);
  assert.strictEqual(r.rows.conv.length, 0);
  assert.strictEqual(r.unbekannteBloecke, 1);
});

test('parseReportingCsv: Betraege werden zu 1e-8-Ganzzahlen zerlegt', () => {
  const { parseReportingCsv } = loadBuilders();
  const r = parseReportingCsv(csv([
    Object.assign({}, DIM, {
      summe_betrag: '1234.5',
      summe_betrag_failed: '-0.07',
      summe_refund: '19.99000000',
    }),
  ]));
  assert.strictEqual(r.rows.dim[0].betrag, 123450000000);
  assert.strictEqual(r.rows.dim[0].betragFailed, -7000000);
  assert.strictEqual(r.rows.dim[0].refund, 1999000000);
});

test('parseReportingCsv: Betragssummen bleiben exakt (kein float)', () => {
  const { parseReportingCsv } = loadBuilders();
  const r = parseReportingCsv(csv([
    Object.assign({}, DIM, { summe_betrag: '0.10000000' }),
    Object.assign({}, DIM, { summe_betrag: '0.20000000' }),
  ]));
  const summe = r.rows.dim.reduce((a, z) => a + z.betrag, 0);
  assert.strictEqual(summe, 30000000);
});

test('parseReportingCsv: Zaehlwerte sind Integer, leer ergibt 0', () => {
  const { parseReportingCsv } = loadBuilders();
  const r = parseReportingCsv(csv([
    Object.assign({}, DIM, { anzahl_attempts: '7', anzahl_transaktionen: '' }),
  ]));
  assert.strictEqual(r.rows.dim[0].attempts, 7);
  assert.strictEqual(r.rows.dim[0].transaktionen, 0);
});

test('parseReportingCsv: leere Dimensionen landen im UNKNOWN-Eimer', () => {
  const { parseReportingCsv } = loadBuilders();
  const r = parseReportingCsv(csv([
    Object.assign({}, DIM, {
      issuer_country: '', brand: '', wallet: '', card_category: '', funding: '',
      pan_type: '', eci: '', auth_response_code: '', failure_reason_id: '',
      channel: '', space_id: '', waehrung: '', attempt_state: '',
    }),
  ]));
  const z = r.rows.dim[0];
  ['spaceId', 'channel', 'brand', 'wallet', 'waehrung', 'attemptState',
    'failureReasonId', 'authResponseCode', 'issuerCountry', 'cardCategory',
    'funding', 'panType', 'eci'].forEach(k => {
    assert.strictEqual(z[k], 'UNKNOWN', k + ' muss UNKNOWN sein, nicht ' + JSON.stringify(z[k]));
  });
});

test('parseReportingCsv: boolesche Spalten ergeben true/false/null', () => {
  const { parseReportingCsv } = loadBuilders();
  // Die drei Formen, die der Connector wirklich schreibt (Task 0): ein
  // Liability-Shift-Label gibt es nicht, deshalb steht es auch nicht in der
  // Query - geprueft werden die drei Booleans, die es gibt.
  const r = parseReportingCsv(csv([
    Object.assign({}, DIM, { dcc: 'true', tds_started: 'true', tds_cavv: 'true' }),
    Object.assign({}, DIM, { dcc: 'false', tds_started: 'true', tds_cavv: 'false' }),
    Object.assign({}, DIM, { dcc: '', tds_started: '', tds_cavv: '' }),
  ]));
  assert.deepStrictEqual(
    plain(r.rows.dim.map(z => [z.dcc, z.tdsStarted, z.tdsCavv])),
    [[true, true, true], [false, true, false], [null, null, null]],
  );
});

test('parseReportingCsv: TIME ohne stunde ergibt null, nicht Stunde 0', () => {
  const { parseReportingCsv } = loadBuilders();
  const r = parseReportingCsv(csv([Object.assign({}, TIME, { stunde: '', tag: '' })]));
  assert.strictEqual(r.rows.time[0].stunde, null);
  assert.strictEqual(r.rows.time[0].tag, 'UNKNOWN');
});

test('parseReportingCsv: zu kurze Zeile faellt auf UNKNOWN/0 zurueck, ohne Wurf', () => {
  const { parseReportingCsv } = loadBuilders();
  // Abgeschnittene Zeile (Download abgebrochen, Datei von Hand gekuerzt): der
  // Zugriff laeuft ins Leere, statt zu werfen - fehlende Dimensionen werden
  // UNKNOWN, fehlende Zaehler und Betraege 0.
  const text = KOPF.map(q).join(',') + '\n"DIM","90001","POS"\n';
  const r = parseReportingCsv(text);
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.rows.dim.length, 1);
  assert.strictEqual(r.rows.dim[0].channel, 'POS');
  assert.strictEqual(r.rows.dim[0].brand, 'UNKNOWN');
  assert.strictEqual(r.rows.dim[0].attempts, 0);
  assert.strictEqual(r.rows.dim[0].betrag, 0);
  assert.strictEqual(r.rows.dim[0].dcc, null);
});

test('parseReportingCsv: Zeile aus lauter leeren Feldern zaehlt nicht als unbekannter Block', () => {
  const { parseReportingCsv } = loadBuilders();
  // ",,,,..." hat volle Breite und ist trotzdem eine Leerzeile - sie darf den
  // Zaehler fuer unbekannte Bloecke nicht hochtreiben.
  const text = csv([DIM]) + KOPF.map(() => '""').join(',') + '\n';
  const r = parseReportingCsv(text);
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.rows.dim.length, 1);
  assert.strictEqual(r.unbekannteBloecke, 0);
});

test('parseReportingCsv: Kopfzeile wird case-insensitiv gelesen', () => {
  const { parseReportingCsv } = loadBuilders();
  const kopf = KOPF.map(k => k.toUpperCase());
  const r = parseReportingCsv(csv([DIM], kopf));
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.rows.dim.length, 1);
});

test('parseReportingCsv: Fixture parst fehlerfrei und die Zeilensummen stimmen', () => {
  const { parseReportingCsv } = loadBuilders();
  const text = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'reporting-beispiel.csv'), 'utf8');
  const r = parseReportingCsv(text);
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.unbekannteBloecke, 0);

  // Zeilenzahl gegen die Rohdatei: Kopfzeile weg, der Rest muss vollstaendig
  // in genau einem der drei Bloecke gelandet sein.
  const datenzeilen = text.trim().split('\n').length - 1;
  assert.strictEqual(
    r.rows.dim.length + r.rows.time.length + r.rows.conv.length, datenzeilen);
  assert.ok(r.rows.dim.length > 0 && r.rows.time.length > 0 && r.rows.conv.length > 0);

  // Sollwerte der Fixture. Sie nageln die Betraege fest, nicht nur die
  // Zeilenzahl - ein Parser, der die 1e-8-Zerlegung verliert oder leere
  // NULL-Felder anders behandelt, faellt hier auf. Unabhaengig aus der Rohdatei
  // nachgerechnet (Decimal-Summe der Spalten), nicht vom Parser uebernommen.
  // Zugleich die Basislinie fuer das Modell in Task 3.
  const summe = (liste, feld) => liste.reduce((a, z) => a + z[feld], 0);
  assert.strictEqual(summe(r.rows.dim, 'betrag'), 5441239000000);        // 54'412.39
  assert.strictEqual(summe(r.rows.dim, 'betragFailed'), 377444000000);   //  3'774.44
  assert.strictEqual(summe(r.rows.dim, 'refund'), 212143000000);         //  2'121.43
  assert.strictEqual(summe(r.rows.dim, 'attempts'), 1854);
  assert.strictEqual(summe(r.rows.time, 'attempts'), 872);
  assert.strictEqual(summe(r.rows.time, 'betrag'), 1649053000000);       // 16'490.53
  assert.strictEqual(summe(r.rows.conv, 'txMitAttempt'), 1682);
  assert.strictEqual(summe(r.rows.conv, 'txErfolgreich'), 1622);

  // Die Faelle, die die Fixture bewusst abdeckt (siehe
  // test/fixtures/generate-reporting-beispiel.mjs).
  const kanaele = new Set(r.rows.dim.map(z => z.channel));
  assert.deepStrictEqual([...kanaele].sort(), ['ECOM', 'OTHER', 'POS']);
  assert.ok(r.rows.dim.some(z => z.brand === 'TWINT'), 'Nicht-Karten-Brand fehlt');
  assert.ok(r.rows.dim.some(z => z.wallet !== 'UNKNOWN' && z.wallet !== '-'),
    'Wallet-Zeile fehlt');
  assert.ok(new Set(r.rows.dim.map(z => z.waehrung)).size >= 2, 'zweite Waehrung fehlt');
  assert.ok(r.rows.dim.some(z => z.attemptState === 'FAILED'));
  assert.ok(r.rows.dim.some(z => z.attemptState === 'SUCCESSFUL'));
  assert.ok(r.rows.dim.some(z => z.issuerCountry === 'UNKNOWN'),
    'leeres issuer_country fehlt');
  // Die drei 3DS-Auspraegungen aus SPEC 3.1 (tds_status wird erst in Task 3
  // clientseitig daraus abgeleitet - hier zaehlen nur die Rohfelder).
  assert.ok(r.rows.dim.some(z => z.tdsStarted === true && z.tdsCavv === true));
  assert.ok(r.rows.dim.some(z => z.tdsStarted === true && z.tdsCavv === false));
  assert.ok(r.rows.dim.some(z => z.tdsStarted === false && z.eci !== 'UNKNOWN'));

  // SPEC 7: PENDING gehoert in die Kacheln als "offen" und aus allen Quoten
  // heraus - beide Betragsspalten sind dort NULL, also 0.
  const pending = r.rows.dim.filter(z => z.attemptState === 'PENDING');
  assert.strictEqual(pending.length, 1);
  assert.deepStrictEqual(plain([pending[0].betrag, pending[0].betragFailed]), [0, 0]);
  assert.ok(r.rows.time.some(z => z.attemptState === 'PENDING'),
    'PENDING fehlt im TIME-Block');

  // SPEC 7: Issuer-Land in abweichendem Format. Der Parser reicht den Rohwert
  // durch; normalisiert wird erst im Modell (Task 3) - nie zu INTER.
  assert.ok(r.rows.dim.some(z => z.issuerCountry === 'CHE'),
    'ISO-3-Landescode fehlt');
});

// ---------------------------------------------------------------------------
// Task 3 — Modell: buildReportingModel und die Klassifikations-Funktionen.
//
// Die Rechenfaelle laufen bewusst ueber handgerechnete Mini-Zeilen und nicht
// ueber die grosse Fixture: eine Quote von 80.0 % ist nur dann eine Aussage
// ueber den Code, wenn der Sollwert von Hand nachvollziehbar ist. Die Fixture
// prueft am Schluss die Struktur im Grossen.
//
// Einheiten: Betraege sind ganzzahlige 1e-8-Einheiten (100.00 = 10000000000),
// Prozentwerte sind Zahlen von 0 bis 100 in voller Genauigkeit.

const E8 = 100000000; // eine Waehrungseinheit in 1e-8-Einheiten

// Eine DIM-Zeile in der Form, die parseReportingCsv liefert. Alles nicht
// Genannte traegt einen unauffaelligen Vorgabewert, damit jeder Test nur die
// Felder nennt, um die es ihm geht.
function dimZeile(over) {
  return Object.assign({
    spaceId: '90001', channel: 'POS', brand: 'Visa', wallet: '-', waehrung: 'CHF',
    attemptState: 'SUCCESSFUL', failureReasonId: 'UNKNOWN', authResponseCode: 'UNKNOWN',
    issuerCountry: 'CH', cardCategory: 'CLASSIC', funding: 'DEBIT', panType: 'UNKNOWN',
    eci: 'UNKNOWN', dcc: false, tdsStarted: false, tdsCavv: false,
    terminalIdentifier: 'UNKNOWN', terminalName: 'UNKNOWN',
    attempts: 1, transaktionen: 1, betrag: 0, betragFailed: 0, refund: 0,
  }, over);
}
function timeZeile(over) {
  return Object.assign({
    spaceId: '90001', channel: 'POS', brand: 'Visa', waehrung: 'CHF',
    attemptState: 'SUCCESSFUL', tag: '2026-07-01', stunde: 8,
    attempts: 1, betrag: 0,
  }, over);
}
function convZeile(over) {
  return Object.assign({
    spaceId: '90001', channel: 'POS', brand: 'Visa', waehrung: 'CHF',
    txMitAttempt: 1, txErfolgreich: 1,
  }, over);
}
function modell(rows, optionen) {
  const { buildReportingModel } = loadBuilders();
  return buildReportingModel(
    Object.assign({ dim: [], time: [], conv: [] }, rows),
    Object.assign({ merchantCountry: 'CH' }, optionen));
}

test('K1: Success Rate zaehlt PENDING als offen und laesst es aus der Quote', () => {
  const m = modell({ dim: [
    dimZeile({ attemptState: 'SUCCESSFUL', attempts: 8 }),
    dimZeile({ attemptState: 'FAILED', attempts: 2 }),
    dimZeile({ attemptState: 'PENDING', attempts: 1 }),
  ] });
  const k = m.kanaele.POS.kpi;
  assert.strictEqual(k.attempts, 11);
  assert.strictEqual(k.erfolgreich, 8);
  assert.strictEqual(k.fehlgeschlagen, 2);
  assert.strictEqual(k.offen, 1);
  assert.strictEqual(k.abgeschlossen, 10);
  assert.strictEqual(k.successRate, 80);
  assert.strictEqual(k.failureRate, 20);
});

test('Kanal ohne Zeilen ist null, nicht ein leeres Objekt', () => {
  const m = modell({ dim: [dimZeile({ channel: 'POS' })] });
  assert.ok(m.kanaele.POS);
  assert.strictEqual(m.kanaele.ECOM, null);
  assert.strictEqual(m.kanaele.OTHER, null);
  assert.deepStrictEqual(plain(m.kanalListe), ['POS']);
});

test('K2: Brand-Anteile nach Anzahl und Betrag summieren auf 100 %, Wallet eigene Zeile', () => {
  const m = modell({ dim: [
    dimZeile({ channel: 'ECOM', brand: 'Visa', attempts: 60, betrag: 600 * E8 }),
    dimZeile({ channel: 'ECOM', brand: 'Mastercard', attempts: 30, betrag: 300 * E8 }),
    dimZeile({ channel: 'ECOM', brand: 'Visa', wallet: 'Apple Pay', attempts: 10, betrag: 100 * E8 }),
  ] });
  const kanal = m.kanaele.ECOM;
  const namen = kanal.brands.map(b => b.brand);
  assert.deepStrictEqual(plain(namen), ['Visa', 'Mastercard']);
  const visa = kanal.brands[0];
  assert.strictEqual(visa.attempts, 70);
  assert.strictEqual(visa.anteilAttempts, 70);
  assert.strictEqual(kanal.brands[1].anteilAttempts, 30);
  assert.strictEqual(kanal.brands.reduce((a, b) => a + b.anteilAttempts, 0), 100);
  // Betragsanteil je Waehrung - nie ueber Waehrungen hinweg summiert.
  const anteile = kanal.brands.map(b => b.waehrungen[0].anteilBetrag);
  assert.deepStrictEqual(plain(anteile), [70, 30]);
  assert.strictEqual(anteile.reduce((a, x) => a + x, 0), 100);
  // Wallet ist eine eigene Zeile, nicht ein weiterer Brand.
  assert.deepStrictEqual(plain(kanal.wallets.map(w => [w.wallet, w.attempts, w.anteilAttempts])),
    [['Apple Pay', 10, 10]]);
  assert.strictEqual(kanal.kpi.walletAnteil, 10);
});

test('klassifiziereHerkunft: Inland, Europa, Rest, Unbekannt', () => {
  const { klassifiziereHerkunft } = loadBuilders();
  assert.strictEqual(klassifiziereHerkunft('CH', 'CH'), 'DOMESTIC');
  assert.strictEqual(klassifiziereHerkunft('DE', 'CH'), 'INTRA');
  assert.strictEqual(klassifiziereHerkunft('GB', 'CH'), 'INTRA');
  assert.strictEqual(klassifiziereHerkunft('US', 'CH'), 'INTER');
  assert.strictEqual(klassifiziereHerkunft('UNKNOWN', 'CH'), 'UNKNOWN');
  assert.strictEqual(klassifiziereHerkunft('ch', 'CH'), 'DOMESTIC');
  // SPEC 7: ISO-3 oder Klarname sind kein Ausland, sondern unbekannt.
  assert.strictEqual(klassifiziereHerkunft('DEU', 'CH'), 'UNKNOWN');
  assert.strictEqual(klassifiziereHerkunft('', 'CH'), 'UNKNOWN');
  assert.strictEqual(klassifiziereHerkunft('Schweiz', 'CH'), 'UNKNOWN');
  // Haendler-Land in DE: dann ist DE das Inland und CH die Nachbarschaft.
  assert.strictEqual(klassifiziereHerkunft('DE', 'DE'), 'DOMESTIC');
  assert.strictEqual(klassifiziereHerkunft('CH', 'DE'), 'INTRA');
});

test('istKartenBrand trennt Scheme-Karten von TWINT und PostFinance', () => {
  const { istKartenBrand } = loadBuilders();
  ['Visa', 'Mastercard', 'Mastercard Maestro', 'Visa V PAY', 'American Express',
    'Diners Club', 'JCB', 'UnionPay', 'Discover'].forEach(b => {
    assert.ok(istKartenBrand(b), b + ' sollte als Karte gelten');
  });
  ['TWINT', 'PostFinance Card', 'Lunch Check', 'Reka', 'PowerPay Invoice',
    'UNKNOWN', ''].forEach(b => {
    assert.ok(!istKartenBrand(b), b + ' sollte NICHT als Karte gelten');
  });
});

test('klassifiziereKartentyp: NOT_SPECIFIED ist UNKNOWN, nie PRIVATE', () => {
  const { klassifiziereKartentyp } = loadBuilders();
  assert.strictEqual(klassifiziereKartentyp('NOT_SPECIFIED'), 'UNKNOWN');
  assert.strictEqual(klassifiziereKartentyp('WORLD_ELITE_BUSINESS'), 'BUSINESS');
  assert.strictEqual(klassifiziereKartentyp('CLASSIC'), 'PRIVATE');
  assert.strictEqual(klassifiziereKartentyp('CORPORATE_T_E'), 'BUSINESS');
  assert.strictEqual(klassifiziereKartentyp('PREPAID_PURCHASING'), 'BUSINESS');
  assert.strictEqual(klassifiziereKartentyp('FLEET'), 'BUSINESS');
  assert.strictEqual(klassifiziereKartentyp('COMMERCIAL'), 'BUSINESS');
  assert.strictEqual(klassifiziereKartentyp(''), 'UNKNOWN');
  assert.strictEqual(klassifiziereKartentyp('UNKNOWN'), 'UNKNOWN');
});

test('K5/K6: nur Karten-Brands zaehlen, TWINT beeinflusst die Quoten nicht', () => {
  const karten = [
    dimZeile({ brand: 'Visa', cardCategory: 'CLASSIC', attempts: 6, issuerCountry: 'CH' }),
    dimZeile({ brand: 'Visa', cardCategory: 'WORLD_ELITE_BUSINESS', attempts: 2, issuerCountry: 'DE' }),
    dimZeile({ brand: 'Visa', cardCategory: 'NOT_SPECIFIED', attempts: 2, issuerCountry: 'US' }),
  ];
  const ohne = modell({ dim: karten });
  const mit = modell({ dim: karten.concat([
    dimZeile({ brand: 'TWINT', cardCategory: 'UNKNOWN', issuerCountry: 'UNKNOWN', attempts: 90 }),
  ]) });
  assert.strictEqual(ohne.kanaele.POS.kartentyp.basis, 10);
  assert.strictEqual(mit.kanaele.POS.kartentyp.basis, 10);
  assert.deepStrictEqual(plain(mit.kanaele.POS.kartentyp.gruppen.map(g => [g.schluessel, g.attempts, g.anteilAttempts])),
    [['BUSINESS', 2, 20], ['PRIVATE', 6, 60], ['UNKNOWN', 2, 20]]);
  // K6 haengt am selben Nenner - TWINT hat kein Issuer-Land und faellt nicht
  // in den UNKNOWN-Eimer der Karten.
  assert.strictEqual(mit.kanaele.POS.herkunft.basis, 10);
  assert.deepStrictEqual(plain(mit.kanaele.POS.herkunft.gruppen.map(g => [g.schluessel, g.attempts])),
    [['DOMESTIC', 6], ['INTRA', 2], ['INTER', 2], ['UNKNOWN', 0]]);
  // SPEC 8, Check 4: die Eimer summieren auf 100 % der erfolgreichen Karten.
  assert.strictEqual(mit.kanaele.POS.herkunft.gruppen.reduce((a, g) => a + g.anteilAttempts, 0), 100);
  // Top-Laender: sortiert, mit ihrer Einstufung.
  assert.deepStrictEqual(plain(mit.kanaele.POS.herkunft.laender.map(l => [l.land, l.attempts, l.herkunft])),
    [['CH', 6, 'DOMESTIC'], ['DE', 2, 'INTRA'], ['US', 2, 'INTER']]);
});

test('P1: Debit/Credit ebenfalls nur ueber Karten-Attempts', () => {
  const m = modell({ dim: [
    dimZeile({ brand: 'Visa', funding: 'DEBIT', attempts: 7 }),
    dimZeile({ brand: 'Visa', funding: 'CREDIT', attempts: 3 }),
    dimZeile({ brand: 'TWINT', funding: 'UNKNOWN', attempts: 40 }),
  ] });
  assert.deepStrictEqual(plain(m.kanaele.POS.funding.gruppen.map(g => [g.schluessel, g.attempts, g.anteilAttempts])),
    [['CREDIT', 3, 30], ['DEBIT', 7, 70], ['UNKNOWN', 0, 0]]);
  assert.strictEqual(m.kanaele.POS.funding.basis, 10);
});

test('K7/K9: Ø-Betrag und Refund-Quote je Waehrung, nie gemischt', () => {
  const m = modell({ dim: [
    dimZeile({ waehrung: 'CHF', attempts: 4, betrag: 100 * E8, refund: 10 * E8 }),
    dimZeile({ waehrung: 'EUR', attempts: 5, betrag: 50 * E8 }),
    dimZeile({ waehrung: 'CHF', attemptState: 'FAILED', attempts: 2, betragFailed: 30 * E8 }),
  ] });
  const w = m.kanaele.POS.waehrungen;
  assert.deepStrictEqual(plain(w.map(x => x.waehrung)), ['CHF', 'EUR']);
  assert.strictEqual(w[0].schnitt, 25 * E8);
  assert.strictEqual(w[1].schnitt, 10 * E8);
  assert.strictEqual(w[0].refundQuote, 10);
  // EUR hat Umsatz, aber keine Rueckerstattung: 0 % ist hier ein gemessener
  // Wert, kein fehlender - null gaebe es nur ohne jeden Umsatz.
  assert.strictEqual(w[1].refundQuote, 0);
  assert.strictEqual(w[0].schnittFailed, 15 * E8);
  assert.strictEqual(w[1].schnittFailed, null);
  // Der Kanal fasst NIE ueber Waehrungen zusammen - es gibt kein kpi.betrag.
  assert.strictEqual(m.kanaele.POS.kpi.betrag, undefined);
});

test('klassifiziereTds unterscheidet die vier Auspraegungen', () => {
  const { klassifiziereTds } = loadBuilders();
  assert.strictEqual(klassifiziereTds({ started: true, cavv: true }), 'AUTHENTICATED');
  assert.strictEqual(klassifiziereTds({ started: true, cavv: false }), 'FAILED_OR_ABANDONED');
  assert.strictEqual(klassifiziereTds({ started: true, cavv: null }), 'FAILED_OR_ABANDONED');
  assert.strictEqual(klassifiziereTds({ started: false, eci: '07' }), 'WALLET_CRYPTOGRAM');
  assert.strictEqual(klassifiziereTds({ started: false, eci: 'UNKNOWN' }), 'NOT_REQUESTED');
  assert.strictEqual(klassifiziereTds({ started: false, eci: '' }), 'NOT_REQUESTED');
  assert.strictEqual(klassifiziereTds({}), 'NOT_REQUESTED');
  // Wallet-Kryptogramm nur ohne 3DS-Start: mit Start gewinnt das echte 3DS.
  assert.strictEqual(klassifiziereTds({ started: true, cavv: true, eci: '05' }), 'AUTHENTICATED');
});

test('E1: 3DS-Akzeptanz 70.0 % und Angefordert-Anteil 66.7 %', () => {
  const m = modell({ dim: [
    dimZeile({ channel: 'ECOM', attempts: 7, tdsStarted: true, tdsCavv: true, eci: '05' }),
    dimZeile({ channel: 'ECOM', attempts: 3, tdsStarted: true, tdsCavv: false }),
    dimZeile({ channel: 'ECOM', attempts: 2, tdsStarted: false, eci: '07' }),
    dimZeile({ channel: 'ECOM', attempts: 3, tdsStarted: false }),
  ] });
  const tds = m.kanaele.ECOM.tds;
  assert.strictEqual(tds.basis, 15);
  assert.strictEqual(tds.akzeptanz, 70);
  assert.strictEqual(Math.round(tds.angefordertAnteil * 10) / 10, 66.7);
  assert.strictEqual(Math.round(tds.walletAnteil * 1000) / 1000, 13.333);
  assert.deepStrictEqual(plain(tds.gruppen.map(g => [g.schluessel, g.attempts])),
    [['AUTHENTICATED', 7], ['FAILED_OR_ABANDONED', 3], ['WALLET_CRYPTOGRAM', 2], ['NOT_REQUESTED', 3]]);
});

test('E2: Success Rate je 3DS-Status', () => {
  const m = modell({ dim: [
    dimZeile({ channel: 'ECOM', attempts: 8, tdsStarted: true, tdsCavv: true }),
    dimZeile({ channel: 'ECOM', attempts: 2, attemptState: 'FAILED', tdsStarted: true, tdsCavv: true }),
    dimZeile({ channel: 'ECOM', attempts: 5, attemptState: 'FAILED', tdsStarted: true, tdsCavv: false }),
  ] });
  const nach = {};
  m.kanaele.ECOM.tds.gruppen.forEach(g => { nach[g.schluessel] = g.successRate; });
  assert.strictEqual(nach.AUTHENTICATED, 80);
  assert.strictEqual(nach.FAILED_OR_ABANDONED, 0);
  assert.strictEqual(nach.NOT_REQUESTED, null);
});

test('E3/E4: Conversion aus CONV, Retry-Rate als Faktor', () => {
  const m = modell({
    dim: [
      dimZeile({ channel: 'ECOM', brand: 'Visa', attempts: 80 }),
      dimZeile({ channel: 'ECOM', brand: 'Visa', attemptState: 'FAILED', attempts: 50 }),
    ],
    conv: [convZeile({ channel: 'ECOM', brand: 'Visa', txMitAttempt: 100, txErfolgreich: 80 })],
  });
  const kanal = m.kanaele.ECOM;
  assert.strictEqual(kanal.kpi.transaktionen, 100);
  assert.strictEqual(kanal.kpi.txErfolgreich, 80);
  assert.strictEqual(kanal.kpi.conversion, 80);
  // Retry-Rate ist ein Faktor (Attempts je Transaktion), kein Prozentwert.
  assert.strictEqual(kanal.kpi.retryRate, 1.3);
  assert.strictEqual(kanal.brands[0].conversion, 80);
  assert.strictEqual(kanal.brands[0].retryRate, 1.3);
});

test('K8: Ablehngruende sortiert, Name aus der Tabelle, Fallback #id', () => {
  const m = modell({
    dim: [
      dimZeile({ attemptState: 'FAILED', failureReasonId: '1579281555663', attempts: 10 }),
      dimZeile({ attemptState: 'FAILED', failureReasonId: '1460695272591', attempts: 7 }),
      dimZeile({ attemptState: 'FAILED', failureReasonId: '999', attempts: 5 }),
      dimZeile({ attemptState: 'FAILED', failureReasonId: '12345', attempts: 1 }),
      dimZeile({ attemptState: 'SUCCESSFUL', attempts: 100 }),
    ],
  }, { failureReasons: { 999: 'Eigener Name' } });
  const f = m.kanaele.POS.failures;
  assert.deepStrictEqual(plain(f.map(x => [x.id, x.name, x.attempts])), [
    ['1579281555663', 'Transaction declined', 10],
    ['1460695272591', 'Cancellation Initiated by User', 7],
    ['999', 'Eigener Name', 5],
    ['12345', '#12345', 1],
  ]);
  // Anteil an ALLEN gescheiterten Attempts, nicht an allen Attempts - deshalb
  // heisst das Feld hier 'anteil' und nicht 'anteilAttempts' wie bei den
  // Verteilungen, deren Nenner der ganze Kanal ist.
  assert.strictEqual(f[3].anteil, 100 / 23);
  assert.strictEqual(f[3].anteilAttempts, undefined);
  assert.strictEqual(f.reduce((a, x) => a + x.attempts, 0), 23);
});

test('P6: Ablehncodes mit ISO_RESPONSE_CODES, unbekannter Code bleibt roh', () => {
  const { ISO_RESPONSE_CODES } = loadBuilders();
  assert.strictEqual(ISO_RESPONSE_CODES['00'], 'Genehmigt');
  assert.ok(/Deckung/.test(ISO_RESPONSE_CODES['51']));
  const m = modell({ dim: [
    dimZeile({ attemptState: 'FAILED', authResponseCode: '51', attempts: 9 }),
    dimZeile({ channel: 'ECOM', attemptState: 'FAILED', authResponseCode: 'AUTHORIZATION_DECLINED', attempts: 4 }),
  ] });
  assert.deepStrictEqual(plain(m.kanaele.POS.responseCodes.map(c => [c.code, c.name, c.attempts])),
    [['51', ISO_RESPONSE_CODES['51'], 9]]);
  assert.deepStrictEqual(plain(m.kanaele.ECOM.responseCodes.map(c => [c.code, c.name])),
    [['AUTHORIZATION_DECLINED', 'AUTHORIZATION_DECLINED']]);
});

test('FAILURE_REASONS traegt die an echten Daten belegten IDs', () => {
  const { FAILURE_REASONS } = loadBuilders();
  assert.strictEqual(FAILURE_REASONS['1579281555663'], 'Transaction declined');
  assert.strictEqual(FAILURE_REASONS['1579281542342'], 'Automatically cancelled');
  assert.strictEqual(FAILURE_REASONS['1568360440179'], '3-D Secure Failure');
  assert.strictEqual(FAILURE_REASONS['1000009999999'], 'Authorization Canceled by Scheme');
  // Nicht belegte IDs stehen bewusst NICHT drin - erfundene Namen waeren
  // schlimmer als die rohe ID.
  assert.strictEqual(FAILURE_REASONS['1758896189449'], undefined);
});

test('K10: Verlauf ohne Luecken, Stunden immer 0-23', () => {
  const m = modell({ time: [
    timeZeile({ tag: '2026-07-01', stunde: 8, attempts: 5, betrag: 50 * E8 }),
    timeZeile({ tag: '2026-07-03', stunde: 23, attempts: 3, attemptState: 'FAILED' }),
  ] });
  const kanal = m.kanaele.POS;
  assert.deepStrictEqual(plain(kanal.verlauf.map(v => [v.tag, v.attempts])),
    [['2026-07-01', 5], ['2026-07-02', 0], ['2026-07-03', 3]]);
  assert.strictEqual(kanal.verlauf[0].successRate, 100);
  assert.strictEqual(kanal.verlauf[1].successRate, null);
  assert.strictEqual(kanal.verlauf[2].successRate, 0);
  assert.strictEqual(kanal.verlauf[0].waehrungen[0].betrag, 50 * E8);
  assert.strictEqual(kanal.stunden.length, 24);
  assert.deepStrictEqual(plain(kanal.stunden.map(s => s.stunde)),
    Array.from({ length: 24 }, (_, i) => i));
  assert.strictEqual(kanal.stunden[8].attempts, 5);
  assert.strictEqual(kanal.stunden[23].attempts, 3);
  assert.strictEqual(kanal.stunden[0].attempts, 0);
  assert.strictEqual(kanal.stunden[0].successRate, null);
  assert.deepStrictEqual(plain(m.zeitraum),
    { von: '2026-07-01', bis: '2026-07-03', tage: 3, lueckenlos: true });
});

test('K10: der Tagesbereich gilt fuer alle Kanaele gleich', () => {
  const m = modell({ time: [
    timeZeile({ channel: 'POS', tag: '2026-07-01', attempts: 4 }),
    timeZeile({ channel: 'ECOM', tag: '2026-07-02', attempts: 6 }),
  ] });
  assert.deepStrictEqual(plain(m.kanaele.POS.verlauf.map(v => [v.tag, v.attempts])),
    [['2026-07-01', 4], ['2026-07-02', 0]]);
  assert.deepStrictEqual(plain(m.kanaele.ECOM.verlauf.map(v => [v.tag, v.attempts])),
    [['2026-07-01', 0], ['2026-07-02', 6]]);
});

test('P2: Terminal-Zeilen gibt es nur im POS-Kanal', () => {
  const m = modell({ dim: [
    dimZeile({ channel: 'POS', terminalIdentifier: 'T-1', terminalName: 'Kasse 1', attempts: 12 }),
    dimZeile({ channel: 'POS', terminalIdentifier: 'T-1', terminalName: 'Kasse 1', attemptState: 'FAILED', attempts: 4 }),
    dimZeile({ channel: 'POS', terminalIdentifier: 'UNKNOWN', attempts: 3 }),
    dimZeile({ channel: 'ECOM', terminalIdentifier: 'T-9', terminalName: 'Geist', attempts: 5 }),
  ] });
  assert.deepStrictEqual(plain(m.kanaele.POS.terminals.map(t => [t.identifier, t.name, t.attempts, t.successRate])),
    [['T-1', 'Kasse 1', 16, 75]]);
  assert.deepStrictEqual(plain(m.kanaele.ECOM.terminals), []);
  assert.strictEqual(m.hatTerminals, true);
});

test('Leeres Ergebnis ergibt ein leeres Modell statt eines Wurfs', () => {
  const m = modell({});
  assert.strictEqual(m.hatDaten, false);
  assert.deepStrictEqual(plain(m.kanalListe), []);
  assert.deepStrictEqual(plain([m.kanaele.POS, m.kanaele.ECOM, m.kanaele.OTHER]), [null, null, null]);
  assert.deepStrictEqual(plain(m.zeitraum), { von: '', bis: '', tage: 0, lueckenlos: true });
});

test('Unbekannter attempt_state landet in "sonstige", nicht in einer Quote', () => {
  const m = modell({ dim: [
    dimZeile({ attemptState: 'SUCCESSFUL', attempts: 8 }),
    dimZeile({ attemptState: 'FAILED', attempts: 2 }),
    dimZeile({ attemptState: 'IRGENDWAS', attempts: 5 }),
  ] });
  const k = m.kanaele.POS.kpi;
  assert.strictEqual(k.sonstige, 5);
  assert.strictEqual(k.attempts, 15);
  assert.strictEqual(k.abgeschlossen, 10);
  assert.strictEqual(k.successRate, 80);
});

test('P7: DCC-Anteil an erfolgreichen Karten-Attempts', () => {
  const m = modell({ dim: [
    dimZeile({ brand: 'Visa', dcc: true, attempts: 2 }),
    dimZeile({ brand: 'Visa', dcc: false, attempts: 98 }),
    dimZeile({ brand: 'TWINT', dcc: false, attempts: 500 }),
  ] });
  assert.strictEqual(m.kanaele.POS.kpi.dccAttempts, 2);
  assert.strictEqual(m.kanaele.POS.kpi.dccAnteil, 2);
});

test('E6: PAN-Quelle mit Success Rate je Typ', () => {
  const m = modell({ dim: [
    dimZeile({ channel: 'ECOM', panType: 'DEVICE_TOKEN_APPLE_PAY', attempts: 9 }),
    dimZeile({ channel: 'ECOM', panType: 'DEVICE_TOKEN_APPLE_PAY', attemptState: 'FAILED', attempts: 1 }),
    dimZeile({ channel: 'ECOM', panType: 'UNKNOWN', attempts: 10 }),
  ] });
  assert.deepStrictEqual(plain(m.kanaele.ECOM.panTypes.map(p => [p.panType, p.attempts, p.successRate])),
    [['DEVICE_TOKEN_APPLE_PAY', 10, 90], ['UNKNOWN', 10, 100]]);
});

test('Modell ueber die Fixture: Struktur, Summen und Kanaltrennung', () => {
  const { parseReportingCsv, buildReportingModel } = loadBuilders();
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'reporting-beispiel.csv'), 'utf8');
  const p = parseReportingCsv(text);
  assert.strictEqual(p.error, null);
  const m = buildReportingModel(p.rows, { merchantCountry: 'CH' });

  assert.strictEqual(m.hatDaten, true);
  assert.deepStrictEqual(plain(m.kanalListe), ['POS', 'ECOM', 'OTHER']);
  assert.deepStrictEqual(plain(m.spaces), ['90001', '90002']);
  assert.deepStrictEqual(plain(m.waehrungen), ['CHF', 'EUR']);
  assert.deepStrictEqual(plain(m.zeitraum),
    { von: '2026-07-01', bis: '2026-07-02', tage: 2, lueckenlos: true });

  // Attempts der DIM-Zeilen verteilen sich restlos auf die drei Kanaele.
  const summeDim = p.rows.dim.reduce((a, z) => a + z.attempts, 0);
  const summeKanal = m.kanalListe.reduce((a, k) => a + m.kanaele[k].kpi.attempts, 0);
  assert.strictEqual(summeKanal, summeDim);
  assert.strictEqual(summeDim, 1854);

  const pos = m.kanaele.POS;
  assert.strictEqual(pos.kpi.attempts, 1403);
  assert.strictEqual(pos.kpi.erfolgreich, 1380);
  assert.strictEqual(pos.kpi.fehlgeschlagen, 23);
  assert.strictEqual(pos.kpi.offen, 0);
  assert.strictEqual(Math.round(pos.kpi.successRate * 10) / 10, 98.4);
  // Karten-Attempts: Visa/Mastercard, ohne TWINT (137) und PostFinance (96).
  assert.strictEqual(pos.kartentyp.basis, 1147);
  assert.strictEqual(pos.herkunft.basis, 1147);
  // SPEC 7: der ISO-3-Wert CHE ist unbekannt, nie INTER.
  const chE = pos.herkunft.laender.find(l => l.land === 'CHE');
  assert.strictEqual(chE, undefined);
  const unbekannt = pos.herkunft.gruppen.find(g => g.schluessel === 'UNKNOWN');
  assert.strictEqual(unbekannt.attempts, 34);
  assert.ok(!pos.herkunft.gruppen.some(g => g.schluessel === 'INTER' && g.attempts > 0));

  const ecom = m.kanaele.ECOM;
  assert.strictEqual(ecom.kpi.offen, 9);
  assert.strictEqual(ecom.kpi.attempts, 439);
  assert.strictEqual(ecom.kpi.abgeschlossen, 430);
  // Die Quoten lassen PENDING draussen, die Anteile decken alles ab.
  assert.strictEqual(ecom.brands.reduce((a, b) => a + b.anteilAttempts, 0), 100);
  assert.deepStrictEqual(plain(ecom.waehrungen.map(w => w.waehrung)), ['CHF', 'EUR']);
  assert.ok(ecom.tds.basis > 0);
  assert.ok(ecom.wallets.some(w => w.wallet === 'Apple Pay'));

  // Alle drei Kanaele bekommen denselben, lueckenlosen Tagesbereich.
  m.kanalListe.forEach(k => {
    assert.deepStrictEqual(plain(m.kanaele[k].verlauf.map(v => v.tag)),
      ['2026-07-01', '2026-07-02']);
    assert.strictEqual(m.kanaele[k].stunden.length, 24);
    assert.deepStrictEqual(plain(m.kanaele[k].terminals), []);
  });
  assert.strictEqual(m.hatTerminals, false);
});

// ---------------------------------------------------------------------------
// Task 3, Fix-Runde 1: Regressionen aus dem Review.

test('C1: TIME-Zeilen erzeugen kein NaN im Verlauf', () => {
  // TIME-Zeilen fuehren weder refund noch betragFailed - der gemeinsame
  // Waehrungs-Akkumulator darf daraus keine NaN-Summe machen. Bewusst OHNE
  // plain(): der JSON-Umweg wuerde NaN in null verwandeln und den Fehler
  // genau hier verstecken.
  const m = modell({ time: [
    timeZeile({ tag: '2026-07-01', attempts: 5, betrag: 50 * E8 }),
    timeZeile({ tag: '2026-07-01', attemptState: 'FAILED', attempts: 2 }),
  ] });
  const w = m.kanaele.POS.verlauf[0].waehrungen[0];
  ['betrag', 'betragFailed', 'refund', 'schnitt', 'schnittFailed', 'refundQuote', 'anteilBetrag']
    .forEach(feld => {
      assert.ok(!Number.isNaN(w[feld]), 'verlauf-Waehrung ' + feld + ' ist NaN');
    });
  assert.strictEqual(w.betrag, 50 * E8);
  assert.strictEqual(w.betragFailed, 0);
  assert.strictEqual(w.refund, 0);
  assert.strictEqual(w.refundQuote, 0);
  assert.strictEqual(w.schnittFailed, 0);
  // Gegenprobe ueber die ganze Fixture: nirgends im Modell steckt ein NaN.
  const { parseReportingCsv, buildReportingModel } = loadBuilders();
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'reporting-beispiel.csv'), 'utf8');
  const voll = buildReportingModel(parseReportingCsv(text).rows, { merchantCountry: 'CH' });
  const suche = (wert, pfad) => {
    if (typeof wert === 'number') {
      assert.ok(!Number.isNaN(wert), 'NaN unter ' + pfad);
    } else if (Array.isArray(wert)) {
      wert.forEach((x, i) => suche(x, pfad + '[' + i + ']'));
    } else if (wert && typeof wert === 'object') {
      Object.keys(wert).forEach(k => suche(wert[k], pfad + '.' + k));
    }
  };
  suche(voll, 'modell');
});

test('C2: der Deckel verliert keine gemessenen Tage', () => {
  // 500 Tage mit je 7 Attempts: der Verlauf darf nicht bei 400 abschneiden.
  const zeilen = [];
  let tag = '2026-01-01';
  for (let i = 0; i < 500; i++) {
    zeilen.push(timeZeile({ tag, attempts: 7 }));
    const d = new Date(tag + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    tag = d.toISOString().slice(0, 10);
  }
  const m = modell({ time: zeilen });
  const kanal = m.kanaele.POS;
  assert.strictEqual(kanal.verlauf.reduce((a, v) => a + v.attempts, 0), 3500);
  assert.strictEqual(kanal.verlauf.length, 500);
  assert.strictEqual(kanal.kpi.ohneTag, 0);
  // Die Spanne bleibt die echte, und die Ausgabe erfaehrt, dass der Verlauf
  // oberhalb des Deckels nur die belegten Tage zeigt.
  assert.strictEqual(m.zeitraum.tage, 500);
  assert.strictEqual(m.zeitraum.lueckenlos, false);
  assert.strictEqual(m.zeitraum.von, '2026-01-01');

  // Der Deckel greift genau dort, wo er soll: ein einzelner Ausreisser weit in
  // der Zukunft blaeht den Verlauf nicht auf, kostet aber auch keine Zeile.
  const ausreisser = modell({ time: [
    timeZeile({ tag: '2026-07-01', attempts: 4 }),
    timeZeile({ tag: '2999-01-01', attempts: 1 }),
  ] });
  assert.deepStrictEqual(plain(ausreisser.kanaele.POS.verlauf.map(v => [v.tag, v.attempts])),
    [['2026-07-01', 4], ['2999-01-01', 1]]);
  assert.strictEqual(ausreisser.zeitraum.lueckenlos, false);
});

test('C3: K6 weist auch den Betragsanteil aus, je Waehrung', () => {
  const m = modell({ dim: [
    dimZeile({ brand: 'Visa', issuerCountry: 'CH', attempts: 6, betrag: 600 * E8 }),
    dimZeile({ brand: 'Visa', issuerCountry: 'DE', attempts: 2, betrag: 300 * E8 }),
    dimZeile({ brand: 'Visa', issuerCountry: 'US', attempts: 2, betrag: 100 * E8 }),
    dimZeile({ brand: 'Visa', issuerCountry: 'CH', waehrung: 'EUR', attempts: 4, betrag: 80 * E8 }),
    // TWINT steht weder im Anzahl- noch im Betragsnenner der Karten.
    dimZeile({ brand: 'TWINT', issuerCountry: 'UNKNOWN', attempts: 50, betrag: 5000 * E8 }),
  ] });
  const g = m.kanaele.POS.herkunft.gruppen;
  const chf = s => (g.find(x => x.schluessel === s).waehrungen.find(w => w.waehrung === 'CHF') || {});
  assert.strictEqual(chf('DOMESTIC').betrag, 600 * E8);
  assert.strictEqual(chf('DOMESTIC').anteilBetrag, 60);
  assert.strictEqual(chf('INTRA').anteilBetrag, 30);
  assert.strictEqual(chf('INTER').anteilBetrag, 10);
  // Je Waehrung auf 100 % - nie ueber Waehrungen hinweg addiert.
  assert.strictEqual(['DOMESTIC', 'INTRA', 'INTER', 'UNKNOWN']
    .reduce((a, s) => a + (chf(s).anteilBetrag || 0), 0), 100);
  const eur = g.find(x => x.schluessel === 'DOMESTIC').waehrungen.find(w => w.waehrung === 'EUR');
  assert.strictEqual(eur.betrag, 80 * E8);
  assert.strictEqual(eur.anteilBetrag, 100);
  // Der Nenner steht daneben, damit die Ausgabe ihn nicht neu bilden muss.
  assert.deepStrictEqual(plain(m.kanaele.POS.herkunft.waehrungen.map(w => [w.waehrung, w.betrag])),
    [['CHF', 1000 * E8], ['EUR', 80 * E8]]);
});

test('C4: hatTerminals meldet nur POS-Terminals', () => {
  const nurEcom = modell({ dim: [
    dimZeile({ channel: 'ECOM', terminalIdentifier: 'T-9', terminalName: 'Geist', attempts: 5 }),
  ] });
  assert.strictEqual(nurEcom.hatTerminals, false);
  assert.deepStrictEqual(plain(nurEcom.kanaele.ECOM.terminals), []);
  const mitPos = modell({ dim: [
    dimZeile({ channel: 'POS', terminalIdentifier: 'T-1', attempts: 5 }),
  ] });
  assert.strictEqual(mitPos.hatTerminals, true);
});

test('C5: Ablehngruende tragen keine Erfolgsquote', () => {
  const m = modell({ dim: [
    dimZeile({ attemptState: 'FAILED', failureReasonId: '1579281555663', authResponseCode: '51', attempts: 4 }),
    dimZeile({ attemptState: 'SUCCESSFUL', attempts: 96 }),
  ] });
  const f = m.kanaele.POS.failures[0];
  const c = m.kanaele.POS.responseCodes[0];
  // Diese Listen bestehen per Konstruktion nur aus FAILED - eine successRate
  // waere dort keine Messung, sondern eine Tautologie.
  ['successRate', 'failureRate', 'abgeschlossen', 'erfolgreich', 'offen', 'sonstige']
    .forEach(feld => {
      assert.strictEqual(f[feld], undefined, 'failures.' + feld + ' sollte fehlen');
      assert.strictEqual(c[feld], undefined, 'responseCodes.' + feld + ' sollte fehlen');
    });
  assert.deepStrictEqual(plain([f.id, f.attempts, f.anteil]), ['1579281555663', 4, 100]);
  assert.deepStrictEqual(plain([c.code, c.attempts, c.anteil]), ['51', 4, 100]);
});

test('C6: Zeilen mit fremdem Kanal werden gezaehlt, nicht stumm verworfen', () => {
  const m = modell({
    dim: [dimZeile({ channel: 'POS', attempts: 3 }), dimZeile({ channel: 'MOTO', attempts: 9 })],
    time: [timeZeile({ channel: 'MOTO' })],
  });
  assert.strictEqual(m.fremdeKanaele, 2);
  assert.deepStrictEqual(plain(m.kanalListe), ['POS']);
  assert.strictEqual(m.kanaele.POS.kpi.attempts, 3);
  // Ohne fremde Kanaele bleibt der Zaehler bei 0.
  assert.strictEqual(modell({ dim: [dimZeile({})] }).fremdeKanaele, 0);
});

test('C7: Haendler-Land wird normalisiert, ungueltiges faellt auf CH zurueck', () => {
  const zeilen = [dimZeile({ brand: 'Visa', issuerCountry: 'CH', attempts: 5 })];
  const gross = modell({ dim: zeilen }, { merchantCountry: 'de' });
  assert.strictEqual(gross.merchantCountry, 'DE');
  assert.strictEqual(gross.kanaele.POS.herkunft.gruppen.find(g => g.schluessel === 'INTRA').attempts, 5);
  // Ungueltig (ISO-3, leer, fehlend) -> Vorgabe CH, sonst waere jede Karte
  // unbekannter Herkunft.
  ['CHE', '', undefined, 'Schweiz'].forEach(wert => {
    const m = modell({ dim: zeilen }, { merchantCountry: wert });
    assert.strictEqual(m.merchantCountry, 'CH', 'Rueckfall fuer ' + String(wert));
    assert.strictEqual(m.kanaele.POS.herkunft.gruppen.find(g => g.schluessel === 'DOMESTIC').attempts, 5);
  });
});

// ---------------------------------------------------------------------------
// Task 3, Fix-Runde 2: Daten, die dem Muster entsprechen, aber kein Datum sind.
// Das Zeitlimit ist Teil der Zusicherung - eine Rueckkehr des Fehlers soll
// schnell rot werden und nicht die CI blockieren.

test('C8: unparsbares Datum haengt den Verlauf nicht auf', { timeout: 20000 }, () => {
  // BEWUSST IM KINDPROZESS: der Fehler war eine SYNCHRONE Endlosschleife, und
  // die kann das timeout-Optionsfeld von node:test nicht abbrechen - es greift
  // nur zwischen den Ticks. Ein hier eingebauter Aufruf wuerde die CI
  // blockieren statt rot zu werden. execFileSync mit Zeitlimit toetet den
  // Prozess und laesst den Test in Sekunden fallen.
  const skript = `
    const { loadBuilders } = require(${JSON.stringify(path.join(__dirname, 'harness.js'))});
    const { buildReportingModel } = loadBuilders();
    const z = t => ({ spaceId: '90001', channel: 'POS', brand: 'Visa', waehrung: 'CHF',
      attemptState: 'SUCCESSFUL', tag: t, stunde: 8, attempts: t === '9999-99-99' ? 6 : 4, betrag: 0 });
    const m = buildReportingModel(
      { dim: [], time: [z('2026-07-01'), z('9999-99-99')], conv: [] },
      { merchantCountry: 'CH' });
    process.stdout.write(JSON.stringify({
      verlauf: m.kanaele.POS.verlauf.map(v => [v.tag, v.attempts]),
      ohneTag: m.kanaele.POS.kpi.ohneTag,
      tage: m.zeitraum.tage,
      bis: m.zeitraum.bis,
    }));
  `;
  let ausgabe;
  try {
    ausgabe = execFileSync(process.execPath, ['-e', skript], { timeout: 10000, encoding: 'utf8' });
  } catch (e) {
    assert.fail('buildReportingModel kehrte nicht zurueck (Endlosschleife?): ' + (e.signal || e.message));
  }
  const r = JSON.parse(ausgabe);
  // Der unbrauchbare Tag zieht den Bereich nicht ins Endlose ...
  assert.deepStrictEqual(r.verlauf, [['2026-07-01', 4]]);
  // ... und verschwindet trotzdem nicht spurlos: seine Attempts stehen im
  // Zaehler fuer Zeilen ohne verwertbaren Tag.
  assert.strictEqual(r.ohneTag, 6);
  assert.strictEqual(r.tage, 1);
  assert.ok(Number.isFinite(r.tage), 'zeitraum.tage ist nicht endlich');
  assert.strictEqual(r.bis, '2026-07-01');
});

test('C8: unmoegliches Datum ergibt kein NaN in zeitraum.tage', { timeout: 10000 }, () => {
  const m = modell({ time: [
    timeZeile({ tag: '2026-07-01', attempts: 3 }),
    timeZeile({ tag: '2026-13-45', attempts: 2 }),
  ] });
  assert.ok(!Number.isNaN(m.zeitraum.tage), 'zeitraum.tage ist NaN');
  assert.strictEqual(m.zeitraum.tage, 1);
  assert.strictEqual(m.zeitraum.lueckenlos, true);
  assert.strictEqual(m.kanaele.POS.kpi.ohneTag, 2);
});

test('C8: nur unparsbare Daten werfen nicht (RangeError)', { timeout: 10000 }, () => {
  // Frueher lief reportingTagPlus auf ein Invalid Date und toISOString warf
  // RangeError. Das Modell darf auf keiner lesbaren Eingabe werfen - dieselbe
  // Regel, nach der die ganze Parser-Schicht gebaut ist.
  const m = assert.doesNotThrow
    ? modell({ time: [timeZeile({ tag: '9999-99-99', attempts: 5 })] })
    : null;
  assert.deepStrictEqual(plain(m.kanaele.POS.verlauf), []);
  assert.strictEqual(m.kanaele.POS.kpi.ohneTag, 5);
  assert.deepStrictEqual(plain(m.zeitraum), { von: '', bis: '', tage: 0, lueckenlos: true });
  assert.ok(Number.isFinite(m.zeitraum.tage));
  // Stunden bleiben trotzdem vollstaendig - der Tag ist unbrauchbar, die
  // Stunde nicht.
  assert.strictEqual(m.kanaele.POS.stunden.length, 24);
  assert.strictEqual(m.kanaele.POS.stunden[8].attempts, 5);
});

test('C8: der Deckel bleibt wirksam, ohne Tage zu verlieren', { timeout: 10000 }, () => {
  // Gegenprobe zu C2 mit einem PARSBAREN Ausreisser: die Schleife wird nicht
  // durchlaufen, der Verlauf zeigt beide belegten Tage.
  const m = modell({ time: [
    timeZeile({ tag: '2026-07-01', attempts: 4 }),
    timeZeile({ tag: '2999-01-01', attempts: 1 }),
  ] });
  assert.strictEqual(m.kanaele.POS.verlauf.length, 2);
  assert.strictEqual(m.zeitraum.lueckenlos, false);
  assert.ok(Number.isFinite(m.zeitraum.tage) && m.zeitraum.tage > 300000);
});
