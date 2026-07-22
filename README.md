# Wallee Analytics Query Builder

Eigenständige HTML-Applikation, die SQL-Queries für **wallee Analytics**
(PrestoDB / Amazon Athena) generiert. Eine Datei, kein Build, keine Runtime-Dependencies
— Doppelklick genügt, läuft offline.

Zwei Betriebsmodi:

- **Kopieren-Modus** (Default, nichts zu installieren): SQL erzeugen und im wallee-Portal
  unter **Account > Analytics > Submit Query** ausführen; das Ergebnis kommt dort als CSV.
- **API-Modus** (opt-in): Query direkt aus der App absetzen — über einen kleinen lokalen
  Proxy (siehe unten). Das Ergebnis landet im modus-eigenen **Abfrage-Verlauf** (CSV/Excel
  per Klick abrufbar) und, im Modus Terminal-Report, zusätzlich sofort in der
  Gruppen-Auswertung.

## Nutzung — drei Wege

Je nach technischem Komfort:

### 1. Ohne alles: Kopieren-Modus

Nichts zu installieren. `wallee_query_builder.html` per **Doppelklick** im Browser öffnen,
Space-ID(s) und Zeitraum eintragen, Modus wählen, **SQL kopieren** und im wallee-Portal unter
*Account > Analytics > Submit Query* ausführen — das Ergebnis kommt dort als CSV. (Kein
Ergebnis-Download in der App und kein Verlauf, dafür wirklich null Setup.)

### 2. One-Click: Query direkt aus der App (API-Modus)

Query direkt absetzen, Ergebnis als **CSV/Excel** herunterladen, mit **Abfrage-Verlauf**.
Dafür läuft im Hintergrund ein kleiner lokaler Server — gestartet per **Doppelklick**, kein
Terminal-Befehl nötig. Einmalige Voraussetzung: **Node.js**.

**Schritt 1 — Node.js installieren (nur beim ersten Mal):**

- **Windows:** auf <https://nodejs.org> die **LTS**-Version laden, Installer ausführen
  (Weiter → Weiter → Fertig, keine besonderen Einstellungen).
- **macOS:** auf <https://nodejs.org> die **LTS**-Version (`.pkg`) laden und installieren.
  (Wer Homebrew nutzt: `brew install node`.)

**Schritt 2 — Starten (Doppelklick):**

- **Windows:** Doppelklick auf **`Start-Windows.bat`**.
  Beim allerersten Mal ggf. *„Der Computer wurde durch Windows geschützt"* → **„Weitere
  Informationen" → „Trotzdem ausführen"**.
- **macOS:** Doppelklick auf **`Start-macOS.command`**.
  Beim allerersten Mal blockt macOS die Datei evtl. → **Rechtsklick → „Öffnen" → nochmals
  „Öffnen"** (danach reicht der Doppelklick).

Der Browser öffnet sich automatisch mit dem Query Builder. Oben rechts im **Zahnrad** einmalig
die Zugangsdaten eintragen (siehe [API-Modus](#api-modus-und-lokaler-proxy)). Das
Starter-Fenster offen lassen, solange gearbeitet wird; schliessen beendet den Server.
Ausführliche Schritt-für-Schritt-Anleitung für Endnutzer: [PAKET-ANLEITUNG.md](PAKET-ANLEITUNG.md).

### 3. Fortgeschritten: Proxy von Hand starten

Wer sich auskennt, startet den Server direkt:

```bash
node wallee-proxy.mjs                 # Server auf http://127.0.0.1:8787
WALLEE_OPEN=1 node wallee-proxy.mjs   # … und öffnet zusätzlich den Browser
```

Danach `http://127.0.0.1:8787` im Browser öffnen — der Server **liefert die App selbst aus**
(same-origin, kein CORS) — oder alternativ `wallee_query_builder.html` per `file://` öffnen und
im Zahnrad die Proxy-Adresse eintragen. `WALLEE_PROXY_PORT` ändert den Port.

---

Die Auswahl wird im `localStorage` des Browsers gespeichert — es verlässt nichts das eigene
Gerät. Zugangsdaten für den API-Modus liegen ausschliesslich beim Proxy, nie im Browser.

## Modi

| Modus | Ergebnis |
|---|---|
| **Brand-Auswertung** | Aggregat pro Space × Brand × Währung, inkl. `tip_total` (Trinkgeld-Anteil) und `unsettled_anzahl` (wartet auf Abrechnung) |
| **Terminal-Report** | wie Brand-Auswertung, zusätzlich pro Terminal mit Pflichtfilter — im API-Modus wird das Ergebnis der eigenen Query automatisch zu Outlet- und Brand-Gruppen ausgewertet (siehe unten) |
| **Transaktions-Export** | eine Zeile pro Transaktion, Spalten frei wählbar — u. a. `tip_amount` (Trinkgeld) und `gross_excl_tip` (Brutto ohne Trinkgeld) |
| **Kartensuche** | Transaktionen zu den letzten vier Kartenziffern (für Streitfälle) |
| **Settlement / Auszahlung** | pro Tag: was ist ausbezahlt, was steht aus, welche Gebühren fielen an, inkl. `tip_total` |

## Abfrage-Verlauf

Jeder erfolgreiche Submit im API-Modus landet im **Abfrage-Verlauf** — pro Modus gefiltert,
maximal 50 Einträge. Gespeichert werden nur Token und Anzeige-Metadaten (Spaces, Zeitraum,
Filter, Zeitstempel), **nie** die SQL und **nie** das Ergebnis selbst; das wird bei Bedarf
über den Token neu vom Proxy geholt. Aus der Tabelle heraus lässt sich pro Zeile das rohe
CSV oder eine Excel-Datei herunterladen; im Modus Terminal-Report gibt es zusätzlich „Als
Report öffnen", das dieselbe Antwort direkt in die Gruppen-Auswertung schickt. Jeder erneute
Abruf über den Token zählt bei wallee als Download.

## Terminal-Report

Der Modus *Terminal-Report* wertet das Ergebnis der eigenen Query zu **Outlet-Gruppen**
(aus dem Terminalnamen, abschliessende Nummer weg) und **Brand-Gruppen** (Lunch Check
separat, alles übrige „Wallee") aus und totalisiert — Detail → Total Outlet-Gruppen → Total
Brand-Gruppen → Gesamttotal. Gruppennamen sind editierbar; gleiche Namen werden
zusammengeführt.

- **Eingabe:** ausschliesslich über den API-Modus — nach dem Submit einer Terminal-Report-
  Query oder per „Als Report öffnen" aus dem Abfrage-Verlauf. Der verbliebene Datei-Input im
  Report-Panel dient nur noch dem Import/Export der Gruppen-Konfiguration als JSON, nicht
  mehr dem Laden der Report-Rohdaten.
- **Export:** echtes `.xlsx` (Beträge als Zahlen mit Schweizer Zahlformat, vier Blätter),
  CSV (UTF-8 mit BOM, Semikolon) und PDF über die Druckfunktion.
- **Persistenz:** die Gruppen-Zuordnung liegt unter `wallee_terminal_report_cfg_v1`, per
  JSON exportier- und importierbar. Die Zahlen bleiben vollständig auf dem Gerät.

Der Zähler wird unter beiden Spaltennamen akzeptiert: `unsettled_anzahl` (aus dem
Terminal-Report dieses Generators) und `unmatched_anzahl`.

## API-Modus und lokaler Proxy

Statt SQL zu kopieren, setzt der API-Modus die Query direkt ab. Er läuft über
`wallee-proxy.mjs` — ein einzelnes Node-Script ohne Dependencies. Am einfachsten per
**Doppelklick-Starter** (`Start-macOS.command` / `Start-Windows.bat`, siehe [Nutzung](#nutzung--drei-wege));
von Hand:

```bash
node wallee-proxy.mjs
```

Ein Browser kann `app-wallee.com` nicht direkt aufrufen (CORS), und die API-Signatur
bräuchte das Secret im Browser. Der Proxy löst beides: er signiert lokal, und das
Payment-Secret verlässt den Rechner nie.

1. Proxy starten, dann in der App über das Zahnrad **„API-Zugriff verwenden"** einschalten
   und im Einstellungs-Dialog **Application-User-ID**, **Authentication Key** (Base64) und
   **Account-ID** eintragen — Speichern legt sie direkt am Proxy ab
   (`~/.wallee-proxy.json`, Dateirechte 600), nicht in der HTML-App; das Secret-Feld zeigt
   beim erneuten Öffnen nie den Klartext, nur ob eines hinterlegt ist. Die eigenständige
   `/setup`-Seite am Proxy bleibt als Fallback bestehen, falls die App einmal nicht
   erreichbar ist.
2. Die App prüft den Proxy per Health-Check (schon beim Laden der Seite, falls der
   API-Modus bereits aktiv ist, sowie vor jedem Submit); ist er nicht erreichbar, gibt es
   einen klaren Hinweis und den Rückfall auf den Kopieren-Modus — blockiert wird nie. Ein
   Status-Punkt im Einstellungs-Dialog zeigt den zuletzt bekannten Proxy-Zustand.
3. Query mit **„Query ausführen"** absetzen. Die App pollt den Status und schreibt bei
   Erfolg einen Eintrag in den Abfrage-Verlauf; im Modus Terminal-Report wird das
   Ergebnis-CSV zusätzlich sofort in die Gruppen-Auswertung übernommen. Alternativ lässt
   sich unter „Vorhandenen queryToken abrufen" das Ergebnis einer bereits im Portal
   gelaufenen Query holen.

Der Proxy bindet nur an `127.0.0.1`, lässt als Herkunft nur die eigene App zu (per `file://`
geöffnet **oder** same-origin vom Proxy unter `http://127.0.0.1:8787` ausgeliefert) und
verlangt einen eigenen Header — eine fremde Webseite kann ihn nicht ansprechen. Details zum
API-Ablauf in [CLAUDE.md](CLAUDE.md).

`unsettled_anzahl` zählt Transaktionen ohne Gebühr (`totalappliedfees` NULL/0) **und** ohne
bestehenden Settlement-Record — also solche, die noch auf die Abrechnung warten. An
Produktivdaten geprüft: Gebühr und Settlement-Record treffen dort im Gleichschritt ein, es
gab keine Transaktion mit nur einem der beiden. Der Zähler entspricht damit genau der Menge
ohne Settlement-Record. Die Und-Verknüpfung bleibt trotzdem bestehen — laufen die beiden
Signale in einem anderen Space auseinander, zählt sie konservativ.

## Trinkgeld

wallee führt Trinkgeld nicht als Feld auf der Transaktion, sondern als eigenes Line Item
vom Typ `TIP` (Pfad `transaction_lineitem` → `lineitem`). **Das Trinkgeld ist bereits im
Bruttobetrag enthalten und darf nicht zusätzlich addiert werden.** Umsatz ohne Trinkgeld
ergibt sich also aus `brutto_gross − tip_total` (im Export: `gross_amount − tip_amount`,
bzw. direkt als Spalte `gross_excl_tip`).

Das ist an echten Daten geprüft und bestätigt — mit `sql/tip_verifikation.sql` lässt
sich das bei Bedarf (anderer Space, Schema-Änderung) erneut nachprüfen.

## Settlement-Status

`settlement_state` zeigt, ob eine Transaktion bereits ausbezahlt ist: **SETTLED** =
ausbezahlt, **NO_RECORD** = für diese Transaktion existiert noch gar kein
Settlement-Record. Nach einer Prüfung an Produktivdaten ist **NO_RECORD** bisher der
beobachtete Normalfall für eine Transaktion, die noch auf ihre Auszahlung wartet — ein
Settlement-Record scheint erst zu entstehen, wenn tatsächlich abgerechnet wurde.
**UPCOMING** (noch ausstehend) und **PARTIAL** (teilweise ausbezahlt, z. B. bei einem
Refund aus einem späteren Settlement-Lauf) bleiben im Generator als mögliche Werte
vorgesehen, falls sich ein anderer Space oder Acquirer anders verhält, wurden bislang
aber nicht beobachtet.

Die Gebühren auf Settlement-Ebene (`postingamount − valueamount`) sind an Produktivdaten
mit durchgehend positivem Vorzeichen bestätigt. Ebenfalls geprüft: keine Transaktion hatte
in der Stichprobe mehr als einen Settlement-Record — die Vor-Aggregation im Generator
bleibt trotzdem als Absicherung bestehen, `anzahl_settlement_records` als Frühwarnung.

Diese Ergebnisse stammen aus einem Space über einen Zeitraum — „bisher beobachtet", nicht
„gibt es nicht". Mit `sql/settlement_verifikation.sql` lässt sich das bei Bedarf (anderer
Space, anderer Acquirer, Schema-Änderung) erneut nachprüfen.

## Hinweis zu Apple Pay, Google Pay und tokenisierten Karten

Die letzten vier Ziffern im Wallet sind **nicht** die der physischen Karte —
das Gerät nutzt eine eigene Gerätekontonummer. Der Tab *Kartensuche* erklärt,
wo der Karteninhaber die richtigen Ziffern findet. Bei TWINT gibt es weder
Kartennummer noch Autorisierungscode.

## Grenzen der wallee Analytics

- Keine IC++-Aufschlüsselung (DCC, Interchange, Scheme, Acquirer) —
  nur `totalappliedfees` als Gesamtwert bzw. die Settlement-Gebühren
  aus der Banktransaktion.
- Eine Query läuft in **einem** Account. Mehrere Spaces gehen nur innerhalb
  desselben Accounts; Spaces fremder Accounts erzeugen einen Permission Error.
- Die Zuordnung der Auszahlungsreferenz ist zeitbasiert-heuristisch —
  es gibt keinen direkten Fremdschlüssel von der Banktransaktion zur Auszahlung. Die
  zugrunde liegende Tabelle (`currentaccountwithdrawal`) enthält ohne Einschränkung die
  Auszahlungen der gesamten Plattform, nicht nur die des eigenen Accounts; der Generator
  schränkt sie deshalb zwingend über `spacereference.accountid` ein. Die Spalte ist trotz
  dieser Korrektur weiterhin die teuerste im Export und standardmässig aus.
- Dass Trinkgeld bereits im Bruttobetrag enthalten ist (siehe Abschnitt „Trinkgeld"),
  ist an echten Daten geprüft und bestätigt — es darf trotzdem nicht zusätzlich zum
  Bruttobetrag addiert werden, sonst wird der Umsatz doppelt gezählt.

## Entwicklung

Tests laufen ohne Browser und ohne Dependencies:

```bash
node --test "test/*.test.js"
```

Das Harness (`test/harness.js`) extrahiert den App-Logik-Block aus der HTML-Datei, stubbt
DOM und `localStorage` und prüft die reinen Funktionen. Abgedeckt sind die SQL-Builder
(`test/queries.test.js`), der Report-Kern und sein Render-/Export-Pfad
(`test/report*.test.js`), die Betriebsmodi und die API-Anbindung
(`test/betriebsmodus.test.js`, `test/api-anbindung.test.js`) sowie der Proxy
(`test/proxy.test.js`, u. a. die JWT-Signatur gegen den RFC-7515-Testvektor und die
ausgehende Anfrage an wallee). Der XLSX-Export wird end-to-end geprüft
(`test/report-xlsx.test.js`): Datei schreiben, wieder einlesen, Zahlen gegen die Sollwerte.

## Referenzen

- [Analytics-Schema](https://app-wallee.com/en-us/doc/api/analytics-schema) —
  Tabellen- und Spaltennamen im SQL zwingend lowercase
- [Analytics-Dokumentation](https://app-wallee.com/en-us/doc/analytics)
- [REST-API / Web Service](https://app-wallee.com/doc/api/web-service) — Analytics-Endpunkte
  für den API-Modus
- [API-Client / SDKs](https://github.com/wallee-payment) — Auth-Schema (JWT-Bearer) des Proxys

## Lizenz

MIT — siehe [LICENSE](LICENSE).
