# Wallee Analytics Query Builder

Eigenständige HTML-Applikation (Single File, kein Build, keine Runtime-Dependencies), die
SQL-Queries für **wallee Analytics** (PrestoDB / Amazon Athena) generiert. Zwei
Betriebsmodi: **Kopieren-Modus** (Default) — SQL kopieren und im Portal unter
**Account > Analytics > Submit Query** ausführen; **API-Modus** (opt-in) — Query direkt über
einen lokalen Proxy absetzen. Das Ergebnis landet im modus-eigenen **Abfrage-Verlauf**
(CSV/Excel per Klick abrufbar) und, in den Modi `terminal`, `settlement` und `reporting`,
zusätzlich als gebrandeter Report (Terminal-Report, Settlement-Report bzw.
Reporting-Report).

Entstanden aus einer Kundenanfrage im Gastronomie-Umfeld: Tagesabschluss-Abgleich pro
Terminal, Auszahlungs-Nachvollzug und Kartensuche bei Streitfällen. Seit v4 zusätzlich der
integrierte Terminal-Report (Outlet-/Brand-Gruppen, XLSX-Export) und die direkte
API-Anbindung. Seit v5 der Abfrage-Verlauf, der eigenständige `report`-Modus ist in
`terminal` aufgegangen (Terminal-Report ist jetzt dessen Ausgabe, kein CSV-Upload mehr) und
die Zugangsdaten lassen sich direkt im Einstellungs-Dialog pflegen. Seit v5.5 prüft die App
selbst auf neuere Releases und kann sich im API-Modus per Klick selbst aktualisieren (siehe
„Self-Update" unten). Seit v5.8 ist der `settlement`-Modus **account-** statt space-basiert
und hat mit dem Settlement-Report (Bildschirm, CSV, Excel, PDF) eine eigene Ausgabe erhalten,
analog zum Terminal-Report. Seit v5.11 gibt es als sechsten Modus `reporting` (Händler-KPIs
über **Zahlungsversuche** statt Transaktionen, POS und E-Commerce getrennt) mit dem
Reporting-Report als vierter gebrandeter Ausgabe. Seit v5.12 stehen dessen Ablehngründe im
Klartext (eingebetteter wallee-Katalog, 2'254 Einträge, plus eine Proxy-Route für IDs, die
danach neu vergeben wurden) und seine Verteilungen zusätzlich als Kuchendiagramme — auf dem
Bildschirm und im PDF. Seit v5.14 zeigen `brand` und `terminal` neben dem abgeschlossenen den
**autorisierten Betrag** (fehlende Submissions am Terminal werden sichtbar), der
Terminal-Report-Excel kennt die Varianten **Full / Kondensiert**, und jedes Excel der App
läuft durch eine gemeinsame Finalisierung (gemessene Spaltenbreiten, Druckbild eine Seite
breit, Drucktitel).

## Dateien

| Datei | Zweck |
|---|---|
| `wallee_query_builder.html` | **Aktuelle Version (v5.14.3).** Sechs Modi (Terminal-Report als Ausgabe von `terminal`, Settlement-Report als Ausgabe von `settlement`, Reporting-Report als Ausgabe von `reporting`, seit v5.13 dazu die Seite «3DS-Failures» als **zweite** Ausgabe desselben Modus), zwei Betriebsmodi, Abfrage-Verlauf mit Download-by-Token, Multi-Space, Spaltenauswahl, Terminal-Synchronisierung, Self-Update-Check. Enthält seit v5.12 den eingebetteten Ablehngrund-Katalog (~107 KB, erzeugt von `tools/build-failure-reasons.mjs`) — Gesamtgrösse **~1.59 MB** (1'588'500 Bytes, gemessen 2026-09-12 an v5.14.3; davor 1'551'431 Bytes an v5.13.0 — die Angabe stand über mehrere Versionen still und war zweimal überholt, deshalb hier mit Byte-Zahl und Messdatum). Hier weiterentwickeln. |
| `wallee-proxy.mjs` | Lokaler Zero-Dependency-Proxy für den API-Modus: JWT-Signatur, Analytics-Endpunkte, `/health`, `/setup`, `/credentials`, `/terminals`, `/update`, `/failure-reasons` (öffentliche Doku, **keine** API-Route), **`GET /` (App-HTML servieren)**. Start: `node wallee-proxy.mjs`. |
| `Start-macOS.command` / `Start-Windows.bat` | Doppelklick-Starter: rufen `node wallee-proxy.mjs` mit `WALLEE_OPEN=1` auf (Server serviert die App unter `GET /` und öffnet den Browser). Setzen Node voraus; fehlt es, klarer Hinweis + Download-Seite. Siehe „Launcher-Skripte". |
| `PAKET-ANLEITUNG.md` | End-Nutzer-Anleitung fürs Doppelklick-Starten (inkl. Node-Hinweis und Gatekeeper/SmartScreen-Erststart-Workaround). |
| `sql/settlement_diagnose.sql` | Diagnose-Queries (einzeln ausführen!) um zu prüfen, ob/wie Settlement-Daten befüllt sind. |
| `sql/settlement_reference_reference.sql` | Referenz-Query: funktionierender Settlement-Join (valuedate + withdrawal-Referenz), Basis für das `settle`-CTE in v2. |
| `sql/settlement_verifikation.sql` | Verifikations-Queries für die Settlement-Annahmen (bt.state, Gebühren-Vorzeichen, Auszahlungsdauer, Mehrfach-Settlements, `NO_RECORD`-Anteil) — Kernbefunde an Produktivdaten bestätigt (siehe „Wallee-Referenzwissen"), Queries dienen der erneuten Gegenprüfung in anderen Spaces oder nach Schema-Änderungen. |
| `settlement-report-spec/` | **Nur lokal, bewusst nicht im Git** (siehe `.gitignore`): fachliche Vorgabe des Settlement-Reports (seit v5.10 umgesetzt) — `SPEC.md` (Datenmodell, Aggregation, Aufbau, Edge Cases, Validierungen §7), `GAP-ANALYSIS.md` (was der Report vor v5.10 anders machte), `generate_report.py` (Referenz-Implementierung in Python) sowie die Referenz-Ausgaben `Settlement_Report_Juni-Juli_2026.pdf` / `Settlement_Detail_Juni-Juli_2026.xlsx`. Die Referenzdateien enthalten **echte Produktivdaten** (~69'000 Transaktionen mit Bankreferenzen, namentlich genannter Händler) — dieses Repo ist **öffentlich**, weil das Self-Update ohne Auth von `raw.githubusercontent.com` lädt, deshalb dürfen sie nicht eingecheckt werden. **Bei Änderungen am Settlement-Report zuerst hier nachlesen** — die Referenzdaten sind der Prüfstein (siehe „Gegen die Referenzdaten prüfen" unten). |
| `dashboard/` | Fachliche Vorgabe des **Reporting-Modus** (v5.11): `SPEC.md` (Grundsatzentscheide, Datenmodell der Query, KPI-Katalog K1–K10 / P1–P7 / E1–E6, UI, Edge Cases, Validierung §8), `PLAN.md`/`README.md` sowie unter `sql/` die Discovery-Queries (`00_label_discovery.sql`, `00b_ecom_discovery.sql`) und die **aus dem Builder generierten** Referenz-Queries (`01_reporting_reference.sql`, `01b_reporting_reference_terminal.sql` mit Terminal-Join). Diese Dateien sind im Git. **Nicht** im Git ist `dashboard/discovery-results/` (siehe `.gitignore`): dort liegen die Task-0-CSVs mit Produktivdaten sowie die Referenzausgaben des Reports. `DESCRIPTORS.md` darin ist die **Fundstelle aller Descriptor-IDs**, `ABNAHME.md` der **Abnahme-Nachweis nach SPEC §8** (inkl. der §8.3-Gegenrechnung gegen den `brand`-Modus, Belege `brand_ref_2026-07.csv` / `reporting_ref.csv` / `spec-8-3-vergleich.txt`) — bei Änderungen am Reporting-Modus zuerst dort und in `SPEC.md` nachlesen. |
| `dashboard/SPEC-ITERATION-2.md` | Fachliche Vorgabe der **Iteration 2** (v5.12), datiert 2026-09-03: §1 Ablehngründe im Klartext, §2 Kuchendiagramme, §3 Seite «3DS-Failures», §4/§5 Discovery und die Antworten auf die Support-Anfrage aus Referenzfall B. **Umgesetzt sind §1 und §2**; was offen blieb und warum, steht unter „Offene Punkte". Der Fall selbst (Space-ID, Händler, Volumen, E-Mail-Wortlaut) steht **nicht** hier, sondern in `dashboard/discovery-results/FALL-B.md` (gitignored — das Repo ist öffentlich). |
| `dashboard/catalog/` | Die beiden **gescrapten wallee-Kataloge** als JSON, im Git: `failure-reasons.json` (2'254 Einträge mit Name, Kategorie und Beschreibung, je englisch und deutsch) und `label-descriptors.json` (755 Einträge). Quelle ist die öffentliche Doku-Liste, **kein API-Dienst** (siehe „Ablehngründe"). Aktualisiert mit `dashboard/tools/scrape_wallee_catalogs.py` (Python 3, nur Standardbibliothek) — danach den Build-Schritt erneut laufen lassen. |
| `tools/build-failure-reasons.mjs` | Erzeugt aus `dashboard/catalog/failure-reasons.json` die Konstante `FAILURE_REASONS` zwischen den Markerkommentaren in `wallee_query_builder.html`. **Der einzige Generator im Repo** — er läuft nie zur Laufzeit, die App bleibt eine Single-File-App ohne Build. Idempotent; bricht ab bei fehlenden oder doppelten Markern und bei einer Kategorie, die er nicht kennt. Details unter „Ablehngründe im Klartext (v5.12)". |
| `sql/autorisiert_verifikation.sql` | Discovery-Queries (Task 0 der Iteration «Autorisierter Betrag», v5.14) — einzeln im Portal ausführen: `authorizedon` je Zustand gefüllt (Q1), Alter liegengebliebener Autorisierungen (Q2), `completedamount` vs. `authorizationamount` bei abgeschlossenen Transaktionen (Q3/Q3b), Nullwerte bei `AUTHORIZED` (Q4), Terminal-/Connector-Zuordnung bei `AUTHORIZED` (Q5). Gelaufen am 2026-09-12 an Space 73192 (90 Tage); Ergebnisse lokal in `Terminal-Report-Tool/discovery-results/` (gitignored), Befunde unter „Wallee-Referenzwissen" > „Autorisierter Betrag". |
| `Terminal-Report-Tool/` | **Nur lokal, nicht im Git** (`.gitignore`): `SPEC-ITERATION-2.md` (Stand 2026-09-12) ist die fachliche Vorgabe der v5.14-Iteration — autorisierter Betrag, kondensierter Excel-Report, Druck- und Spaltenoptimierung —, daneben die ältere `SPEC.md` und der Prototyp `terminal-report.html`, aus dem der Terminal-Report entstand. Bei Änderungen an Terminal-Report oder Excel-Finalisierung zuerst dort nachlesen. |
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
- Seit v5.11 kommen für den Reporting-Modus `reportingChannel` (`'BOTH'`),
  `reportingMerchantCountry` (`'CH'`) und `reportingByTerminal` (`false`) dazu — rein
  additiv, **kein** `STORAGE_KEY`-Bump und **kein** Migrations-Marker: ein alter State
  kennt die Felder schlicht nicht und bekommt die Defaults. `loadState()` prüft sie
  allerdings nicht bloss auf Vorhandensein, sondern **auf Gültigkeit** — ein unbekannter
  Kanal fällt auf `'BOTH'` zurück (`REPORTING_KANAL_WAHL`), das Händler-Land läuft durch
  `normLand()` (ISO-2, Grossbuchstaben) mit Rückfall auf `REPORTING_DEFAULT_LAND`. Beides
  scheiterte sonst lautlos: ein unbekannter Kanal würde in `generate()` still zum
  Vollfilter (kein Fehler, nur ein anderer Bericht), und ein Land wie `'Schweiz'` oder
  `'CHE'` würfe im Modell **jede** Karte auf `UNKNOWN`, ohne dass irgendwo etwas rot wird.

Seit v4 enthält die HTML-Datei mehrere `<script>`-Blöcke: den eingebetteten XLSX-Vendor
(`<script id="vendor-xlsx">`, nur für den XLSX-Export), seit v5.8 zusätzlich den eingebetteten
PDF-Vendor (`<script id="vendor-jspdf">`, jsPDF 2.5.2 + jspdf-autotable 3.8.4, UMD, nur für den
Settlement-Report-PDF-Export) und den App-Code (`<script id="app-logic">`) — **drei** Blöcke
insgesamt, in dieser Reihenfolge. Die HTML-Datei ist dadurch **~1.59 MB** gross
(1'588'500 Bytes, gemessen 2026-09-12 an v5.14.3 — davor 1'551'431 Bytes an v5.13.0, „~1.41 MB"
aus v5.12.0 und lange „~1.06 MB" aus v5.8; **die Zahl veraltet mit jeder Version, deshalb
steht das Messdatum dabei und beim Bump wird nachgemessen statt geschätzt**. Seit v5.12 kommen die
~107 KB des eingebetteten Ablehngrund-Katalogs dazu, siehe „Reporting-Report"). Der Vendor
`vendor-xlsx` ist seit v5.1 **`xlsx-js-style` 1.2.0** (~425 KB minified, MIT-Fork von SheetJS
0.18.5) statt der reinen SheetJS Community Edition: nur dieser Fork kann beim Schreiben
**Zellstile** (Fill/Font/Border) setzen, was der XLSX-Export für die wallee-Optik braucht. Die
Community Edition konnte nur Zahlformate (`z`). API bleibt Drop-in-kompatibel (`XLSX.utils.*`).
Das Test-Harness extrahiert gezielt den `app-logic`-Block; die reinen Funktionen brauchen keinen
der beiden Vendoren. Beim Einbetten minifizierten Codes muss die
Ersetzung eine Replacer-**Funktion** nutzen — String-Ersatz deutet `$&`/`` $` ``/`$1` als
Muster und beschädigt den Code still (siehe `test/embedding.test.js`).

### Sechs Modi

1. **`brand`** – Aggregat pro Space × Brand × Währung (`GROUP BY`). Spalten: Anzahl,
   `unsettled_anzahl` (keine Gebühr UND kein Settlement-Record = wartet noch auf die
   Abrechnung), Brutto, **`autorisiert_gross`** (seit v5.14, direkt rechts von
   `brutto_gross`), Fees, Netto, `tip_total` (Trinkgeld-Anteil, bereits im Brutto
   enthalten).
   **Seit v5.14 ist die Basis grösser als in allen übrigen Modi:** `txCte({ …,
   autorisiert: true })` und das Hauptselect filtern auf
   `COALESCE(t.completedon, t.authorizedon)` und `t.state IN ('AUTHORIZED', 'FULFILL',
   'COMPLETED')`. Für abgeschlossene Transaktionen ist das exakt die alte Menge; dazu kommen
   offene Autorisierungen (freigegeben, aber ohne Submission/Tagesabschluss), eingeordnet
   nach ihrem Autorisierungszeitpunkt — wird eine später abgeschlossen, wandert sie in den
   Zeitraum ihres `completedon`, wird sie storniert (`VOIDED`), verschwindet sie. Damit die
   bisherigen Zahlen **byte-identisch** bleiben (SPEC A1), sind `anzahl_transaktionen` und
   `unsettled_anzahl` **und seit v5.14.1 `tip_total`** per `CASE` auf `FULFILL`/`COMPLETED`
   geschützt (gemeinsame Konstante `AGGREGAT_KENNZAHLEN`). Der Tip-Guard ist **gemessen**:
   Discovery Q4 (Space 73192, 2026-09-12) fand unter 64 `AUTHORIZED`-Transaktionen eine mit
   Trinkgeld-Lineitem — ohne Guard wäre `tip_total` nicht mehr byte-identisch gewesen.
   `brutto_gross`, Fees und Netto brauchen keinen Guard: `completedamount` und
   `totalappliedfees` waren bei allen 64 exakt 0 (derselbe Lauf, siehe
   „Wallee-Referenzwissen"). Eine Gruppe nur aus `AUTHORIZED`-Transaktionen erscheint als Zeile
   mit `brutto_gross = 0`, `anzahl_transaktionen = 0`, `autorisiert_gross > 0` — genau die
   Zeile, die die fehlende Submission zeigt.
2. **`terminal`** ("Terminal-Report" im Mode-Selector) – wie `brand`, zusätzlich
   Pflichtfilter + Gruppierung auf `paymentterminal.identifier` / `.name`. Gleiche
   `unsettled_anzahl`/`tip_total`/`autorisiert_gross`-Spalten und dieselbe erweiterte Basis. Der frühere eigenständige `report`-Modus (CSV-
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
6. **`reporting`** ("Reporting" im Mode-Selector, seit v5.11) – Händler-KPIs pro Kanal
   (POS / E-Commerce). **Basis ist der Charge Attempt, nie die Transaktion** (SPEC 2.1):
   im E-Commerce entsteht eine Transaktion bereits beim Befüllen des Warenkorbs, eine
   Erfolgsquote über Transaktionen wäre also systematisch falsch — sie zählte
   Warenkörbe, nicht Zahlungsversuche. Der Entscheid gilt bewusst für **beide** Kanäle,
   damit POS und E-Com dieselbe Definition haben und die Query nur einmal existiert.
   `buildReportingQuery({ spaceIds, start, end, channels, byTerminal, terminalIds })`
   liefert **ein** CSV mit drei per `UNION ALL` verbundenen Blöcken (`DIM`/`TIME`/`CONV`,
   Details unter „Reporting-Report" unten), also vor-aggregierte Zählwerte statt einer
   Zeile je Versuch. Space-Filter wie in `brand`, Terminal-Filter optional. Ausgabe ist
   der **Reporting-Report** (eigener Abschnitt unten).
   **Zeitfilter auf `ca.createdon`, nicht auf `t.completedon`** (SPEC 2.2) — ein
   gescheiterter Attempt hat gar kein `completedon`, über `t.completedon` gefiltert
   verschwänden genau die Versuche, um die es geht. Das ist die **einzige Ausnahme** von
   der sonst durchgehenden Regel „Zeitfilter immer auf `t.completedon`" (siehe
   „SQL-Erzeugung"), und es bedeutet, dass der Zeitraum-Picker in diesem Modus etwas
   anderes meint als in allen übrigen: den Zeitpunkt des **Zahlungsversuchs**, nicht den
   des Abschlusses. Zahlen aus `reporting` und aus `brand` über denselben Zeitraum können
   deshalb an den Rändern auseinanderlaufen — das ist erwartet, kein Fehler (SPEC 8.3),
   und seit der Abnahme vom 2026-09-02 auch **gemessen**: im E-Commerce stimmen beide
   Modi auf den Rappen, am POS weicht der Reporting-Umsatz um **−1.1 %** ab (siehe
   „Reporting-Modus (v5.11)" unter „Offene Punkte"). **Der Reporting-Report ist deshalb
   kein Werkzeug zur Umsatz-Abstimmung** — dafür `brand` oder `settlement`.
   Der Modus filtert zusätzlich fest auf **`ca.environment = 'PRODUCTION'`**
   (`ATTEMPT_ENVIRONMENT`): Testtransaktionen verfälschen jede Quote.
   **Seit v5.13 setzt derselbe Modus eine zweite, zeilenweise Abfrage ab**
   (`buildReportingTdsQuery`, eigener `queryToken`) und zeigt daraus die Seite
   **«3DS-Failures»** — eine Zeile je gescheitertem 3DS-Versuch, fest auf E-Commerce.
   Zwei Abfragen statt einer, damit das Aggregat PII-frei und weitergabefähig bleibt;
   Details im eigenen Abschnitt unten. Ein **siebter Modus ist das nicht**: es gibt keinen
   Knopf dafür, `reporting-tds` existiert nur als Verlaufs-Modus.

Sichtbarkeit der Panels steuert `setMode()` über die CSS-Klasse `.cond-section.active`
bzw. `.hidden`. Terminal-Panel aktiv in `terminal`/`export`/`card` (seit v5.8 **nicht** mehr
in `settlement`), Spalten-Panel nur `export`, Kartensuche-Panel nur `card`,
Settlement-Panel (`settlementSection`, Account/Super-User/Detail) nur `settlement`,
Report-Panel (Terminal-Report) nur `terminal`, Settlement-Report-Panel
(`settlementReportSection`) nur `settlement`, Reporting-Panel (`reportingSection`, Kanal/
Händler-Land/Terminal-Aufschlüsselung) und Reporting-Report-Panel
(`reportingReportSection`) nur `reporting`. Das 3DS-Failure-Panel (`reportingTdsSection`,
seit v5.13) ist das **einzige, das nicht allein am Modus hängt**: es steht nur im Modus
`reporting` **und** nur, wenn es etwas zu zeigen gibt — ein 3DS-Modell **oder** eine
Statuszeile (ohne die zweite Bedingung wäre eine Fehlermeldung des Imports unsichtbar,
siehe „Die Seite «3DS-Failures»" unten). Das Space-Panel (`spaceSection`) wird im
Modus `settlement` zusätzlich per `.hidden` ausgeblendet — der Modus ist account-, nicht
space-basiert, eine Space-Auswahl wäre dort irreführend; in `reporting` bleibt es sichtbar
(der Modus filtert nach Space). Die Modus-Whitelist in `loadState()` ist
`['brand','terminal','export','card','settlement','reporting']` — ein alter State mit
`mode: 'report'` wird gezielt auf `terminal` migriert statt auf `brand` zurückzufallen
(siehe „State & Persistenz" oben).

**Das Terminal-Panel ist im Modus `reporting` als einziges *dynamisch* geschaltet:** nicht
am Modus, sondern an `reportingTerminalPanelSichtbar(kanal, byTerminal)` =
`byTerminal && kanal !== 'ECOM'`. Dieselbe reine Funktion sitzt an drei Stellen — in
`setMode()` (als Teil von `showTerminal`), in `aktualisiereReportingTerminalPanel()`
(Handler von Checkbox und Kanal-Radios) und in `generate()`, wo sie entscheidet, ob die
Terminal-Auswahl überhaupt in die Query geht. Der dritte Aufruf ist der wichtige: ohne
ihn filterte eine im `terminal`- oder `export`-Modus stehengebliebene Terminal-Auswahl
unsichtbar mit, obwohl das Panel gar nicht eingeblendet ist. Ein Klick auf Checkbox oder
Radio blendet das Panel sofort ein bzw. aus, ohne Moduswechsel.

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
`t.spaceId`, mit **Rückfall auf den führenden ID-Teil des Anzeige-Tags** („90004 · Zürich" →
`90004`), damit auch vor v5.7 synchronisierte Terminals ohne erneuten Sync zugeordnet werden.
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

Reine, DOM-freie Funktionen (über das Harness testbar), plus eine dünne UI-Schicht.
Fachliche Vorgabe der v5.14-Änderungen: `Terminal-Report-Tool/SPEC-ITERATION-2.md`
(lokal, gitignored).

**Autorisierter Betrag (v5.14, SPEC §4):**

- `parseReportCsv` liest die **optionale** Spalte `autorisiert_gross` als Feld `authorized`
  (1e-8-Einheiten). Fehlt sie (älteres CSV, die Fixture), gilt `authorized = gross` — kein
  Fehlerobjekt. `leereKennzahlen`/`addiere` führen das Feld, das Modell summiert es auf
  allen Ebenen wie `completeDemand` (`autorisiertVon(row)` fällt bei handgebauten Zeilen
  ohne Feld auf `gross` zurück, damit nie `NaN` entsteht). `autorisiertDifferenz(k)` =
  `authorized − completeDemand`, exakt als Ganzzahl.
- **Kennzahl-Reihenfolge überall:** `Complete Demand · Authorized · Tip · Unmatched · Anz.`
  (`KENNZAHL_DEFS`: Kopf, Typ, Zugriff in **einer** Tabelle; `KENNZAHL_KOPF` für den
  Bildschirm). Im Kopf englisch wie die bestehenden Spalten (Entscheid O1); „Autorisiert"
  heisst die Kennzahl nur im Hinweistext.
- **Differenz orange** (`--wallee-orange` = `#ff4d00`, XLSX `XLSX_FARBE.orange`): weicht
  `authorized` vom `completeDemand` ab, trägt die Authorized-Zelle die Klasse
  `autorisiert-diff` bzw. im Excel orange, fette Schrift — auf jeder Ebene bis zum
  Gesamttotal, weil die Differenz der Zeilen durchschlägt. Im Excel steht rechts neben dem
  Gesamttotal zusätzlich `Differenz:` + Betrag, nur wenn ≠ 0 (dann zwei Spalten mehr in der
  Blattbreite). CSV bleibt unformatiert.
- **Hinweis G2 = `AUTORISIERT_HINWEIS`**, Wortlaut ist Vorgabe und steht überall identisch:
  Bildschirm (direkt unter dem Titel „Detail" und unter „Gesamttotal" — der Druck/PDF-Pfad
  des Terminal-Reports ist `window.print()` über die Bildschirmansicht, die Absätze drucken
  also mit; eine eigene Fusszeilen-Mechanik gibt es hier nicht), CSV (letzte Zeile nach einer
  Leerzeile), Excel (unter „Erstellt am …" **und** als Fussnote nach dem letzten Block),
  Panel der Modi `brand`/`terminal` (`#autorisiertHint`, Text zur Laufzeit aus der
  Konstante) und Verlaufs-Excel (siehe „Abfrage-Verlauf"). Die in SPEC O3 erwogene
  Ergänzung „… oder eine Teil-Einreichung" ist **nicht nötig**: Discovery Q3 (Space 73192,
  98'233 abgeschlossene Transaktionen) fand **null** Zeilen mit `completedamount ≠
  authorizationamount`. Sollte ein anderer Space Teil-Captures zeigen, ist es **nur** die
  Konstante.
- **Excel-Varianten Full / Kondensiert (SPEC §5.1–5.2):** `reportExportBloecke(modell,
  { variante })` — `'full'` (Default, auch bei unbekanntem Wert; `reportVariante()`) ist
  byte-identisch zu vorher plus Authorized; `'kondensiert'` verdichtet das Detail auf **eine
  Zeile je Terminal × Brand-Gruppe** (`brandGruppenSummen`: Marken in 1e-8-Einheiten
  summiert, erst dann `unitsZuZahl`; keine Spalte „Marke") und lässt `Unmatched`/`Anz.` in
  **allen** Blöcken weg (`KENNZAHLEN_KONDENSIERT`). Die Verdichtung ist eine
  Export-Entscheidung (G4): ein Modell, die Blockschicht verdichtet. **CSV und PDF bleiben
  Full.** Titel `REPORT_XLSX_TITEL[variante]`, Dateiname `terminal-report_<datum>.xlsx`
  bzw. `terminal-report-kondensiert_…` (`reportDateiname(endung, variante)`).
- **Dateiname nach Inhalt (v5.14.3):** `reportDateinameBauen({ endung, variante, spaces,
  zeitraum, heute })` → `terminal-report[-kondensiert]_<Space>_<von>_<bis>.<endung>`, z. B.
  `terminal-report_Jade-Lounge_2026-07-01_2026-07-31.xlsx` — der Name sagt, was drin ist,
  das Erstelldatum steht im Blatt. ISO-Daten (sortieren chronologisch), Ende `00:00:00`
  exklusiv über `berichtsEndeTag`. Space-Name aus dem `label` der Space-Liste, sonst die ID;
  zwei Spaces `A+B`, ab drei `A+2-weitere`. `dateinameSicher()` ersetzt, was Dateisysteme
  nicht mögen (`/ \ : * ? " < > |`, Steuerzeichen, Leerraum) durch `-` und kürzt auf 60
  Zeichen. Die Spaces kommen wie der Zeitraum aus `reportSpacesErmitteln(filter, eintrag,
  state.spaces)` — beim Submit aus dem Filter, beim Token-Abruf aus dem Verlaufseintrag
  (seit v5.14.3 additives Feld `spaces: [{ id, label }]`), bei älteren Einträgen aus der
  Zusammenfassung «Space <id>». Ohne Zeitraum fällt der Name auf das Erstelldatum zurück wie
  bis v5.14.2; gilt für Excel **und** CSV des Terminal-Reports.
- **Abfragezeitraum (v5.14.2):** Excel (Zeile «Abfragezeitraum: …» direkt unter «Erstellt am»,
  vor dem Hinweis G2 — die erste türkise Kopfzeile und damit der Drucktitel liegt dadurch in
  Zeile 7) und Druckkopf (`#reportPrintZeitraum`, «Abfragezeitraum 01.07.2026 – 31.07.2026»)
  zeigen, was die Daten umfassen. Quelle ist `reportZeitraum`, gesetzt in
  `holeErgebnisInReport(token, account, filter)` über `reportZeitraumErmitteln(filter,
  eintrag)`: beim Submit der **Filter des Laufs**, beim Token-Abruf der **Verlaufseintrag des
  Tokens** (seit v5.14.2 mit additiven Feldern `start`/`end` samt Uhrzeit) — **nie der
  Picker**, der kann längst woanders stehen. Ältere Einträge ohne `start`/`end` liefern ihre
  Tages-Zusammenfassung («2026-07-01 → 2026-07-31») als Text, ohne Eintrag bleibt die Angabe
  leer bzw. «–» statt erfunden. Formatiert über `reportingZeitraumText` (Ende `00:00:00`
  exklusiv, gleiche Lesart wie Settlement- und Reporting-Report). CSV bleibt ohne die Zeile —
  eine erste Zeile vor der Kopfzeile bräche jeden Import.
- **Dialog vor dem Excel-Export:** `reportXlsxBtn` öffnet `#reportXlsxDialogOverlay`
  (Muster `settingsOverlay`; Hintergrund-Klick, Esc, Schliessen und Abbrechen = kein
  Export), exportiert wird nur über „Excel erstellen". Die Wahl wird unter
  `wallee_terminal_report_xlsx_variante` (`REPORT_XLSX_VARIANTE_KEY`, Private-Mode-sicher,
  Erstwert `'full'`) gemerkt und beim nächsten Öffnen vorausgewählt. Zusätzlich merkt sich
  der **Verlaufseintrag** des Tokens, aus dem der Report stammt (`reportQuelleToken`, in
  `holeErgebnisInReport` gesetzt), die zuletzt exportierte Variante (Entscheid O2, siehe
  „Abfrage-Verlauf").

**Bewusste Abweichungen von `Terminal-Report-Tool/SPEC-ITERATION-2.md`** (jede offengelegt):

1. **`xlsxSpaltenbreiten` misst das fertige Blatt (`ws`), nicht `(aoa, typen)`** wie in §5.4
   skizziert. Die sechs Blatt-Builder haben verschiedene Zeilenformen (gestapelte Blöcke mit
   wechselnden Spaltentypen, Kachel-Blöcke mit gemischter Wert-Spalte); am fertigen Blatt
   stehen Zahlformat und Fettschrift je Zelle bereits fest, und die Funktion bleibt trotzdem
   vendorfrei (eigene `A1`-Zerlegung). Das Ergebnis ist dasselbe, der Vertrag ein anderer.
   **Und die Breite ist nicht „Länge + 2"** (§5.4), sondern kalibriert — siehe
   „Excel-Export: gemeinsame Finalisierung": mit „+ 2" waren die Spalten in v5.14.0 sichtbar
   zu breit, an einem echten Export nachgemessen.
   **Folge, die zu kennen ist:** die Blöcke eines Blatts **teilen sich die Spalten**. Deshalb
   stehen im Terminal-Report-Excel seit v5.14.1 die Kennzahlen **jedes** Blocks rechtsbündig
   unter denen des Detail-Blocks (`spalteIm`/`verteile` in `exportReportXlsx`, leere Zellen
   dazwischen): vorher mass die TID-Spalte den Kopf „Complete Demand" des Blocks „Total
   Outlet-Gruppen" darunter (19 statt 8 Zeichen). CSV bleibt blockweise ohne Auffüllung.
2. **Die Orange-Zelle ist zusätzlich fett** (§4.3 nennt nur die Schriftfarbe) — Orange allein
   ist auf dem hellen Grund als Zahl schwer zu lesen; bewusst, nicht versehentlich.
3. **Der PDF-Hinweis ist kein eigener Fusszeilen-Mechanismus** (§4.4 spricht von der
   „bestehenden Fussnoten-Mechanik") — der Terminal-Report druckt die Bildschirmansicht
   (`window.print()`), die beiden Hinweis-Absätze drucken mit; der erste steht unter
   „Detail" auf der ersten Seite.
4. **Der Verlauf trägt die Variante als Feld und Zusammenfassung** („Excel: Kondensiert"),
   nicht als Teil eines Dateinamens (O2 sprach von „Dateinamen des Verlaufs-Eintrags") — die
   Verlaufszeile hat in Report-Modi nur den Roh-CSV-Download, einen Excel-Dateinamen gibt es
   dort nicht.

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

### Excel-Export: gemeinsame Finalisierung (seit v5.14, SPEC §5.3–5.5)

**Jedes** von der App erzeugte Blatt (Terminal-, Settlement-, Reporting-Report, 3DS-Seite,
Verlaufs-Download) läuft unmittelbar vor `book_append_sheet` durch
**`xlsxBlattFinalisieren(ws, { kopfZeile, querformat })`**, und jede Mappe wird über
**`xlsxSchreibenUndLaden(wb, dateiname)`** geschrieben — die **eine** Stelle für
`XLSX.write` + `downloadDatei` (der Settlement-Export ist damit von `XLSX.writeFile` weg).
Reine Funktionen, vendorfrei testbar (`test/xlsx-layout.test.js`); End-to-End mit dem Vendor
in `report-xlsx`, `history-xlsx`, `reporting-xlsx`, `reporting-tds-xlsx`.

- **Spaltenbreite (§5.4, kalibriert in v5.14.1):** `xlsxSpaltenbreiten(ws)` → `!cols`, je
  Spalte der längste Anzeigetext **in Excels Einheit, der Ziffernbreite der Standardschrift
  (Calibri 11)**: Zahlen zählen voll (nach ihrem Zahlformat, `xlsxZahlAnzeige(wert, fmt)`:
  Nachkommastellen aus dem Muster, Tausendertrennung bei `,`, Literale in Anführungszeichen
  wie `" CHF"`/`"%"` angehängt), Fliesstext × `XLSX_TEXT_FAKTOR` 0.88, Schriftgrösse ×
  `sz/11` (Datenzellen stehen in 10 pt), fett × 1.1, dazu 1 Zeichen Polster
  (`XLSX_SPALTE_POLSTER`; SheetJS legt beim Schreiben von sich aus ~0.8 Einheiten Zellpolster
  dazu). „Länge + 2" aus der Spec ergab an einem echten Export sichtbar zu breite Spalten —
  die Spec rechnet in Zeichen, Excel in Ziffernbreiten. Über mehrere Spalten **verbundene**
  Zellen (Titel, Hinweise) werden nicht gemessen — sonst bläht ein Hinweis Spalte A auf; ein
  überlanger Text bekommt `wrapText` über den Zellstil. Grenzen 6 … 60 Zeichen. Der Reader
  liefert `!cols` nur mit `cellStyles: true`.
- **Ränder und Seitenlayout (§5.3):** `XLSX_RAENDER` (0.5"/0.75"/0.3"), `xlsxSeitenlayout
  (spalten)` = A4 (`paperSize` 9), `fitToWidth 1`, `fitToHeight 0` (automatisch),
  Hochformat bis 8 Spalten, **Querformat ab 9** (`XLSX_QUERFORMAT_AB_SPALTEN`); der Full-
  Terminal-Report (10 Spalten) und das Settlement-Transaktionsdetail landen damit quer.
- **Der Vendor schreibt `!margins` und Defined Names, aber kein `pageSetup` und kein
  `fitToPage`** (Machbarkeit gemessen, §5.3 Schritt 1: `!pageSetup` am Blatt wird still
  ignoriert). Deshalb die **ZIP-Nachbearbeitung** in `xlsxSchreibenUndLaden`: `XLSX.CFB.read`
  öffnet das ZIP (CFB liest ZIP-Container; `CFB.find` verlangt den Pfad mit führendem `/`),
  je Blatt `i` wird `xl/worksheets/sheet<i+1>.xml` (SheetJS schreibt in `SheetNames`-
  Reihenfolge) durch **`xlsxSeitenlayoutEinbetten(sheetXml, layout)`** geschickt —
  `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` als erstes Kind von `<worksheet>` (ein
  vorhandenes `<sheetPr>` wird ergänzt, `pageSetUpPr` ist laut Schema sein letztes Kind),
  `<pageSetup …/>` direkt nach `<pageMargins/>`; ohne das fitToPage-Flag ignoriert Excel
  `fitToWidth`. Reiner String-Code, **idempotent**, Replacer-Funktionen statt Ersatz-Strings
  (dieselbe `$&`-Falle wie beim Vendor-Einbetten). `XLSX.CFB.write(cfb, { fileType: 'zip',
  type: 'array' })` schreibt zurück. **Scheitert die Nachbearbeitung, geht die Datei
  unverändert raus** (Rückfall statt Blockade). `!pageSetup` und `!druckTitel` sind eigene
  Schlüssel am Blatt, die der Writer toleriert und die nur die Angaben bis zum Schreiben
  tragen. **Der Vendor bleibt unangetastet** (Self-Update-Pfad, `embedding.test.js`).
- **Drucktitel:** `kopfZeile` (0-basiert, die erste türkise Kopfzeile) wird als
  `_xlnm.Print_Titles` in `wb.Workbook.Names` eingetragen (`xlsxDruckTitelRef`: Blattname in
  einfachen Anführungszeichen, verdoppelt falls enthalten, `$n:$n`) — das kann der Writer
  selbst, ohne Nachbearbeitung. Beim Terminal-/Reporting-Blatt ist das die Kopfzeile des
  **ersten** Blocks; die Kopfzeilen der weiteren Blöcke wiederholen sich nicht.

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

### Reporting-Report (Ausgabe des Modus `reporting`, seit v5.11)

Fachliche Vorgabe: **`dashboard/SPEC.md`**, Fundstelle aller Descriptor-IDs:
`dashboard/discovery-results/DESCRIPTORS.md` (Task 0, nicht im Git). Gebaut wie die beiden
anderen Reports: reine, DOM-freie Funktionen plus eine dünne UI-Schicht, harness-getestet in
`test/reporting-queries.test.js`, `test/reporting-model.test.js` (enthält auch die
Parser-Tests), `test/reporting-export.test.js`, `test/reporting-render.test.js`,
`test/reporting-ui.test.js` und `test/reporting-xlsx.test.js`. Wie der Settlement-Report hat
er **keine** persistente Gruppen-Konfiguration — er ist eine reine Auswertung des
Query-Ergebnisses. Anders als die beiden anderen kennt er einen **CSV-Import**
(Kopieren-Modus, siehe „UI" unten).

#### Die Query: drei Blöcke in einem CSV

`buildReportingQuery` baut ein CTE `att` (eine Zeile je Charge Attempt, alle abgeleiteten
Spalten entstehen dort einmal) und darüber **drei** per `UNION ALL` verbundene `SELECT`s,
unterschieden durch die erste Spalte `block`:

- **`DIM`** — `GROUP BY` über 16 Dimensionen (Space, Kanal, Brand, Wallet, Währung,
  `attempt_state`, Ablehngrund, Ablehncode, Issuer-Land, Kartenkategorie, Funding,
  PAN-Typ, DCC, 3DS-Start, CAVV, ECI; mit Terminal-Aufschlüsselung 18). Trägt
  `anzahl_attempts`, `summe_betrag`, `summe_betrag_failed`, `summe_refund`, `summe_tip`.
  **Kein `anzahl_transaktionen`** — die Spalte gab es bis v5.11 und niemand las sie:
  `COUNT(DISTINCT transaction_id)` ist über DIM-Tupel hinweg nicht summierbar (dieselbe
  Transaktion steckt beim Retry in mehreren Tupeln), deshalb kommen Transaktionszahl und
  Retry-Rate ausschliesslich aus `CONV`. Sie kostete in Athena ein `DISTINCT` über 16–18
  Gruppierungsspalten und im Parser eine Pflichtspalte, die nichts absicherte.
- **`TIME`** — `GROUP BY` Space, Kanal, Brand, Währung, `attempt_state`, `date(ca.createdon)`,
  `hour(ca.createdon)`. Verlauf und Stosszeiten.
- **`CONV`** — `GROUP BY` Space, Kanal, Brand, Währung mit `tx_mit_attempt` und
  `tx_erfolgreich`. **Warum ein eigener Block:** `COUNT(DISTINCT transaction_id)` ist über
  DIM-Tupel hinweg **nicht summierbar** — eine Transaktion kann beim Retry die Brand
  wechseln und stünde dann in zwei Tupeln. Aus derselben Ursache ist auch die
  Conversion/Retry-Rate auf Kanal-Ebene nur eine **Obergrenze des Nenners** (CONV ist nach
  Brand gruppiert); genau deshalb weist SPEC 3.2 den Block „nur pro Brand/Total" aus.
  **Je Gruppe gilt `tx_erfolgreich` = Anzahl der `SUCCESSFUL`-Attempts** — nicht als
  Näherung, sondern zwingend aus „pro Transaktion höchstens ein erfolgreicher Attempt"
  (derselben Zusicherung, die P3 exakt macht): jeder Erfolg gehört zu einer anderen
  Transaktion. Am Referenzlauf in allen 17 CONV-Gruppen exakt bestätigt, ebenso
  `tx_erfolgreich ≤ tx_mit_attempt ≤ Attempts` und die 1:1-Entsprechung von DIM- und
  CONV-Gruppen. Die Fixture leitet ihren CONV-Block seither daraus ab statt ihn zu setzen
  (`test/reporting-model.test.js` nagelt die Invariante fest).

Die Vor-Aggregation in SQL ist Absicht (SPEC 2.4): das CSV bleibt bei hunderten bis wenigen
tausend Zeilen statt zehntausenden, es enthält **keine personenbezogenen Daten** — und genau
deshalb ist der CSV-Import im Kopieren-Modus überhaupt vertretbar.

**`UNION ALL` verlangt identische Spaltenlisten in identischer Reihenfolge — und Presto
zusätzlich denselben Typ je Position.** Deshalb führen `TIME` und `CONV` jede DIM-Spalte als
**typisierten Platzhalter** mit (`CAST(NULL AS varchar|date|integer|bigint|boolean|
decimal(38,8))`), und auch die echten Betragssummen sind explizit auf `decimal(38,8)`
gecastet, statt sich auf die Typ-Herleitung des Optimizers zu verlassen — bei Decimals kann
die an der Präzisionsgrenze scheitern. Ein untypisiertes `NULL` an einer Position ist kein
kleiner Schönheitsfehler: findet Presto keinen gemeinsamen Supertyp, scheitert die **ganze**
Query. Aus demselben Grund steht `failure_reason_id` in allen drei Blöcken als `varchar`
(`CAST(failure_reason_id AS varchar)` im DIM-Block) — der Typ von `chargeattempt.failurereason`
ist nicht belegt, und die ID ist ohnehin nur ein Nachschlageschlüssel, nie ein Rechenwert.

#### Descriptor-Konstanten und der Map-Key

Karten-Attribute kommen ausschliesslich aus `chargeattempt.labels` — das Analytics-Schema hat
keine Karten-/Issuer-Tabelle. Der Zugriff läuft über den Helfer

```js
labelExpr(id, key)  // element_at(filter(ca.labels, l -> l['descriptor'] = '<id>'), 1)['<key>']
```

— dasselbe Muster wie im `cardCte`. **Der Map-Key ist descriptorabhängig**, und das ist der
zentrale Fallstrick dieses Modus: `countryContent` (Issuer Country), `dateTimeContent`
(3-D Secure Process Started), `longTextContent` (CAVV), sonst `shortTextContent` (Default des
Helfers). Ein falsch geratener Key wirft **nicht** — er liefert `NULL`, und zwar dauerhaft
und ohne jede Meldung: die KPI steht dann für immer auf „Unbekannt", und niemand merkt es.
Genauso verhält sich eine falsch geratene Descriptor-ID. Deshalb ist **jede** Konstante an
Produktivdaten ermittelt (Task 0) und trägt ihren Key als Kommentar — **auch der Key ist
gemessen, nicht angenommen.** Belegstelle ist die Spalte `ohne_shorttext` der
Discovery-Query Q2 (`dashboard/sql/00_label_discovery.sql`): sie zählt die Attempts, bei
denen `shortTextContent` `NULL` ist, und steht in der Ergebnistabelle unten für jeden
Descriptor mit dem Default-Key auf **0**, zusammen mit den erwarteten Werten. Umgekehrt
steht sie bei Issuer-Land, 3-D-Secure-Start und CAVV auf der vollen Attempt-Zahl bei 0
gefundenen Werten — genau daran wurden deren abweichende Keys überhaupt erst erkannt. Die
Zusammenfassung in `dashboard/discovery-results/DESCRIPTORS.md` führt die Key-Spalte nur
dort, wo der Key vom Default abweicht; **das ist eine Kürzung der Darstellung, kein
fehlender Beleg** — der Beleg steht in den Q2-CSVs daneben.

| Konstante | ID | Map-Key |
|---|---|---|
| `SALES_CHANNEL_POS` / `SALES_CHANNEL_ECOM` | `1582819151330` / `1582816223150` | — (`ca.saleschannel`) |
| `DESC_ISSUER_COUNTRY` | `1474552618629` | **`countryContent`** |
| `DESC_CARD_TYPE` (Funding CREDIT/DEBIT) | `1474552618699` | `shortTextContent` |
| `DESC_CARD_CATEGORY` (Business/Privat) | `1474552618999` | `shortTextContent` |
| `DESC_AUTH_RESPONSE_POS` (ISO-8583) | `1579287790513` | `shortTextContent` (Q2: 14 Werte `00`…`Z3`) |
| `DESC_AUTH_RESPONSE_ECOM` (Processor) | `15537739985478` | `shortTextContent` (Q2: 5 Werte) |
| `DESC_DCC_CURRENCY` (nur Existenz) | `1695119783358` | `shortTextContent` (Q2: `EUR`/`SEK`) |
| `DESC_PAN_TYPE` | `1634723429555` | `shortTextContent` (Q2: 5 Werte) |
| `DESC_TDS_STARTED` | `1568637480278` | **`dateTimeContent`** |
| `DESC_TDS_CAVV` (nur Existenz) | `1569496536590` | **`longTextContent`** |
| `DESC_ECI` | `1634723429552` | `shortTextContent` |

Die beiden Ablehncode-Descriptors stehen in einem `COALESCE` — ein Attempt trägt immer nur
eines der beiden Labels (POS: Issuer-Code, E-Commerce: Processor-Code).

**PII-Sperrliste (SPEC 9): `1456765000789` (Card Holder Name) und `1456765125779`
(Masked Card Number, `DESC_MASKED_CARD`) dürfen in der Reporting-Query nie vorkommen** —
weder in einer Ausgabespalte noch in einem `GROUP BY`. Beide sind an Produktivdaten belegt
vorhanden (Card Holder Name im Klartext, 245 Attempts im Referenzmonat); die Query gibt
ausschliesslich Aggregate aus, und das soll so bleiben. Im Code steht die Sperrliste als
Kommentar direkt bei den Konstanten. **CAVV wird ausschliesslich als Existenzprüfung
verwendet** (`… ['longTextContent'] IS NOT NULL AS tds_cavv`) — das Kryptogramm selbst ist
ein Sicherheitsmerkmal und darf nie in eine Spalte geraten; ein Test zählt deshalb, dass der
Descriptor im gesamten SQL genau **einmal** vorkommt.

#### Herkunft, Kartentyp, 3DS — die Klassifikation

Alles clientseitig im Modell, aus den Rohwerten der Query:

- **`klassifiziereHerkunft(issuerCountry, merchantCountry)`** → `DOMESTIC` (gleich) /
  `INTRA` (Issuer-Land in `EUROPA_REGION`) / `INTER` / `UNKNOWN`. `EUROPA_REGION` ist ein
  ausgeschriebenes 32-Element-ISO-2-Set (EU-27 + IS/LI/NO + CH/GB) — es folgt dem
  **Interchange-Regime**, nicht der EU-Mitgliedschaft (daher GB), und eine Herleitung zur
  Laufzeit würde bei politischen Änderungen stumm mitwandern.
  **Ein Wert, der kein ISO-2-Code ist, ergibt `UNKNOWN` — nie `INTER`** (SPEC 7): „Ausland"
  wäre eine Aussage, die aus einem Formatfehler entstünde. Das gilt für `'CHE'` (ISO-3)
  ebenso wie für einen Klarnamen oder ein leeres Feld, und ebenso für ein ungültiges
  **Händler**-Land — ohne Inland gibt es kein „domestisch".
- **`istKartenBrand`** (`KARTEN_BRANDS`) trennt Marken **mit** Issuer-Labels von TWINT,
  Lunch Check, Reka, Boncard, PowerPay Invoice: die tragen keine. Label-lose Marken laufen
  gar nicht erst in die Karten-Eimer (K5/K6/P1/P7), statt den `UNKNOWN`-Eimer aufzublähen.
  **`PostFinance` steht seit dem Referenzlauf mit in der Liste** — der Lauf hat gezeigt,
  dass „steht nicht in der Liste" und „trägt keine Labels" **nicht** dasselbe sind (siehe
  „Wallee-Referenzwissen"). Bewusst der **blosse Markenname**, nicht `PostFinance Card`:
  derselbe Lauf zeigt daneben `PostFinance Apple Pay`, zwei Literale hätten die dritte
  Schreibvariante wieder verpasst. Die Liste bleibt damit eine **Namensliste und
  connectorabhängig** — die nächste lokale Debitkarte eines anderen Acquirers braucht
  denselben Nachtrag; erkennbar ist der Fall daran, dass ein Brand ausserhalb der Liste
  Issuer-Labels trägt.
  **Der Hinweistext unter K5/K6/P1 (`kartenHinweis`) nennt deshalb bewusst keine
  Markenliste mehr**, sondern „Zahlungsmittel ohne Karten-Labels — zum Beispiel TWINT —
  zählen hier nicht mit. Welche das sind, hängt vom Acquirer ab." Dort stand eine Liste,
  und sie ist genau an dieser Korrektur veraltet: eine Fussnote, die eine mitzählende Marke
  als ausgeschlossen nennt, ist schlimmer als gar keine, weil der Leser ihr die Erklärung
  der Zahl darüber glaubt. TWINT bleibt als **ein** ausdrückliches Beispiel stehen (in
  beiden Kanälen label-los gemessen), damit nicht offenbleibt, wohin der fehlende Umsatz
  verschwunden ist. `test/reporting-render.test.js` nagelt fest, dass keine Liste
  zurückkehrt — vorher prüfte den Satz nichts, deshalb fiel sein Veralten nicht auf.
- **`klassifiziereKartentyp`** — `KARTEN_BUSINESS_REGEX` (`BUSINESS|CORPORATE|COMMERCIAL|
  PURCHASING|FLEET`) → `BUSINESS`; `NOT_SPECIFIED` (Konstante `KARTEN_KATEGORIE_UNBEKANNT`)
  oder fehlend → `UNKNOWN`, **nicht** `PRIVATE`; alles andere → `PRIVATE`. Der Wert ist
  häufig (siehe „Wallee-Referenzwissen"), ihn als privat durchgehen zu lassen wäre eine
  erfundene Aussage über jede siebte bis dritte Karte.
- **`klassifiziereTds`** — `AUTHENTICATED` (Start ∧ CAVV) / **`STARTED_NO_CAVV`**
  (Start ohne CAVV) / `WALLET_CRYPTOGRAM` (kein Start, aber ECI — Apple/Google Pay bringen
  ihr eigenes Kryptogramm) / `NOT_REQUESTED`. Es bleiben **vier** Eimer, und sie summieren
  weiterhin restlos auf die Karten-Attempts.
  Der zweite hiess bis v5.12.0 `FAILED_OR_ABANDONED`, deutsch „Fehlgeschlagen /
  abgebrochen" — ~~gestartet ohne CAVV heisst, die Authentifizierung ist gescheitert oder
  wurde abgebrochen~~ **korrigiert 2026-09-04 (SPEC-ITERATION-2 §3.6), an Produktivdaten
  widerlegt:** am zweiten Händler-Space (siehe „Charge-Attempt-Befunde am zweiten
  Händler-Space" unter „Wallee-Referenzwissen") liegen **2'439 Attempts mit
  `attempt_state = SUCCESSFUL`** in diesem Eimer — **16.8 %** seines Inhalts. Sie wurden
  autorisiert, obwohl der Connector kein CAVV-Label schrieb. `Cryptogram Present` erklärt
  es **nicht** (nur 20 der 2'439 tragen es). Der Report vom 03.09.2026 wies diese 16.8 %
  offen als Erfolgsquote einer „fehlgeschlagenen" Zeile aus — eine Zahl, die per
  Definition unmöglich schien und in Wahrheit die Definition widerlegte.
  **Was es wirklich ist, lässt sich nicht sagen** — Attempts-Flow, Frictionless ohne
  CAVV-Label oder Autorisierung nach Soft Decline: die dazu nötigen EMVCo-Felder
  (Transaction Status, Status Reason, Challenge Cancel) kommen im Analytics-`labels`-Array
  gar nicht an, dieselbe Discovery hat das gemessen. Der Eimer bleibt also **unscharf**;
  der Name sagt seither nur noch, was gemessen wurde („3DS gestartet, kein CAVV"), statt
  einen Ausgang zu unterstellen. **Das ist der ganze Fix** — er macht den Report nicht
  genauer, er nimmt ihm eine Behauptung.
  Ein **Liability Shift wird nicht ausgewiesen**:
  ~~der Connector schreibt kein solches Label (Task 0)~~ — **korrigiert 2026-09-04:** *jener*
  Connector schrieb keines. Die Discovery zum zweiten Händler-Space (SPEC-ITERATION-2 §4.3)
  fand dort `1634723429059` **Liability Shift** (Wert `ON`). Der Report weist ihn weiterhin
  nicht aus, aber nicht mehr, weil es das Label nicht gäbe, sondern weil es
  connectorabhängig ist und in keinem der Konstanten-Sätze steht.

#### Quoten, Anteile und die drei Zähler-Eimer

Nenner der **Erfolgs- und Fehlerquote** sind die Attempts mit Endzustand
(`SUCCESSFUL + FAILED`, in `reportingQuoten` als `abgeschlossen`): `PENDING` zählt separat
als „offen" und bleibt dort draussen (SPEC 4), ein unbekannter `attempt_state` landet im
eigenen Eimer `sonstige` — ihn zu `SUCCESSFUL` oder `FAILED` zu schlagen wäre erfunden, ihn
wegzuwerfen ein stiller Verlust. **Das ist die Regel für die Erfolgs-/Fehlerquote, nicht für
jede Quote:** die übrigen haben je einen eigenen, fachlich passenden Nenner —
`walletAnteil` misst gegen **alle** Attempts des Kanals (`kpi.attempts`, `offen` und
`sonstige` eingeschlossen: die Frage lautet „wie viel läuft über ein Wallet"),
`dccAnteil` und die Karten-Verteilungen gegen `kartenErfolgreich`, `tds.akzeptanz` gegen
`AUTHENTICATED + STARTED_NO_CAVV − gestartetOhneCavvErfolgreich` und
`tds.angefordertAnteil` gegen `kartenAttempts`.
Wer eine KPI ergänzt, wählt den Nenner also aus der Frage, nicht aus dieser Regel.

**Die beiden 3DS-Quoten sind das schärfste Beispiel dafür** (seit v5.12.1): sie greifen auf
denselben Eimer zu und zählen ihn trotzdem verschieden.
`tds.akzeptanz` fragt „wie oft ging die angeforderte Authentifizierung durch?" und nimmt
die **trotzdem autorisierten** Versuche des `STARTED_NO_CAVV`-Eimers aus dem Nenner — ein
autorisierter Versuch gehört nicht in den Ablehn-Nenner einer Kennzahl, die
„3DS-Akzeptanz" heisst. **Das ist ein ausdrücklicher Entscheid des Auftraggebers, keine
Herleitung aus den Daten**: die Daten sagen nur, *dass* diese Versuche autorisiert wurden,
nicht, ob 3DS daran beteiligt war. An den Referenzdaten hebt der Abzug die Quote von
**82.1 % auf 84.7 %** (66'785 / 78'890 statt / 81'329).
`tds.angefordertAnteil` fragt „wie oft wurde 3DS überhaupt angefordert?" und enthält den
Eimer deshalb **vollständig, ohne Abzug** — angefordert wurde in jedem seiner Versuche,
unabhängig vom Ausgang. Ein gemeinsamer Nenner wäre in einer der beiden Fragen die falsche
Antwort; ein Test rechnet beide von Hand nach, damit die eine nicht mit der anderen
mitwandert.
Die Zahl der trotzdem autorisierten Versuche steht als **eigene Zeile** im Block
„3DS-Akzeptanz" („3DS gestartet ohne CAVV, trotzdem autorisiert", absolut, in allen vier
Ausgaben) — sie darf nicht bloss im Nenner verschwinden, denn genau das war der Fehler.
**Anteile** (Verteilungen)
haben dagegen alle Attempts im Nenner, sonst summierten die Brand-Anteile nicht auf 100 %.
Der Unterschied ist der Grund für zwei Helfer statt einem: `reportingQuote` gibt bei Nenner 0
**`null`** zurück („kein Messwert"), `reportingAnteil` **`0`** („nichts, wovon es ein Teil
wäre"). Prozentwerte liegen im Modell als Zahlen **0–100 in voller Genauigkeit** vor;
gerundet wird erst in der Ausgabe.

**Beträge nie über Währungen hinweg** (SPEC 2.7): es gibt bewusst **kein** `kpi.betrag` —
Beträge stehen ausschliesslich in `waehrungen[]`, je Währung. Zählwerte und Quoten sind
währungsübergreifend.

Der `verlauf` entsteht ohne `start`/`end`: `reportingTagesbereich` nimmt Minimum und Maximum
der belegten Tage und füllt lückenlos auf, damit das Modell dieselbe Antwort gibt, ob die
Zeilen aus der API oder aus einem importierten CSV kommen. Ein Tag ohne Attempts steht mit 0
da (gemessen, nicht unbekannt) — **ausser oberhalb von `REPORTING_VERLAUF_MAX_TAGE = 400`**:
dort fällt der Verlauf auf die belegten Tage zurück und meldet das über
`zeitraum.lueckenlos: false`, worauf die Ausgabe ihren Hinweis „keine lückenlose Tagesachse"
setzt. Der Deckel begrenzt bewusst nur das **Auffüllen**, nie die Daten — abgeschnitten wird
nichts, sonst verlöre ein einzelner Ausreisser-Tag (`2999-01-01`) gemessene Attempts, statt
bloss Leerzeilen zu sparen. `stunden[]` hat immer alle 24 Einträge. Gültigkeit eines
Datums prüft **ein** Prädikat (`tagEpoche`/`istTag`: Muster **und** `Date.parse`) für
Bereichsbildung und Zeilenzuordnung — liefen die beiden auseinander, landete eine Zeile in
einem Eimer, den der Bereich nie ausgibt, und verschwände spurlos. Unbrauchbare Werte fallen
sichtbar in `kpi.ohneTag` / `kpi.ohneStunde`.

#### P3 Trinkgeld — derselbe Fallstrick wie in den Aggregat-Modi, eine Ebene tiefer

Die Query bindet **`tipCte` unverändert** ein (kein zweites Trinkgeld-CTE) und hängt es per
`LEFT JOIN tip ON tip.transaction_id = t.id` an `att`. `lineitem` erscheint damit
ausschliesslich im vor-aggregierten `tip`-CTE — der bekannte Fallstrick aus „SQL-Erzeugung"
(eine Transaktion hat mehrere Line Items, ein direkter Join vervielfacht die Zeilen).

**Hier kommt eine zweite Ausprägung desselben Problems dazu, und sie ist neu:** `tip` ist pro
**Transaktion** vor-aggregiert, `att` hat aber die Körnigkeit des **Attempts**. Ohne Guard
zählte `SUM(tip_amount)` das Trinkgeld einer wiederholten Transaktion einmal je Versuch.
Deshalb steht in `att`

```sql
CASE WHEN ca.state = 'SUCCESSFUL' THEN tip.tip_amount END AS tip_amount
```

Der `CASE` ist **nicht** optional. Er ist zugleich der Grund, warum `summe_tip` — anders als
`summe_refund` und `summe_betrag_failed` — **exakt** ist: pro Transaktion gibt es höchstens
einen erfolgreichen Attempt. Bei den beiden anderen ist die Mehrfachzählung unvermeidbar
(die Werte hängen an der Transaktion, gescheiterte Versuche gibt es mehrere), sie sind
deshalb als Obergrenze zu lesen; das steht als Kommentar im SQL. Ein Test verlangt, dass
`tip.tip_amount` im **gesamten** SQL genau einmal vorkommt, und verbietet
`SUM(tip.tip_amount)` — die unbewachte Form fällt damit sofort auf.

`tipCte` erwartet ein CTE `tx` mit der Spalte `id`. Der Reporting-Modus baut es **selbst**
aus den Attempts des Zeitraums und benutzt bewusst **nicht** `txCte`: das filtert auf
`t.completedon` und `t.state IN ('FULFILL','COMPLETED')` und legte damit einen anderen
Zeitschnitt an als der Report. Der Kanalfilter läuft in diesem `tx`-CTE mit — sonst suchte
ein E-Commerce-Bericht das Trinkgeld sämtlicher POS-Umsätze zusammen, also gerade den teuren
Teil, den der `LEFT JOIN` danach wegwirft.

Ausgewiesen wird P3 als **zwei Spalten** (`Trinkgeld`, `Trinkgeld-Quote %`) am Ende des
Blocks „Beträge je Währung" — dort stehen Zähler und Nenner ohnehin nebeneinander, in
derselben Form wie `Rückerstattungen` + `Refund-Quote %`. Die Spalten erscheinen **nur, wo
Trinkgeld vorkommt** (`waehrungen.some(w => w.tip > 0)`), also datengetrieben statt auf POS
verdrahtet. Der Hinweis des Blocks sagt dann ausdrücklich, dass das Trinkgeld im Umsatz
**bereits enthalten** ist (an Produktivdaten belegt, siehe „Wallee-Referenzwissen") — ohne
den Satz läse sich eine Spalte neben „Umsatz" wie ein Aufschlag.

#### Ablehngründe: `FAILURE_REASONS` und `ISO_RESPONSE_CODES` — statisch, und warum

**Es gibt in der wallee-Web-Service-API keinen Failure-Reason-Dienst.** Das war 2026-08-28
Gegenstand einer eigenen Untersuchung (Task 6, Bericht
`.superpowers/sdd/PLAN/task-6-report.md`) und gilt unverändert:

- Die Web-Service-Doku enthält **98 Service-Abschnitte**, keiner davon betrifft Failure
  Reasons; das offizielle Java-SDK hat **ebenfalls 98** Service-Klassen und keine dafür.
  Die übereinstimmende Zahl belegt, dass die Liste vollständig ist. Failure Reason kommt nur
  als **Modell** vor (eingebetteter Datentyp), nicht als Dienst.
- Beide Plan-Kandidaten antworten **404**: `GET /api/v2.0/failure-reasons` und
  `GET /api/failure-reason/all`. Und zwar als **HTML**-Fehlerseite — eine existierende Route
  mit falschem Parameter oder fehlender Berechtigung antwortet bei wallee mit JSON
  (`{"code":"resource_missing",…}`). HTML heisst: der Pfad wird gar nicht erst geroutet.
- `GET /api/v2.0/static-values` (der generische ID→Name-Dienst) kennt die IDs nicht, und
  das Analytics-Schema führt `failurereason` nur als `bigint`-Spalte ohne
  Nachschlagetabelle.
- Der Name existiert ausschliesslich **eingebettet im einzelnen Charge Attempt**
  (`GET /api/v2.0/payment/charge-attempts`) — und der braucht einen `Space`-Header statt
  `Account`, liefert nur die zufällig vorkommenden Gründe statt des Katalogs, und
  `limit=100` läuft in ein **504 (Cloudflare)**; nutzbar war nur `limit=20`.

**Bitte den API-Endpunkt nicht erneut suchen** — derselbe Hinweis steht als Kommentar im
Code.

**Korrektur 2026-09-04 (v5.12.0): der aus diesem Befund gezogene Schluss war zu weit.**
Zwei Sätze standen hier und sind widerlegt, der dritte bleibt richtig:

- ~~„`FAILURE_REASONS` als statische Tabelle mit **nur den sieben IDs, deren Name an echten
  Daten belegt ist** (2 POS, 5 E-Commerce)"~~ — die Tabelle wird seit v5.12 **generiert** und
  führt alle **2'254** Einträge des Katalogs (siehe „Ablehngründe im Klartext (v5.12)" unten).
- ~~„`…/failure-reason/list` … (>2000 Einträge, **ohne IDs in der Tabelle — als Datenquelle
  unbrauchbar**)"~~ — falsch abgelesen. `…/failure-reason/list?page=<n>` liefert 20 Einträge
  je Seite, und **jede Zeile trägt ihre ID**: `<tr data-grid-action="view/<id>"
  data-entity-name="<Name>">`. 113 Seiten ergeben 2'254 Einträge, also den vollständigen
  Katalog; er liegt gescrapt in `dashboard/catalog/failure-reasons.json`.
- ~~„die in SPEC 6.4 vorgesehene Proxy-Route `GET /failure-reasons` existiert nicht und wird
  nicht gebaut"~~ — sie **existiert seit v5.12**. Sie ist allerdings **keine API-Route**: sie
  liest dieselbe öffentliche Doku-Seite, nur je Eintrag (siehe „Proxy-Route
  `/failure-reasons`" unten).

Was **nicht** widerlegt ist und der Grund für den ganzen Aufwand bleibt: es gibt keinen
Failure-Reason-**Dienst**. Die Quelle ist die öffentliche **Doku-Seite**, kein API-Vertrag —
sie kann ihr HTML jederzeit ändern, ohne dass jemand von einer Breaking Change spräche.
Deshalb liegt der Katalog gescrapt im Repo, statt zur Laufzeit geholt zu werden.

Eine erratene Bezeichnung wäre weiterhin schlimmer als die rohe ID; eine ID, die auch der
Katalog nicht kennt, erscheint als `#<id>`. Die Option `failureReasons` von
`buildReportingModel` überschreibt und ergänzt die Tabelle. Daneben steht
`ISO_RESPONSE_CODES` (36 Einträge, deutsche Bezeichnungen, `51` = „Ungenügende Deckung") für
den Ablehncode — ein genormter, seit Jahrzehnten stabiler Katalog, kein Datenbestand eines
Händlers. Am POS ist der Ablehncode ohnehin die aussagekräftigere Achse; ohne Klartext-Namen
verliert vor allem der E-Commerce an Lesbarkeit, nicht der POS.

#### Ablehngründe im Klartext (v5.12) — generierte Tabelle, Kategorie, Empfehlung

`FAILURE_REASONS` wird seit v5.12 **erzeugt, nicht gepflegt**: `node tools/build-failure-reasons.mjs`
liest `dashboard/catalog/failure-reasons.json` und schreibt die Konstante zwischen die
Markerkommentare `/* FAILURE_REASONS:BEGIN */` … `/* FAILURE_REASONS:END */` in die
HTML-Datei. Wert je Eintrag ist ein Paar `["<name>", "<kategorie-kürzel>"]`; 2'254 Einträge
ergeben **~107 KB** im `app-logic`-Block. **Von Hand gepflegt blieb die Tabelle bei den
sieben IDs stehen, die in den Referenzläufen zufällig vorkamen** — jeder andere Grund stand
im Report als `#<id>`, und genau das war der Auslöser dieser Iteration (SPEC-ITERATION-2 §0).

Zum Werkzeug drei Dinge, die es zu wissen lohnt:

- **Es schreibt in die eingecheckte Datei und läuft nie zur Laufzeit.** Die App bleibt eine
  Single-File-App ohne Build; dies ist ein Generator, den man nach einem neuen Scrape
  (`python3 dashboard/tools/scrape_wallee_catalogs.py failure-reason en-us`) einmal anwirft.
  Er ist idempotent — ein zweiter Lauf meldet „unveraendert" und fasst die Datei nicht an.
  `test/embedding.test.js` hält als Wächter fest, dass der eingecheckte Block dem Katalog
  entspricht: wer neu scrapt und den Build vergisst, fällt dort auf und nicht erst beim
  Händler.
- **Ersetzt wird über eine Replacer-Funktion, nie über einen Ersatz-String** — dieselbe
  `$&`-Falle wie beim eingebetteten Vendor-Code (siehe „Architektur"). Ein Katalog-Name
  `Payment $& declined` würde sonst still den ganzen gefundenen Block an seiner Stelle
  einsetzen. Ebenso bricht der Lauf ab, wenn ein Name `</script` enthielte.
- **Eine Kategorie ausserhalb von `KUERZEL` lässt den Lauf abbrechen** (seit der
  Abschlussrunde zu v5.12). Zuerst schrieb er dafür still `''`, was die App als `UNKNOWN`
  liest. Zur *Laufzeit* ist `UNKNOWN` der richtige Rückfall für eine einzelne unbekannte ID;
  beim *Erzeugen* der Tabelle ist er der falsche: ergänzte wallee den Katalog um eine sechste
  Kategorie, liefen nach dem nächsten Scrape **alle** ihre Gründe als „Unbekannt" durch den
  Block «Ablehngründe nach Kategorie» — bei Gründen, deren Kategorie sehr wohl belegt ist.
  Der Abbruch nennt die neue Kategorie; sie ist dann hier **und** in
  `FAILURE_KATEGORIE_KUERZEL` nachzutragen.

**Kategorie als eigene Dimension.** Die Kürzel `E`/`C`/`I`/`T`/`D` löst
`FAILURE_KATEGORIE_KUERZEL` auf, die Reihenfolge in der Ausgabe steht in
`REPORTING_FAILURE_KATEGORIEN` (`END_USER`, `TEMPORARY`, `CONFIGURATION`, `INTERNAL`,
`DEVELOPER`, `UNKNOWN` — absteigend nach Nähe zum Kunden, damit die Zeile, die den Händler
angeht, oben steht). Daraus der Block **«Ablehngründe nach Kategorie»** direkt hinter K8: er
sagt in einer Zeile, ob das Problem beim Kunden, beim Netz oder bei wallee bzw. dem Acquirer
liegt. Jeder gescheiterte Versuch zählt in genau einen Eimer, die Summe ist deshalb exakt die
Zahl der Fehlschläge des Kanals (harness-getestet). Die Query bleibt unverändert — die
Kategorie entsteht clientseitig aus der ID.

**Warum es trotz Katalog eine Override-Tabelle braucht.** `FAILURE_CATEGORY_OVERRIDE`
korrigiert vier IDs, bei denen der Katalog **belegt** falsch liegt, jede mit Begründung im
Kommentar und keine ohne — eine Korrektur „aus dem Bauch" wäre schlimmer als die falsche
Katalog-Kategorie, weil sie unprüfbar wäre:

- `1531373451516` (Transaction Authorization Timed Out) und `1531373394895` (Transaction
  Authentication Failed), beide PostFinance, Katalog **Configuration**. In Referenzfall B
  sind das 77 % (E-Finance) bzw. 62 % (Card) aller Fehlschläge dieser Zahlungsmittel — der
  Kunde schliesst den E-Finance-Login nicht ab. Das ist Kundenverhalten, keine
  Fehlkonfiguration; als «Konfiguration» ausgewiesen schickte der Block den Händler zu wallee,
  wo nichts zu holen ist.
- `1579281555663` (Transaction declined, POS) und `1579281542342` (Automatically cancelled,
  POS), Katalog ebenfalls **Configuration**. Der Beleg steht **im Katalog selbst**: die
  wortgleiche E-Com-ID `1460695272599` („Transaction declined.") führt er als *End User*.

**`FAILURE_BEDEUTUNG` (30 IDs) und `FAILURE_ADVICE` (17 IDs)** tragen die zwei zusätzlichen
Spalten des K8-Blocks, «Bedeutung» und «Empfehlung», in **allen vier Ausgaben** — es ist der
Block, den der Händler ausdruckt oder an seinen Shop-Betreiber weiterreicht. Jeder Text ist
aus `description_de` (ersatzweise `description`) des Katalogs gekürzt, **nichts ist frei
formuliert**; die Empfehlung gibt es nur, wo SPEC-ITERATION-2 §1.3 die Zuordnung ausdrücklich
nennt (`RETRY_OK` / `RETRY_NO` / `OTHER_METHOD` / `CONTACT_WALLEE`). Alles andere bleibt leer,
auch wo eine Empfehlung naheliegt („Checkout Id Expired" wäre wohl `RETRY_OK`): eine
Empfehlung, die ein Shop in seine Retry-Logik übernimmt, darf nicht geraten sein. Die vier
Codes bekommen ihre deutsche Beschriftung aus `REPORTING_LABEL` — `reportingLabel()` gibt
Unbekanntes **unverändert** zurück, ein fehlender Eintrag stünde also als roher Schlüssel im
Report; ein Test nagelt deshalb alle vier fest.

**Die Beschreibungen der übrigen 2'224 Einträge sind bewusst nicht eingebettet** (~450 KB
zusätzlich). Der *Name* allein beseitigt die `#<id>`-Zeilen — das war der Auftrag; die
Bedeutung ist Zusatz für die Gründe, die tatsächlich vorkommen. Siehe „Bewusste Abweichungen
von `dashboard/SPEC-ITERATION-2.md`" unten.

**„Übrige" statt Top-N.** K8 und E5 zeigen seit v5.12 **alle** Gründe; was über
`REPORTING_GRUENDE_MAX = 12` hinausgeht, fasst `reportingUebrige()` zu einer Zeile
«Übrige (n Gründe)» zusammen. Dadurch summieren die Anteile auf 100 %, und die Fussnote „7
weitere Einträge sind nicht dargestellt" entfällt. Eine Sammelzeile entsteht **nie für einen
einzelnen** Grund — sie bräuchte dieselbe Zeile und sagte weniger. E5 fasst **je Brand**
zusammen, nicht über die ganze Kreuztabelle: die Sammelzeile eines Brands gehört unter dessen
Zeilen.

**Schwelle am Ablehncodes-Block (P6).** Im E-Commerce erschien der Block zu 91.4 % als
`UNKNOWN` — das ist keine Information, sondern eine Tabelle, die so tut. Er wird dort nur
noch gezeigt, wenn der Anteil bekannter Codes mindestens `REPORTING_CODES_MIN_BEKANNT = 25` %
beträgt; sonst steht ein Hinweisblock, der die Zahl nennt („der Processor liefert für diesen
Space keinen Response Code, n von m Fehlschlägen ohne Code"). **Am POS bleibt der Block wie
er ist** — dort ist der ISO-Code die feinste Achse, die es gibt (14 Werte im Referenzmonat,
gegen zwei Failure Reasons).

#### Proxy-Route `/failure-reasons` (v5.12) — die Lücke nach dem Scrape

`GET /failure-reasons?ids=<id>,<id>,…` holt die Namen zu IDs nach, die wallee **seit dem
Scrape** neu vergeben hat. Der eingebettete Katalog deckt den Kopiermodus offline ab; diese
Route deckt ab, was danach kam. Im Kopieren-Modus gibt es sie nicht — dort bleibt es bei
`#<id>`, und das ist seit v5.12 der einzige verbliebene Fall.

- **Es ist keine API-Route.** Kein JWT, kein `Account`-Header, kein `rufeApi()` — bitte auch
  später nicht „vereinheitlichen": sie ruft eine öffentliche Doku-Seite, und sie durch
  `rufeApi()` zu schicken hiesse, einen Pfad unter `/api/v2.0` zu signieren, den es dort gar
  nicht gibt, und Zugangsdaten für etwas zu verlangen, das jeder abrufen kann.
- **Die Erkennung „kennt die Doku diese ID?" läuft über `maintitle`, nie über den
  Statuscode.** Eine unbekannte ID antwortet **302 auf die Login-Seite**; Nodes `fetch` folgt
  Weiterleitungen von selbst und liefert dann eine **200** mit `<title>Log in`. Ein
  Statuscode-Check entschiede also genau falsch — er hielte die Login-Seite für einen Treffer.
  Zwei eingefrorene HTML-Fixtures (Treffer und Login-Seite, Stand 2026-09-03) halten den
  Aufbau fest.
- **Verglichen wird die zerlegte Klassenliste, nicht `\b` in einer Regex.** `\b` sieht den
  Bindestrich als Wortgrenze: `main-maintitle`, `maintitle-lead` und
  `documentation-panel-description-header` passten alle auf die gesuchten Namen, und weil der
  **erste** Treffer im Dokument gewinnt, hätte ein solcher Nachbar den falschen Namen
  geliefert — zusammen mit der Cache-Datei dauerhaft eingefroren. (Korrigiert in der
  Abschlussrunde zu v5.12.)
- **Cache, zweistufig:** eine Map im Prozess, daneben `failure-reasons.cache.json` neben dem
  Proxy-Script (der Cache ist öffentliche Doku, kein Geheimnis — er darf im Ordner
  mitwandern, anders als die Zugangsdaten im Home). Die Datei trägt eine
  **Schema-Version** (`FAILURE_CACHE_VERSION`): passt sie nicht, wird die Datei **ganz**
  verworfen statt gelesen — der Selbstheilungspfad, falls eine fehlerhafte Fassung des
  Parsers je falsche Namen eingefroren hat. Dazu ein **Höchstalter** je Eintrag
  (`FAILURE_CACHE_MAX_ALTER_MS`, 30 Tage): wallee kann einen Grund umbenennen, und ohne
  Verfallsdatum stünde der alte Name bis in alle Ewigkeit im Report. Über „noch brauchbar"
  entscheidet **ein** Prädikat (`failureEintragFrisch`) an beiden Stellen — beim Laden der
  Datei und beim Treffer in der Prozess-Map; der Proxy läuft tagelang, ein Eintrag veraltet
  also auch im Arbeitsspeicher. Geschrieben wird **atomar** (Temp-Datei + `rename` im selben
  Verzeichnis, Muster `ladeUndSchreibeUpdate`).
- **Ein negativer Treffer wird nie gecacht** — weder in der Datei noch im Prozess. Eine ID
  kann in der Doku später auftauchen; genau dafür gibt es die Route.
- **Höchstens `FAILURE_MAX_IDS = 50` IDs pro Aufruf, sequentiell, `FAILURE_ABSTAND_MS = 200`
  dazwischen** (der Abstand gilt *zwischen* zwei Abrufen, nicht vor dem ersten). Es ist ein
  Doku-Server, kein API-Vertrag mit uns. Dazu ein Timeout je Abruf (`FAILURE_TIMEOUT_MS`,
  8 s — `fetch` hat von sich aus keinen) **und ein Gesamtbudget**
  (`FAILURE_GESAMT_BUDGET_MS`, 30 s): der Timeout gilt *pro* Abruf, 50 hängende IDs wären
  sonst rund 6 Minuten 50 Sekunden, in denen die App auf diese eine Antwort wartet. Ist das
  Budget aufgebraucht, bricht der Lauf ab und liefert, was er hat; der erste Abruf läuft
  dabei immer, sonst brächte der Aufruf gar nichts. Steht zu einer verbleibenden ID noch ein
  **abgelaufener** Eintrag im Cache, wird er dann trotzdem ausgeliefert — ein 31 Tage alter
  Name ist fast immer richtig und in jedem Fall mehr wert als `#<id>`; das Höchstalter sagt
  „hol das neu, wenn du kannst", nicht „wirf es weg". Ohne Eintrag bleibt es bei `#<id>`.
  **Rückfall statt Blockade**, wie überall in dieser Anwendung.
- **Geprüft wird vor dem ersten Netzzugriff:** eine `ids`-Liste mit einem Nicht-Zahl-Eintrag
  ergibt `400`, ohne einen einzigen Abruf. Die URL setzt `failureReasonUrl()` ausschliesslich
  aus Ziffern zusammen — alles andere wäre ein Weg, einen fremden Pfad an `app-wallee.com`
  anzuhängen.
- **App-Seite:** `reportingUnbekannteGruende()` erkennt eine fehlende ID an genau dem, was
  der Nutzer sieht — der Name ist `#<id>`; damit gibt es keine zweite Definition von
  „unbekannt", die gegenüber der Ausgabe auseinanderlaufen könnte. Der Nachtrag geht als
  Option `failureReasons` ins Modell, das **aus den bereits geparsten Zeilen** neu gebaut
  wird — kein zweiter Ergebnis-Abruf, denn bei wallee zählt jeder Abruf als Download.

#### Kuchendiagramme (v5.12) — eine Geometrie, zwei Renderer

Donut-Diagramme über den Tabellen der Verteilungsblöcke (SPEC-ITERATION-2 §2.1):
Zahlungsmittel (zwei Kuchen — Attempts und Betrag), Kartentyp, Kartenherkunft, 3DS-Status,
Ablehngründe, Ablehngründe nach Kategorie, PAN-Quelle, Funding. Nicht als Kuchen: Verlauf,
Stunden, Terminals, Länder, Conversion.

- **`kuchenSegmente(segmente, r, rInnen)` ist die einzige Stelle, an der Winkel und Punkte
  entstehen.** `svgKuchen()` baut daraus den SVG-Pfad (`A`-Befehle), `pdfKuchen()` zeichnet
  dieselben Segmente mit jsPDF-Vektorprimitiven (Bogen als kubische Bezier-Näherung, ≤ 90°
  je Teilbogen). Zwei Geometrien nebeneinander liefen mit der Zeit auseinander, und niemand
  vergleicht Bildschirm und PDF Segment für Segment.
- **Die Kuchen stehen im PDF** — anders als die Balken, die bewusst draussen bleiben. jsPDF
  kann Vektoren selbst; ein Rasterbild bräuchte einen dritten Vendor, und autotable kann kein
  SVG. Die Bezier-Näherung ist gegen die Kreisbahn getestet (Toleranz 0.03 % des Radius, der
  bekannte Maximalfehler bei 90° liegt bei ~0.027 %).
- **Farben: `SVG_KUCHEN_FARBEN`, Whitelist wie `SVG_BALKEN_FARBEN`.** Der Renderer nimmt nur
  einen **Schlüssel** entgegen, nie eine freie Farbangabe — das ist der Weg, über den sonst
  doch ein Inline-Hex ins Markup käme. Jeder Eintrag trägt **beide** Darstellungen an
  **einer** Stelle: `css` (`var(--kuchen-…)`) für den Bildschirm, `hex` für jsPDF. Dass die
  beiden dasselbe meinen, lässt sich zur Laufzeit nirgends prüfen (das SVG trägt nur den
  Variablennamen, aufgelöst wird er erst im Browser) — deshalb ein **statischer Wächter**
  in `test/dom-ids.test.js`, der `:root` gegen die Tabelle hält. Sechs Farben plus Grau; Grau
  ist für „Unbekannt"/„Übrige" reserviert und verbraucht keine der sechs. Feste Kategorien
  (Domestisch/Intra/Inter, Business/Privat, 3DS-Status, Ablehnkategorien) haben in **jedem**
  Report dieselbe Farbe, offene Listen (Brands, Gründe) laufen nach Anteil durch die Reihe.
  Die Prozentzahl im Segment steht dunkel oder hell je Fläche; **Orange trägt als einziges
  kräftiges Segment dunkle Schrift** — gemessen gegen `#ff4d00`: Weiss 3.33:1, `--text`
  3.07:1 (also schlechter), `--kuchen-text-dunkel` (`#111111`) 5.68:1.
- **Die 2-%-Regel sitzt in der Blockschicht, nicht im Renderer** (`reportingKuchenSegmente`,
  `REPORTING_KUCHEN_MIN_ANTEIL = 2`): Segmente unter 2 % werden zu «Übrige» zusammengefasst,
  **bevor** gezeichnet wird, damit Tabelle und Kuchen dieselben Zahlen zeigen. Ein
  **einzelnes** kleines Segment wird nicht eingeklappt — «Übrige» bräuchte dieselbe Zeile und
  sagte weniger. Trägt die Tabelle bereits eine Sammelzeile («Übrige (11 Gründe)»), wird
  **hinein** addiert statt danebengestellt: sonst stünden zwei graue Wedges im Ring, beide
  „Übrige" beschriftet und nicht auseinanderzuhalten (die Lage in Referenzfall B). Die
  Segmente eines Kuchens sind immer die **Zeilen seiner Tabelle** — nie eine zweite, eigene
  Auswahl.
- **In Excel gibt es keinen Kuchen** — der eingebettete Vendor kann keine Charts. Die Tabelle
  trägt die Prozente; kein Workaround, und ein Test hält fest, dass kein Blatt eine Zeile aus
  `block.kuchen` trägt.
- **Was der Kuchen nicht zeigt, steht im Blockhinweis.** Der Umsatz-Ring zeichnet nur die
  **Leitwährung** (über Währungen hinweg zu addieren ist in diesem Modus verboten, SPEC 2.7),
  und Werte ≤ 0 fallen heraus — ein Zahlungsmittel, das nur in einer Nebenwährung Umsatz hat,
  steht in der Tabelle, fehlt aber im Ring. Und das Kuchen-Segment «Übrige» kann mehr Gründe
  umfassen als die gleichnamige Tabellenzeile. Beides je ein Halbsatz: beide Zahlen sind
  richtig, ohne den Hinweis sähe es nach Widerspruch aus.

#### Parser, Blöcke, vier Ausgaben

- **`parseReportingCsv(text)`** → `{ rows: { dim, time, conv }, headers, unbekannteBloecke,
  unbrauchbareWerte, error }`, wirft nie. Nutzt den gemeinsamen Zerleger `csvZuZeilen` und `parseAmount`
  (Beträge als ganzzahlige **1e-8-Einheiten**, per String zerlegt) wie der Settlement-Parser.
  **Jeder Block hat seine eigene Zeilenform** statt aller Spalten überall: in `TIME`/`CONV`
  sind die DIM-Spalten keine *fehlenden* Werte, sondern **gar keine** — sie auf `'UNKNOWN'`
  zu setzen wäre eine erfundene Aussage. Dimensionen leer → `'UNKNOWN'`; `stunde` leer →
  `null`, **nicht** `0` (0 ist eine gültige Stunde); Booleans nur `true`/`false`, alles
  andere `null`. Eine Zeile mit unbekanntem `block` wird nicht stumm verworfen, sondern in
  `unbekannteBloecke` gezählt.
  **Seit v5.11 ist auch der letzte stille Verlustkanal gezählt:** `parseBool`, `parseAmount`
  und `parseCount` können „nicht lesbar" nicht von „leer" bzw. „0" unterscheiden. Ein
  nicht leeres Feld, das gegen `REPORTING_MUSTER_BETRAG`/`REPORTING_MUSTER_ZAHL` bzw. gegen
  `true`/`false` nicht ankommt, erhöht deshalb `unbrauchbareWerte`, und die Statuszeile des
  Panels nennt die Zahl (beide Zweige, auch „Keine Zahlungsversuche" — gerade dort tarnte
  sich ein unlesbares Zahlenformat sonst als leeres Ergebnis). **Warum das nötig war:**
  als der Zähler entstand, war die Query noch nie gegen echte Daten gelaufen. Schriebe
  Athena `boolean` als `1`/`0` oder Beträge mit Komma bzw. in Exponentialschreibweise,
  stünden `dcc`, `tds_started`, `tds_cavv` und sämtliche Beträge dauerhaft auf `null` bzw.
  `0` — P7 läse „DCC 0 %", E1/E2 „nicht angefordert 100 %", und zwar als gemessen
  aussehende Nullen. **Der Referenzlauf vom 2026-09-01 hat die erwarteten Formate
  bestätigt** (die beiden Referenzspaces, Juli 2026): `true`/`false` klein, Punkt-Dezimalzahlen
  mit acht Nachkommastellen, `yyyy-mm-dd`, Stunde ohne führende Null — der Parser meldete
  über beide Ergebnisse **0 unbrauchbare Werte und 0 unbekannte Blöcke**. Das war vorher
  offen und ist es nicht mehr; der Zähler bleibt trotzdem, weil er die Aussage erst
  belegbar macht und ein anderer Connector oder eine Schema-Änderung sie wieder umwerfen
  kann. Der Wert selbst bleibt der defensive; gemeldet wird zusätzlich, nicht statt dessen.
  `REPORTING_PFLICHT` ist die **vollständige SELECT-Liste** der Query (26 Spalten), nicht
  nur was das Modell braucht: die Query ist ein einziges `UNION ALL`, ihre Spalten kommen
  gemeinsam oder gar nicht — fehlt eine, stammt das CSV nicht aus diesem Modus. Nicht
  Pflicht sind nur `terminal_identifier`/`terminal_name` (nur in der Terminal-Variante).
  **Folge, die zu kennen ist:** `summe_tip` ist seit dem P3-Nachtrag Pflichtspalte, ein
  **vorher** abgesetzter Reporting-`queryToken` lässt sich deshalb nicht mehr nachparsen
  („Im Ergebnis fehlen Pflichtspalten"). Die Verlaufszeile bietet für solche Einträge
  weiterhin das Roh-CSV an; der Report darüber nicht.
- **`buildReportingModel(rows, { merchantCountry, failureReasons })`** → `{ merchantCountry,
  kanaele: {POS, ECOM, OTHER}, kanalListe, zeitraum, spaces, waehrungen, hatDaten,
  hatTerminals, fremdeKanaele }`, je Kanal `{ kpi, brands, wallets, herkunft, kartentyp,
  funding, tds, failures, failuresProBrand, responseCodes, panTypes, verlauf, stunden,
  terminals, waehrungen }`. **Wallets stehen neben den Brands, nicht zwischen ihnen** — ein
  Wallet liegt quer zu den Brands (Apple Pay *auf* Visa) und triebe deren Anteilssumme über
  100 %. Terminal-Zeilen gibt es **nur** im POS-Kanal.
- **`reportingExportBloecke(modell, optionen)`** ist die gemeinsame Quelle für **alle vier
  Ausgaben** (Bildschirm, CSV, Excel, PDF) — dasselbe Muster wie bei den beiden anderen
  Reports. Ein Block trägt `{ titel, kanal, kopf, zeilen, typ, hinweis, zellFormate? }`;
  `typ` ∈ `tabelle | kacheln | balken`. Der `kopf` ist ein **Deskriptor je Spalte**
  (`{ label, format }`) statt zweier Parallel-Arrays wie beim Settlement-Report: bei zwei
  Arrays lässt sich eine Spalte halb einfügen und alles Weitere verschiebt sich still um
  eins.
  `format` ∈ `text | zahl | betrag | pct | faktor | gemischt`. **Zellformate immer über
  `reportingZellFormat(block, r, c)` lesen, nie über `block.kopf[c].format`** — der
  Kachel-Block mischt in seiner Wert-Spalte Zähler, Prozente und Beträge und trägt deshalb
  `zellFormate`. Seine Spalte steht bewusst auf dem **nicht renderbaren** `'gemischt'`: wer
  den Zugriff vergisst, bekommt ein Format, das er nicht kennt, statt eines plausiblen, und
  schreibt nicht versehentlich `4229859000000` unter „Anzahl". Ein unbekanntes Format ergibt
  in der Ausgabe `#FORMAT?` (`REPORTING_FORMAT_UNBEKANNT`) — bewusst ein **eigenes** Zeichen,
  denn `—` bedeutet bereits „keine Grundlage" (`null`) und `''` bereits „gehört zur Zeile
  darüber" (Fortsetzungszeile einer Währungsgruppe).
  In den Blöcken stehen **Rohwerte**: Beträge als 1e-8-Einheiten, Prozente ungerundet.
  Formatiert und gerundet wird ausschliesslich in der Ausgabeschicht
  (`reportingZellText` für Bildschirm/PDF, `reportingZellZahl` für CSV/Excel — dort bleiben
  Zahlen Zahlen). Gerundet wird auch in CSV und Excel, damit alle vier Ausgaben dieselbe
  Zahl zeigen.
  **Mehrere Währungen** trägt eine `Währung`-Spalte mit einer Zeile je (Eintrag, Währung);
  die währungsfreien Zellen stehen nur in der ersten. Ein Block je Währung hätte Attempts
  und Quoten je Währung wiederholt — genau die Doppelzählung, die vermieden werden soll.
  **Ein Block ohne Grundlage entfällt**, statt leer dazustehen (eine leere Tabelle behauptet,
  es sei gemessen worden und nichts gewesen); die zwei Ausnahmen, wo die Abwesenheit selbst
  die Aussage ist, bekommen einen Hinweisblock (`<K> · Keine Daten` bzw. `Keine Daten`) —
  dieselbe Haltung wie das „Keine." des Settlement-Reports.
- **Bildschirm:** Kanal-Abschnitte unter `<h2 class="report-kanal">`, Kacheln, Tabellen
  (ab `REPORTING_TABELLE_OFFEN = 20` Zeilen in `<details>` eingeklappt — die Schwelle liegt
  bewusst unter den 24 Stunden), und für `typ: 'balken'` ein **Inline-SVG** über der Tabelle
  (`svgBalken`, kein Chart-Vendor — die Datei ist schon ~1.48 MB, und mit dem eingebetteten
  Ablehngrund-Katalog aus v5.12 ist das Argument stärker geworden, nicht schwächer). Farben
  ausschliesslich
  über die Whitelist `SVG_BALKEN_FARBEN` (genau die zwei Farben, die
  `reportingBalkenHtml` wählt — Einträge auf Vorrat sehen nur benutzt aus) → `var(--…)`;
  eine freie Farbangabe wäre der Weg,
  über den doch ein Inline-Hex ins Markup käme. Balken bekommen nur Zähler und — **nur wenn
  jede Zeile eine Zahl trägt** — die Erfolgsquote: bei `null` (Stunde ganz ohne Versuch)
  behauptete ein Nullbalken 0 % Erfolg, eine Messung, die es nicht gibt.
- **Excel:** **ein Blatt je Kanal**, Abschnitte darin gestapelt (Muster Terminal-Report) —
  ein Blatt je Block ergäbe an der Fixture 34 Register; der kanalübergreifende Titelblock
  bekommt ein eigenes vorangestelltes Blatt (`Reporting | POS | E-Com | Andere`). Zahlformat
  `pct` = `0.0"%"` — **nicht** das eingebaute `0.0%`, das mit 100 multipliziert; die Blöcke
  führen bereits 0–100.
- **PDF:** ein Kapitel je Kanal auf frischer Seite, Titelblock als Dokumentenkopf, seine
  Prosa als Abschnitt „Grundlagen". **Balken stehen bewusst nicht im PDF** (autotable kann
  kein SVG, ein Rasterbild wäre ein dritter Vendor) — die Zahlen stehen vollständig in der
  Tabelle daneben.

#### UI und Ingest — mit zwei Regeln, die leicht zu übersehen sind

- Panel `reportingSection`: Kanal-Radios (POS / E-Commerce / Beide), Händler-Land (ISO-2,
  Default `CH`), Checkbox „Terminal-Aufschlüsselung", dazu die Hinweise zur Attempt-Basis
  und dazu, dass **der Zeitraum sich auf den Zahlungsversuch bezieht**. Panel
  `reportingReportSection`: Statuszeile, **„CSV importieren"**, Export-Leiste (CSV/Excel/PDF),
  Ausgabe. Der Import-Button liegt **ausserhalb** von `reportingReportActions`, weil die
  Leiste versteckt ist, solange kein Modell existiert — der Import ist aber genau der Weg,
  im Kopieren-Modus überhaupt zu einem Modell zu kommen. Er ist ein echter Button (kein
  `<label for>`), sonst wäre er mit der Tastatur nicht erreichbar.
- **Ingest:** `uebergibReportingCsv` → `ingestReportingCsv` → `setMode('reporting')`,
  gespeist aus drei Quellen: Submit, „Vorhandenen queryToken abrufen" und CSV-Import.
  Submit und Token-Abruf laufen über die gemeinsame Tabelle `BERICHT_INGEST`
  (`settlement`/`reporting`); der Terminal-Report bleibt bewusst draussen, er wertet die
  Antwort selbst aus. Die geparsten Zeilen bleiben in `reportingRohzeilen` liegen: ein
  Wechsel des Händler-Landes baut das Modell **daraus** neu, statt das Ergebnis erneut
  abzurufen — bei wallee zählt jeder Abruf als Download.
- **Kanal-Abbildung `reportingKanalFilter`: `'BOTH'` → `[]`, nicht `['POS','ECOM']`.** Eine
  leere Liste erzeugt in `buildReportingQuery` **gar keinen** `ca.saleschannel`-Filter; nur
  so bleibt ein Versuch mit einem dritten Verkaufskanal als `OTHER` sichtbar (SPEC 7).
  `['POS','ECOM']` würde ihn still herausfiltern und den `ELSE 'OTHER'`-Zweig der `CASE` zu
  totem Code machen. Eine ausdrückliche Auswahl filtert dagegen exakt auf die genannten
  Kanäle.
- **Der Account-Override gilt weiterhin nur im Settlement-Modus.** `reporting` filtert wie
  `brand`/`terminal` nach `spaceid`, also gibt `aktiverAccount()` für den Modus `''` zurück.
  Das ist keine Nebensächlichkeit, sondern genau die Regression aus v5.10.0 (siehe
  „Account-Override gilt nur im Settlement-Modus" oben): ein fremder Account kennt diese
  Spaces nicht, die Query liefe im falschen Kontext und käme mit **null Zeilen** zurück —
  der Report meldete dann bloss, das Ergebnis sei leer. `test/reporting-ui.test.js` nagelt
  beides fest (`aktiverAccount()` und `historyEintragBauen('reporting', …).account` bleiben
  leer, während der Settlement-Modus den Override behält).
- **Abfrage-Verlauf:** wie bei Terminal- und Settlement-Report zeigt die Verlaufszeile im
  Modus `reporting` nur den Roh-CSV-Download; Excel und PDF laufen über das Report-Panel.
  Die Unterdrückung läuft über `MODI_MIT_REPORT_PANEL = ['terminal','settlement','reporting','reporting-tds']`
  statt einer wachsenden Oder-Kette. `MODUS_LABELS.reporting = 'Reporting'`.
  `historyEintragBauen` hat seit v5.11 einen eigenen `filterSummary`-Zweig für den Modus:
  er nennt die **Kanalwahl** (`REPORTING_KANAL_WAHL_LABEL`, `'BOTH'` → „alle Kanäle" — der
  Kanal ist hier der eigentliche Filter) und die Terminal-Auswahl **nur dann**, wenn
  `reportingTerminalPanelSichtbar` sie gelten lässt, also mit derselben Bedingung wie
  `generate()`. Sonst versprächen die Zeilen eine Einschränkung, die die Query nicht trägt.

#### Die Seite «3DS-Failures» (v5.13) — die zweite, zeilenweise Abfrage

Fachliche Vorgabe: `dashboard/SPEC-ITERATION-2.md` §3. Auslöser ist Referenzfall B: dort
ist *3-D Secure Failure* mit **64.8 % aller Fehlschläge** der grösste Ablehngrund, und der
Händler konnte bis v5.12 zwar den Grund sehen, aber nicht die betroffenen Versuche. Gebaut
wie alles andere in diesem Modus: reine, DOM-freie Funktionen plus eine dünne UI-Schicht,
**eine** Blockquelle für vier Ausgaben.

**Zwei Abfragen, und das ist der Kern des Entwurfs.** Die Seite hängt am
Modus `reporting`, hat aber eine **eigene Query mit eigenem `queryToken`**
(`buildReportingTdsQuery({ spaceIds, start, end })`, eine Zeile je Attempt statt eines
Aggregats). Sie in die bestehende `UNION ALL`-Query zu ziehen wäre möglich gewesen und
wäre der teurere Weg:

- **Das Aggregat bleibt PII-frei und damit weitergabefähig.** Es trägt ausschliesslich
  Zählwerte (SPEC 2.4) — genau deshalb ist sein CSV-Import im Kopieren-Modus überhaupt
  vertretbar. Die Zeilenliste trägt **Bestellnummern und Transaktions-IDs**. In einer
  Datei könnte der Händler den Reporting-Report nicht mehr an seinen Shop-Betreiber oder
  Acquirer weiterreichen, ohne die Transaktionsliste mitzugeben.
- **Die beiden Modelle sind unabhängig.** Jedes existiert ohne das andere: bei Kanal POS
  wird die zweite Abfrage gar nicht erst abgesetzt (`reportingTdsQueryNoetig(kanal)` —
  eine unbekannte Kanalwahl verhält sich wie «Beide», ohne Kanalfilter ist E-Commerce
  enthalten), beim Import kann eine der beiden Dateien fehlen, und ein Fehlschlag der
  zweiten Abfrage lässt den Aggregat-Report unberührt stehen.
- Die Query filtert **fest auf E-Commerce** und kennt deshalb weder `channels` noch
  Terminals. Am POS gibt es die Seite nicht — kein leeres Panel, keine Meldung „nichts
  gescheitert", **und kein Abruf, der bei wallee als Download zählt**.

**Definition «3DS-Failure» ist eine Oder-Verknüpfung** (§3.2), und die ist nicht kosmetisch:
gescheitert **und** (Ablehngrund aus `TDS_FAILURE_REASONS` **oder** 3DS gestartet, aber ohne
CAVV). Ein „3-D Secure Failure", dessen Connector kein Start-Label schrieb, gehört ebenso
dazu wie ein abgebrochener 3DS-Prozess, der unter einem anderen Grund verbucht wurde. Ein
einzelner Zweig verlöre je nach Connector die eine oder die andere Hälfte.
`TDS_FAILURE_REASONS` ist bewusst aus `TDS_GRUND_FAILURE`/`TDS_GRUND_TIMEOUT` gebaut — die
Query braucht die beiden zusammen (`IN`-Liste), die Grund-Achse unterscheidet sie; zwei
Literale liefen bei der nächsten Änderung stumm auseinander.
Der zweite Zweig heisst im Modell **`STARTED_NO_CAVV`** und nicht mehr
`FAILED_OR_ABANDONED`: an Produktivdaten wurde gemessen, dass ein Sechstel dieses Eimers
trotzdem autorisiert wurde — der alte Name behauptete einen Ausgang, den die Daten nicht
hergeben. Die Bedingung ist unverändert richtig, nur der Name war es nicht.

**Fünf neue Descriptor-Konstanten, jede mit gemessenem Map-Key** — derselbe Fallstrick wie
im Aggregat, nur schärfer: **drei der fünf weichen vom Default `shortTextContent` ab**, und
ein falsch geratener Key wirft nicht, er liefert dauerhaft `NULL`.

| Konstante | ID | Map-Key | gemessen in |
|---|---|---|---|
| `DESC_TDS_FINISHED` | `1568637885195` | **`dateTimeContent`** | Task 0 |
| `DESC_TDS_VERSION` | `1620379912010` | **`staticValueContent`** | Discovery Q2, 2026-09-04 |
| `DESC_CARD_ISSUER_NUMBER` (BIN) | `1458749261553` | **`integerContent`** | Discovery Q2 |
| `DESC_ATTEMPT_RETRY` | `1634723431551` | `shortTextContent` | Discovery Q2 |
| `DESC_CRYPTOGRAM_PRESENT` | `1634723429554` | `booleanContent` | Discovery Q2 |

`DESC_TDS_FINISHED` steht hier, obwohl er aus Task 0 stammt: er war nie als Konstante
angelegt, weil das Aggregat ihn nicht braucht — **ohne ihn gäbe es keine Dauer-Achse.** Die
BIN benennt den **Herausgeber**, nicht die Karte, und fällt deshalb nicht unter die
PII-Sperrliste; diese bleibt unverändert strikt (Card Holder Name und Masked Card Number
kommen in keiner der beiden Queries vor, auch nicht in einem `GROUP BY`).

**Die Dauer-Achse ist der Ersatz für die Challenge-Status-Achse, nicht eine Zutat.** §3.6
und §3.7 planten «Challenge-Status-Grund» und «ACS» als Kernachsen. Discovery Q2 hat
gemessen, dass **keines der dreizehn EMVCo-3DS-Labels im Analytics-`labels`-Array
ankommt** (siehe „Charge-Attempt-Befunde am zweiten Händler-Space", 2026-09-04) — der
Händler sieht sie im Backend, sie entstehen also im 3DS-Server, landen aber nicht in der
Analytics-Tabelle. Sie „vorsorglich" mitzuführen wäre genau der Fehler, den dieser Code
sonst vermeidet: eine Spalte, die dauerhaft `NULL` liefert, sieht aus wie eine Messung. Ein
Test hält fest, dass sie nicht zurückkehren. Geblieben ist die Zeitspanne zwischen
`Process Started` und `Process Finished`, in vier Eimern plus `UNBEKANNT`
(`TDS_DAUER_GRENZEN_SEK = [10, 60, 300]`; die Grenzen gehören zum **oberen** Eimer, und die
Beschriftung sagt das mit `<` und `>` ausdrücklich): sie beantwortet dieselbe Frage — bricht der Kunde sofort ab oder scheitert
er nach einer langen Challenge — nur aus dem, was tatsächlich da ist.

**Was aus demselben Messergebnis nicht gebaut ist — und zwar nicht „noch nicht":** die
Achse «Challenge-Status-Grund», die ACS-Achse, die Flow-Klassifikation `tds_flow` (§3.6)
und die statischen EMVCo-Reason-Code-Tabellen (§3.7). Alle vier hängen an denselben
dreizehn Labels, und die kommen im Analytics-Export **nicht** an (Discovery Q2,
2026-09-04). Eine Tabelle ohne Werte, auf die sie zeigen könnte, ist keine halbe
Kennzahl, sondern eine leere Behauptung.
Für `tds_flow` sieht §3.6 einen **Rückfall ohne Labels** vor (Started ∧ CAVV ∧ Dauer < 3 s
= frictionless). Genau der ist bewusst **nicht** umgesetzt: aus einer Drei-Sekunden-Schwelle
Namen wie `FRICTIONLESS` und `CHALLENGE_OK` zu bilden hiesse, eine Annahme als Messung zu
beschriften — und niemand liest einer Zeile «Frictionless» noch an, dass sie aus einem
Zeitvergleich stammt. Die **Dauer-Eimer zeigen dieselbe Grundlage unverfälscht**: sie
sagen, wie lange es gedauert hat, und überlassen die Deutung dem Leser. Was aus §3.6
sehr wohl umgesetzt ist, ist die **Konsistenz-Korrektur** — der Eimer heisst seit v5.12.1
`STARTED_NO_CAVV`; siehe „Bewusste Abweichungen von `dashboard/SPEC-ITERATION-2.md`",
Punkt 4.
Wer die EMVCo-Felder braucht, kommt nur über die API je Attempt an sie heran (§4.4,
weiterhin offen). **Ändert ein Connector das**, ist `dashboard/sql/00_label_discovery.sql`
erneut zu fahren — die Labels sind connectorabhängig, und dieser Befund stammt aus **einem**
Space bei **einem** Acquirer: „bisher gemessen", nicht „gibt es nicht".

**Wiederholer auf zwei Ebenen**, und die Unterscheidung ist der eigentliche Erkenntniswert:
die **Transaktion** (`attempts_der_transaktion`) beantwortet „hat der Kunde es nochmal
versucht", die **Bestellung** (`versuche_der_bestellung`,
`tds_fehlschlaege_der_bestellung`, `bestellung_am_ende_bezahlt`) beantwortet „hat er es am
Ende geschafft" — ein Kunde, der es nach drei Fehlschlägen mit einer neuen Transaktion
versucht, ist auf der Transaktionsebene unsichtbar. Beides zählt über **alle** Attempts,
auch die erfolgreichen: der `FAILED`-Filter steht deshalb in der äusseren `WHERE`-Klausel,
**hinter** den Fensterfunktionen. Stünde er im `att`-CTE, wäre „am Ende doch bezahlt" still
falsch beantwortet — ein Test prüft das strukturell.
«Innerhalb von 24 h» (§3.8) ist der Abstand zum **ersten** Versuch derselben Bestellung,
ganzzahlig durch 86 400 geteilt, **kein** rollendes Fenster: `RANGE BETWEEN INTERVAL` können
die Athena-Engines je nach Version nicht, und ein Kalendertag-Bucket zerschnitte jede
Bestellung über Mitternacht. Der Preis steht im Code: zwei Versuche kurz vor und kurz nach
einer Blockgrenze zählen als zwei Bestellungen — das **unterschätzt** die Wiederholer, es
erfindet keine. Eine leere Bestellnummer wird nie gruppiert (Partitionsschlüssel
`COALESCE(merchant_reference, CONCAT('#attempt-', <attempt_id>))`; `PARTITION BY` fasste
`NULL`-Werte sonst zu einem Riesen-Eimer zusammen) und erscheint als `null` — „nicht
gruppierbar" ist keine 1.

**Dashboard-Link:** `tdsDashboardUrl(spaceId, transactionId)` baut
`TDS_DASHBOARD_BASIS + <space>/payment/transaction/view/<tx>`; die beiden Bausteine kommen
roh aus dem Parser (`space_id`, `attempt_id`, `transaction_id` und `merchant_reference`
bleiben **rohe Strings**, sie laufen nicht auf `'UNKNOWN'` — ein `UNKNOWN` in einer Adresse
ergäbe einen Link, der aussieht wie einer und ins Leere führt). Zwei Nähte: die
Ziffernprüfung im Modell und `reportingLinkZiel()` in der Ausgabe, die nur eine Adresse
unterhalb von `TDS_DASHBOARD_BASIS` zu einem `<a>` macht. Die Adresse selbst wird **nicht
in SQL erzeugt** — das hiesse, denselben String bis zu 20'000-mal zu übertragen.

**Drei Deckel, drei verschiedene Gründe** — bewusst drei Konstanten statt einer:

- `REPORTING_TDS_LIMIT = 20000` im `LIMIT` der Query. Wird er erreicht, steht
  `abgeschnitten` im Modell, und **alle Zählwerte werden zu Untergrenzen**: die Kacheln
  laufen über das Format `mindestens`, und die Prosa der Hinweise ebenso (seit der
  Abschlussrunde — vorher wies die Kachel „mindestens 20’000" aus, während der Satz
  darunter „die 20’000 Fehlschläge" schrieb). Die **Prozentwerte sind dann keine
  Untergrenzen, sondern Schätzungen**, und „Anteil an allen gescheiterten Versuchen" ist
  sogar systematisch **zu klein** — gekappter Zähler über vollem Aggregat-Nenner. Beides
  steht in der Ausgabe, nicht nur hier.
- `REPORTING_TDS_SCREEN_ZEILEN = 500` für den Bildschirm (Parse- und Renderzeit),
  `REPORTING_TDS_PDF_ZEILEN = 500` für das PDF (Seitenzahl). Gleiche Zahl, verschiedene
  Gründe — sie werden getrennt nachjustiert. **CSV und Excel bleiben vollständig**; der
  Deckel gilt der Anzeige, nie den Daten.

**Excel ist eine eigene Mappe** mit dem einen Blatt `3DS-Failures`, nicht ein Blatt in der
Reporting-Mappe. Der Grund ist derselbe wie der für die zweite Query: das Aggregat soll
weitergabefähig bleiben, die Zeilenliste trägt Bestellnummern. Dazu ein praktischer: ein
gemeinsamer Knopf müsste entscheiden, was er tut, wenn nur eines der beiden Modelle
existiert — zwei Knöpfe müssen das nicht. **Zwei Tests halten das in beide Richtungen
fest** (die 3DS-Mappe hat genau ein Blatt, und die Reporting-Mappe trägt es nicht mit);
einzeln wäre jeder von beiden auch dann grün, wenn das Blatt zusätzlich in der
Aggregat-Mappe landete. Die Link-Spalte heisst in CSV und Excel `dashboard_url` (§3.4) und
trägt die Adresse als Wert — im PDF fehlt sie ganz (zu lang), dort ist die Transaktions-ID
der Anker.

**UI und Ingest.** Panel `reportingTdsSection` (Statuszeile, Export-Leiste, Ausgabe)
erscheint, sobald es etwas zu zeigen gibt — **Modell *oder* Statuszeile**. Die zweite
Bedingung ist kein Komfort: ohne sie wäre eine Fehlermeldung des Imports unsichtbar (kein
Modell, also kein Panel, in dem sie stünde). Der Knopf **„3DS-Liste importieren"** steht
deshalb in der Import-Leiste des Aggregat-Panels — zwei Abfragen, zwei Dateien, eine
Import-Leiste. **Achtung:** anders als beim Aggregat gibt es im Kopieren-Modus **keinen Weg
zur 3DS-Query selbst** — `sqlOutput` trägt immer nur die Aggregat-Query (es wird von Submit
*und* Kopieren gelesen, ein zweites SQL darin bräche den Submit). Der Knopf lädt eine
anderswo erzeugte Datei; die Abfrage setzt die App im API-Modus selbst ab.
`reportingTdsZuruecksetzen()` räumt Modell, Zeilen, Zeitraum und Statuszeile **vor** jedem
neuen Lauf weg — beim Submit *und* beim Token-Abruf; sonst stünde die Liste des Vorlaufs
unter einem frisch geladenen Aggregat.
`abfrageFilter()` ist die **eine** Quelle für Zeitraum und Spaces und wird je Lauf **genau
einmal** gelesen: der Nutzer kann den Picker während eines laufenden Abrufs umstellen, und
ohne diese Festschreibung rechnete die 3DS-Seite ihre Anteile gegen die Grundgesamtheit
eines anderen Zeitraums. Aus demselben Grund reicht `filterGleich()` das Aggregat nur dann
als Nenner durch, wenn es denselben Schnitt sieht — sonst verschwinden die beiden
Anteils-Kacheln, statt einen plausibel aussehenden Prozentwert über eine Liste zu setzen,
zu der er nicht gehört.

**`reporting-tds` ist kein Bedienmodus**, sondern nur ein **Verlaufs**-Modus: es gibt keinen
Knopf dafür, und die Modus-Whitelist in `loadState()` bleibt unangetastet (ein
`mode: 'reporting-tds'` im State fiele wie jeder unbekannte Wert auf `brand` zurück). Damit
die Zeile trotzdem im Verlauf des Reporting-Modus erscheint, gibt es
`HISTORY_NEBENMODI = { reporting: ['reporting-tds'] }` — die Zuordnung gilt **nur in diese
Richtung**. Die Zeile bietet wie die anderen Report-Modi nur den Roh-CSV-Download, und ihr
`filterSummary` sagt „3DS-Failures · E-Commerce": er nennt weder Kanalwahl noch Terminals,
denn die Query kennt beides nicht. Der **Account-Override bleibt auf den Settlement-Modus
beschränkt** — auch hier, aus demselben Grund wie überall (siehe oben); getestet, nicht
angenommen.

**Was die Seite nicht ist:** ein Werkzeug zur Umsatz-Abstimmung (das war der
Reporting-Report schon nicht) und keine Chargeback-Sicht — dafür gibt es im Analytics-Schema
keine Tabelle. Und sie zeigt nur, woran ein **Zahlungsversuch** gescheitert ist: eine
Bestellung, die es nie bis zu einem Charge Attempt geschafft hat, sieht sie nicht (siehe
„Offene Punkte", §5.3).

#### Bewusste Abweichungen von `dashboard/SPEC.md`

Jede offengelegt, keine übersehen:

1. **Der CSV-Knopf des Panels liefert den Report als CSV, nicht das Rohergebnis** (SPEC 5
   sagt „CSV (Rohergebnis)"). Grund: alle vier Ausgaben sollen aus `reportingExportBloecke`
   kommen. Das **Rohergebnis bleibt erreichbar** — über die Verlaufszeile
   (`data-act="csv"` → `holeErgebnisText`). Genau die Aufteilung, die der Settlement-Report
   schon hat; beide Wege existieren, keiner fehlt.
2. **Kanal-Abschnitte statt Kanal-Tabs** (SPEC 5). Tabs zeigen immer nur einen Kanal,
   brechen damit den Ausdruck und die Browser-Suche über alle Kanäle — und sie hätten in
   XLSX und PDF keine Entsprechung, die sind linear (ein Blatt bzw. ein Kapitel je Kanal).
   Gestapelte Abschnitte halten die Gliederung über alle vier Ausgaben gleich.
3. **E5 (Ablehngründe je Zahlungsmittel) erscheint datengetrieben**, sobald ein Kanal
   **mindestens zwei** fehlschlagende Brands hat — SPEC 4.3 führt ihn unter E-Commerce. Bei
   genau einem Brand wäre die Kreuztabelle Zeile für Zeile der K8-Block darüber, nur mit
   einer Spalte, in der immer dasselbe steht. Am POS ist „Visa scheitert an X, TWINT an Y"
   dieselbe brauchbare Aussage. Präzedenz ist P6 (Ablehncodes), der aus demselben Grund in
   beiden Kanälen läuft; P3 (Trinkgeld) folgt derselben Haltung.
4. **`summe_tip` ist Pflichtspalte** — siehe Parser oben: ein vor dem P3-Nachtrag
   abgesetzter Reporting-Token lässt sich nicht mehr nachparsen. Unkritisch, solange der
   Modus frisch ist; hier festgehalten, damit die Meldung „Im Ergebnis fehlen
   Pflichtspalten" an einem alten Token nicht als Fehler untersucht wird.
5. ~~**Die Proxy-Route `GET /failure-reasons` aus SPEC 6.4 existiert nicht** und wird nicht
   gebaut.~~ **Erledigt in v5.12.0 (2026-09-04):** die Route ist gebaut — aber anders, als
   SPEC 6.4 es sich dachte. Sie ruft keinen API-Dienst (den gibt es weiterhin nicht),
   sondern die öffentliche Doku-Seite. Damit ist dies **keine Abweichung mehr**; der Punkt
   bleibt als datierte Korrektur stehen, damit die Kette „kein Dienst → trotzdem eine Route"
   nachvollziehbar ist. Details unter „Proxy-Route `/failure-reasons`".

Nicht in dieser Liste, weil es **keine** SPEC-Abweichung ist: **KPI P5 (Authorization
Method, Kontaktlos/Chip) wurde bereits in Task 0 verworfen** und steht deshalb gar nicht
erst in der eingecheckten SPEC (§4.2 führt P1, P6, P7, P2, P3, P4; §6.3 kennt kein
`DESC_AUTH_METHOD`). Der Grund gehört trotzdem festgehalten, damit die Kennzahl nicht
irgendwann „nachgetragen" wird: das Label `1761481788939` trägt unter
`staticValueContent` nur eine Static-Value-ID, und im ganzen Referenzmonat kommt an POS
**und** E-Com genau **ein** Wert vor. Eine Kennzahl mit einem einzigen Wert misst nichts.

#### Bewusste Abweichungen von `dashboard/SPEC-ITERATION-2.md`

Wie bei `dashboard/SPEC.md`: jede offengelegt, keine übersehen. Es sind acht — die ersten
vier aus v5.12, die letzten vier aus der 3DS-Seite in v5.13.

1. **Die Katalog-Beschreibungen werden nicht vollständig eingebettet** (§1.3 Punkt 2 wünscht
   die «Bedeutung» aus dem Katalog für alle Gründe). Eingebettet sind Name und Kategorie
   aller 2'254 Einträge (~107 KB) plus **~30 kuratierte** Beschreibungen — genau die IDs aus
   §1.2, also die, die in den beiden Referenz-Reports tatsächlich vorkamen. Alle 2'254
   Beschreibungen wären rund **450 KB** zusätzlich, in einer Datei, die schon 1.48 MB wiegt
   und per Doppelklick aus dem Dateisystem geladen wird. §1.3 Punkt 1 rechnet selbst nur mit
   Name + Kategorie und beziffert genau das als den bewusst bezahlten Preis. Für alles
   Übrige gibt es die Proxy-Route, die die Beschreibung je ID mitliefert; im Kopieren-Modus
   bleibt es bei Name und Kategorie — der Name allein beseitigt die `#<id>`-Zeilen, und das
   war der Auftrag.
2. **Der Ablehngrund-Kuchen zeichnet die Zeilen der Tabelle, nicht „Top 6 + Übrige".** §2.1
   nennt für diesen Block „Top 6 + «Übrige»", §2.2 verlangt im selben Abschnitt, dass Tabelle
   und Kuchen **dieselben** Zahlen zeigen — die beiden Vorgaben schliessen sich aus.
   Aufgelöst zugunsten von §2.2: ein Kuchen, der andere Zahlen zeigt als die Tabelle direkt
   darunter, wäre der teurere Fehler, denn dann müsste der Leser raten, welche der beiden
   gilt. In der Praxis stellt die 2-%-Regel den Richtwert „Top 6" meist selbst her — an den
   Referenzdaten liegen ab dem sechsten bis achten Grund fast alle Anteile unter 2 %.
3. **Ein *einzelnes* Sub-2-%-Segment wird nicht eingeklappt.** §2.2 sagt „Segmente unter 2 %
   werden in «Übrige» zusammengefasst", ohne Untergrenze. Bei genau einem bräuchte «Übrige»
   dieselbe Zeile wie der Eintrag selbst, hiesse aber weniger — dieselbe Überlegung, die
   `reportingUebrige()` für die Tabellen schon trifft. Ab zwei greift die Regel wie
   spezifiziert.
4. **Kein fünfter 3DS-Eimer `STARTED_NO_CAVV_SUCCESS`** (v5.12.1, §3.6 verlangt für die
   trotzdem autorisierten Versuche ausdrücklich einen eigenen Eimer-Wert). Als fünfter
   Eimer hätte er eine Erfolgsquote von definitionsgemäss **100 %** und `STARTED_NO_CAVV`
   daneben eine von **0 %** — der Block «3DS-Status» weist aber gerade die Erfolgsquote je
   Status aus (E2), und zwei tautologische Zeilen darin sagen nichts. Stattdessen: **ein**
   Eimer mit ehrlichem Namen und einer aussagekräftigen Erfolgsquote (an den Referenzdaten
   16.8 % — genau die Zahl, die auffällig ist und auffällig bleiben soll), plus die
   absolute Zahl als eigene KPI-Zeile im Block «3DS-Akzeptanz» daneben. Der **Zweck** von
   §3.6 ist damit erfüllt: der Erfolg läuft nicht mehr stumm in die Quote. Nebeneffekt, der
   für dieselbe Lösung spricht: die vier Eimer summieren weiterhin restlos auf die
   Karten-Attempts — ein fünfter wäre eine Teilmenge des zweiten und bräche das.
5. **Ein gestapelter Abschnitt statt eines Reiters** (§3.1 spricht von einem «Reiter»).
   Dieselbe Entscheidung und dieselbe Begründung wie Punkt 2 der SPEC-Abweichungen
   darüber: ein Reiter zeigt immer nur eine Seite, bricht Ausdruck und Browser-Suche und
   hätte in XLSX und PDF ohnehin keine Entsprechung — die sind linear. Der Verweis steht
   auch im Markup-Kommentar, damit er nicht wie ein Versehen aussieht.
6. **Die Zeilentabelle hat kein Filter-Feld** (§3.5 Punkt 3 wünscht eines über Grund,
   Brand, Land, Referenz). Es ist **nicht gebaut** — eine Auslassung, keine Umsetzung auf
   anderem Weg, und sie steht hier, damit sie nicht als „übersehen" durchgeht. Der Rest der
   Seite kommt ohne es aus: die Aufschlüsselungen darüber beantworten „woran scheitert es",
   und wer einzelne Zeilen suchen will, nimmt Excel oder das Roh-CSV über der
   **vollständigen** Liste. Ein Feld über der Bildschirmtabelle sähe zudem aus, als
   durchsuchte es die Abfrage, während es nur die gedeckelten 500 Zeilen sähe. Nachrüstbar
   bleibt es jederzeit — es ist reine Bildschirm-Interaktion über einer Zeilenliste, die
   das Modell ohnehin vollständig und vorsortiert liefert.
7. **«mindestens n» erreicht nur zwei der vier Ausgaben.** Bildschirm und PDF schreiben
   `mindestens 20’000`, CSV und Excel die nackte Zahl `20000` — §3.5 schreibt „die Ausgabe
   schreibt mindestens n" ohne Einschränkung. Grund: in einer Tabellenkalkulation wird über
   dieser Spalte gerechnet und sortiert, ein String `"mindestens 20’000"` wäre dort der
   teurere Verlust. Dass die Zahl eine Untergrenze ist, fährt trotzdem in **allen vier**
   Ausgaben mit — der Hinweis des Blocks steht in jeder von ihnen, und seit der
   Abschlussrunde auch in der Prosa daneben (vorher wies die Kachel „mindestens" aus und
   der Satz darunter dieselbe Zahl als exakt).
8. **Die Kachel «Bestellungen mit 2 oder mehr 3DS-Fehlschlägen» kommt ohne den zugehörigen
   Betrag** (§3.8 nennt „der Betrag, der nicht verloren ist" als Ziel). Er ist aus diesen
   Zeilen **ohne Doppelzählung nicht bildbar**: jeder gescheiterte Versuch trägt den vollen
   Betrag der Bestellung erneut, und der Bestellwert selbst steht in keiner Spalte. Eine
   Summe über die Zeilen zählte denselben Warenkorb je Wiederholung noch einmal — eine
   Zahl, die grösser wird, je öfter jemand scheitert, und die genau dort stünde, wo der
   Leser „gerettetes Volumen" liest. Der Hinweis der Kachel sagt das seit der
   Abschlussrunde ausdrücklich; vorher stand es nur im Modell-Kommentar. Bildbar wäre er
   erst mit dem Bestellwert als eigener Spalte — dazu müsste die Query wissen, welcher
   Versuch einer Bestellung ihren Wert trägt.

#### Grenzen (dem Kunden so kommunizieren)

- **Keine Chargebacks/Disputes** — das Analytics-Schema hat keine Tabelle dafür (SPEC 4.4).
  Nicht „noch nicht gebaut", sondern nicht verfügbar.
- **Keine IC++-Aufschlüsselung** (DCC/Interchange/Scheme/Acquirer) — dieselbe Grenze wie in
  allen übrigen Modi. Der **DCC-Anteil** (P7) ist davon unberührt: er zählt nur, *ob* in
  Fremdwährung abgerechnet wurde (Label `DESC_DCC_CURRENCY`), nicht was das gekostet hat.
- **Labels sind connectorabhängig.** Alle Descriptor-IDs stammen aus **einem** Acquirer-Setup
  (Task 0). Schreibt ein anderer Connector andere IDs, zeigt der Report für die betroffenen
  Kennzahlen `UNKNOWN` — er wird nicht falsch, aber blind. Dann ist
  `dashboard/sql/00_label_discovery.sql` erneut zu fahren und die Konstanten sind
  nachzuziehen.
- **Kein Liability-Shift-Ausweis** — ~~es existiert kein solches Label (Task 0)~~;
  **korrigiert 2026-09-04:** es existiert, nur nicht überall (`1634723429059`, im zweiten
  Händler-Space gemessen). Der 3DS-Abschnitt endet weiterhin bei Authentifizierung/Abbruch,
  weil das Label connectorabhängig ist und in den Referenz-Spaces der Konstanten fehlt.
- **Die Withdrawal-/`payoutref`-Heuristik ist unverändert** und betrifft diesen Modus nicht:
  der Reporting-Modus fasst `currentaccountwithdrawal` nicht an.
- **`summe_refund` und `summe_betrag_failed` sind Obergrenzen** (Mehrfachzählung über
  Attempts derselben Transaktion, siehe P3 oben); `summe_betrag` und `summe_tip` sind exakt.
- **Conversion und Retry-Rate auf Kanal-Ebene** sind eine Obergrenze des Nenners (CONV ist
  nach Brand gruppiert). Eine exakte Zahl bräuchte einen vierten Query-Block.

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
  eigenen Einträge. **Eine Ausnahme seit v5.13:** `HISTORY_NEBENMODI =
  { reporting: ['reporting-tds'] }` blendet die Einträge der 3DS-Abfrage im Verlauf des
  Reporting-Modus mit ein. Die Zuordnung gilt **nur in diese Richtung** — `reporting-tds`
  ist kein Bedienmodus, es gibt keine Ansicht, in der es der eigene Modus wäre.
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
  Rahmen wie beim Report. **In den Modi `terminal`, `settlement` und `reporting` zeigt die
  Verlaufszeile nur den Roh-CSV-Download** — Excel (und im Settlement-/Reporting-Fall auch
  PDF) sowie die Report-Ansicht laufen dort über das jeweilige Report-Panel selbst
  (`exportReportXlsx`/`exportSettlementXlsx`/`exportSettlementPdf`/`exportReportingXlsx`/
  `exportReportingPdf` mit gebrandetem Titel bzw. der nach dem Submit automatisch gezeigte
  Report), deshalb kein Excel-Button in der Verlaufszeile dieser drei Modi. Die Liste steht
  seit v5.11 als Konstante `MODI_MIT_REPORT_PANEL` statt als Oder-Kette in `renderHistory`.
  Jeder erneute Abruf über den Token zählt bei wallee als Download (siehe „Wallee-
  Referenzwissen").
- **Seit v5.14.3 trägt jeder Eintrag `spaces: [{ id, label }]`** (die gewählten Spaces mit
  Label, additiv) — für den Dateinamen des Terminal-Reports beim Token-Abruf.
- **Seit v5.14.2 trägt jeder Eintrag `start`/`end`** (voller Zeitraum der Abfrage mit
  Uhrzeit, additiv neben `timeframeSummary`) — der Terminal-Report zeigt beim Abruf über den
  Token den Zeitraum jener Abfrage (siehe „Terminal-Report", Abfragezeitraum).
- **Seit v5.14 merkt sich ein Terminal-Eintrag die zuletzt exportierte Excel-Variante**
  (Entscheid O2): `historyMitXlsxVariante(list, token, variante)` (rein, neue Liste, nur der
  Eintrag des Tokens bekommt das additive Feld `xlsxVariante`) und
  `historyXlsxVarianteLabel(e)` („Excel: Kondensiert" / „Excel: Full") in der
  Zusammenfassung der Zeile. Gesetzt über `merkeReportXlsxVarianteImVerlauf` nach dem
  Export, am Token `reportQuelleToken`; ein Report ohne Token hat nichts zu merken.
  **Verlaufs-Excel** (`styledSheetAusZeilen`): führt die Kopfzeile `autorisiert_gross`
  (`brand`/`terminal`), hängt es unter die Tabelle eine Leerzeile und den Hinweis G2 an
  (verbunden, kursiv) — `export`/`card`/`settlement` bleiben unberührt.
- **Befüllt wird der Verlauf bei jedem erfolgreichen Submit** (unabhängig vom Modus); die Modi
  `terminal`, `settlement` und `reporting` speisen zusätzlich sofort ihr jeweiliges
  Report-Panel, um einen weiteren Result-Abruf zu sparen. Der Verlaufseintrag merkt seit v5.8 zusätzlich den Account,
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
  `buildSettlementQuery`, `buildReportingQuery` sind reine Funktionen (Input-Objekt →
  SQL-String) — bewusst so gehalten, damit sie ohne DOM testbar sind.
- `txCte({ spaceIds, start, end, autorisiert })` grenzt die Transaktionen (Space + Zeitraum
  + Status) einmal gemeinsam ein; `card`-, `settle`- und `payoutref`-CTE im
  Transaktions-Export filtern darüber, statt die teuren Joins über die gesamte
  Tabellenhistorie laufen zu lassen. Zeitfenster und Statusfilter liefert
  `txBasisBedingungen({ start, end, autorisiert })` als Liste — dieselbe Liste steht im
  `tx`-CTE **und** im Hauptselect von `brand`/`terminal`, damit beide dieselbe Menge
  beschreiben. Nur diese beiden setzen `autorisiert: true` (siehe „Sechs Modi", Punkt 1).
  `cardCte({ spaceIds })` kapselt die Label-Auflösung (siehe unten) und wird von
  Transaktions-Export und Kartensuche gemeinsam genutzt. **`buildSettlementQuery` nutzt
  `txCte` seit v5.8 nicht mehr** — der Modus ist account- statt space-basiert (kein
  `spaceIds`-Parameter mehr) und baut sein eigenes, kleineres `tx`-CTE (nur Zeitraum +
  Status, kein Space-Filter) sowie ein eigenes `settle_tx`-CTE inline auf. Kein Join mehr auf
  `currentaccountwithdrawal` (ausser bei aktiver Referenz-Option, seit v5.9 — siehe
  „Settlement-Report" oben). **`buildReportingQuery` nutzt `txCte` ebenfalls nicht** — es
  filtert auf `t.completedon` und `t.state`, der Reporting-Modus auf `ca.createdon` und ohne
  Statusfilter; sein eigenes, sehr schmales `tx`-CTE (nur `DISTINCT c.transaction_id` aus
  den Attempts des Zeitraums) existiert allein, damit `tipCte` unverändert darauf aufsetzen
  kann. `cardCte` wird dort nicht verwendet — die Labels holt `labelExpr(id, key)` direkt,
  nach demselben `element_at(filter(...))`-Muster, aber mit explizitem, descriptorabhängigem
  Map-Key (siehe „Reporting-Report" oben).
- `spaceInClause(ids, col)`: 0 Spaces → `col = -1 -- BITTE ... AUSWÄHLEN` (Query läuft leer
  statt zu crashen), 1 Space → `=`, mehrere → `IN (...)`.
- Zeitfilter immer auf `t.completedon` (Tagesabschluss, nicht Erstellung!) mit
  `>= TIMESTAMP ... AND < TIMESTAMP ...`. **Zwei Ausnahmen:** `buildReportingQuery`
  filtert auf `ca.createdon` — ein gescheiterter Charge Attempt hat kein `completedon`
  (siehe „Sechs Modi", Punkt 6); der Zeitraum-Picker bedeutet dort also etwas anderes als in
  allen übrigen Modi. Und **`buildBrandQuery`/`buildTerminalQuery` filtern seit v5.14 auf
  `COALESCE(t.completedon, t.authorizedon)`** — für abgeschlossene Transaktionen exakt
  `completedon`, für offene Autorisierungen (die kein `completedon` haben) der
  Autorisierungszeitpunkt. Der Picker meint dort also weiterhin den Tagesabschluss, nur
  dass eine noch nicht eingereichte Autorisierung nach ihrem einzigen Zeitpunkt eingeordnet
  wird (siehe „Sechs Modi", Punkt 1). Ein Schnappschuss-Test hält fest, dass `export`,
  `card`, `settlement` und die Reporting-Queries weder `authorizedon` noch `AUTHORIZED`
  kennen.
- Statusfilter fix `t.state IN ('FULFILL', 'COMPLETED')` — **ausser in `brand`/`terminal`**
  (seit v5.14 `('AUTHORIZED', 'FULFILL', 'COMPLETED')`, die Zähler dafür per `CASE`
  geschützt) **und ausser im Reporting-Modus**:
  der zählt Versuche, auch gescheiterte, und filtert stattdessen fest auf
  `ca.environment = 'PRODUCTION'`.
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
    **`buildReportingQuery` nutzt seit v5.11 dasselbe `tipCte` unverändert** (Spalte
    `summe_tip`, KPI P3) — mit einem eigenen `tx`-CTE als Unterbau und einem zusätzlichen
    `CASE WHEN ca.state = 'SUCCESSFUL'`-Guard, weil dort die Attempt-Körnigkeit eine zweite
    Ausprägung desselben Fallstricks erzeugt (siehe „Reporting-Report" oben).
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
`?account=<id>`, optional), `DELETE /query/:token`, `GET /terminals?space=<id>`, `POST /update`,
`GET /failure-reasons?ids=<id>,…` (seit v5.12 — die einzige Route ohne JWT und ohne
Account-Header, sie liest die öffentliche Doku-Seite; Details unter „Proxy-Route
`/failure-reasons`").

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
    `ladeUndSchreibeUpdate`) sind getestet, u. a. gegen einen gestubbten `fetch` — **alle in
    `test/proxy.test.js`**, zusammen mit `POST /update` am Route-Dispatch und der
    Header-Abweisung. `test/self-update.test.js` enthält nur `istNeuer` (die App-Seite des
    Vergleichs), nicht die Proxy-Seite des Updates. **`starteNeustart` ist nicht getestet** —
    die Funktion startet einen detached Kindprozess und beendet den eigenen, das lässt sich
    im Test-Runner nicht ohne Nebenwirkung ausführen.
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
  - **Card Holder Name: `1456765000789`** — Klartext-Name, **PII**. Zusammen mit der Masked
    Card Number die Sperrliste des Reporting-Modus (SPEC 9); beide dürfen dort nie
    vorkommen, auch nicht in einem `GROUP BY`.
  - Die Descriptors des Reporting-Modus (Issuer-Land, Kartentyp, Kartenkategorie,
    Ablehncodes, 3DS, ECI, PAN-Typ, DCC) stehen mit ihren **Map-Keys** in der Tabelle unter
    „Reporting-Report" oben.
  - **Der Map-Key ist descriptorabhängig** — `shortTextContent` ist nur der häufigste Fall,
    daneben kommen `countryContent`, `dateTimeContent`, `longTextContent`,
    `staticValueContent`, `integerContent`, `yearMonthContent` vor. Ein falscher Key wirft
    nicht, er liefert dauerhaft `NULL`.
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
- **Autorisierter Betrag (v5.14) — an Produktivdaten gemessen (Discovery Task 0,
  `sql/autorisiert_verifikation.sql`, Space 73192, POS, letzte 90 Tage, gelaufen
  2026-09-12; Rohdaten in `Terminal-Report-Tool/discovery-results/`, gitignored).**
  `transaction` führt laut Analytics-Schema `authorizedon` als `timestamp`, dazu
  `authorizationamount`, `completedon`, `failedon`, `confirmedon`, `totalsettledamount`; eine
  `voidedon`-Spalte gibt es nicht. Befunde — wie überall „bisher beobachtet", ein Space:
  - **Q1:** `authorizedon` ist bei `FULFILL` (98'233) und `AUTHORIZED` (64) **durchgehend
    gefüllt**, bei `FAILED` (1'773) durchgehend leer; `completedon` fehlt bei `AUTHORIZED`
    ausnahmslos, und `authorizedon` liegt nie nach `completedon`. Der Zustand `COMPLETED`
    kam gar nicht vor (nur `FULFILL`), `VOIDED` 10-mal. Kein Rückfall auf `createdon`.
  - **Q2:** 64 offene Autorisierungen über CHF 2'336.70, **alle jünger als zwei Tage** (62
    unter einem Tag). Liegengebliebene Autorisierungen sind also real, aber kurzlebig — die
    `VOIDED`-Fälle (10 in 90 Tagen, bis über 30 Tage alt) zeigen, wo eine nie eingereichte
    endet.
  - **Q3/Q3b:** bei allen 98'233 abgeschlossenen Transaktionen ist `completedamount` **exakt**
    gleich `authorizationamount` (Summe je 4'356'545.18, null Zeilen mit Differenz, keine
    Nachbuchung, kein Teil-Capture). Der Hinweis G2 bleibt ohne den Zusatz aus SPEC O3.
  - **Q4:** bei den 64 `AUTHORIZED` sind `completedamount`, `totalappliedfees` und
    `totalsettledamount` **64-mal 0**, kein Settlement-Record — **aber eine trägt bereits ein
    Trinkgeld-Lineitem.** Deshalb ist `tip_total` seit v5.14.1 wie die Zähler auf
    `FULFILL`/`COMPLETED` geschützt; `brutto_gross`, Fees und Netto bleiben ohne Guard.
  - **Q5:** `terminal_id` und `paymentconnectorconfiguration_id` sind bei allen 64
    `AUTHORIZED` gesetzt, jeder Terminal-Treffer aufgelöst — eine offene Autorisierung
    erscheint im Terminal-Report unter ihrem Terminal (SPEC A2).
- **Charge-Attempt-Befunde (Task 0, v5.11) — bisher beobachtet, nicht „gibt es nicht".**
  Grundlage sind **zwei** Spaces über **einen** Monat: der **POS-Referenzspace** (12'537
  Attempts) und der **E-Com-Referenzspace** (1'855 Attempts), jeweils **Juli 2026**,
  ausgewertet mit `dashboard/sql/00_label_discovery.sql` und `00b_ecom_discovery.sql`; die
  Rohdaten, die Auswertung und die Zuordnung der Space-IDs liegen in
  `dashboard/discovery-results/` (nicht im Git, `DESCRIPTORS.md` bzw. `SPACE-IDS.md`). Ein
  anderer Space, ein anderer Acquirer oder eine Schema-Änderung kann das verschieben — dann
  sind die Discovery-Queries erneut zu fahren.
  - **`ca.state` kam nur als `SUCCESSFUL` und `FAILED` vor — kein `PENDING`, in keinem der
    beiden Spaces.** Der Code behandelt `PENDING` trotzdem defensiv (eigener Zähler „offen",
    aus allen Quoten heraus), und ein unbekannter Zustand landet sichtbar im Eimer
    `sonstige`. Success Rate im Referenzmonat: POS 98.6 %, E-Com 91.3 %.
  - **`environment` war durchgehend `PRODUCTION`**, `customerspresence` am POS durchgehend
    `PHYSICAL_PRESENT`, im E-Com `VIRTUAL_PRESENT`.
  - **Abdeckung der Karten-Labels ≈ 89 % am POS** (11'193 von 12'537). Der Nenner von
    K5/K6/P1/P7 ist deshalb „Karten-Attempts", nicht „alle Attempts". **Achtung, hier stand
    bis zum Referenzlauf ein Fehlschluss:** „das sind exakt die Karten-Brands". Label-
    Abdeckung und `KARTEN_BRANDS` fallen **nicht** zusammen. Gemessen am Referenzlauf:
    `PostFinance Card` trug am POS auf **1'097 von 1'113** Attempts Issuer-Land, Funding
    und Kartenkategorie, stand aber nicht in der Liste — die Label-Menge (11'193) war
    damit **959 Attempts grösser** als die Listen-Menge (10'234 = 81.6 %), und K5/K6/P1/P7
    liessen rund 1'098 Attempts liegen, die genau die Labels trugen, die sie messen.
    Seither steht `PostFinance` in `KARTEN_BRANDS`. **Was sich dadurch verschiebt**
    (am Referenzlauf nachgerechnet): POS-Kartenbasis 10'234 → **11'347** Attempts bzw.
    10'096 → **11'193** erfolgreiche, E-Com 422 → **427** bzw. 378 → **383**. Von den
    ausgewiesenen Kennzahlen bewegt sich **eine**: `tds.angefordertAnteil` im E-Commerce
    73.5 % → **72.6 %** — derselbe Zähler (310), ein um 5 grösserer Nenner. Die
    3DS-Akzeptanz E1 bleibt bei **90.6 %** (281/310), weil die neuen Attempts kein 3DS
    starten, und die vier `tds`-Eimer summieren vorher wie nachher **restlos** auf die
    Karten-Attempts. **Label-los sind** TWINT, Lunch Check, Reka, Boncard und
    PowerPay Invoice — auf **keinem** ihrer Attempts ein Karten-Label.
    **Und es ist kanalabhängig:** dieselbe Marke trug im E-Commerce auf keinem ihrer
    4 Attempts ein Label. Sie zählt dort trotzdem zur Kartenbasis und landet sichtbar in
    den `UNKNOWN`-Eimern bzw. in `NOT_REQUESTED` — „kein Label" ist eine Messung, „nicht
    gezählt" wäre keine.
  - **Issuer Country ist ISO-2** (POS 76 Länder, CH 83 %; E-Com CH 91 %) — Map-Key
    `countryContent`, **nicht** `shortTextContent`. Funding: POS 68 % Debit, E-Com 26 %.
  - **Card category kennt 37 Produktwerte**; `KARTEN_BUSINESS_REGEX` deckt davon 14 ab
    (POS: 107 von 11'193 = 1.0 %). `NOT_SPECIFIED` ist häufig (POS 14 %, E-Com 35 %) und
    zählt als `UNKNOWN`, nie als `PRIVATE`.
  - **`ca.tokenversion_id` war durchgehend `NULL`** — „tokenisiert" lässt sich darüber nicht
    messen. Ersatz und Quelle von KPI E6 ist deshalb das Label **Pan Type**
    (`1634723429555`, `DEVICE_TOKEN_APPLE_PAY`, `SCHEME_TOKEN_CLICK_TO_PAY`, … 5 Werte).
  - **Authorization Method (`1761481788939`) ist unbrauchbar** und deshalb bewusst **keine**
    Konstante: der Map-Key ist `staticValueContent`, der Wert eine Static-Value-ID, und im
    ganzen Monat kam an POS **und** E-Com nur dieser eine Wert vor. KPI P5
    (Kontaktlos/Chip/Magnetstreifen) entfällt damit.
  - **3-D Secure schreibt der Connector anders als die Doku-Übersicht vermuten lässt:** es
    gibt **keine** „Authenticated / Status / Liability Shift"-Labels. Vorhanden sind Process
    Started (`1568637480278`, `dateTimeContent`, 310 von 424 Karten-Attempts = 73 %),
    Process Finished (`1568637885195`, 310), CAVV (`1569496536590`, `longTextContent`, 281)
    und Cryptogram ECI (`1634723429552`, 113, Wallet-/Token-Attempts). Daraus die vier
    `tds_status`-Werte; 3DS-Akzeptanz im Referenzmonat 281/310 = 90.6 %, was sich mit den
    29 Attempts der Failure Reason „3-D Secure Failure" deckt.
    **Nachtrag 2026-09-04, an einem zweiten Händler-Space gemessen:** die Aussage „es gibt
    keine Liability-Shift-Labels" gilt **nur für diesen Connector**. Der andere schreibt
    `1634723429059` Liability Shift (`ON`), dafür **keines** der dreizehn EMVCo-Felder aus
    der Gruppe «3-D Secure Details» — siehe „Charge-Attempt-Befunde am zweiten
    Händler-Space" unten.
  - **`wallet` ist am POS immer leer, im E-Com gefüllt** (Apple Pay, Google Pay, Click To
    Pay; 195 von 424 Karten-Attempts = 46 %) — Namen über `wallettype.name['en-US']`.
  - **`failurereason` ist am POS grob** (nur 2 Werte: „Transaction declined" 158,
    „Automatically cancelled" 14) und im E-Com differenziert (u. a. Cancellation Initiated
    by User 50, Authorization Canceled by Scheme 38, 3-D Secure Failure 29). Der
    **Authorization Response Code** ist am POS die feinere Achse (14 Werte, `00`…`Z3`).
  - **DCC ist sichtbar**, aber selten: 2 von 12'537 Attempts (EUR, SEK).
  - **Retry ist am POS praktisch inexistent** (12'507 Transaktionen mit 1 Attempt, 15 mit 2)
    — im E-Commerce ist er der eigentliche Grund für die Attempt-Basis.
  - **Beträge:** `t.authorizationamount` ist auch bei `FAILED` gefüllt (Ø 24.04),
    `t.completedamount` bei `FAILED` 0; bei `SUCCESSFUL` sind beide identisch (Ø 20.98).
    Daher `completedamount` für den Umsatz und `authorizationamount` für den
    „Ø abgelehnten Betrag".
- **Charge-Attempt-Befunde am zweiten Händler-Space (Discovery Q2, 2026-09-04).** Grundlage
  ist ein **dritter** Space mit einem **anderen Acquirer-Setup**, Juni–August 2026, nur
  `FAILED`: 15'198 Karten-Attempts mit Labels, 18'177 Fehlschläge insgesamt. Space-ID,
  Händler und Zahlen im Einzelnen stehen in
  `dashboard/discovery-results/DESCRIPTORS.md` und `FALL-B.md` (beide gitignored — das Repo
  ist öffentlich); hier nur, was dauerhaft gilt. **Dies ist der erste Lauf, der „Labels sind
  connectorabhängig" nicht bloss behauptet, sondern misst — und zwar in beide Richtungen.**
  - **Keines der dreizehn EMVCo-3DS-Felder kommt im Analytics-`labels`-Array an**:
    Transaction Status (`1611157230835`), Transaction Status Reason (`1611160961002`),
    Challenge Cancel (`1611161612971`), Authentication Type, ACS Transaction ID, ACS
    Protocol Version, DS Transaction Id, die zweite ECI-Variante, 3-D Secure Status, sowie
    ACS Reference Number in **beiden** Ausprägungen (Endeavour `1552301704857`, Netcetera
    `1698042396612`) und Challenge Mandate/Active. Der Händler **sieht** diese Felder im
    Backend — sie entstehen also im 3DS-Server, landen aber nicht in der Analytics-Tabelle.
    **Folge:** die Achsen «Challenge-Status-Grund» und «ACS» sind aus dem Analytics-Export
    nicht baubar, weder hier noch anderswo, solange kein Connector sie schreibt. Wer sie
    braucht, geht über die API je Attempt (SPEC-ITERATION-2 §4.4). Der Rückfall ist die
    Dauer zwischen `3-D Secure Process Started` und `Process Finished`.
  - **Dafür sechs Labels, die in Task 0 nie sichtbar waren** — Namen aus
    `dashboard/catalog/label-descriptors.json`, Häufigkeit gemessen:
    `1458749261553` **Card Issuer Number (BIN)**, `integerContent`, 15'197 von 15'198 —
    das ist die Issuer-Achse aus SPEC-ITERATION-2 §5.1, gruppierbar auch ohne BIN-Tabelle;
    `1620379912010` **3-D Secure Version** (`staticValueContent`, 2'330);
    `1634723431551` **Attempt Retry** (`No Retry` / `Retry Later`, 836) — eine **gemessene**
    Wiederholungs-Empfehlung des Schemes, fachlich stärker als die kuratierte
    `FAILURE_ADVICE`; `1634723429059` **Liability Shift** (`ON`, 169);
    `1634723429554` **Cryptogram Present** (`booleanContent`, 2'646) — ein sauberes Ja/Nein
    statt der Existenzprüfung auf CAVV; `1785220291000` **Processor Error Code** (16 Werte,
    944).
  - **Card Holder Name im Klartext ist hier die Regel, nicht die Ausnahme**: 11'903 von
    15'198 Attempts, 9'417 verschiedene Werte (POS-Referenzspace: 245). Die PII-Sperrliste
    (SPEC §9) ist damit keine Vorsichtsmassnahme, sondern trägt.
  - **Alle 34 vorkommenden `failurereason`-IDs lösen gegen den eingebetteten Katalog auf** —
    kein `#<id>`. Die handgepflegte Tabelle vor v5.12 hätte davon fünf benannt; die übrigen
    29 Gründe machen rund 12 % der Fehlschläge aus. Das ist der Abnahmenachweis der
    Definition of Done aus SPEC-ITERATION-2 §6, an echten Daten.
  - **Die Override-Tabelle trägt messbar.** Mit ihr fallen 98.7 % der Fehlschläge in die
    Kategorie *End User* und 0.7 % in *Configuration*; ohne sie stünde *Configuration* bei
    10.6 % — allein wegen der beiden PostFinance-Timeouts, die der Katalog falsch einordnet.
    Der Unterschied ist die Aussage „das Problem liegt beim Checkout-Verhalten der Kunden"
    gegen „zehn Prozent sind ein wallee-/Acquirer-Thema".
  - ~~**Was der Lauf NICHT klären konnte:** er filtert auf `FAILED`, der Widerspruch aus
    SPEC-ITERATION-2 §3.6 … braucht dieselbe Frage für `SUCCESSFUL`. Query liegt als Q2e
    bereit.~~ **Q2e ist gelaufen (2026-09-04) und hat den Widerspruch aufgelöst — zulasten
    der Heuristik.** Von **103'729 erfolgreichen** Attempts trugen 67'054 einen 3-D-Secure-
    Start, davon **64'615 ein CAVV**: **2'439 erfolgreiche Attempts sind «gestartet ohne
    CAVV»** (direkt gemessen ohne CAVV *und* ohne Cryptogram Present: 2'419 — das Label
    erklärt den Fall also nicht). Zusammen mit den 12'105 gescheiterten desselben Zuschnitts
    (14'275 gestartet, 2'170 mit CAVV) ist der Eimer **14'544** gross, davon **16.8 %
    erfolgreich** — exakt die Erfolgsquote, die der Report vom 03.09.2026 auswies und die
    per Definition unmöglich schien. **Die Heuristik «gestartet ohne CAVV = gescheitert» ist
    damit widerlegt, nicht bloss bezweifelt.** Folge in v5.12.1: der Eimer heisst
    `STARTED_NO_CAVV` (siehe „Herkunft, Kartentyp, 3DS — die Klassifikation"). Was die
    2'439 wirklich sind, bleibt offen und **ist aus dem Analytics-Export nicht zu
    beantworten** — die dafür nötigen EMVCo-Felder kommen dort nicht an, das hat derselbe
    Lauf gemessen (Punkt eins dieser Liste).
- **Es gibt keinen Failure-Reason-Dienst in der wallee-Web-Service-API.** 98 Services in
  Doku und Java-SDK, keiner davon; beide Kandidatenpfade antworten mit einer HTML-404;
  `static-values` kennt die IDs nicht; das Analytics-Schema hat keine Nachschlagetabelle.
  Details und die vollständige Beweiskette stehen unter „Reporting-Report" oben und in
  `.superpowers/sdd/PLAN/task-6-report.md` — **den Endpunkt nicht erneut suchen**.
- **Grenzen der Analytics** (nicht lösbar, dem Kunden so kommunizieren):
  - Keine IC++-Aufschlüsselung (DCC/Interchange/Scheme/Acquirer) — nur `totalappliedfees` gesamt.
  - **Keine Chargebacks/Disputes** — es gibt keine Analytics-Tabelle dafür. Betrifft den
    Reporting-Modus, der sonst der natürliche Ort dafür wäre.
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
   (Trinkgeld/Unsettled-Zähler), `proxy` (reine Proxy-Funktionen inkl. JWT gegen RFC-7515,
   die Account-Header-Logik **und die gesamte Proxy-Seite des Self-Updates**: `tagValide`,
   `updatePfad`, `sanityHtml`/`sanityProxy`, `ladeUndSchreibeUpdate` gegen gestubbten
   `fetch`, `POST /update` am Route-Dispatch und dessen Header-Abweisung), `self-update`
   (**nur** `istNeuer` — der Versionsvergleich auf der App-Seite; der Dateiname ist
   irreführend, der Rest des Self-Updates steht in `proxy`),
   `reporting-queries`/`reporting-model`/`reporting-export`/
   `reporting-render`/`reporting-ui`/`reporting-xlsx` (Reporting-Modus seit v5.11: SQL inkl.
   Descriptor-IDs, PII-Sperrliste, GROUP-BY-Listen und typisierten UNION-Platzhaltern ·
   **Parser und Modell zusammen** in `reporting-model` · Export-Blöcke · Render, SVG-Balken,
   CSV/PDF-Blöcke, Verlaufszeile · State/Panels/`generate()`/Ingest · XLSX end-to-end),
   `reporting-tds-queries`/`reporting-tds-model`/`reporting-tds-export`/
   `reporting-tds-render`/`reporting-tds-ui`/`reporting-tds-xlsx` (die Seite «3DS-Failures»
   seit v5.13, **sechs neue Dateien** — `reporting-tds-queries` deckt
   Query **und Parser** ab: SQL inkl. der fünf neuen Descriptor-IDs und ihrer Map-Keys, der
   Nachweis, dass die dreizehn EMVCo-IDs **nicht** zurückkehren, dass der `FAILED`-Filter
   hinter den Fensterfunktionen steht und dass CAVV genau einmal im ganzen SQL vorkommt ·
   Modell mit von Hand gerechneten Erwartungswerten (Dauer-/Betrags-Eimer, Wiederholer auf
   beiden Ebenen, Sortierung samt numerischem Tie-Break) · Blockschicht, CSV und PDF ·
   Bildschirm-Markup und -Deckel · Panel, Ingest, Verlauf und der ganze Lauf über ein
   gefälschtes `fetch` · die Mappen-Entscheidung in beide Richtungen),
   `embedding`/`dom-ids` (Struktur-/ID-Wächter).
   **v5.14 (autorisierter Betrag, Excel-Varianten, XLSX-Finalisierung):** `report-export`
   (Blockschicht, aus `report` herausgelöst: Full/Kondensiert, Kennzahl-Reihenfolge,
   CSV-Fussnote), `xlsx-layout` (Spaltenbreiten, Seitenlayout, Drucktitel,
   `xlsxSeitenlayoutEinbetten` als reine String-Funktion inkl. Idempotenz und `$&`-Falle),
   `report-dialog` (Excel-Dialog über den DOM-Stub), `history-xlsx` (Verlaufs-Excel mit
   Vendor: Hinweiszeile nur bei `autorisiert_gross`); dazu neue Nähte in `queries`
   (COALESCE-Fenster, State-Filter, Zähler-Schutz, Schnappschuss der übrigen Builder),
   `report`/`report-render`/`report-xlsx` (Authorized, Orange, Hinweis, Varianten,
   `sheet1.xml`-Prüfung über `XLSX.CFB`, Schriftfarbe über `styles.xml` — der Reader gibt
   Schriftfarben nicht zurück), `history`, `dom-ids` und die Zusicherungen in
   `reporting-xlsx`/`reporting-tds-xlsx`.
   **v5.12 hat keine neue Testdatei gebracht, sondern vier neue Nähte in bestehenden:**
   `embedding` prüft zusätzlich den Build-Schritt `tools/build-failure-reasons.mjs` (er
   gehört dorthin, weil er dasselbe schützt wie der Rest der Datei — die Unversehrtheit der
   Single-File-App beim Einbetten, inklusive der `$&`-Falle: erzeugter Block, Idempotenz,
   Abbruch bei fehlenden/doppelten Markern **und bei unbekannter Kategorie**, dazu der
   Wächter „der eingecheckte Block ist der Stand des Katalogs"). `proxy` deckt die Route
   `GET /failure-reasons` mit ab — Zerlegen der `ids` **vor** dem ersten Netzzugriff, der
   Seitenparser gegen **zwei eingefrorene HTML-Fixtures**
   (`test/fixtures/failure-reason-treffer.html` und `-login.html`, Stand 2026-09-03, nie
   gegen das Netz), Cache-Version/Höchstalter/atomares Schreiben und das Gesamtbudget.
   `dom-ids` trägt zusätzlich den **statischen Farb-Wächter** `:root` ↔ `SVG_KUCHEN_FARBEN`
   (siehe „Kuchendiagramme"), und `reporting-render`/`-export`/`-xlsx` die Kuchen: Geometrie,
   Bezier-Näherung, 2-%-Regel in beide Richtungen, PDF-Pfad und die Zusicherung, dass **kein
   Excel-Blatt** eine Kuchenzeile trägt.
   Die Reporting-Tests laufen gegen `test/fixtures/reporting-beispiel.csv` — eine
   **synthetische**, deterministisch erzeugte Fixture
   (`test/fixtures/generate-reporting-beispiel.mjs`, fest verankerte Summen). **Inhalt
   erfunden, Schreibweise gemessen:** seit dem Referenzlauf vom 2026-09-01 ist ihr Format
   Feld für Feld gegen die echte Athena-Ausgabe abgeglichen — NULL als **unquotiertes**
   Leerfeld (`,,`, nie `""`), jeder vorhandene Wert in Anführungszeichen (auch Zahlen und
   Booleans), acht Nachkommastellen, `true`/`false`, `yyyy-mm-dd`, Stunde ohne führende
   Null, LF, kein BOM, und die Zeilenreihenfolge des `ORDER BY` (Blöcke CONV, DIM, TIME).
   Zählwerte, Beträge und die Space-IDs (90001/90002) bleiben **erfunden** — das Repo ist
   öffentlich, aus den Referenzdaten darf kein Wert hierher wandern. Nicht belegt sind
   negative Beträge, `PENDING` und der dritte Verkaufskanal: die kamen in beiden Spaces
   nicht vor, die Fixture führt sie als Struktur, weil der Code sie behandelt. Umgekehrt
   bildet sie seit der `KARTEN_BRANDS`-Korrektur **beide Seiten** des Befunds ab, der die
   frühere Annahme widerlegt hat: eine lokale Debitmarke **mit** Issuer-Labels am POS und
   dieselbe Marke **ohne** Labels im E-Commerce.
   Die 3DS-Tests laufen gegen `test/fixtures/reporting-tds-beispiel.csv` — acht Zeilen, jede
   für einen fachlich interessanten Fall, alle Erwartungswerte von Hand gerechnet. **Hier
   ist auch die Schreibweise erfunden, nicht gemessen**, und das ist der Unterschied zur
   Aggregat-Fixture: die 3DS-Query ist nie im Portal gelaufen (siehe „Offene Punkte"). Vor
   allem die beiden 3DS-Zeitstempel stammen aus einem `dateTimeContent`-Label, dessen Form
   niemand gesehen hat; der Parser reicht einen unpassenden Wert deshalb **durch** und zählt
   ihn zusätzlich als `unbrauchbareWerte`, statt ihn als leer auszugeben.
   **Einschränkung:** Der einfache Stub liefert für **jede** ID irgendein Element — eine
   verwaiste DOM-Referenz fällt so nicht auf. `test/dom-ids.test.js` gleicht deshalb die per
   `getElementById` angefragten IDs statisch gegen das Markup ab; nach UI-Änderungen bleibt
   der Test die Absicherung.
3. Generiertes SQL idealerweise einmal real laufen lassen — im Portal (*Account > Analytics >
   Submit Query*) oder im API-Modus über den Proxy.
4. Version im `<h1>`-Badge **sowie** in `APP_VERSION` (sowohl in
   `wallee_query_builder.html` als auch in `wallee-proxy.mjs` — beide Dateien tragen
   dieselbe Versionsnummer, siehe Kommentar über `APP_VERSION` im Proxy) nachführen; bei
   State-Bruch `STORAGE_KEY` erhöhen. Die `<p class="subtitle">` darunter trägt **keine**
   Versionsnummer, sondern die Aufzählung der Modi und Merkmale — sie ist mitzuführen, wenn
   ein Modus oder ein Merkmal dazukommt. Ebenso `README.md` (Kopfzeile „Aktuelle Version"
   und Modus-Tabelle). Der Proxy hat seine eigenen Tests
   (`test/proxy.test.js`); Änderungen an der API-Anbindung möglichst am gestubbten
   `fetch`/an der ausgehenden Anfrage prüfen, nicht erst live.

## Offene Punkte / Ideen

- **Autorisierter Betrag (v5.14/v5.14.1) — was noch aussteht:**
  - ~~Task 0 (Discovery) ist geschrieben, aber nicht gelaufen.~~ **Gelaufen am 2026-09-12**
    (Space 73192 statt des in der Spec genannten 40402), Befunde unter
    „Wallee-Referenzwissen"; die eine Abweichung (Trinkgeld bei `AUTHORIZED`) ist in v5.14.1
    als Guard eingebaut, O3 ist erledigt (keine Teil-Captures, Hinweis bleibt G2).
  - **A4 ist nicht am Druckbild geprüft:** die Tests belegen `fitToWidth="1"`,
    `fitToPage="1"` und die Breiten im XML; die Kalibrierung der Breiten stammt aus einem
    echten Export (Spalten waren mit „Länge + 2" sichtbar zu breit), der Ausdruck selbst in
    Excel/Numbers/LibreOffice wurde nicht angeschaut.
  - **Die Breiten-Kalibrierung ist ein Richtwert für Calibri.** Text × 0.88 stimmt für
    gemischten Fliesstext; eine Spalte aus lauter Grossbuchstaben (z. B. `TWINT`, `VISA`)
    kann knapp werden, bisher aber nur bei kurzen Werten unter der Untergrenze 6. Zeigt ein
    Export abgeschnittenen Text, `XLSX_TEXT_FAKTOR` anheben, nicht die Untergrenze.
  - **Kein Filter-/Variantenwahl für CSV und PDF** (SPEC §9, Folge-Iteration).
- Auszahlungsreferenz-Zuordnung über Withdrawals (`payoutref`-CTE) ist heuristisch
  (zeitbasiert) — beobachten, ob es einen direkten Verknüpfungspfad gibt. Betrifft seit v5.10
  **beide** Aufrufer: den Transaktions-Export und wieder den Settlement-Modus, wo die Referenz
  die Bankgutschriften trägt (siehe „Wallee-Referenzwissen"). Ein direkter Fremdschlüssel
  würde dort die letzte verbleibende Unschärfe des Reports beseitigen.
- **Offen aus SPEC 1.2 / GAP-ANALYSIS G3+G4** (`settlement-report-spec/`, nicht
  `dashboard/SPEC.md`)**:** Die Query filtert weiterhin auf
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
- **Reporting-Modus (v5.11) — Abnahme und Offenes** (die fachliche Abnahme nach SPEC §8 ist
  seit 2026-09-02 **abgeschlossen**, siehe die ersten Punkte; offen ist nur, was darunter
  ausdrücklich als offen steht):
  - **Der Referenzlauf hat am 2026-09-01 stattgefunden** — beide Referenz-Queries
    (`dashboard/sql/01_reporting_reference.sql` und die Terminal-Variante `01b`) liefen im
    Portal fehlerfrei über **beide Referenzspaces, Juli 2026**, also dieselben zwei Spaces
    und denselben Monat wie Task 0. **Belegt ist damit:** die typisierten
    `UNION ALL`-Platzhalter halten, alle elf Descriptors lösen auf (keine Kennzahl steht
    pauschal auf „Unbekannt"), der `tip`-Join trägt, und die Zahlen reproduzieren die
    Task-0-Werte — POS 12'537 Attempts bei 98.63 % Erfolg, E-Com 1'855 bei 91.32 %,
    3DS-Akzeptanz 281/310 = 90.6 %, DCC 2 Attempts, 14 POS-Ablehncodes `00`…`Z3`,
    Retry-Rate POS 1.001, 10 Terminals in der `01b`-Variante; die Herkunfts-Eimer
    summieren exakt auf die Kartenbasis. Der Parser meldete **0 unbrauchbare Werte und 0
    unbekannte Blöcke**. *Kleine Abweichung, damit „reproduziert" nicht mehr verspricht,
    als es hält:* Task 0 notierte als 3DS-Kartenbasis 424, der Lauf ergibt 422 (beides
    rundet auf 73 % Angefordert-Anteil); nach der `KARTEN_BRANDS`-Korrektur sind es 427.
    Wie überall in diesem Abschnitt: **ein Monat in zwei Spaces bei einem Acquirer** —
    „bisher beobachtet", nicht „gilt immer".
  - **Der Lauf hat auch etwas widerlegt** — dass Label-Abdeckung und `KARTEN_BRANDS`
    dasselbe seien. `PostFinance` steht seither in der Liste; Belege und Zahlen unter
    „Wallee-Referenzwissen". Das ist die einzige Code-Änderung, die aus dem Lauf folgte.
  - **Gemessene Lücke in `FAILURE_REASONS`:** der Lauf zeigt im E-Commerce **9** verschiedene
    `failure_reason_id`, die Tabelle trägt für den Kanal **5** — die übrigen **4** erscheinen
    als `#<id>`. Das ist kein Fehler (die Tabelle führt bewusst nur belegte Namen, und
    einen Failure-Reason-Dienst gibt es nicht, siehe oben), aber eine konkrete, nachtragbare
    Lücke: die Namen lassen sich einzeln über
    `GET /api/v2.0/payment/charge-attempts` an einem Attempt mit der jeweiligen ID ablesen.
    Am POS ist die Tabelle mit 2 von 2 IDs vollständig.
  - **SPEC 8.3 ist gegengerechnet — die fachliche Abnahme ist damit abgeschlossen**
    (2026-09-02, Nachweis `dashboard/discovery-results/ABNAHME.md`, gitignored). Der
    `brand`-Modus lief über **dieselben zwei Referenzspaces im Juli 2026** wie der
    Referenzlauf; verglichen wurde die Zahlungsmittel-Verteilung **nach Betrag** für die
    erfolgreichen Attempts. Ergebnis: **im E-Commerce stimmen beide Modi exakt überein**
    — 0.000 %, jede Marke auf den Rappen, gleiche Transaktionszahl —, **am POS weicht
    das Reporting um −1.102 % ab** (über beide Spaces zusammen −0.594 %); die Abweichungen
    je Marke sind klein und **beidseitig** (neben der einen ganz fehlenden Marke grösste
    relative 2.6 %, mehrere Marken exakt).
    **Die Kanal-Asymmetrie ist die eigentliche Aussage und zugleich der Beleg für die
    Ursache:** derselbe Code, dieselbe Arithmetik — nur der Kanal weicht ab, in dem
    Autorisierung und Verbuchung auseinanderfallen. Am POS schliesst eine spät am
    Monatsletzten autorisierte Transaktion wegen Trinkgeld-Anpassung und Tagesabschluss
    erst am Folgetag ab, wandert also über den Zeitraumrand; im E-Commerce fallen Versuch
    und Abschluss zusammen. Dazu kommen zwei kleinere Unterschiede: `brand` filtert
    zusätzlich auf `t.state IN ('FULFILL','COMPLETED')`, und die Marke stammt im
    Reporting aus `ca.connectorconfiguration` statt aus
    `t.paymentconnectorconfiguration_id` (SPEC 3.1) — Letzteres erklärt am ehesten die
    eine Marke, die im `brand`-Ergebnis in abweichender Schreibweise auftaucht und im
    Reporting gar nicht.
    **Praktische Folge, so dem Kunden zu sagen: der Reporting-Report ist kein Werkzeug
    zur Umsatz-Abstimmung.** Dafür nimmt der Händler `brand` oder `settlement`;
    `reporting` misst **Zahlungsversuche**, und seine Umsatzzahl ist „Umsatz der
    erfolgreichen Versuche im Versuchs-Fenster".
    **Was damit nicht behauptet ist:** die Beträge je Marke sind **nicht** transaktions-
    weise zurückverfolgt — festgestellt sind Richtung, Grössenordnung, Kanal-Asymmetrie
    und Mechanismus, nicht die Herkunft jedes einzelnen Frankens. Und wie überall in
    diesem Abschnitt: **ein Monat, zwei Spaces, ein Acquirer** — „bisher beobachtet",
    nicht „gilt immer"; ein anderes POS-Setup kann eine andere Randabweichung zeigen.
    8.1, 8.2, 8.4 und 8.6 sind durch den Referenzlauf gedeckt.
    **8.5 war keine offene Prüfung, sondern ein Widerspruch in der Spec:** sein Nenner
    („alle Karten-Attempts mit 3DS-Status ≠ `NOT_REQUESTED`") ist
    `AUTHENTICATED + FAILED_OR_ABANDONED + WALLET_CRYPTOGRAM` und ergibt am Lauf
    281/423 = 66.4 %, während SPEC 4.3 für dieselbe Kennzahl `AUTHENTICATED /
    (AUTHENTICATED + FAILED_OR_ABANDONED)` = 281/310 = 90.6 % verlangt — genau das, was
    der Code rechnet und was 4.3 selbst zitiert. Die dritte Grösse ist der
    Angefordert-Anteil. `dashboard/SPEC.md` §8.5 ist auf 4.3 korrigiert. Die
    Doppelzählungs-Hälfte von 8.5 ist erfüllt und geprüft: `klassifiziereTds` vergibt je
    Zeile genau einen Wert, die vier Eimer summieren restlos auf die Karten-Attempts.
    *(Der Absatz steht im Wortlaut von 2026-09-02 und nennt den zweiten Eimer deshalb
    noch `FAILED_OR_ABANDONED`; er heisst seit v5.12.1 `STARTED_NO_CAVV`, und der Nenner
    von 4.3 zieht dessen erfolgreiche Attempts ab — siehe „Herkunft, Kartentyp, 3DS" oben.
    **Nachgerechnet 2026-09-04** an `dashboard/discovery-results/reporting_ref.csv`
    (E-Com-Kartenbrands, Referenzlauf 2026-09-01): der Eimer zählt 29 Attempts, davon
    **29 `FAILED` und 0 `SUCCESSFUL`** — der neue Nenner zieht also nichts ab, und die
    Quote bleibt alt wie neu bei 281/310 = 90.6 %. Das gilt für diesen Referenzlauf, nicht
    allgemein: ein anderer Space kann in diesem Eimer autorisierte Attempts haben, dann
    weichen alte und neue Formel voneinander ab.)*
  - **Die Fixture ist an die echte Schreibweise angeglichen** (siehe
    „Entwicklungs-Workflow"): NULL steht jetzt als unquotiertes Leerfeld, die
    Zeilenreihenfolge folgt dem `ORDER BY` der Query. Sollte ein anderer Connector oder
    eine Schema-Änderung die Formate doch verschieben, meldet der Parser das selbst —
    steht in der Statuszeile „… Werte im unerwarteten Format", dann die Muster
    `REPORTING_MUSTER_BETRAG`/`REPORTING_MUSTER_ZAHL` bzw. `parseBool` nachziehen und die
    Fixture umstellen, nicht den Hinweis wegdrücken.
  - **Conversion und Retry-Rate auf Kanal-Ebene** bleiben eine Obergrenze; exakt würden sie
    erst mit einem vierten Query-Block ohne Brand-Gruppierung.
  - Aus SPEC 4.4 bewusst **nicht** in v5.11: Vorperioden-Vergleich, Billing-Land ≠
    Issuer-Land als Fraud-Signal (bräuchte `t.billingaddress` → PII-Abwägung), wiederkehrende
    Karten über PAR (`1739873828282`, 38 % Abdeckung — „Stammkunden-Anteil" am POS),
    Benchmark gegen den wallee-Durchschnitt (account-übergreifend, in einer Händler-Query
    nicht möglich).
  - Sollte wallee den **Failure-Reason-Dienst** je veröffentlichen, ersetzt er die statische
    `FAILURE_REASONS`-Tabelle (das Modell existiert in der API, nur der Dienst fehlt) —
    Nachfrage bei wallee wäre der Weg, erneutes Pfad-Raten nicht.
- **Reporting-Modus, Iteration 2 (v5.12/v5.12.1/v5.13) — was diese Versionen bewusst NICHT
  gebracht haben.**
  `dashboard/SPEC-ITERATION-2.md` beschreibt vier Vorhaben; umgesetzt sind **§1**
  (Ablehngründe im Klartext samt Proxy-Route), **§2** (Kuchendiagramme), in
  v5.12.1 die **Konsistenzprüfung aus §3.6** (der 3DS-Eimer heisst nach der Messung statt
  nach einem Ausgang, die trotzdem autorisierten Versuche sind sichtbar und aus dem
  Ablehn-Nenner) und in **v5.13 der §3 selbst**. Offen bleibt:
  - ~~**§3 — die Seite «3DS-Failures»** … steht noch aus.~~ **Gebaut in v5.13.0
    (2026-09-06)** — Beschreibung unter „Die Seite «3DS-Failures»" oben. Was die Seite
    beantwortet und was v5.12 nur benannte: *welche* Versuche gescheitert sind. Was sie
    **nicht** beantwortet und auch nicht mehr beantworten wird, solange kein Connector die
    Labels schreibt: die `tds_flow`-Achse aus §3.6 (Frictionless / Challenge /
    Abgebrochen), die Challenge-Status- und die ACS-Achse. Die Discovery hat gemessen,
    dass die dreizehn EMVCo-Labels im Analytics-Export nicht ankommen; an ihrer Stelle
    stehen die **Dauer-Eimer**, und der in §3.6 vorgesehene Drei-Sekunden-Rückfall ist
    bewusst nicht gebaut (er beschriftete eine Annahme als Messung — siehe „Die Seite
    «3DS-Failures»", Abschnitt zu den nicht gebauten Achsen).
  - **Der Portal-Referenzlauf der 3DS-Query steht noch aus.** Sie ist **nie gegen echte
    Daten gelaufen** — anders als die Aggregat-Query, die den Lauf vom 2026-09-01 hinter
    sich hat. Getestet ist sie ausschliesslich gegen eine **synthetische** Fixture
    (`test/fixtures/reporting-tds-beispiel.csv`, acht Zeilen von Hand gerechnet). Beim
    ersten echten Lauf gezielt auf drei Dinge schauen:
    (a) **`unbrauchbareWerte`** in der Statuszeile — steht dort eine Zahl, stimmt eine
    Format-Annahme des Parsers nicht;
    (b) **die Schreibweise der beiden 3DS-Zeitstempel** (`tds_started_on`,
    `tds_finished_on`): sie kommen aus einem `dateTimeContent`-Label, nicht aus Athena,
    und ihre genaue Form ist **nicht gemessen** — `REPORTING_TDS_MUSTER_ZEIT` ist
    absichtlich grosszügig, aber geraten. Passt sie nicht, ist die **Dauer-Achse leer**,
    also genau die Kernachse der Seite;
    (c) **die Laufzeit**: das `att`-CTE wird zweimal referenziert (die Fensterfunktionen
    und der äussere `SELECT`), und die Label-Extraktion läuft über **alle** Attempts des
    Zeitraums, auch die erfolgreichen — ein bewusster Kostenentscheid (die Alternative
    wäre ein zweiter Scan derselben Partitionen), aber einer, der noch nie gegen ein
    echtes Volumen gehalten wurde.
  - **Im Kopieren-Modus gibt es die 3DS-Query nicht.** `sqlOutput` trägt immer nur die
    Aggregat-Query; die zweite Abfrage setzt die App im API-Modus selbst ab, und der
    Import-Knopf lädt eine anderswo erzeugte Datei. Ein **eigenes SQL-Feld** für die
    zweite Query wäre der saubere Weg — es ist die grosse Variante und bewusst
    zurückgestellt, weil `sqlOutput.textContent` von Submit *und* Kopieren gelesen wird
    und ein zweites SQL darin den Submit bräche.
  - ~~**§4.3 — Discovery Q2 für den zweiten Händler-Space** … steht noch aus.~~
    **Erledigt am 2026-09-04** (Ergebnis unter „Charge-Attempt-Befunde am zweiten
    Händler-Space" oben, Rohdaten in `dashboard/discovery-results/`). Der Ausgang ist der
    zweite von zwei möglichen: **die EMVCo-Labels fehlen im Analytics-Export.** §3 baut seine
    Kernachse deshalb **nicht** aus Challenge-Status und ACS, sondern aus den Dauer-Eimern —
    das ist jetzt eine gemessene Einschränkung, keine offene Frage. Neu **hinzugekommen**
    sind dafür sechs Achsen, mit denen §3 vorher nicht rechnete (BIN als Issuer-Achse,
    3-D Secure Version, Attempt Retry, Liability Shift, Cryptogram Present, Processor Error
    Code) — deren Konstanten sind vor §3 anzulegen, denn zwei davon (BIN, Version) tragen
    einen **anderen Map-Key** als den Default.
  - **§4.4 — die Proxy-Route `GET /charge-attempts`** (Anreicherung je 20 Attempts über die
    echte API, mit PII-Filter im Proxy). Vor dem Bau ist die Filter-/`expand`-Syntax zu
    verifizieren; die Doku-Seite ist abgeschnitten. Als Batch-Werkzeug für den
    wallee-Support gedacht, nicht als Default für den Händler-Report (~200 Aufrufe für
    4'000 Attempts).
  - **§5.3 — der Block «Transaktionen ohne Zahlungsversuch» (CONV2).** `Processing not
    Initiated` und `Transaction Timed Out` sind Transaktions-, nicht Attempt-Signale: es gibt
    dafür gar keinen Charge Attempt, der Report **sieht diese Fälle also gar nicht** (das ist
    die direkte Folge des Grundsatzentscheids „Attempt-Basis", SPEC 2.1 — kein Versehen). Der
    Händler kann deshalb heute nicht unterscheiden, ob seine Abbrüche **beim** Bezahlen oder
    **vor** dem Bezahlen entstehen.
  - **§5.2 — der Block «Datenqualität für 3DS»** (Anteil Transaktionen mit Rechnungsadresse,
    E-Mail, Kunden-ID, Token je `userinterfacetype`) — die konkrete Antwort auf „sagt uns,
    welche Felder für eine höhere Frictionless-Quote fehlen". Er setzt §4.3 voraus und
    braucht ebenfalls einen **Portal-Schritt**; beide stehen noch aus.


## Kontext

- Sprache der UI und Doku: Deutsch (Schweiz — **ss statt ß**).
- Die Spalten in Modus 3 spiegeln die Anforderungen eines Pilotkunden aus der Gastronomie.
