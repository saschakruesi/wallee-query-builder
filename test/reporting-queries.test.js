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

// Die GROUP-BY-Klausel eines Blocks als flache Liste der Gruppierungsschluessel.
function groupBy(text, name) {
  const b = block(text, name);
  const ab = b.indexOf('GROUP BY');
  assert.notStrictEqual(ab, -1, `GROUP BY in Block ${name} fehlt`);
  const rest = b.slice(ab + 'GROUP BY'.length);
  const ende = rest.search(/\n\s*\n|ORDER BY/);
  return (ende === -1 ? rest : rest.slice(0, ende))
    .split(',').map(t => t.trim()).filter(Boolean);
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

test('Nur PRODUCTION-Attempts - in BEIDEN CTEs, nicht nur im tx-CTE', () => {
  const s = sql();
  // assert.match allein genuegt hier nicht: der Filter steht zweimal - einmal
  // im vorgelagerten tx-CTE (Unterbau des Trinkgeld-Joins) und einmal im
  // att-CTE, das entscheidet, was tatsaechlich gezaehlt wird. Faellt er im
  // att-CTE weg, blieben Testtransaktionen in jeder Quote, und ein blosses
  // match bliebe wegen des tx-CTE gruen. Dieselbe Technik wie bei
  // tip.tip_amount und beim CAVV-Descriptor.
  assert.strictEqual(s.split("ca.environment = 'PRODUCTION'").length - 1, 2);
  const att = s.slice(s.indexOf('att AS ('), s.indexOf("'DIM'"));
  assert.match(att, /ca\.environment = 'PRODUCTION'/);
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

// Die Werte stammen aus dashboard/SPEC.md 6.3 (an Produktivdaten ermittelt,
// Task 0). Bewusst als Literale festgenagelt und NICHT aus B.DESC_* abgeleitet:
// eine Pruefung gegen die eigene Konstante wuerde eine vertauschte Ziffer nie
// bemerken - die Query bliebe gruen und die zugehoerige KPI dauerhaft leer.
const DESCRIPTOREN = {
  DESC_ISSUER_COUNTRY:     '1474552618629',
  DESC_CARD_TYPE:          '1474552618699',
  DESC_CARD_CATEGORY:      '1474552618999',
  DESC_AUTH_RESPONSE_POS:  '1579287790513',
  DESC_AUTH_RESPONSE_ECOM: '15537739985478',
  DESC_DCC_CURRENCY:       '1695119783358',
  DESC_PAN_TYPE:           '1634723429555',
  DESC_TDS_STARTED:        '1568637480278',
  DESC_TDS_CAVV:           '1569496536590',
  DESC_ECI:                '1634723429552',
};

test('Descriptor-Konstanten tragen exakt die in SPEC 6.3 belegten IDs', () => {
  for (const [name, id] of Object.entries(DESCRIPTOREN)) {
    assert.strictEqual(B[name], id, `${name} weicht von SPEC 6.3 ab`);
  }
  assert.strictEqual(B.SALES_CHANNEL_POS,  '1582819151330');
  assert.strictEqual(B.SALES_CHANNEL_ECOM, '1582816223150');
  assert.strictEqual(B.ATTEMPT_ENVIRONMENT, 'PRODUCTION');
});

test('Alle Descriptor-IDs aus SPEC 6.3 stehen im filter(ca.labels, ...)-Muster', () => {
  const s = sql();
  for (const id of Object.values(DESCRIPTOREN)) {
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

test('Terminal-Filter schluckt keine Attempts ohne Terminal (SPEC 7)', () => {
  // Der Filter steht ueber einem LEFT JOIN in der WHERE-Klausel und wuerde ihn
  // sonst zu einem INNER JOIN degradieren: bei Kanal "Beide" fielen alle
  // E-Commerce- und OTHER-Attempts still heraus.
  for (const channels of [[], ['POS', 'ECOM']]) {
    const s = sql({ channels, terminalIds: ['T-1'] });
    assert.match(s, /AND \(ca\.terminal_id IS NULL OR pt\.identifier = 'T-1'\)/);
  }
  const mehrere = sql({ channels: ['POS', 'ECOM'], terminalIds: ['T-1', 'T-2'] });
  assert.match(mehrere, /AND \(ca\.terminal_id IS NULL OR pt\.identifier IN \('T-1', 'T-2'\)\)/);
});

test('DIM gruppiert nach genau den nicht-aggregierten DIM-Spalten', () => {
  const erwartet = [
    'space_id', 'channel', 'brand', 'wallet', 'waehrung', 'attempt_state',
    'failure_reason_id', 'auth_response_code', 'issuer_country', 'card_category',
    'funding', 'pan_type', 'dcc', 'tds_started', 'tds_cavv', 'eci',
  ];
  assert.deepStrictEqual(groupBy(sql(), 'DIM'), erwartet);
  assert.deepStrictEqual(groupBy(sql({ byTerminal: true }), 'DIM'),
    erwartet.concat(['terminal_identifier', 'terminal_name']));
});

test('TIME und CONV gruppieren nach ihren eigenen Dimensionen', () => {
  assert.deepStrictEqual(groupBy(sql(), 'TIME'), [
    'space_id', 'channel', 'brand', 'waehrung', 'attempt_state',
    'date(created_on)', 'CAST(hour(created_on) AS integer)',
  ]);
  // Terminal-Spalten sind im TIME/CONV-Block NULL-Platzhalter und duerfen
  // deshalb nie in deren GROUP BY auftauchen.
  const mitTerminal = sql({ byTerminal: true });
  assert.ok(!groupBy(mitTerminal, 'TIME').includes('terminal_identifier'));
  assert.deepStrictEqual(groupBy(mitTerminal, 'CONV'),
    ['space_id', 'channel', 'brand', 'waehrung']);
});

test('failure_reason_id ist in allen Bloecken varchar (Typ unbelegt, SPEC 6.4)', () => {
  const s = sql();
  assert.match(s, /CAST\(failure_reason_id AS varchar\)\s+AS failure_reason_id/);
  assert.strictEqual(s.split('CAST(NULL AS varchar)                           AS failure_reason_id').length - 1, 2);
  assert.doesNotMatch(s, /CAST\(NULL AS bigint\)\s+AS failure_reason_id/);
});

test('Trinkgeld kommt ueber tipCte, lineitem wird nie direkt gejoint', () => {
  const s = sql({ byTerminal: true, terminalIds: ['T-1'] });
  // lineitem darf ausschliesslich im vor-aggregierten tip-CTE vorkommen. Ein
  // direkter Join - ob an att oder an transaction - vervielfachte die
  // Attempt-Zeilen (eine Transaktion hat mehrere Line Items) und machte
  // COUNT(*) und jede Summe falsch.
  assert.match(s, /tip AS \(/);
  assert.match(s, /GROUP BY tl\.transaction_id/);
  assert.match(s, /LEFT JOIN tip\s+ON tip\.transaction_id = t\.id/);
  // Die Grenzen des att-CTE laut behaupten statt still falsch schneiden: ein
  // top-level SELECT vor att wuerde die Scheibe sonst leer lassen und den
  // Test tautologisch gruen faerben.
  const attVon = s.indexOf('att AS (');
  const attBis = s.indexOf("\nSELECT\n");
  assert.ok(attVon >= 0 && attBis > attVon,
    'att-CTE nicht abgrenzbar - steht ein SELECT auf oberster Ebene vor att?');
  const attCte = s.slice(attVon, attBis);
  // Bewusst der ganze Bezeichner und nicht nur "JOIN lineitem": ein
  // Komma-Join (FROM chargeattempt ca, lineitem li2) ist derselbe Fehler und
  // traegt kein JOIN-Schluesselwort.
  assert.doesNotMatch(attCte, /lineitem/);
  // tipCte braucht ein CTE tx mit der Spalte id. Es kommt aus den Attempts des
  // Zeitraums, nicht aus txCte: txCte filtert auf t.completedon und t.state,
  // der Reporting-Modus filtert auf ca.createdon und ohne Statusfilter.
  assert.match(s, /WITH tx AS \(\n    SELECT DISTINCT c\.transaction_id\s+AS id/);
});

test('Das tx-CTE traegt denselben Kanalfilter wie att', () => {
  // tx grenzt ein, fuer welche Transaktionen tipCte ueberhaupt
  // transaction_lineitem/lineitem anfasst. Ohne den Kanalfilter zaehlte der
  // Bericht ueber E-Commerce trotzdem das Trinkgeld saemtlicher POS-Umsaetze
  // zusammen - also genau den teuren Teil, den der Join danach wegwirft.
  const vorTip = t => t.slice(0, t.indexOf('tip AS ('));
  const ecom = sql({ channels: ['ECOM'] });
  assert.match(vorTip(ecom), new RegExp(`ca\\.saleschannel IN \\(${B.SALES_CHANNEL_ECOM}\\)`));
  assert.ok(!vorTip(ecom).includes(B.SALES_CHANNEL_POS));
  // Ohne Kanalwahl bleibt es auch im tx-CTE ungefiltert (SPEC 7: OTHER
  // sichtbar halten).
  assert.doesNotMatch(vorTip(sql({ channels: [] })), /saleschannel/);
  // Der Terminal-Filter bleibt bewusst draussen: er haengt am
  // paymentterminal-Join, den tx nicht traegt.
  assert.doesNotMatch(vorTip(sql({ terminalIds: ['T-1'] })), /pt\.identifier/);
});

test('Trinkgeld zaehlt nur den erfolgreichen Attempt (CASE-Guard)', () => {
  const s = sql();
  // DIM hat die Koernigkeit des Attempts, tip die der Transaktion: ohne den
  // Guard zaehlte SUM das Trinkgeld einer wiederholten Transaktion einmal je
  // Versuch. Der Guard ist die EINZIGE Stelle, an der tip.tip_amount gelesen
  // wird - ein direktes SUM(tip.tip_amount) im DIM-Block faellt hier auf.
  assert.match(s, /CASE WHEN ca\.state = 'SUCCESSFUL' THEN tip\.tip_amount\s+END AS tip_amount/);
  assert.strictEqual(s.split('tip.tip_amount').length - 1, 1,
    'tip.tip_amount darf nur im CASE-Guard stehen');
  assert.doesNotMatch(s, /SUM\(tip\.tip_amount\)/);
  assert.match(block(s, 'DIM'), /CAST\(SUM\(tip_amount\) AS decimal\(38,8\)\)\s+AS summe_tip/);
});

test('NULL-Platzhalter sind typisiert (Athena verlangt gleiche UNION-Typen)', () => {
  const s = sql();
  assert.match(s, /CAST\(NULL AS varchar\)/);
  assert.match(s, /CAST\(NULL AS date\)/);
  assert.match(s, /CAST\(NULL AS integer\)/);
  assert.match(s, /CAST\(NULL AS bigint\)/);
  assert.match(s, /CAST\(NULL AS decimal\(38,\s?8\)\)/);
  assert.doesNotMatch(s, /,\s*NULL\s+AS /);
  // summe_tip gibt es nur im DIM-Block; TIME und CONV fuehren ihn als
  // typisierten Platzhalter, sonst findet Presto keinen gemeinsamen Supertyp.
  assert.strictEqual(
    s.split('CAST(NULL AS decimal(38,8))                     AS summe_tip').length - 1, 2);
});

test('Alle drei Existenz-Flags entstehen gleich (labelExpr + IS NOT NULL)', () => {
  const s = sql();
  // DCC-Key shortTextContent ist an Produktivdaten belegt (Task 0, Q2:
  // ohne_shorttext = 0, Werte EUR/SEK) - kein Sonderweg noetig.
  assert.match(s, new RegExp(`'${DESCRIPTOREN.DESC_DCC_CURRENCY}'\\), 1\\)\\['shortTextContent'\\] IS NOT NULL AS dcc`));
  assert.strictEqual(s.split(/\] IS NOT NULL AS /).length - 1, 3);
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
