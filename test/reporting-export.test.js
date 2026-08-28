// Reporting-Modus (v5.11), Task 4: Export-Bloecke.
//
// reportingExportBloecke ist die EINE Quelle, aus der Bildschirm, XLSX, PDF und
// CSV gespeist werden - dieselbe Bauweise wie settlementExportBloecke beim
// Settlement-Report. Diese Datei prueft ausschliesslich die Blockschicht:
// Reihenfolge, Titel, Spaltenbeschreibung und die Form der Werte. Die Zahlen
// selbst sind in test/reporting-model.test.js festgenagelt.
//
// Rein und DOM-frei, deshalb ohne DOM-Ersatz.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadBuilders, plain } = require('./harness');

// Spaltenreihenfolge wie in der Query (identisch zu reporting-model.test.js).
const KOPF = [
  'block', 'space_id', 'channel', 'brand', 'wallet', 'waehrung', 'attempt_state',
  'failure_reason_id', 'auth_response_code', 'issuer_country', 'card_category',
  'funding', 'pan_type', 'dcc', 'tds_started', 'tds_cavv', 'eci', 'tag', 'stunde',
  'anzahl_attempts', 'summe_betrag', 'summe_betrag_failed',
  'summe_refund', 'summe_tip', 'tx_mit_attempt', 'tx_erfolgreich',
];

const q = v => '"' + String(v == null ? '' : v) + '"';
function zeile(werte) {
  return KOPF.map(k => q(werte[k] === undefined ? '' : werte[k])).join(',');
}
function csv(zeilen) {
  return [KOPF.map(q).join(','), ...zeilen.map(zeile)].join('\n') + '\n';
}

const DIM_POS = {
  block: 'DIM', space_id: '90001', channel: 'POS', brand: 'Visa', wallet: '-',
  waehrung: 'CHF', attempt_state: 'SUCCESSFUL', auth_response_code: '00',
  issuer_country: 'CH', card_category: 'CLASSIC', funding: 'DEBIT',
  dcc: 'false', tds_started: 'false', tds_cavv: 'false',
  anzahl_attempts: '20',
  summe_betrag: '200.00000000', summe_betrag_failed: '0.00000000',
  summe_refund: '0.00000000',
};
const DIM_ECOM = Object.assign({}, DIM_POS, {
  space_id: '90002', channel: 'ECOM', funding: 'CREDIT',
  tds_started: 'true', tds_cavv: 'true',
});

function modellAus(zeilen, optionen) {
  const { parseReportingCsv, buildReportingModel } = loadBuilders();
  const res = parseReportingCsv(csv(zeilen));
  assert.strictEqual(res.error, null);
  return buildReportingModel(res.rows, optionen || { merchantCountry: 'CH' });
}
function bloeckeAus(zeilen, optionen) {
  const { reportingExportBloecke } = loadBuilders();
  return reportingExportBloecke(modellAus(zeilen), optionen || {});
}
function titel(bloecke) { return plain(bloecke.map(b => b.titel)); }

function fixturModell() {
  const { parseReportingCsv, buildReportingModel } = loadBuilders();
  const text = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'reporting-beispiel.csv'), 'utf8');
  const res = parseReportingCsv(text);
  assert.strictEqual(res.error, null);
  return buildReportingModel(res.rows, { merchantCountry: 'CH' });
}

function reportingExportBloeckeFixtur() {
  const { reportingExportBloecke } = loadBuilders();
  return reportingExportBloecke(fixturModell(), {});
}

// Laeuft ueber jede Zelle jedes Blocks.
function jedeZelle(bloecke, fn) {
  bloecke.forEach(b => b.zeilen.forEach((z, r) => z.forEach((wert, c) => fn(wert, b, r, c))));
}

// --- Reihenfolge und Titel --------------------------------------------------

test('POS-Satz: Titelblock voran, danach die Bloecke in fester Reihenfolge', () => {
  assert.deepStrictEqual(titel(bloeckeAus([DIM_POS])), [
    'Reporting',
    'POS · Kennzahlen',
    'POS · Zahlungsmittel',
    'POS · Kartentyp',
    'POS · Kartenherkunft',
    'POS · Top-10 Länder',
    'POS · Debit und Kredit',
    'POS · Beträge je Währung',
  ]);
});

test('E-Com-Satz: 3DS statt Debit/Kredit, gleiche Reihenfolge', () => {
  assert.deepStrictEqual(titel(bloeckeAus([DIM_ECOM])), [
    'Reporting',
    'E-Com · Kennzahlen',
    'E-Com · Zahlungsmittel',
    'E-Com · Kartentyp',
    'E-Com · Kartenherkunft',
    'E-Com · Top-10 Länder',
    'E-Com · 3DS-Akzeptanz',
    'E-Com · 3DS-Status',
    'E-Com · Beträge je Währung',
  ]);
});

test('Kanal Andere: nur die kanalunabhaengigen Bloecke, Karten-Bloecke entfallen', () => {
  const zeilen = [Object.assign({}, DIM_POS, {
    channel: 'OTHER', brand: 'TWINT', issuer_country: '', card_category: '', funding: '',
  })];
  assert.deepStrictEqual(titel(bloeckeAus(zeilen)), [
    'Reporting',
    'Andere · Kennzahlen',
    'Andere · Zahlungsmittel',
    'Andere · Beträge je Währung',
  ]);
});

test('Ein Block-Set je Kanal, Kanal-Titel voran und in der Kanal-Reihenfolge', () => {
  const b = plain(bloeckeAus([DIM_POS, DIM_ECOM]));
  const kanaele = b.slice(1).map(x => x.titel.split(' · ')[0]);
  // POS kommt vollstaendig vor E-Com, kein Verschraenken der beiden Saetze.
  const wechsel = kanaele.filter((k, i) => i > 0 && k !== kanaele[i - 1]);
  assert.deepStrictEqual(wechsel, ['E-Com']);
  assert.strictEqual(b[0].titel, 'Reporting');
  // Jeder Kanal-Block traegt den Kanal auch als Feld, damit Task 5 gruppieren
  // kann, ohne den Titel zu zerlegen.
  b.slice(1).forEach(x => assert.ok(x.kanal === 'POS' || x.kanal === 'ECOM', x.titel));
  assert.strictEqual(b[0].kanal, '');
});

test('Kanalspezifisch: P-Bloecke nie im E-Com-Satz und E-Bloecke nie im POS-Satz', () => {
  const b = plain(bloeckeAus([DIM_POS, DIM_ECOM]));
  const pos = b.filter(x => x.kanal === 'POS').map(x => x.titel);
  const ecom = b.filter(x => x.kanal === 'ECOM').map(x => x.titel);
  ['Debit und Kredit', 'Terminals'].forEach(n => {
    assert.ok(!ecom.some(t => t.endsWith(n)), `${n} gehoert nicht in den E-Com-Satz`);
  });
  ['3DS-Akzeptanz', '3DS-Status', 'Conversion'].forEach(n => {
    assert.ok(!pos.some(t => t.endsWith(n)), `${n} gehoert nicht in den POS-Satz`);
  });
  assert.ok(pos.includes('POS · Debit und Kredit'));
  assert.ok(ecom.includes('E-Com · 3DS-Status'));
});

// --- Kein Datenmaterial -----------------------------------------------------

test('Kanal ohne Daten: EIN Hinweisblock statt einer Reihe leerer Tabellen', () => {
  // CONV-Zeile ohne jeden Attempt: der Kanal existiert, hat aber nichts zu
  // zeigen. Genau der Fall aus SPEC 7.
  const conv = { block: 'CONV', space_id: '90002', channel: 'ECOM', brand: 'Visa',
    waehrung: 'CHF', tx_mit_attempt: '0', tx_erfolgreich: '0' };
  const b = plain(bloeckeAus([DIM_POS, conv]));
  const ecom = b.filter(x => x.kanal === 'ECOM');
  assert.strictEqual(ecom.length, 1);
  assert.strictEqual(ecom[0].titel, 'E-Com · Keine Daten');
  assert.deepStrictEqual(ecom[0].kopf, []);
  assert.deepStrictEqual(ecom[0].zeilen, []);
  assert.ok(/Zahlungsversuch/i.test(ecom[0].hinweis));
});

test('Leeres Modell: Titelblock plus ein Hinweisblock, sonst nichts', () => {
  const { reportingExportBloecke, buildReportingModel } = loadBuilders();
  const b = plain(reportingExportBloecke(buildReportingModel({ dim: [], time: [], conv: [] }), {}));
  assert.deepStrictEqual(b.map(x => x.titel), ['Reporting', 'Keine Daten']);
  assert.deepStrictEqual(b[1].zeilen, []);
  assert.ok(/Zahlungsversuch/i.test(b[1].hinweis));
});

test('Defensive Aufrufe ohne Modell werfen nicht', () => {
  const { reportingExportBloecke } = loadBuilders();
  assert.ok(reportingExportBloecke(null, {}).length >= 1);
  assert.ok(reportingExportBloecke(undefined).length >= 1);
});

// --- Werte: Zahlen bleiben Zahlen ------------------------------------------

test('Zahlen bleiben Zahlen - keine formatierten Strings in zeilen', () => {
  const b = bloeckeAus([DIM_POS, DIM_ECOM]);
  jedeZelle(b, (wert, block, r, c) => {
    const art = typeof wert;
    assert.ok(wert === null || art === 'string' || art === 'number',
      `${block.titel} [${r}][${c}]: unerwarteter Typ ${art}`);
    if (art === 'number') assert.ok(Number.isFinite(wert), `${block.titel}: ${wert}`);
    if (art === 'string') {
      // Weder das Schweizer Tausenderzeichen noch ein Prozentzeichen duerfen
      // in einer Zelle stehen: XLSX braucht echte Zahlen plus Zahlformat.
      assert.ok(!/[’%]/.test(wert), `${block.titel} [${r}][${c}]: formatiert "${wert}"`);
      assert.ok(!/^-?\d[\d’]*\.\d\d$/.test(wert), `${block.titel} [${r}][${c}]: "${wert}"`);
    }
  });
});

test('Prozentspalten tragen format "pct", ihre Werte sind Zahlen 0-100 oder null', () => {
  const b = bloeckeAus([DIM_POS, DIM_ECOM]);
  let gesehen = 0;
  b.forEach(block => {
    block.kopf.forEach((sp, c) => {
      if (sp.format !== 'pct') return;
      gesehen += 1;
      block.zeilen.forEach((z, r) => {
        const wert = z[c];
        if (wert === null || wert === '') return;
        assert.strictEqual(typeof wert, 'number', `${block.titel} [${r}][${c}]`);
        assert.ok(wert >= 0 && wert <= 100, `${block.titel}: ${wert}`);
      });
    });
  });
  assert.ok(gesehen >= 5, 'es gibt Prozentspalten');
  // Volle Genauigkeit: gerundet wird erst in der Ausgabe (Task 5).
  const anteil = bloeckeAus([
    Object.assign({}, DIM_POS, { anzahl_attempts: '1' }),
    Object.assign({}, DIM_POS, { brand: 'Mastercard', anzahl_attempts: '2' }),
  ]).find(x => x.titel === 'POS · Zahlungsmittel');
  const spalte = anteil.kopf.findIndex(s => s.label === 'Anteil %');
  const werte = plain(anteil.zeilen.map(z => z[spalte]));
  assert.ok(werte.some(v => typeof v === 'number' && String(v).length > 5),
    'ungerundeter Anteil (33.33...) erwartet, gefunden: ' + JSON.stringify(werte));
});

test('Betraege bleiben ganzzahlige 1e-8-Einheiten', () => {
  const b = bloeckeAus([DIM_POS]);
  const block = b.find(x => x.titel === 'POS · Beträge je Währung');
  const c = block.kopf.findIndex(s => s.label === 'Umsatz');
  assert.strictEqual(block.kopf[c].format, 'betrag');
  // 200.00 CHF = 20'000'000'000 Einheiten, nicht 200.
  assert.strictEqual(block.zeilen[0][c], 20000000000);
  // Ueber reportingZellFormat, nicht ueber kopf[i].format: die Kacheln tragen
  // das Format je Zelle, ihre Betraege blieben sonst ungeprueft.
  const { reportingZellFormat } = loadBuilders();
  let betragsZellen = 0;
  jedeZelle(b, (wert, blk, r, i) => {
    if (reportingZellFormat(blk, r, i) === 'betrag' && typeof wert === 'number') {
      betragsZellen += 1;
      assert.ok(Number.isInteger(wert), `${blk.titel} [${r}][${i}]: ${wert}`);
    }
  });
  assert.ok(betragsZellen > 10, 'genug Betragszellen geprueft: ' + betragsZellen);
});

// --- Waehrungen -------------------------------------------------------------

test('Waehrung steht in der Zeile, Betragsspalten mischen nie zwei Waehrungen', () => {
  const b = bloeckeAus([
    DIM_ECOM,
    Object.assign({}, DIM_ECOM, { waehrung: 'EUR', summe_betrag: '100.00000000' }),
  ]);
  const zm = b.find(x => x.titel === 'E-Com · Zahlungsmittel');
  const cW = zm.kopf.findIndex(s => s.label === 'Währung');
  assert.ok(cW >= 0, 'Zahlungsmittel-Block traegt eine Waehrungsspalte');
  const cB = zm.kopf.findIndex(s => s.label === 'Betrag');
  assert.ok(cB > cW, 'die Waehrung steht vor den Betraegen');
  // Eine Zeile je (Brand, Waehrung); die waehrungsfreien Spalten stehen nur in
  // der ersten Zeile des Brands, damit eine Summe ueber Attempts nicht doppelt
  // zaehlt.
  // Zeilen 0/1 sind der einzige Brand, danach folgen die beiden Total-Zeilen.
  const visa = zm.zeilen.slice(0, 2);
  assert.strictEqual(zm.zeilen.length, 4);
  assert.strictEqual(zm.zeilen[2][0], 'Total');
  assert.strictEqual(zm.zeilen[3][0], '');
  assert.strictEqual(visa[0][cW], 'CHF');
  assert.strictEqual(visa[1][cW], 'EUR');
  assert.strictEqual(visa[1][0], '');
  assert.notStrictEqual(visa[0][cB], visa[1][cB]);

  const bw = b.find(x => x.titel === 'E-Com · Beträge je Währung');
  assert.deepStrictEqual(plain(bw.zeilen.map(z => z[0])), ['CHF', 'EUR']);
});

test('P3: Trinkgeld-Spalten haengen an "Betraege je Waehrung", wo es Trinkgeld gibt', () => {
  const b = plain(reportingExportBloeckeFixtur());
  const pos = b.find(x => x.titel === 'POS · Beträge je Währung');
  assert.deepStrictEqual(pos.kopf.map(sp => `${sp.label}:${sp.format}`), [
    'Währung:text', 'Erfolgreich:zahl', 'Umsatz:betrag', 'Ø-Betrag:betrag',
    'Fehlgeschlagen:zahl', 'Betrag fehlgeschlagen:betrag', 'Ø fehlgeschlagen:betrag',
    'Rückerstattungen:betrag', 'Refund-Quote %:pct',
    'Trinkgeld:betrag', 'Trinkgeld-Quote %:pct',
  ]);
  // 1'526.07 von 30'891.16 Umsatz - roh, ungerundet, in 1e-8-Einheiten.
  const zeile = pos.zeilen[0];
  assert.strictEqual(zeile[0], 'CHF');
  assert.strictEqual(zeile[9], 152607000000);
  assert.strictEqual(Math.round(zeile[10] * 10) / 10, 4.9);
  // Das Trinkgeld ist im Umsatz bereits enthalten (an Produktivdaten belegt) -
  // der Hinweis muss das sagen, sonst wird es addiert.
  assert.match(pos.hinweis, /Trinkgeld/);
});

test('P3 entfaellt, wo kein Trinkgeld vorkommt (SPEC 4.2)', () => {
  // SPEC 4.2: "nur wenn Space Trinkgeld-Lineitems hat". Eine Spalte mit lauter
  // 0.00 behauptete, es sei gemessen worden und es sei nichts gewesen - im
  // E-Commerce ist die Frage aber gar nicht gestellt.
  const b = plain(reportingExportBloeckeFixtur());
  const ecom = b.find(x => x.titel === 'E-Com · Beträge je Währung');
  assert.ok(!ecom.kopf.some(sp => /Trinkgeld/.test(sp.label)),
    'E-Com traegt kein Trinkgeld und darf die Spalten nicht zeigen');
  assert.strictEqual(ecom.zeilen[0].length, ecom.kopf.length);
  // Auch am POS nicht, solange kein Trinkgeld gebucht ist.
  const ohne = bloeckeAus([DIM_POS]).find(x => x.titel === 'POS · Beträge je Währung');
  assert.ok(!ohne.kopf.some(sp => /Trinkgeld/.test(sp.label)));
  assert.doesNotMatch(ohne.hinweis, /Trinkgeld/);
});

test('Kacheln: eigener typ und ein Zellformat je Zelle', () => {
  const { reportingZellFormat } = loadBuilders();
  const b = bloeckeAus([DIM_POS]);
  const k = b.find(x => x.titel === 'POS · Kennzahlen');
  assert.strictEqual(k.typ, 'kacheln');
  assert.deepStrictEqual(plain(k.kopf.map(s => s.label)), ['Kennzahl', 'Wert', 'Währung']);
  assert.strictEqual(k.zeilen.length, k.zellFormate.length);
  // Die Wert-Spalte mischt Zaehler, Prozente und Betraege - deshalb je Zelle.
  const formate = plain(k.zellFormate.map(f => f[1]));
  assert.ok(formate.includes('zahl'));
  assert.ok(formate.includes('pct'));
  assert.ok(formate.includes('betrag'));
  // Betrags-Kacheln tragen ihre Waehrung in der dritten Spalte.
  k.zeilen.forEach((z, r) => {
    if (k.zellFormate[r][1] === 'betrag') assert.strictEqual(z[2], 'CHF');
    else assert.strictEqual(z[2], '');
  });
  // Der Zell-Vorrang laeuft ueber genau einen Helfer (wie zellTyp beim
  // Settlement-Report), damit Task 5 ihn nicht nachbauen muss.
  const iPct = plain(k.zellFormate).findIndex(f => f[1] === 'pct');
  assert.strictEqual(reportingZellFormat(k, iPct, 1), 'pct');
  assert.strictEqual(reportingZellFormat(k, 0, 0), 'text');
  const zm = b.find(x => x.titel === 'POS · Zahlungsmittel');
  assert.strictEqual(reportingZellFormat(zm, 0, 1), zm.kopf[1].format);
});

// --- Kuerzungen und Blattnamen ---------------------------------------------

test('Ablehngruende werden auf Top-10 gekuerzt, der Hinweis nennt den Rest', () => {
  const zeilen = [];
  for (let i = 0; i < 13; i += 1) {
    zeilen.push(Object.assign({}, DIM_POS, {
      attempt_state: 'FAILED', failure_reason_id: String(1000 + i),
      auth_response_code: String(10 + i),
      anzahl_attempts: String(20 - i), summe_betrag: '', summe_betrag_failed: '5.00000000',
    }));
  }
  const b = bloeckeAus(zeilen);
  const g = b.find(x => x.titel === 'POS · Ablehngründe');
  assert.strictEqual(g.zeilen.length, 10);
  assert.ok(/3 weitere/.test(g.hinweis), g.hinweis);
  const c = b.find(x => x.titel === 'POS · Ablehncodes');
  assert.strictEqual(c.zeilen.length, 10);
});

test('Alle Titel ueberleben xlsxBlattName ungekuerzt und bleiben eindeutig', () => {
  const { reportingExportBloecke, xlsxBlattName } = loadBuilders();
  const b = plain(reportingExportBloecke(fixturModell(), {}));
  const namen = new Set();
  b.forEach(x => {
    assert.strictEqual(xlsxBlattName(x.titel), x.titel, `gekuerzt: ${x.titel}`);
    assert.ok(!namen.has(x.titel), `doppelter Blattname: ${x.titel}`);
    namen.add(x.titel);
  });
});

test('E6: die PAN-Quelle steht durchgehend in einer Sprache', () => {
  // Vorher mischte der Block eine uebersetzte Schublade ("Unbekannt") mit rohen
  // Label-Werten ("DEVICE_TOKEN_APPLE_PAY") - dieselbe Spalte, zwei Register.
  // Uebersetzt sind nur die beiden an Produktivdaten belegten Werte; ein
  // unbekannter bleibt bewusst roh stehen, statt erfunden zu werden.
  const b = plain(reportingExportBloeckeFixtur());
  const pan = b.find(x => x.titel === 'E-Com · PAN-Quelle');
  assert.ok(pan, 'PAN-Quelle-Block fehlt');
  const namen = pan.zeilen.map(z => z[0]);
  assert.ok(namen.includes('Device-Token (Apple Pay)'));
  assert.ok(!namen.some(n => /_/.test(n)), 'kein roher Label-Wert: ' + namen.join(', '));
  assert.ok(namen.includes('Unbekannt'));
});

// --- Fixture ----------------------------------------------------------------

test('Fixture: alle drei Kanaele, Titelblock nennt Zeitraum und Spaces', () => {
  const { reportingExportBloecke } = loadBuilders();
  const b = plain(reportingExportBloecke(fixturModell(), {
    zeitraum: { start: '2026-07-01 00:00:00', end: '2026-07-31 23:59:59' },
    spaces: ['90001', '90002'],
  }));
  assert.strictEqual(b[0].titel, 'Reporting');
  assert.strictEqual(b[0].typ, 'tabelle');
  const kopfWerte = new Map(b[0].zeilen);
  assert.strictEqual(kopfWerte.get('Zeitraum (Auswahl)'), '01.07.2026 – 31.07.2026');
  assert.strictEqual(kopfWerte.get('Spaces'), '90001, 90002');
  assert.strictEqual(kopfWerte.get('Händler-Land'), 'CH');
  assert.strictEqual(kopfWerte.get('Kanäle'), 'POS, E-Com, Andere');
  const kanaele = [...new Set(b.slice(1).map(x => x.kanal))];
  assert.deepStrictEqual(kanaele, ['POS', 'ECOM', 'OTHER']);
  // Verlauf und Stunden gibt es, wo TIME-Zeilen vorliegen - seit die Fixture
  // ihren TIME-Block aus dem DIM-Block ableitet, ist das jeder Kanal mit
  // Attempts, also auch "Andere". Genau so verhaelt sich die echte Query: beide
  // Bloecke zaehlen dasselbe att-CTE.
  assert.ok(b.some(x => x.titel === 'POS · Verlauf' && x.typ === 'balken'));
  assert.ok(b.some(x => x.titel === 'E-Com · Stunden' && x.typ === 'balken'));
  assert.ok(b.some(x => x.titel === 'Andere · Verlauf' && x.typ === 'balken'));
  // Terminals: die Fixture traegt keine Terminal-Spalten, der Block entfaellt.
  assert.ok(!b.some(x => x.titel === 'POS · Terminals'));
});

test('Fixture: jeder Block hat Titel, kopf-Deskriptoren, zeilen und typ', () => {
  const { reportingExportBloecke } = loadBuilders();
  const erlaubt = new Set(['tabelle', 'kacheln', 'balken']);
  const formate = new Set(['text', 'zahl', 'betrag', 'pct', 'faktor', 'gemischt']);
  plain(reportingExportBloecke(fixturModell(), {})).forEach(b => {
    assert.strictEqual(typeof b.titel, 'string');
    assert.ok(b.titel.length > 0);
    assert.ok(erlaubt.has(b.typ), `${b.titel}: typ ${b.typ}`);
    assert.ok(Array.isArray(b.kopf) && Array.isArray(b.zeilen));
    assert.strictEqual(typeof b.hinweis, 'string');
    b.kopf.forEach(s => {
      assert.strictEqual(typeof s.label, 'string');
      assert.ok(formate.has(s.format), `${b.titel}: format ${s.format}`);
    });
    b.zeilen.forEach((z, r) => assert.strictEqual(z.length, b.kopf.length,
      `${b.titel} [${r}]: ${z.length} Zellen statt ${b.kopf.length}`));
  });
});

test('Fixture: Terminal-Block erscheint, sobald Terminal-Zeilen da sind', () => {
  const { parseReportingCsv, buildReportingModel, reportingExportBloecke } = loadBuilders();
  const kopf = KOPF.concat(['terminal_identifier', 'terminal_name']);
  const zeilenText = [
    kopf.map(q).join(','),
    kopf.map(k => q(k === 'terminal_identifier' ? 'T-1'
      : k === 'terminal_name' ? 'Kasse 1' : (DIM_POS[k] === undefined ? '' : DIM_POS[k]))).join(','),
  ].join('\n') + '\n';
  const res = parseReportingCsv(zeilenText);
  assert.strictEqual(res.error, null);
  const b = plain(reportingExportBloecke(buildReportingModel(res.rows, { merchantCountry: 'CH' }), {}));
  const t = b.find(x => x.titel === 'POS · Terminals');
  assert.ok(t, 'Terminal-Block fehlt');
  assert.strictEqual(t.zeilen[0][0], 'T-1');
  assert.strictEqual(t.zeilen[0][1], 'Kasse 1');
});

// --- Der pct-Marker selbst (Fix-Runde 1) ------------------------------------
// Der Test darueber laeuft nur ueber Spalten, die den Marker SCHON tragen -
// ihn wegzunehmen faellt dort nicht auf. Diese beiden Tests nageln fest, WELCHE
// Spalten ihn tragen muessen, in beide Richtungen.

// Kennzahl/Wert-Bloecke koennen kein %-Label tragen; ihr Wert-Format steht hier
// namentlich, damit auch dort keine Mutation durchrutscht.
const WERT_FORMAT = {
  Reporting: 'text',
  'POS · Kennzahlen': 'gemischt',
  'E-Com · Kennzahlen': 'gemischt',
  'Andere · Kennzahlen': 'gemischt',
  'E-Com · 3DS-Akzeptanz': 'pct',
};

test('Jede %-Spalte traegt format "pct" und jede pct-Spalte ein %-Label', () => {
  const { reportingExportBloecke } = loadBuilders();
  let pctSpalten = 0;
  plain(reportingExportBloecke(fixturModell(), {})).forEach(b => b.kopf.forEach(s => {
    if (s.label === 'Wert') {
      assert.ok(Object.prototype.hasOwnProperty.call(WERT_FORMAT, b.titel),
        `unbekannter Kennzahl/Wert-Block: ${b.titel}`);
      assert.strictEqual(s.format, WERT_FORMAT[b.titel], b.titel);
      if (s.format === 'pct') pctSpalten += 1;
      return;
    }
    assert.strictEqual(/%$/.test(s.label), s.format === 'pct', `${b.titel}: ${s.label}`);
    if (s.format === 'pct') pctSpalten += 1;
  }));
  assert.ok(pctSpalten > 20, 'genug pct-Spalten geprueft: ' + pctSpalten);
});

test('kopf-Deskriptoren der Kernbloecke stehen fest', () => {
  const { reportingExportBloecke } = loadBuilders();
  const b = plain(reportingExportBloecke(fixturModell(), {}));
  const kopf = t => b.find(x => x.titel === t).kopf.map(s => `${s.label}:${s.format}`);
  assert.deepStrictEqual(kopf('POS · Zahlungsmittel'), [
    'Brand:text', 'Attempts:zahl', 'Anteil %:pct', 'Erfolg %:pct', 'Failure %:pct',
    'Währung:text', 'Betrag:betrag', 'Anteil Betrag %:pct', 'Ø-Betrag:betrag',
  ]);
  assert.deepStrictEqual(kopf('E-Com · Conversion'), [
    'Brand:text', 'Transaktionen:zahl', 'Erfolgreiche Tx:zahl', 'Conversion %:pct',
    'Attempts:zahl', 'Retry-Rate:faktor',
  ]);
  assert.deepStrictEqual(kopf('POS · Kennzahlen'), [
    'Kennzahl:text', 'Wert:gemischt', 'Währung:text',
  ]);
});

// --- E5: Ablehngruende je Zahlungsmittel ------------------------------------

test('E5: Kreuztabelle Brand x Ablehngrund, Anteil am Brand selbst', () => {
  const { reportingExportBloecke } = loadBuilders();
  const b = plain(reportingExportBloecke(fixturModell(), {}));
  const e5 = b.find(x => x.titel === 'E-Com · Ablehngründe je Brand');
  assert.ok(e5, 'E5-Block fehlt im E-Com-Satz');
  assert.deepStrictEqual(e5.kopf.map(s => `${s.label}:${s.format}`),
    ['Brand:text', 'Grund:text', 'ID:text', 'Attempts:zahl', 'Anteil %:pct']);
  // Von Hand aus den DIM-Zeilen der Fixture: Visa 41, Mastercard 19, UNKNOWN 6,
  // je der einzige Grund des Brands, also je 100 % dieses Brands.
  assert.deepStrictEqual(e5.zeilen, [
    ['Visa', '#1487356536632', '1487356536632', 41, 100],
    ['Mastercard', '#1487356536644', '1487356536644', 19, 100],
    ['UNKNOWN', 'Unbekannt', 'UNKNOWN', 6, 100],
  ]);
  // Der Anteil misst den Brand, nicht den Kanal: 41 von 66 gescheiterten
  // Versuchen des Kanals waeren 62.1 %, nicht 100 %.
  const k8 = b.find(x => x.titel === 'E-Com · Ablehngründe');
  assert.notStrictEqual(k8.zeilen[0][3], e5.zeilen[0][4]);
});

test('E5 steht direkt hinter K8 und ersetzt die Ablehncodes nicht', () => {
  const { reportingExportBloecke } = loadBuilders();
  const t = plain(reportingExportBloecke(fixturModell(), {})).map(x => x.titel);
  const i = t.indexOf('E-Com · Ablehngründe');
  assert.strictEqual(t[i + 1], 'E-Com · Ablehngründe je Brand');
  assert.strictEqual(t[i + 2], 'E-Com · Ablehncodes');
  assert.strictEqual(t[i + 3], 'E-Com · Conversion');
});

test('E5 entfaellt, solange nur EIN Brand scheitert - dann waere er K8 mit Zusatzspalte', () => {
  const { reportingExportBloecke } = loadBuilders();
  // POS der Fixture: einzig Visa hat gescheiterte Versuche.
  const t = plain(reportingExportBloecke(fixturModell(), {})).map(x => x.titel);
  assert.ok(t.includes('POS · Ablehngründe'));
  assert.ok(!t.includes('POS · Ablehngründe je Brand'));
  // Sobald ein zweiter Brand scheitert, erscheint er - auch am POS.
  const b = bloeckeAus([
    Object.assign({}, DIM_POS, { attempt_state: 'FAILED', failure_reason_id: '11',
      summe_betrag: '', summe_betrag_failed: '5.00000000' }),
    Object.assign({}, DIM_POS, { brand: 'TWINT', attempt_state: 'FAILED',
      failure_reason_id: '22', anzahl_attempts: '5',
      summe_betrag: '', summe_betrag_failed: '5.00000000' }),
  ]);
  const e5 = plain(b).find(x => x.titel === 'POS · Ablehngründe je Brand');
  assert.ok(e5);
  assert.deepStrictEqual(e5.zeilen.map(z => [z[0], z[3], z[4]]),
    [['Visa', 20, 100], ['TWINT', 5, 100]]);
});

test('E5 kuerzt je Brand auf fuenf Gruende (SPEC 4.3)', () => {
  const zeilen = [];
  for (let i = 0; i < 7; i += 1) {
    zeilen.push(Object.assign({}, DIM_POS, {
      attempt_state: 'FAILED', failure_reason_id: String(100 + i),
      anzahl_attempts: String(20 - i), summe_betrag: '', summe_betrag_failed: '5.00000000',
    }));
  }
  // Zweiter Brand, damit der Block ueberhaupt erscheint.
  zeilen.push(Object.assign({}, DIM_POS, { brand: 'TWINT', attempt_state: 'FAILED',
    failure_reason_id: '900', anzahl_attempts: '3',
    summe_betrag: '', summe_betrag_failed: '5.00000000' }));
  const e5 = plain(bloeckeAus(zeilen)).find(x => x.titel === 'POS · Ablehngründe je Brand');
  const visa = e5.zeilen.filter(z => z[0] === 'Visa');
  assert.strictEqual(visa.length, 5);
  // Absteigend nach Anzahl, die beiden kleinsten fallen weg.
  assert.deepStrictEqual(visa.map(z => z[3]), [20, 19, 18, 17, 16]);
  // Der Anteil bleibt der am Brand (119 gescheiterte Visa-Versuche).
  assert.ok(Math.abs(visa[0][4] - (20 / 119) * 100) < 1e-9);
});

// --- Prosa, die Task 5 braucht (Fix-Runde 1) --------------------------------

test('Verlauf-Hinweis erklaert, warum die Spalten nicht aufgehen', () => {
  const { reportingExportBloecke } = loadBuilders();
  const b = plain(reportingExportBloecke(fixturModell(), {}));
  const v = b.find(x => x.titel === 'E-Com · Verlauf');
  // Der Verlauf wird eigenstaendig als Balken gezeichnet; ohne die Klausel
  // sieht "225 Attempts, 127 erfolgreich, 0 fehlgeschlagen, 100 %" nach einem
  // Rechenfehler aus, statt nach 98 offenen Versuchen.
  assert.ok(/PENDING/.test(v.hinweis), v.hinweis);
  const zeile = v.zeilen[0];
  assert.ok(zeile[2] + zeile[3] < zeile[1], 'Fixture zeigt offene Versuche im Verlauf');
});

test('Titelblock schreibt die Tageszahl ohne Tausenderzeichen', () => {
  const { parseReportingCsv, buildReportingModel, reportingExportBloecke } = loadBuilders();
  // Zwei TIME-Zeilen weit auseinander: der Zeitraum umfasst ueber tausend Tage.
  const time = { block: 'TIME', space_id: '90001', channel: 'POS', brand: 'Visa',
    waehrung: 'CHF', attempt_state: 'SUCCESSFUL', stunde: '8', anzahl_attempts: '4',
    summe_betrag: '80.00000000' };
  const res = parseReportingCsv(csv([
    DIM_POS,
    Object.assign({}, time, { tag: '2020-01-01' }),
    Object.assign({}, time, { tag: '2026-07-01' }),
  ]));
  assert.strictEqual(res.error, null);
  const b = plain(reportingExportBloecke(buildReportingModel(res.rows, { merchantCountry: 'CH' }), {}));
  const wert = new Map(b[0].zeilen).get('Zeitraum (Daten)');
  assert.ok(/\(2374 Tage\)$/.test(wert), wert);
  assert.ok(!/’/.test(wert), wert);
  // Ueber dem Verlaufs-Deckel: der Hinweis sagt, dass die Tagesachse Luecken hat.
  const v = b.find(x => x.titel === 'POS · Verlauf');
  assert.ok(/lückenlose Tagesachse/.test(v.hinweis), v.hinweis);
});
