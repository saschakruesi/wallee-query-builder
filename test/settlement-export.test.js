// Export-Basis des Settlement-Reports: eine Blockliste, aus der Bildschirm,
// CSV, XLSX und PDF gleichermassen gespeist werden. Rein und ohne Vendor
// testbar. Aufbau nach settlement-report-spec/SPEC.md (Abschnitte 4.2-4.5, 5).

const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders, plain } = require('./harness');

const KOPF = 'settlement_valuedate,settlement_state,transaction_id,created_on,merchant_reference,'
  + 'space_id,waehrung,connector,sales_channel,terminal_identifier,'
  + 'brutto_gross,settlement_gross,processing_fees,netamount,settlement_records';
const KOPF_REF = KOPF + ',settlement_reference';

// Kompakter Zeilenbauer, gleiche Form wie in settlement-report.test.js.
function zeile(opts = {}) {
  const o = Object.assign({
    valuedate: '2026-01-05 09:00:00', state: 'SETTLED', id: '1',
    createdon: '2026-01-03 10:00:00', mref: '', space: '50161', waehrung: 'CHF',
    connector: 'Visa', channel: 'Ecommerce', terminal: '',
    brutto: '10.00000000', sgross: '10.00000000', fees: '0.10000000',
    netto: '9.90000000', records: '1', ref: undefined,
  }, opts);
  const felder = [o.valuedate, o.state, o.id, o.createdon, o.mref, o.space, o.waehrung,
    o.connector, o.channel, o.terminal, o.brutto, o.sgross, o.fees, o.netto, o.records];
  if (o.ref !== undefined) felder.push(o.ref);
  return felder.join(',');
}

function modell(...zeilen) {
  const { parseSettlementCsv, buildSettlementReportModel } = loadBuilders();
  const res = parseSettlementCsv([KOPF, ...zeilen].join('\n') + '\n');
  assert.strictEqual(res.error, null);
  return buildSettlementReportModel(res.rows, { end: '2026-02-01 00:00:00' });
}
function modellRef(...zeilen) {
  const { parseSettlementCsv, buildSettlementReportModel } = loadBuilders();
  const res = parseSettlementCsv([KOPF_REF, ...zeilen].join('\n') + '\n');
  assert.strictEqual(res.error, null);
  return buildSettlementReportModel(res.rows, { end: '2026-02-01 00:00:00' });
}

// Zwei Settlements im Zeitraum (05.01., zwei Tx) plus eines danach (03.02.,
// Ausstehend). Alle in Space 50161.
const ZEILEN = [
  zeile({ id: '100', valuedate: '2026-01-05 09:00:00', connector: 'Visa',
    brutto: '10.00000000', sgross: '10.00000000', fees: '0.10000000', netto: '9.90000000' }),
  zeile({ id: '200', valuedate: '2026-01-05 09:00:00', connector: 'TWINT', channel: 'Physical Terminal',
    brutto: '20.00000000', sgross: '20.00000000', fees: '0.20000000', netto: '19.80000000' }),
  zeile({ id: '300', valuedate: '2026-02-03 09:00:00', connector: 'Visa',
    brutto: '30.00000000', sgross: '30.00000000', fees: '0.30000000', netto: '29.70000000' }),
];

const OFFEN_ZEILE = zeile({ id: '999', state: 'NO_RECORD', valuedate: '',
  brutto: '7.00000000', sgross: '', fees: '', netto: '', records: '0' });

// --- Blockstruktur ----------------------------------------------------------

test('Bloecke ohne Referenz: Zusammenfassung, Zahlungsmittel, Space, Uebersicht, Offene', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN), { detail: false });
  assert.deepStrictEqual(plain(b.map(x => x.name)), [
    'Zusammenfassung', 'Aufschlüsselung nach Zahlungsmittel', 'Übersicht nach Space',
    'Settlement-Übersicht', 'Offene Transaktionen',
  ]);
});

test('Bloecke mit Referenz: Bankgutschriften stehen vor der Settlement-Uebersicht', () => {
  const { settlementExportBloecke } = loadBuilders();
  const m = modellRef(
    zeile({ id: '100', valuedate: '2026-01-05 09:00:00', ref: 'REF-A' }),
    zeile({ id: '200', valuedate: '2026-01-06 09:00:00', ref: 'REF-B' }),
  );
  const b = settlementExportBloecke(m, { detail: false, reference: true });
  assert.deepStrictEqual(plain(b.map(x => x.name)), [
    'Zusammenfassung', 'Aufschlüsselung nach Zahlungsmittel', 'Übersicht nach Space',
    'Bankgutschriften', 'Settlement-Übersicht', 'Offene Transaktionen',
  ]);
});

test('Bloecke mit detail:true haengen die flache Transaktionstabelle an', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN), { detail: true });
  assert.strictEqual(b[b.length - 1].name, 'Transaktionen');
});

test('reference:true ohne Referenzen im Ergebnis degradiert sauber (keine Bankgutschriften)', () => {
  const { settlementExportBloecke } = loadBuilders();
  // Modell ohne Referenzspalte -> hasReference false, obwohl die Option an ist.
  const b = settlementExportBloecke(modell(...ZEILEN), { detail: false, reference: true });
  assert.ok(!b.some(x => x.name === 'Bankgutschriften'));
  const ueb = b.find(x => x.name === 'Settlement-Übersicht');
  assert.ok(!plain(ueb.header).includes('BG-Nr.'));
});

// --- Zusammenfassung (SPEC 4.2) ---------------------------------------------

test('Zusammenfassung nennt die Kennzahlen der Spec, ohne Durchschnitt und Fee-Quote', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN), { detail: false });
  const namen = b[0].rows.map(r => r[0]);
  assert.deepStrictEqual(plain(namen), [
    'Transaktionen erfasst ab', 'Zeitraum Auszahlungen', 'Anzahl Bankgutschriften',
    'Anzahl Settlements', 'Anzahl Transaktionen', 'Anzahl Spaces',
    'Brutto Volumen', 'Processing Fees', 'Netto Auszahlung',
    'Nicht ausbezahlt (Tx)', 'Nicht ausbezahlt (Brutto)',
  ]);
  // Spec 4.2 streicht beide Kennzahlen ausdruecklich (GAP-ANALYSIS G7).
  assert.ok(!namen.some(n => /Ø|Durchschnitt|Quote/.test(String(n))));
});

test('Zusammenfassung: Werte stimmen (Settlements, Tx, Betraege, Offen)', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN, OFFEN_ZEILE), { detail: false });
  const wert = name => b[0].rows.find(r => r[0] === name)[1];
  assert.strictEqual(wert('Anzahl Settlements'), 2);
  assert.strictEqual(wert('Anzahl Transaktionen'), 3);
  assert.strictEqual(wert('Anzahl Spaces'), 1);
  assert.strictEqual(wert('Brutto Volumen'), 60);
  assert.strictEqual(wert('Processing Fees'), 0.6);
  assert.strictEqual(wert('Netto Auszahlung'), 59.4);
  assert.strictEqual(wert('Nicht ausbezahlt (Tx)'), 1);
  assert.strictEqual(wert('Nicht ausbezahlt (Brutto)'), 7);
  assert.strictEqual(wert('Zeitraum Auszahlungen'), '05.01.2026 – 03.02.2026');
  assert.strictEqual(wert('Transaktionen erfasst ab'), '03.01.2026');
});

// --- Settlement-Übersicht (SPEC 4.4) ----------------------------------------

test('Uebersicht: Spalten der Spec inkl. Settlement-ID und Space, Betraege als Zahlen', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN), { detail: false });
  const ueb = b.find(x => x.name === 'Settlement-Übersicht');
  assert.deepStrictEqual(plain(ueb.header),
    ['#', 'Settlement-ID', 'Space', 'Valuta', 'Tx', 'Brutto', 'Fees', 'Netto', 'Status']);
  assert.deepStrictEqual(plain(ueb.rows), [
    [1, '50161-S001', '50161', '05.01.2026 09:00', 2, 30, 0.3, 29.7, 'Settled'],
    [2, '50161-S002', '50161', '03.02.2026 09:00', 1, 30, 0.3, 29.7, 'Ausstehend'],
    ['TOTAL', '', '', '', 3, 60, 0.6, 59.4, ''],
  ]);
  assert.deepStrictEqual(plain(ueb.typen),
    ['text', 'text', 'text', 'text', 'zahl', 'betrag', 'betrag', 'betrag', 'text']);
});

test('Uebersicht mit Referenz: BG-Nr. UND volle Kontoauszug-Referenz je Settlement', () => {
  const { settlementExportBloecke } = loadBuilders();
  const m = modellRef(
    zeile({ id: '100', valuedate: '2026-01-05 09:00:00', ref: 'a8119a7b077c485e95f3ae0fbede0c13' }),
  );
  const b = settlementExportBloecke(m, { detail: false, reference: true });
  const ueb = b.find(x => x.name === 'Settlement-Übersicht');
  assert.deepStrictEqual(plain(ueb.header),
    ['#', 'Settlement-ID', 'Space', 'Valuta', 'BG-Nr.', 'Referenz (Kontoauszug)',
      'Tx', 'Brutto', 'Fees', 'Netto', 'Status']);
  assert.strictEqual(ueb.rows[0][4], 'BG-01');
  // Vollstaendig, nicht gekuerzt - das ist der String auf dem Kontoauszug.
  assert.strictEqual(ueb.rows[0][5], 'a8119a7b077c485e95f3ae0fbede0c13');
  // TOTAL-Zeile hat dieselbe Spaltenzahl.
  assert.strictEqual(ueb.rows[ueb.rows.length - 1].length, ueb.header.length);
});

test('Uebersicht: Settlement ohne Referenz zeigt einen Em-Dash statt einer leeren Zelle', () => {
  const { settlementExportBloecke } = loadBuilders();
  const m = modellRef(
    zeile({ id: '1', valuedate: '2026-01-05 09:00:00', ref: 'REF-A' }),
    zeile({ id: '2', valuedate: '2026-01-06 09:00:00', ref: '' }),
  );
  const b = settlementExportBloecke(m, { detail: false, reference: true });
  const ueb = b.find(x => x.name === 'Settlement-Übersicht');
  assert.strictEqual(ueb.rows[0][5], 'REF-A');
  assert.strictEqual(ueb.rows[1][5], '—');
});

test('Uebersicht: TOTAL-Zeile erfuellt Brutto - Fees = Netto (keine Offen-Vermischung)', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN, OFFEN_ZEILE), { detail: false });
  const ueb = b.find(x => x.name === 'Settlement-Übersicht');
  const total = ueb.rows[ueb.rows.length - 1];
  // Spalten: TOTAL, '', '', '', Tx, Brutto, Fees, Netto, ''
  const [, , , , tx, brutto, fees, netto] = total;
  assert.strictEqual(tx, 3, 'offene Tx zaehlen nicht mit');
  assert.strictEqual(Math.round((brutto - fees) * 100) / 100, netto);
});

test('Uebersicht: Hinweis nennt ausstehende Settlements und offene Transaktionen', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN, OFFEN_ZEILE),
    { detail: false, end: '2026-02-01 00:00:00' });
  const hinweis = String(b.find(x => x.name === 'Settlement-Übersicht').hinweis);
  assert.match(hinweis, /^1 Settlement\(s\) mit 1 Transaktionen/);
  assert.match(hinweis, /nach dem 31\.01\.2026/);
  assert.match(hinweis, /1 Transaktion\(en\) ohne Settlement-Record/);
  assert.ok(!/ {2,}/.test(hinweis), `doppeltes Leerzeichen: "${hinweis}"`);
});

test('Uebersicht: ohne ausstehende und offene Zeilen bleibt der Hinweis leer', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(ZEILEN[0]), { detail: false, end: '2026-02-01 00:00:00' });
  assert.strictEqual(b.find(x => x.name === 'Settlement-Übersicht').hinweis, '');
});

test('Hinweis ohne optionen.end bleibt sprachlich sauber', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN), { detail: false });
  const hinweis = String(b.find(x => x.name === 'Settlement-Übersicht').hinweis);
  assert.ok(hinweis.length > 0);
  assert.ok(!/ {2,}/.test(hinweis));
  assert.ok(!/nach dem\s*\./.test(hinweis));
  assert.match(hinweis, /nach dem Berichtszeitraum/);
});

// --- Bankgutschriften (SPEC 4.3) --------------------------------------------

test('Bankgutschriften: eine Zeile je Referenz mit Valuta-Bereich, Spaces und Summen', () => {
  const { settlementExportBloecke } = loadBuilders();
  const m = modellRef(
    zeile({ id: '1', space: '50161', valuedate: '2026-01-05 09:00:00', ref: 'REF-A',
      brutto: '10.00000000', sgross: '10.00000000', fees: '0.10000000', netto: '9.90000000' }),
    zeile({ id: '2', space: '97319', valuedate: '2026-01-06 09:00:00', ref: 'REF-A',
      brutto: '20.00000000', sgross: '20.00000000', fees: '0.20000000', netto: '19.80000000' }),
  );
  const b = settlementExportBloecke(m, { detail: false, reference: true });
  const bg = b.find(x => x.name === 'Bankgutschriften');
  assert.deepStrictEqual(plain(bg.header),
    ['Nr.', 'Referenz (Kontoauszug)', 'Valuta', 'Spaces', 'Tx', 'Brutto', 'Fees', 'Netto']);
  assert.deepStrictEqual(plain(bg.rows), [
    ['BG-01', 'REF-A', '05.01. - 06.01.2026', '50161, 97319', 2, 30, 0.3, 29.7],
    ['', 'TOTAL', '', '', 2, 30, 0.3, 29.7],
  ]);
});

test('Bankgutschriften: gleicher Valutatag wird als einzelnes Datum gezeigt', () => {
  const { settlementExportBloecke } = loadBuilders();
  const m = modellRef(zeile({ id: '1', valuedate: '2026-01-05 09:00:00', ref: 'REF-A' }));
  const b = settlementExportBloecke(m, { detail: false, reference: true });
  assert.strictEqual(b.find(x => x.name === 'Bankgutschriften').rows[0][2], '05.01.2026');
});

// --- Übersicht nach Space ---------------------------------------------------

test('Space-Uebersicht: je Space eine Zeile mit Settlement-Zaehler, Total stimmt', () => {
  const { settlementExportBloecke } = loadBuilders();
  const m = modell(
    zeile({ id: '1', space: '50161', valuedate: '2026-01-05 09:00:00',
      brutto: '10.00000000', sgross: '10.00000000', fees: '0.10000000', netto: '9.90000000' }),
    zeile({ id: '2', space: '97319', valuedate: '2026-01-06 09:00:00',
      brutto: '20.00000000', sgross: '20.00000000', fees: '0.20000000', netto: '19.80000000' }),
  );
  const b = settlementExportBloecke(m, { detail: false });
  const sp = b.find(x => x.name === 'Übersicht nach Space');
  assert.deepStrictEqual(plain(sp.header),
    ['Space ID', 'Settlements', 'Anzahl Tx', 'Brutto', 'Fees', 'Netto']);
  assert.deepStrictEqual(plain(sp.rows), [
    ['50161', 1, 1, 10, 0.1, 9.9],
    ['97319', 1, 1, 20, 0.2, 19.8],
    ['Total', 2, 2, 30, 0.3, 29.7],
  ]);
});

// --- Offene Transaktionen (SPEC 4.4) ----------------------------------------

test('Offene Transaktionen: einzeln gelistet mit Total', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(ZEILEN[0], OFFEN_ZEILE), { detail: false });
  const offen = b.find(x => x.name === 'Offene Transaktionen');
  assert.deepStrictEqual(plain(offen.header),
    ['#', 'Transaktions-ID', 'Zahlungsmittel', 'Brutto', 'Status']);
  assert.deepStrictEqual(plain(offen.rows), [
    [1, '999', 'Visa', 7, 'Offen'],
    ['Total', '', '', 7, ''],
  ]);
});

test('Offene Transaktionen: ohne offene Posten bleibt der Abschnitt mit "Keine." stehen', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(ZEILEN[0]), { detail: false });
  const offen = b.find(x => x.name === 'Offene Transaktionen');
  assert.ok(offen, 'Abschnitt darf nicht weggelassen werden - die Abwesenheit ist die Aussage');
  assert.deepStrictEqual(plain(offen.rows), []);
  assert.match(String(offen.hinweis), /^Keine\./);
});

// --- Transaktionsdetail (SPEC 5) --------------------------------------------

test('Transaktionen: eine Zeile je Transaktion mit Settlement-ID und Referenz', () => {
  const { settlementExportBloecke } = loadBuilders();
  const m = modellRef(
    zeile({ id: '100', space: '50161', valuedate: '2026-01-05 09:00:00', mref: 'M-1',
      createdon: '2026-01-03 08:30:00', connector: 'Visa', channel: 'Ecommerce',
      terminal: '', ref: 'REF-A' }),
  );
  const b = settlementExportBloecke(m, { detail: true, reference: true });
  const tx = b.find(x => x.name === 'Transaktionen');
  assert.deepStrictEqual(plain(tx.header), [
    'Space ID', 'Settlement-ID', 'BG-Nr.', 'Referenz (Kontoauszug)', 'Valuta',
    'Transaktionsref.', 'Transaktions-ID', 'Transaktionsdatum', 'Zahlungsmittel',
    'Kanal', 'Terminal', 'Whrg.', 'Brutto', 'Fees', 'Netto',
  ]);
  assert.deepStrictEqual(plain(tx.rows), [[
    '50161', '50161-S001', 'BG-01', 'REF-A', '05.01.2026 09:00',
    'M-1', '100', '03.01.2026 08:30', 'Visa', 'Ecommerce', '', 'CHF', 10, 0.1, 9.9,
  ]]);
});

test('Transaktionen: ohne Referenz entfallen BG- und Referenzspalte', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(modell(ZEILEN[0]), { detail: true });
  const tx = b.find(x => x.name === 'Transaktionen');
  assert.ok(!plain(tx.header).includes('BG-Nr.'));
  assert.ok(!plain(tx.header).includes('Referenz (Kontoauszug)'));
});

// --- CSV --------------------------------------------------------------------

test('CSV: Bloecke untereinander, Semikolon, BOM', () => {
  const { buildSettlementReportCsv } = loadBuilders();
  const csv = buildSettlementReportCsv(modell(...ZEILEN), { detail: false, end: '2026-02-01 00:00:00' });
  assert.ok(csv.charCodeAt(0) === 0xFEFF, 'BOM fehlt - Excel liest sonst Latin-1');
  const zeilen = csv.replace(/^﻿/, '').split('\r\n');
  assert.strictEqual(zeilen[0], 'Zusammenfassung');
  assert.ok(zeilen.includes('Settlement-Übersicht'));
  assert.ok(zeilen.includes('1;50161-S001;50161;05.01.2026 09:00;2;30;0.3;29.7;Settled'));
});

test('CSV: mit detail:true landet die Transaktionstabelle im CSV', () => {
  const { buildSettlementReportCsv } = loadBuilders();
  const csv = buildSettlementReportCsv(modell(...ZEILEN), { detail: true, end: '2026-02-01 00:00:00' });
  const zeilen = csv.replace(/^﻿/, '').split('\r\n');
  assert.ok(zeilen.includes('Transaktionen'));
  assert.ok(zeilen.some(z => z.startsWith('50161;50161-S001;')));
});

// --- Hilfsfunktionen --------------------------------------------------------

test('zellTyp: Zusammenfassung liefert je Zeile den richtigen Typ, sonst typen[c]', () => {
  const { settlementExportBloecke, zellTyp } = loadBuilders();
  const b = settlementExportBloecke(modell(...ZEILEN), { detail: false });
  const zus = b[0];
  const zeilenIndex = name => zus.rows.findIndex(r => r[0] === name);
  assert.strictEqual(zellTyp(zus, zeilenIndex('Anzahl Settlements'), 1), 'zahl');
  assert.strictEqual(zellTyp(zus, zeilenIndex('Anzahl Transaktionen'), 1), 'zahl');
  assert.strictEqual(zellTyp(zus, zeilenIndex('Brutto Volumen'), 1), 'betrag');
  assert.strictEqual(zellTyp(zus, zeilenIndex('Netto Auszahlung'), 1), 'betrag');
  assert.strictEqual(zellTyp(zus, zeilenIndex('Zeitraum Auszahlungen'), 1), 'text');
  assert.strictEqual(zellTyp(zus, 0, 0), 'text');

  const ueb = b.find(x => x.name === 'Settlement-Übersicht');
  assert.strictEqual(ueb.zellTypen, undefined);
  for (let c = 0; c < ueb.typen.length; c++) {
    assert.strictEqual(zellTyp(ueb, 0, c), ueb.typen[c]);
  }
});

test('Fallback: settlementExportBloecke(null, ...) liefert keine NaN-Werte', () => {
  const { settlementExportBloecke } = loadBuilders();
  const b = settlementExportBloecke(null, { detail: false });
  b.forEach(block => {
    block.rows.forEach(row => {
      row.forEach(zelle => {
        assert.ok(!(typeof zelle === 'number' && Number.isNaN(zelle)),
          `NaN in Block "${block.name}": ${JSON.stringify(row)}`);
      });
    });
  });
});

test('formatZahlCH: negativer Betrag (Refund) stimmt mit formatAmountCH ueberein', () => {
  const { formatZahlCH, formatAmountCH } = loadBuilders();
  assert.strictEqual(formatZahlCH(-5.3), formatAmountCH(-530000000));
  assert.strictEqual(formatZahlCH(-5.3), '-5.30');
});

test('berichtsEndeCH: Jahresgrenze', () => {
  const { berichtsEndeCH } = loadBuilders();
  assert.strictEqual(berichtsEndeCH('2026-01-01 00:00:00'), '31.12.2025');
});

// --- xlsxBlattName ----------------------------------------------------------

const BEKANNTE_BLOCKNAMEN = [
  'Zusammenfassung',
  'Aufschlüsselung nach Zahlungsmittel',
  'Übersicht nach Space',
  'Bankgutschriften',
  'Settlement-Übersicht',
  'Offene Transaktionen',
  'Transaktionen',
];

test('xlsxBlattName: alle Blocknamen bleiben innerhalb des 31-Zeichen-Limits', () => {
  const { xlsxBlattName } = loadBuilders();
  BEKANNTE_BLOCKNAMEN.forEach(n => {
    const name = xlsxBlattName(n);
    assert.ok(name.length <= 31, `"${name}" (${name.length}) aus "${n}" ueberschreitet 31 Zeichen`);
  });
});

test('xlsxBlattName: keines der verbotenen Zeichen : \\ / ? * [ ] im Ergebnis', () => {
  const { xlsxBlattName } = loadBuilders();
  const verboten = /[:\\/?*[\]]/;
  BEKANNTE_BLOCKNAMEN.concat(['Sonderfall: a/b*c?d[e]f\\g']).forEach(n => {
    assert.ok(!verboten.test(xlsxBlattName(n)), `"${n}" enthaelt noch ein verbotenes Zeichen`);
  });
});

test('xlsxBlattName: alle Blattnamen eines echten Reports sind eindeutig', () => {
  const { settlementExportBloecke, xlsxBlattName } = loadBuilders();
  const m = modellRef(
    zeile({ id: '1', valuedate: '2026-01-05 09:00:00', ref: 'REF-A' }),
    zeile({ id: '2', valuedate: '2026-01-06 09:00:00', ref: 'REF-B' }),
  );
  const namen = settlementExportBloecke(m, { detail: true, reference: true })
    .map(b => xlsxBlattName(b.name));
  namen.forEach(n => assert.ok(n.length <= 31, `"${n}" ueberschreitet 31 Zeichen`));
  assert.strictEqual(new Set(namen).size, namen.length, `Blattnamen kollidieren: ${JSON.stringify(namen)}`);
});

test('xlsxBlattName: "Aufschlüsselung nach Zahlungsmittel" wird sprechend gekuerzt', () => {
  const { xlsxBlattName } = loadBuilders();
  assert.strictEqual(xlsxBlattName('Aufschlüsselung nach Zahlungsmittel'), 'Zahlungsmittel');
});

test('xlsxBlattName: wort-bewusstes Kuerzen schneidet nie mitten im Wort ab', () => {
  const { xlsxBlattName } = loadBuilders();
  const lang = 'Ein ziemlich langer Blattname mit vielen Woertern';
  const name = xlsxBlattName(lang);
  assert.ok(name.length <= 31);
  const woerter = lang.split(' ');
  name.split(' ').forEach((wort, i) => assert.strictEqual(wort, woerter[i]));
});

// --- PDF-Layout (SPEC 4.1, 4.5) ---------------------------------------------

const PDF_OPT = {
  detail: false,
  start: '2026-01-01 00:00:00',
  end: '2026-02-01 00:00:00',
  account: '52238',
};

test('PDF: bilingualer Titel und Kopfzeilen nach Valutadatum, Spaces und Account', () => {
  const { settlementPdfBloecke } = loadBuilders();
  const p = settlementPdfBloecke(modell(...ZEILEN), PDF_OPT);
  assert.strictEqual(p.titel, 'SETTLEMENT-REPORT / SETTLEMENT REPORT');
  assert.deepStrictEqual(plain(p.kopfzeilen), [
    'Auszahlungen / Valuta: 05.01.2026 – 03.02.2026 (Transaktionen erfasst ab 03.01.2026)',
    'Space IDs: 50161',
    'Account: 52238',
  ]);
});

test('PDF: Abschnittsfolge ohne Referenz - Zusammenfassung, Uebersicht, Space-Kapitel', () => {
  const { settlementPdfBloecke } = loadBuilders();
  const p = settlementPdfBloecke(modell(...ZEILEN), PDF_OPT);
  assert.deepStrictEqual(plain(p.tabellen.map(t => t.titel)), [
    '1. Zusammenfassung',
    'Aufschlüsselung nach Zahlungsmittel',
    'Übersicht nach Space',
    '2. Settlement-Übersicht',
    'Noch nicht abgerechnete Transaktionen',
    '3. Detail pro Space — 50161',
    'Settlements — 50161',
  ]);
});

test('PDF: mit Referenz schiebt sich Abschnitt 2 (Bankgutschriften) davor', () => {
  const { settlementPdfBloecke } = loadBuilders();
  const m = modellRef(zeile({ id: '1', valuedate: '2026-01-05 09:00:00', ref: 'REF-A' }));
  const p = settlementPdfBloecke(m, { ...PDF_OPT, reference: true });
  assert.deepStrictEqual(plain(p.tabellen.map(t => t.titel)), [
    '1. Zusammenfassung',
    'Aufschlüsselung nach Zahlungsmittel',
    'Übersicht nach Space',
    '2. Bankgutschriften',
    '3. Settlement-Übersicht',
    'Noch nicht abgerechnete Transaktionen',
    '4. Detail pro Space — 50161',
    'Settlements — 50161',
  ]);
});

test('PDF: jedes Space-Kapitel beginnt auf einer neuen Seite', () => {
  const { settlementPdfBloecke } = loadBuilders();
  const m = modell(
    zeile({ id: '1', space: '50161', valuedate: '2026-01-05 09:00:00' }),
    zeile({ id: '2', space: '97319', valuedate: '2026-01-06 09:00:00' }),
  );
  const p = settlementPdfBloecke(m, PDF_OPT);
  const kapitel = p.tabellen.filter(t => /^\d\. Detail pro Space/.test(t.titel));
  assert.strictEqual(kapitel.length, 2);
  kapitel.forEach(k => assert.strictEqual(k.seitenumbruchDavor, true, `${k.titel} braucht Seitenumbruch`));
  // Die Settlement-Tabelle des Space folgt direkt, ohne weiteren Umbruch.
  const folge = p.tabellen.filter(t => /^Settlements —/.test(t.titel));
  folge.forEach(f => assert.strictEqual(f.seitenumbruchDavor, false));
});

test('PDF: Space-Kapitel traegt KPI-Zeile und Settlement-Tabelle mit voller Referenz', () => {
  const { settlementPdfBloecke } = loadBuilders();
  const m = modellRef(zeile({ id: '1', valuedate: '2026-01-05 09:00:00', ref: 'REF-VOLL-123' }));
  const p = settlementPdfBloecke(m, { ...PDF_OPT, reference: true });
  const kapitel = p.tabellen.find(t => /Detail pro Space/.test(t.titel));
  assert.match(String(kapitel.hinweis), /1 Settlements · 1 Tx · Brutto CHF 10\.00/);
  const tab = p.tabellen.find(t => /^Settlements —/.test(t.titel));
  assert.deepStrictEqual(plain(tab.header),
    ['#', 'Settlement-ID', 'Valuta', 'BG-Nr.', 'Referenz', 'Tx', 'Brutto', 'Fees', 'Netto']);
  // Referenz vollstaendig, nicht gekuerzt.
  assert.strictEqual(tab.rows[0][4], 'REF-VOLL-123');
});

test('PDF: Betraege sind fertig formatierte CH-Strings, Ausrichtung nach Typ', () => {
  const { settlementPdfBloecke } = loadBuilders();
  const p = settlementPdfBloecke(modell(...ZEILEN), PDF_OPT);
  const ueb = p.tabellen.find(t => t.titel === '2. Settlement-Übersicht');
  assert.deepStrictEqual(plain(ueb.rows[0]),
    ['1', '50161-S001', '50161', '05.01.2026 09:00', '2', '30.00', '0.30', '29.70', 'Settled']);
  assert.deepStrictEqual(plain(ueb.ausrichtung),
    ['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'left']);
});

test('PDF: Zusammenfassung respektiert zeilenweise Typen (Zaehler vs. Betrag)', () => {
  const { settlementPdfBloecke } = loadBuilders();
  const p = settlementPdfBloecke(modell(...ZEILEN), PDF_OPT);
  const zus = p.tabellen.find(t => t.titel === '1. Zusammenfassung');
  assert.strictEqual(zus.rows.find(r => r[0] === 'Anzahl Settlements')[1], '2');
  assert.strictEqual(zus.rows.find(r => r[0] === 'Brutto Volumen')[1], '60.00');
});

test('PDF: mit detail:true bleibt die Transaktionstabelle aus dem PDF (SPEC 4.6)', () => {
  const { settlementPdfBloecke } = loadBuilders();
  const p = settlementPdfBloecke(modell(...ZEILEN), { ...PDF_OPT, detail: true });
  assert.ok(!p.tabellen.some(t => t.titel === 'Transaktionen'),
    'Transaktionsdetail gehoert in die Excel-Datei, nicht ins PDF');
});
