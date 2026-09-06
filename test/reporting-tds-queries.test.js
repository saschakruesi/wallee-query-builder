// 3DS-Failure-Seite (Iteration 2, Task 4a): die zweite, zeilenweise Query.
//
// Der Schwerpunkt liegt auf zwei Dingen, die stumm falsch sein koennen:
//   1. Descriptor-ID UND Map-Key. Ein falsch geratener Key wirft nicht, er
//      liefert dauerhaft NULL - die Spalte staende fuer immer auf "Unbekannt",
//      ohne dass irgendwo etwas rot wird. Geprueft wird deshalb das Paar, nicht
//      das Vorkommen der ID.
//   2. Die Stelle, an der die Fensterfunktionen rechnen. Sie muessen ueber ALLE
//      Attempts des Zeitraums laufen, nicht ueber die FAILED-gefilterte Menge -
//      sonst zaehlt attempts_der_transaktion nur Fehlschlaege und die Frage
//      "hat der Kunde es nochmal versucht und dann geklappt?" ist still falsch
//      beantwortet. Der Test prueft dafuer die STRUKTUR (wo steht der Filter,
//      wo stehen die Fenster), nicht bloss das Vorkommen der Bezeichner.

const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders } = require('./harness');

const B = loadBuilders();

const BASIS = {
  spaceIds: ['90001', '90002'],
  start: '2026-07-01 00:00:00',
  end:   '2026-08-01 00:00:00',
};

function sql(over) {
  return B.buildReportingTdsQuery({ ...BASIS, ...(over || {}) });
}

// Schneidet ein CTE "<name> AS (" bis zur schliessenden Klammer auf
// Spaltenebene heraus. Ueber die Klammertiefe statt ueber einen Marker, damit
// der Schnitt auch dann stimmt, wenn im CTE Klammern vorkommen.
function cte(text, name) {
  const marker = `${name} AS (`;
  const von = text.indexOf(marker);
  assert.notStrictEqual(von, -1, `CTE ${name} nicht gefunden`);
  let tiefe = 0;
  for (let i = von + marker.length - 1; i < text.length; i++) {
    if (text[i] === '(') tiefe++;
    else if (text[i] === ')') {
      tiefe--;
      if (tiefe === 0) return text.slice(von, i + 1);
    }
  }
  assert.fail(`CTE ${name} nicht geschlossen`);
}

// Der aeussere SELECT-Block: alles ab dem letzten schliessenden CTE.
function aeusseresSelect(text) {
  const von = text.lastIndexOf('\nSELECT\n');
  assert.notStrictEqual(von, -1, 'aeusserer SELECT nicht gefunden');
  return text.slice(von);
}

// Die Ausgabespalten des aeusseren SELECT, in ihrer Reihenfolge. Kommentare
// fallen weg; jede Zeile traegt genau einen Spaltennamen.
function spaltenAusQuery(text) {
  const s = aeusseresSelect(text);
  const bis = s.indexOf('\nFROM gezaehlt');
  assert.ok(bis > 0, 'FROM gezaehlt nicht gefunden');
  return s.slice('\nSELECT\n'.length, bis).split('\n')
    .map(z => z.replace(/--.*$/, '').trim().replace(/,$/, ''))
    .filter(Boolean);
}

test('Harness laedt buildReportingTdsQuery', () => {
  assert.strictEqual(typeof B.buildReportingTdsQuery, 'function');
});

test('Basis ist chargeattempt, eine Zeile je Attempt statt Aggregat', () => {
  const s = sql();
  assert.match(s, /FROM chargeattempt ca/);
  assert.match(s, /JOIN charge c\s+ON c\.id\s+= ca\.charge_id/);
  assert.match(s, /JOIN transaction t\s+ON t\.id\s+= c\.transaction_id/);
  assert.match(s, /AND t\.spaceid = ca\.spaceid/);
  // Kein GROUP BY ueber die Ausgabe: das ist der Unterschied zur Aggregat-Query.
  // Das GROUP BY im bestellung-CTE ist der Anker je Bestellnummer, kein
  // Aggregat der Ausgabe.
  assert.strictEqual(s.split('GROUP BY').length - 1, 1);
  assert.match(cte(s, 'bestellung'), /GROUP BY space_id, merchant_reference/);
});

test('Zeitfilter auf ca.createdon, halboffenes Intervall', () => {
  const s = sql();
  assert.match(s, /ca\.createdon >= TIMESTAMP '2026-07-01 00:00:00'/);
  assert.match(s, /ca\.createdon <  TIMESTAMP '2026-08-01 00:00:00'/);
  assert.doesNotMatch(s, /<= TIMESTAMP/);
  // t.completedon existiert bei einem gescheiterten Attempt gar nicht - ein
  // Filter darauf liesse genau die Versuche verschwinden, um die es geht.
  assert.doesNotMatch(s, /t\.completedon/);
});

test('Feste Filter: PRODUCTION und E-Commerce, kein Kanal-Parameter', () => {
  const s = sql();
  assert.match(s, /ca\.environment = 'PRODUCTION'/);
  assert.match(s, new RegExp(`ca\\.saleschannel = ${B.SALES_CHANNEL_ECOM}`));
  // Der POS-Kanal kommt nirgends vor: die Seite ist ausdruecklich E-Commerce.
  assert.ok(!s.includes(B.SALES_CHANNEL_POS), 'POS-Kanal darf nicht vorkommen');
});

test('Space-Filter ueber spaceInClause auf ca.spaceid', () => {
  assert.match(sql(), /ca\.spaceid IN \(90001, 90002\)/);
  assert.match(sql({ spaceIds: ['90001'] }), /ca\.spaceid = 90001/);
});

test('Ohne Space laeuft die Query leer statt zu crashen', () => {
  assert.match(sql({ spaceIds: [] }), /ca\.spaceid = -1\s+-- BITTE/);
});

// Die Werte stammen aus dashboard/discovery-results/DESCRIPTORS.md (Task 0 und
// Discovery Q2 vom 2026-09-04). Bewusst als Literale festgenagelt und NICHT aus
// B.DESC_* abgeleitet: eine Pruefung gegen die eigene Konstante wuerde eine
// vertauschte Ziffer nie bemerken - die Query bliebe gruen und die zugehoerige
// Spalte dauerhaft leer.
const DESCRIPTOREN = {
  DESC_TDS_FINISHED:       ['1568637885195', 'dateTimeContent'],
  DESC_TDS_VERSION:        ['1620379912010', 'staticValueContent'],
  DESC_CARD_ISSUER_NUMBER: ['1458749261553', 'integerContent'],
  DESC_ATTEMPT_RETRY:      ['1634723431551', 'shortTextContent'],
  DESC_CRYPTOGRAM_PRESENT: ['1634723429554', 'booleanContent'],
};

test('Die fuenf neuen Descriptor-Konstanten tragen die gemessenen IDs', () => {
  for (const [name, [id]] of Object.entries(DESCRIPTOREN)) {
    assert.strictEqual(B[name], id, `${name} weicht von der Discovery ab`);
  }
});

test('Jeder neue Descriptor steht mit seinem gemessenen Map-Key im SQL', () => {
  const s = sql();
  for (const [name, [id, key]] of Object.entries(DESCRIPTOREN)) {
    assert.match(
      s,
      new RegExp(`filter\\(ca\\.labels, l -> l\\['descriptor'\\] = '${id}'\\), 1\\)\\['${key}'\\]`),
      `${name} fehlt oder traegt den falschen Map-Key`);
  }
});

test('Die uebernommenen Descriptors behalten ihren Map-Key aus SPEC 6.3', () => {
  const s = sql();
  const uebernommen = [
    [B.DESC_AUTH_RESPONSE_ECOM, 'shortTextContent'],
    [B.DESC_ISSUER_COUNTRY,     'countryContent'],
    [B.DESC_CARD_TYPE,          'shortTextContent'],
    [B.DESC_CARD_CATEGORY,      'shortTextContent'],
    [B.DESC_PAN_TYPE,           'shortTextContent'],
    [B.DESC_ECI,                'shortTextContent'],
    [B.DESC_TDS_STARTED,        'dateTimeContent'],
  ];
  for (const [id, key] of uebernommen) {
    assert.match(
      s,
      new RegExp(`filter\\(ca\\.labels, l -> l\\['descriptor'\\] = '${id}'\\), 1\\)\\['${key}'\\]`),
      `Descriptor ${id} fehlt oder traegt den falschen Map-Key`);
  }
});

test('Die EMVCo-3DS-Labels aus SPEC 3.3 kommen NICHT vor', () => {
  // Discovery Q2 hat gemessen, dass der Connector keines davon in das
  // Analytics-labels-Array schreibt. Eine Spalte, die dauerhaft NULL liefert,
  // sieht aus wie eine Messung - deshalb entfallen sie ersatzlos, und dieser
  // Test haelt fest, dass sie nicht "vorsorglich" zurueckkommen.
  const s = sql();
  const emvco = {
    '1611157230835': 'Transaction Status',
    '1611160961002': 'Transaction Status Reason',
    '1611161612971': 'Challenge Cancel',
    '1611161618236': 'Authentication Type',
    '1552301704857': 'ACS Reference Number (Endeavour)',
    '1698042396612': 'ACS Reference Number (Netcetera)',
  };
  for (const [id, name] of Object.entries(emvco)) {
    assert.ok(!s.includes(id), `${name} (${id}) ist nicht belegt und darf nicht vorkommen`);
  }
});

test('PII-Sperrliste: keine der drei gesperrten IDs im SQL', () => {
  // Am geprueften Space traegt Card Holder Name 11'903 von 15'198 Attempts im
  // Klartext - die Sperrliste ist hier keine Vorsichtsmassnahme, sie traegt.
  const s = sql();
  const gesperrt = {
    '1456765000789': 'Card Holder Name',
    '1456765125779': 'Masked Card Number',
    '1456765711187': 'Expiry',
  };
  for (const [id, name] of Object.entries(gesperrt)) {
    assert.ok(!s.includes(id), `${name} (${id}) darf nicht vorkommen`);
  }
  // Und die Spalten daneben, die dieselbe Regel meint.
  assert.doesNotMatch(s, /billingaddress/i);
  assert.doesNotMatch(s, /customeremailaddress/i);
  assert.doesNotMatch(s, /customerid/i);
});

test('merchant_reference bleibt drin - der Haendler braucht die Bestellnummer', () => {
  const s = sql();
  assert.match(s, /NULLIF\(TRIM\(t\.merchantreference\), ''\)\s+AS merchant_reference/);
  assert.ok(spaltenAusQuery(s).includes('merchant_reference'));
});

test('CAVV taucht ausschliesslich als Existenzpruefung auf', () => {
  const s = sql();
  const vorkommen = s.split(B.DESC_TDS_CAVV).length - 1;
  assert.strictEqual(vorkommen, 1, 'CAVV-Descriptor darf genau einmal vorkommen');
  assert.match(s, new RegExp(`'${B.DESC_TDS_CAVV}'\\), 1\\)\\['longTextContent'\\] IS NOT NULL`));
  // Der Wert selbst darf nirgends als eigene Ausgabespalte landen.
  assert.doesNotMatch(s, /\['longTextContent'\]\s+AS /);
});

test('Die 3DS-Bedingung ist eine Oder-Verknuepfung, beide Zweige nachweisbar', () => {
  const s = aeusseresSelect(sql());
  assert.match(s, /WHERE attempt_state = 'FAILED'/);
  // Zweig 1: die Ablehngrund-Liste, aus der Konstante gebaut.
  assert.match(s, /failure_reason_id IN \('1568360440179', '1568360434240'\)/);
  // Zweig 2: gestartet, aber ohne CAVV. tds_cavv ist im att-CTE bereits ein
  // Boolean, deshalb "= false" statt "IS NULL".
  assert.match(s, /tds_started_on IS NOT NULL AND tds_cavv = false/);
  // Und zwar ODER - nicht UND. Mit UND fielen genau die Faelle heraus, wegen
  // derer die Definition zwei Zweige hat.
  assert.match(s, /IN \([^)]*\)\s*\n?\s*OR \(tds_started_on IS NOT NULL/);
});

test('TDS_FAILURE_REASONS ist die einzige Quelle der Grundliste', () => {
  assert.deepStrictEqual([...B.TDS_FAILURE_REASONS], ['1568360440179', '1568360434240']);
  // Die Liste wird aus der Konstante gebaut, nicht daneben nochmal getippt.
  // Zweimal je ID, weil die 3DS-Bedingung an zwei Stellen steht (Fensterzaehler
  // und aeussere WHERE-Klausel) - beide aus demselben Bauschritt, siehe den
  // Test darunter.
  const s = sql();
  for (const id of B.TDS_FAILURE_REASONS) {
    assert.strictEqual(s.split(id).length - 1, 2, `${id} steht unerwartet oft in der Query`);
  }
});

test('Die 3DS-Bedingung steht an beiden Stellen wortgleich', () => {
  // Liste und Zaehler muessen dieselbe Menge meinen. Zwei Handkopien liefen bei
  // der naechsten Aenderung auseinander, und zwar stumm: die Kachel
  // "Bestellungen mit >= 2 3DS-Fehlschlaegen" zaehlte dann etwas anderes als
  // die Liste darunter zeigt.
  const s = sql();
  const ohnePraefix = t => t.replace(/\bf\./g, '').replace(/\s+/g, ' ').trim();
  const imZaehler = ohnePraefix(
    /SUM\(CASE WHEN ([\s\S]*?)\n\s+THEN 1 ELSE 0 END\)/.exec(cte(s, 'gezaehlt'))[1]);
  const imFilter = ohnePraefix(
    /WHERE ([\s\S]*?)\n--/.exec(aeusseresSelect(s))[1]);
  assert.strictEqual(imZaehler, imFilter);
  assert.match(imFilter, /^attempt_state = 'FAILED' AND \(failure_reason_id IN \(/);
});

test('Die Fensterfunktionen rechnen NICHT ueber der FAILED-gefilterten Menge', () => {
  const s = sql();
  const att = cte(s, 'att');
  // 1. Das CTE, das die Grundgesamtheit bildet, kennt den Zustandsfilter nicht.
  assert.doesNotMatch(att, /ca\.state\s*=/);
  assert.ok(!att.includes("'FAILED'"), 'att darf nicht auf FAILED filtern');
  assert.match(att, /ca\.state\s+AS attempt_state/);
  // 2. Die Fenster stehen in einem eigenen CTE darueber.
  const gezaehlt = cte(s, 'gezaehlt');
  assert.match(gezaehlt, /ROW_NUMBER\(\) OVER \(PARTITION BY f\.transaction_id/);
  assert.match(gezaehlt, /COUNT\(\*\)\s+OVER \(PARTITION BY f\.transaction_id\)\s+AS attempts_der_transaktion/);
  // 'FAILED' kommt im gezaehlt-CTE seit tds_fehlschlaege_der_bestellung vor -
  // aber nur INNERHALB eines CASE-Ausdrucks im Fenster, nie als Filter. Die
  // Unterscheidung ist der Punkt: ein CASE schrumpft die Grundgesamtheit nicht.
  const ohneKommentar = gezaehlt.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(ohneKommentar, /\bWHERE\b/, 'gezaehlt darf keine WHERE-Klausel haben');
  for (const treffer of gezaehlt.match(/[^\n]*'FAILED'[^\n]*/g) || []) {
    assert.match(treffer, /CASE WHEN/, `'FAILED' steht in gezaehlt ausserhalb eines CASE: ${treffer}`);
  }
  // 3. Erst danach filtert die aeussere WHERE-Klausel.
  assert.match(aeusseresSelect(s), /WHERE attempt_state = 'FAILED'/);
  // Und der Filter kommt im Text tatsaechlich NACH den Fenstern - sonst waere
  // die Reihenfolge oben nur behauptet.
  assert.ok(s.indexOf('OVER (PARTITION BY') < s.indexOf("WHERE attempt_state = 'FAILED'"));
});

test('attempt_nr ist deterministisch sortiert', () => {
  // Ohne den zweiten Sortierschluessel waeren zwei Versuche in derselben
  // Sekunde bei jedem Lauf anders nummeriert.
  assert.match(sql(), /ORDER BY f\.created_on, f\.attempt_id\)\s+AS attempt_nr/);
});

test('Wiederholer je Bestellung: leere Referenz wird nicht gruppiert', () => {
  const s = sql();
  const fenster = cte(s, 'bestell_fenster');
  // Ohne Bestellnummer tritt die Attempt-ID an ihre Stelle - sonst faenden alle
  // referenzlosen Bestellungen in EINER Partition zusammen (PARTITION BY
  // gruppiert NULL-Werte miteinander).
  assert.match(fenster, /COALESCE\(a\.merchant_reference,\s*\n?\s*CONCAT\('#attempt-', CAST\(a\.attempt_id AS varchar\)\)\) AS bestell_key/);
  // Das 24-h-Fenster als Abstand zum ersten Versuch derselben Bestellung.
  assert.match(fenster, /date_diff\('second', b\.erster_versuch, a\.created_on\) \/ 86400 AS bestell_fenster_nr/);
  // Ausgewiesen wird trotzdem NULL: "nicht gruppierbar" ist keine 1.
  const gezaehlt = cte(s, 'gezaehlt');
  assert.strictEqual(
    gezaehlt.split('CASE WHEN f.merchant_reference IS NULL THEN NULL ELSE').length - 1, 3);
  assert.match(gezaehlt, /AS versuche_der_bestellung/);
  assert.match(gezaehlt, /AS tds_fehlschlaege_der_bestellung/);
  assert.match(gezaehlt, /AS bestellung_am_ende_bezahlt/);
  // Alle drei Bestell-Fenster partitionieren ueber denselben Schluessel.
  assert.strictEqual(
    gezaehlt.split('OVER (PARTITION BY f.space_id, f.bestell_key, f.bestell_fenster_nr)').length - 1, 3);
});

test('tds_fehlschlaege_der_bestellung zaehlt nur die 3DS-Fehlschlaege', () => {
  // Die Kachel aus §3.5/§3.8 heisst "Bestellungen mit >= 2 3DS-FEHLSCHLAEGEN".
  // versuche_der_bestellung beantwortet eine andere Frage: eine Bestellung mit
  // einem 3DS-Fehlschlag und einem darauf folgenden erfolgreichen Versuch
  // traegt dort 2 - gegen diese Spalte gerechnet ueberschaetzte die Kachel
  // systematisch, und in einem Space, der je Versuch eine neue Transaktion
  // anlegt, waere das der Regelfall.
  const gezaehlt = cte(sql(), 'gezaehlt');
  // Gezaehlt wird ueber einen CASE, nicht ueber COUNT(*) - COUNT(*) waere
  // wieder die Zahl ALLER Versuche.
  assert.match(gezaehlt,
    /SUM\(CASE WHEN f\.attempt_state = 'FAILED'[\s\S]*?THEN 1 ELSE 0 END\)\s*\n\s*OVER \(PARTITION BY f\.space_id, f\.bestell_key, f\.bestell_fenster_nr\)\s*\n\s*END\s+AS tds_fehlschlaege_der_bestellung/);
  // Und beide Spalten bleiben nebeneinander bestehen - sie beantworten
  // verschiedene Fragen, die eine ersetzt die andere nicht.
  assert.match(gezaehlt, /COUNT\(\*\) OVER \(PARTITION BY f\.space_id[^\n]*\n\s*END\s+AS versuche_der_bestellung/);
});

test('bestellung_am_ende_bezahlt sieht auch die erfolgreichen Attempts', () => {
  // Die Kachel "davon am Ende bezahlt" haengt daran. Der Zustand wird im
  // Fenster gelesen, also ueber der ungefilterten Menge.
  assert.match(cte(sql(), 'gezaehlt'),
    /max\(CASE WHEN f\.attempt_state = 'SUCCESSFUL' THEN 1 ELSE 0 END\)/);
});

test('Ausgabespalten: vollstaendig, in der Reihenfolge der Spec, ohne Helfer', () => {
  const spalten = spaltenAusQuery(sql());
  assert.deepStrictEqual(spalten, [
    'space_id', 'attempt_id', 'transaction_id', 'created_on', 'merchant_reference',
    'brand', 'wallet', 'waehrung', 'amount', 'failure_reason_id', 'response_code',
    'issuer_country', 'funding', 'card_category', 'pan_type', 'eci',
    'card_issuer_number', 'tds_version', 'attempt_retry', 'cryptogram_present',
    'tds_started_on', 'tds_finished_on', 'tds_cavv', 'transaction_state',
    'attempt_nr', 'attempts_der_transaktion',
    'versuche_der_bestellung', 'tds_fehlschlaege_der_bestellung',
    'bestellung_am_ende_bezahlt',
  ]);
  // Die beiden Hilfsspalten der Bestell-Partition bleiben im CTE und tauchen
  // in der Ausgabe nicht auf - sie sind Rechenweg, kein Ergebnis. Ebenso
  // attempt_state: nach dem Filter traegt es in jeder Zeile denselben Wert.
  for (const helfer of ['bestell_key', 'bestell_fenster_nr', 'attempt_state']) {
    assert.ok(!spalten.includes(helfer), `${helfer} gehoert nicht in die Ausgabe`);
  }
});

test('Betrag kommt aus authorizationamount, nicht aus completedamount', () => {
  // Bei FAILED ist completedamount 0 (Task 0, Q6) - eine Betragsspalte daraus
  // waere durchgehend 0 und saehe trotzdem wie eine Messung aus.
  const s = sql();
  assert.match(s, /t\.authorizationamount\s+AS amount/);
  // Gemeint ist die Spalte, nicht das Wort: im Kommentar darueber steht
  // completedamount als Begruendung und soll dort auch stehen bleiben.
  assert.doesNotMatch(s, /t\.completedamount/);
});

test('Sortierung und Obergrenze aus der benannten Konstante', () => {
  const s = sql();
  // Mit Tie-Break: bei gleichem Zeitstempel waere die Reihenfolge sonst nicht
  // festgelegt, und weil das LIMIT stumm abschneidet, lieferten zwei Laeufe
  // derselben Abfrage an der Grenze verschiedene Zeilen - das saehe nach
  // schwankenden Daten aus, nicht nach einer Abschneidung. Dieselbe
  // Ueberlegung wie bei attempt_nr.
  assert.match(s, /ORDER BY created_on DESC, attempt_id DESC/);
  assert.strictEqual(B.REPORTING_TDS_LIMIT, 20000);
  assert.match(s, new RegExp(`LIMIT ${B.REPORTING_TDS_LIMIT};$`));
});

test('Kein Trinkgeld-CTE und kein lineitem-Join', () => {
  // Die Seite zaehlt gescheiterte Versuche; Trinkgeld haengt an erfolgreichen
  // Transaktionen und haette hier nur Kosten.
  // Bewusst auf die Konstrukte statt auf das blosse Wort "tip": ein Kommentar,
  // der es erwaehnt, waere kein Fehler - ein Join darauf schon.
  const s = sql();
  assert.doesNotMatch(s, /lineitem/i);
  assert.doesNotMatch(s, /\btip\b\s*(?:AS|ON|\.)/i);
  assert.doesNotMatch(s, /tip_amount|tip_total/i);
});
