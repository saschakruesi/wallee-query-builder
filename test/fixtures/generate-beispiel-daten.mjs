// Erzeugt test/fixtures/beispiel-daten.csv - den Testdatensatz fuer den
// Terminal-Report.
//
// Die Daten sind FREI ERFUNDEN. Der urspruengliche Datensatz aus der SPEC
// stammte aus einem echten Kundenexport (Space-ID, Terminal-IDs, Outlet-Namen
// und Umsaetze eines Gastronomiebetriebs) und gehoert damit nicht in ein
// oeffentliches Repository. Nachgebildet ist deshalb nur die STRUKTUR und die
// fachlich interessanten Faelle:
//
//   - 10 Outlet-Gruppen nach der Auto-Regel (abschliessende Nummer weg)
//   - ein Merge-Fall ueber zwei Gruppen ("Saal Nord" + "Saal Süd" -> "Saal"),
//     analog zu "Klub Tür" + "Klub Garderobe" -> "Klub" in der SPEC
//   - genau eine Lunch-Check-Zeile auf einem einzelnen Terminal, damit die
//     zweite Brand-Gruppe innerhalb einer Outlet-Gruppe auftaucht
//   - Betraege mit 8 Nachkommastellen, Terminals mit mehreren Brands
//
// Deterministisch: gleicher Lauf -> gleiche Datei. Kein Math.random, sondern
// ein kleiner Seed-Generator, damit die Sollzahlen in test/report.test.js
// reproduzierbar bleiben.
//
// Aufruf:  node test/fixtures/generate-beispiel-daten.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ZIEL = path.join(HIER, 'beispiel-daten.csv');

// Mulberry32 - kleiner, deterministischer PRNG.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = prng(20260720);

// Terminals: Name -> Auto-Outlet-Gruppe ergibt sich aus der abschliessenden Nummer.
const TERMINALS = [
  'Terrasse 1', 'Terrasse 2', 'Terrasse 3',
  'Saal Nord 1', 'Saal Nord 2',
  'Saal Süd 1',
  'Bar 1', 'Bar 2',
  'Kiosk',
  'Weinkeller 1',
  'Dachgarten 1', 'Dachgarten 2',
  'Bistro 1',
  'Empfang',
  'Galerie 1',
];

// Kartenmarken wie im Analytics-Export. Lunch Check kommt bewusst nur an
// genau einer Stelle vor (siehe unten).
const BRANDS = ['Visa', 'Mastercard', 'PostFinance Card', 'TWINT', 'Visa V PAY', 'Mastercard Maestro'];

const SPACE_ID = '99001';
const zeilen = [];

TERMINALS.forEach((name, i) => {
  const tid = String(40000000 + i * 137);       // erfundene, aber stabile TIDs
  const anzahlBrands = 3 + Math.floor(rnd() * 4); // 3 bis 6 Brands je Terminal
  BRANDS.slice(0, anzahlBrands).forEach(brand => {
    const n = 1 + Math.floor(rnd() * 60);
    // Unmatched liegt mal bei 0, mal bei allen Transaktionen - beides kommt
    // in echten Exporten vor (je nachdem, ob schon abgerechnet wurde).
    const unmatched = rnd() < 0.45 ? n : Math.floor(rnd() * 3);
    const brutto = (5 + rnd() * 1800).toFixed(2);
    const tip = (rnd() < 0.7 ? rnd() * 40 : 0).toFixed(2);
    const fee = (rnd() * 3).toFixed(2);
    const netto = (Number(brutto) - Number(fee)).toFixed(2);
    zeilen.push({
      space: SPACE_ID, tid, name, brand, waehrung: 'CHF',
      n, unmatched,
      brutto: Number(brutto).toFixed(8),
      fee: Number(fee).toFixed(8),
      netto: Number(netto).toFixed(8),
      tip: Number(tip).toFixed(8),
    });
  });
});

// Der Lunch-Check-Sonderfall: eine einzelne Zeile auf "Dachgarten 2".
// Erzeugt die zweite Brand-Gruppe innerhalb der Outlet-Gruppe "Dachgarten".
const dachgarten2 = zeilen.find(z => z.name === 'Dachgarten 2');
zeilen.push({
  space: SPACE_ID, tid: dachgarten2.tid, name: 'Dachgarten 2', brand: 'Lunch Check',
  waehrung: 'CHF', n: 2, unmatched: 1,
  brutto: (31).toFixed(8), fee: (0).toFixed(8), netto: (31).toFixed(8), tip: (0).toFixed(8),
});

const KOPF = ['space_id', 'terminal_identifier', 'terminal_name', 'brand', 'waehrung',
  'anzahl_transaktionen', 'unmatched_anzahl', 'brutto_gross', 'transaction_fee_total',
  'netto', 'tip_total'];

const q = v => '"' + String(v) + '"';
const csv = [
  KOPF.map(q).join(','),
  ...zeilen.map(z => [z.space, z.tid, z.name, z.brand, z.waehrung, z.n, z.unmatched,
    z.brutto, z.fee, z.netto, z.tip].map(q).join(',')),
].join('\n') + '\n';

fs.writeFileSync(ZIEL, csv);
console.log(`${ZIEL}: ${zeilen.length} Datenzeilen, ${TERMINALS.length} Terminals`);
