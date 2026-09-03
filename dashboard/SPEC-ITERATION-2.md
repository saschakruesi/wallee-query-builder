# Reporting-Modus — Iteration 2: Ablehngründe im Klartext, Kuchendiagramme, 3DS-Failure-Seite, Security-Daten

Datum: 2026-09-03 · Basis: v5.11.0 (Commit `0f22b13`) · Zielversion: **v5.12.0** · Status: **Spezifikation, bereit für Claude Code**

Ergänzt `dashboard/SPEC.md` (v5.11). Was hier nicht steht, gilt unverändert aus SPEC.md und CLAUDE.md
(Charge-Attempt-Basis, `ca.createdon`, PII-Sperrliste, reine Funktionen, vier Ausgaben aus
einer Blockquelle, keine Chart-Vendoren).

## 0. Ausgangslage

Der erste Referenz-Report mit einem echten Händler-Space (Report `reportingreport_20260903.pdf`,
Space 16853, E-Com, CHF, 01.07.–03.09.2026, 9'373 Attempts, Success Rate 90.7 %) zeigt vier
Lücken, die dieser Iteration den Auftrag geben:

1. **Ablehngründe ohne Namen.** 6 von 10 Zeilen im Block «Ablehngründe» und 9 Zeilen in
   «Ablehngründe je Brand» tragen nur `#<id>`; 7 weitere Einträge sind gar nicht dargestellt.
   Der Block «Ablehncodes» besteht zu 91.4 % aus `UNKNOWN`.
2. **Keine Verteilungsgrafik.** Anteile stehen nur als Prozentspalte in Tabellen.
3. **3-D Secure Failure ist mit 33.6 % der grösste Ablehngrund** (293 von 872), bei Mastercard
   78 %, bei Visa 81 % aller Fehlschläge — und der Händler kann die betroffenen Versuche
   weder sehen noch exportieren noch im wallee-Dashboard öffnen.
4. **Ein zweiter Händler-Space («Referenzfall B», E-Com, ~85'000 Attempts in 65 Tagen)
   zeigt dasselbe Muster in grösserem Massstab:** 3-D Secure Failure ist mit **64.8 % aller
   Fehlschläge** (8'157 von 12'588) der Ablehngrund, bei Mastercard 80 %, bei Visa 77 %;
   23 Ablehngründe sind nicht dargestellt, 82.9 % der Ablehncodes `UNKNOWN`. Der Händler hat
   per Support-Anfrage genau die Fragen gestellt, die der Report heute nicht beantwortet:
   (a) Aufschlüsselung der 3DS-Fehlschläge nach Challenge-Status-Grund (vom Karteninhaber
   abgebrochen / Authentifizierung fehlgeschlagen / Timeout) und nach ACS bzw. Issuer,
   (b) wie sich die Frictionless-Quote erhöhen lässt (welche Kundendaten fehlen bei der
   Transaktionserstellung?), (c) was «Die Transaktion wurde bestätigt, allerdings wurde die
   Verarbeitung nie gestartet» bedeutet. Seine Stichprobe im wallee-Backend zeigt für einen
   einzelnen Versuch ACS-Name, Challenge-Status `N`, Grund `01 = Card authentication failed`
   und Abbruch-Indikator `01 = Cardholder selected 'Cancel'` — diese Felder **existieren**
   also, der Report zeigt sie nur nicht. Alle Angaben zum Fall (Space-ID, Händler,
   Volumen, E-Mail-Wortlaut, zweiter Report) stehen **nicht hier, sondern in
   `dashboard/discovery-results/FALL-B.md`** (gitignored — das Repo ist öffentlich). §5
   beantwortet, was der Report liefern kann und was nicht.

Die Rechercheergebnisse (§1.1, §4) sind an der öffentlichen wallee-Dokumentation verifiziert,
Stand 2026-09-03; die beiden Kataloge liegen als JSON bei (`dashboard/catalog/`).

## 1. Ablehngründe im Klartext (K8, E5 — überarbeitet)

### 1.1 Befund: Der Katalog ist öffentlich und vollständig ablesbar

CLAUDE.md («Ablehngründe: statisch, und warum») hält fest, dass es keinen
Failure-Reason-Dienst in der Web-Service-API gibt — das bleibt richtig. **Der daraus gezogene
Schluss «Doku-Liste ohne IDs, als Datenquelle unbrauchbar» ist hingegen widerlegt:**

- `GET https://app-wallee.com/en-us/doc/api/failure-reason/view/<id>` ist **öffentlich, ohne
  Login**, antwortet HTTP 200 mit HTML. Name, ID und Kategorie stehen in
  `<div class="maintitle">`, `<div class="subtitle">` (`#<id> <separator> <Kategorie>`), die
  Beschreibung in `<div class="documentation-panel-description">`; zusätzlich steht der
  Name im `<title>` (`Failure Reason - <Name>`). Eine **unbekannte ID** antwortet ebenfalls
  200, aber mit der Login-Seite (`<title>Log in`, kein `maintitle`) — der Parser muss auf
  `maintitle` prüfen, nicht auf den Statuscode.
- `GET https://app-wallee.com/en-us/doc/api/failure-reason/list?page=<n>` liefert 20
  Einträge pro Seite, **mit ID**: jede Zeile ist
  `<tr data-grid-action="view/<id>" data-entity-name="<Name>">`, darin
  `<div class="description">…</div>` und die Kategorie als letzte `<td>`. 113 Seiten
  (`page=113` → 14 Zeilen) ergeben **2'254 Einträge = Gesamtzahl der Seite**. Ein
  Limit-Parameter wird nicht angenommen (`limit`, `perPage`, `pageSize`, … alle ignoriert).
  Dieselbe Liste unter `de-de/` liefert deutsche Namen (Qualität durchwachsen:
  «Security Decline» → «Rückgang der Sicherheit»; «3-D Secure Failure» → «3-D Secure
  fehlgeschlagen» ist brauchbar). **Kanonisch ist der englische Name**, der deutsche ist
  Zusatz.
- `label-descriptor/list` funktioniert identisch (755 Einträge, 38 Seiten) und liefert
  Gruppe, Name, Typ, Gewicht — das ist die Quelle für §4.2.

Beide Kataloge sind gescrapt und liegen im Repo:

| Datei | Inhalt |
|---|---|
| `dashboard/catalog/failure-reasons.json` | `{ "<id>": { name, category, description, name_de, description_de } }`, 2'254 Einträge. Kategorien: Configuration 867, End User 768, Internal 454, Temporary Issue 127, Developer 38. |
| `dashboard/catalog/label-descriptors.json` | `{ "<id>": { group, name, type, weight, description } }`, 755 Einträge. |
| `dashboard/tools/scrape_wallee_catalogs.py` | Der Scraper (Python 3, nur Standardbibliothek): `python3 scrape_wallee_catalogs.py failure-reason en-us`. Für die Aktualisierung; ein Node-Port ist nicht nötig, die Kataloge ändern sich selten. |

### 1.2 Die IDs aus den beiden Reports vom 03.09.2026 (alle aufgelöst)

| ID | Name (en) | Kategorie | Bedeutung für den Händler |
|---|---|---|---|
| `1568360440179` | 3-D Secure Failure | End User | Authentifizierung fehlgeschlagen oder abgebrochen |
| `1568360434240` | 3-D Secure Timeout | End User | Challenge nicht rechtzeitig abgeschlossen (Schwester-ID, im Referenz-Space nicht beobachtet, aber derselbe Connector) |
| `1460695272591` | Cancellation Initiated by User | End User | Kunde hat abgebrochen (TWINT-typisch) |
| `1460695272599` | Transaction declined. | End User | Acquirer hat abgelehnt |
| `1000009999999` | Authorization canceled by scheme. | Internal | Scheme (TWINT) hat die Autorisierung aufgehoben |
| `1553239734976` | Authorization Declined | End User | Issuer hat abgelehnt |
| `1758896451165`, `1758896189449` | Security Decline (zwei IDs, gleicher Text) | End User | **Issuer-Fraud-/Security-System hat blockiert; nicht wiederholen, nicht ausliefern** — in beiden Spaces ausschliesslich Mastercard |
| `1758896220795` | Life Cycle Decline | End User | Karte dauerhaft ungültig (verloren/gestohlen/deaktiviert); nicht wiederholen |
| `1675956162243` | Checkout Id Expired | End User | Checkout-ID abgelaufen (PostFinance Pay: 9 von 21 Fehlschlägen = 43 %) |
| `1553239772995` | Suspicion of Manipulation | End User | Verdacht auf Manipulation — in beiden Spaces ausschliesslich Visa |
| `1531373451516` | Transaction Authorization Timed Out | Configuration | Autorisierung nicht innert Frist abgeschlossen — bei PostFinance E-Finance **77 %** und PostFinance Card **62 %** der Fehlschläge in Referenzfall B: der Kunde schliesst den E-Finance-Login nicht ab. **Die Kategorie «Configuration» ist hier irreführend** (das ist Kundenverhalten); §1.3 Punkt 2 führt deshalb eine Override-Tabelle |
| `1531373420464` | Withdrawal Limit Exceeded | End User | Bezugslimite der PostFinance-Karte überschritten |
| `1531373394895` | Transaction Authentication Failed | Configuration | PostFinance-Authentifizierung fehlgeschlagen (ebenfalls Kundenverhalten, Override) |
| `1531373398963` | Authorization Failed | Configuration | PostFinance: ohne spezifischen Grund |
| `1586248831896` | User Authorization Timed Out | End User | Kunde hat die Zahlung nie freigegeben (PostFinance Pay / App) |
| `1675958152135` | Process rejected | Configuration | Funktionaler Fehler beim Processor (PostFinance Pay) |
| `1532355373702` / `…703` / `…706` | Authorization Declined / Invalid Card / Card Expired | End User | American-Express-Connector, eigene IDs für dieselben Aussagen |
| `1553239789832` | Unexpected Failure | Internal | Unbekannter Fehler, an wallee melden |
| `1000000000065` | Soft Decline | End User | **Issuer verlangt 3DS** (Autorisierung ohne Authentifizierung versucht) — im Report noch nicht beobachtet, aber die Schlüssel-ID für die Frage «warum wird bei nicht angeforderter 3DS abgelehnt» (§5.4) |
| `1553239765055` | Card Expired | End User | Karte abgelaufen |
| `1454390669106` | Unexpected payment attempt | Internal | Unerwarteter Fehler beim Versuch |
| `1553239810659` | Communication Error | Temporary Issue | Kommunikationsfehler wallee ↔ Processor |
| `1562045949960` | Configuration Error | Configuration | **Setup-Problem beim Acquirer** — gehört nicht zum Kunden, sondern auf den Tisch von wallee/Acquirer |
| `1580367235835` | Processing not Initiated | Developer | «Die Transaktion wurde bestätigt, allerdings wurde die Verarbeitung nie gestartet» — Transaktions-, nicht Attempt-Ebene, siehe §5.3 |
| `1580367235834` | Transaction Timed Out | End User | Transaktion vor Bestätigung ausgelaufen — Transaktions-Ebene, siehe §5.3 |

Die POS-IDs `1579281555663` (Transaction declined) und `1579281542342` (Automatically cancelled)
bleiben wie in DESCRIPTORS.md.

### 1.3 Umsetzung

**Ziel:** Kein `#<id>` mehr im Report, in keiner der vier Ausgaben, auch nicht im
Kopieren-Modus.

1. **`FAILURE_REASONS` wird aus dem Katalog generiert, nicht mehr von Hand gepflegt.**
   Build-Schritt `node tools/build-failure-reasons.mjs` (neu, klein) liest
   `dashboard/catalog/failure-reasons.json` und schreibt die Konstante als kompaktes
   Objekt `{ "<id>": ["<name>", "<kategorie-kürzel>"] }` in einen markierten Block der
   HTML-Datei (Marker-Kommentare `/* FAILURE_REASONS:BEGIN */ … /* :END */`, dasselbe
   Muster wie der Self-Update-Mechanismus für die Versionsnummer). Umfang: 2'254 Einträge ×
   ~55 Zeichen ≈ **120 KB** im HTML (1.25 → 1.37 MB). **Entscheid:** das ist der Preis für
   «kein `#<id>`, auch offline im Kopieren-Modus» und wird in Kauf genommen; Alternative wäre
   die Proxy-Route (Punkt 3), die im Kopieren-Modus nicht zur Verfügung steht. Wer die
   Datei klein halten will, kann den Block auf die Kategorien `End User`, `Temporary Issue`,
   `Internal` beschränken (1'349 Einträge) — `Configuration`/`Developer` sind
   Integrationsfehler, die im Händler-Report selten sind; **bei dieser Variante bleibt die
   Proxy-Route Pflicht** und die eingebettete Tabelle ist nur Fallback. Empfehlung: voll
   einbetten, Proxy-Route trotzdem bauen (Punkt 3), weil sie neue IDs abdeckt, die nach dem
   Build dazukommen.
2. **Kategorie als neue Dimension — mit Override.** Das Modell führt je FAILED-Attempt
   zusätzlich `failure_category` ∈ `END_USER | TEMPORARY | CONFIGURATION | INTERNAL |
   DEVELOPER | UNKNOWN` (aus dem Katalog, clientseitig — die Query bleibt unverändert).
   **Die Katalog-Kategorie ist nicht immer fachlich richtig:** «Transaction Authorization
   Timed Out» (`1531373451516`) und «Transaction Authentication Failed» (`1531373394895`)
   stehen als «Configuration», sind aber Kundenverhalten. Deshalb eine kleine, kommentierte
   Override-Tabelle `FAILURE_CATEGORY_OVERRIDE = { '<id>': 'END_USER', … }` — nur für IDs,
   bei denen der Katalog belegt falsch liegt, mit Begründung im Kommentar. Neuer Block
   **«Ablehngründe nach Kategorie»** (Tabelle + Kuchen, §2): Anteil je Kategorie an allen
   FAILED. Das ist die Zeile, die dem Händler sofort sagt, ob das Problem beim Kunden
   (End User), beim Netz (Temporary) oder bei wallee/Acquirer (Configuration, Internal)
   liegt.
   **Erklärung und Empfehlung je Grund.** Der Block «Ablehngründe» bekommt zwei Spalten
   dazu: **«Bedeutung»** (die Katalog-Beschreibung, deutsch wo brauchbar, sonst englisch —
   im Bildschirm als Tooltip/zweite Zeile, im PDF/Excel als Spalte) und **«Empfehlung»**
   aus einer statischen Tabelle `FAILURE_ADVICE` für die ~25 häufigen IDs:
   `RETRY_OK` (Kunde kann es erneut versuchen: Cancellation, Timeout, Communication
   Error), `RETRY_NO` (nicht wiederholen: Security Decline, Life Cycle Decline, Suspicion
   of Manipulation, Card Expired), `OTHER_METHOD` (anderes Zahlungsmittel anbieten: Soft
   Decline → 3DS erzwingen, Withdrawal Limit), `CONTACT_WALLEE` (Configuration Error,
   Unexpected Failure, Process rejected). Unbekannte ID → leer, nie erfunden. Das ist die
   direkte Antwort auf «wir müssten bei den Failure Reasons mehr erklären können».
3. **Proxy-Route `GET /failure-reasons?ids=<id>,<id>,…`** (neu, ersetzt SPEC.md §6.4, das
   als «überholt» markiert war): holt je unbekannter ID die Doku-Seite
   `failure-reason/view/<id>` (**kein** Auth-Header, kein JWT, das ist keine API-Route —
   `rufeApi` nicht verwenden, sondern ein einfacher `fetch` gegen `app-wallee.com`), parst
   `maintitle`/`subtitle`/`documentation-panel-description`, cached im Prozess **und** in
   `failure-reasons.cache.json` neben dem Proxy (Referenzdaten). Unbekannte ID (Login-Seite)
   → `{ id, name: null }`, die App zeigt dann weiterhin `#<id>` — das bleibt der einzige
   Fall. Höchstens 50 IDs pro Aufruf, sequentiell mit 200 ms Abstand (Doku-Server, kein
   API-Vertrag). Die App ruft die Route nur für IDs auf, die in `FAILURE_REASONS` fehlen.
   Der Kommentar «Bitte den Endpunkt nicht erneut suchen» im Code bleibt stehen, bekommt
   aber den Zusatz, dass die Doku-Seite die Quelle ist.
4. **Alle Einträge anzeigen.** Die Beschränkung «Top 10» in K8 und «Top 5 je Brand» in E5
   fällt weg — der Rest wird als eine Zeile «Übrige (n Gründe)» zusammengefasst, damit die
   Anteile auf 100 % aufgehen. Die Fussnote «7 weitere Einträge sind nicht dargestellt»
   entfällt damit.
5. **Block «Ablehncodes»** (P6): `UNKNOWN` mit 91.4 % ist keine Information. Der Block wird
   im E-Com-Kanal nur gezeigt, wenn der Anteil bekannter Codes ≥ 25 % ist; sonst ein
   Hinweisblock «Ablehncodes · Der Processor liefert für diesen Space keinen Response Code
   (n von m Fehlschlägen ohne Code)». Am POS bleibt der Block, wie er ist.
6. **Doku nachziehen:** CLAUDE.md-Abschnitt «Ablehngründe» und SPEC.md §6.4 auf diesen
   Stand korrigieren (Befund 1.1 als Korrektur mit Datum, nicht als Streichung — das Muster
   der bisherigen Korrekturen).

**Tests:** `reporting-model.test.js` — Fixture mit den 16 IDs aus §1.2 → jede bekommt
Name und Kategorie; unbekannte ID → `#<id>`, Kategorie `UNKNOWN`; Kategoriesumme = FAILED.
`proxy.test.js` — Parser gegen zwei eingefrorene HTML-Fixtures (bekannte ID, Login-Seite),
Cache-Treffer ohne zweiten Fetch, `ids` mit Nicht-Zahl → 400.

## 2. Kuchendiagramme

### 2.1 Wo

Je Kanal ein Kuchen (Donut) **über** der zugehörigen Tabelle, im selben Block, für:

| Block | Anteil von | Bemerkung |
|---|---|---|
| Zahlungsmittel | Attempts je Brand **und** Betrag je Brand (zwei Kuchen nebeneinander) | Wallets stehen daneben, nicht im Kuchen (liegen quer, SPEC §4.1 K2) |
| Kartentyp | Business / Privat / Unbekannt | |
| Kartenherkunft | Domestisch / Intra / Inter / Unbekannt | |
| 3DS-Status | Authentifiziert / Fehlgeschlagen-abgebrochen / Wallet-Kryptogramm / Nicht angefordert | |
| Ablehngründe | Grund (Top 6 + «Übrige») | |
| Ablehngründe nach Kategorie (neu, §1.3) | Kategorie | |
| PAN-Quelle | pan_type | |
| Funding (POS) | Debit / Credit / Unbekannt | |

Nicht als Kuchen: Verlauf, Stunden, Terminals, Länder (Balken/Tabelle bleiben), Conversion.

### 2.2 Wie

- **Inline-SVG, kein Vendor** — wie `svgBalken`. Neue reine Funktion
  `svgKuchen(segmente, optionen)` → SVG-String; `segmente = [{ label, wert, anteil }]`
  (Anteile in Prozent 0–100, wie die Blöcke sie schon führen). Donut (Innenradius 55 %),
  Segmente ab 12° bekommen die Prozentzahl **im Segment**, kleinere nur in der Legende.
  Segmente unter 2 % werden in «Übrige» zusammengefasst, **bevor** gezeichnet wird (Modell,
  nicht Renderer), damit Tabelle und Kuchen dieselben Zahlen zeigen. Legende rechts:
  Farbe · Label · Wert · Prozent (`formatZahlCH`). Ein Segment mit 100 % ist ein voller
  Ring, kein Sonderfall. 0 Segmente → kein Kuchen (Block entfällt ohnehin).
- **Geometrie einmal, zwei Renderer.** `kuchenSegmente(segmente, r, rInnen)` liefert je
  Segment Start-/Endwinkel und die vier Bogenpunkte; daraus baut `svgKuchen` den SVG-Pfad
  (`A`-Befehle) **und** `pdfKuchen(doc, x, y, segmente)` zeichnet dieselben Segmente mit
  jsPDF-Vektorprimitiven (`doc.lines` mit Bezier-Segmenten, Bogen als kubische
  Bezier-Näherung, ≤ 90° pro Teilbogen). **Damit stehen die Kuchen auch im PDF** — anders
  als die Balken, die bewusst draussen blieben: kein Rasterbild, kein dritter Vendor, jsPDF
  kann Vektoren selbst. Die Balken bleiben, wie sie sind (kein Auftrag).
- **Farben:** Whitelist `SVG_KUCHEN_FARBEN` (Muster `SVG_BALKEN_FARBEN`, nur `var(--…)`),
  sechs Farben + Grau für «Übrige»/«Unbekannt»: wallee-Türkis `#11D9CC`, Orange `#FF4D00`,
  Schwarz `#111`, Türkis 55 %, Orange 55 %, Türkis 25 %; Grau `#9AA3A8`. **Feste
  Farbzuordnung für feste Kategorien** (Domestisch/Intra/Inter, Business/Privat,
  Authentifiziert/Fehlgeschlagen, Kategorien aus §1.3): dieselbe Kategorie hat in jedem
  Report dieselbe Farbe. Für offene Listen (Brands, Gründe) Reihenfolge nach Anteil.
  «Unbekannt» und «Übrige» immer Grau. Im PDF dieselben Hexwerte (Konstante mit beiden
  Darstellungen — CSS-Variable für den Bildschirm, Hex für jsPDF — an **einer** Stelle).
- **Excel:** kein Kuchen (SheetJS-Community kann keine Charts); die Tabelle trägt die
  Prozente. Hinweis in der Doku, kein Workaround.
- **Bildschirm:** Kuchen + Legende nebeneinander (`flex`, Umbruch < 640 px), Höhe 180 px;
  `aria-label` mit der Legende als Text.

**Tests:** `reporting-render.test.js` — Segmentwinkel summieren auf 360°, Anteile in
Legende = Modell, «Übrige» nur wenn nötig, 100 %-Fall, Farb-Whitelist (kein Inline-Hex
im SVG-Markup). `reporting-export.test.js` — PDF-Pfad ruft `pdfKuchen` je Kuchen-Block
genau einmal (Stub), Bezier-Näherung eines 90°-Bogens mit Toleranz.

## 3. Neue Seite «3DS-Failures» (Transaktionsliste mit Export und Dashboard-Link)

### 3.1 Was sie zeigt

Ein eigener Reiter im Reporting-Report (neben den Kanal-Reitern; nur wenn der E-Com-Kanal
Daten hat): **jeder gescheiterte Karten-Versuch, bei dem 3-D Secure angefordert wurde**,
als Zeile — mit Link ins wallee-Dashboard. Zweck: Der Händler (oder wallee-Support) klickt
sich vom Muster zur einzelnen Transaktion durch, exportiert die Liste für den Acquirer oder
den Shop-Betreiber, und sieht auf derselben Seite die Aufschlüsselungen, die ihm sagen,
**wo** die Challenge scheitert (Issuer-Land, Brand, 3DS-Version, Tageszeit, Dauer, Wiederholer).

### 3.2 Definition «3DS-Failure»

Ein Attempt zählt, wenn `attempt_state = FAILED` **und** (`failure_reason_id` ∈
`TDS_FAILURE_REASONS` **oder** `tds_status = FAILED_OR_ABANDONED`).
`TDS_FAILURE_REASONS = { 1568360440179 (3-D Secure Failure), 1568360434240 (3-D Secure
Timeout) }` — Konstante, erweiterbar; der Katalog kennt ~40 weitere connector-spezifische
3DS-Gründe (`dashboard/catalog/failure-reasons.json`, Suche nach «3-D»), die bei einem
anderen Acquirer relevant werden können. Die Zeile im Report nennt beide Kriterien, damit
klar ist, dass ein «3-D Secure Failure» ohne Started-Label (Connector schreibt nichts)
trotzdem drin ist und ein abgebrochener 3DS-Prozess mit anderem Grund ebenfalls.

### 3.3 Zweite Query: `buildReportingTdsQuery({ spaceIds, start, end })` — zeilenweise

Der Reporting-Modus setzt heute **eine** Aggregat-Query ab. Die 3DS-Seite braucht Zeilen
pro Attempt; das ist eine **zweite, separate Query** mit eigenem Token (Verlauf: zwei
Einträge, Typ `reporting` und `reporting-tds`), die die App nach der ersten automatisch
absetzt, wenn Kanal E-Com oder Beide gewählt ist. Aggregat und Liste bleiben getrennt,
damit das Aggregat-CSV weiterhin PII-frei ist und im Kopieren-Modus importierbar bleibt.

```
SELECT ca.spaceid AS space_id, ca.id AS attempt_id, t.id AS transaction_id,
       ca.createdon AS created_on, t.merchantreference AS merchant_reference,
       <brand>, <wallet>, t.currency, t.authorizationamount AS amount,
       ca.failurereason AS failure_reason_id,
       <labelExpr DESC_AUTH_RESPONSE_ECOM> AS response_code,
       <labelExpr DESC_ISSUER_COUNTRY,'countryContent'> AS issuer_country,
       <labelExpr DESC_CARD_TYPE> AS funding, <labelExpr DESC_CARD_CATEGORY> AS card_category,
       <labelExpr DESC_PAN_TYPE> AS pan_type, <labelExpr DESC_ECI> AS eci,
       <labelExpr DESC_TDS_VERSION,'staticValueContent'> AS tds_version,
       <labelExpr DESC_TDS_STARTED,'dateTimeContent'> AS tds_started_on,
       <labelExpr DESC_TDS_FINISHED,'dateTimeContent'> AS tds_finished_on,
       (tds_cavv IS NOT NULL) AS tds_cavv,
       -- §4.3: die folgenden nur, wenn Discovery Q2 sie für den Space belegt
       <labelExpr DESC_TDS_TRANS_STATUS> AS tds_trans_status,
       <labelExpr DESC_TDS_TRANS_STATUS_REASON> AS tds_status_reason,
       <labelExpr DESC_TDS_CHALLENGE_CANCEL> AS tds_challenge_cancel,
       <labelExpr DESC_TDS_ACS_REFERENCE> AS acs_reference,
       ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY ca.createdon) AS attempt_nr,
       COUNT(*) OVER (PARTITION BY t.id) AS attempts_der_transaktion
FROM chargeattempt ca JOIN charge c … JOIN transaction t … LEFT JOIN pcc/pc/wt …
WHERE <spaces> AND ca.createdon-Fenster AND ca.environment = 'PRODUCTION'
  AND ca.saleschannel = SALES_CHANNEL_ECOM AND ca.state = 'FAILED'
  AND (ca.failurereason IN (<TDS_FAILURE_REASONS>) OR (<tds_started> IS NOT NULL AND <tds_cavv> IS NULL))
ORDER BY ca.createdon DESC
LIMIT 20000
```

- Die Window-Funktionen zählen **alle** Attempts der Transaktion (auch erfolgreiche), dafür
  ein Sub-Select über `chargeattempt` ohne den `FAILED`-Filter — sonst zählt
  `attempts_der_transaktion` nur Fehlschläge. Die Spalte beantwortet die Frage aus der Support-Anfrage
  «mehrfach hintereinander gescheitert»: `attempts_der_transaktion ≥ 2` = Wiederholer;
  ob die Transaktion am Ende erfolgreich war, liefert `t.state` als Spalte
  `transaction_state` (FULFILL/COMPLETED = am Ende doch bezahlt, FAILED = aufgegeben).
- **PII-Regel bleibt strikt:** keine `1456765000789` (Card Holder Name), keine
  `1456765125779` (Masked Card Number), keine `1456765711187` (Expiry), keine
  `billingaddress*`, keine `customeremailaddress`, keine `customerid`. `merchantreference`
  ist die Bestellnummer des Shops (der Händler nennt sie selbst in seiner Anfrage) — sie
  bleibt drin, der Händler braucht sie zur Zuordnung. `tds_cavv` nur als Boolean.
- `LIMIT 20000` mit Statuszeile «n von maximal 20'000» — bei ~4'000 3DS-Fehlschlägen pro
  Monat (Referenzfall B) reicht das für 90 Tage knapp; die Grenze ist eine Konstante.
- Parser `parseReportingTdsCsv` nach dem Muster des Reporting-Parsers (Pflichtspalten,
  `unbrauchbareWerte`, wirft nie); Timestamps als ISO-Strings.

### 3.4 Dashboard-Link

`https://app-wallee.com/s/<space_id>/payment/transaction/view/<transaction_id>` — verifiziert
2026-09-03: die Route existiert (ohne Login Redirect auf `/user/login?target=…` mit genau
diesem Ziel; ein erfundener Pfad wie `/payment/charge-attempt/view/<id>` antwortet 404).
Es gibt **keine Attempt-Detailseite** — der Link zeigt die Transaktion, auf der das Dashboard
alle Versuche mit ihren 3DS-Details listet. Link in der Tabelle als «Öffnen» (neuer Tab,
`rel="noopener"`), im CSV/Excel als eigene Spalte `dashboard_url` (Excel: Hyperlink-Zelle),
im PDF nicht (zu lang; die Transaktions-ID steht in der Tabelle).

### 3.5 Aufbau der Seite

1. **Kacheln:** 3DS-Failures gesamt · Anteil an allen FAILED · Anteil an allen
   Karten-Attempts mit 3DS-Anforderung · betroffenes Volumen (Summe `amount` je Währung) ·
   Wiederholer-Anteil (`attempts_der_transaktion ≥ 2`) · am Ende doch bezahlt (Anteil
   Transaktionen mit `transaction_state` ∈ FULFILL/COMPLETED).
2. **Aufschlüsselungen** (Tabelle + Kuchen, §2), alle Anteile an den 3DS-Failures:
   - **Grund**: Failure / Timeout / anderer Grund mit abgebrochenem 3DS — und, wenn
     Discovery §4.3 die Labels belegt, **Challenge-Status-Grund** (`tds_status_reason`,
     EMVCo-Codes `01`…`26`, Namenstabelle `TDS_STATUS_REASONS` statisch, ~26 Einträge —
     genormter Katalog wie `ISO_RESPONSE_CODES`) und **Abbruch-Indikator**
     (`tds_challenge_cancel`, `01` = Cardholder selected Cancel, `04` = Transaction
     Timed Out, `07`/`08` = ACS/DS Timeout, … Tabelle `TDS_CHALLENGE_CANCEL`).
   - **Dauer bis zum Abbruch**: `tds_finished_on − tds_started_on` in Eimern
     < 10 s (sofort abgebrochen, typisch: Kunde hat keine App/kein Gerät zur Hand) ·
     10–60 s · 1–5 min · > 5 min (Timeout) · unbekannt. Diese Achse ersetzt die
     Challenge-Status-Aufschlüsselung, wenn die Labels fehlen — sie trennt «sofort
     Abbruch» von «Timeout» ohne Connector-Details.
   - **Betrag** in Eimern (< 50 / 50–200 / 200–500 / > 500, je Währung), **ECI** (§3.7),
     **3DS-Ablauf** (§3.6).
   - **Brand**, **Issuer-Land** (Top 10; das ist die Issuer-Achse, die ohne BIN-Tabelle
     möglich ist, §5.1), **3DS-Version** (`tds_version` über `static-values` auflösen —
     der Wert ist eine Static-Value-ID, Task 0b), **PAN-Quelle**, **ACS** (nur mit
     Labels, §4.3), **Stunde**, **Tag** (Balken wie Verlauf — zeigt, ob ein Issuer-Ausfall
     dahintersteckt).
3. **Tabelle** (alle Zeilen, ab 50 in `<details>`, Filter-Feld über Brand/Land/Grund/
   Referenz): Datum · Transaktion · Referenz · Brand · Wallet · Betrag · Grund ·
   Dauer · Versuch n/m · Endstand Tx · Issuer-Land · Öffnen.
4. **Export:** CSV und Excel (eigenes Blatt «3DS-Failures», Hyperlink-Spalte), PDF
   (Kacheln + Aufschlüsselungen; die Zeilentabelle nur bis 500 Zeilen, darüber Hinweis
   «Vollständige Liste im Excel/CSV»).

### 3.6 3DS-Ablauf: Frictionless / Challenge / Abgebrochen — als eigene Dimension

Der heutige `tds_status` (Started ∧ CAVV) sagt nur «authentifiziert oder nicht». Der
Händler will wissen, **ob überhaupt eine Challenge verlangt wurde**. Neue Klassifikation
`tds_flow` je Karten-Attempt, vorrangig aus den EMVCo-Labels (§4.2), mit Rückfall:

| `tds_flow` | Bedingung (Vorrang von oben nach unten) | Bedeutung |
|---|---|---|
| `FRICTIONLESS` | Transaction Status (`1611157230835`) = `Y`/`A` **und** kein Challenge-Label (`Challenge Active`/`Challenge Mandate` = false bzw. fehlend) — Rückfall ohne Labels: Started ∧ CAVV ∧ Dauer < 3 s | Issuer hat ohne Kundeninteraktion freigegeben |
| `CHALLENGE_OK` | Challenge-Label vorhanden **und** Status `Y` (bzw. Rückfall: Started ∧ CAVV ∧ Dauer ≥ 3 s) | Kunde hat die Challenge bestanden |
| `CHALLENGE_FAILED` | Challenge-Label vorhanden, Status `N`/`R`, Challenge Cancel leer | Kunde hat die Challenge nicht bestanden (falscher Code, Frequenzlimit) |
| `CHALLENGE_CANCELLED` | Challenge Cancel (`1611161612971`) gesetzt | Kunde/System hat abgebrochen — **die Achse aus der Support-Anfrage** |
| `CHALLENGE_TIMEOUT` | Challenge Cancel ∈ {`03`,`04`,`05`,`08`} oder Failure Reason 3-D Secure Timeout | nicht rechtzeitig abgeschlossen |
| `ATTEMPTED` | Status `A` (Attempts-Flow: Issuer/ACS nicht erreichbar, Scheme haftet) | |
| `UNAVAILABLE` | Status `U` | ACS nicht verfügbar |
| `WALLET_CRYPTOGRAM` | wie heute | |
| `NOT_REQUESTED` | wie heute | |
| `UNKNOWN` | 3DS gestartet, aber weder Status noch CAVV noch Dauer lesbar | |

Die Dauer (`tds_finished_on − tds_started_on`) ist der **Rückfall**, wenn der Connector
die EMVCo-Labels nicht schreibt: eine Frictionless-Freigabe dauert Sekundenbruchteile,
eine Challenge mindestens einige Sekunden — die Schwelle `TDS_FRICTIONLESS_MAX_SEK = 3`
ist eine Konstante und im Report als Näherung ausgewiesen. Ausgewiesen wird `tds_flow`
als Block **«3DS-Ablauf»** (Tabelle + Kuchen) im E-Com-Kanal **mit Erfolgsquote je
Zeile** — Frictionless-Quote = `FRICTIONLESS / (alle mit angeforderter 3DS)`, das ist die
Kennzahl, nach der der Händler fragt — und als Filter auf der 3DS-Failure-Seite.

**Konsistenzprüfung, die der Referenzfall B erzwingt:** dort zeigt der heutige Report unter
«Fehlgeschlagen / abgebrochen» 10'026 Attempts mit **16.8 % Erfolg** — 1'684 «erfolgreiche
fehlgeschlagene Authentifizierungen». Das ist per Definition unmöglich und heisst: die
Heuristik «Started ohne CAVV = gescheitert» ist falsch, sobald ein Flow ohne CAVV
erfolgreich autorisiert (Attempts-Flow `A`, Frictionless mit leerem CAVV-Label, oder
Autorisierung nach Soft-Decline-Retry ohne 3DS). Bis §4.3 die Status-Labels belegt, muss
die Zeile im Report heissen «3DS gestartet, kein CAVV» statt «Fehlgeschlagen /
abgebrochen», und ein erfolgreicher Attempt in diesem Eimer wird als eigener Wert
`STARTED_NO_CAVV_SUCCESS` sichtbar gemacht statt stumm in die Quote zu laufen. Ein Test
nagelt fest: kein Attempt mit `attempt_state = SUCCESSFUL` landet in
`CHALLENGE_FAILED`/`CHALLENGE_CANCELLED`/`CHALLENGE_TIMEOUT`.

### 3.7 EMVCo-3DS-Reason-Codes — die statischen Tabellen

Die wallee-Labels liefern die EMVCo-Codes roh. Die Namen sind genormt (EMVCo 3-D Secure
Protocol and Core Functions Specification v2.2, Tabellen A.x) und gehören wie
`ISO_RESPONSE_CODES` als statische, kommentierte Tabellen in den Code. **Vor dem Bau gegen
die EMVCo-Spezifikation gegenlesen** (die Codes hier sind aus dem Gedächtnis der Recherche,
nicht aus dem Dokument kopiert):

`TDS_TRANS_STATUS` (`1611157230835`): `Y` Authentifiziert · `N` Nicht authentifiziert /
Konto nicht verifiziert · `U` Authentifizierung nicht möglich (technisch) · `A`
Attempts-Verarbeitung (Nachweis eines Versuchs, Scheme haftet) · `C` Challenge erforderlich ·
`D` Decoupled Authentication erforderlich · `R` Abgelehnt, keine weitere Autorisierung
versuchen · `I` Nur informativ.

`TDS_STATUS_REASONS` (`1611160961002`): `01` Card authentication failed · `02` Unknown
device · `03` Unsupported device · `04` Exceeds authentication frequency limit · `05`
Expired card · `06` Invalid card number · `07` Invalid transaction · `08` No card record ·
`09` Security failure · `10` Stolen card · `11` Suspected fraud · `12` Transaction not
permitted to cardholder · `13` Cardholder not enrolled in service · `14` Transaction timed
out at the ACS · `15` Low confidence · `16` Medium confidence · `17` High confidence ·
`18` Very high confidence · `19` Exceeds ACS maximum challenges · `20` Non-payment
transaction not supported · `21` 3RI transaction not supported · `22` ACS technical issue ·
`23` Decoupled authentication required by ACS but not requested · `24` 3DS Requestor
decoupled max expiry time exceeded · `25` Decoupled authentication: insufficient time ·
`26` Authentication attempted but not performed by the cardholder · `80`–`99`
DS-/Scheme-spezifisch.

`TDS_CHALLENGE_CANCEL` (`1611161612971`): `01` Cardholder selected «Cancel» · `02` 3DS
Requestor cancelled authentication (2.2) · `03` Transaction timed out — decoupled
authentication · `04` Transaction timed out at ACS (other timeouts) · `05` Transaction timed
out at ACS — first CReq not received · `06` Transaction error · `07` Unknown · `08`
Transaction timed out at SDK.

`TDS_AUTH_TYPE` (`1611161618236`): `01` Static passcode · `02` Dynamic (OTP/SMS) · `03`
Out-of-band (App-Bestätigung) · `04` Decoupled.

`ECI` (`1634723429552`/`1611080835887`): Visa/Amex/Diners/JCB `05` authentifiziert · `06`
versucht · `07` nicht authentifiziert; Mastercard `02` authentifiziert · `01` versucht ·
`00` nicht · `06`/`07` Mastercard-Sonderfälle (Data-only, SPA2). ECI ist heute nur
Existenz-Flag (Wallet-Kryptogramm) — als Rohwert je Attempt in der 3DS-Query ausgeben und
als Dimension «ECI» auf der 3DS-Seite zeigen: `06`/`01` = Attempts-Flow ist der Fall, in
dem der Händler die Haftung behält, obwohl 3DS lief.

### 3.8 Wiederholer über Transaktionen hinweg

In Referenzfall B ist `Attempts = Transaktionen = 84'703`, Retry-Rate exakt 1.00: **der
Shop legt für jeden Versuch eine neue Transaktion an.** Die Retry-Rate (E4) misst dort
per Konstruktion nichts, und «viele Kunden scheitern mehrfach hintereinander» ist über
`attempts_der_transaktion` (§3.3) unsichtbar. Deshalb zweiter Wiederholer-Begriff auf der
3DS-Seite: **gleiche `merchantreference`** (Bestellnummer — bleibt bei einem neuen Versuch
derselben Bestellung gleich) innerhalb von 24 h → `versuche_der_bestellung`,
`bestellung_am_ende_bezahlt` (irgendein Attempt derselben Referenz `SUCCESSFUL`). Window
über `t.merchantreference` in derselben Query; leere Referenz → nicht gruppiert. Kachel:
«Bestellungen mit ≥ 2 3DS-Fehlschlägen» und «davon am Ende bezahlt» — das ist der Betrag,
der **nicht** verloren ist, und die Differenz der, der es ist.

### 3.9 Was die Seite bewusst nicht tut

Keine Namen, keine Karten, keine Adressen (§3.3). Kein Live-Nachladen aus der API per
Default (§4.4 beschreibt es als Option «Details laden»). Keine Aussage «Liability Shift» —
kein Label (SPEC §4.3 E1).

## 4. Datenkatalog für Security-/3DS-Analysen (Recherche)

### 4.1 Analytics-Schema — was zusätzlich exportierbar ist

Quelle: `https://app-wallee.com/en-us/doc/api/analytics-schema` (27 Tabellen). Relevant und
**heute nicht** im Reporting genutzt:

| Tabelle.Spalte | Nutzen | PII | Empfehlung |
|---|---|---|---|
| `transaction.state`, `failurereason`, `failedon`, `confirmedon`, `authorizedon`, `completedon`, `createdon` | **Checkout-Funnel auf Transaktionsebene** (§5.3): erstellt → bestätigt → autorisiert → abgeschlossen; Transaktionen **ohne** Attempt sieht der Attempt-Report nicht | nein | neuer Block «Funnel» (Iteration 3) |
| `transaction.userinterfacetype` | Payment Page / iFrame / Lightbox / API — Abbruchquote je Integrationsform | nein | Dimension im Funnel |
| `transaction.tokenizationmode`, `token_id` | Anteil Zahlungen mit gespeichertem Token (wiederkehrende Kunden — 3DS-Ausnahme «Merchant-initiated») | nein | Dimension 3DS-Status |
| `transaction.language`, `customerspresence` | Sprache des Checkouts; VIRTUAL_PRESENT vs. NOT_PRESENT (MIT) | nein | Dimension |
| `transaction.billingaddresscountry`, `billingaddresspostcode`, `billingaddresscity`, `customeremailaddress`, `customerid`, `shippingaddress*` | **Nur als Existenz-Flag** (`IS NOT NULL`) → «Datenqualität für Frictionless» (§5.2): Anteil Transaktionen mit Rechnungsadresse / E-Mail / Kunden-ID. `billingaddresscountry ≠ issuer_country` als Fraud-Signal (SPEC §4.4) ist mit Ländercode möglich, ohne die Adresse selbst | **ja** (Werte), nein (Flags, Ländercode) | Flags in DIM aufnehmen; Werte **nie** ausgeben |
| `transaction.totalappliedfees`, `totalsettledamount` | Kosten je Brand (Interchange-Sicht) | nein | ausserhalb Security, Notiz |
| `chargeattempt.customerspresence`, `completionbehavior`, `initializingtokenversion`, `invocation_id` | MIT/CIT-Unterscheidung; Attempts, die einen Token anlegen | nein | Dimension 3DS |
| `chargeattempt.failedon`, `succeededon` | Dauer Attempt-Start → Ende (Timeout-Erkennung auch ohne 3DS-Labels) | nein | Spalte in §3.3 |
| `charge.state`, `charge.failurereason` | Charge-Ebene (zwischen Transaktion und Attempt) | nein | nur Diagnose |

**Nicht** im Analytics-Schema (nur in der Web-Service-API, `Transaction`-Modell): IP-Adresse
und IP-Land (`internetProtocolAddress`, `internetProtocolAddressCountry`), User-Agent,
Accept-Language, Zeitzone, Bildschirm-/Fenstergrössen, Java-Flag,
`deviceSessionIdentifier`, `userFailureMessage`, `chargeRetryEnabled`,
`authorizationTimeoutOn`, `metaData`. Für den Report heisst das: **Gerätedaten und
Browser-Signale sind nur per API pro Transaktion erreichbar** (§4.4), nicht als Aggregat.

### 4.2 Label-Descriptors — der Katalog kennt viel mehr als der Connector schreibt

Der vollständige Katalog liegt in `dashboard/catalog/label-descriptors.json`. Für
3DS/Security relevante Gruppen (IDs verifiziert):

**Gruppe «3-D Secure Details» (EMVCo-3DS-2-Felder, das ist, was der Händler aus Referenzfall B im Backend sieht):**

| ID | Name | Typ | Bedeutung |
|---|---|---|---|
| `1611157230835` | Transaction Status | String | `Y` authentifiziert · `N` nicht · `A` attempted · `U` unavailable · `R` rejected · `C` challenge required |
| `1611160961002` | Transaction Status Reason | String | EMVCo-Code `01`…`26` (`01` Card authentication failed, `04` Exceeds authentication frequency limit, `14` Transaction timed out at ACS, …) |
| `1611161612971` | Challenge Cancel | String | `01` Cardholder selected Cancel · `03`/`04` Transaction timed out · `05`/`06` CReq nicht erhalten · `07` Unknown · `08` Timeout am ACS — Codes nach EMVCo 3DS 2.x, Tabelle beim Bau gegen die Spezifikation prüfen |
| `1611161618236` | Authentication Type | String | `01` static · `02` dynamic (OTP) · `03` OOB (App-Bestätigung) · `04` decoupled |
| `1611149933680` | ACS Transaction ID | String | ACS-Referenz |
| `1611149882808` | ACS Protocol Version | String | 2.1.0 / 2.2.0 |
| `1611161608504` | DS Transaction Id | String | Directory-Server-Referenz |
| `1611161747534` | Message Category | String | `01` Payment · `02` Non-Payment |
| `1611080835887` | Electronic Commerce Indicator (ECI) | String | |
| `1611149682985` | Authentication Status | Boolean | |
| `1562759930422` | 3-D Secure Status | Static Value | Processor-Status |

**Gruppe «Endeavour Attempt Data V2»** (wallee-eigener 3DS-Server): `1552301704858` ACS
Operator ID, `1552301704857` **ACS Reference Number** (identifiziert den ACS-Betreiber —
die ACS-Achse aus der Support-Anfrage), `1552301749305` Challenge Mandate,
`1552301417759` Challenge Active, `1552557162650` Authentication Type,
`1563345852508` ECI value, `1551776387354` 3DS Server Transaction ID.
**Gruppe «Netcetera Attempt Data»**: `1698042396612` ACS Reference Number,
`1552058836149` ACS Transaction ID, `1562301419959` Authentication has been started.

**Gruppe «3-D Secure Information»** (ältere Connectoren): `1491899381431` Liability Shift,
`1484060164765` Liability Shifted, `1554732900181` Liability Shift Possible,
`1485183660219` 3-D Secure Failure (Klartext-Grund), `1484060156585` Authentication Status,
`1484060170638` Credit Card Enrolled.

**Gruppe «Transaction Details» / «Credit Card Information»** (Acquirer-Antwort):
`1532425961678` CVC Response Code, `1532425961673`/`1553773976792` Address Verification
Result, `1556796749189` AVS Result Type (im E-Com-Space 12622 beobachtet), `1532425961679`
Liability Shift (String), `1482414040602` Liability Shift (Static), `1482414032747`
Acquirer Response Code, `1458749261553` **Card Issuer Number (BIN)** — die einzige
Issuer-Identifikation im Katalog, siehe §5.1; `1615561443205` Scheme Reference Id.

**Gruppe «Fraud Data»**: `1476865633759` Fraud Score, `1476865318023` Fraud Category
(Processor-seitiges Scoring, connectorabhängig); Adyen: `1509096043194` Total Fraud Score.

**Befund aus Task 0b:** Im Referenz-Space 12622 schreibt der Connector **keines** dieser
Labels — nur Started/Finished/CAVV/Version/Cryptogram-ECI. Das ist **nicht** auf andere
Spaces übertragbar: die Support-Anfrage aus Referenzfall B beweist, dass für diesen Space im Backend
Transaction Status, Status Reason und Challenge Cancel vorliegen. Ob sie im
**Analytics-`labels`-Array** ankommen, ist die offene Frage → §4.3.

### 4.3 Discovery Q2 für den Space aus Referenzfall B (Pflicht vor §3.6/§3.7)

`dashboard/sql/00_label_discovery.sql` Q2 (alle Descriptor-IDs mit Häufigkeit) für den
Space aus `discovery-results/FALL-B.md`, Juni–August 2026, nur `ca.state = 'FAILED'`,
ausführen; Ergebnis nach `discovery-results/ecom_<space>_q2.csv` (gitignored) und in DESCRIPTORS.md dokumentieren.
Zwei Ausgänge:

- **Labels vorhanden** (`1611157230835`, `1611160961002`, `1611161612971`, ACS Reference
  `1552301704857`/`1698042396612`): Konstanten `DESC_TDS_TRANS_STATUS`,
  `DESC_TDS_TRANS_STATUS_REASON`, `DESC_TDS_CHALLENGE_CANCEL`, `DESC_TDS_ACS_REFERENCE`
  anlegen, in §3.3 aufnehmen, Aufschlüsselung «Challenge-Status-Grund» und «ACS» bauen.
  Fehlt ein Label bei einem Attempt → `UNKNOWN`-Eimer, wie überall.
- **Labels fehlen** im Analytics-Export: die Achse ist nur per API erreichbar (§4.4). Die
  Seite zeigt dann Dauer-Eimer und den Hinweis «Challenge-Details sind für diesen Space nur
  im Dashboard sichtbar (Öffnen-Link)».

Der Agent hält vor diesem Schritt an (Portal-Zugang, wie bei Task 1 Step 4).

### 4.4 API-Anreicherung über den Proxy (Option, nicht Default)

Laut CLAUDE.md liefert `GET /api/v2.0/payment/charge-attempts` (Header `Space: <id>`,
JWT wie gehabt) Attempts **mit** eingebettetem `failureReason` (Name) und `labels`;
`limit=100` lief in ein 504, `limit=20` funktioniert. Damit lässt sich die 3DS-Liste
**auf Knopfdruck** («Details laden», je 20 Attempts pro Aufruf, sequentiell) um
`userFailureMessage`, alle Labels aus §4.2 und den Failure-Reason-Namen anreichern —
auch dort, wo das Analytics-Schema die Labels nicht führt. Für 4'000 Attempts sind das
200 Aufrufe (~2–3 min) — als Batch-Werkzeug für den wallee-Support brauchbar, für den
Händler-Report zu langsam als Default. **Vor dem Bau zu verifizieren** (Doku-Seite ist
abgeschnitten, GitHub-SDK aus der Sandbox nicht erreichbar): Filter-Syntax des
`query`-Parameters (Filter auf `id` in Liste bzw. `linkedTransaction`), `expand`-Parameter
für `labels`, und ob die Antwort die Label-Werte mit Descriptor-ID trägt. Referenz:
`wallee-payment/python-sdk`, `wallee/service/…charge_attempt…` (dasselbe Vorgehen wie
für `payment/terminals`, Kommentar in `wallee-proxy.mjs`).

Neue Route `GET /charge-attempts?space=<id>&ids=<id,…>` (max. 20 IDs) → `[{ id,
failureReason: { id, name }, userFailureMessage, labels: [{ descriptorId, value }] }]`.
**PII-Filter im Proxy:** Labels `1456765000789`, `1456765125779`, `1456765711187` werden
vor der Antwort entfernt — die App bekommt sie nie.

## 5. Antworten auf die Support-Anfrage aus Referenzfall B — was der Report liefern kann

### 5.1 «3DS-Fehlschläge 90 Tage nach Challenge-Status-Grund und ACS/Issuer»

- **Grund abgebrochen / fehlgeschlagen / Timeout:** Timeout ist schon heute trennbar
  (`1568360434240` vs. `1568360440179`), «abgebrochen vs. fehlgeschlagen» braucht
  `Challenge Cancel` / `Transaction Status Reason` (§4.3) — sonst nur näherungsweise über
  die Dauer-Eimer (§3.5). Liefern: **ja**, Detailtiefe hängt vom Discovery-Ausgang ab.
- **Issuer:** wallee führt **keinen Issuer-Namen** — weder als Spalte noch als Label.
  Verfügbar sind **Issuer-Land** (`1474552618629`) und **BIN** (`1458749261553`, Card
  Issuer Number). Ein Issuer-Name braucht eine BIN-Tabelle (Scheme-BIN-Files des
  Acquirers oder ein kommerzieller BIN-Dienst; nicht öffentlich, nicht in wallee). **Die
  Frage «konzentriert es sich auf einen bestimmten Herausgeber?» ist deshalb ohne BIN-Tabelle nicht aus dem
  Report beantwortbar** — wohl aber über die **ACS-Achse** (ACS Reference Number
  identifiziert den ACS-Betreiber, und die Support-Anfrage zitiert genau diese Angabe aus dem Backend), sofern §4.3 das Label belegt. Empfehlung: BIN in der 3DS-Query **als Spalte
  aufnehmen** (Integer-Label, keine PII — identifiziert den Issuer, nicht die Karte), dann kann
  wallee-intern mit der Acquirer-BIN-Liste gruppiert werden; Konstante `DESC_CARD_ISSUER_NUMBER`.
- **Vergleich April vs. Mai–heute** (erste E-Mail): mit dem bestehenden Verlauf möglich,
  Zeitraum 01.04.–heute wählen; ein «Vorperiode»-Delta ist SPEC §4.4 (Iteration 3).

### 5.2 «Frictionless-Quote erhöhen — welche Daten fehlen?»

Was der Issuer für eine risikobasierte Freigabe (frictionless) sieht, ist das, was wallee
im AReq mitschickt: Rechnungs-/Lieferadresse, E-Mail, Telefon (Transaction `billingAddress`
mit `phoneNumber`/`mobilePhoneNumber`, `customerEmailAddress`, `customerId`), Browser-Daten
(Accept/User-Agent/Language-Header, Zeitzone, Bildschirm — bei Payment Page/iFrame
automatisch, bei API-Integration muss der Shop sie setzen), und die **Gerätedaten-
Erfassung** per `deviceSessionIdentifier` (Doku «Device Data»: «highly recommended … to
reduce fraud»). **Messbar im Report** (§4.1, Flags): Anteil Transaktionen mit
Rechnungsadresse, mit E-Mail, mit Kunden-ID, mit Token, je `userinterfacetype`. Neuer
Block **«Datenqualität für 3DS»** (Iteration 3, nach §4.3): eine Tabelle, die dem Händler
zeigt, welche Felder er heute in welchem Anteil liefert — das ist die konkrete Antwort auf
«sagt uns, welche Felder fehlen». Gerätedaten (IP, User-Agent, Session-ID) sind nur per
API sichtbar (§4.4) → Stichprobe von 20 Transaktionen reicht für die Aussage «Shop
liefert keine Browser-Daten».

### 5.3 «Die Transaktion wurde bestätigt, allerdings wurde die Verarbeitung nie gestartet»

Failure Reason `1580367235835` **Processing not Initiated**, Kategorie **Developer**:
Transaktion wurde vom Shop `confirm`ed, aber der Kunde wurde nie auf die Payment Page /
in den Payment-Flow geführt (oder der Shop hat den Flow nach `confirm` nicht gestartet),
bis die Transaktion ausgelaufen ist. Das ist **kein Zahlungsversuch** — es gibt keinen
Charge Attempt, deshalb **sieht der heutige Report diese Fälle nicht** (Grundsatzentscheid
1: Attempt-Basis). Dasselbe gilt für `1580367235834` Transaction Timed Out (vor
Bestätigung ausgelaufen = Warenkorb verlassen). Beides sind Integrations-/Checkout-Signale,
keine Payment-Signale. **Konsequenz für die Spec:** ein Block «Transaktionen ohne
Zahlungsversuch» aus der `transaction`-Tabelle (`state = 'FAILED'`, `failurereason`,
gruppiert, im selben Zeitfenster auf `t.createdon`) — als **eigener Block CONV2** in der
Aggregat-Query, mit klarer Fussnote, dass diese Zahl **nicht** in die Success Rate
eingeht. Damit kann der Händler sehen, ob seine «hohe Stornierungsquote» beim Bezahlen
(Attempt-Failures) oder **vor** dem Bezahlen (nie gestarteter Flow) entsteht — in Referenzfall B
vermutlich beides.

### 5.4 Erkenntnisse aus beiden Spaces (für die Doku, nicht für den Code)

Zahlen je Space stehen in `discovery-results/FALL-B.md`; hier nur die Muster:

- Zwei unabhängige Händler-Spaces: 3DS-Failure-Anteil an den Fehlschlägen **34 % bzw.
  65 %**, bei Visa/Mastercard in beiden **rund 80 % aller Kartenfehlschläge**. 3DS-Akzeptanz
  85.6 % bzw. 82.1 % (Referenzmonat 12622: 90.6 %). Das ist kein Einzelfall, sondern
  das dominante Ablehnmuster im Schweizer E-Commerce mit App-basierter Challenge.
- «Security Decline» (in beiden Spaces nur Mastercard) und «Suspicion of Manipulation» (nur
  Visa) sind **Issuer-Fraud-Ablehnungen**, «nicht wiederholen» — heute unsichtbar hinter
  `#<id>`. Für den Händler ist das die Zeile, die Retry-Logik im Shop steuern sollte.
- «Configuration Error» (nur Visa) ist ein wallee-/Acquirer-Thema, kein Kundenverhalten;
  die Kategorie-Achse (§1.3 Punkt 2) macht genau diese Trennung sichtbar.
- PostFinance Pay: 43–46 % der Fehlschläge «Checkout Id Expired», PostFinance E-Finance in
  Referenzfall B **52.5 % Failure Rate**, davon 77 % «Transaction Authorization Timed Out»
  — der Kunde bricht den E-Finance-Login ab. Das ist ein Checkout-UX-Thema (Zahlungsmittel
  zu prominent für Kunden ohne E-Finance-Zugang?), kein wallee-Thema. — Kunde lässt den
  PF-Pay-Checkout liegen; Retry-Rate 1.00 heisst: niemand versucht es nochmals.
- **Nachtstunden:** in Referenzfall B fällt die Erfolgsquote zwischen 1 und 4 Uhr auf
  76–80 % (Tagesmittel 85 %) — typisches Fraud-/Karten-Testing-Fenster; die Stunden-Achse
  auf der 3DS-Seite (§3.5) und der Block «nach Kategorie» machen das sichtbar.
- **«Nicht angefordert» mit nur 78 % Erfolg** (Referenzfall B, 9'713 Attempts): Karten-
  Autorisierungen ohne 3DS scheitern deutlich öfter als authentifizierte (96.7 %). Wenn
  darunter «Soft Decline» (`1000000000065`) auftaucht, verlangt der Issuer 3DS und der
  Shop bzw. die Konfiguration versucht es ohne — Kandidat für die Empfehlung «3DS
  erzwingen». Heute unsichtbar hinter `#<id>`.
- Ø abgelehnter Betrag liegt in beiden Spaces über dem Ø erfolgreichen (51.95 vs. 48.41;
  277 vs. 127) — höhere Beträge werden häufiger gechallenged und abgebrochen. Eine
  Betrags-Eimer-Achse (< 50 / 50–200 / 200–500 / > 500) auf der 3DS-Seite ist billig und
  beantwortet «ab welchem Betrag verlieren wir Kunden».
- Der Block «Ablehncodes» ist im E-Com wertlos (83–91 % UNKNOWN) — der Processor liefert für
  diesen Space keinen Response Code; §1.3 Punkt 5.

## 6. Reihenfolge für den Agent (PLAN-Skizze, je Task Tests grün + Commit)

| Task | Inhalt | Anhalten? |
|---|---|---|
| 1 | Kataloge + Scraper ins Repo, `build-failure-reasons.mjs`, `FAILURE_REASONS` generiert, Kategorie-Dimension, Blöcke «nach Kategorie» und «Übrige», Ablehncodes-Schwelle, Doku-Korrektur (§1) | nein |
| 2 | Proxy-Route `/failure-reasons` mit Cache, App-Anbindung für unbekannte IDs (§1.3 Punkt 3) | nein |
| 3 | `kuchenSegmente`/`svgKuchen`/`pdfKuchen`, Kuchen in den acht Blöcken, PDF-Kuchen (§2) | nein |
| 4 | `buildReportingTdsQuery`, Parser, zweiter Token im Verlauf, Modell der 3DS-Seite ohne Label-Abhängigkeit (Grund, Dauer, Betrags-Eimer, Brand, Land, Version, ECI, Stunde, Tag, Wiederholer je Transaktion **und** je Bestellung §3.8, Endstand), Tabelle, Link, Exporte (§3); `tds_flow` mit Dauer-Rückfall und der Konsistenz-Korrektur aus §3.6 | **ja, vor Referenzlauf** (Portal) |
| 5 | Discovery Q2 für den Space aus Referenzfall B (§4.3); je nach Ausgang `tds_flow` aus den EMVCo-Labels (§3.6), Reason-Code-Tabellen (§3.7), ACS-Achse und BIN-Spalte | **ja** (Portal) |
| 6 | Optional: Proxy-Route `/charge-attempts` + «Details laden» (§4.4) — erst nach Verifikation der Filter-Syntax | ja (SDK-Prüfung) |
| 7 | Iteration 3 vormerken: Funnel/«ohne Zahlungsversuch» (§5.3), «Datenqualität für 3DS» (§5.2), Vorperioden-Delta | — |

Definition of Done (fachlich): beide Referenz-Reports über denselben Zeitraum zeigen **kein
`#<id>`**, die Kategorie-Summe = Anzahl FAILED, alle Kuchen summieren auf 100 %, kein
erfolgreicher Attempt steht in einem «gescheitert»-Eimer des 3DS-Ablaufs, die 3DS-Seite
listet alle 3DS-Failures und jeder Link öffnet die richtige Transaktion im Dashboard
(Stichprobe 5). Zahlen in `discovery-results/FALL-B.md`.
