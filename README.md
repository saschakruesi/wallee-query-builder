# Wallee Analytics Query Builder

Eigenständige HTML-Applikation, die SQL-Queries für **wallee Analytics**
(PrestoDB / Amazon Athena) generiert. Eine Datei, kein Build, keine Runtime-Dependencies
— Doppelklick genügt, läuft offline.

Zwei Betriebsmodi:

- **Kopieren-Modus** (Default, nichts zu installieren): SQL erzeugen und im wallee-Portal
  unter **Account > Analytics > Submit Query** ausführen; das Ergebnis kommt dort als CSV.
- **API-Modus** (opt-in): Query direkt aus der App absetzen und das Ergebnis automatisch in
  den Terminal-Report übernehmen — über einen kleinen lokalen Proxy (siehe unten).

## Nutzung

1. `wallee_query_builder_v2.html` herunterladen und im Browser öffnen.
2. Space-ID(s) und Zeitraum eintragen.
3. Modus wählen, SQL kopieren, im Portal ausführen — oder im API-Modus direkt absetzen.

Die Auswahl wird im `localStorage` des Browsers gespeichert — es verlässt
nichts das eigene Gerät. Zugangsdaten für den API-Modus liegen ausschliesslich beim Proxy,
nie im Browser.

## Modi

| Modus | Ergebnis |
|---|---|
| **Brand-Auswertung** | Aggregat pro Space × Brand × Währung, inkl. `tip_total` (Trinkgeld-Anteil) und `unsettled_anzahl` (wartet auf Abrechnung) |
| **Brand + Terminal-Filter** | zusätzlich pro Terminal, mit Pflichtfilter, ebenfalls inkl. `tip_total` und `unsettled_anzahl` |
| **Terminal-Report** | kein SQL: bündelt einen CSV-Export zu Outlet- und Brand-Gruppen und totalisiert (siehe unten) |
| **Transaktions-Export** | eine Zeile pro Transaktion, Spalten frei wählbar — u. a. `tip_amount` (Trinkgeld) und `gross_excl_tip` (Brutto ohne Trinkgeld) |
| **Kartensuche** | Transaktionen zu den letzten vier Kartenziffern (für Streitfälle) |
| **Settlement / Auszahlung** | pro Tag: was ist ausbezahlt, was steht aus, welche Gebühren fielen an, inkl. `tip_total` |

## Terminal-Report

Der Tab *Terminal-Report* wertet den CSV-Export aus *Brand + Terminal-Filter* aus, ohne
SQL zu erzeugen: Terminals werden zu **Outlet-Gruppen** (aus dem Terminalnamen, abschliessende
Nummer weg), Kartenmarken zu **Brand-Gruppen** (Lunch Check separat, alles übrige „Wallee")
zusammengefasst und totalisiert — Detail → Total Outlet-Gruppen → Total Brand-Gruppen →
Gesamttotal. Gruppennamen sind editierbar; gleiche Namen werden zusammengeführt.

- **Eingabe:** CSV per Drag & Drop oder Dateiauswahl. Im API-Modus wird das Ergebnis einer
  abgesetzten Query automatisch übernommen.
- **Export:** echtes `.xlsx` (Beträge als Zahlen mit Schweizer Zahlformat, vier Blätter),
  CSV (UTF-8 mit BOM, Semikolon) und PDF über die Druckfunktion.
- **Persistenz:** die Gruppen-Zuordnung liegt unter `wallee_terminal_report_cfg_v1`, per
  JSON exportier- und importierbar. Die Zahlen bleiben vollständig auf dem Gerät.

Der Zähler wird unter beiden Spaltennamen akzeptiert: `unsettled_anzahl` (aus dem
Terminal-Modus dieses Generators) und `unmatched_anzahl`.

## API-Modus und lokaler Proxy

Statt SQL zu kopieren, setzt der API-Modus die Query direkt ab und übergibt das Ergebnis dem
Report. Er läuft über `wallee-proxy.mjs` — ein einzelnes Node-Script ohne Dependencies:

```bash
node wallee-proxy.mjs
```

Ein Browser kann `app-wallee.com` nicht direkt aufrufen (CORS), und die API-Signatur
bräuchte das Secret im Browser. Der Proxy löst beides: er signiert lokal, und das
Payment-Secret verlässt den Rechner nie.

1. Proxy starten, dann `http://localhost:8787/setup` öffnen und **Application-User-ID**,
   **Authentication Key** (Base64) und **Account-ID** eintragen. Die Daten liegen nur lokal
   (`~/.wallee-proxy.json`, Dateirechte 600), nicht in der HTML-App.
2. In der App über das Zahnrad **„API-Zugriff verwenden"** einschalten. Die App prüft den
   Proxy per Health-Check; ist er nicht erreichbar, gibt es einen klaren Hinweis und den
   Rückfall auf den Kopieren-Modus — blockiert wird nie.
3. Query mit **„Query ausführen"** absetzen. Die App pollt den Status und übernimmt das
   Ergebnis-CSV automatisch in den Report. Alternativ lässt sich unter „Vorhandenen
   queryToken abrufen" das Ergebnis einer bereits im Portal gelaufenen Query holen.

Der Proxy bindet nur an `127.0.0.1`, lässt nur die eigene (per `file://` geöffnete) App als
Herkunft zu und verlangt einen eigenen Header — eine fremde Webseite kann ihn nicht
ansprechen. Details zum API-Ablauf in [CLAUDE.md](CLAUDE.md).

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
