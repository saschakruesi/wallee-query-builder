# Wallee Analytics Query Builder

**Aktuelle Version: v5.8.0**

Eigenständige HTML-Applikation, die SQL-Queries für **wallee Analytics**
(PrestoDB / Amazon Athena) generiert. Eine Datei, kein Build, keine Runtime-Dependencies
— Doppelklick genügt, läuft offline.

Zwei Betriebsmodi:

- **Kopieren-Modus** (Default, nichts zu installieren): SQL erzeugen und im wallee-Portal
  unter **Account > Analytics > Submit Query** ausführen; das Ergebnis kommt dort als CSV.
- **API-Modus** (opt-in): Query direkt aus der App absetzen — über einen kleinen lokalen
  Proxy (siehe unten). Das Ergebnis landet im modus-eigenen **Abfrage-Verlauf** (CSV/Excel
  per Klick abrufbar) und, in den Modi Terminal-Report und Settlement-Report, zusätzlich
  sofort als aufbereiteter Report (Gruppen-Auswertung bzw. Settlement-Übersicht).

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
| **Settlement-Report** | **account-basiert** (nicht space-basiert): was ist bereits ausbezahlt, was steht noch aus, was ist ganz ohne Settlement-Record — im API-Modus wird das Ergebnis der eigenen Query automatisch zum Settlement-Report (siehe unten) |

## Abfrage-Verlauf

Jeder erfolgreiche Submit im API-Modus landet im **Abfrage-Verlauf** — pro Modus gefiltert,
maximal 50 Einträge. Gespeichert werden nur Token und Anzeige-Metadaten (Spaces, Zeitraum,
Filter, Zeitstempel), **nie** die SQL und **nie** das Ergebnis selbst; das wird bei Bedarf
über den Token neu vom Proxy geholt. Aus der Tabelle heraus lässt sich pro Zeile das rohe
CSV oder eine Excel-Datei herunterladen. In den Modi Terminal-Report und Settlement-Report
bietet die Verlaufszeile bewusst nur den Roh-CSV-Download — Excel (mit gebrandetem Titel),
PDF und die Report-Ansicht laufen dort über das jeweilige Report-Panel selbst. Jeder erneute
Abruf über den Token zählt bei wallee als Download.

## Terminal-Report

Der Modus *Terminal-Report* wertet das Ergebnis der eigenen Query zu **Outlet-Gruppen**
(aus dem Terminalnamen, abschliessende Nummer weg) und **Brand-Gruppen** (Lunch Check
separat, alles übrige „Wallee") aus und totalisiert — Detail → Total Outlet-Gruppen → Total
Brand-Gruppen → Gesamttotal. Gruppennamen sind editierbar; gleiche Namen werden
zusammengeführt.

- **Eingabe:** ausschliesslich über den API-Modus — nach dem Submit einer Terminal-Report-
  Query wird das Ergebnis automatisch in die Gruppen-Auswertung übernommen. Der verbliebene
  Datei-Input im Report-Panel dient nur noch dem Import/Export der Gruppen-Konfiguration als
  JSON, nicht mehr dem Laden der Report-Rohdaten.
- **Export:** echtes `.xlsx` — alle Abschnitte (Detail, Outlet-/Brand-Totale, Gesamttotal)
  in **einem Blatt** untereinander gestapelt wie der PDF-Report, Beträge als Zahlen mit
  Schweizer Zahlformat, gebrandeter Titel und türkiser Kopf,
  CSV (UTF-8 mit BOM, Semikolon) und PDF über die Druckfunktion.
- **Persistenz:** die Gruppen-Zuordnung liegt unter `wallee_terminal_report_cfg_v1`, per
  JSON exportier- und importierbar. Die Zahlen bleiben vollständig auf dem Gerät.

Der Zähler wird unter beiden Spaltennamen akzeptiert: `unsettled_anzahl` (aus dem
Terminal-Report dieses Generators) und `unmatched_anzahl`.

## Settlement-Report

Der Modus *Settlement-Report* ist **account-**, nicht space-basiert: eine Auszahlung fasst
die Transaktionen aller Spaces eines Accounts zu einer Gutschrift zusammen. Gefiltert wird
nach Transaktionsdatum, gruppiert nach dem Valutadatum der Gutschrift — deshalb reichen die
Settlements am Ende des Berichtszeitraums typischerweise ein paar Tage darüber hinaus und
erscheinen als **Ausstehend**. Transaktionen ganz ohne Settlement-Record stehen als **Offen**
am Ende. Zusätzlich zeigt der Report eine Aufschlüsselung nach Zahlungsmittel.

- **Konto:** vorbelegt aus den hinterlegten Zugangsdaten und gesperrt; mit dem Flip
  „Anderen Account abfragen (Super-User)" lässt sich ein abweichender Account eintragen —
  funktioniert nur, wenn der hinterlegte API-Benutzer auch dort Zugriff hat.
- **Vier Ausgaben aus einer Quelle:** Bildschirm, CSV, Excel und PDF, wie beim
  Terminal-Report gebrandet und aus denselben Export-Blöcken gespeist. Eine Checkbox
  „Transaktionsdetail einschliessen" blendet die Detailliste bei grossen Zeiträumen aus —
  Zusammenfassung und Übersicht bleiben davon unberührt.
- **Wichtig für die Zahlen:** Brutto, Fees und Netto stammen in jeder Settlement-Zeile
  durchgängig aus der Banktransaktion (nicht aus der Transaktion selbst), damit
  `Brutto − Fees = Netto` in jeder Zeile und jeder Summe exakt aufgeht. Nur die Zeile
  *Offen* zeigt stattdessen den Transaktionsbetrag als Brutto, weil dort mangels
  Settlement-Record keine Banktransaktion existiert. Zahlen aus diesem Report können daher
  von älteren, handgemachten Auswertungen abweichen, die Transaktions- und
  Banktransaktions-Beträge gemischt haben.
- **Eingabe:** ausschliesslich über den API-Modus, wie beim Terminal-Report — kein
  CSV-Upload für die Report-Daten selbst.

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

### Schritt 1 — API-User in wallee anlegen (einmalig)

Für den API-Modus braucht es in wallee einen **Application User** — den technischen Benutzer,
mit dem die App die Queries signiert. Daraus stammen drei Werte, die später in den Dialog
kommen:

| Wert | woher | Feld im Dialog |
|---|---|---|
| **Application User ID** | beim Anlegen angezeigt (Zahl) | Application User ID |
| **Authentication Key** (Base64-Secret) | beim Anlegen **einmalig** angezeigt | Secret (HMAC-Key) |
| **Account** | Nummer deines Accounts (Account-Übersicht bzw. Portal-URL) | Account |

Im wallee-Portal (<https://app-wallee.com>):

1. **Account → Users → Application Users → neuen anlegen.** Nach dem Anlegen zeigt wallee die
   **User ID** und den **Authentication Key** (Base64). ⚠️ **Den Authentication Key gibt es
   nur dieses eine Mal zu sehen** — sofort kopieren. Ist der Dialog zu, muss ein neuer Key
   erzeugt werden.
2. **Rolle mit Analytics-Zugriff zuweisen.** Berechtigungen laufen über **Rollen**
   (*Account → Users → Roles*), die kontextbezogen für einen Space bzw. Account gelten. Der
   Application User braucht eine Rolle, die **Analytics** für die betroffenen **Space(s)**
   freigibt — sonst läuft die Query in einen Permission Error. Rollen richtet der
   **Account-Admin** ein.
3. **Account-Nummer notieren.** Eine Query läuft in **einem** Account; alle abgefragten Spaces
   (max. 5) müssen zu diesem Account gehören. Die Account-Nummer steht in der Account-Übersicht
   bzw. in der Portal-URL — sie kommt ins Feld **Account**.

Details in der wallee-Doku: [Application User](https://app-wallee.com/en/doc/api/model/application-user)
· [Permission Concept](https://app-wallee.com/en/doc/permission-concept)
· [Web Service API](https://app-wallee.com/en/doc/api/web-service). Die Signatur ist ein
JWT-Bearer-Token (HS256), das der Proxy lokal aus User-ID + Authentication Key erzeugt.

### Schritt 2 — Verbinden und Query absetzen

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
   Ergebnis-CSV zusätzlich sofort in die Gruppen-Auswertung übernommen, im Modus
   Settlement-Report entsprechend in den Settlement-Report. Alternativ lässt sich unter
   „Vorhandenen queryToken abrufen" das Ergebnis einer bereits im Portal gelaufenen Query
   holen.

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

Im **Settlement-Report** (siehe oben) wird daraus pro Zeile einer von drei Status: *Settled*
(Valutadatum liegt im Berichtszeitraum), *Ausstehend* (Valutadatum liegt danach) oder *Offen*
(`NO_RECORD`, also gar kein Settlement-Record vorhanden).

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
- Die Zuordnung der Auszahlungsreferenz im **Transaktions-Export** ist zeitbasiert-heuristisch
  — es gibt keinen direkten Fremdschlüssel von der Banktransaktion zur Auszahlung. Die
  zugrunde liegende Tabelle (`currentaccountwithdrawal`) enthält ohne Einschränkung die
  Auszahlungen der gesamten Plattform, nicht nur die des eigenen Accounts; der Generator
  schränkt sie deshalb zwingend über `spacereference.accountid` ein. Die Spalte ist trotz
  dieser Korrektur weiterhin die teuerste im Export und standardmässig aus. Der
  Settlement-Report braucht diese Referenz nicht — er ist ohnehin bereits auf einen
  einzelnen Account eingeschränkt.
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
(`test/queries.test.js`), der Terminal-Report-Kern und sein Render-/Export-Pfad
(`test/report*.test.js`), der Settlement-Report-Kern und sein Render-/Export-Pfad
(`test/settlement-report.test.js`, `test/settlement-export.test.js`,
`test/settlement-render.test.js`), die Betriebsmodi und die API-Anbindung
(`test/betriebsmodus.test.js`, `test/api-anbindung.test.js`) sowie der Proxy
(`test/proxy.test.js`, u. a. die JWT-Signatur gegen den RFC-7515-Testvektor, die
ausgehende Anfrage an wallee und die Account-Header-Logik). Der XLSX-Export wird
end-to-end geprüft (`test/report-xlsx.test.js`): Datei schreiben, wieder einlesen, Zahlen
gegen die Sollwerte.

## Referenzen

- [Analytics-Schema](https://app-wallee.com/en-us/doc/api/analytics-schema) —
  Tabellen- und Spaltennamen im SQL zwingend lowercase
- [Analytics-Dokumentation](https://app-wallee.com/en-us/doc/analytics)
- [REST-API / Web Service](https://app-wallee.com/doc/api/web-service) — Analytics-Endpunkte
  für den API-Modus
- [API-Client / SDKs](https://github.com/wallee-payment) — Auth-Schema (JWT-Bearer) des Proxys

## Lizenz

MIT — siehe [LICENSE](LICENSE).
