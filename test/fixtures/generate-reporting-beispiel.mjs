// Erzeugt test/fixtures/reporting-beispiel.csv - den Testdatensatz fuer den
// Reporting-Modus (parseReportingCsv, Task 2; Modell in Task 3).
//
// ACHTUNG - die Daten sind FREI ERFUNDEN und SYNTHETISCH. Der echte Portal-Lauf
// von dashboard/sql/01_reporting_reference.sql hat zum Zeitpunkt von Task 2
// noch NICHT stattgefunden. Diese Fixture bildet deshalb nur die STRUKTUR nach,
// die die Query laut ihrer SELECT-Liste liefert - sie beweist nicht, wie wallee
// die Werte wirklich formatiert. Nach dem echten Portal-Lauf ist sie gegen das
// Ergebnis zu validieren und, wo sie abweicht, zu ersetzen. Space-IDs,
// Terminal-Kennungen, Betraege und Zeitstempel sind erfunden; die realen
// Referenz-Spaces (40402/12622) tauchen hier bewusst NICHT auf, weil dieses
// Repository oeffentlich ist.
//
// Nachgebildet sind die fachlich interessanten Faelle aus SPEC 3.2 und 7:
//
//   - alle drei Kanaele: POS, ECOM und OTHER (saleschannel weder POS noch ECOM;
//     laut SPEC 7 ein eigener Tab, kein verworfener Rest)
//   - mehrere Brands inkl. TWINT als Nicht-Karten-Brand (keine Karten-Labels)
//   - eine Wallet-Zeile (wallet != '-'), sonst der Default '-'
//   - zwei Waehrungen (CHF, EUR) - Betraege je Waehrung, Zaehlwerte gesamt
//   - SUCCESSFUL- und FAILED-Zeilen (FAILED traegt summe_betrag_failed,
//     SUCCESSFUL traegt summe_betrag und summe_refund)
//   - eine Zeile mit leerem issuer_country -> muss im Parser UNKNOWN werden
//   - Trinkgeld (P3) NUR am POS und nur an erfolgreichen Attempts, dort aber
//     nicht auf jeder Zeile: die Query fuehrt summe_tip als
//     CASE WHEN state = 'SUCCESSFUL' ueber einen LEFT JOIN, ausserhalb dessen
//     ist die Spalte NULL. So traegt die Fixture beide Faelle - und die
//     Kanaele ECOM/OTHER ganz ohne Trinkgeld belegen die Regel aus SPEC 4.2
//     ("nur wenn Space Trinkgeld-Lineitems hat")
//   - alle drei 3DS-Auspraegungen: started+cavv, started ohne cavv, nur ECI
//   - Bloecke TIME (Tag/Stunde) und CONV (COUNT(DISTINCT) je Brand)
//
// Die typisierten NULL-Platzhalter der Bloecke TIME und CONV kommen als leere
// Felder in der CSV an - genau so schreibt die Analytics den CAST(NULL AS ...).
//
// Deterministisch: gleicher Lauf -> gleiche Datei. Kein Math.random, sondern
// ein kleiner Seed-Generator, damit die Sollzahlen in
// test/reporting-model.test.js reproduzierbar bleiben.
//
// Aufruf:  node test/fixtures/generate-reporting-beispiel.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ZIEL = path.join(HIER, 'reporting-beispiel.csv');

// Mulberry32 - kleiner, deterministischer PRNG (wie in generate-beispiel-daten.mjs).
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
const rnd = prng(20260828);
// Eigener Strom fuer die Trinkgeld-Spalte (Task 4b). Bewusst NICHT aus rnd
// gezogen: jede zusaetzliche Ziehung aus rnd verschoebe alle nachfolgenden
// Werte und damit saemtliche in test/reporting-model.test.js verankerten
// Summen. Mit einem zweiten Strom bleibt der Diff der Fixture genau die neue
// Spalte, und die alten Sollwerte bleiben als Gegenprobe gueltig.
const rndTip = prng(20260904);

// Spaltenreihenfolge 1:1 aus der SELECT-Liste von
// dashboard/sql/01_reporting_reference.sql. Die Terminal-Variante (01b) haengt
// terminal_identifier/terminal_name vor "tag" ein; die Fixture bildet bewusst
// die Nicht-Terminal-Variante ab, weil die Terminal-Spalten optional sind und
// im Test separat geprueft werden.
const KOPF = [
  'block', 'space_id', 'channel', 'brand', 'wallet', 'waehrung', 'attempt_state',
  'failure_reason_id', 'auth_response_code', 'issuer_country', 'card_category',
  'funding', 'pan_type', 'dcc', 'tds_started', 'tds_cavv', 'eci', 'tag', 'stunde',
  'anzahl_attempts', 'anzahl_transaktionen', 'summe_betrag', 'summe_betrag_failed',
  'summe_refund', 'summe_tip', 'tx_mit_attempt', 'tx_erfolgreich',
];

const SPACE_POS = '90001';    // erfundener POS-Space
const SPACE_ECOM = '90002';   // erfundener E-Commerce-Space

// Betrag als String mit 8 Nachkommastellen, aus Ganzzahl-Rappen gerechnet -
// nie ueber Gleitkomma, damit die Datei bei jedem Lauf identisch bleibt.
function betrag(rappen) {
  const vorzeichen = rappen < 0 ? '-' : '';
  const v = Math.abs(rappen);
  return vorzeichen + Math.floor(v / 100) + '.' + String(v % 100).padStart(2, '0') + '000000';
}
function zufallsBetrag(min, max) {
  return betrag(min + Math.floor(rnd() * (max - min)));
}
function zufallsTrinkgeld(min, max) {
  return betrag(min + Math.floor(rndTip() * (max - min)));
}

const zeilen = [];

// --- Block DIM ------------------------------------------------------------
// Explizite Fallliste statt Zufallsmischung: jede Zeile deckt einen benannten
// Fall ab, damit beim Lesen der Fixture erkennbar bleibt, warum sie da ist.
const DIM_FAELLE = [
  // POS, Standardfall Karte, kein 3DS (am Terminal gibt es keines).
  { space: SPACE_POS, channel: 'POS', brand: 'Visa', waehrung: 'CHF', state: 'SUCCESSFUL',
    arc: '00', land: 'CH', kat: 'CLASSIC', funding: 'DEBIT', n: 640 },
  { space: SPACE_POS, channel: 'POS', brand: 'Mastercard', waehrung: 'CHF', state: 'SUCCESSFUL',
    arc: '00', land: 'CH', kat: 'WORLD_ELITE_BUSINESS', funding: 'CREDIT', n: 415 },
  // POS-Ablehnung: FAILED traegt den abgelehnten Betrag, nicht den Umsatz.
  { space: SPACE_POS, channel: 'POS', brand: 'Visa', waehrung: 'CHF', state: 'FAILED',
    reason: '1487356536632', arc: '51', land: 'CH', kat: 'CLASSIC', funding: 'DEBIT', n: 23 },
  // Auslaendischer Issuer + DCC.
  { space: SPACE_POS, channel: 'POS', brand: 'Mastercard', waehrung: 'CHF', state: 'SUCCESSFUL',
    arc: '00', land: 'DE', kat: 'CLASSIC', funding: 'CREDIT', dcc: true, n: 58 },
  // Issuer-Land in abweichendem Format (ISO-3 statt ISO-2, SPEC 7). Der Parser
  // gibt den Rohwert durch; die Normalisierung gehoert ins Modell (Task 3) -
  // dort muss 'CHE' zu Inland werden oder zu UNKNOWN, NIE zu INTER. Ohne diesen
  // Fall in der Fixture liesse sich die Regel dort an nichts festmachen.
  // ... und zugleich der POS-Fall OHNE Trinkgeld (ohneTip): auch in einem
  // Space mit Trinkgeld-Lineitems bleibt summe_tip dort NULL, wo keine
  // Transaktion des Tupels eines trug.
  { space: SPACE_POS, channel: 'POS', brand: 'Visa', waehrung: 'CHF', state: 'SUCCESSFUL',
    arc: '00', land: 'CHE', kat: 'CLASSIC', funding: 'CREDIT', ohneTip: true, n: 34 },
  // Nicht-Karten-Brand: TWINT traegt keine Karten-Labels, alle bleiben leer.
  { space: SPACE_POS, channel: 'POS', brand: 'TWINT', waehrung: 'CHF', state: 'SUCCESSFUL',
    land: '', kat: '', funding: '', n: 137 },
  // PostFinance Card, ebenfalls ohne Issuer-Labels - deckt das leere
  // issuer_country ein zweites Mal ab, diesmal mit gefuellter Kategorie.
  { space: SPACE_POS, channel: 'POS', brand: 'PostFinance Card', waehrung: 'CHF',
    state: 'SUCCESSFUL', land: '', kat: 'NOT_SPECIFIED', funding: 'DEBIT', n: 96 },

  // E-Commerce, 3DS vollstaendig authentifiziert (started + cavv).
  { space: SPACE_ECOM, channel: 'ECOM', brand: 'Visa', waehrung: 'CHF', state: 'SUCCESSFUL',
    arc: 'SUCCESSFUL', land: 'CH', kat: 'CLASSIC', funding: 'CREDIT',
    tds: true, cavv: true, eci: '05', n: 212 },
  // 3DS begonnen, aber ohne CAVV -> FAILED_OR_ABANDONED (SPEC 3.1).
  { space: SPACE_ECOM, channel: 'ECOM', brand: 'Visa', waehrung: 'CHF', state: 'FAILED',
    reason: '1487356536632', arc: 'AUTHORIZATION_DECLINED', land: 'CH', kat: 'CLASSIC',
    funding: 'CREDIT', tds: true, cavv: false, n: 41 },
  // Kein 3DS gestartet, aber ECI vorhanden -> WALLET_CRYPTOGRAM. Zugleich die
  // Wallet-Zeile (wallet != '-') und ein Pan Type.
  { space: SPACE_ECOM, channel: 'ECOM', brand: 'Visa', wallet: 'Apple Pay', waehrung: 'CHF',
    state: 'SUCCESSFUL', arc: 'SUCCESSFUL', land: 'CH', kat: 'CLASSIC', funding: 'CREDIT',
    pan: 'DEVICE_TOKEN_APPLE_PAY', tds: false, cavv: false, eci: '07', n: 88 },
  // Zweite Waehrung.
  { space: SPACE_ECOM, channel: 'ECOM', brand: 'Mastercard', waehrung: 'EUR',
    state: 'SUCCESSFUL', arc: 'SUCCESSFUL', land: 'DE', kat: 'CLASSIC', funding: 'CREDIT',
    tds: true, cavv: true, eci: '02', n: 64 },
  { space: SPACE_ECOM, channel: 'ECOM', brand: 'Mastercard', waehrung: 'EUR',
    state: 'FAILED', reason: '1487356536644', arc: 'SECURITY', land: 'FR', kat: 'CLASSIC',
    funding: 'CREDIT', tds: true, cavv: false, n: 19 },
  // Attempt ohne aufloesbare Brand (SPEC 7): bleibt in K2 sichtbar.
  { space: SPACE_ECOM, channel: 'ECOM', brand: 'UNKNOWN', waehrung: 'CHF',
    state: 'FAILED', reason: '', land: '', kat: '', funding: '', n: 6 },

  // PENDING (SPEC 7): weder Umsatz noch Ablehnung - in den Kacheln als "offen"
  // auszuweisen und aus allen Quoten herauszuhalten. Beide Betragsspalten
  // bleiben deshalb NULL.
  { space: SPACE_ECOM, channel: 'ECOM', brand: 'Visa', waehrung: 'CHF',
    state: 'PENDING', land: 'CH', kat: 'CLASSIC', funding: 'CREDIT',
    tds: true, cavv: false, n: 9 },

  // Dritter Kanal (saleschannel weder POS noch ECOM) - eigener Tab, nicht
  // verworfen.
  { space: SPACE_ECOM, channel: 'OTHER', brand: 'Visa', waehrung: 'CHF',
    state: 'SUCCESSFUL', arc: 'SUCCESSFUL', land: 'CH', kat: 'CLASSIC',
    funding: 'CREDIT', n: 12 },
];

DIM_FAELLE.forEach(f => {
  const erfolg = f.state === 'SUCCESSFUL';
  // PENDING ist weder das eine noch das andere: kein Umsatz, kein abgelehnter
  // Betrag - beide Betragsspalten bleiben NULL (SPEC 7: als "offen" ausweisen,
  // aus allen Quoten heraushalten).
  const fehlgeschlagen = f.state === 'FAILED';
  const tx = Math.max(1, f.n - Math.floor(rnd() * Math.min(8, f.n)));
  zeilen.push({
    block: 'DIM',
    space_id: f.space,
    channel: f.channel,
    brand: f.brand,
    wallet: f.wallet || '-',
    waehrung: f.waehrung,
    attempt_state: f.state,
    failure_reason_id: f.reason || '',
    auth_response_code: f.arc || '',
    issuer_country: f.land === undefined ? 'CH' : f.land,
    card_category: f.kat === undefined ? 'CLASSIC' : f.kat,
    funding: f.funding === undefined ? 'CREDIT' : f.funding,
    pan_type: f.pan || '',
    dcc: f.dcc ? 'true' : 'false',
    tds_started: f.tds ? 'true' : 'false',
    tds_cavv: f.cavv ? 'true' : 'false',
    eci: f.eci || '',
    anzahl_attempts: String(f.n),
    anzahl_transaktionen: String(tx),
    // SUM() ueber lauter NULL ergibt NULL, nicht 0 - in der CSV also ein LEERES
    // Feld. summe_betrag entsteht aus CASE WHEN state = 'SUCCESSFUL', ist bei
    // einer FAILED-Zeile also durchgehend NULL (und umgekehrt fuer
    // summe_betrag_failed). "0.00000000" wuerde eine Form zeigen, die die Query
    // gar nicht liefert, und den NULL-Pfad des Parsers ungeprueft lassen.
    summe_betrag: erfolg ? zufallsBetrag(f.n * 900, f.n * 4200) : '',
    summe_betrag_failed: fehlgeschlagen ? zufallsBetrag(f.n * 1200, f.n * 5000) : '',
    // Refunds nur auf einem Teil der erfolgreichen Zeilen - so bleibt die
    // Refund-Quote im Modell unterscheidbar von "alles 0". Ohne Erfolg gibt es
    // keinen Refund-Wert, nur NULL.
    summe_refund: erfolg ? (rnd() < 0.5 ? zufallsBetrag(0, f.n * 300) : betrag(0)) : '',
    // Trinkgeld gibt es nur am POS (Gastro, SPEC 4.2 P3) und nur an
    // erfolgreichen Attempts - der CASE-Guard der Query laesst nichts anderes
    // durch. Ausserhalb: leeres Feld, nicht "0.00000000".
    summe_tip: (erfolg && f.channel === 'POS' && !f.ohneTip)
      ? zufallsTrinkgeld(f.n * 40, f.n * 220) : '',
  });
});

// --- Block TIME -----------------------------------------------------------
// Tag/Stunde je Space, Kanal, Brand, Waehrung, Attempt-State. Bewusst nur
// wenige Stunden, damit die Fixture lesbar bleibt; die Tagesverteilung des
// echten Laufs ist deutlich dichter.
const TIME_BASIS = [
  { space: SPACE_POS, channel: 'POS', brand: 'Visa', waehrung: 'CHF', state: 'SUCCESSFUL' },
  { space: SPACE_POS, channel: 'POS', brand: 'Visa', waehrung: 'CHF', state: 'FAILED' },
  { space: SPACE_POS, channel: 'POS', brand: 'TWINT', waehrung: 'CHF', state: 'SUCCESSFUL' },
  { space: SPACE_ECOM, channel: 'ECOM', brand: 'Visa', waehrung: 'CHF', state: 'SUCCESSFUL' },
  { space: SPACE_ECOM, channel: 'ECOM', brand: 'Mastercard', waehrung: 'EUR', state: 'SUCCESSFUL' },
  { space: SPACE_ECOM, channel: 'ECOM', brand: 'Visa', waehrung: 'CHF', state: 'PENDING' },
];
['2026-07-01', '2026-07-02'].forEach(tag => {
  [8, 12, 19].forEach(stunde => {
    TIME_BASIS.forEach(b => {
      const n = 1 + Math.floor(rnd() * 40);
      zeilen.push({
        block: 'TIME',
        space_id: b.space, channel: b.channel, brand: b.brand, waehrung: b.waehrung,
        attempt_state: b.state,
        tag, stunde: String(stunde),
        anzahl_attempts: String(n),
        // Wie im DIM-Block: SUM(amount) ist ausserhalb von SUCCESSFUL NULL.
        summe_betrag: b.state === 'SUCCESSFUL' ? zufallsBetrag(n * 900, n * 4200) : '',
      });
    });
  });
});

// --- Block CONV -----------------------------------------------------------
// COUNT(DISTINCT) je Space, Kanal, Brand, Waehrung - ueber DIM-Tupel hinweg
// nicht summierbar, deshalb ein eigener Block.
const CONV_BASIS = [
  { space: SPACE_POS, channel: 'POS', brand: 'Visa', waehrung: 'CHF', mit: 663, ok: 640 },
  { space: SPACE_POS, channel: 'POS', brand: 'Mastercard', waehrung: 'CHF', mit: 473, ok: 473 },
  { space: SPACE_POS, channel: 'POS', brand: 'TWINT', waehrung: 'CHF', mit: 137, ok: 137 },
  { space: SPACE_ECOM, channel: 'ECOM', brand: 'Visa', waehrung: 'CHF', mit: 318, ok: 296 },
  { space: SPACE_ECOM, channel: 'ECOM', brand: 'Mastercard', waehrung: 'EUR', mit: 79, ok: 64 },
  { space: SPACE_ECOM, channel: 'OTHER', brand: 'Visa', waehrung: 'CHF', mit: 12, ok: 12 },
];
CONV_BASIS.forEach(b => {
  zeilen.push({
    block: 'CONV',
    space_id: b.space, channel: b.channel, brand: b.brand, waehrung: b.waehrung,
    tx_mit_attempt: String(b.mit), tx_erfolgreich: String(b.ok),
  });
});

const q = v => '"' + String(v == null ? '' : v) + '"';
const csv = [
  KOPF.map(q).join(','),
  ...zeilen.map(z => KOPF.map(k => q(z[k] === undefined ? '' : z[k])).join(',')),
].join('\n') + '\n';

fs.writeFileSync(ZIEL, csv);
const zaehle = b => zeilen.filter(z => z.block === b).length;
console.log(`${ZIEL}: ${zeilen.length} Datenzeilen `
  + `(DIM ${zaehle('DIM')}, TIME ${zaehle('TIME')}, CONV ${zaehle('CONV')})`);
