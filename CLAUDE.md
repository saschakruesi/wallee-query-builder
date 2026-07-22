# Wallee Analytics Query Builder

Eigenständige HTML-Applikation (Single File, kein Build, keine Runtime-Dependencies), die
SQL-Queries für **wallee Analytics** (PrestoDB / Amazon Athena) generiert. Zwei
Betriebsmodi: **Kopieren-Modus** (Default) — SQL kopieren und im Portal unter
**Account > Analytics > Submit Query** ausführen; **API-Modus** (opt-in) — Query direkt über
einen lokalen Proxy absetzen. Das Ergebnis landet im modus-eigenen **Abfrage-Verlauf**
(CSV/Excel per Klick abrufbar) und, im Modus `terminal`, zusätzlich als Terminal-Report.

Entstanden aus einer Kundenanfrage im Gastronomie-Umfeld: Tagesabschluss-Abgleich pro
Terminal, Auszahlungs-Nachvollzug und Kartensuche bei Streitfällen. Seit v4 zusätzlich der
integrierte Terminal-Report (Outlet-/Brand-Gruppen, XLSX-Export) und die direkte
API-Anbindung. Seit v5 der Abfrage-Verlauf, der eigenständige `report`-Modus ist in
`terminal` aufgegangen (Terminal-Report ist jetzt dessen Ausgabe, kein CSV-Upload mehr) und
die Zugangsdaten lassen sich direkt im Einstellungs-Dialog pflegen.

## Dateien

| Datei | Zweck |
|---|---|
| `wallee_query_builder.html` | **Aktuelle Version (v5.2).** Fünf Modi (Terminal-Report als Ausgabe von `terminal`), zwei Betriebsmodi, Abfrage-Verlauf mit Download-by-Token, Multi-Space, Spaltenauswahl. Hier weiterentwickeln. |
| `wallee-proxy.mjs` | Lokaler Zero-Dependency-Proxy für den API-Modus: JWT-Signatur, Analytics-Endpunkte, `/health`, `/setup`, `/credentials`, **`GET /` (App-HTML servieren)**. Start: `node wallee-proxy.mjs`. |
| `Start-macOS.command` / `Start-Windows.bat` | Doppelklick-Starter: rufen `node wallee-proxy.mjs` mit `WALLEE_OPEN=1` auf (Server serviert die App unter `GET /` und öffnet den Browser). Setzen Node voraus; fehlt es, klarer Hinweis + Download-Seite. Siehe „Launcher-Skripte". |
| `PAKET-ANLEITUNG.md` | End-Nutzer-Anleitung fürs Doppelklick-Starten (inkl. Node-Hinweis und Gatekeeper/SmartScreen-Erststart-Workaround). |
| `sql/settlement_diagnose.sql` | Diagnose-Queries (einzeln ausführen!) um zu prüfen, ob/wie Settlement-Daten befüllt sind. |
| `sql/settlement_reference_reference.sql` | Referenz-Query: funktionierender Settlement-Join (valuedate + withdrawal-Referenz), Basis für das `settle`-CTE in v2. |
| `sql/settlement_verifikation.sql` | Verifikations-Queries für die Settlement-Annahmen (bt.state, Gebühren-Vorzeichen, Auszahlungsdauer, Mehrfach-Settlements, `NO_RECORD`-Anteil) — Kernbefunde an Produktivdaten bestätigt (siehe „Wallee-Referenzwissen"), Queries dienen der erneuten Gegenprüfung in anderen Spaces oder nach Schema-Änderungen. |
| `sql/tip_verifikation.sql` | Verifikations-Queries für die Trinkgeld-Frage (Trinkgeld bereits im Brutto enthalten) — an echten Daten bestätigt (siehe „Wallee-Referenzwissen"), Queries dienen der erneuten Gegenprüfung in anderen Spaces oder nach Schema-Änderungen. |
| `CLAUDE.md` | Diese Datei. |

## Architektur (v2)

Alles in einer HTML-Datei: CSS im `<head>`, Markup, ein `<script>`-Block am Ende.
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
  Settlement-Aufschlüsselung nach Terminal, User-Presets (max. 12), Betriebsmodus
  (`apiMode`, `proxyUrl`, `sqlSichtbar`). Der Abfrage-Verlauf liegt bewusst **nicht** in
  `state`, sondern unter einem eigenen, unversionierten Key (siehe „Abfrage-Verlauf" unten).

Seit v4 enthält die HTML-Datei **zwei** `<script>`-Blöcke: den eingebetteten XLSX-Vendor
(`<script id="vendor-xlsx">`, nur für den XLSX-Export) und den App-Code
(`<script id="app-logic">`). Der Vendor ist seit v5.1 **`xlsx-js-style` 1.2.0** (~425 KB minified,
MIT-Fork von SheetJS 0.18.5) statt der reinen SheetJS Community Edition: nur dieser Fork kann beim
Schreiben **Zellstile** (Fill/Font/Border) setzen, was der XLSX-Export für die wallee-Optik braucht.
Die Community Edition konnte nur Zahlformate (`z`). API bleibt Drop-in-kompatibel (`XLSX.utils.*`).
Das Test-Harness extrahiert gezielt den `app-logic`-Block; die reinen Funktionen brauchen den Vendor
nicht. Beim Einbetten minifizierten Codes muss die
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
   befüllt (`ingestReportCsv`, ausgelöst nach Submit oder per „Als Report öffnen" aus dem
   Abfrage-Verlauf) — kein Datei-Upload mehr für die Report-Daten selbst (der verbliebene
   Datei-Input dient nur dem Import/Export der Gruppen-Konfiguration als JSON).
3. **`export`** – **eine Zeile pro Transaktion**, Spalten frei wählbar (Checkbox-Katalog),
   Terminal-Filter optional. Enthält u. a. `tip_amount` und `gross_excl_tip`.
4. **`card`** – Kartensuche: Transaktionen zu den letzten vier Kartenziffern
   (`buildCardQuery`), für Streitfälle. Eigener Tab statt Option im Export, seit die
   Kartensuche aus dem Transaktions-Export herausgelöst wurde.
5. **`settlement`** – Auszahlungs-Sicht pro Tag (`buildSettlementQuery`): was ist bereits
   ausbezahlt (`SETTLED`), was steht aus, was ist teilweise ausbezahlt (`PARTIAL`), welche
   Gebühren fielen an, plus `tip_total`. Optional nach Terminal aufgeschlüsselt
   (`settlementByTerminal`).

Sichtbarkeit der Panels steuert `setMode()` über die CSS-Klasse `.cond-section.active`
(Terminal-Panel in `terminal`/`export`/`card`/`settlement`, Spalten-Panel nur `export`,
Kartensuche-Panel nur `card`, Settlement-Panel nur `settlement`, Report-Panel nur
`terminal`). Die Modus-Whitelist in `loadState()` ist
`['brand','terminal','export','card','settlement']` — ein alter State mit `mode: 'report'`
wird gezielt auf `terminal` migriert statt auf `brand` zurückzufallen (siehe „State &
Persistenz" oben).

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
- **Eingabe seit v5 ausschliesslich über den API-Modus**: `ingestReportCsv` wird vom
  Submit-Pfad des `terminal`-Modus gespeist (`uebergibReportCsv`) sowie von
  `historyAlsReport(token)`, wenn im Abfrage-Verlauf bei einem `terminal`-Eintrag auf „Als
  Report öffnen" geklickt wird. Der Datei-Input im Report-Panel dient nur noch dem
  Import/Export der Gruppen-Konfiguration (`reportImportCfgInput`, JSON), nicht mehr dem
  Laden der Report-Rohdaten.

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
  Rahmen wie beim Report. Nur für den `terminal`-Modus gibt es zusätzlich „Als Report öffnen"
  (`historyAlsReport`), das dieselbe Antwort stattdessen durch `ingestReportCsv` schickt und in die
  Gruppen-Auswertung springt.
  Jeder erneute Abruf über den Token zählt bei wallee als Download (siehe „Wallee-
  Referenzwissen").
- **Befüllt wird der Verlauf bei jedem erfolgreichen Submit** (unabhängig vom Modus); nur der
  `terminal`-Modus speist zusätzlich sofort den Report, um einen weiteren Result-Abruf zu
  sparen.

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
  einmal gemeinsam ein; `card`-, `settle`- und `payoutref`-CTE sowie der Settlement-Modus
  filtern darüber, statt die teuren Joins über die gesamte Tabellenhistorie laufen zu
  lassen. `cardCte({ spaceIds })` kapselt die Label-Auflösung (siehe unten) und wird von
  Transaktions-Export und Kartensuche gemeinsam genutzt.
- `spaceInClause(ids, col)`: 0 Spaces → `col = -1 -- BITTE ... AUSWÄHLEN` (Query läuft leer
  statt zu crashen), 1 Space → `=`, mehrere → `IN (...)`.
- Zeitfilter immer auf `t.completedon` (Tagesabschluss, nicht Erstellung!) mit
  `>= TIMESTAMP ... AND < TIMESTAMP ...`.
- Statusfilter fix `t.state IN ('FULFILL', 'COMPLETED')`.
- CTEs (in `buildExportQuery` je nach `needs*`-Flag, in `buildCardQuery` und
  `buildSettlementQuery` fest eingebaut):
  - **`card`**: `charge` → `chargeattempt`, zieht Labels per
    `max_by(element_at(filter(ca.labels, l -> l['descriptor'] = '<ID>'), 1)['shortTextContent'], ca.id)`
    → genau eine Zeile pro Transaktion (letzter Attempt gewinnt).
  - **`settle`** / **`settle_tx`**: `payfacsettlementrecord` → `banktransaction`, pro
    Transaktion vor-aggregiert (N:1-Beziehung, z. B. Refund in einem späteren
    Settlement-Lauf). Auszahlungsdatum = `bt.valuedate` (**nicht** `bt.paymentdate` — ist
    auf diesem Datenpfad leer!). Kein Filter auf `bt.state`, damit `UPCOMING` sichtbar
    bleibt, falls es vorkommt — bisher an Produktivdaten aber nicht beobachtet, siehe
    „Wallee-Referenzwissen"; `settlement_state` wird `'PARTIAL'`, wenn sowohl `SETTLED`- als
    auch andere Records vorkommen — siehe Kommentare im CTE und
    `sql/settlement_reference_reference.sql`.
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
    `grossnotip`) sowie fest eingebaut in `buildBrandQuery`, `buildTerminalQuery` und
    `buildSettlementQuery`.
    **Zentraler Fallstrick:** Eine Transaktion hat mehrere Line Items. `lineitem` darf
    **niemals** direkt ins `FROM`/`JOIN` der Aggregat-Modi (`brand`, `terminal`,
    `settlement`) gehängt werden — das vervielfacht die Zeilen pro Transaktion und macht
    `COUNT(*)`, `SUM(t.completedamount)` und die Gebührensummen falsch. Deshalb wird immer
    zuerst pro Transaktion vor-aggregiert (`GROUP BY tl.transaction_id` in `tipCte`) und das
    Ergebnis danach per `LEFT JOIN tip ON tip.transaction_id = t.id` angehängt — nie ein
    direkter Join auf `lineitem`/`transaction_lineitem`.
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

## Proxy (`wallee-proxy.mjs`, v4, `/credentials` seit v5)

Einzelnes Node-Script, nur Builtins (`http`, `crypto`, `fs`), **kein npm install**. Start
`node wallee-proxy.mjs`, Port über `WALLEE_PROXY_PORT`. Endpunkte: `GET /` (+ `/app`,
`/index.html`) liefert die **App-HTML selbst** (Standalone-/Serve-Betrieb, siehe unten),
`/health`, `GET`+`POST /setup`, `GET`+`POST /credentials`, `POST /submit`,
`GET /status/:token`, `GET /result/:token`, `DELETE /query/:token`.

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
   einzigen" — seit v4 gibt es auch den SheetJS-Vendor-Block), stubbt `document`/
   `localStorage`/`fetch` und lädt das Script per `vm.runInContext`. Es exportiert die
   SQL-Builder, den Report-Kern (`parseReportCsv`, `autoOutletGroup`/`autoBrandGroup`,
   `buildReportModel`, `formatAmountCH`/`formatIntCH`, `reportExportBloecke`, `buildReportCsv`,
   `ingestReportCsv`), die API-Helfer (`normalisiereProxyUrl`, `deuteHealth`, `leseQueryToken`/
   `leseQueryStatus`, `apiPollConfig`) sowie `loadState`/`saveState`/`STORAGE_KEY*` und eine
   `getState()`-Closure. `options`: `document` (reicherer DOM-Ersatz aus `test/dom-stub.js`),
   `fetch` (gefälscht), `blockLocalStorage` (Private-Mode), `seedLocalStorage` (Migration),
   `plain(v)` (JSON-Runde gegen Realm-Grenzen bei `deepStrictEqual`).
   Testdateien: `queries` (SQL), `report`/`report-render`/`report-xlsx` (Report-Kern, Render,
   XLSX end-to-end), `betriebsmodus`/`api-anbindung` (Modi, Health, Submit-Poll-Result),
   `proxy` (reine Proxy-Funktionen inkl. JWT gegen RFC-7515), `embedding`/`dom-ids`
   (Struktur-/ID-Wächter).
   **Einschränkung:** Der einfache Stub liefert für **jede** ID irgendein Element — eine
   verwaiste DOM-Referenz fällt so nicht auf. `test/dom-ids.test.js` gleicht deshalb die per
   `getElementById` angefragten IDs statisch gegen das Markup ab; nach UI-Änderungen bleibt
   der Test die Absicherung.
3. Generiertes SQL idealerweise einmal real laufen lassen — im Portal (*Account > Analytics >
   Submit Query*) oder im API-Modus über den Proxy.
4. Version im `<h1>`-Badge und Subtitle nachführen; bei State-Bruch `STORAGE_KEY` erhöhen.
   Der Proxy hat seine eigenen Tests (`test/proxy.test.js`); Änderungen an der API-Anbindung
   möglichst am gestubbten `fetch`/an der ausgehenden Anfrage prüfen, nicht erst live.

## Offene Punkte / Ideen

- Settlement-Referenz-Zuordnung über Withdrawals ist heuristisch (zeitbasiert) —
  beobachten, ob es einen direkten Verknüpfungspfad gibt.
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
