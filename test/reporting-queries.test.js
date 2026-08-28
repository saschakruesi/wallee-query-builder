const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders } = require('./harness');

const B = loadBuilders();

const BASIS = {
  spaceIds: ['40402', '12622'],
  start: '2026-07-01 00:00:00',
  end:   '2026-08-01 00:00:00',
  channels: [],
  byTerminal: false,
  terminalIds: [],
};

function sql(over) {
  return B.buildReportingQuery({ ...BASIS, ...(over || {}) });
}

// Schneidet den SELECT-Block heraus, der mit 'X' AS block beginnt, bis zum
// naechsten Blockanfang bzw. Query-Ende. So lassen sich Aussagen ueber genau
// einen der drei UNION-Zweige treffen.
function block(text, name) {
  const start = text.indexOf(`'${name}'`);
  assert.notStrictEqual(start, -1, `Block ${name} nicht gefunden`);
  const rest = text.slice(start + 1);
  const naechster = rest.search(/'(?:DIM|TIME|CONV)'\s+AS block/);
  return naechster === -1 ? rest : rest.slice(0, naechster);
}

test('Harness laedt buildReportingQuery', () => {
  assert.strictEqual(typeof B.buildReportingQuery, 'function');
  assert.strictEqual(typeof B.labelExpr, 'function');
});

test('Basis ist chargeattempt, nicht transaction', () => {
  const s = sql();
  assert.match(s, /FROM chargeattempt ca/);
  assert.match(s, /JOIN charge c\s+ON c\.id\s+= ca\.charge_id/);
  assert.match(s, /JOIN transaction t\s+ON t\.id\s+= c\.transaction_id/);
  assert.match(s, /AND t\.spaceid = ca\.spaceid/);
});

test('Brand kommt ueber ca.connectorconfiguration, nicht ueber die Transaktion', () => {
  const s = sql();
  assert.match(s, /pcc\.id\s+= ca\.connectorconfiguration/);
  assert.doesNotMatch(s, /t\.paymentconnectorconfiguration_id/);
});

test('Zeitfilter auf ca.createdon, halboffenes Intervall', () => {
  const s = sql();
  assert.match(s, /ca\.createdon >= TIMESTAMP '2026-07-01 00:00:00'/);
  assert.match(s, /ca\.createdon <  TIMESTAMP '2026-08-01 00:00:00'/);
  assert.doesNotMatch(s, /<= TIMESTAMP/);
  assert.doesNotMatch(s, /t\.completedon/);
});

test('Nur PRODUCTION-Attempts', () => {
  assert.match(sql(), /ca\.environment = 'PRODUCTION'/);
});

test('Space-Filter ueber spaceInClause auf ca.spaceid', () => {
  assert.match(sql(), /ca\.spaceid IN \(40402, 12622\)/);
  assert.match(sql({ spaceIds: ['40402'] }), /ca\.spaceid = 40402/);
});

test('Ohne Space laeuft die Query leer statt zu crashen', () => {
  assert.match(sql({ spaceIds: [] }), /ca\.spaceid = -1\s+-- BITTE/);
});

test('Issuer-Land ueber countryContent, 3DS-Start ueber dateTimeContent', () => {
  const s = sql();
  assert.match(s, new RegExp(`'${B.DESC_ISSUER_COUNTRY}'\\), 1\\)\\['countryContent'\\]`));
  assert.match(s, new RegExp(`'${B.DESC_TDS_STARTED}'\\), 1\\)\\['dateTimeContent'\\]`));
});

test('CAVV taucht ausschliesslich als Existenzpruefung auf', () => {
  const s = sql();
  const vorkommen = s.split(B.DESC_TDS_CAVV).length - 1;
  assert.strictEqual(vorkommen, 1, 'CAVV-Descriptor darf genau einmal vorkommen');
  assert.match(s, new RegExp(`'${B.DESC_TDS_CAVV}'\\), 1\\)\\['longTextContent'\\] IS NOT NULL`));
  // Der Wert selbst darf nirgends als eigene Ausgabespalte landen.
  assert.doesNotMatch(s, /AS tds_cavv_wert/);
  assert.doesNotMatch(s, new RegExp(`\\['longTextContent'\\]\\s+AS `));
});

test('PII-Sperrliste: weder Card Holder Name noch Masked Card im SQL', () => {
  const s = sql({ byTerminal: true, terminalIds: ['T-1'], channels: ['POS', 'ECOM'] });
  assert.ok(!s.includes('1456765000789'), 'Card Holder Name darf nicht vorkommen');
  assert.ok(!s.includes('1456765125779'), 'Masked Card Number darf nicht vorkommen');
});

test('Alle Descriptor-IDs aus SPEC 6.3 stehen im filter(ca.labels, ...)-Muster', () => {
  const s = sql();
  const ids = [
    B.DESC_ISSUER_COUNTRY, B.DESC_CARD_TYPE, B.DESC_CARD_CATEGORY,
    B.DESC_AUTH_RESPONSE_POS, B.DESC_AUTH_RESPONSE_ECOM, B.DESC_DCC_CURRENCY,
    B.DESC_PAN_TYPE, B.DESC_TDS_STARTED, B.DESC_TDS_CAVV, B.DESC_ECI,
  ];
  for (const id of ids) {
    assert.ok(typeof id === 'string' && /^\d+$/.test(id), `Konstante fehlt: ${id}`);
    assert.match(s, new RegExp(`filter\\(ca\\.labels, l -> l\\['descriptor'\\] = '${id}'\\)`),
      `Descriptor ${id} nicht im filter-Muster`);
  }
});

test('Genau drei Bloecke, zwei UNION ALL', () => {
  const s = sql();
  assert.strictEqual(s.split(/\bAS block\b/).length - 1, 3);
  assert.strictEqual(s.split(/\bUNION ALL\b/).length - 1, 2);
  assert.match(s, /'DIM'\s+AS block/);
  assert.match(s, /'TIME'\s+AS block/);
  assert.match(s, /'CONV'\s+AS block/);
  assert.match(s, /ORDER BY block, channel, anzahl_attempts DESC/);
});

test('CONV-Block zaehlt Transaktionen mit COUNT(DISTINCT ...)', () => {
  const conv = block(sql(), 'CONV');
  assert.match(conv, /COUNT\(DISTINCT transaction_id\)\s+AS tx_mit_attempt/);
  assert.match(conv, /COUNT\(DISTINCT CASE WHEN attempt_state = 'SUCCESSFUL' THEN transaction_id END\)\s+AS tx_erfolgreich/);
});

test('Alle drei Bloecke haben dieselbe Spaltenliste in derselben Reihenfolge', () => {
  for (const s of [sql(), sql({ byTerminal: true })]) {
    const listen = ['DIM', 'TIME', 'CONV'].map(name => {
      const b = block(s, name);
      const liste = b.slice(0, b.indexOf('FROM att'));
      // Ausgabename je Eintrag = letzter Bezeichner (mit oder ohne AS-Alias).
      return liste.split(/,\n/).map(e => (/([a-z_]+)\s*$/.exec(e) || [])[1]).join(',');
    });
    assert.strictEqual(listen[0], listen[1]);
    assert.strictEqual(listen[1], listen[2]);
  }
});

test('Kanal-Filter: beide Kanaele erzeugen beide Sales-Channel-IDs', () => {
  const s = sql({ channels: ['POS', 'ECOM'] });
  assert.match(s, new RegExp(`ca\\.saleschannel IN \\(${B.SALES_CHANNEL_POS}, ${B.SALES_CHANNEL_ECOM}\\)`));
});

test('Kanal-Filter POS erzeugt nur die POS-ID', () => {
  const s = sql({ channels: ['POS'] });
  const zeile = s.split('\n').find(z => z.includes('ca.saleschannel IN'));
  assert.ok(zeile, 'Kanal-Filter fehlt');
  assert.ok(zeile.includes(B.SALES_CHANNEL_POS));
  assert.ok(!zeile.includes(B.SALES_CHANNEL_ECOM));
});

test('Ohne Kanalwahl kein Kanal-Filter (OTHER bleibt sichtbar, SPEC 7)', () => {
  const s = sql({ channels: [] });
  assert.doesNotMatch(s, /ca\.saleschannel IN \(/);
  assert.match(s, /ELSE 'OTHER'/);
});

test('byTerminal joint paymentterminal und liefert die Terminal-Spalten', () => {
  const s = sql({ byTerminal: true });
  assert.match(s, /LEFT JOIN paymentterminal pt\s+ON pt\.id\s+= ca\.terminal_id\s+AND pt\.spaceid = ca\.spaceid/);
  assert.match(s, /pt\.identifier\s+AS terminal_identifier/);
  assert.match(s, /pt\.name\s+AS terminal_name/);
});

test('Ohne byTerminal und ohne Terminal-Filter kein paymentterminal-Join', () => {
  const s = sql();
  assert.doesNotMatch(s, /paymentterminal/);
  assert.doesNotMatch(s, /terminal_identifier/);
});

test('Terminal-Filter schraenkt wie im Terminal-Modus ein', () => {
  const eins = sql({ terminalIds: ['T-1'] });
  assert.match(eins, /pt\.identifier = 'T-1'/);
  assert.match(eins, /LEFT JOIN paymentterminal pt/);
  const mehrere = sql({ terminalIds: ['T-1', "O'Brien"] });
  assert.match(mehrere, /pt\.identifier IN \('T-1', 'O''Brien'\)/);
});

test('Kein direkter lineitem-Join', () => {
  const s = sql({ byTerminal: true, terminalIds: ['T-1'] });
  assert.doesNotMatch(s, /lineitem/);
});

test('NULL-Platzhalter sind typisiert (Athena verlangt gleiche UNION-Typen)', () => {
  const s = sql();
  assert.match(s, /CAST\(NULL AS varchar\)/);
  assert.match(s, /CAST\(NULL AS date\)/);
  assert.match(s, /CAST\(NULL AS integer\)/);
  assert.match(s, /CAST\(NULL AS bigint\)/);
  assert.match(s, /CAST\(NULL AS decimal\(38,\s?8\)\)/);
  assert.doesNotMatch(s, /,\s*NULL\s+AS /);
});

test('labelExpr baut das cardCte-Muster, Default-Key shortTextContent', () => {
  assert.strictEqual(
    B.labelExpr('123'),
    "element_at(filter(ca.labels, l -> l['descriptor'] = '123'), 1)['shortTextContent']");
  assert.strictEqual(
    B.labelExpr('123', 'countryContent'),
    "element_at(filter(ca.labels, l -> l['descriptor'] = '123'), 1)['countryContent']");
});

test('Tabellen- und Spaltennamen bleiben lowercase', () => {
  const s = sql({ byTerminal: true });
  for (const name of ['chargeattempt', 'charge', 'transaction', 'paymentconnectorconfiguration',
                      'paymentconnector', 'wallettype', 'paymentterminal']) {
    assert.ok(s.includes(name), `${name} fehlt`);
    assert.ok(!s.includes(name.toUpperCase()), `${name} in Grossschrift`);
  }
});
