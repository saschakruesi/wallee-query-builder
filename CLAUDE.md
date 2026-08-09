# Wallee Analytics Query Builder

Eigenständige HTML-Applikation (Single File, kein Build, keine Runtime-Dependencies), die
SQL-Queries für **wallee Analytics** (PrestoDB / Amazon Athena) generiert. Zwei
Betriebsmodi: **Kopieren-Modus** (Default) — SQL kopieren und im Portal unter
**Account > Analytics > Submit Query** ausführen; **API-Modus** (opt-in) — Query direkt über
einen lokalen Proxy absetzen. Das Ergebnis landet im modus-eigenen **Abfrage-Verlauf**
(CSV/Excel per Klick abrufbar) und, in den Modi `terminal` und `settlement`, zusätzlich als
gebrandeter Report (Terminal-Report bzw. Settlement-Report).

Entstanden aus einer Kundenanfrage im Gastronomie-Umfeld: Tagesabschluss-Abgleich pro
Terminal, Auszahlungs-Nachvollzug und Kartensuche bei Streitfällen. Seit v4 zusätzlich der
integrierte Terminal-Report (Outlet-/Brand-Gruppen, XLSX-Export) und die direkte
API-Anbindung. Seit v5 der Abfrage-Verlauf, der eigenständige `report`-Modus ist in
`terminal` aufgegangen (Terminal-Report ist jetzt dessen Ausgabe, kein CSV-Upload mehr) und
die Zugangsdaten lassen sich direkt im Einstellungs-Dialog pflegen. Seit v5.5 prüft die App
selbst auf neuere Releases und kann sich im API-Modus per Klick selbst aktualisieren (siehe
„Self-Update" unten). Seit v5.8 ist der `settlement`-Modus **account-** statt space-basiert
und hat mit dem Settlement-Report (Bildschirm, CSV, Excel, PDF) eine eigene Ausgabe erhalten,
analog zum Terminal-Report.

## Dateien

| Datei | Zweck |
|---|---|
| `wallee_query_builder.html` | **Aktuelle Version (v5.10.1).** Fünf Modi (Terminal-Report als Ausgabe von `terminal`, Settlement-Report als Ausgabe von `settlement`), zwei Betriebsmodi, Abfrage-Verlauf mit Download-by-Token, Multi-Space, Spaltenauswahl, Terminal-Synchronisierung, Self-Update-Check. Hier weiterentwickeln. |
| `wallee-proxy.mjs` | Lokaler Zero-Dependency-Proxy für den API-Modus: JWT-Signatur, Analytics-Endpunkte, `/health`, `/setup`, `/credentials`, `/terminals`, `/update`, **`GET /` (App-HTML servieren)**. Start: `node wallee-proxy.mjs`. |
| `Start-macOS.command` / `Start-Windows.bat` | Doppelklick-Starter: rufen `node wallee-proxy.mjs` mit `WALLEE_OPEN=1` auf (Server serviert die App unter `GET /` und öffnet den Browser). Setzen Node voraus; fehlt es, klarer Hinweis + Download-Seite. Siehe „Launcher-Skripte". |
| `PAKET-ANLEITUNG.md` | End-Nutzer-Anleitung fürs Doppelklick-Starten (inkl. Node-Hinweis und Gatekeeper/SmartScreen-Erststart-Workaround). |
| `sql/settlement_diagnose.sql` | Diagnose-Queries (einzeln ausführen!) um zu prüfen, ob/wie Settlement-Daten befüllt sind. |
| `sql/settlement_reference_reference.sql` | Referenz-Query: funktionierender Settlement-Join (valuedate + withdrawal-Referenz), Basis für das `settle`-CTE in v2. |
| `sql/settlement_verifikation.sql` | Verifikations-Queries für die Settlement-Annahmen (bt.state, Gebühren-Vorzeichen, Auszahlungsdauer, Mehrfach-Settlements, `NO_RECORD`-Anteil) — Kernbefunde an Produktivdaten bestätigt (siehe „Wallee-Referenzwissen"), Queries dienen der erneuten Gegenprüfung in anderen Spaces oder nach Schema-Änderungen. |
| `settlement-report-spec/` | **Nur lokal, bewusst nicht im Git** (siehe `.gitignore`): fachliche Vorgabe des Settlement-Reports (seit v5.10 umgesetzt) — `SPEC.md` (Datenmodell, Aggregation, Aufbau, Edge Cases, Validierungen §7), `GAP-ANALYSIS.md` (was der Report vor v5.10 anders machte), `generate_report.py` (Referenz-Implementierung in Python) sowie die Referenz-Ausgaben `Settlement_Report_Juni-Juli_2026.pdf` / `Settlement_Detail_Juni-Juli_2026.xlsx`. Die Referenzdateien enthalten **echte Produktivdaten** (~69'000 Transaktionen mit Bankreferenzen, namentlich genannter Händler) — dieses Repo ist **öffentlich**, weil das Self-Update ohne Auth von `raw.githubusercontent.com` lädt, deshalb dürfen sie nicht eingecheckt werden. **Bei Änderungen am Settlement-Report zuerst hier nachlesen** — die Referenzdaten sind der Prüfstein (siehe „Gegen die Referenzdaten prüfen" unten). |
| `sql/tip_verifikation.sql` | Verifikations-Queries für die Trinkgeld-Frage (Trinkgeld bereits im Brutto enthalten) — an echten Daten bestätigt (siehe „Wallee-Referenzwissen"), Queries dienen der erneuten Gegenprüfung in anderen Spaces oder nach Schema-Änderungen. |
| `CLAUDE.md` | Diese Datei. |

## Architektur (v2)

Alles in einer HTML-Datei: CSS im `<head>`, Markup, die `<script>`-Blöcke am Ende (Details
dazu weiter unten — seit v5.8 sind es drei).
Kein Framework, keine Dependencies, läuft offline per Doppelklick.

### State & Persistenz

- Ein zentrales `state`-Objekt, persistiert via `localStorage`.
- `STORAGE_KEY = 'wallee_query_builder_v6'` — **bei inkompatiblen State-Änderungen den Key
  hochzählen.** `STORAGE_KEY_OLD = 'wallee_query_builder_v5'` bleibt zusätzlich stehen: nur
  wenn unter `STORAGE_KEY` noch nichts liegt, liest `loadState()` von `STORAGE_KEY_OLD` und
  migriert (u. a. Kartensuche vom Export-Modus in den eigenen `card`-Tab, `payoutref`
  standardmässig deaktiviert, ein alter `mode: 'report'` landet gezielt auf `terminal` statt
  auf `brand` zurückzufallen). Das Ergebnis wird sofort unter `STORAGE_KEY` gesichert, der
  alte Schlüssel bleibt unangetastet stehen.
- `loadState()` migriert auch ältere Felder (z. B. Einzelfeld `spaceId` → `spaces[]`) und
  gleicht `exportColumns` gegen den Spaltenkatalog ab (neue Spalten bekommen ihren
  `def`-Wert). Die Modus-Whitelist ist `['brand','terminal','export','card','settlement']`
  — ein unbekannter Modus fällt auf `brand` zurück.
- Gespeichert werden: Modus, Spaces, Zeitraum, Terminals, Spaltenauswahl, Kartensuche,
  Settlement-Konfiguration (Account-Override, Super-User-Flag, Transaktionsdetail),
  User-Presets (max. 12), Betriebsmodus (`apiMode`, `proxyUrl`, `sqlSichtbar`). Der
  Abfrage-Verlauf liegt bewusst **nicht** in `state`, sondern unter einem eigenen,
  unversionierten Key (siehe „Abfrage-Verlauf" unten).
- Seit v5.8 zusätzlich `settlementAccountId` (`''`, Default = Account aus den Zugangsdaten
  gilt), `settlementSuperUser` (`false`) und `settlementDetail` (`true`) — rein additive
  Felder, **kein** `STORAGE_KEY`-Bump. Das frühere `settlementByTerminal` ist **entfallen**:
  der Settlement-Modus ist seit v5.8 account- statt space-/terminal-basiert und kennt keine
  Terminal-Aufschlüsselung mehr; `loadState()` löscht das Feld aus altem State, statt es
  stehen zu lassen.
- **`settlementReference` ist seit v5.10 default `true`** (vormals `false`): das Feld steuert
  nicht mehr bloss eine Zusatzspalte, sondern den gesamten Abschnitt **Bankgutschriften** —
  den Kern des Kontoauszug-Abgleichs und damit den Hauptzweck des Reports. Damit ein aus v5.9
  übernommenes `false` diesen Abschnitt nicht stumm unterdrückt, hebt `loadState()` den Wert
  **einmalig** auf `true` und setzt dazu den Marker `settlementReferenceV510`. Der Marker steht
  **auch im Default-State**, damit ein frisch angelegter State die Migration gar nicht erst
  durchläuft; die Erkennung prüft deshalb bewusst `parsed.settlementReferenceV510` (den
  gespeicherten Stand) und **nicht** `state....` — der Spread über die Defaults würde sonst
  jede Prüfung mit „schon migriert" beantworten und die Migration liefe nie. Ein bewusstes
  Abschalten nach der Migration bleibt erhalten (beides in `test/betriebsmodus.test.js`
  festgenagelt). Rein additiv, **kein** `STORAGE_KEY`-Bump.

Seit v4 enthält die HTML-Datei mehrere `<script>`-Blöcke: den eingebetteten XLSX-Vendor
(`<script id="vendor-xlsx">`, nur für den XLSX-Export), seit v5.8 zusätzlich den eingebetteten
PDF-Vendor (`<script id="vendor-jspdf">`, jsPDF 2.5.2 + jspdf-autotable 3.8.4, UMD, nur für den
Settlement-Report-PDF-Export) und den App-Code (`<script id="app-logic">`) — **drei** Blöcke
insgesamt, in dieser Reihenfolge. Die HTML-Datei ist dadurch ~1.06 MB gross. Der Vendor
`vendor-xlsx` ist seit v5.1 **`xlsx-js-style` 1.2.0** (~425 KB minified, MIT-Fork von SheetJS
0.18.5) statt der reinen SheetJS Community Edition: nur dieser Fork kann beim Schreiben
**Zellstile** (Fill/Font/Border) setzen, was der XLSX-Export für die wallee-Optik braucht. Die
Community Edition konnte nur Zahlformate (`z`). API bleibt Drop-in-kompatibel (`XLSX.utils.*`).
Das Test-Harness extrahiert gezielt den `app-logic`-Block; die reinen Funktionen brauchen keinen
der beiden Vendoren. Beim Einbetten minifizierten Codes muss die
Ersetzung eine Replacer-**Funktion** nutzen — String-Ersatz deutet `$&`/`` $` ``/`$1` als
Muster und beschädigt den Code still (siehe `test/embedding.test.js`).

### Fünf Modi

1. **`brand`** – Aggregat pro Space × Brand × Währung (`GROUP BY`). Spalten: Anzahl,
   `unsettled_anzahl` (keine Gebühr UND kein Settlement-Record = wartet noch auf die
   Abrechnung), Brutto, Fees, Netto, `tip_total` (Trinkgeld-Anteil, bereits im Brutto
   enthalten).
2. **`terminal`** ("Terminal-Report" im Mode-Selector) – wie `brand`, zusätzlich
   Pflichtfilter + Gruppierung auf `paymentterminal.identifier` / `.name`. Gleiche
   `unsettled_anzahl`/`tip_total`-Spalten. Der frühere eigenständige `report`-Modus (CSV-
   Upload) ist **aufgegangen**: das Report-Panel (Outlet-/Brand-Gruppen, XLSX-Export) hängt
   jetzt an diesem Modus und wird ausschliesslich über das API-Ergebnis der eigenen Query
   befüllt (`ingestReportCsv`, ausgelöst nach dem Submit) — kein Datei-Upload mehr für die
   Report-Daten selbst (der verbliebene Datei-Input dient nur dem Import/Export der
   Gruppen-Konfiguration als JSON).
3. **`export`** – **eine Zeile pro Transaktion**, Spalten frei wählbar (Checkbox-Katalog),
   Terminal-Filter optional. Enthält u. a. `tip_amount` und `gross_excl_tip`.
4. **`card`** – Kartensuche: Transaktionen zu den letzten vier Kartenziffern
   (`buildCardQuery`), für Streitfälle. Eigener Tab statt Option im Export, seit die
   Kartensuche aus dem Transaktions-Export herausgelöst wurde.
5. **`settlement`** – seit v5.8 **account-, nicht space-basiert**: eine Auszahlung fasst die
   Transaktionen aller Spaces eines Accounts zu einer Gutschrift zusammen, deshalb entfallen
   Space- und Terminal-Filter. `buildSettlementQuery({ start, end, reference })` liefert **eine
   Zeile pro Transaktion** (kein `GROUP BY`, kein Aggregat-Modus mehr), `LEFT JOIN` auf ein
   vor-aggregiertes `settle_tx`-CTE, Zeitfilter wie gewohnt auf `t.completedon`; kein Join
   mehr auf `currentaccountwithdrawal` (die Auszahlungsreferenz-Heuristik bleibt exklusiv im
   Transaktions-Export, siehe `payoutref`/`auszahlungen`-CTE unten) — **ausser bei aktiver
   Referenz-Option** (`reference: true`, seit v5.9, **seit v5.10 default an**, siehe
   „Settlement-Report" unten). Ausgabe ist der **Settlement-Report** (eigener Abschnitt unten),
   nicht die rohe SQL-Zeile. Der Modus liefert **kein** `tip_total` mehr (kein `tipCte`-Join).
   Statt eines Accounts aus dem Space-Selektor kommt der Account aus den Zugangsdaten (Feld
   gesperrt) bzw., mit dem Flip „Anderen Account abfragen (Super-User)", aus einem frei
   eingebbaren Feld.
   **Seit v5.10 gruppiert der Report nach (Space, Valuta-Zeitpunkt)** statt nach blossem
   Valutadatum. Die Query liefert dafür zwei zusätzliche Felder: `s.valuedate` als vollen
   Timestamp unter dem Alias **`settlement_valuedate`** (**nicht** mehr `date(...) AS
   settlement_datum` — ein Space kann am selben Tag mehrfach ausbezahlt werden, `date()`
   verschmilzt diese Auszahlungen zu einer und macht den Bankabgleich unmöglich) sowie
   `t.createdon AS created_on` (Erfassungsbeginn im Titelblock, Sortierung des
   Transaktionsdetails).

Sichtbarkeit der Panels steuert `setMode()` über die CSS-Klasse `.cond-section.active`
bzw. `.hidden`. Terminal-Panel aktiv in `terminal`/`export`/`card` (seit v5.8 **nicht** mehr
in `settlement`), Spalten-Panel nur `export`, Kartensuche-Panel nur `card`,
Settlement-Panel (`settlementSection`, Account/Super-User/Detail) nur `settlement`,
Report-Panel (Terminal-Report) nur `terminal`, Settlement-Report-Panel
(`settlementReportSection`) nur `settlement`. Das Space-Panel (`spaceSection`) wird im
Modus `settlement` zusätzlich per `.hidden` ausgeblendet — der Modus ist account-, nicht
space-basiert, eine Space-Auswahl wäre dort irreführend. Die Modus-Whitelist in
`loadState()` ist `['brand','terminal','export','card','settlement']` — ein alter State mit
`mode: 'report'` wird gezielt auf `terminal` migriert statt auf `brand` zurückzufallen
(siehe „State & Persistenz" oben).

**Terminal-Filter befüllen (`#terminalSection`, seit v5.4):** drei Wege, kombinierbar —
manuell hinzufügen, CSV-Import, und **„🔄 Synchronisieren"**. Synchronisieren holt über die
Proxy-Route `GET /terminals?space=<id>` die Terminals der oben gewählten Spaces und führt sie
per `mergeSyncTerminals(vorhanden, neu)` in die bestehende Liste ein: neue Terminals kommen
ausgewählt dazu, bereits vorhandene (auch manuell angelegte) behalten ihre Auswahl, das Label
kommt aus `name`. Kein `STORAGE_KEY`-Bump, da nur bestehende `state.terminals`-Einträge
gemischt werden. Der Button ist **nur im API-Modus aktiv**; im Kopieren-Modus greyed-out mit
einem ⓘ-Info-Overlay, das auf das Zahnrad/den API-Modus verweist (`syncButtonZustand(apiMode,
proxyOk)` → `{ aktiv, infoSichtbar }`, angewendet über `aktualisiereSyncButton()`).

**Terminal-Space + Filter (seit v5.6):** Jedes Terminal trägt optional ein `space`-Feld
(Anzeige-String, reine UI-Information — SQL/Report bleiben unberührt), als kleines Badge in
der Liste sichtbar. Gesetzt wird es beim **Sync** — pro abgefragtem Space über
`spaceLabelBauen(spaceId, spaceName)` ("`<id> · <name>`", nur `id` oder nur `name` falls das
andere fehlt) — und beim **CSV-Import**: eine Space-Spalte im CSV geht vor, sonst greift die
einzeln gewählte Space oberhalb (mehrere gewählte Spaces → leer, da nicht eindeutig
zuordenbar). Zusätzlich zum Anzeige-String wird die **`spaceId`** am Terminal gespeichert
(beim Sync immer, beim CSV-Import wenn die Space-Spalte eine bekannte Space-ID trägt bzw. die
einzeln gewählte Space greift) — sie ist der verlässliche Schlüssel für die Zuordnung.

**Space-Klick steuert die Terminal-Auswahl (seit v5.7):** Ein Klick auf eine Space **oben**
(Checkbox oder Zeile, ebenso „Alle auswählen"/„Auswahl löschen" der Space-Liste) wählt die
Terminals dieser Space **unten** automatisch mit an bzw. ab — `setzeAuswahlFuerSpace(terminals,
spaceId, selected)` über `terminalGehoertZuSpace(t, spaceId)`. Letzteres matcht primär über
`t.spaceId`, mit **Rückfall auf den führenden ID-Teil des Anzeige-Tags** („83954 · Zürich" →
`83954`), damit auch vor v5.7 synchronisierte Terminals ohne erneuten Sync zugeordnet werden.
Terminals **anderer** Spaces und solche **ohne** Space-Tag bleiben unberührt. Das in v5.6
eingeführte Filterfeld unter der Liste wurde damit wieder **entfernt** — die Auswahl läuft
bewusst über den Space-Klick statt über manuelles Filtern; `renderTerminals()` zeigt wieder
immer alle Terminals, „Alle auswählen"/„Auswahl löschen" unter der Terminalliste wirken wieder
auf **alle** Einträge. Reine Funktionen (`spaceLabelBauen`, `terminalGehoertZuSpace`,
`setzeAuswahlFuerSpace`), harness-getestet.

Kein `STORAGE_KEY`-Bump — `space`/`spaceId` sind neue, optionale Felder auf bestehenden
`state.terminals`-Einträgen. v5.6.0 enthielt ausserdem den bereits vorher committeten, aber
nie separat veröffentlichten Sync-Button-Fix aus v5.5.2.

### Terminal-Report (Ausgabe des Modus `terminal`, seit v4, seit v5 ohne CSV-Upload)

Reine, DOM-freie Funktionen (über das Harness testbar), plus eine dünne UI-Schicht:

- **`parseReportCsv(text)` → `{ rows, headers, error }`** — zeichenweiser CSV-Parser (Quotes,
  Kommas im Feld, `""`, CRLF). Zähler-Spalte unter **beiden** Namen akzeptiert:
  `unmatched_anzahl` UND `unsettled_anzahl` → kanonisch `unmatched`. Fehlende Pflichtspalte →
  Fehlerobjekt (kein Wurf). Beträge werden als **ganzzahlige 1e-8-Einheiten** geführt (per
  String zerlegt, nicht `parseFloat(v)*1e8`) — es sind Geldbeträge, die auf den Rappen exakt
  aufsummieren müssen.
- **`autoOutletGroup(name)`** (`name.replace(/[\s\d]+$/,'')`), **`autoBrandGroup(brand)`**
  (`Lunch Check` → „Lunch-Check", sonst „Wallee"). Nur Vorschläge; Merge läuft über den
  Gruppen-**Namen**.
- **`buildReportModel(rows, config)` → `{ detail, outletTotals, brandTotals, grandTotal }`**
  (Aufbau nach SPEC 7). Beträge bleiben im Modell in 1e-8-Einheiten.
- **Zahlformat** von Hand (`formatAmountCH`/`formatIntCH`), nicht `toLocaleString('de-CH')` —
  dessen Tausendertrennung hängt von der ICU-Version des Browsers ab.
- **Persistenz** `wallee_terminal_report_cfg_v1` (`{outlet:{tid:group}, brand:{brand:group}}`),
  Private-Mode-sicher. **Export** über `reportExportBloecke()` (gemeinsame Basis für XLSX und
  CSV; Beträge als **Zahlen**, Schweizer Aussehen über das Excel-Zahlformat, nicht als
  formatierter String). XLSX über den eingebetteten Vendor (`xlsx-js-style`), nur im Event-Pfad;
  Kopfzeile in wallee-Türkis, feiner Rahmen und Zebra über die gemeinsamen Style-Helfer
  (`xlsxKopfEinfaerben`/`xlsxZellStil`).
- **Eingabe seit v5 ausschliesslich über den API-Modus**: `ingestReportCsv` wird
  ausschliesslich vom Submit-Pfad des `terminal`-Modus gespeist (`uebergibReportCsv`). Der
  Datei-Input im Report-Panel dient nur noch dem Import/Export der Gruppen-Konfiguration
  (`reportImportCfgInput`, JSON), nicht mehr dem Laden der Report-Rohdaten.

### Settlement-Report (Ausgabe des Modus `settlement`, seit v5.8, Spec-Umbau in v5.10)

Analog zum Terminal-Report: reine, DOM-freie Funktionen (harness-getestet in
`test/settlement-report.test.js`, `test/settlement-export.test.js`,
`test/settlement-render.test.js`), plus eine dünne UI-Schicht. Anders als der Terminal-Report
hat er **keine** persistente Gruppen-Konfiguration — er ist eine reine Auswertung des
Query-Ergebnisses, nichts wird editiert oder gemerged.

**Seit v5.10 folgt der Aufbau `settlement-report-spec/SPEC.md`** (Referenz-Implementierung
`generate_report.py`). Der Report beantwortet die drei Fragen der Buchhaltung in dieser
Reihenfolge: (1) *Welche Zahlung traf auf dem Konto ein und unter welcher Referenz?* →
**Bankgutschriften**, (2) *Woraus besteht eine Auszahlung?* → **Settlements** je Space und
Valutazeitpunkt, (3) *Welche Transaktionen stecken darin?* → **Transaktionsdetail**.

- **`parseSettlementCsv(text)` → `{ rows, headers, error }`** — eigener CSV-Parser (getrennt
  von `parseReportCsv`: andere Pflichtspalten, andere Feldnamen), Pflichtspalten
  **`settlement_valuedate`** (seit v5.10, vormals `settlement_datum`), `settlement_state`,
  `transaction_id`, `connector`, `waehrung`, `brutto_gross`, `settlement_gross`,
  `processing_fees`, `netamount`. Optional (fehlen dürfen): `settlement_reference`,
  `created_on`, `space_id`, `merchant_reference`, `sales_channel`, `terminal_identifier`.
  Beträge wie beim Terminal-Report als ganzzahlige 1e-8-Einheiten. Jede Zeile trägt den
  vollen Valuta-Timestamp (`settlementValuedate`, Gruppierungsschlüssel) **und** dessen
  Datumsanteil (`settlementDatum`, für Status-Einstufung und Kapitel-Zeiträume) — abgeleitet
  über `valutaDatum()`.
- **Drei Status pro Settlement** (Konstante `SETTLEMENT_STATUS`): **Settled** (Valutadatum
  im Berichtszeitraum), **Ausstehend** (Valutadatum nach dem Berichtszeitraum — entsteht
  daraus, dass nach Transaktionsdatum gefiltert, aber nach Valutadatum gruppiert wird),
  **Offen** (Transaktion ganz ohne Settlement-Record, `settlement_state = NO_RECORD`).
  *Ausstehend* ist eine bewusste Erweiterung über SPEC hinaus und ergibt sich aus dem
  Filterfeld der App. *Offen* zählt **nicht** als Settlement und in **keine** Summe des
  Reports — seit v5.10 steht es nicht mehr als Pseudo-Zeile in der Settlement-Übersicht,
  sondern in einem **eigenen Abschnitt „Offene Transaktionen"** (SPEC 4.4). Dadurch erfüllt
  die TOTAL-Zeile der Übersicht `Brutto − Fees = Netto` wieder ausnahmslos; der frühere
  Fussnoten-Hinweis dazu ist entfallen. Gibt es keine offenen Posten, bleibt der Abschnitt
  mit „Keine." stehen — die Abwesenheit ist selbst eine berichtenswerte Aussage.
- **`buildSettlementReportModel(rows, optionen)`** → `{ kpi, connectors, connectorTotal,
  spaces, spaceTotal, spaceListe, credits, creditTotal, settlements, gesamt, ausstehend,
  offen, txDetail, hasReference }`. Kern der Umstellung (SPEC 2.2–2.4):
  - **Settlement = (Space, Valuta-Timestamp)**, nicht Valutadatum. Ein Space kann am selben
    Tag mehrfach ausbezahlt werden (an Produktivdaten: dreimal); auf das Datum zu gruppieren
    verschmilzt getrennte Gutschriften und macht den Bankabgleich unmöglich. Settlements
    heissen `<spaceid>-S001` (je Space aufsteigend nach Valuta), der Bucket ohne
    Space-Zuordnung `OZ-S001` (SPEC 6.4). Über Spaces hinweg wird **nie** gruppiert.
  - **Bankgutschrift = `internalreference`** (`credits`, nummeriert `BG-01…` nach frühestem
    Valutazeitpunkt). Sie ist **nicht** 1:1 zum Settlement: eine Gutschrift bündelt mehrere
    Spaces und Valutatage (an den Referenzdaten: 23 Gutschriften über 82 Settlements). Die
    `BG-nn` ist der Querverweis, der in Übersicht, Space-Kapitel und Transaktionsdetail
    wieder auftaucht. **Bewusst über SPEC 4.4 hinaus** führt die Settlement-Übersicht neben
    `BG-nn` auch die **volle Referenz** mit (Spalte „Referenz (Kontoauszug)"): die Spec hält
    dort aus Platzgründen nur das Kürzel und verweist für den vollen String auf Abschnitt 2
    bzw. die Space-Kapitel — beim Abgleich will man ihn aber genau dort sehen, wo das
    Settlement steht, ohne zu springen. Settlements ohne Referenz zeigen `—`, nicht eine
    leere Zelle (sonst bliebe offen, ob die Referenz fehlt oder nur nicht geladen wurde).
    Der PDF-Export schaltet ab 10 Spalten auf Schriftgrösse 7, damit die 32-Zeichen-Referenz
    einzeilig bleibt. Abgerechnete Zeilen **ohne** Referenz landen in einer Sammelzeile
    (`bg: '—'`), sonst wäre die Summe der Gutschriften kleiner als das Report-Total und
    SPEC-Check 3 ginge nicht auf (an den Referenzdaten betrifft das 26 Transaktionen).
  - **`spaces`/`spaceTotal`** je Space (treibt Space-Übersicht und die PDF-Kapitel),
    **`connectors`** je Zahlungsmittel (Name über `zahlungsmittelName()` von den Präfixen
    `Wallee All-in-One - ` / `Wallee ACQ - ` befreit, SPEC 2.1), **`txDetail`** eine Zeile je
    Transaktion (sortiert nach Valuta, Space, Transaktionsdatum) für den Excel-Drilldown.
  - Beide Aufschlüsselungen zählen *Offen*-Zeilen bewusst **nicht** mit, damit ihre
    Total-Zeilen zu den KPIs darüber passen.
  - **Refunds** sind gewöhnliche Zeilen mit negativem Brutto und **positiver** Gebühr (SPEC
    6.1) — nichts wird genettet, gefiltert oder in den Betrag gezogen.
- **KPIs** (SPEC 4.2): Anzahl Bankgutschriften, Settlements, Transaktionen, Spaces, Brutto,
  Fees, Netto, nicht ausbezahlt (Tx/Brutto), dazu Erfassungsbeginn und Valuta-Zeitraum.
  **`Ø Netto/Settlement` und die Fee-Quote sind auf Kundenwunsch entfallen** (SPEC 4.2,
  GAP-ANALYSIS G7) — bei der früheren Datums-Gruppierung war der Nenner ohnehin falsch.
- **Wichtiger fachlicher Entscheid: Brutto, Fees und Netto stammen in jeder Settlement-Zeile
  durchgängig aus der Banktransaktion** (`banktransaction.postingamount` für Brutto,
  `postingamount − valueamount` für Fees, `valueamount` für Netto) — **nicht** aus der
  Transaktion selbst. Dadurch gilt `Brutto − Fees = Netto` exakt in jeder Zeile und jeder
  Summe. Die handgemachte PDF-Vorlage, an der sich der Report ursprünglich orientierte,
  mischte dagegen Transaktions- und Banktransaktions-Beträge und ging deshalb nicht auf
  (ihre Summenzeile ergab 204'596.91 − 2'461.83 = 202'190.85 statt der korrekten 202'135.08).
  Das erklärt, warum Zahlen aus diesem Report von älteren, handgemachten Reports abweichen
  können — die alten waren in dieser Hinsicht fachlich inkonsistent, nicht dieser. Einzige
  Ausnahme: die Zeile *Offen* nutzt den **Transaktionsbetrag** (`t.completedamount`) als
  Brutto, weil es dort mangels Settlement-Record keine Banktransaktion gibt, aus der Brutto
  stammen könnte (Fees/Netto bleiben dort 0).
- **Zahlformat** `formatZahlCH` (analog zu `formatAmountCH`, aber für Dezimalzahlen statt
  1e-8-Einheiten — beide Domänen bewusst getrennt, keine Umrechnung zwischen ihnen).
- **`settlementExportBloecke(modell, optionen)`** ist die gemeinsame Basis für Bildschirm,
  CSV, Excel und PDF — **vier Ausgaben aus einer Quelle**, wie schon beim Terminal-Report.
  Die Blöcke ergeben seit v5.10 genau die **sieben Blätter** aus SPEC 5:
  `Zusammenfassung`, `Aufschlüsselung nach Zahlungsmittel`, `Übersicht nach Space`,
  `Bankgutschriften` (nur mit Referenz), `Settlement-Übersicht`, `Offene Transaktionen`,
  `Transaktionen` (nur mit `detail`). `optionen.detail` (aus `state.settlementDetail`)
  steuert allein den `Transaktionen`-Block, `optionen.reference` (aus
  `state.settlementReference`) die Bankgutschriften und alle Referenz-/BG-Spalten.
  `buildSettlementReportCsv` und `settlementPdfBloecke` sitzen auf denselben Blöcken auf; das
  PDF läuft über den zweiten Vendor-Block (`vendor-jspdf`, jsPDF 2.5.2 + jspdf-autotable
  3.8.4), ebenso wie das Excel über `vendor-xlsx`. Excel-Blattnamen über `xlsxBlattName`
  wort-bewusst auf 31 Zeichen gekürzt (Excel-Limit), mit sprechenden Kürzeln für bekannte
  lange Blocknamen (`XLSX_BLATTNAME_KUERZEL`).
- **`settlementPdfBloecke`** baut daraus zusätzlich die Gliederung aus SPEC 4: bilingualer
  Titel, Kopfzeilen nach **Valutadatum** (Erfassungsdatum nur als Nebennotiz, SPEC 4.1),
  Abschnitt *Bankgutschriften* und *Settlement-Übersicht* je auf frischer Seite, danach
  **ein Kapitel pro Space** (`4. Detail pro Space — <id>`, jeweils neue Seite, SPEC 4.5) mit
  KPI-Zeile, Zahlungsmittel-Aufschlüsselung und einer Settlement-Tabelle, die die
  **vollständige Referenz** wiederholt — damit ein einzelnes Space-Kapitel für sich allein
  an einen Händler gehen kann. Ohne Referenz-Option rutschen die Abschnittsnummern um eins
  nach vorn. **Das Transaktionsdetail steht bewusst nie im PDF** (SPEC 4.6: ~69k
  Transaktionen wären ~1'500 Seiten) — es lebt in Excel/CSV.
- **UI:** eigenes Panel `settlementSection` (Account-Feld, vorbelegt aus den Zugangsdaten und
  gesperrt; Flip „Anderen Account abfragen (Super-User)" schaltet das Feld frei; Checkboxen
  „Transaktionsdetail einschliessen" und „Bankgutschriften / Auszahlungsreferenz
  einschliessen") sowie das Ausgabe-Panel `settlementReportSection` (CSV-/Excel-/PDF-Button).
  Beide nur im Modus `settlement` sichtbar (siehe „Sichtbarkeit der Panels" oben). Auf dem
  Bildschirm stehen alle Übersichts-Blöcke offen; nur der `Transaktionen`-Block steckt in
  einem `<details>` (mit Zeilenzahl im Summary), sonst erschlägt er die Übersicht.
- **Account-Override gilt nur im Settlement-Modus (seit v5.10.1).** `aktiverAccount()` gibt
  ausserhalb von `mode === 'settlement'` **immer** `''` zurück — der Super-User-Flip steht im
  Settlement-Panel und meint den Account, in dem der *Settlement*-Report laufen soll.
  `submitUndReport`, `tokenAbrufen` und `historyEintragBauen` nutzen diese eine Funktion
  modusübergreifend, deshalb muss die Eingrenzung **in ihr** sitzen, nicht bei den Aufrufern.
  **Warum das zwingend ist:** alle anderen Modi filtern nach `spaceid`. Ein fremder Account
  kennt diese Spaces nicht, die Query läuft im falschen Kontext und liefert **null Zeilen** —
  der Report meldet dann „Die Datei ist leer oder enthält keine lesbaren Zeilen". Genau das war
  der Fehler in v5.10.0: wer den Flip einmal für eine Settlement-Auswertung angeschaltet hatte,
  bekam im Terminal-Report dauerhaft einen leeren Report, ohne erkennbaren Zusammenhang. Die
  Testsuite war grün, weil kein Test „Flip an **und** anderer Modus" abdeckte — die Regression
  ist seither in `test/api-anbindung.test.js` und `test/history.test.js` über alle vier übrigen
  Modi festgenagelt.
- **Kein Datei-Upload:** anders als früher beim Terminal-Report vor v5 gibt es hier nie einen
  CSV-Upload-Pfad — der Report wird ausschliesslich aus dem eigenen Query-Ergebnis befüllt
  (`ingestSettlementCsv`, ausgelöst über `uebergibSettlementCsv` nach dem Submit).
- **Auszahlungsreferenz / Bankgutschriften (seit v5.9, seit v5.10 default an):** Die Checkbox
  (`state.settlementReference`) führt je Transaktion die
  `currentaccountwithdrawal.internalreference` mit — dieselbe Referenz wie auf dem Bank
  Statement. `buildSettlementQuery({ start, end, reference })` hängt dann die CTEs
  `auszahlungen`+`payoutref` und die Spalte `settlement_reference` an, account-korrekt
  eingeschränkt **aus der Query selbst** (`spacereference.accountid` auf
  `SELECT DISTINCT spaceid FROM tx`) — ohne externe Account-ID, funktioniert also in Kopier-
  und API-Modus. Ohne die Option bleibt die Query wie in v5.8 (kein Withdrawal-Join) und der
  Report **degradiert sauber**: `hasReference` bleibt `false`, der Abschnitt
  *Bankgutschriften* sowie alle BG-/Referenz-Spalten entfallen, alles andere bleibt
  unverändert. Der Join ist teurer und die zeitliche Zuordnung bleibt heuristisch (siehe
  „Wallee-Referenzwissen") — er ist trotzdem default an, weil der Kontoauszug-Abgleich der
  Hauptzweck des Reports ist.
- **Abfrage-Verlauf:** wie beim Terminal-Report zeigt die Verlaufszeile im Modus `settlement`
  nur den Roh-CSV-Download — Excel und PDF laufen ausschliesslich über das Report-Panel
  selbst (`exportSettlementXlsx`/`exportSettlementPdf`).

#### Gegen die Referenzdaten prüfen

`settlement-report-spec/Settlement_Detail_Juni-Juli_2026.xlsx` enthält **69'436 echte
Transaktionen** samt Soll-Ergebnis — der belastbarste Test für Änderungen am Modell, weit
über die Unit-Tests hinaus. Das Blatt `Transaktionen` lässt sich ohne Python-Bibliotheken
lesen (XLSX ist ein ZIP; `xl/worksheets/sheet6.xml` + `xl/sharedStrings.xml`, gestreamt mit
`ET.iterparse`). **Zwei Fallstricke**, beide beim ersten Versuch zugeschlagen:

1. **Leere Zellen werden im XML weggelassen.** Ohne Auswertung des `r`-Attributs (`A1`,
   `C1`, …) verrutschen ganze Spalten und Zahlen landen in Textspalten. Immer über die
   Zellreferenz in ein Array fester Breite einsortieren, nie Kind-Elemente durchzählen.
2. **Datums-/Zeitwerte sind Excel-Serials** (`46185.157…`), keine Strings — mit
   `datetime(1899,12,30) + timedelta(days=f)` umrechnen.

Erwartete Werte (SPEC 7): 82 Settlements, 69'436 Transaktionen, Brutto `1'551'946.46`,
Fees `16'900.34`, Netto `1'535'046.12`, 23 Referenzen + 1 Sammelzeile ohne Referenz
(= 24 Bankgutschriften), 6 Spaces inkl. `ohne Zuordnung`. Der aktuelle Stand reproduziert
diese Zahlen exakt, ebenso die Space- und Zahlungsmittel-Summen und die einzelnen
`BG-nn`-Zeilen des Referenz-Reports.

### Abfrage-Verlauf (seit v5)

Eigener, von `state` unabhängiger `localStorage`-Key `wallee_query_history_v1`
(`HISTORY_KEY`, max. `HISTORY_MAX = 50` Einträge) — bewusst getrennt gehalten, damit er
State-Bumps übersteht und **nur** Token + Anzeige-Metadaten enthält, nie SQL und nie das
Ergebnis selbst (das wird bei Bedarf über den Token neu vom Proxy geholt).

- **Reine Funktionen** (Harness-testbar): `historyEintragBauen(mode, token, st, jetztIso,
  status)` baut den Eintrag (Modus, Token, Zeitstempel, Zusammenfassung von Spaces/Zeitraum/
  Filter, Status); `historyEinfuegen(list, eintrag)` fügt vorne ein und entfernt Duplikate
  desselben Tokens (`slice(0, HISTORY_MAX)`); `historyFuerModus(list, mode)` filtert für die
  Tabellenanzeige — der Verlauf ist **pro Modus** gefiltert, jeder Modus sieht nur seine
  eigenen Einträge.
- **Laden/Speichern** `historyLaden()`/`historySpeichern(list)` — Private-Mode-sicher wie die
  übrige Persistenz (try/catch, leeres Array als Fallback).
- **Ergebnis-Abruf über den Token:** `holeErgebnisText(token)` → `GET /result/:token`, liefert
  `{ ok, status, text, fehler }` ohne den Report zu befüllen — Basis für den Roh-Download.
  `csvZuZeilen(text)` ist der logikfreie CSV-Parser für diesen Pfad (getrennt von
  `parseReportCsv`, das die Report-spezifische Validierung/1e-8-Logik mitbringt).
- **Download aus der Tabelle:** `historyDownloadCsv(token, mode)` liefert das rohe CSV 1:1;
  `historyDownloadXlsx(token, mode)` baut über `styledSheetAusZeilen(zeilen)` eine **typisierte,
  wallee-formatierte** Excel-Datei aus denselben Zeilen: **keine Gruppierung/Aggregation** (das
  bleibt dem Terminal-Report vorbehalten), aber Beträge werden als **echte Zahlen** mit
  Währungsformat (`#,##0.00" <WHG>"`), Zähler als Ganzzahlen und alles andere als Text geschrieben.
  Die Spaltentypen werden **modus-unabhängig per Heuristik** bestimmt (Betrag = alle Werte matchen
  `^-?\d+\.\d+$`; Zähler = Kopf matcht `anzahl|count|records|number|nummer` **und** alle Werte
  ganzzahlig; Währungsspalte = Kopf `waehrung|währung|currency`), damit derselbe Export
  brand/export/card/settlement mit ihren unterschiedlichen Spalten bedient. Kopfzeile türkis, Zebra,
  Rahmen wie beim Report. **In den Modi `terminal` und `settlement` zeigt die Verlaufszeile nur
  den Roh-CSV-Download** — Excel (und im Settlement-Fall auch PDF) sowie die Report-Ansicht
  laufen dort über das jeweilige Report-Panel selbst (`exportReportXlsx`/`exportSettlementXlsx`/
  `exportSettlementPdf` mit gebrandetem Titel bzw. der nach dem Submit automatisch gezeigte
  Report), deshalb kein Excel-Button in der Verlaufszeile dieser beiden Modi.
  Jeder erneute Abruf über den Token zählt bei wallee als Download (siehe „Wallee-
  Referenzwissen").
- **Befüllt wird der Verlauf bei jedem erfolgreichen Submit** (unabhängig vom Modus); die Modi
  `terminal` und `settlement` speisen zusätzlich sofort ihr jeweiliges Report-Panel, um einen
  weiteren Result-Abruf zu sparen. Der Verlaufseintrag merkt seit v5.8 zusätzlich den Account,
  in dessen Kontext die Query lief (`e.account`) — im `settlement`-Modus kann das ein anderer
  als der konfigurierte Account sein (Super-User). **Nur dort**: `historyEintragBauen` setzt
  `account` ausschliesslich bei `mode === 'settlement'`, analog zu `aktiverAccount()` (siehe
  „Account-Override gilt nur im Settlement-Modus" unten).

### Betriebsmodus & API (v4, Zugangsdaten-Dialog seit v5)

- Zwei Modi im `state`: `apiMode` (Default `false`), `proxyUrl` (`http://localhost:8787`),
  `sqlSichtbar`. Umschaltung über das **Zahnrad** im Kopf (`settingsOverlay`) — die
  Einstellungen gelten modusübergreifend, deshalb ein Dialog statt eines Panels.
- **Kopieren-Modus:** SQL sichtbar, Kopieren-Button, wie bisher.
- **API-Modus:** Submit ist die Hauptaktion, SQL eingeklappt (Toggle „Query anzeigen"). Vor
  jedem Submit ein Health-Check (`pruefeProxy` → `deuteHealth`); ist der Proxy nicht bereit,
  klarer Hinweis + Rückfall, **nie** blockiert.
- **Ablauf** (`submitUndReport`): `POST /submit` → `queryToken`; Status pollen über den
  HTTP-Code (200 = fertig, 202 = weiter, `Retry-After` beachten); bei SUCCESS wird der
  Eintrag in den Abfrage-Verlauf geschrieben und im `terminal`-Modus zusätzlich `/result` →
  CSV → `ingestReportCsv` → Report-Panel befüllt. `holeErgebnisInReport(token)` ist der
  gemeinsame Result-Pfad für den Report, auch für „Vorhandenen queryToken abrufen"
  (`tokenAbrufen`).
- **Zugangsdaten-Dialog (seit v5):** `credUserId`/`credAccount`/`credSecret` im
  Einstellungs-Dialog, Speichern über `speichereCredentials()` → `POST /credentials` am
  Proxy. `ladeCredentialsInDialog()` liest beim Öffnen des Dialogs (und bei Aktivieren des
  API-Modus) über `leseCredentials()` → `GET /credentials` die vorhandenen Werte:
  `userId`/`accountId` im Klartext, das Secret-Feld bleibt **immer leer**
  (`credSecret.placeholder` signalisiert nur „hinterlegt"/„nicht hinterlegt" über
  `daten.hasSecret`) — ein leeres Secret beim Speichern bedeutet für den Proxy „unverändert
  lassen" (`mischeZugangsdaten`, siehe Proxy-Abschnitt). Die frühere In-App-Verlinkung auf
  die eigenständige `/setup`-Seite (`proxySetupLink`) wurde entfernt; die `/setup`-Seite
  selbst bleibt am Proxy als Fallback bestehen (z. B. wenn die App aus irgendeinem Grund
  nicht erreichbar ist).
- **Status-Punkt:** `.status-dot` (`#proxyStatusDot`, `data-art` ∈ `ok`/`warn`/`fehler`/
  `info`) zeigt den zuletzt bekannten Proxy-Zustand im Dialog; gesetzt über
  `meldeProxyZustand()`/`setzeProxyStatus()`, gespeist von `pruefeProxy()`.
- **Start-Check:** ist `apiMode` beim Laden der Seite bereits aktiv, prüft der Init-Block den
  Proxy sofort (`pruefeProxy(state.proxyUrl, 2000)` im Init, zusätzlich beim Umschalten des
  Toggles) — der Nutzer sieht den Status-Punkt, bevor er überhaupt auf Submit geht.

### Self-Update (seit v5.5)

- **Client-seitiger Check, unabhängig vom Betriebsmodus:** Beim Laden (gedrosselt) und über
  „Jetzt prüfen" im Einstellungs-Dialog fragt `pruefeUpdate(force)` die öffentliche
  GitHub-Releases-API (`api.github.com/repos/<owner>/<repo>/releases/latest`, CORS `*`, kein
  Proxy nötig — funktioniert also auch im reinen `file://`-Kopieren-Modus) nach dem neuesten
  Tag. `istNeuer(current, latest)` vergleicht Semver `v`-Präfix-tolerant, rein und
  Harness-getestet; ein Formatfehler auf irgendeiner Seite ergibt bewusst `false` (nie ein
  Update auf Basis von Datenmüll melden). Drosselung über `localStorage`
  (`UPDATE_CHECK_KEY`, `UPDATE_CHECK_TTL = 6 h`) — `force=true` (Button) umgeht sie. Netzwerk-
  fehler werfen nicht, sie ergeben einfach „kein Update".
- **Anzeige:** `zeigeUpdateZustand()` steuert Banner (`#updateBanner`, oberhalb des Tools) und
  den Update-Abschnitt im Einstellungs-Dialog (aktuelle/neueste Version, Fortschrittsbalken)
  synchron aus demselben Check-Ergebnis.
- **Ausführung nur im API-Modus.** Im Kopieren-Modus öffnet der Banner-/Settings-Button
  stattdessen die GitHub-Release-Seite (`UPDATE_RELEASE_PAGE`) in einem neuen Tab — ein
  `file://`-Dokument kann sich nicht selbst überschreiben. Im API-Modus fragt
  `aktualisiereApp()` erst eine Bestätigung ab (das ersetzt zwei Dateien und startet den Proxy
  neu), prüft den Proxy (`pruefeProxy`), ruft dann `POST /update {tag}` auf und pollt danach
  `warteAufProxyNeustart()` gegen `/health`, bis der neu gestartete Proxy wieder antwortet
  (Timeout 45 s, mit Hinweis auf manuelles Neuladen statt endlosem Warten) — bei Erfolg lädt
  `location.reload()` die Seite neu und zeigt die neue Version.
- **`POST /update`** am Proxy (siehe „Proxy" unten) lädt die neuen Laufzeit-Dateien vom
  Release-Tag, validiert sie, sichert die alten als `.bak`, schreibt atomar und startet den
  Prozess detached neu.
- **Sicherheitsmodell:** TLS (HTTPS zu `raw.githubusercontent.com`) plus fest im Proxy-Code
  verdrahtetes Repo (`UPDATE_REPO`, nie aus Eingaben) — vergleichbar mit einem `git pull` von
  einer festen Remote. Das schützt gegen Manipulation auf dem Transportweg, **nicht** gegen
  ein kompromittiertes GitHub-Konto des Maintainers, das einen bösartigen Tag veröffentlicht;
  dieses Restrisiko ist bewusst in Kauf genommen, nicht versehentlich übersehen.
- **Aktualisiert werden nur die zwei Laufzeit-Dateien** (`wallee_query_builder.html`,
  `wallee-proxy.mjs`). Launcher-Skripte und Dokumentation bleiben aussen vor und müssen bei
  Bedarf manuell nachgezogen werden (neues Zip).
- **Recovery:** schlägt ein Update fehl oder verhält sich die neue Version unerwartet, liegen
  `wallee_query_builder.html.bak` und `wallee-proxy.mjs.bak` neben den Originaldateien (das
  Backup überschreibt bewusst nur den jeweils letzten Stand, kein Verlauf). Zurücksetzen: die
  `.bak`-Dateien auf die Originalnamen zurückbenennen, Proxy neu starten
  (`node wallee-proxy.mjs`).

### Spaltenkatalog (`EXPORT_COLUMNS`)

Das Herzstück von Modus 3. Jede Spalte ist ein Objekt:

```js
{ key, name, sql, alias, def, desc,
  needsConn?, needsTerm?, needsCard?, needsSettle?, needsPayoutRef?, needsTip?, sensitive? }
```

- `sql` = SELECT-Ausdruck, `alias` = CSV-Spaltenname, `def` = default an/aus.
- Die `needs*`-Flags steuern, welche Joins/CTEs `buildExportQuery()` einbaut —
  **Joins/CTEs erscheinen nur, wenn mindestens eine gewählte Spalte (oder die Kartensuche)
  sie braucht.** Neue Spalte hinzufügen = ein Eintrag im Katalog, Rest passiert automatisch.
- `sensitive: true` (masked_card, auth_code) → gestrichelte/orange Optik, default **aus**.

### SQL-Erzeugung

- `buildBrandQuery`, `buildTerminalQuery`, `buildExportQuery`, `buildCardQuery`,
  `buildSettlementQuery` sind reine Funktionen (Input-Objekt → SQL-String) — bewusst so
  gehalten, damit sie ohne DOM testbar sind.
- `txCte({ spaceIds, start, end })` grenzt die Transaktionen (Space + Zeitraum + Status)
  einmal gemeinsam ein; `card`-, `settle`- und `payoutref`-CTE im Transaktions-Export filtern
  darüber, statt die teuren Joins über die gesamte Tabellenhistorie laufen zu lassen.
  `cardCte({ spaceIds })` kapselt die Label-Auflösung (siehe unten) und wird von
  Transaktions-Export und Kartensuche gemeinsam genutzt. **`buildSettlementQuery` nutzt
  `txCte` seit v5.8 nicht mehr** — der Modus ist account- statt space-basiert (kein
  `spaceIds`-Parameter mehr) und baut sein eigenes, kleineres `tx`-CTE (nur Zeitraum +
  Status, kein Space-Filter) sowie ein eigenes `settle_tx`-CTE inline auf. Kein Join mehr auf
  `currentaccountwithdrawal` (ausser bei aktiver Referenz-Option, seit v5.9 — siehe
  „Settlement-Report" oben).
- `spaceInClause(ids, col)`: 0 Spaces → `col = -1 -- BITTE ... AUSWÄHLEN` (Query läuft leer
  statt zu crashen), 1 Space → `=`, mehrere → `IN (...)`.
- Zeitfilter immer auf `t.completedon` (Tagesabschluss, nicht Erstellung!) mit
  `>= TIMESTAMP ... AND < TIMESTAMP ...`.
- Statusfilter fix `t.state IN ('FULFILL', 'COMPLETED')`.
- CTEs (in `buildExportQuery` je nach `needs*`-Flag, in `buildCardQuery` fest eingebaut;
  `buildSettlementQuery` hat seit v5.8 sein eigenes, nicht mit den folgenden geteiltes
  `settle_tx`-CTE, siehe „Fünf Modi" und „Settlement-Report" oben):
  - **`card`**: `charge` → `chargeattempt`, zieht Labels per
    `max_by(element_at(filter(ca.labels, l -> l['descriptor'] = '<ID>'), 1)['shortTextContent'], ca.id)`
    → genau eine Zeile pro Transaktion (letzter Attempt gewinnt).
  - **`settle`** (im Transaktions-Export, Flag `needsSettle`): `payfacsettlementrecord` →
    `banktransaction`, pro Transaktion vor-aggregiert (N:1-Beziehung, z. B. Refund in einem
    späteren Settlement-Lauf). Auszahlungsdatum = `bt.valuedate` (**nicht** `bt.paymentdate` —
    ist auf diesem Datenpfad leer!). Kein Filter auf `bt.state`, damit `UPCOMING` sichtbar
    bleibt, falls es vorkommt — bisher an Produktivdaten aber nicht beobachtet, siehe
    „Wallee-Referenzwissen"; `settlement_state` wird `'PARTIAL'`, wenn sowohl `SETTLED`- als
    auch andere Records vorkommen — siehe Kommentare im CTE und
    `sql/settlement_reference_reference.sql`. Der Settlement-**Modus** hat seit v5.8 sein
    eigenes, ähnlich gebautes, aber eigenständiges `settle_tx`-CTE (kein Space-Filter, dafür
    zusätzlich `min(bt.valuedate)` als Gruppierungsschlüssel für den Report) — die beiden
    teilen sich keinen Code, nur das Muster. **Seit v5.10 gibt der Settlement-Modus
    `min(bt.valuedate)` als vollen Timestamp aus** (`settlement_valuedate`), nicht mehr
    `date(...)` — siehe „Fünf Modi" oben.
  - **`auszahlungen`** / **`payoutref`**: Auszahlungsreferenz =
    `currentaccountwithdrawal.internalreference`, zeitlich zugeordnet (früheste Withdrawal
    des eigenen Accounts im Fenster `[bt.valuedate, bt.valuedate + 10 Tage)`) — rein
    heuristische Zuordnung, da es keinen direkten Fremdschlüssel gibt. Zwei CTEs, weil
    `currentaccountwithdrawal` **zwingend** auf den eigenen Account eingeschränkt werden
    muss (siehe „Wallee-Referenzwissen") — das vorgelagerte `auszahlungen`-CTE erledigt
    genau das (`JOIN spacereference sr ON sr.accountid = w.accountid`, eingegrenzt über
    `spaceInClause(spaceIds, 'sr.spaceid')` sowie ein absolutes Zeitfenster aus `start`/`end`
    sonst kann der Optimizer die Tabelle nicht per Partition beschneiden), `payoutref`
    joint danach nur noch gegen dieses kleine, bereits eingeschränkte Zwischenergebnis. Das
    Fenster steht auf 10 Tagen statt der an Produktivdaten gemessenen 1–2 Tage — bewusst
    Puffer für Feiertage und Wochenenden. Trotz der Korrektur bleibt die Spalte default aus:
    sie ist die teuerste im Export, und die Zuordnung bleibt heuristisch.
  - **`tip`** (`tipCte({ spaceIds })`, Helper-Funktion): summiert `lineitem.amountincludingtax`
    pro Transaktion für `lineitem.type = TIP_LINEITEM_TYPE` (Konstante `TIP_LINEITEM_TYPE =
    'TIP'`). Eingegrenzt über `tx`, damit nicht die gesamte `lineitem`-Historie des Space
    gescannt wird. Gesteuert über das Flag `needsTip` in `EXPORT_COLUMNS` (Spalten `tip`,
    `grossnotip`) sowie fest eingebaut in `buildBrandQuery` und `buildTerminalQuery`.
    **`buildSettlementQuery` bindet seit v5.8 keinen `tipCte` mehr ein und liefert kein
    `tip_total`** — der Modus wurde beim Umbau auf Account-Basis auf die Banktransaktions-
    Beträge reduziert (siehe „Settlement-Report" oben); Trinkgeld bleibt weiterhin über
    `brand`, `terminal` und den Transaktions-Export einsehbar.
    **Zentraler Fallstrick:** Eine Transaktion hat mehrere Line Items. `lineitem` darf
    **niemals** direkt ins `FROM`/`JOIN` der Aggregat-Modi (`brand`, `terminal`) gehängt
    werden — das vervielfacht die Zeilen pro Transaktion und macht `COUNT(*)`,
    `SUM(t.completedamount)` und die Gebührensummen falsch. Deshalb wird immer zuerst pro
    Transaktion vor-aggregiert (`GROUP BY tl.transaction_id` in `tipCte`) und das Ergebnis
    danach per `LEFT JOIN tip ON tip.transaction_id = t.id` angehängt — nie ein direkter Join
    auf `lineitem`/`transaction_lineitem`. Derselbe Fallstrick gilt grundsätzlich auch für
    `buildSettlementQuery`s eigenes `settle_tx`-CTE (`payfacsettlementrecord` ist ebenfalls
    N:1 zur Transaktion) — dort ist die Vor-Aggregation bereits eingebaut, siehe oben.
  - **`settle_exists`** (`settleExistsCte()`, Helper-Funktion): reiner Existenz-Check
    (`SELECT DISTINCT psr.transaction_id FROM payfacsettlementrecord ... WHERE
    psr.transaction_id IN (SELECT id FROM tx)`), unabhängig vom eigentlichen `settle`-CTE.
    Treibt `unsettled_anzahl` in `buildBrandQuery`/`buildTerminalQuery`: gezählt wird eine
    Transaktion, wenn `t.totalappliedfees IS NULL OR t.totalappliedfees = 0` **UND** kein
    passender Eintrag in `settle_exists` existiert (`se.transaction_id IS NULL` nach
    `LEFT JOIN`) — also weder eine Gebühr verbucht noch überhaupt schon ein
    Settlement-Record vorhanden ist. Bewusst `DISTINCT` statt `GROUP BY` mit Aggregation,
    da hier nur die Existenz zählt, kein Betrag.

### Optik

Helles Thema in den wallee-Markenfarben. Alle Farbentscheide laufen über die
CSS-Variablen im `:root`-Block (`--bg`, `--panel`, `--panel-2`, `--panel-3`, `--border`,
`--text`, `--muted`, `--accent`, `--accent-hover`, `--accent-dark`, `--success`,
`--danger`, `--warn`, `--code-bg`, `--code-text`) — neue Farbentscheide dort ergänzen,
nicht als Inline-Hex im Markup/CSS verstreuen.

Leitfarbe ist `#11d9cc` (`--accent`), aber **nur für Flächen** (Buttons, Border-Akzente,
aktive Zustände) — als Textfarbe auf hellem Grund ist das helle Türkis zu kontrastarm.
Für Text und feine Linien auf hellem Grund kommen die dunkleren Abstufungen zum Einsatz:
`#0da69c` (`--accent-hover`) und `#225956` (`--accent-dark`, z. B. für `.brand-mark`).

## Proxy (`wallee-proxy.mjs`, v4, `/credentials` seit v5, `/terminals` seit v5.4, `/update` seit v5.5, Account-Override seit v5.8)

Einzelnes Node-Script, nur Builtins (`http`, `crypto`, `fs`), **kein npm install**. Start
`node wallee-proxy.mjs`, Port über `WALLEE_PROXY_PORT`. Endpunkte: `GET /` (+ `/app`,
`/index.html`) liefert die **App-HTML selbst** (Standalone-/Serve-Betrieb, siehe unten),
`/health`, `GET`+`POST /setup`, `GET`+`POST /credentials`, `POST /submit` (Body-Feld
`account`, optional), `GET /status/:token` + `GET /result/:token` (beide zusätzlich
`?account=<id>`, optional), `DELETE /query/:token`, `GET /terminals?space=<id>`, `POST /update`.

- **Account pro Abfrage überschreibbar (seit v5.8):** `apiKopfZusatz(zugangsdaten, optionen)`
  entscheidet, welcher Kontext-Header an wallee geht — `optionen.space` hat Vorrang (Terminal-
  Endpunkt, Header `Space`), sonst `optionen.account` (Header `Account`, falls gesetzt), sonst
  der konfigurierte `zugangsdaten.accountId`. Ein leerer/fehlender Wert heisst „konfigurierten
  Account nehmen"; ein gesetzter, aber nicht-numerischer Wert ergibt `400`
  (`accountValide(wert)` prüft `^\d+$`, angewendet in den Routen `submit`/`status`/`result`
  noch **vor** dem Aufruf an wallee). Treiber ist der Settlement-Report: er ist
  account-basiert, und ein Super-User kann so fremde Accounts auswerten, ohne die
  hinterlegten Zugangsdaten umzustellen. `apiKopfZusatz`/`accountValide` sind reine
  Funktionen, ohne Netz getestet (`test/proxy.test.js`).

**Gotcha: laufenden Proxy nach Code-Änderungen neu starten.** Das Script lädt seinen Code
(und via `ladeAppHtml()` die App-HTML gecacht) **einmal beim Start** — ein bereits laufender
Proxy kennt neue Routen oder Fixes erst nach einem Neustart. Symptom: eine neu hinzugefügte
Route antwortet `404 {"fehler":"Unbekannter Endpunkt."}`, obwohl sie im Code steht (so beim
Live-Test von `/terminals` gegen einen noch aus der Vorversion laufenden Proxy passiert). Fix:
alten Prozess beenden (`pkill -f wallee-proxy.mjs`) und `node wallee-proxy.mjs` neu starten;
die Launcher-Skripte laden ohnehin immer die aktuelle Datei. Beim Testen frisch gemergter
Proxy-Änderungen also **immer zuerst den Proxy neu starten**, bevor man das Verhalten beurteilt.

### Launcher-Skripte (seit v5.2, kein Terminal-Befehl nötig)

Damit technisch nicht versierte Nutzer den API-Modus ohne Terminal-Befehl starten, gibt es
**Doppelklick-Starter** pro OS (`Start-macOS.command`, `Start-Windows.bat`). Sie wechseln ins
eigene Verzeichnis, prüfen, ob `node` da ist (sonst Hinweis + Download-Seite), setzen
`WALLEE_OPEN=1` und rufen `node wallee-proxy.mjs`. Der Server **serviert dann die App selbst**
unter `http://127.0.0.1:8787` (`GET /`) und **öffnet den Browser** — die App läuft damit
**same-origin** mit dem Proxy, wodurch die CORS/PNA-Logik gegenstandslos wird
(`originErlaubt`/`selbstOrigins` lassen die localhost-Origins ohnehin schon zu;
same-origin-Requests brauchen keinen Preflight). **Node.js wird vorausgesetzt** (einmalige
Installation von nodejs.org) — bewusst kein gebündeltes Binary (zu gross, Signatur-Warnungen,
CI-Aufwand). Sicherheitsmodell unverändert: Bind nur `127.0.0.1`, Secret lokal in
`~/.wallee-proxy.json`, JWT lokal signiert.

- **Serve-Verhalten:** `GET /` (+ `/app`, `/index.html`) liefert die HTML aus der Datei neben
  dem Script (`ladeAppHtml()`, gecacht). `browserOeffnenBefehl(platform)` (reine, getestete
  Funktion) wählt `open`/`start`/`xdg-open`; `oeffneBrowser()`/`sollBrowserOeffnen()` öffnen nur
  bei `WALLEE_OPEN=1` (die Launcher setzen es; ein blosses `node wallee-proxy.mjs` reisst kein
  Fenster auf). `GET /` und `/setup` sind von der `X-Wallee-Proxy`-Header-Pflicht ausgenommen
  (Browser-Navigation, kein fetch).
- **App-Seite:** beim Laden über `http(s)://` nimmt die App `window.location.origin` als
  `proxyUrl` und schaltet den API-Modus vorsorglich ein (Init-Block); beim `file://`-Doppelklick
  bleibt der Default `http://localhost:8787`. Der reine `file://`-Betrieb (Kopieren-Modus) und
  ein separat gestarteter Proxy bleiben voll lauffähig (Rückwärtskompatibilität).
- **Ausliefern:** den Ordner mit `Start-macOS.command`/`Start-Windows.bat`, `wallee-proxy.mjs`
  und `wallee_query_builder.html` zippen. **Unsigniert** → Erststart-Workaround in
  `PAKET-ANLEITUNG.md` (macOS Rechtsklick→Öffnen; Windows „Weitere Infos→Trotzdem ausführen").
  Das `.command` braucht das Ausführ-Bit (`chmod +x`, im Repo gesetzt).

- **Warum überhaupt:** Browser dürfen `app-wallee.com` nicht direkt rufen (CORS), und die
  JWT-Signatur bräuchte sonst das Secret im Browser. Der Proxy signiert lokal; das Secret
  liegt nur in `~/.wallee-proxy.json` (Rechte 600), geht nie an die App zurück, wird nie
  geloggt.
- **`GET /credentials`** (Route `credentials-lesen`) liefert `credentialsAnzeige(zugangsdaten)`:
  `userId`/`accountId` im Klartext plus `hasSecret` (Bool) — das Secret selbst geht **nie**
  zurück, auch nicht maskiert. Speist den In-Dialog-Editor beim Öffnen
  (`ladeCredentialsInDialog()` in der App).
- **`POST /credentials`** (Route `credentials-speichern`) nimmt `{ userId, accountId, secret }`
  per JSON entgegen. `mischeZugangsdaten(alt, neu)` behandelt ein **leeres** `secret` als
  „unverändert lassen" — so kann der Nutzer `userId`/`accountId` ändern, ohne das Secret
  erneut einzutippen (er sieht es im Dialog ohnehin nie). Das gemischte Ergebnis läuft durch
  dieselbe `speichereZugangsdaten()`/`pruefeZugangsdaten()`-Validierung wie `/setup` und wird
  mit Dateirechten 600 geschrieben. `credentialsAnzeige` und `mischeZugangsdaten` sind reine
  Funktionen, ohne Netz getestet (`test/proxy.test.js`).
- **`GET /terminals?space=<id>`** (Route `terminals`, seit v5.4) lädt die Terminals eines
  Space über `GET /api/v2.0/payment/terminals` (Header `Space: <id>` statt `Account` — dafür
  bekommt `rufeApi` eine `optionen.space`). Die wallee-API paginiert per Cursor
  (`limit`/`after`, Antwort `hasMore`); der Proxy blättert intern durch (Sicherheitsnetz:
  max. 100 Seiten), sammelt alle Seiten über `mappeTerminal(obj)` (→
  `{identifier,name,id,state}`) ein und liefert `{ ok:true, terminals:[...] }` in einer
  Antwort. `terminalPfad`/`mappeTerminal` sind reine Funktionen, ohne Netz getestet
  (`test/proxy.test.js`).
- **`POST /update {tag}`** (Route `update`, seit v5.5) lädt eine neue Version der Laufzeit-
  Dateien vom fest verdrahteten GitHub-Repo (`UPDATE_REPO = {owner, repo}`, **nie** aus der
  Anfrage) und ersetzt sich selbst:
  - `tagValide(tag)` verlangt strikt `^v?\d+\.\d+\.\d+$` — ungültig/fehlend → `400`, bevor
    überhaupt ein Netzwerkaufruf passiert.
  - `updatePfad(tag, datei)` baut die Download-URL ausschliesslich gegen
    `https://raw.githubusercontent.com/<owner>/<repo>/<tag>/<datei>` (HTTPS, `datei` gegen die
    Whitelist `UPDATE_DATEIEN` geprüft) — kein Pfad kommt aus Nutzereingaben.
  - `ladeUndSchreibeUpdate(tag, ziel)` lädt HTML **und** Proxy parallel, prüft: nicht-leere
    Antwort, `sanityHtml`/`sanityProxy` (grobe Plausibilität — z. B. eine GitHub-Fehlerseite
    statt der echten Datei erkennen), und lässt den neuen Proxy-Code als `.mjs`-Temp-Datei
    durch `node --check` laufen (syntaktisch kaputter Code wird **vor** dem Ersetzen
    verworfen). Erst wenn **alle** Gates bestehen: die alten Dateien werden nach `<datei>.bak`
    kopiert (überschreibend — nur der letzte Stand), die neuen atomar geschrieben (Temp-Datei +
    `rename` im selben Verzeichnis). Rückgabe `{ from: APP_VERSION, to: tag }`.
  - Der Handler antwortet **erst** `200 { ok:true, restarting:true, from, to }` (Antwort geht
    über `res.on('finish', …)` sicher noch raus), **dann** startet `starteNeustart()` einen
    detached Kindprozess und beendet den aktuellen mit `process.exit(0)`. Der Kindprozess
    wartet über `WALLEE_RESTART_DELAY_MS` (vom Elternprozess auf `1200` ms gesetzt), bis der
    alte Prozess seinen Port sicher freigegeben hat, bevor er selbst `listen()` aufruft.
  - Reine Funktionen (`tagValide`, `updatePfad`, `sanityHtml`, `sanityProxy`,
    `ladeUndSchreibeUpdate`, `starteNeustart`) sind getestet, u. a. gegen einen gestubbten
    `fetch` (`test/self-update.test.js`).
- **Missbrauchsschutz** (ein lokaler Server ist von jeder offenen Webseite erreichbar):
  Bindung nur auf `127.0.0.1`; Herkunft nur `null` (per `file://` geöffnete App) und die
  eigenen Proxy-Origins, **nie** `*`; zusätzlicher Header `X-Wallee-Proxy`, den eine fremde
  Seite nicht ohne Preflight setzen kann. Reine Funktionen (`findeRoute`, `signRequest`/
  `baueToken`, `pruefeZugangsdaten`, `originErlaubt`, `corsHeader`, `extrahiereDownloadUrl`,
  `walleeFehlertext`, `leseRetryAfter`, `credentialsAnzeige`, `mischeZugangsdaten`) sind ohne
  Netz getestet (`test/proxy.test.js`).
- **Fehlertexte** von wallee werden durchgereicht (`walleeFehlertext` → Feld `fehler`) und
  auf der Konsole geloggt — ohne das im Klartext hätte die Diagnose der API-Anbindung nicht
  funktioniert.

### wallee Analytics REST-API — verifizierter Ablauf (an Produktivdaten bestätigt)

Jede Anforderung am offiziellen SDK (<https://github.com/wallee-payment>, python-/typescript-sdk)
bzw. an der API-Doku (<https://app-wallee.com/doc/api/web-service>) verifiziert:

- **Auth: JWT-Bearer, NICHT das alte x-mac-Schema.** Header `{alg:HS256, typ:JWT, ver:1}`,
  Payload `{sub:"<userId>", iat:<unix-sek>, requestPath:"/api/v2.0<pfad>", requestMethod}`,
  signiert mit dem **base64-dekodierten** Secret; `Authorization: Bearer <token>`. Das
  x-mac-SHA512-Schema aus älteren SDKs (magento-1, salesforce) ist Legacy und wird von
  `api/v2.0` **nicht** akzeptiert. Signatur gegen den RFC-7515-A.1-Testvektor geprüft.
- **`Account: <accountId>`-Header** ist bei **allen** Analytics-Endpunkten Pflicht — fehlt er:
  400 `account_invalid`.
- **Submit:** `POST /api/v2.0/analytics/queries/submit`, Query-Param
  `queryExternalId=<frische UUID>` (Pflicht; **muss im signierten requestPath stehen**, da
  wallee die URL inkl. Query signiert), Body `{"sql":…}`. Antwort **201** `{"queryToken":…}`.
- **Status:** `GET …/queryToken/{token}` — Long-Poll: HTTP **200** = Endzustand (Body
  `status`: SUCCESS/FAILED/CANCELLED), **202** = läuft noch (`Retry-After`-Header, Sekunden).
  Nicht über das Status-Feld pollen, sondern über den HTTP-Code.
- **Result:** `GET …/queryToken/{token}/result`, `Accept: text/plain` (sonst 406). Antwort
  **200** = kurzlebige (5 Min) **Download-URL** (NICHT das CSV!). Der Proxy lädt die URL
  server-seitig (ohne Auth-Header, sie ist signiert) → das ist das CSV. 202 = noch nicht
  bereit, 204 = keine Zeilen.
- **Browser → localhost (Chrome PNA):** Eine `file://`-Seite, die `localhost` ruft, verlangt
  im Preflight `Access-Control-Allow-Private-Network: true` — fehlt er, blockiert Chrome den
  `fetch` komplett (die Anfrage erreicht den Proxy nie). Der Proxy spiegelt den Header.

## Wallee-Referenzwissen

- **Analytics-Schema:** <https://app-wallee.com/en-us/doc/api/analytics-schema>
  — Tabellen-/Spaltennamen im SQL **zwingend lowercase**.
- **Analytics-Doku/API:** <https://app-wallee.com/en-us/doc/analytics>
- **REST-API / Web Service:** <https://app-wallee.com/doc/api/web-service> — Analytics-Endpunkte
  (siehe „Proxy" oben). **API-Client / SDKs:** <https://github.com/wallee-payment> (Auth-Schema).
- **Label-Descriptors** (auf `chargeattempt.labels`, Typ array<map<string,string>>):
  - Masked Card Number: `1456765125779` (Konstante `DESC_MASKED_CARD`)
  - Authorization Code: `1579287795628` (Konstante `DESC_AUTH_CODE`) — leer bei TWINT
  - PAR: `1739873828282` · Expiry (yearMonthContent): `1456765711187`
  - Nachschlagen: `https://app-wallee.com/en-us/doc/api/label-descriptor/view/<ID>`
- **Sales-Channel-IDs:** Ecommerce `1582816223150`, Physical Terminal `1582819151330`.
- **Terminal-Liste:** `GET /api/v2.0/payment/terminals`, Header `Space: <id>` (nicht
  `Account` — Terminals hängen am Space, nicht am Account). Cursor-Paginierung über
  `limit`/`after`, Antwort `{ data:[...], hasMore }`; `after` ist die `id` des letzten
  Elements der vorigen Seite. Feld `identifier` ist derselbe Wert, den `buildTerminalQuery`/
  `buildExportQuery` als `paymentterminal.identifier` filtern — die Synchronisierung
  (`GET /terminals` am Proxy) nutzt exakt diesen Endpunkt. Der portal-interne Endpunkt
  `/api/client/getPaymentTerminals` (Session-/Cookie-Auth der Web-UI) ist **nicht**
  JWT-fähig und daher **nicht** verwendet.
- **Trinkgeld ist im Bruttobetrag enthalten — an echten Daten bestätigt.** Mit
  `sql/tip_verifikation.sql` gegen Produktivdaten geprüft: (a) im geprüften Space kommen nur
  die `lineitem.type`-Werte `PRODUCT` und `TIP` vor — der Wert `TIP` ist damit als korrekt
  bestätigt; (b) über eine Stichprobe von Transaktionen mit Trinkgeld war
  `completedamount` durchgehend exakt gleich `lineitems_total` (Differenz `0.00000000` in
  jedem einzelnen Fall). Trinkgeld ist also bereits im Bruttobetrag enthalten und **nicht**
  zusätzlich zu addieren; Umsatz ohne Trinkgeld ergibt sich aus `brutto_gross − tip_total`
  (Formeln `tip`/`grossnotip` in `EXPORT_COLUMNS` sind damit fachlich belastbar, keine
  Änderung nötig). `sql/tip_verifikation.sql` bleibt im Repo, um die Aussage bei Bedarf
  (anderer Space, Schema-Änderung) erneut zu prüfen.
- **Settlement-Annahmen — bisher an Produktivdaten beobachtet (ein Space, ein Zeitraum von
  mehreren Wochen, mit `sql/settlement_verifikation.sql` geprüft):**
  - **`unsettled_anzahl` misst, was es soll.** Query 6 ergab nur zwei der vier möglichen
    Kombinationen: „mit Gebühr, mit Record" und „ohne Gebühr, ohne Record". Keine einzige
    Transaktion hatte eine Gebühr ohne Settlement-Record oder umgekehrt — die beiden Signale
    treffen im Gleichschritt ein, nicht zeitversetzt. Die zunächst befürchtete Verengung
    durch die Und-Verknüpfung tritt damit nicht ein; der Zähler entspricht exakt der Menge
    ohne Settlement-Record. Die Konjunktion bleibt trotzdem stehen: laufen die Signale in
    einem anderen Space auseinander, zählt sie konservativ.
  - `banktransaction.state` kam ausschliesslich als `SETTLED` vor, kein `UPCOMING` und kein
    anderer Wert, und jeder Record hatte ein gefülltes `valuedate`. Das deutet darauf hin,
    dass ein `payfacsettlementrecord` offenbar erst entsteht, wenn tatsächlich abgerechnet
    wurde — eine Transaktion, die noch auf ihre Auszahlung wartet, hat dann gar keinen
    Record und erscheint im Settlement-Modus als `NO_RECORD`, nicht als `UPCOMING`.
    `UPCOMING` und `PARTIAL` bleiben in Code (`settle`/`settle_tx`-CTE) und Doku als
    mögliche Werte stehen — defensiv, falls ein anderer Space oder Acquirer sich anders
    verhält —, gelten aber nicht mehr als Normalfall.
  - `postingamount − valueamount` (Basis von `settlement_fees`/`processing_fees`) war
    ausnahmslos positiv, keine negativen und keine Null-Werte. Das Vorzeichen der Formel
    gilt damit als bestätigt.
  - Keine Transaktion hatte mehr als einen Settlement-Record. Die Vor-Aggregation pro
    Transaktion (`settle`/`settle_tx`-CTE) war in diesem Fall nicht nötig, bleibt aber
    bewusst als Absicherung bestehen — Refunds aus einem späteren Settlement-Lauf sind
    weiterhin denkbar, und ein anderer Space kann sich anders verhalten. Die Spalte
    `anzahl_settlement_records` bleibt deshalb als Frühwarnung sinnvoll.
  - **Wichtig für den Umgang mit diesen Punkten:** Sie stammen aus **einem** Space über
    **einen** Zeitraum — „bisher beobachtet", nicht „gibt es nicht". `sql/
    settlement_verifikation.sql` bleibt im Repo, um sie bei Bedarf (anderer Space, anderer
    Acquirer, Schema-Änderung) erneut zu prüfen; Query 5 misst zusätzlich direkt den
    `NO_RECORD`-Anteil (Transaktionen des Zeitraums ganz ohne Settlement-Record).
  - **`currentaccountwithdrawal` enthält ohne Einschränkung die Auszahlungen aller Accounts
    der Plattform, nicht nur die des eigenen Händlers — das ist dauerhaftes Wissen, kein
    Detail nur des `payoutref`-CTE.** An Produktivdaten nachgewiesen
    (`sql/settlement_verifikation.sql`, Query 7/9): eine ungefilterte Abfrage über einen
    mehrwöchigen Zeitraum lieferte mehrere Zehntausend Auszahlungen verteilt über sehr viele
    Accounts — für einen einzelnen Händler unmöglich, das sind die Auszahlungen der gesamten
    Plattform. Erst eine Einschränkung über
    `spacereference.accountid` (`JOIN spacereference sr ON sr.accountid = w.accountid`,
    gefiltert auf den eigenen Space) reduziert das auf eine plausible, kleine Zahl für einen
    einzelnen Händler. Ohne diese Einschränkung ist jeder Zugriff auf
    `currentaccountwithdrawal` **beides zugleich**: unbrauchbar langsam (der Range-Join im
    `payoutref`-CTE paart jede Banktransaktion mit einem Teil der Gesamtmenge, das liess
    frühere Diagnose-Queries selbst mit engem Zeitfenster ins Timeout laufen) und fachlich
    falsch (`min_by`/`max_by`/jede andere Auswahl über `w.createdon` wählt dann quer über
    alle Accounts, die zurückgegebene Referenz gehört mit hoher Wahrscheinlichkeit einem
    fremden Händler). Genau das war der Fehler in der ursprünglichen Fassung des
    `payoutref`-CTE: die Spalte `settlement_reference` war nie korrekt, fiel aber nicht auf,
    weil sie standardmässig deaktiviert ist. Seit der Korrektur läuft die
    Account-Einschränkung immer zwingend mit (`auszahlungen`-CTE, siehe oben) — bei jeder
    künftigen Query gegen `currentaccountwithdrawal` (auch ausserhalb des Generators, z. B.
    in Diagnose-Queries) gilt dasselbe.
  - Das Zeitfenster im `payoutref`-CTE steht auf 10 statt vormals 30 Tagen. Eine Messung an
    Produktivdaten (`sql/settlement_verifikation.sql`, Query 10, mit Account-Einschränkung)
    zeigt: praktisch jede Banktransaktion hat bereits am Valutatag oder am Folgetag eine
    Auszahlung des eigenen Accounts. Die Verteilung über weitere Tage ist flach und entsteht
    nur dadurch, dass etwa täglich eine Auszahlung stattfindet — sie sagt nichts über die
    fachlich richtige Zuordnung aus. 10 Tage sind bewusst ein Vielfaches der gemessenen 1–2
    Tage, als Puffer für Feiertage und Wochenenden.
  - **Der Settlement-Modus (`buildSettlementQuery`) zieht diese Withdrawal-Referenz seit
    v5.10 standardmässig wieder mit** (v5.8 hatte sie entfernt, v5.9 als Opt-in
    zurückgeholt). Die obigen Punkte zu `currentaccountwithdrawal` bleiben dauerhaftes
    Wissen und gelten unverändert für **beide** Aufrufer — den `payoutref`-CTE im
    Transaktions-Export und den des Settlement-Modus. Im Settlement-Modus gilt dieselbe
    Account-Einschränkung, nur aus der Query selbst hergeleitet (`spacereference.accountid`
    auf die Spaces des eigenen `tx`-CTE) statt über einen extern übergebenen
    `spaceIds`-Parameter — der Modus ist ohnehin account-scoped (der Account-Header der
    Anfrage übernimmt diese Rolle), die Einschränkung bleibt aber trotzdem zwingend, damit
    der Range-Join nicht gegen die Auszahlungen der gesamten Plattform läuft.
    **Warum default an, obwohl der Join teuer und die Zuordnung heuristisch ist:** Die
    Referenz ist der String auf dem Kontoauszug und damit der Schlüssel, gegen den die
    Buchhaltung abgleicht — ohne sie beantwortet der Report seine wichtigste Frage nicht
    (SPEC 2.2). An den Referenzdaten hält die Heuristik: jedes `(spaceid, valuedate)`-Paar
    bildet auf **genau eine** Referenz ab (über alle 82 Settlements geprüft). Wer die
    Kosten sparen will, schaltet die Checkbox ab — der Report degradiert dann sauber.
- **Grenzen der Analytics** (nicht lösbar, dem Kunden so kommunizieren):
  - Keine IC++-Aufschlüsselung (DCC/Interchange/Scheme/Acquirer) — nur `totalappliedfees` gesamt.
  - Eine Query läuft in **einem** Account; Spaces fremder Accounts → Permission Error.
    Multi-Space geht nur innerhalb desselben Accounts.
- Queries laufen asynchron; jede Ergebnis-URL-Generierung wird als Download gezählt.

## Entwicklungs-Workflow

1. Änderungen direkt in `wallee_query_builder.html`.
2. **Testen ohne Browser:**

   ```bash
   node --test "test/*.test.js"
   ```

   (die Form `node --test test/` funktioniert nicht — das Glob muss die Dateien treffen).
   `test/harness.js` extrahiert gezielt den `<script id="app-logic">`-Block (nicht mehr „den
   einzigen" — seit v4 gibt es auch Vendor-Blöcke, seit v5.8 zwei davon: `vendor-xlsx` und
   `vendor-jspdf`), stubbt `document`/`localStorage`/`fetch` und lädt das Script per
   `vm.runInContext`. Es exportiert die SQL-Builder, den Report-Kern (`parseReportCsv`,
   `autoOutletGroup`/`autoBrandGroup`, `buildReportModel`, `formatAmountCH`/`formatIntCH`,
   `reportExportBloecke`, `buildReportCsv`, `ingestReportCsv`), die API-Helfer
   (`normalisiereProxyUrl`, `deuteHealth`, `leseQueryToken`/`leseQueryStatus`,
   `apiPollConfig`) sowie `loadState`/`saveState`/`STORAGE_KEY*` und eine `getState()`-Closure.
   `options`: `document` (reicherer DOM-Ersatz aus `test/dom-stub.js`), `fetch` (gefälscht),
   `blockLocalStorage` (Private-Mode), `seedLocalStorage` (Migration), `plain(v)` (JSON-Runde
   gegen Realm-Grenzen bei `deepStrictEqual`).
   Testdateien: `queries` (SQL), `report`/`report-render`/`report-xlsx` (Terminal-Report-Kern,
   Render, XLSX end-to-end), `settlement-report`/`settlement-export`/`settlement-render`
   (Settlement-Report-Kern, Export-Blöcke, Render — analog zum Terminal-Report, seit v5.8;
   seit v5.10 gegen das Spec-Modell: Settlement-Grain, Bankgutschriften, Space-Kapitel),
   `betriebsmodus`/`api-anbindung` (Modi, Health, Submit-Poll-Result), `terminal-sync`/
   `terminal-labels` (Terminal-Synchronisierung, Label-Auflösung), `tip_unsettled`
   (Trinkgeld/Unsettled-Zähler), `proxy` (reine Proxy-Funktionen inkl. JWT gegen RFC-7515
   und die Account-Header-Logik), `self-update` (`istNeuer`, `tagValide`, `updatePfad`,
   Sanity-Checks, `ladeUndSchreibeUpdate` gegen gestubbten `fetch`, `POST /update` am
   Route-Dispatch), `embedding`/`dom-ids` (Struktur-/ID-Wächter).
   **Einschränkung:** Der einfache Stub liefert für **jede** ID irgendein Element — eine
   verwaiste DOM-Referenz fällt so nicht auf. `test/dom-ids.test.js` gleicht deshalb die per
   `getElementById` angefragten IDs statisch gegen das Markup ab; nach UI-Änderungen bleibt
   der Test die Absicherung.
3. Generiertes SQL idealerweise einmal real laufen lassen — im Portal (*Account > Analytics >
   Submit Query*) oder im API-Modus über den Proxy.
4. Version im `<h1>`-Badge und Subtitle **sowie** in `APP_VERSION` (sowohl in
   `wallee_query_builder.html` als auch in `wallee-proxy.mjs` — beide Dateien tragen
   dieselbe Versionsnummer, siehe Kommentar über `APP_VERSION` im Proxy) nachführen; bei
   State-Bruch `STORAGE_KEY` erhöhen. Der Proxy hat seine eigenen Tests
   (`test/proxy.test.js`); Änderungen an der API-Anbindung möglichst am gestubbten
   `fetch`/an der ausgehenden Anfrage prüfen, nicht erst live.

## Offene Punkte / Ideen

- Auszahlungsreferenz-Zuordnung über Withdrawals (`payoutref`-CTE) ist heuristisch
  (zeitbasiert) — beobachten, ob es einen direkten Verknüpfungspfad gibt. Betrifft seit v5.10
  **beide** Aufrufer: den Transaktions-Export und wieder den Settlement-Modus, wo die Referenz
  die Bankgutschriften trägt (siehe „Wallee-Referenzwissen"). Ein direkter Fremdschlüssel
  würde dort die letzte verbleibende Unschärfe des Reports beseitigen.
- **Offen aus SPEC 1.2 / GAP-ANALYSIS G3+G4:** Die Query filtert weiterhin auf
  `t.completedon` (Transaktionsdatum), die Spec verlangt für den Report eigentlich einen
  Filter auf **`valuedate`**. Solange nach Transaktionsdatum gefiltert wird, ist der letzte
  Settlement-Tag am Rand des Zeitraums unvollständig — die App fängt das ab, indem sie diese
  Settlements als **Ausstehend** kennzeichnet statt sie stillschweigend abzuschneiden (genau
  der Fehler, den G3 als „sieht vollständig aus, ist es aber nicht" beschreibt). Ein echter
  Valuta-Filter wäre die saubere Lösung, ändert aber die Bedeutung des Zeitraum-Pickers für
  alle Modi — bewusst zurückgestellt, nicht übersehen. G4 (nicht abgerechnete Transaktionen
  müssen im Export enthalten sein) ist dagegen erfüllt: der `LEFT JOIN` hält sie als
  `NO_RECORD` fest.
- **Bewusste Abweichung von SPEC 3:** Das Tausendertrennzeichen ist `’` (U+2019,
  `CH_TAUSENDER`), die Spec zeigt den geraden Apostroph `'`. Die App nutzt U+2019 seit v4
  durchgängig, auch im Terminal-Report; eine Umstellung nur für den Settlement-Report würde
  die beiden Reports auseinanderlaufen lassen. Bei Bedarf zentral an `CH_TAUSENDER` ändern.
- Das Zeitfenster im `payoutref`-CTE steht seit der Account-Einschränkung auf 10 Tagen
  (vormals 30, gemessen mit `sql/settlement_verifikation.sql` Query 10) — weiter gegen
  echte Fälle in anderen Spaces/Accounts validieren, inkl. mehrerer Settlements pro
  Transaktion bei unterschiedlichen Brands, falls das doch vorkommt.
- `spacereference`-Join über `accountid` wird bereits im `auszahlungen`-CTE genutzt, um
  `currentaccountwithdrawal` auf den eigenen Account einzuschränken (siehe
  „Wallee-Referenzwissen"). Offen bleibt ein späterer Ausbau des Space-Selektors, der alle
  Spaces eines Accounts automatisch erfasst.
- Refund-Berücksichtigung (`- SUM(t.refundedamount)`) als Option.
- Country-Breakdown.
- Status-Auswahl im Export (aktuell fix FULFILL/COMPLETED) z. B. für FAILED-Analysen.

## Kontext

- Sprache der UI und Doku: Deutsch (Schweiz — **ss statt ß**).
- Die Spalten in Modus 3 spiegeln die Anforderungen eines Pilotkunden aus der Gastronomie.
