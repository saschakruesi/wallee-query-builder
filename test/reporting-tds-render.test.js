// 3DS-Failure-Seite (Iteration 2, Task 4c): die Bildschirm-Ausgabe.
//
// reportingTdsBerichtHtml sitzt auf derselben Blockliste auf wie CSV, Excel
// und PDF und benutzt denselben Renderer wie das Aggregat
// (reportingBlockHtml). Geprueft wird hier deshalb nicht die Tabelle an sich -
// die steht in test/reporting-render.test.js -, sondern was auf dieser Seite
// NEU ist:
//
//   1. Der Öffnen-Link, der einzige Zelltyp, der Markup statt Text erzeugt.
//      Eine leere Adresse darf KEIN <a href=""> ergeben, und eine fremde
//      Adresse gar keinen Link.
//   2. Dass die Ausgabe formatiert, was die Bloecke roh fuehren - inklusive
//      der Untergrenze "mindestens n" am Limit.
//   3. Dass die lange Transaktionsliste eingeklappt wird, die Uebersicht aber
//      offen bleibt.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadBuilders, plain } = require('./harness');
const { makeDocument } = require('./dom-stub');

// Das Dokument bleibt greifbar, und jeder Knoten, den die App beim Laden
// aufloest, wird mitgeschrieben: der letzte Test dieser Datei haelt sie danach
// gegen einen Schnappschuss. Anders liesse sich "die Ausgabe schreibt nicht ins
// DOM" gar nicht messen - die App holt ihre Elemente EINMAL beim Laden in
// Konstanten (wallee_query_builder.html, ab „const spaceSection = …"), ein
// spaeterer Schreibzugriff geht also ueber diese Referenzen und nie mehr ueber
// document.getElementById.
const DOC = makeDocument();
const KNOTEN = [];
const echtesGetElementById = DOC.getElementById.bind(DOC);
DOC.getElementById = id => {
  const el = echtesGetElementById(id);
  if (!KNOTEN.includes(el)) KNOTEN.push(el);
  return el;
};

const B = loadBuilders({ document: DOC });

const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'reporting-tds-beispiel.csv'), 'utf8');

function modell() {
  const r = B.parseReportingTdsCsv(FIXTURE);
  assert.strictEqual(r.error, null);
  return B.buildReportingTdsModel(r.rows, {});
}
function html(m, optionen) {
  return B.reportingTdsBerichtHtml(m || modell(), optionen || {});
}

// Der Abschnitt EINES Blocks: vom Titel bis zur naechsten <h3>-Ueberschrift.
function blockAbschnitt(markup, titel) {
  const start = markup.indexOf(`<h3>${titel}</h3>`);
  assert.notStrictEqual(start, -1, `Block "${titel}" fehlt in der Ausgabe`);
  const rest = markup.slice(start + 4);
  const ende = rest.indexOf('<h3>');
  return ende === -1 ? rest : rest.slice(0, ende);
}

// --- Aufbau ------------------------------------------------------------------

test('Jeder Block der Liste steht als Abschnitt in der Ausgabe', () => {
  const m = modell();
  const markup = html(m);
  B.reportingTdsExportBloecke(m, {}).forEach(b => {
    assert.notStrictEqual(markup.indexOf(`<h3>${b.titel}</h3>`), -1,
      `Block "${b.titel}" fehlt auf dem Bildschirm`);
  });
});

test('Ohne Daten steht nur der Titelblock und der Hinweis - keine leere Tabelle', () => {
  const markup = html(B.buildReportingTdsModel([], {}));
  assert.notStrictEqual(markup.indexOf('<h3>Keine Daten</h3>'), -1);
  const abschnitt = blockAbschnitt(markup, 'Keine Daten');
  assert.strictEqual(abschnitt.indexOf('<table'), -1);
  assert.match(abschnitt, /kein Zahlungsversuch mit 3-D Secure gescheitert/);
});

test('Die Kacheln kommen als Kacheln heraus, nicht als Tabelle', () => {
  const abschnitt = blockAbschnitt(html(), 'Kennzahlen');
  assert.notStrictEqual(abschnitt.indexOf('kpi-kacheln'), -1);
  assert.strictEqual(abschnitt.indexOf('<table'), -1);
});

// --- Der Öffnen-Link ---------------------------------------------------------

test('Eine gueltige Adresse ergibt ein <a> mit target und rel="noopener"', () => {
  const abschnitt = blockAbschnitt(html(), 'Transaktionen');
  assert.notStrictEqual(abschnitt.indexOf(
    '<a href="https://app-wallee.com/s/90001/payment/transaction/view/7000007"'
    + ' target="_blank" rel="noopener">Öffnen</a>'), -1);
  // Genau ein Link je Zeile - alle acht Fixture-Zeilen tragen gueltige IDs.
  assert.strictEqual((abschnitt.match(/<a href="https:\/\/app-wallee\.com/g) || []).length, 8);
});

test('Eine leere Adresse erzeugt KEIN leeres <a href="">', () => {
  const m = modell();
  m.zeilen = m.zeilen.map(z => Object.assign({}, z, { dashboardUrl: '' }));
  const abschnitt = blockAbschnitt(html(m), 'Transaktionen');
  // Ein <a href=""> zeigte auf die Seite selbst und saehe trotzdem aus wie
  // ein Ziel - die Zelle bleibt leer.
  assert.strictEqual(abschnitt.indexOf('<a '), -1);
  assert.strictEqual(abschnitt.indexOf('href=""'), -1);
  assert.strictEqual(abschnitt.indexOf('Öffnen</a>'), -1);
  // Die Spalte selbst bleibt stehen, sonst verschoebe sich der Kopf.
  assert.notStrictEqual(abschnitt.indexOf('<th>Öffnen</th>'), -1);
});

test('Eine fremde oder gefaehrliche Adresse wird gar nicht erst zum Link', () => {
  const m = modell();
  m.zeilen = m.zeilen.map(z => Object.assign({}, z, {
    dashboardUrl: 'javascript:alert(1)',
  }));
  const abschnitt = blockAbschnitt(html(m), 'Transaktionen');
  assert.strictEqual(abschnitt.indexOf('javascript:'), -1);
  assert.strictEqual(abschnitt.indexOf('<a '), -1);
});

test('Die Link-Spalte ist linksbuendig, nicht als Zahl gesetzt', () => {
  const abschnitt = blockAbschnitt(html(), 'Transaktionen');
  // Rechtsbuendig saehe der Knopf wie eine Messgroesse aus.
  assert.notStrictEqual(abschnitt.indexOf('<th>Öffnen</th>'), -1);
  assert.strictEqual(abschnitt.indexOf('<th class="num">Öffnen</th>'), -1);
});

// --- Formatierung ------------------------------------------------------------

test('Die Ausgabe formatiert, was die Bloecke roh fuehren', () => {
  const abschnitt = blockAbschnitt(html(), 'Transaktionen');
  // 7840000000 Einheiten -> 78.40; die rohe Einheit darf nirgends auftauchen.
  assert.notStrictEqual(abschnitt.indexOf('>78.40<'), -1);
  assert.strictEqual(abschnitt.indexOf('7840000000'), -1);
  // Eine fehlende Dauer wird zum Strich, nicht zur 0.
  assert.notStrictEqual(abschnitt.indexOf('<td class="num">—</td>'), -1);
});

test('Prozente stehen mit einer Nachkommastelle und Zeichen da', () => {
  const abschnitt = blockAbschnitt(html(), 'Einordnung');
  // 5 von 8 = 62.5 %.
  assert.notStrictEqual(abschnitt.indexOf('62.5 %'), -1);
});

test('Nirgends steht #FORMAT? - jede Zelle hat ein bekanntes Format', () => {
  // Das Sentinel faellt an, wenn eine Ausgabe reportingZellFormat() vergisst
  // oder ein Format eingefuehrt wurde, das die Ausgabeschicht nicht kennt.
  assert.strictEqual(html().indexOf('#FORMAT?'), -1);
});

test('Am Limit steht "mindestens" auf dem Bildschirm', () => {
  const m = B.buildReportingTdsModel([], {});
  m.hatDaten = true;
  m.abgeschnitten = true;
  m.kpi.failures = 20000;
  const abschnitt = blockAbschnitt(html(m), 'Kennzahlen');
  assert.notStrictEqual(abschnitt.indexOf('mindestens 20’000'), -1);
  assert.match(abschnitt, /Untergrenzen/);
});

// --- Kuchen, Balken, Einklappen ----------------------------------------------

test('Die fuenf Kuchen-Bloecke tragen ein SVG mit Legende, die uebrigen keines', () => {
  const markup = html();
  ['Ablehngründe', 'Einordnung', 'Dauer bis zum Abbruch', 'Zahlungsmittel', 'PAN-Quelle']
    .forEach(t => {
      const abschnitt = blockAbschnitt(markup, t);
      assert.notStrictEqual(abschnitt.indexOf('kuchen-block'), -1, `"${t}" ohne Kuchen`);
      assert.notStrictEqual(abschnitt.indexOf('kuchen-legende'), -1, `"${t}" ohne Legende`);
    });
  ['Wallet', 'Issuer-Land', 'BIN (Herausgeber)', 'ECI', 'Attempt Retry', 'Betrag je Währung']
    .forEach(t => assert.strictEqual(blockAbschnitt(markup, t).indexOf('kuchen-block'), -1,
      `"${t}" traegt einen Kuchen, den §2.1 nicht vorsieht`));
});

test('Die Farben der Legende kommen als CSS-Variable, nie als Inline-Hex', () => {
  const abschnitt = blockAbschnitt(html(), 'Dauer bis zum Abbruch');
  const farben = [...abschnitt.matchAll(/class="kuchen-farbe" style="background:([^"]+)"/g)]
    .map(m => m[1]);
  assert.ok(farben.length > 0);
  farben.forEach(f => assert.match(f, /^var\(--kuchen-/));
});

test('Verlauf und Stunden werden als Balken gezeichnet', () => {
  const markup = html();
  ['Verlauf', 'Stunden'].forEach(t => {
    const abschnitt = blockAbschnitt(markup, t);
    assert.notStrictEqual(abschnitt.indexOf('<svg class="balken"'), -1, `"${t}" ohne Balken`);
  });
});

test('Die lange Transaktionsliste steckt in <details>, die Uebersicht nicht', () => {
  const markup = html();
  // Acht Zeilen liegen unter der Schwelle; erst eine lange Liste klappt ein.
  assert.strictEqual(blockAbschnitt(markup, 'Transaktionen').indexOf('<details>'), -1);
  const m = modell();
  const eine = m.zeilen[0];
  m.zeilen = Array.from({ length: 60 }, () => eine);
  const lang = blockAbschnitt(html(m), 'Transaktionen');
  assert.notStrictEqual(lang.indexOf('<details><summary>Tabelle (60 Zeilen)</summary>'), -1);
  // Die Uebersichtsbloecke bleiben offen.
  assert.strictEqual(blockAbschnitt(markup, 'Einordnung').indexOf('<details>'), -1);
});

// --- Escaping ----------------------------------------------------------------

test('Zelltexte werden escaped - auch neben einer Link-Zelle', () => {
  const m = modell();
  m.zeilen = [Object.assign({}, m.zeilen[0], {
    merchantReference: '<script>alert(1)</script>',
    grundName: 'A & B',
  })];
  const abschnitt = blockAbschnitt(html(m), 'Transaktionen');
  assert.strictEqual(abschnitt.indexOf('<script>alert(1)</script>'), -1);
  assert.notStrictEqual(abschnitt.indexOf('&lt;script&gt;'), -1);
  assert.notStrictEqual(abschnitt.indexOf('A &amp; B'), -1);
  // Der Link daneben steht trotzdem.
  assert.notStrictEqual(abschnitt.indexOf('rel="noopener"'), -1);
});

test('Die Ausgabe schreibt nicht ins DOM - sie gibt nur Markup zurueck', () => {
  // Der Test hiess frueher „fasst kein DOM an" und belegte nur Idempotenz -
  // die haette auch eine Funktion, die brav in ein Element hineinschreibt.
  // Gemessen wird jetzt zweierlei:
  //   1. waehrend des Aufrufs holt sich niemand ein Element vom Dokument, und
  //   2. kein Knoten, den die App beim Laden aufgeloest hat, hat sich
  //      veraendert.
  // Was von aussen NICHT messbar ist: ein LESEN ueber eine Referenz, die
  // schon beim Laden in einer Konstante steckt. Deshalb heisst der Test jetzt
  // „schreibt nicht ins DOM" statt „fasst kein DOM an" - das ist, was er
  // zeigt. Zusammen mit der Idempotenz unten reicht es fuer die Zusage, auf
  // die es ankommt: dieselbe Blockliste ergibt dasselbe Markup, egal in
  // welchem Zustand die Seite ist.
  const m = modell();
  assert.ok(KNOTEN.length > 10, `nur ${KNOTEN.length} Knoten - der Schnappschuss prueft nichts`);
  const schnappschuss = () => KNOTEN.map(el => [
    el.innerHTML, el.textContent, el.className, el.value, el.children.length,
    JSON.stringify(el.attributes), JSON.stringify(el.dataset),
  ].join('\0'));
  const vorher = schnappschuss();

  const beruehrt = [];
  const echt = {};
  ['getElementById', 'querySelector', 'querySelectorAll', 'createElement'].forEach(name => {
    echt[name] = DOC[name];
    DOC[name] = function (...args) {
      beruehrt.push(`${name}(${args.join(', ')})`);
      return echt[name].apply(DOC, args);
    };
  });
  let markup;
  try {
    markup = html(m);
  } finally {
    Object.keys(echt).forEach(name => { DOC[name] = echt[name]; });
  }

  assert.deepStrictEqual(beruehrt, [],
    `Dokument-Zugriffe waehrend der Ausgabe: ${beruehrt.join(' · ')}`);
  assert.deepStrictEqual(schnappschuss(), vorher, 'die Ausgabe hat einen Knoten veraendert');
  // Der Aufbau ist nicht leer - sonst waeren beide Nullmessungen wertlos.
  assert.ok(markup.length > 1000, `nur ${markup.length} Zeichen Markup`);
  // Und weiterhin idempotent: zweimal aufgerufen kommt zweimal dasselbe heraus.
  assert.strictEqual(plain(markup), plain(html(m)));
});
