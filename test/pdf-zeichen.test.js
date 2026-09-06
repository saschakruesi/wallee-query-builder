// Waechter: jedes Zeichen, das ein Bericht ins PDF druckt, muss die
// Standardschrift von jsPDF auch darstellen koennen.
//
// Ausloeser war die Kachel «Bestellungen mit ≥ 2 3DS-Fehlschlaegen» der
// 3DS-Failure-Seite. Im PDF stand dort
//
//     B e s t e l l u n g e n   m i t "e 2 3 D S - F e h l s c h l ä g e n
//
// - aus dem ≥ wurde "e, und die ganze Zeile zerfiel in Einzelbuchstaben. Auf
// dem Bildschirm, in CSV und in Excel war dieselbe Beschriftung in Ordnung,
// und keiner der uebrigen Tests hat es gemerkt: ein Test, der eine
// Beschriftung auf Gleichheit prueft, prueft sie gegen sich selbst.
//
// Der Grund liegt in der Schrift, nicht im Text. jsPDF bettet fuer seine
// Standardschriften (Helvetica & Co.) keine Font-Datei ein, sondern schreibt
// die Zeichen als Ein-Byte-Codes in der WinAnsi-Kodierung, also cp1252. Trifft
// es auf ein Zeichen ausserhalb dieser Tabelle, faellt es fuer die GANZE
// Zeichenkette auf eine Zwei-Byte-Ausgabe zurueck; der PDF-Betrachter liest
// sie weiter als Ein-Byte-Text und macht daraus das Buchstabengeflimmer oben.
// Nichts wirft, nichts wird rot, die Datei entsteht - nur die Zeile ist
// unlesbar.
//
// Geprueft wird die PDF-Blockschicht ALLER Berichte mit PDF-Pfad, also genau
// das, was gleich danach an doc.text()/autoTable geht: Dokumenttitel,
// Kopfzeilen, Abschnittstitel, Spaltenbeschriftungen, Zellinhalte, Hinweise
// und die Beschriftung der Kuchendiagramme. Der Terminal-Report ist bewusst
// nicht dabei - er hat CSV und Excel, aber keinen PDF-Export (im ganzen
// App-Code gibt es genau zwei doc.autoTable-Aufrufe: Settlement und
// Reporting).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadBuilders } = require('./harness');

const B = loadBuilders();

// --- Der Massstab: jsPDF selbst, nicht eine abgetippte Tabelle -------------
// WinAnsi/cp1252 ist der Massstab - aber welche Zeichen dazugehoeren, wird
// hier nicht aufgeschrieben, sondern GEMESSEN, und zwar an dem Vendor, der
// nachher wirklich schreibt. Zwei Alternativen sind bewusst verworfen:
//
//   * Ein Set von Hand. Das ist genau die Sorte Annahme, die dieser Test
//     verhindern soll: ein vergessenes Zeichen darin meldete einen Fehler,
//     den es nicht gibt, und lueke jemanden dazu, das Set zu "reparieren",
//     bis es nichts mehr faengt.
//   * new TextDecoder('windows-1252'). Sieht richtig aus, ist es hier aber
//     nicht: je nach ICU-Ausstattung reicht Node die Bytes 0x80-0x9F
//     unveraendert durch (U+0080 statt €, ’, –, —, „, “ ...). Der Waechter
//     haette dann ausgerechnet die Zeichen als unzulaessig gemeldet, die
//     jeder dieser Berichte auf jeder Seite druckt.
//
// Die Probe ist die Wirkung selbst: ein Zeichen zwischen zwei bekannten
// Buchstaben durch doc.text() schicken und im erzeugten PDF nachsehen, ob
// jsPDF Ein-Byte-Text geschrieben hat. Der Rueckfall auf zwei Byte ist am
// Nullbyte zu erkennen, das dabei vor jedes ASCII-Zeichen tritt - deshalb die
// beiden 'A' um das Zeichen herum: sie garantieren, dass es im Rueckfall
// mindestens ein Nullbyte gibt, auch wenn das Zeichen selbst keines erzeugt.
const NULLBYTE = String.fromCharCode(0);

function ladeJsPdf() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'wallee_query_builder.html'), 'utf8');
  const open = '<script id="vendor-jspdf">';
  const start = html.indexOf(open);
  assert.notStrictEqual(start, -1, 'kein <script id="vendor-jspdf">-Block gefunden');
  const von = start + open.length;
  const quelle = html.slice(von, html.indexOf('</script>', von));

  // Minimaler Kontext: der Vendor braucht ein globalThis/window und ein
  // document, das er nicht wirklich benutzt (wir zeichnen kein Canvas).
  const sandbox = {
    console, Uint8Array, ArrayBuffer, atob, btoa, setTimeout, performance,
    document: {
      createElement: () => ({ getContext: () => null }),
      createElementNS: () => ({}),
      documentElement: {},
    },
    navigator: { userAgent: 'node' },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(quelle, sandbox, { filename: 'vendor-jspdf.js' });
  assert.strictEqual(typeof sandbox.jspdf.jsPDF, 'function',
    'vendor-jspdf hat kein globales jspdf.jsPDF gesetzt');
  return sandbox.jspdf.jsPDF;
}

const jsPDF = ladeJsPdf();

// Der Text, den jsPDF in den Seiteninhalt geschrieben hat: "(...) Tj".
function tjNutzlast(text) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(11);
  doc.text(text, 40, 50);
  const treffer = doc.output().match(/Td\n\(([\s\S]*?)\) Tj/);
  assert.ok(treffer, 'im erzeugten PDF steht kein Tj-Textoperator');
  return treffer[1];
}

// Ein Cache: dieselben Zeichen kommen in hunderten Zellen vor, und jede Probe
// baut ein vollstaendiges PDF-Dokument.
const geprueft = new Map();
function darstellbar(zeichen) {
  if (!geprueft.has(zeichen)) {
    geprueft.set(zeichen, tjNutzlast(`A${zeichen}A`).indexOf(NULLBYTE) === -1);
  }
  return geprueft.get(zeichen);
}

// Ein Codepunkt als "U+2265 ≥" - die Meldung soll das Zeichen benennen, nicht
// nur zeigen: ein Zeichen, das der PDF-Betrachter nicht darstellen kann, ist
// im Terminal oft genauso unsichtbar, und dann stuende in der Fehlermeldung
// dasselbe Nichts wie in der Datei.
function zeichenName(z) {
  const hex = z.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
  return `U+${hex} ${JSON.stringify(z)}`;
}

// Sammelt jedes nicht darstellbare Zeichen samt Fundort. Iteriert ueber
// Codepunkte (for..of), nicht ueber UTF-16-Einheiten - ein Zeichen ausserhalb
// der BMP kaeme sonst als zwei halbe Surrogate in der Meldung an.
function pruefe(wert, pfad, funde) {
  if (wert === null || wert === undefined) return;
  const text = String(wert);
  for (const z of text) {
    if (!darstellbar(z)) funde.push({ zeichen: z, pfad, text });
  }
}

// Laeuft ueber einen fertigen PDF-Bauplan { titel, kopfzeilen, tabellen } -
// die Form, die settlementPdfBloecke, reportingPdfBloecke und
// reportingTdsPdfBloecke gleichermassen liefern und die beide PDF-Schreiber
// gleichermassen abarbeiten.
function pruefePdf(bauplan, quelle, funde) {
  pruefe(bauplan.titel, `${quelle} · Dokumenttitel`, funde);
  (bauplan.kopfzeilen || []).forEach((z, i) => {
    pruefe(z, `${quelle} · Kopfzeile ${i + 1}`, funde);
  });
  (bauplan.tabellen || []).forEach(tab => {
    const wo = `${quelle} · Abschnitt "${tab.titel}"`;
    pruefe(tab.titel, `${quelle} · Abschnittstitel`, funde);
    (tab.header || []).forEach((h, i) => pruefe(h, `${wo} · Spalte ${i + 1}`, funde));
    (tab.rows || []).forEach((zeile, r) => (zeile || []).forEach((zelle, c) => {
      pruefe(zelle, `${wo} · Zeile ${r + 1}, Spalte ${c + 1}`, funde);
    }));
    pruefe(tab.hinweis, `${wo} · Hinweis`, funde);
    // Die Kuchen stehen im PDF (pdfKuchen zeichnet sie mit
    // jsPDF-Vektorprimitiven) und drucken drei Texte je Segment: das Label,
    // den formatierten Wert und den Anteil. Wert und Anteil laufen durch
    // reportingZellText - dieselbe Ausgabeschicht wie die Tabelle daneben und
    // damit dieselbe Quelle fuer das Schweizer Tausenderzeichen.
    (tab.kuchen || []).forEach(k => {
      pruefe(k.titel, `${wo} · Kuchen-Titel`, funde);
      (k.segmente || []).forEach((s, i) => {
        const wos = `${wo} · Kuchen-Segment ${i + 1}`;
        pruefe(s.label, wos, funde);
        pruefe(B.reportingZellText(s.wert, k.format || 'zahl'), `${wos} · Wert`, funde);
        pruefe(B.reportingZellText(s.anteil, 'pct'), `${wos} · Anteil`, funde);
      });
    });
  });
}

function meldung(funde) {
  return funde.map(f => `${zeichenName(f.zeichen)} in ${f.pfad}: "${f.text}"`).join('\n');
}

// Mehrere Bauplaene am Stueck - die Tests unten lesen sich dadurch als
// Aufzaehlung der Berichte, nicht als Schleifenmechanik.
function ohneFund(bauplaene) {
  const funde = [];
  bauplaene.forEach(([bauplan, quelle]) => pruefePdf(bauplan, quelle, funde));
  assert.strictEqual(funde.length, 0,
    `Zeichen, die die PDF-Standardschrift nicht darstellen kann:\n${meldung(funde)}`);
}

// --- Die Messung selbst absichern ------------------------------------------

test('Massstab: jsPDF nimmt die WinAnsi-Zeichen an und faellt bei den anderen zurueck', () => {
  // Drin: was diese Berichte tatsaechlich drucken - Umlaute, Akzente, Gedanken-
  // und Bindestrich, das Schweizer Tausenderzeichen (U+2019), die deutschen und
  // franzoesischen Anfuehrungszeichen, Mittelpunkt, Auslassungspunkte, Euro.
  ['A', 'ä', 'Ö', 'ü', 'é', '–', '—', '’', '„', '“', '«', '»', '·', '…', '€', '%', ' ']
    .forEach(z => assert.ok(darstellbar(z), `${zeichenName(z)} sollte darstellbar sein`));
  // Draussen: das ausloesende Zeichen und weitere naheliegende Kandidaten, die
  // man beim Formulieren einer Beschriftung guten Gewissens tippt.
  ['≥', '≤', '≠', '→', '✓', '⌀']
    .forEach(z => assert.ok(!darstellbar(z), `${zeichenName(z)} ist nicht darstellbar`));
});

test('Waechter beisst: ein eingesetztes ≥ wird gefunden und benannt', () => {
  // Die Gegenprobe zu den drei Tests darunter. Ohne sie waere nicht belegt,
  // dass die gruen sind, weil sie etwas pruefen - und nicht bloss, weil sie
  // durchlaufen.
  const funde = [];
  pruefePdf({
    titel: 'PROBE',
    kopfzeilen: [],
    tabellen: [{
      titel: 'Kennzahlen',
      header: ['Angabe', 'Wert'],
      rows: [['Bestellungen mit ≥ 2 3DS-Fehlschlägen', '2']],
      hinweis: '',
    }],
  }, 'Probe', funde);
  assert.strictEqual(funde.length, 1);
  assert.strictEqual(funde[0].zeichen, '≥');
  assert.match(meldung(funde), /U\+2265/);
  assert.match(meldung(funde), /Zeile 1, Spalte 1/);
});

// --- Die Berichte -----------------------------------------------------------

const OPT = {
  zeitraum: { start: '2026-07-01 00:00:00', end: '2026-08-01 00:00:00' },
  spaces: ['90001', '90002'],
};

test('Reporting-Report (Aggregat): jedes gedruckte Zeichen ist darstellbar', () => {
  const text = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'reporting-beispiel.csv'), 'utf8');
  const res = B.parseReportingCsv(text);
  assert.strictEqual(res.error, null);
  const modell = B.buildReportingModel(res.rows, { merchantCountry: 'CH' });
  ohneFund([
    [B.reportingPdfBloecke(modell, OPT), 'Reporting-Report'],
    // Das leere Modell nimmt einen anderen Weg durch die Blockschicht (die
    // Hinweisbloecke aus SPEC 7 statt Tabellen) und traegt deshalb Texte, die
    // im Lauf darueber gar nicht vorkommen.
    [B.reportingPdfBloecke(B.buildReportingModel([], { merchantCountry: 'CH' }), OPT),
      'Reporting-Report (leer)'],
  ]);
});

test('3DS-Failures: jedes gedruckte Zeichen ist darstellbar', () => {
  const text = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'reporting-tds-beispiel.csv'), 'utf8');
  const res = B.parseReportingTdsCsv(text);
  assert.strictEqual(res.error, null);
  // Das Aggregat schaltet zwei zusaetzliche Kacheln samt ihrer Prosa frei,
  // ein erreichtes Limit formuliert saemtliche Zaehlungen als Untergrenze um -
  // beides sind eigene Texte, die der Standardlauf nicht sieht.
  const aggregat = {
    kpi: { fehlgeschlagen: 200 },
    tds: {
      gruppen: [
        { schluessel: 'AUTHENTICATED', attempts: 300 },
        { schluessel: 'STARTED_NO_CAVV', attempts: 100 },
      ],
    },
  };
  ohneFund([
    [B.reportingTdsPdfBloecke(B.buildReportingTdsModel(res.rows, {}), OPT), '3DS-Failures'],
    [B.reportingTdsPdfBloecke(B.buildReportingTdsModel(res.rows, { aggregat }), OPT),
      '3DS-Failures (mit Aggregat)'],
    [B.reportingTdsPdfBloecke(B.buildReportingTdsModel(res.rows, { limit: 3 }), OPT),
      '3DS-Failures (am Limit)'],
    [B.reportingTdsPdfBloecke(B.buildReportingTdsModel([], {}), OPT), '3DS-Failures (leer)'],
  ]);
});

test('Settlement-Report: jedes gedruckte Zeichen ist darstellbar', () => {
  const KOPF = 'settlement_valuedate,settlement_state,transaction_id,created_on,'
    + 'merchant_reference,space_id,waehrung,connector,sales_channel,terminal_identifier,'
    + 'brutto_gross,settlement_gross,processing_fees,netamount,settlement_records,'
    + 'settlement_reference';
  const zeilen = [
    // Abgerechnet, mit Referenz - traegt Bankgutschriften und Space-Kapitel.
    '2026-01-05 09:00:00,SETTLED,100,2026-01-03 10:00:00,,50161,CHF,'
      + 'Wallee All-in-One - Visa,Ecommerce,,10.00000000,10.00000000,0.10000000,9.90000000,1,REF-A',
    '2026-01-05 09:00:00,SETTLED,200,2026-01-03 11:00:00,,50161,CHF,'
      + 'TWINT,Physical Terminal,T-1,20.00000000,20.00000000,0.20000000,19.80000000,1,REF-A',
    // Valuta nach dem Berichtszeitraum -> "Ausstehend".
    '2026-02-03 09:00:00,SETTLED,300,2026-01-04 10:00:00,,50161,CHF,'
      + 'Wallee ACQ - Mastercard,Ecommerce,,30.00000000,30.00000000,0.30000000,29.70000000,1,REF-B',
    // Ohne Settlement-Record -> Abschnitt "Offene Transaktionen"; ohne Space
    // zusaetzlich der Sammelbucket "ohne Zuordnung".
    ',NO_RECORD,999,2026-01-04 12:00:00,,,CHF,Visa,Ecommerce,,7.00000000,,,,0,',
  ];
  const res = B.parseSettlementCsv([KOPF, ...zeilen].join('\n') + '\n');
  assert.strictEqual(res.error, null);
  const modell = B.buildSettlementReportModel(res.rows, { end: '2026-02-01 00:00:00' });
  const opt = { start: '2026-01-01 00:00:00', end: '2026-02-01 00:00:00', account: '12345' };
  ohneFund([
    // Mit Referenz laufen Bankgutschriften und alle BG-/Referenz-Spalten mit,
    // ohne sie faellt der Bericht auf die kleinere Gliederung mit anderen
    // Abschnittsnummern zurueck - beide Wege drucken eigene Titel.
    [B.settlementPdfBloecke(modell, { ...opt, reference: true, detail: true }),
      'Settlement-Report (mit Referenz)'],
    [B.settlementPdfBloecke(modell, { ...opt, reference: false, detail: false }),
      'Settlement-Report (ohne Referenz)'],
    [B.settlementPdfBloecke(null, opt), 'Settlement-Report (leer)'],
  ]);
});
