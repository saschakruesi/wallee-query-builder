# Reporting-Modus (Händler-KPIs) — Implementierungsplan

> **Für Claude Code:** Diesen Plan Task für Task abarbeiten (empfohlen:
> superpowers:subagent-driven-development oder superpowers:executing-plans). Jede Task
> endet mit grünen Tests (`node --test "test/*.test.js"`) und einem Commit. Vor Task 1
> zwingend `CLAUDE.md` lesen (Architektur, Wallee-Referenzwissen, Fallstricke) und
> `dashboard/SPEC.md` (fachliche Definitionen). Checkboxen (`- [ ]`) zum Abhaken nutzen.

**Goal:** Ein neuer Modus `reporting` in `wallee_query_builder.html`, der pro Space und
Zeitraum die Händler-KPIs aus SPEC §4 (Success Rate, Zahlungsmittel-Mix, Business/Privat,
Karten-Herkunft Domestisch/Intra/Inter, Durchschnittsbeträge, 3DS-Akzeptanz,
Ablehngründe, Verlauf) getrennt nach POS und E-Commerce berechnet — **immer auf
Charge-Attempt-Basis** — und sie als gebrandeten Report (Bildschirm, XLSX, PDF, CSV)
ausgibt.

**Architecture:** Eine vor-aggregierende SQL-Query (`buildReportingQuery`, Blöcke
`DIM`/`TIME`/`CONV` per `UNION ALL`) → Parser (`parseReportingCsv`) → Modell
(`buildReportingModel`) → Export-Blöcke (`reportingExportBloecke`) → Render/XLSX/PDF.
Exakt das Muster des Settlement-Reports (Parser → Modell → Blöcke → drei Ausgaben aus
einer Quelle). Karten-Attribute aus `chargeattempt.labels` über Descriptor-IDs, die in
Task 0 an echten Daten ermittelt werden. Failure-Reason-Namen liefert eine neue
Proxy-Route.

**Tech Stack:** Single-File-HTML (`<script id="app-logic">`), reine Funktionen ohne
Framework; `node --test` mit `test/harness.js`; XLSX über `vendor-xlsx`, PDF über
`vendor-jspdf`; Proxy `wallee-proxy.mjs` (Zero-Dependency Node).

## Global Constraints

- **Single File, kein Build, kein neuer Vendor.** Balken/Verlauf als inline-SVG.
- **Charge Attempt ist die Basis — für POS und E-Com.** Nie `COUNT(*)` auf `transaction`
  für eine Quote. Zeitfilter auf `ca.createdon`.
- **`environment = 'PRODUCTION'`** (Wert aus Task 0; Konstante `ATTEMPT_ENVIRONMENT`).
- **Fehlende Labels → Bucket `UNKNOWN`**, nie stille Zuordnung zu einem anderen Bucket.
- **Nie Währungen addieren.** Beträge pro Währung; Beträge intern als 1e-8-Ganzzahlen
  (`unitsZuZahl`/`formatZahlCH`), nie `parseFloat(v)*1e8`.
- **`lineitem` nie direkt joinen** (Zeilenvervielfachung) — `tipCte` wiederverwenden.
- **Kein `STORAGE_KEY`-Bump**: neue State-Felder additiv, Defaults in `loadState()`.
- **Bestehende Modi byte-identisch**: keine Änderung an `buildBrandQuery` & Co.;
  bestehende Tests bleiben unverändert grün.
- **UI/Doku: Deutsch (Schweiz), ss statt ß.**
- **Repo ist öffentlich.** Discovery-Ergebnisse und Referenzdaten nach
  `dashboard/discovery-results/` (Task 0 legt den `.gitignore`-Eintrag an).
- **Version** am Ende auf `5.11.0` in `wallee_query_builder.html` (`APP_VERSION`,
  `<h1>`-Badge, Subtitle) und `wallee-proxy.mjs` (`APP_VERSION`).

---

## File Structure

- `wallee_query_builder.html` — alle App-Änderungen (Konstanten, SQL-Builder, Parser,
  Modell, Export-Blöcke, Markup, `setMode`, Wiring).
- `wallee-proxy.mjs` — Route `GET /failure-reasons` (Task 6), `APP_VERSION`.
- `test/reporting-queries.test.js` — SQL-Builder (Task 1).
- `test/reporting-model.test.js` — Parser + Modell + Klassifikation (Task 2, 3).
- `test/reporting-export.test.js` — Export-Blöcke (Task 4).
- `test/dom-ids.test.js` — statischer ID-Wächter (läuft unverändert, Task 5).
- `test/proxy.test.js` — `findeRoute('GET', '/failure-reasons')` (Task 6).
- `test/betriebsmodus.test.js` — State-Defaults/Migration (Task 5).
- `dashboard/SPEC.md`, `dashboard/PLAN.md`, `dashboard/sql/00_label_discovery.sql` —
  diese Vorgaben; `dashboard/sql/01_reporting_reference.sql` — generierte Referenz-Query
  nach Task 1 (zum Gegenprüfen im Portal).
- `CLAUDE.md`, `README.md` — Doku (Task 7).

Reihenfolge = Datenfluss: Discovery → SQL → Parser → Modell → Ausgabe → UI → Proxy → Doku.

---

### Task 0: Discovery — Descriptor-IDs und Wertemengen an echten Daten ermitteln

**Ziel:** Alle Unbekannten aus SPEC §9 sind mit echten Werten belegt, bevor Code entsteht.
**Wer:** Sascha führt die Queries aus (Portal oder API-Modus); Claude Code wertet aus.

- [ ] **Step 1:** `.gitignore` um `dashboard/discovery-results/` ergänzen, Ordner anlegen.
- [ ] **Step 2:** `dashboard/sql/00_label_discovery.sql` Q1–Q6 mit Ziel-Space(s) und
      einem Monat Zeitraum einzeln ausführen; CSVs nach `dashboard/discovery-results/`.
- [ ] **Step 3:** Aus Q2 die Descriptor-IDs bestimmen und in
      `dashboard/discovery-results/DESCRIPTORS.md` festhalten (ID, Name laut
      `https://app-wallee.com/en-us/doc/api/label-descriptor/view/<ID>`, Beispielwerte,
      Abdeckung in % der Attempts, pro Kanal):
      Issuer-Land · Kartentyp Business/Privat · Funding Debit/Credit · 3DS-Status ·
      3DS Liability Shift. Für jeden: Mapping Rohwert → normalisierter Wert (SPEC §3.1).
- [ ] **Step 4:** Aus Q1 die tatsächlichen Werte von `ca.state` und `ca.environment`
      notieren; aus Q6 die Betragsspalte; aus Q4 die Top-Failure-IDs.
- [ ] **Step 5:** SPEC §3.1/§6.3 mit den konkreten IDs und Mappings aktualisieren. Findet
      sich für ein Attribut **kein** Descriptor (z. B. Kartentyp bei einem Connector), den
      KPI in SPEC als «nur wenn Label vorhanden» markieren — der Report zeigt dann
      100 % UNKNOWN mit Hinweistext, nicht nichts.

**Stand 2026-08-28 — Task 0 abgeschlossen** (POS Space 40402 + E-Com Space 12622, Juli
2026). Alle Konstanten stehen in SPEC §6.3, Herleitung und Wertemengen in
`discovery-results/DESCRIPTORS.md`. Wichtigste Befunde für die Implementierung:
Map-Keys sind descriptorabhängig (`countryContent`, `dateTimeContent`, `longTextContent`);
3DS wird aus Started/CAVV-Existenz abgeleitet (keine Status-/Liability-Labels);
`ca.tokenversion_id` ist immer NULL → Pan Type statt dessen; Authorization Method ist
unbrauchbar (ein Static-Value); Card Holder Name `1456765000789` ist PII und tabu.
Referenzwerte für SPEC §8: POS 12'537 Attempts / 98.6 %, E-Com 1'855 / 91.3 %,
3DS-Akzeptanz 281/310.

---

### Task 1: SQL — `buildReportingQuery`

**Files:** `wallee_query_builder.html` (neben `buildSettlementQuery`),
`test/reporting-queries.test.js`, `dashboard/sql/01_reporting_reference.sql`.

**Interface:** `buildReportingQuery({ spaceIds, start, end, channels, byTerminal, terminalIds })`
→ SQL-String. `channels` ⊆ `['POS','ECOM']` (leer/undefined = beide). `byTerminal` fügt
im DIM-Block `terminal_identifier`/`terminal_name` über `paymentterminal` hinzu (nur POS-
Zeilen befüllt); `terminalIds` filtert wie `buildTerminalQuery` (leer = alle).

- [ ] **Step 1 — Failing Tests:** Assertions auf: `FROM chargeattempt ca`; Join
      `charge c ON c.id = ca.charge_id`; Join `transaction t ON t.id = c.transaction_id`;
      Brand über `pcc.id = ca.connectorconfiguration` (**nicht** `t.paymentconnector…`);
      Issuer Country über `['countryContent']`, 3DS Started über `['dateTimeContent']`,
      CAVV nur als `IS NOT NULL`-Existenz (der Wert darf nie im SELECT stehen);
      weder `1456765000789` (Card Holder Name) noch `1456765125779` (Masked Card) im SQL;
      Zeitfilter `ca.createdon >= TIMESTAMP` / `<`; `ca.environment = 'PRODUCTION'`;
      `spaceInClause` auf `ca.spaceid`; Kanal-Filter `ca.saleschannel IN (…)` mit den beiden
      Konstanten; alle Descriptor-IDs aus SPEC §6.3 im `filter(ca.labels, …)`-Muster; genau drei
      Vorkommen von `AS block` (`'DIM'`, `'TIME'`, `'CONV'`) und zwei `UNION ALL`;
      `COUNT(DISTINCT` im CONV-Block; `channels: ['POS']` erzeugt nur die POS-ID;
      `byTerminal: true` joint `paymentterminal pt`, `false` nicht; kein `lineitem`
      direkt im FROM/JOIN; 0 Spaces → `-1 -- BITTE` wie andere Modi.
- [ ] **Step 2 — Implementieren:** Konstanten (`SALES_CHANNEL_*`, `DESC_*`,
      `ATTEMPT_ENVIRONMENT`) neben `DESC_MASKED_CARD`. CTE `att` nach SPEC §3.1 (Label-
      Ausdrücke als kleine Helper `labelExpr(id)`), danach drei `SELECT … FROM att GROUP BY`
      mit identischer Spaltenliste (NULL-Platzhalter typisiert: `CAST(NULL AS varchar)`,
      `CAST(NULL AS date)`, `CAST(NULL AS integer)` — Athena verlangt gleiche Typen im
      UNION), `UNION ALL`, `ORDER BY block, channel, anzahl_attempts DESC`.
- [ ] **Step 3 — Regressionsschutz:** Bestehende Query-Tests unverändert grün.
- [x] **Step 4 — Referenz-SQL:** Die generierte Query für einen Beispiel-Space in
      `dashboard/sql/01_reporting_reference.sql` ablegen und **im Portal ausführen**
      (Sascha). Läuft sie nicht (Typfehler im UNION, Label-Syntax), hier fixen, bevor
      Task 2 beginnt. Ergebnis-CSV nach `dashboard/discovery-results/reporting_ref.csv`.
      **Erledigt am 2026-09-01** — beide Queries (`01` und die Terminal-Variante `01b`)
      liefen fehlerfrei über Spaces 40402 + 12622, Juli 2026; UNION-Typen und Label-Syntax
      halten, der Parser meldet 0 unbrauchbare Werte und 0 unbekannte Blöcke. Die
      Ergebnis-CSVs bleiben **gitignored** (Produktivdaten). Die Fixture
      `test/fixtures/reporting-beispiel.csv` ist **nicht** aus ihnen abgeleitet, sondern
      bleibt frei erfunden — nur ihre *Schreibweise* wurde daran angeglichen (das Repo ist
      öffentlich, gerundete Echtzahlen wären trotzdem Echtzahlen).
- [ ] **Step 5 — Commit:** `feat(reporting): buildReportingQuery mit DIM/TIME/CONV-Bloecken`

---

### Task 2: Parser — `parseReportingCsv`

**Files:** `wallee_query_builder.html` (neben `parseSettlementCsv`),
`test/reporting-model.test.js`, `test/fixtures/reporting-beispiel.csv`.

**Interface:** `parseReportingCsv(text)` → `{ rows: { dim:[], time:[], conv:[] } }` oder
`{ error: { message } }`. Beträge → 1e-8-Ganzzahlen (Muster Settlement-Parser),
Zählwerte → Integer, leere Dimensionen → `'UNKNOWN'` (nie `''`/`null` im Modell).

- [ ] **Step 1 — Failing Tests:** Pflichtspalten fehlen → `error`; Blöcke werden korrekt
      verteilt; `summe_betrag` `"1234.5"` → `123450000000`; leeres `issuer_country` →
      `'UNKNOWN'`; `tds_liability_shift` `"true"/"false"/""` → `true/false/null`;
      Fixture parst ohne Fehler und Zeilensumme stimmt.
- [ ] **Step 2 — Implementieren:** bestehenden CSV-Tokenizer wiederverwenden (der aus
      `parseSettlementCsv`, ggf. in Helper `csvZeilen(text)` herausziehen — **ohne**
      Verhaltensänderung für Settlement, Tests bleiben grün).
- [ ] **Step 3 — Commit:** `feat(reporting): parseReportingCsv`

---

### Task 3: Modell — `buildReportingModel` und Klassifikation

**Files:** `wallee_query_builder.html`, `test/reporting-model.test.js`.

**Interfaces:**
- `klassifiziereHerkunft(issuerCountry, merchantCountry)` → `'DOMESTIC'|'INTRA'|'INTER'|'UNKNOWN'`
- `istKartenBrand(brand)` → boolean (`KARTEN_BRANDS`-Regex)
- `buildReportingModel(rows, { merchantCountry, failureReasons })` → `{ kanaele: { POS, ECOM, OTHER }, zeitraum… }`;
  pro Kanal genau die Struktur aus SPEC §6.2; fehlender Kanal → `null`.

- [ ] **Step 1 — Failing Tests (aus handgerechneten Mini-Fixtures, nicht aus der grossen
      Fixture):**
      - Success Rate: 8 SUCCESSFUL, 2 FAILED, 1 PENDING → 80.0 %, `offen = 1`.
      - Brand-Verteilung: Anteile nach Anzahl und Betrag summieren auf 100 %; Wallet-Zeile.
      - Herkunft: `CH/CH → DOMESTIC`, `DE/CH → INTRA`, `GB/CH → INTRA`, `US/CH → INTER`,
        `UNKNOWN/CH → UNKNOWN`, `ch/CH → DOMESTIC` (Case-insensitiv), `DEU` → UNKNOWN.
      - Kartentyp: nur Karten-Brands zählen (TWINT-Attempt beeinflusst K5 nicht).
      - Ø-Betrag pro Währung: CHF und EUR getrennt, nie gemischt.
      - 3DS-Ableitung: `klassifiziereTds({ started, cavv, eci })` → AUTHENTICATED /
        FAILED_OR_ABANDONED / WALLET_CRYPTOGRAM / NOT_REQUESTED; Akzeptanz = AUTHENTICATED
        / (AUTHENTICATED + FAILED_OR_ABANDONED); Beispiel 7 started+cavv, 3 started ohne
        cavv, 2 nur eci, 3 nichts → Akzeptanz 70.0 %, Angefordert-Anteil 66.7 %.
      - Kartentyp: `NOT_SPECIFIED` → UNKNOWN (nicht PRIVATE); `WORLD_ELITE_BUSINESS` →
        BUSINESS; `CLASSIC` → PRIVATE.
      - Conversion (CONV): `tx_erfolgreich / tx_mit_attempt`; Retry-Rate =
        `anzahl_attempts / tx_mit_attempt` — der Nenner kommt ebenfalls aus CONV. Die
        ursprünglich vorgesehene DIM-Spalte `anzahl_transaktionen` gibt es nicht mehr:
        `COUNT(DISTINCT transaction_id)` ist über DIM-Tupel hinweg nicht summierbar.
      - Failure-Top-10: sortiert, Name aus `failureReasons[id]`, Fallback `#<id>`.
      - Verlauf: Tage lückenlos (fehlende Tage im Zeitraum mit 0), Stunden 0–23.
      - Terminal-Zeilen nur im POS-Kanal.
- [ ] **Step 2 — Implementieren.** Prozentwerte im Modell als Zahl (0–100, eine
      Nachkommastelle erst in der Ausgabe), Beträge in 1e-8-Einheiten.
- [ ] **Step 3 — Commit:** `feat(reporting): Modell und Herkunfts-/Kartenklassifikation`

---

### Task 4: Export-Blöcke — `reportingExportBloecke`

**Files:** `wallee_query_builder.html` (neben `settlementExportBloecke`),
`test/reporting-export.test.js`.

**Interface:** `reportingExportBloecke(modell, { zeitraum, spaces })` → Array von Blöcken
`{ titel, kopf:[], zeilen:[][], typ:'tabelle'|'kacheln'|'balken' }` in fester Reihenfolge:
Titelblock → Kacheln → K2/K3/K4 (eine Tabelle: Brand · Attempts · Anteil · Erfolg % ·
Failure % · Betrag · Ø) → K5 → K6 (+ Top-10 Länder) → P1/E1/E2 → K8/E5 → E3/E4 → K9 →
P2 (Terminals) → K10 Verlauf → Stunden. Pro Kanal ein Block-Set (Kanal-Titel voran).

- [ ] **Step 1 — Failing Tests:** Reihenfolge und Titel; Kanal ohne Daten erzeugt
      Hinweisblock statt leerer Tabellen; Zahlen als Zahlen (nicht formatierte Strings)
      in `zeilen`, damit XLSX echte Zahlen bekommt; Prozent als Zahl mit `format:'pct'`-
      Marker in `kopf`.
- [ ] **Step 2 — Implementieren.** `formatZahlCH`/`formatAmountCH` **nicht** hier, nur in
      den Ausgaben (Screen/PDF) — XLSX bekommt Rohzahlen + Zahlformat.
- [ ] **Step 3 — Commit:** `feat(reporting): Export-Bloecke`

---

### Task 5: UI — Modus, Panels, Wiring, drei Ausgaben

**Files:** `wallee_query_builder.html` (Markup, CSS, `setMode`, `generate`,
`submitUndReport`/`holeErgebnisInReport`, Render, XLSX, PDF, CSV-Import),
`test/dom-ids.test.js`, `test/betriebsmodus.test.js`, `test/report-render.test.js`
(falls dort ein Render-Muster ohne DOM existiert — sonst nur Blöcke testen).

- [ ] **Step 1 — State:** `reportingChannel:'BOTH'`, `reportingMerchantCountry:'CH'`,
      `reportingByTerminal:false`; Whitelist `['brand','terminal','export','card','settlement','reporting']`;
      Test in `betriebsmodus.test.js`: alter State ohne Felder bekommt Defaults, Modus
      `reporting` überlebt Reload.
- [ ] **Step 2 — Markup:** Mode-Button `data-mode="reporting"`; `reportingSection`
      (Kanal-Radios `reportingChannelPos/Ecom/Both`, Input `reportingMerchantCountry`,
      Checkbox `reportingByTerminal`, Hinweis Zeitfilter); `reportingReportSection`
      (`reportingStatus`, `reportingReportOutput`, `reportingReportActions` mit Buttons
      `reportingXlsxBtn`, `reportingPdfBtn`, `reportingCsvBtn`, File-Input
      `reportingCsvImport`). `dom-ids.test.js` prüft statisch, dass jede per
      `getElementById` referenzierte ID im Markup existiert — nur ausführen, nichts eintragen.
- [ ] **Step 3 — `setMode`:** Space-Panel sichtbar; Terminal-Panel nur bei
      `reportingByTerminal && Kanal ≠ ECOM`; Spalten-/Karten-/Settlement-Panels aus;
      beide Reporting-Panels an.
- [ ] **Step 4 — `generate`:** Modus `reporting` ruft `buildReportingQuery` mit State.
- [ ] **Step 5 — API-Pfad:** Nach erfolgreichem Submit `ingestReportingCsv(csv)` (Muster
      `ingestSettlementCsv`): parse → Failure-Reason-Namen via `proxyJson('/failure-reasons')`
      (Fehler → `{}`) → Modell → Status → Render. CSV-Import-Button im Kopieren-Modus
      ruft denselben Ingest.
- [ ] **Step 6 — Render:** Kacheln + Tabellen aus den Blöcken; Balken als inline-SVG
      (Helper `svgBalken(werte, {breite, hoehe})` — reine Funktion, Test: gibt `<svg`
      mit n `<rect` zurück, Skalierung 0–max). Farben nur über CSS-Variablen
      (`--accent`, `--accent-dark`, `--muted`, `--danger`).
- [ ] **Step 7 — XLSX/PDF/CSV:** `exportReportingXlsx` (ein Blatt pro Kanal, Muster
      `exportSettlementXlsx`, gebrandeter Titel, Prozent-Zahlformat `0.0"%"`),
      `exportReportingPdf` (Muster `exportSettlementPdf`), Roh-CSV-Download.
- [ ] **Step 8 — Verlauf:** History-Eintrag mit `mode:'reporting'` — Verlaufszeile bietet
      wie Terminal/Settlement nur Roh-CSV; Excel/PDF laufen über das Report-Panel.
- [ ] **Step 9 — Manuell im Browser prüfen** (API-Modus gegen echten Space): alle Panels,
      Kanalwechsel, Export öffnen. Screenshot nach `dashboard/discovery-results/`.
- [ ] **Step 10 — Commit:** `feat(reporting): Modus Reporting mit Report-Panel und Exporten`

---

### Task 6: Proxy — `GET /failure-reasons`

**Files:** `wallee-proxy.mjs`, `test/proxy.test.js`.

- [ ] **Step 1 — Endpunkt verifizieren:** In der Web-Service-Doku
      (<https://app-wallee.com/doc/api/web-service>) den Failure-Reason-Service suchen;
      Kandidaten `GET /api/v2.0/failure-reasons` (v2) oder `GET /api/failure-reason/all`
      (v1). Mit den hinterlegten Zugangsdaten per `curl` gegen den Proxy-JWT-Pfad testen
      (Muster `/terminals`). Ergebnisform (Liste mit `id`, `name` (map, `en-US`),
      `category`) in `CLAUDE.md` festhalten.
- [ ] **Step 2 — Failing Test:** Route-Erkennung `GET /failure-reasons` → `{ name:
      'failure-reasons' }`; unbekannte Methode → 404 wie bisher.
- [ ] **Step 3 — Implementieren:** Aufruf mit Cursor-/Offset-Paginierung wie
      `/terminals`, Antwort `{ "<id>": "<en-US name>" }`, In-Memory-Cache pro
      Prozesslaufzeit, Fehler → HTTP 502 mit `fehler`-Text (App fällt auf IDs zurück).
      Kein Space-/Account-Header nötig, falls die API ihn nicht verlangt — sonst wie
      `/terminals` den Account aus den Credentials mitgeben.
- [ ] **Step 4 — Commit:** `feat(proxy): /failure-reasons mit Cache`

---

### Task 7: Doku, Version, Abnahme

**Files:** `CLAUDE.md`, `README.md`, `wallee_query_builder.html`, `wallee-proxy.mjs`.

- [ ] **Step 1 — `CLAUDE.md`:** «Fünf Modi» → «Sechs Modi» mit Abschnitt `reporting`
      (Attempt-Basis, Zeitfilter `ca.createdon`, Environment-Filter, Blöcke, Konstanten,
      Descriptor-IDs mit Fundstelle Task 0, Herkunfts-Logik, Grenzen: keine Chargebacks,
      kein DCC, Labels connectorabhängig); Proxy-Route; `setMode`-Sichtbarkeiten;
      State-Felder; Test-Dateien; Wallee-Referenzwissen um die Task-0-Befunde ergänzen
      («bisher beobachtet», Space/Zeitraum nennen).
- [ ] **Step 2 — `README.md`:** Modus-Tabelle und Kurzbeschreibung Reporting inkl.
      CSV-Import im Kopieren-Modus.
- [ ] **Step 3 — Version** `5.11.0` an allen drei Stellen + Proxy; Self-Update-Test grün.
- [x] **Step 4 — Fachliche Abnahme nach SPEC §8** (Sascha): **erledigt am 2026-09-02**,
      Nachweis in `dashboard/discovery-results/ABNAHME.md` (gitignored, nennt die echten
      Zahlen je Marke). Der Referenzlauf vom 2026-09-01 deckt §8.1, §8.2, §8.4 und §8.6
      (Attempt-Summe und Success Rate reproduzieren die Task-0-Werte, die Herkunfts-Eimer
      summieren exakt auf die Kartenbasis). **§8.5 war keine offene Prüfung, sondern ein
      Widerspruch in der Spec** — sein Nenner meinte
      `AUTH + FAILED_OR_ABANDONED + WALLET_CRYPTOGRAM` (am Lauf 281/423 = 66.4 %), §4.3
      dagegen `AUTH / (AUTH + FAILED_OR_ABANDONED)` (281/310 = 90.6 %, was der Code
      rechnet und §4.3 selbst zitiert); SPEC §8.5 ist auf §4.3 korrigiert, die
      Doppelzählungs-Hälfte ist erfüllt und geprüft.
      **§8.3 ist gegengerechnet:** `brand`-Modus über dieselben Spaces 40402 + 12622,
      Juli 2026, Zahlungsmittel-Verteilung nach Betrag für die erfolgreichen Attempts.
      **E-Commerce exakt (0.000 %), POS −1.102 %, beide Spaces zusammen −0.594 %**;
      Trinkgeld-Differenz in derselben Grössenordnung und Richtung. Abweichungen je Marke
      klein und beidseitig, mehrere Marken exakt; **eine Marke fehlt im Reporting ganz**
      (abweichende Schreibweise, Brand-Herkunft aus `ca.connectorconfiguration`, §3.1).
      **Ursache: die verschiedenen Zeitstempel** (`reporting` auf `ca.createdon`,
      `brand` auf `t.completedon`) — am POS
      fallen Autorisierung und Verbuchung auseinander (Trinkgeld-Anpassung, Tagesabschluss),
      im E-Commerce nicht; **genau diese Kanal-Asymmetrie ist der Beleg**. Daneben der
      Statusfilter von `brand` und die Brand-Herkunft aus `ca.connectorconfiguration`
      statt `t.paymentconnectorconfiguration_id` (§3.1). **Nicht** transaktionsweise
      zurückverfolgt — belegt sind Richtung, Grössenordnung, Asymmetrie und Mechanismus;
      ein Monat, zwei Spaces, ein Acquirer.
      **Praktische Folge:** der Reporting-Report ist **kein Umsatz-Abstimmungswerkzeug**
      (dafür `brand`/`settlement`) — er misst Zahlungsversuche.
- [ ] **Step 5 — Commit + Merge:** `docs(reporting): CLAUDE.md/README, Version v5.11.0`

---

## Reihenfolge und Abhängigkeiten

```
Task 0 (Discovery, Sascha) ──► Task 1 (SQL) ──► Task 2 (Parser) ──► Task 3 (Modell)
                                                                       │
Task 6 (Proxy) ────────────────────────────────────────────────────────┼──► Task 5 (UI)
                                                       Task 4 (Blöcke) ┘        │
                                                                                ▼
                                                                          Task 7 (Doku)
```

Task 6 ist unabhängig und kann parallel zu 1–4 laufen. Task 1 Step 4 (Referenz-Query im
Portal) ist der zweite Punkt, an dem Sascha gebraucht wird — danach läuft alles ohne
Rückfrage bis zur Abnahme.

## Nicht-Ziele (v5.11)

Vorperioden-Vergleich, Chargebacks, DCC, Billing-Land-Abgleich, Benchmarks — siehe
SPEC §4.4. Kein Chart-Vendor. Keine Änderung der Zeitfilter-Semantik der anderen Modi.
