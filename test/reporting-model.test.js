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
