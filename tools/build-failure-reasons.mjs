#!/usr/bin/env node
// Erzeugt die Konstante FAILURE_REASONS in wallee_query_builder.html aus dem
// gescrapten wallee-Katalog dashboard/catalog/failure-reasons.json.
//
// Aufruf:  node tools/build-failure-reasons.mjs
//          node tools/build-failure-reasons.mjs <ziel.html> <katalog.json>
//
// Die zwei optionalen Argumente sind die Testnaht (test/embedding.test.js):
// nur so laesst sich der Schritt gegen eine Wegwerf-Datei und einen winzigen
// Katalog laufen lassen, statt die 1.35-MB-App im Test zu kopieren.
//
// WARUM EIN BUILD-SCHRITT UND NICHT HANDARBEIT: der Katalog hat 2'254
// Eintraege. Von Hand gepflegt blieb die Tabelle bei den sieben IDs stehen,
// die zufaellig in den Referenzlaeufen vorkamen - jeder andere Ablehngrund
// stand im Report als '#<id>'. Eingebettet statt nachgeladen, weil der
// Kopieren-Modus offline per file:// laeuft und dort keine Route erreichbar
// ist (SPEC-ITERATION-2 §1.3 Punkt 1: der Zuwachs von rund 107 KB ist der
// bewusst bezahlte Preis dafuer).
//
// Der Katalog selbst aendert sich selten; aktualisiert wird er mit
//   python3 dashboard/tools/scrape_wallee_catalogs.py failure-reason en-us
// (Scraper, Python 3, nur Standardbibliothek). Danach diesen Schritt erneut
// laufen lassen - er ist idempotent, ein zweiter Lauf aendert nichts mehr.
//
// Die App selbst bleibt eine Single-File-App ohne Build: dieses Werkzeug
// schreibt in die eingecheckte HTML-Datei, es laeuft nicht zur Laufzeit.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.join(HIER, '..');
const ZIEL = process.argv[2] || path.join(WURZEL, 'wallee_query_builder.html');
const KATALOG = process.argv[3] || path.join(WURZEL, 'dashboard', 'catalog', 'failure-reasons.json');

const BEGIN = '/* FAILURE_REASONS:BEGIN */';
const ENDE = '/* FAILURE_REASONS:END */';

// Kategorie-Kuerzel statt des ausgeschriebenen Namens: 2'254 mal
// 'Configuration' waeren allein rund 30 KB, die kein Mensch je liest. Die
// Aufloesung steht in der App (FAILURE_KATEGORIE_KUERZEL). Eine Kategorie, die
// der Katalog nicht kennt, wird zu '' - die App liest das als UNKNOWN, und das
// ist ehrlicher als sie in einen der fuenf Eimer zu raten.
const KUERZEL = {
  'End User': 'E',
  Configuration: 'C',
  Internal: 'I',
  'Temporary Issue': 'T',
  Developer: 'D',
};

function fehler(text) {
  process.stderr.write(`build-failure-reasons: ${text}\n`);
  process.exit(1);
}

function einmalig(text, marker) {
  let n = 0;
  let i = text.indexOf(marker);
  while (i !== -1) { n += 1; i = text.indexOf(marker, i + marker.length); }
  return n;
}

const katalog = JSON.parse(fs.readFileSync(KATALOG, 'utf8'));
const ids = Object.keys(katalog).sort();
if (!ids.length) fehler(`Katalog ${KATALOG} ist leer.`);

// String-Sortierung der IDs, damit ein erneuter Lauf denselben Diff ergibt -
// die Reihenfolge von Object.keys() haengt sonst an der Reihenfolge im JSON.
const eintraege = ids.map(id => {
  const e = katalog[id] || {};
  const name = String(e.name == null ? '' : e.name);
  const kat = Object.prototype.hasOwnProperty.call(KUERZEL, e.category) ? KUERZEL[e.category] : '';
  return `${JSON.stringify(id)}:[${JSON.stringify(name)},${JSON.stringify(kat)}]`;
});

const zeile = `  const FAILURE_REASONS = {${eintraege.join(',')}};`;

// Ein Name mit '</script' wuerde den umschliessenden Script-Block mitten im
// Code beenden. Bisher kommt das nicht vor; faellt es je an, soll der Build
// abbrechen statt eine kaputte App zu schreiben.
if (/<\/script/i.test(zeile)) fehler('Ein Katalog-Name enthaelt "</script" - Abbruch.');

const html = fs.readFileSync(ZIEL, 'utf8');
if (einmalig(html, BEGIN) !== 1) fehler(`Marker ${BEGIN} kommt nicht genau einmal in ${ZIEL} vor.`);
if (einmalig(html, ENDE) !== 1) fehler(`Marker ${ENDE} kommt nicht genau einmal in ${ZIEL} vor.`);
if (html.indexOf(BEGIN) > html.indexOf(ENDE)) fehler('Marker stehen in falscher Reihenfolge.');

const block = new RegExp(
  `${BEGIN.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}[\\s\\S]*?${ENDE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`,
);

// Replacer-FUNKTION, nie ein Ersatz-STRING: in einem String deutet replace()
// die Sequenzen $&, $', $` und $1 als Einsetzungsmuster. Ein Katalog-Name wie
// "Payment $& declined" wuerde damit still den ganzen gefundenen Block an
// seiner Stelle einsetzen - dieselbe Falle, die test/embedding.test.js fuer
// den eingebetteten Vendor-Code beschreibt.
const neu = html.replace(block, () => `${BEGIN}\n${zeile}\n  ${ENDE}`);

if (neu === html) {
  process.stdout.write(`unveraendert (${ids.length} Eintraege)\n`);
} else {
  fs.writeFileSync(ZIEL, neu);
  process.stdout.write(`${ids.length} Ablehngruende geschrieben (${Math.round(zeile.length / 1024)} KB) -> ${ZIEL}\n`);
}
