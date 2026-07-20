# Wallee Analytics Query Builder

Eigenständige HTML-Applikation, die SQL-Queries für **wallee Analytics**
(PrestoDB / Amazon Athena) generiert. Eine Datei, kein Build, kein Server,
keine Dependencies — Doppelklick genügt, läuft offline.

Das generierte SQL wird im wallee-Portal unter
**Account > Analytics > Submit Query** ausgeführt; das Ergebnis kommt dort als CSV.

## Nutzung

1. `wallee_query_builder_v2.html` herunterladen und im Browser öffnen.
2. Space-ID(s) und Zeitraum eintragen.
3. Modus wählen, SQL kopieren, im Portal ausführen.

Die Auswahl wird im `localStorage` des Browsers gespeichert — es verlässt
nichts das eigene Gerät.

## Modi

| Modus | Ergebnis |
|---|---|
| **Brand-Auswertung** | Aggregat pro Space × Brand × Währung, inkl. `tip_total` (Trinkgeld-Anteil) und `unsettled_anzahl` (wartet auf Abrechnung) |
| **Brand + Terminal-Filter** | zusätzlich pro Terminal, mit Pflichtfilter, ebenfalls inkl. `tip_total` und `unsettled_anzahl` |
| **Transaktions-Export** | eine Zeile pro Transaktion, Spalten frei wählbar — u. a. `tip_amount` (Trinkgeld) und `gross_excl_tip` (Brutto ohne Trinkgeld) |
| **Kartensuche** | Transaktionen zu den letzten vier Kartenziffern (für Streitfälle) |
| **Settlement / Auszahlung** | pro Tag: was ist ausbezahlt, was steht aus, welche Gebühren fielen an, inkl. `tip_total` |

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

Tests laufen ohne Browser und ohne Dependencies (66 Tests in
`test/queries.test.js` und `test/tip_unsettled.test.js`):

```bash
node --test "test/*.test.js"
```

Das Harness extrahiert den `<script>`-Block aus der HTML-Datei, stubbt DOM und
`localStorage` und prüft die generierten SQL-Strings.

## Referenzen

- [Analytics-Schema](https://app-wallee.com/en-us/doc/api/analytics-schema) —
  Tabellen- und Spaltennamen im SQL zwingend lowercase
- [Analytics-Dokumentation](https://app-wallee.com/en-us/doc/analytics)

## Lizenz

MIT — siehe [LICENSE](LICENSE).
