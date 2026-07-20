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
| **Brand-Auswertung** | Aggregat pro Space × Brand × Währung |
| **Brand + Terminal-Filter** | zusätzlich pro Terminal, mit Pflichtfilter |
| **Transaktions-Export** | eine Zeile pro Transaktion, Spalten frei wählbar |
| **Kartensuche** | Transaktionen zu den letzten vier Kartenziffern (für Streitfälle) |
| **Settlement / Auszahlung** | pro Tag: was ist ausbezahlt, was steht aus, welche Gebühren fielen an |

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
  es gibt keinen direkten Fremdschlüssel von der Banktransaktion zur Auszahlung.
  Die entsprechende Spalte ist deshalb standardmässig aus.

## Entwicklung

Tests laufen ohne Browser und ohne Dependencies:

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
