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

// Baut n Ablehngruende mit absteigender Haeufigkeit (20, 19, ...) im POS-Kanal.
function gruende(n, over) {
  const zeilen = [];
  for (let i = 0; i < n; i += 1) {
    zeilen.push(Object.assign({}, DIM_POS, {
      attempt_state: 'FAILED', failure_reason_id: String(1000 + i),
      auth_response_code: String(10 + i),
      anzahl_attempts: String(20 - i), summe_betrag: '', summe_betrag_failed: '5.00000000',
    }, over || {}));
  }
  return zeilen;
}

test('Ablehngruende stehen vollstaendig da, der Rest als eine Zeile „Übrige“', () => {
  const { REPORTING_GRUENDE_MAX } = loadBuilders();
  const max = REPORTING_GRUENDE_MAX;
  const b = bloeckeAus(gruende(max + 4));
  const g = b.find(x => x.titel === 'POS · Ablehngründe');
  assert.strictEqual(g.zeilen.length, max + 1);
  const letzte = g.zeilen[max];
  assert.strictEqual(letzte[0], 'Übrige (4 Gründe)');
  // Summe der vier uebrigen Gruende (Haeufigkeiten 20-max ... 20-max-3).
  const rest = [0, 1, 2, 3].reduce((a, i) => a + (20 - (max + i)), 0);
  assert.strictEqual(letzte[2], rest);
  // Die Anteile gehen jetzt auf 100 % auf - genau der Punkt der Umstellung.
  const summe = g.zeilen.reduce((a, z) => a + z[3], 0);
  assert.ok(Math.abs(summe - 100) < 1e-9, String(summe));
  // Und deshalb steht dort keine Fussnote mehr, die etwas Fehlendes ankuendigt.
  assert.ok(!/nicht dargestellt/.test(g.hinweis), g.hinweis);
  // Die Ablehncodes bleiben bei der Top-10-Kuerzung (P6, unveraendert).
  assert.strictEqual(b.find(x => x.titel === 'POS · Ablehncodes').zeilen.length, 10);
});

test('Die „Übrige“-Zeile entsteht nie fuer einen einzelnen Grund', () => {
  const { REPORTING_GRUENDE_MAX, reportingUebrige } = loadBuilders();
  const max = REPORTING_GRUENDE_MAX;
  // Genau ein Grund mehr als die Schwelle: er steht selbst da, denn
  // "Übrige (1 Grund)" braucht dieselbe Zeile und sagt weniger.
  const g = bloeckeAus(gruende(max + 1)).find(x => x.titel === 'POS · Ablehngründe');
  assert.strictEqual(g.zeilen.length, max + 1);
  assert.ok(!/Übrige/.test(String(g.zeilen[max][0])), String(g.zeilen[max][0]));
  // Dieselbe Regel direkt an der Funktion, ohne den Umweg ueber eine Fixture.
  const liste = n => Array.from({ length: n }, (_, i) => ({ attempts: 1, anteil: 100 / n }));
  assert.strictEqual(plain(reportingUebrige(liste(max), 100)).uebrige, null);
  assert.strictEqual(plain(reportingUebrige(liste(max + 1), 100)).uebrige, null);
  const zwei = plain(reportingUebrige(liste(max + 2), max + 2));
  assert.strictEqual(zwei.uebrige.anzahl, 2);
  assert.strictEqual(zwei.uebrige.attempts, 2);
  assert.strictEqual(zwei.uebrige.anteil, (2 / (max + 2)) * 100);
});

test('Der Kategorie-Block steht hinter den Ablehngruenden und summiert auf sie', () => {
  const b = bloeckeAus([
    // END_USER (Override), CONFIGURATION, TEMPORARY, unbekannte ID.
    Object.assign({}, DIM_POS, { attempt_state: 'FAILED', failure_reason_id: '1531373451516',
      anzahl_attempts: '7', summe_betrag: '', summe_betrag_failed: '5.00000000' }),
    Object.assign({}, DIM_POS, { attempt_state: 'FAILED', failure_reason_id: '1531373398963',
      anzahl_attempts: '4', summe_betrag: '', summe_betrag_failed: '5.00000000' }),
    Object.assign({}, DIM_POS, { attempt_state: 'FAILED', failure_reason_id: '1553239810659',
      anzahl_attempts: '3', summe_betrag: '', summe_betrag_failed: '5.00000000' }),
    Object.assign({}, DIM_POS, { attempt_state: 'FAILED', failure_reason_id: '9999999999999',
      anzahl_attempts: '1', summe_betrag: '', summe_betrag_failed: '5.00000000' }),
  ]);
  const t = titel(b);
  assert.strictEqual(t[t.indexOf('POS · Ablehngründe') + 1], 'POS · Ablehngründe nach Kategorie');
  const kat = b.find(x => x.titel === 'POS · Ablehngründe nach Kategorie');
  assert.deepStrictEqual(plain(kat.kopf.map(sp => `${sp.label}:${sp.format}`)),
    ['Kategorie:text', 'Attempts:zahl', 'Anteil %:pct']);
  // Deutsche Beschriftung, feste Reihenfolge, Total-Zeile am Schluss.
  assert.deepStrictEqual(plain(kat.zeilen), [
    ['Endnutzer', 7, (7 / 15) * 100],
    ['Vorübergehend', 3, (3 / 15) * 100],
    ['Konfiguration', 4, (4 / 15) * 100],
    ['Intern', 0, 0],
    ['Entwickler', 0, 0],
    ['Unbekannt', 1, (1 / 15) * 100],
    ['Total', 15, 100],
  ]);
  // Der Hinweis sagt, wofuer die Achse da ist.
  assert.match(kat.hinweis, /beim Kunden/);
});

test('K8 traegt Bedeutung und Empfehlung als eigene Spalten', () => {
  const b = bloeckeAus([
    Object.assign({}, DIM_POS, { attempt_state: 'FAILED', failure_reason_id: '1758896189449',
      anzahl_attempts: '9', summe_betrag: '', summe_betrag_failed: '5.00000000' }),
    Object.assign({}, DIM_POS, { attempt_state: 'FAILED', failure_reason_id: '9999999999999',
      anzahl_attempts: '1', summe_betrag: '', summe_betrag_failed: '5.00000000' }),
  ]);
  const g = b.find(x => x.titel === 'POS · Ablehngründe');
  assert.deepStrictEqual(plain(g.kopf.map(sp => `${sp.label}:${sp.format}`)), [
    'Grund:text', 'ID:text', 'Attempts:zahl', 'Anteil %:pct',
    'Kategorie:text', 'Bedeutung:text', 'Empfehlung:text',
  ]);
  assert.strictEqual(g.zeilen[0][0], 'Security Decline');
  assert.strictEqual(g.zeilen[0][4], 'Endnutzer');
  assert.match(String(g.zeilen[0][5]), /hochriskant/);
  assert.strictEqual(g.zeilen[0][6], 'Nicht wiederholen');
  // Unbekannte ID: Name als '#<id>', aber keine erfundene Erklaerung.
  assert.strictEqual(g.zeilen[1][0], '#9999999999999');
  assert.strictEqual(g.zeilen[1][5], '');
  assert.strictEqual(g.zeilen[1][6], '');
});

test('P6 im E-Commerce entfaellt als Tabelle, wenn kaum ein Code bekannt ist', () => {
  const { REPORTING_CODES_MIN_BEKANNT } = loadBuilders();
  assert.strictEqual(REPORTING_CODES_MIN_BEKANNT, 25);
  const fehl = (over) => Object.assign({}, DIM_ECOM, {
    attempt_state: 'FAILED', summe_betrag: '', summe_betrag_failed: '5.00000000',
  }, over);
  // 9 von 10 Fehlschlaegen ohne Code = 10 % bekannt, unter der Schwelle.
  const unten = bloeckeAus([
    fehl({ auth_response_code: '', failure_reason_id: '1', anzahl_attempts: '9' }),
    fehl({ auth_response_code: '05', failure_reason_id: '2', anzahl_attempts: '1' }),
  ]).find(x => x.titel === 'E-Com · Ablehncodes');
  assert.ok(unten, 'Der Block soll bleiben - die Abwesenheit ist selbst die Aussage');
  assert.deepStrictEqual(plain(unten.zeilen), []);
  assert.match(unten.hinweis, /keinen Response Code/);
  // Die echten Zahlen, kein Platzhalter.
  assert.match(unten.hinweis, /9 von 10 Fehlschlägen ohne Code/);
  // Ueber der Schwelle steht wieder die Tabelle.
  const oben = bloeckeAus([
    fehl({ auth_response_code: '', failure_reason_id: '1', anzahl_attempts: '5' }),
    fehl({ auth_response_code: '05', failure_reason_id: '2', anzahl_attempts: '5' }),
  ]).find(x => x.titel === 'E-Com · Ablehncodes');
  assert.strictEqual(oben.zeilen.length, 2);
});

test('P6 am POS kennt keine Schwelle - der ISO-Code ist dort die feinste Achse', () => {
  const fehl = (over) => Object.assign({}, DIM_POS, {
    attempt_state: 'FAILED', summe_betrag: '', summe_betrag_failed: '5.00000000',
  }, over);
  const c = bloeckeAus([
    fehl({ auth_response_code: '', failure_reason_id: '1', anzahl_attempts: '99' }),
    fehl({ auth_response_code: '51', failure_reason_id: '2', anzahl_attempts: '1' }),
  ]).find(x => x.titel === 'POS · Ablehncodes');
  assert.strictEqual(c.zeilen.length, 2);
});

test('Alle Titel ueberleben xlsxBlattName ungekuerzt und bleiben eindeutig', () => {
  const { reportingExportBloecke, xlsxBlattName } = loadBuilders();
  const b = plain(reportingExportBloecke(fixturModell(), {}));
  const namen = new Set();
  // Der Blattname ist der Kanal-Teil des Titels ("E-Com · Ablehngründe" ->
  // "E-Com") bzw. 'Reporting' fuer den kanalfreien Titelblock - genau das, was
  // exportReportingXlsx aus REPORTING_KANAL_LABEL zusammensetzt.
  const kanalNamen = new Set(b.map(x => (x.kanal ? x.titel.split(' · ')[0] : 'Reporting')));
  b.forEach(x => {
    assert.ok(!namen.has(x.titel), `doppelter Blocktitel: ${x.titel}`);
    namen.add(x.titel);
  });
  assert.deepStrictEqual([...kanalNamen].sort(), ['Andere', 'E-Com', 'POS', 'Reporting']);
  // Blattnamen sind die KANALNAMEN, nicht die Blocktitel: exportReportingXlsx
  // legt ein Blatt je Kanal an und stapelt die Bloecke darin (ein Blatt je
  // Block waeren an der Fixture ueber 30 Register). Frueher stand hier die
  // Erwartung, jeder Blocktitel muesse ungekuerzt durch xlsxBlattName gehen -
  // das war eine Erwartung an einen Export, den es so nie gab, und sie fiel
  // beim ersten Titel ueber 31 Zeichen ("… Ablehngründe nach Kategorie").
  // Geprueft wird deshalb, was wirklich als Blattname landet.
  kanalNamen.forEach(k => {
    assert.strictEqual(xlsxBlattName(k), k, `Kanal-Blattname gekuerzt: ${k}`);
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
  // Seit v5.12.1 'gemischt': der Block fuehrt neben den drei Prozentwerten die
  // ABSOLUTE Zahl der trotzdem autorisierten Versuche. Ein renderbares
  // Spaltenformat waere hier die Falle - die Zahl stuende als Prozentwert da.
  'E-Com · 3DS-Akzeptanz': 'gemischt',
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

// Der WERT_FORMAT-Wächter oben prueft nur die Spalten-Deskriptoren (Format
// 'gemischt' fuer die ganze Spalte) - er sagt nichts darueber, WELCHES Format
// jede einzelne Zeile ueber zellFormate bekommt. Vor v5.12.1 war das indirekt
// mitgeprueft, weil die Spalte selbst 'pct' war; seither steht es nur noch im
// un-assertierten zellFormate-Literal im Code. Ohne diesen Test faellt eine
// falsch indizierte Zeile (z. B. der Zaehler ohne %-Zeichen als 'pct') nicht
// auf - die Suite bliebe gruen, die Ausgabe zeigte "84.7 %" statt "84.7".
test('E-Com · 3DS-Akzeptanz: zellFormate je Zeile steht fest', () => {
  const { reportingExportBloecke } = loadBuilders();
  const b = plain(reportingExportBloecke(fixturModell(), {}));
  const block = b.find(x => x.titel === 'E-Com · 3DS-Akzeptanz');
  assert.ok(block, 'Block fehlt');
  assert.strictEqual(block.zeilen.length, block.zellFormate.length);
  assert.deepStrictEqual(block.zeilen.map(z => z[0]), [
    '3DS-Akzeptanz',
    '3DS gestartet ohne CAVV, trotzdem autorisiert',
    '3DS angefordert (Anteil)',
    'Wallet-Kryptogramm (Anteil)',
  ]);
  // Reihenfolge exakt wie die Zeilen: Akzeptanz/Angefordert/Wallet sind
  // Prozente, der dazwischenstehende Zaehler ist eine reine Zahl.
  assert.deepStrictEqual(block.zellFormate, [
    ['text', 'pct'], ['text', 'zahl'], ['text', 'pct'], ['text', 'pct'],
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
  // je der einzige Grund des Brands, also je 100 % dieses Brands. Die Namen
  // kommen aus dem Katalog - die Fixture fuehrt seit Iteration 2 echte IDs.
  assert.deepStrictEqual(e5.zeilen, [
    ['Visa', '3-D Secure Failure', '1568360440179', 41, 100],
    ['Mastercard', 'Security Decline', '1758896189449', 19, 100],
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
  assert.strictEqual(t[i + 1], 'E-Com · Ablehngründe nach Kategorie');
  assert.strictEqual(t[i + 2], 'E-Com · Ablehngründe je Brand');
  assert.strictEqual(t[i + 3], 'E-Com · Ablehncodes');
  assert.strictEqual(t[i + 4], 'E-Com · Conversion');
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

test('E5 fasst je Brand zusammen, nicht ueber die ganze Kreuztabelle', () => {
  const { REPORTING_GRUENDE_MAX } = loadBuilders();
  const max = REPORTING_GRUENDE_MAX;
  const zeilen = [];
  for (let i = 0; i < max + 3; i += 1) {
    zeilen.push(Object.assign({}, DIM_POS, {
      attempt_state: 'FAILED', failure_reason_id: String(100 + i),
      anzahl_attempts: String(20 - i), summe_betrag: '', summe_betrag_failed: '5.00000000',
    }));
  }
  // Zweiter Brand, damit der Block ueberhaupt erscheint - mit genau einem
  // Grund, der deshalb keine Sammelzeile bekommen darf.
  zeilen.push(Object.assign({}, DIM_POS, { brand: 'TWINT', attempt_state: 'FAILED',
    failure_reason_id: '900', anzahl_attempts: '3',
    summe_betrag: '', summe_betrag_failed: '5.00000000' }));
  const e5 = plain(bloeckeAus(zeilen)).find(x => x.titel === 'POS · Ablehngründe je Brand');
  const visa = e5.zeilen.filter(z => z[0] === 'Visa');
  assert.strictEqual(visa.length, max + 1);
  assert.deepStrictEqual(visa.slice(0, 3).map(z => z[3]), [20, 19, 18]);
  // Die Sammelzeile steht UNTER den Zeilen ihres Brands, nicht am Blockende -
  // sonst bliebe offen, zu welchem Brand sie zaehlt.
  assert.strictEqual(visa[max][1], 'Übrige (3 Gründe)');
  const visaSumme = [0, 1, 2].reduce((a, i) => a + (20 - (max + i)), 0);
  assert.strictEqual(visa[max][3], visaSumme);
  // Anteile je Brand auf 100 %.
  assert.ok(Math.abs(visa.reduce((a, z) => a + z[4], 0) - 100) < 1e-9);
  const twint = e5.zeilen.filter(z => z[0] === 'TWINT');
  assert.deepStrictEqual(twint, [['TWINT', '#900', '900', 3, 100]]);
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

// --- Kuchendiagramme in der Blockschicht (SPEC-ITERATION-2 §2) --------------
//
// Hier steht die Regel, an der alles haengt: die Segmente eines Kuchens sind
// die ZEILEN seiner Tabelle, nie eine zweite Auswahl. Deshalb pruefen die
// Tests unten die Segmente immer GEGEN dieselben Zeilen, statt gegen eine
// erwartete Liste - eine erwartete Liste waere selbst wieder eine zweite
// Auswahl und ginge mit derselben Verwechslung mit.

function kuchenNach(bloecke, titel) {
  const b = bloecke.find(x => x.titel === titel);
  assert.ok(b, `Block "${titel}" fehlt`);
  return b.kuchen || null;
}

// Werte einer Spalte, ohne Total- und Fortsetzungszeilen - genau die Zeilen,
// die im Kuchen stehen muessen.
function spaltenWerte(block, labelSpalte, wertSpalte) {
  let gruppe = '';
  const raus = [];
  block.zeilen.forEach(z => {
    if (z[labelSpalte] !== '' && z[labelSpalte] != null) gruppe = String(z[labelSpalte]);
    if (gruppe === 'Total') return;
    if (typeof z[wertSpalte] === 'number' && z[wertSpalte] > 0) {
      raus.push({ label: gruppe, wert: z[wertSpalte] });
    }
  });
  return raus;
}

test('Genau die Bloecke aus §2.1 tragen einen Kuchen', () => {
  const bloecke = plain(reportingExportBloeckeFixtur());
  const mit = bloecke.filter(b => b.kuchen).map(b => b.titel);
  assert.deepStrictEqual(mit, [
    'POS · Zahlungsmittel', 'POS · Kartentyp', 'POS · Kartenherkunft',
    'POS · Debit und Kredit', 'POS · Ablehngründe', 'POS · Ablehngründe nach Kategorie',
    'E-Com · Zahlungsmittel', 'E-Com · Kartentyp', 'E-Com · Kartenherkunft',
    'E-Com · 3DS-Status', 'E-Com · Ablehngründe', 'E-Com · Ablehngründe nach Kategorie',
    'E-Com · PAN-Quelle',
    'Andere · Zahlungsmittel', 'Andere · Kartentyp', 'Andere · Kartenherkunft',
  ]);
  // Und die Gegenliste: was §2.1 ausdruecklich NICHT als Kuchen fuehrt, traegt
  // das Feld gar nicht - nicht etwa eine leere Liste, die jede Ausgabe erst
  // noch pruefen muesste.
  ['Reporting', 'POS · Kennzahlen', 'POS · Top-10 Länder', 'POS · Verlauf',
    'POS · Stunden', 'POS · Beträge je Währung', 'POS · Ablehncodes',
    'E-Com · Wallets', 'E-Com · Ablehngründe je Brand', 'E-Com · Conversion',
  ].forEach(titel => {
    const b = bloecke.find(x => x.titel === titel);
    assert.ok(b, `Block "${titel}" fehlt`);
    assert.strictEqual('kuchen' in b, false, `${titel} traegt einen Kuchen`);
  });
});

test('Ein Kuchen zeichnet exakt die Zeilen seiner Tabelle', () => {
  const bloecke = plain(reportingExportBloeckeFixtur());
  const block = bloecke.find(b => b.titel === 'POS · Kartentyp');
  const zeilen = spaltenWerte(block, 0, 1);
  const kuchen = block.kuchen[0];
  assert.deepStrictEqual(kuchen.segmente.map(s => s.label), zeilen.map(z => z.label));
  assert.deepStrictEqual(kuchen.segmente.map(s => s.wert), zeilen.map(z => z.wert));
  // Die Summe der Segmente ist die Total-Zeile der Tabelle - die Total-Zeile
  // selbst steht aber NICHT im Kuchen, sie ist die Summe und kein Segment.
  const total = block.zeilen[block.zeilen.length - 1];
  assert.strictEqual(total[0], 'Total');
  assert.strictEqual(kuchen.segmente.reduce((a, s) => a + s.wert, 0), total[1]);
  assert.strictEqual(kuchen.segmente.some(s => s.label === 'Total'), false);
});

test('Auch mit „Übrige“ bleibt die Summe des Kuchens die der Tabelle', () => {
  const bloecke = plain(reportingExportBloeckeFixtur());
  // Der E-Com-Zahlungsmittel-Block hat kleine Marken, die die 2-%-Regel
  // einklappt: die Segmente sind dann WENIGER als die Zeilen, ihre Summe aber
  // dieselbe. Genau das meint "Tabelle und Kuchen zeigen dieselben Zahlen".
  const block = bloecke.find(b => b.titel === 'E-Com · Zahlungsmittel');
  const zeilen = spaltenWerte(block, 0, 1);
  const kuchen = block.kuchen[0];
  assert.ok(kuchen.segmente.length < zeilen.length, 'Fixture ohne eingeklappte Marke');
  assert.strictEqual(kuchen.segmente[kuchen.segmente.length - 1].label, 'Übrige');
  assert.strictEqual(kuchen.segmente.reduce((a, s) => a + s.wert, 0),
    zeilen.reduce((a, z) => a + z.wert, 0));
});

test('Der Betrags-Kuchen nimmt EINE Waehrung und nennt sie im Titel', () => {
  const bloecke = plain(reportingExportBloeckeFixtur());
  const block = bloecke.find(b => b.titel === 'POS · Zahlungsmittel');
  const [attempts, betrag] = block.kuchen;
  assert.strictEqual(block.kuchen.length, 2, 'der einzige Block mit zwei Kuchen');
  assert.strictEqual(attempts.format, 'zahl');
  assert.strictEqual(betrag.format, 'betrag');
  assert.strictEqual(betrag.titel, 'Umsatz je Zahlungsmittel (CHF)');
  // Nur die CHF-Zeilen: Betraege ueber Waehrungen hinweg zu addieren ist in
  // diesem Modus verboten (SPEC 2.7). Spalte 5 ist die Waehrung, 6 der Betrag.
  const chf = [];
  let gruppe = '';
  block.zeilen.forEach(z => {
    if (z[0] !== '' && z[0] != null) gruppe = String(z[0]);
    if (gruppe !== 'Total' && z[5] === 'CHF' && typeof z[6] === 'number' && z[6] > 0) {
      chf.push({ label: gruppe, wert: z[6] });
    }
  });
  assert.deepStrictEqual(betrag.segmente.map(s => ({ label: s.label, wert: s.wert })), chf);
});

test('Die Blockhinweise sagen, was die Kuchen NICHT zeigen', () => {
  // Beide Aussagen fehlten, und beide bekaeme der Leser sonst nirgends:
  //  (a) Der Umsatz-Ring zeichnet EINE Waehrung, und Werte <= 0 fallen heraus.
  //      Ein Zahlungsmittel, das nur in einer Nebenwaehrung Umsatz hat, steht
  //      in der Tabelle, fehlt aber im Ring - ohne Hinweis haelt man es fuer
  //      nicht vorhanden.
  //  (b) Die 2-%-Regel des Kuchens fasst zusammen, was die Tabelle einzeln
  //      fuehrt. Das Segment „Übrige“ kann deshalb einen anderen Prozentwert
  //      tragen als die gleichnamige Zeile darunter - beide Zahlen sind
  //      richtig, es sieht nur nach Widerspruch aus.
  const bloecke = plain(reportingExportBloeckeFixtur());
  const zm = bloecke.find(b => b.titel === 'POS · Zahlungsmittel');
  assert.match(zm.hinweis, /Umsatz-Kuchen zeigt allein CHF/,
    'die Leitwaehrung wird beim Namen genannt, nicht nur im Kuchen-Titel');
  // "ohne POSITIVEN Umsatz": die Bedingung im Kuchen ist !(wert > 0), eine
  // Marke mit Refund-Ueberhang faellt also ebenfalls heraus.
  assert.match(zm.hinweis, /ohne positiven Umsatz in dieser Währung stehen in der Tabelle, aber nicht im Ring/);

  const k8 = bloecke.find(b => b.titel === 'E-Com · Ablehngründe');
  assert.match(k8.hinweis, /unter 2 %/);
  assert.match(k8.hinweis, /mehr Gründe umfassen als die gleichnamige Zeile der Tabelle/);
});

test('Der Umsatz-Hinweis steht nur da, wo es einen Betrags-Kuchen gibt', () => {
  // Ohne Umsatz gibt es keinen zweiten Kuchen - dann waere der Halbsatz eine
  // Erklaerung fuer etwas, das gar nicht abgebildet ist.
  const zm = plain(bloeckeAus([Object.assign({}, DIM_POS, {
    attempt_state: 'FAILED', anzahl_attempts: '4',
    summe_betrag: '0.00000000', summe_betrag_failed: '9.00000000',
  })])).find(b => b.titel === 'POS · Zahlungsmittel');
  assert.ok(zm, 'Zahlungsmittel-Block fehlt');
  assert.strictEqual((zm.kuchen || []).length, 1, 'nur der Attempts-Kuchen');
  assert.doesNotMatch(zm.hinweis, /Umsatz-Kuchen/);
});

test('Fortsetzungszeilen einer Waehrungsgruppe stehen nicht im Kuchen', () => {
  const bloecke = plain(reportingExportBloeckeFixtur());
  const block = bloecke.find(b => b.titel === 'E-Com · Kartenherkunft');
  // Der Block hat Fortsetzungszeilen (leere erste Spalte, zweite Waehrung).
  assert.ok(block.zeilen.some(z => z[0] === ''), 'Fixture ohne Fortsetzungszeile');
  const kuchen = block.kuchen[0];
  assert.strictEqual(kuchen.segmente.some(s => s.label === ''), false);
  // Ein Eimer erscheint genau einmal, auch wenn er mehrere Waehrungszeilen hat.
  const namen = kuchen.segmente.map(s => s.label);
  assert.strictEqual(new Set(namen).size, namen.length);
});

test('Der Ablehngrund-Kuchen folgt der Tabelle, nicht „Top 6“ aus §2.1', () => {
  const { reportingExportBloecke } = loadBuilders();
  // 15 Gruende: die Tabelle kuerzt auf REPORTING_GRUENDE_MAX plus eine Zeile
  // "Uebrige (n Gruende)". §2.1 wollte fuer den Kuchen "Top 6 + Uebrige",
  // §2.2 verlangt dieselben Zahlen wie in der Tabelle - aufgeloest zugunsten
  // von §2.2. Der Kuchen liest also die Tabellenzeilen, und die 2-%-Regel
  // besorgt die Kuerzung: hier bleiben sechs Segmente uebrig, ganz ohne eine
  // fest verdrahtete Sechs.
  const zeilen = [DIM_ECOM];
  const anzahl = [400, 300, 200, 60, 40, 30, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  anzahl.forEach((n, i) => zeilen.push(Object.assign({}, DIM_ECOM, {
    attempt_state: 'FAILED', failure_reason_id: String(1500000000000 + i),
    anzahl_attempts: String(n), summe_betrag: '0.00000000',
  })));
  const block = plain(reportingExportBloecke(modellAus(zeilen), {}))
    .find(b => b.titel === 'E-Com · Ablehngründe');
  const tabelle = spaltenWerte(block, 0, 2);
  assert.strictEqual(tabelle.length, 13, '12 Gründe plus die Sammelzeile');
  const kuchen = block.kuchen[0];
  // Kein Segment des Kuchens steht ausserhalb der Tabelle, und die Summe
  // stimmt: das ist die Zusage aus §2.2.
  const nachName = new Map(tabelle.map(z => [z.label, z.wert]));
  kuchen.segmente.filter(s => s.label !== 'Übrige').forEach(s => {
    assert.strictEqual(nachName.get(s.label), s.wert, `Segment ${s.label} nicht in der Tabelle`);
  });
  assert.strictEqual(kuchen.segmente.reduce((a, s) => a + s.wert, 0),
    tabelle.reduce((a, z) => a + z.wert, 0));
  // Gekuerzt wird, aber nicht auf eine verdrahtete Zahl: hier bleiben sieben
  // Segmente statt dreizehn. Genau das ist gemeint mit "„Top 6“ ist ein
  // Richtwert, den die 2-%-Regel meist selbst herstellt" - haette der Code
  // eine feste Sechs, muesste hier eine Sechs stehen.
  assert.ok(kuchen.segmente.length < tabelle.length);
  assert.strictEqual(kuchen.segmente[kuchen.segmente.length - 1].label, 'Übrige');
});

test('Ein Hinweisblock bekommt keinen Kuchen', () => {
  const { reportingKuchen } = loadBuilders();
  // Form, die reportingKanalBloecke unter der Ablehncode-Schwelle liefert:
  // kein Kopf, keine Zeilen, nur die Aussage.
  assert.strictEqual(reportingKuchen(
    { kopf: [], zeilen: [], titel: 'E-Com · Ablehncodes' },
    { titel: 'x', wertSpalte: 1, anteilSpalte: 2 }), null);
  // Und derselbe Fall am fertigen Blocksatz: 9 von 10 Fehlschlaegen ohne Code
  // liegen unter REPORTING_CODES_MIN_BEKANNT, der Block wird zum Hinweis.
  const fehl = over => Object.assign({}, DIM_ECOM, {
    attempt_state: 'FAILED', summe_betrag: '', summe_betrag_failed: '5.00000000',
  }, over);
  const block = plain(bloeckeAus([
    fehl({ auth_response_code: '', failure_reason_id: '1', anzahl_attempts: '9' }),
    fehl({ auth_response_code: '05', failure_reason_id: '2', anzahl_attempts: '1' }),
  ])).find(b => b.titel === 'E-Com · Ablehncodes');
  assert.strictEqual(block.kopf.length, 0, 'kein Hinweisblock entstanden');
  assert.strictEqual('kuchen' in block, false);
});

test('CSV bleibt ohne Kuchen - die Prozentspalten tragen dieselben Zahlen', () => {
  const { buildReportingReportCsv } = loadBuilders();
  const csvText = buildReportingReportCsv(fixturModell(), {});
  // Die Kuchen-Titel tauchen in der maschinenlesbaren Ausgabe nirgends auf;
  // die Prozentspalten der Tabelle tragen dieselben Zahlen. Fuer Excel steht
  // dieselbe Zusicherung in test/reporting-xlsx.test.js - dort wird die Mappe
  // wirklich gebaut und wieder eingelesen; hier laeuft nur der CSV-Pfad.
  assert.ok(!/Anteil je Kartentyp/.test(csvText));
  assert.ok(!/Umsatz je Zahlungsmittel/.test(csvText));
  assert.ok(/Kartentyp/.test(csvText), 'die Tabelle selbst steht sehr wohl drin');
});

// --- Bezier-Naeherung und der PDF-Pfad --------------------------------------

test('Die Bezier-Naeherung eines 90-Grad-Bogens bleibt auf der Kreisbahn', () => {
  const { kuchenBezier } = loadBuilders();
  // Nachgerechnet werden Stuetzpunkte AUF dem Bogen (die Kurve an der Stelle
  // t), nicht die Kontrollpunkte - die liegen bauartbedingt ausserhalb des
  // Kreises und sagten nichts ueber den Fehler.
  const auf = (b, t) => {
    const u = 1 - t;
    return {
      x: u * u * u * b.p0.x + 3 * u * u * t * b.c1.x + 3 * u * t * t * b.c2.x + t * t * t * b.p1.x,
      y: u * u * u * b.p0.y + 3 * u * u * t * b.c1.y + 3 * u * t * t * b.c2.y + t * t * t * b.p1.y,
    };
  };
  // Toleranz: 0.03 % des Radius. Der bekannte Maximalfehler der Naeherung
  // k = 4/3 * tan(dWinkel/4) liegt bei 90 Grad bei rund 0.027 % - deshalb
  // deckt der Wert genau diesen Bogen ab und nicht mehr. Ein groesserer
  // Teilbogen faellt hier durch, und das soll er auch: er waere sichtbar
  // eirig.
  const TOLERANZ = 0.0003;
  [[100, 0, 90], [100, 90, 180], [45, 270, 360], [55, 90, 0]].forEach(([r, von, bis]) => {
    const b = kuchenBezier(r, von, bis);
    for (let i = 0; i <= 20; i += 1) {
      const p = auf(b, i / 20);
      const abweichung = Math.abs(Math.hypot(p.x, p.y) - r);
      assert.ok(abweichung <= r * TOLERANZ,
        `Bogen ${von}->${bis} bei r=${r}: ${abweichung} > ${r * TOLERANZ}`);
    }
  });
});

// Ein doc, das jeden Aufruf mitschreibt. jsPDF wird dafuer NICHT gebraucht -
// pdfKuchen benutzt nur Vektorprimitive, und genau deshalb steht der Kuchen
// ueberhaupt im PDF (die Balken bleiben mangels SVG-Faehigkeit draussen).
// A4 in Punkt - dieselben Masse, mit denen exportReportingPdf jsPDF anlegt.
const PDF_SEITE = { breite: 595, hoehe: 842, rand: 40 };

function fakeDoc() {
  const rufe = [];
  let schrift = 10;
  // Grobe, aber MONOTONE Breitenschaetzung: 0.5 em je Zeichen. Sie muss nicht
  // Helvetica treffen - sie muss nur dafuer sorgen, dass laengerer Text auch
  // breiter misst, damit die Kuerzung in pdfKuchen ueberhaupt eine Wirkung
  // hat, die sich pruefen laesst. Die echten Breiten misst das
  // Wegwerf-Skript im Scratchpad an jsPDF selbst.
  const breite = t => String(t).length * schrift * 0.5;
  const doc = {
    rufe,
    internal: { pageSize: { getHeight: () => PDF_SEITE.hoehe, getWidth: () => PDF_SEITE.breite } },
    lastAutoTable: { finalY: 0 },
    setFontSize(n) { schrift = n; rufe.push(['setFontSize', n]); },
    setTextColor(n) { rufe.push(['setTextColor', n]); },
    setFillColor(c) { rufe.push(['setFillColor', c]); },
    getTextWidth: breite,
    text(t, x, y) {
      // jsPDF nimmt auch ein Array (eine Zeile je Eintrag) - jede Zeile wird
      // einzeln mitgeschrieben, sonst waere ihre Breite nicht zu pruefen.
      (Array.isArray(t) ? t : [t]).forEach((zeile, i) =>
        rufe.push(['text', String(zeile), x, y + i * schrift, breite(zeile)]));
    },
    rect(x, y, w, h, s) { rufe.push(['rect', x, y, w, h, s]); },
    lines(l, x, y, sc, st) { rufe.push(['lines', l, x, y, st]); },
    addPage() { rufe.push(['addPage']); },
    // Wie das Original umbrechen, nicht durchreichen: sonst behauptete eine
    // einzige, sehr lange Hinweiszeile spaeter einen Ueberlauf, den es im
    // echten PDF nicht gibt.
    splitTextToSize(t, max) {
      const worte = String(t).split(' ');
      const zeilen = [];
      let aktuell = '';
      worte.forEach(w => {
        const kandidat = aktuell ? `${aktuell} ${w}` : w;
        if (aktuell && breite(kandidat) > max) { zeilen.push(aktuell); aktuell = w; } else { aktuell = kandidat; }
      });
      if (aktuell) zeilen.push(aktuell);
      return zeilen;
    },
    autoTable(opt) { rufe.push(['autoTable', opt.head[0][0]]); doc.lastAutoTable = { finalY: 400 }; },
  };
  return doc;
}
const nurArt = (doc, art) => doc.rufe.filter(r => r[0] === art);

// Das Rechteck, das alles Gezeichnete tatsaechlich einnimmt. Fuer lines()
// werden die relativen Stuecke aufaddiert - jsPDF rechnet jeden Punkt eines
// Stuecks gegen dessen ANFANGSPUNKT, deshalb hier genauso. Die Kontrollpunkte
// einer Bezier liegen etwas ausserhalb des Kreises; das macht die Schaetzung
// konservativ, und konservativ ist fuer die Frage "laeuft etwas ueber den
// Rand" die richtige Richtung.
function gezeichneteGrenzen(doc) {
  const g = { links: Infinity, rechts: -Infinity, oben: Infinity, unten: -Infinity };
  const punkt = (x, y) => {
    g.links = Math.min(g.links, x); g.rechts = Math.max(g.rechts, x);
    g.oben = Math.min(g.oben, y); g.unten = Math.max(g.unten, y);
  };
  doc.rufe.forEach(ruf => {
    if (ruf[0] === 'lines') {
      let x = ruf[2];
      let y = ruf[3];
      punkt(x, y);
      ruf[1].forEach(stueck => {
        for (let i = 0; i < stueck.length; i += 2) punkt(x + stueck[i], y + stueck[i + 1]);
        x += stueck[stueck.length - 2];
        y += stueck[stueck.length - 1];
      });
    } else if (ruf[0] === 'rect') {
      punkt(ruf[1], ruf[2]); punkt(ruf[1] + ruf[3], ruf[2] + ruf[4]);
    } else if (ruf[0] === 'text') {
      punkt(ruf[2], ruf[3]); punkt(ruf[2] + ruf[4], ruf[3]);
    }
  });
  return g;
}

test('pdfKuchen zeichnet je Segment eine Flaeche und eine Legendenzeile', () => {
  const { pdfKuchen, pdfKuchenHoehe } = loadBuilders();
  const segmente = [
    { label: 'Visa', wert: 60, anteil: 60, farbe: 'tuerkis' },
    { label: 'Mastercard', wert: 30, anteil: 30, farbe: 'orange' },
    { label: 'Übrige', wert: 10, anteil: 10, farbe: 'grau' },
  ];
  const doc = fakeDoc();
  const hoehe = pdfKuchen(doc, 40, 100, segmente, { titel: 'Anteil je Brand', format: 'zahl' });
  assert.strictEqual(nurArt(doc, 'lines').length, 3, 'eine gefuellte Flaeche je Segment');
  assert.strictEqual(nurArt(doc, 'rect').length, 3, 'ein Farbtupfer je Legendenzeile');
  assert.ok(hoehe > 0);
  assert.strictEqual(hoehe, pdfKuchenHoehe({ segmente }),
    'die vorab berechnete Hoehe muss die tatsaechlich belegte sein');
  // Die Farbe kommt als HEX aus derselben Whitelist wie die CSS-Variable -
  // jsPDF kennt keine var(--...).
  assert.deepStrictEqual([...new Set(nurArt(doc, 'setFillColor').map(r => r[1]))],
    ['#11d9cc', '#ff4d00', '#9aa3a8']);
  // Legende: Label, Wert und Prozent, formatiert wie auf dem Bildschirm.
  const legende = nurArt(doc, 'text').map(r => r[1]);
  assert.ok(legende.some(t => /^Visa {2}60 {2}60\.0 %$/.test(t)), legende.join(' | '));
  assert.ok(legende.includes('Anteil je Brand'), 'Titel ueber dem Ring');
  // Ohne Segmente wird nichts gezeichnet und nichts belegt.
  const leer = fakeDoc();
  assert.strictEqual(pdfKuchen(leer, 40, 100, [], {}), 0);
  assert.strictEqual(leer.rufe.length, 0);
});

test('pdfKuchen schliesst jedes Segment zu einem Ringstueck', () => {
  const { pdfKuchen } = loadBuilders();
  const doc = fakeDoc();
  // 100 %: der volle Ring. Aussen vier Bezier-Teilboegen, eine Gerade nach
  // innen, innen vier zurueck - der Fall, an dem ein einzelner Bogen scheitern
  // wuerde.
  pdfKuchen(doc, 0, 0, [{ label: 'A', wert: 1, anteil: 100, farbe: 'tuerkis' }], {});
  const linien = nurArt(doc, 'lines')[0][1];
  assert.strictEqual(linien.length, 9);
  assert.strictEqual(linien.filter(l => l.length === 6).length, 8, 'acht Bezier-Stuecke');
  assert.strictEqual(linien.filter(l => l.length === 2).length, 1, 'eine Gerade nach innen');
  linien.forEach(l => l.forEach(v => assert.ok(Number.isFinite(v), `NaN im Linienzug: ${l}`)));
});

test('Der PDF-Pfad zeichnet jeden Kuchen genau einmal, vor seiner Tabelle', () => {
  const { reportingPdfBloecke, reportingPdfSchreiben } = loadBuilders();
  const p = reportingPdfBloecke(fixturModell(), {});
  const doc = fakeDoc();
  reportingPdfSchreiben(doc, p);
  // "Genau einmal" wird gezaehlt, nicht behauptet: jedes Segment ist genau ein
  // lines()-Aufruf, also muss die Zahl der Aufrufe die Summe aller Segmente
  // aller Kuchen sein. Ein doppelt gezeichneter Kuchen gaebe mehr, ein
  // vergessener weniger.
  const segmente = p.tabellen.reduce((a, tab) =>
    a + (tab.kuchen || []).reduce((b, k) => b + k.segmente.length, 0), 0);
  assert.ok(segmente > 0, 'PDF-Layout ohne Kuchen');
  assert.strictEqual(nurArt(doc, 'lines').length, segmente);
  // Stellung im Dokument: der Kuchen kommt nach dem Blocktitel und vor der
  // Tabelle desselben Blocks.
  const folge = doc.rufe.map(r => (r[0] === 'text' ? `T:${r[1]}` : r[0]));
  const titelIdx = folge.indexOf('T:E-Com · Zahlungsmittel');
  assert.ok(titelIdx > -1, 'Kanaltitel im PDF nicht gefunden');
  const linienIdx = folge.indexOf('lines', titelIdx);
  const tabelleIdx = folge.indexOf('autoTable', titelIdx);
  assert.ok(linienIdx > titelIdx && linienIdx < tabelleIdx,
    'der Kuchen gehoert zwischen Titel und Tabelle');
});

test('Nichts Gezeichnetes laeuft ueber den Seitenrand - auch die Legende nicht', () => {
  const { reportingPdfBloecke, reportingPdfSchreiben, pdfKuchenHoehe } = loadBuilders();
  const p = reportingPdfBloecke(fixturModell(), {});
  const doc = fakeDoc();
  reportingPdfSchreiben(doc, p);
  // Gemessen wird die tatsaechliche Ausdehnung JEDES gezeichneten Elements,
  // nicht der Startpunkt eines Aufrufs: der liegt beim Ring nahe der
  // Oberkante und sagte weder etwas ueber die Unterkante noch ueber die
  // Breite. Die vorige Fassung dieses Tests versprach beides und pruefte
  // keines von beidem.
  const g = gezeichneteGrenzen(doc);
  assert.ok(g.unten <= PDF_SEITE.hoehe - PDF_SEITE.rand,
    `Unterkante bei ${g.unten} unter dem Seitenrand`);
  assert.ok(g.oben >= 0, `Oberkante bei ${g.oben} ueber dem Blatt`);
  assert.ok(g.links >= 0, `linke Kante bei ${g.links}`);
  assert.ok(g.rechts <= PDF_SEITE.breite - PDF_SEITE.rand,
    `rechte Kante bei ${g.rechts} rechts vom Satzspiegel`);
  // Gegenprobe, dass ueberhaupt etwas gemessen wurde und der Kuchen breit
  // genug ist, um den Rand ueberhaupt erreichen zu koennen.
  assert.ok(g.rechts > PDF_SEITE.breite / 2, `nur ${g.rechts} pt genutzt`);
  // Und die Hoehenrechnung selbst: viele Segmente sind hoeher als der Ring.
  assert.ok(pdfKuchenHoehe({ segmente: new Array(13).fill({}) })
    > pdfKuchenHoehe({ segmente: new Array(3).fill({}) }));
});

test('Die PDF-Legende kuerzt nach gemessener Breite, nicht nach Zeichenzahl', () => {
  const { pdfKuchen } = loadBuilders();
  const lang = 'PostFinance Apple Pay Kreditkarte Schweiz';
  const segmente = [
    { label: lang, wert: 123456789, anteil: 62.1, farbe: 'tuerkis' },
    { label: 'Visa', wert: 100, anteil: 37.9, farbe: 'orange' },
  ];
  // Zwei Kuchen nebeneinander: die schmale Spalte, in der der Ueberlauf
  // aufgetreten ist.
  const eng = fakeDoc();
  const spalte = (PDF_SEITE.breite - 80) / 2 - 9;
  pdfKuchen(eng, 40 + (PDF_SEITE.breite - 80) / 2, 100, segmente,
    { titel: 'Umsatz je Zahlungsmittel (CHF)', format: 'zahl', breite: spalte });
  nurArt(eng, 'text').forEach(r => assert.ok(r[2] + r[4] <= PDF_SEITE.breite - PDF_SEITE.rand,
    `"${r[1]}" endet bei ${r[2] + r[4]}`));
  // Der Wert und der Anteil ueberleben die Kuerzung - sie sind die Aussage
  // der Zeile; gekuerzt wird ausschliesslich das Label.
  const zeile = nurArt(eng, 'text').find(r => /62\.1 %/.test(r[1]));
  assert.ok(zeile, 'Legendenzeile fehlt');
  assert.match(zeile[1], /123’456’789\s+62\.1 %$/);
  assert.match(zeile[1], /^PostFinance/);
  assert.ok(zeile[1].length < lang.length, 'Label haette gekuerzt werden muessen');
  assert.match(zeile[1], /…/);
  // In einer breiten Spalte (ein einzelner Kuchen) passt dasselbe Label ganz.
  const weit = fakeDoc();
  pdfKuchen(weit, 40, 100, segmente, { format: 'zahl', breite: PDF_SEITE.breite - 80 });
  assert.ok(nurArt(weit, 'text').some(r => r[1].indexOf(lang) === 0),
    'in der breiten Spalte darf nichts gekuerzt werden');
});
