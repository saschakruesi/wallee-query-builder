# Wallee Analytics Query Builder

Eigenständige HTML-Applikation (Single File, kein Build, kein Server), die SQL-Queries
für **wallee Analytics** (PrestoDB / Amazon Athena) generiert. Der Nutzer kopiert das
generierte SQL und führt es im wallee-Portal unter **Account > Analytics > Submit Query** aus.
Ergebnis kommt dort als CSV.

Entstanden aus einer Kundenanfrage im Gastronomie-Umfeld: Tagesabschluss-Abgleich pro
Terminal, Auszahlungs-Nachvollzug und Kartensuche bei Streitfällen.

## Dateien

| Datei | Zweck |
|---|---|
| `wallee_query_builder_v2.html` | **Aktuelle Version.** Fünf Modi, Multi-Space, Spaltenauswahl. Hier weiterentwickeln. |
| `wallee_query_builder.html` | v1 (nur Brand + Terminal-Modus, ein Space). Nur als Referenz behalten. |
| `sql/settlement_diagnose.sql` | Diagnose-Queries (einzeln ausführen!) um zu prüfen, ob/wie Settlement-Daten befüllt sind. |
| `sql/settlement_reference_reference.sql` | Referenz-Query: funktionierender Settlement-Join (valuedate + withdrawal-Referenz), Basis für das `settle`-CTE in v2. |
| `CLAUDE.md` | Diese Datei. |

## Architektur (v2)

Alles in einer HTML-Datei: CSS im `<head>`, Markup, ein `<script>`-Block am Ende.
Kein Framework, keine Dependencies, läuft offline per Doppelklick.

### State & Persistenz

- Ein zentrales `state`-Objekt, persistiert via `localStorage`.
- `STORAGE_KEY = 'wallee_query_builder_v5'` — **bei inkompatiblen State-Änderungen den Key
  hochzählen.** `STORAGE_KEY_OLD = 'wallee_query_builder_v4'` bleibt zusätzlich stehen: nur
  wenn unter `STORAGE_KEY` noch nichts liegt, liest `loadState()` von `STORAGE_KEY_OLD` und
  migriert (u. a. Kartensuche vom Export-Modus in den eigenen `card`-Tab, `payoutref`
  standardmässig deaktiviert). Das Ergebnis wird sofort unter `STORAGE_KEY` gesichert, der
  alte Schlüssel bleibt unangetastet stehen.
- `loadState()` migriert auch ältere Felder (z. B. Einzelfeld `spaceId` → `spaces[]`) und
  gleicht `exportColumns` gegen den Spaltenkatalog ab (neue Spalten bekommen ihren
  `def`-Wert).
- Gespeichert werden: Modus, Spaces, Zeitraum, Terminals, Spaltenauswahl, Kartensuche,
  Settlement-Aufschlüsselung nach Terminal, User-Presets (max. 12).

### Fünf Modi

1. **`brand`** – Aggregat pro Space × Brand × Währung (`GROUP BY`). Spalten: Anzahl,
   `unmatched_anzahl` (fee NULL/0 = wartet auf Fee-Update vom Acquirer), Brutto, Fees, Netto.
2. **`terminal`** – wie `brand`, zusätzlich Pflichtfilter + Gruppierung auf
   `paymentterminal.identifier` / `.name`.
3. **`export`** – **eine Zeile pro Transaktion**, Spalten frei wählbar (Checkbox-Katalog),
   Terminal-Filter optional.
4. **`card`** – Kartensuche: Transaktionen zu den letzten vier Kartenziffern
   (`buildCardQuery`), für Streitfälle. Eigener Tab statt Option im Export, seit die
   Kartensuche aus dem Transaktions-Export herausgelöst wurde.
5. **`settlement`** – Auszahlungs-Sicht pro Tag (`buildSettlementQuery`): was ist bereits
   ausbezahlt (`SETTLED`), was steht aus, was ist teilweise ausbezahlt (`PARTIAL`), welche
   Gebühren fielen an. Optional nach Terminal aufgeschlüsselt (`settlementByTerminal`).

Sichtbarkeit der Panels steuert `setMode()` über die CSS-Klasse `.cond-section.active`
(Terminal-Panel in Modus 2, 3, 4 und 5, Spalten-Panel nur Modus 3, Kartensuche-Panel nur
Modus 4, Settlement-Panel nur Modus 5).

### Spaltenkatalog (`EXPORT_COLUMNS`)

Das Herzstück von Modus 3. Jede Spalte ist ein Objekt:

```js
{ key, name, sql, alias, def, desc,
  needsConn?, needsTerm?, needsCard?, needsSettle?, needsPayoutRef?, sensitive? }
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
    bleibt; `settlement_state` wird `'PARTIAL'`, wenn sowohl `SETTLED`- als auch
    andere Records vorkommen — siehe Kommentare im CTE und `sql/settlement_reference_reference.sql`.
  - **`payoutref`**: Auszahlungsreferenz = `currentaccountwithdrawal.internalreference`,
    zeitlich zugeordnet (früheste Withdrawal im Fenster
    `[bt.valuedate, bt.valuedate + 30 Tage)`) — rein heuristische Zuordnung, da es keinen
    direkten Fremdschlüssel gibt. Langsam (zusätzlicher Range-Join), deshalb default aus.

## Wallee-Referenzwissen

- **Analytics-Schema:** <https://app-wallee.com/en-us/doc/api/analytics-schema>
  — Tabellen-/Spaltennamen im SQL **zwingend lowercase**.
- **Analytics-Doku/API:** <https://app-wallee.com/en-us/doc/analytics>
- **Label-Descriptors** (auf `chargeattempt.labels`, Typ array<map<string,string>>):
  - Masked Card Number: `1456765125779` (Konstante `DESC_MASKED_CARD`)
  - Authorization Code: `1579287795628` (Konstante `DESC_AUTH_CODE`) — leer bei TWINT
  - PAR: `1739873828282` · Expiry (yearMonthContent): `1456765711187`
  - Nachschlagen: `https://app-wallee.com/en-us/doc/api/label-descriptor/view/<ID>`
- **Sales-Channel-IDs:** Ecommerce `1582816223150`, Physical Terminal `1582819151330`.
- **Grenzen der Analytics** (nicht lösbar, dem Kunden so kommunizieren):
  - Keine IC++-Aufschlüsselung (DCC/Interchange/Scheme/Acquirer) — nur `totalappliedfees` gesamt.
  - Eine Query läuft in **einem** Account; Spaces fremder Accounts → Permission Error.
    Multi-Space geht nur innerhalb desselben Accounts.
- Queries laufen asynchron; jede Ergebnis-URL-Generierung wird als Download gezählt.

## Entwicklungs-Workflow

1. Änderungen direkt in `wallee_query_builder_v2.html`.
2. **Testen ohne Browser:**

   ```bash
   node --test "test/*.test.js"
   ```

   (die Form `node --test test/` funktioniert nicht — das Glob muss die Dateien treffen).
   `test/harness.js` extrahiert den einzigen `<script>`-Block aus der HTML-Datei, stubbt
   `document`/`localStorage` und lädt das Script per `vm.runInContext`. Es exportiert
   `buildBrandQuery/buildTerminalQuery/buildExportQuery/buildCardQuery/buildSettlementQuery/
   EXPORT_COLUMNS/defaultColumns/spaceInClause/txCte/cardCte/loadState/saveState/
   STORAGE_KEY/STORAGE_KEY_OLD` sowie eine `getState()`-Closure über `globalThis`.
   `test/queries.test.js` prüft die generierten SQL-Strings für alle Modi + Edge-Cases
   (0 Spaces, 0 Spalten, nur-Basis-Spalten ohne Joins, Kartensuche aktiv, alle Spalten) und
   die State-Migration `v4` → `v5`.
   **Einschränkung:** Der Stub liefert für **jede** ID über `document.getElementById`
   irgendein Element zurück (siehe `makeElement()` in `harness.js`) — eine verwaiste
   DOM-Referenz (falsche/gelöschte ID im Script) fällt den Tests deshalb **nicht** auf.
   Nach UI-Änderungen (neue/umbenannte Element-IDs) zusätzlich statisch gegenprüfen
   (`grep` auf `getElementById('...')` gegen die tatsächlich vorhandenen IDs im Markup).
3. Generiertes SQL idealerweise einmal real im eigenen Account laufen lassen
   (Portal: *Account > Analytics > Submit Query*).
4. Version im `<h1>`-Badge und Subtitle nachführen; bei State-Bruch `STORAGE_KEY` erhöhen.

## Offene Punkte / Ideen

- **Trinkgeld (TIP) aufnehmen.** Trinkgeld steckt in `lineitem` (Typ `TIP`) via
  `transaction_lineitem`, nicht auf `transaction`. Immer pro Transaktion voraggregieren
  (sonst Zeilenvervielfachung in den Aggregat-Modi).
- Settlement-Referenz-Zuordnung über Withdrawals ist heuristisch (zeitbasiert) —
  beobachten, ob es einen direkten Verknüpfungspfad gibt.
- Das 30-Tage-Fenster (maximale Auszahlungslatenz, siehe `payoutref`-CTE) ist eine Annahme
  — gegen echte Fälle validieren, inkl. mehrerer Settlements pro Transaktion bei
  unterschiedlichen Brands. Auf der Withdrawal-Seite des Joins fehlt dabei noch eine
  absolute Obergrenze — aktuell steht dort nur die korrelierte Bedingung
  (`w.createdon >= bt.valuedate AND w.createdon < bt.valuedate + INTERVAL '30' DAY`).
- Ein Live-Lauf gegen einen echten Account steht noch aus, um zu bestätigen: die
  Vorzeichen der Settlement-Gebühren (`settlement_fees` / `processing_fees`), die
  tatsächlich vorkommenden Werte von `banktransaction.state` und ob das 30-Tage-Fenster
  in der Praxis passt.
- `spacereference`-Join über `accountid` als Weg, alle Spaces eines Accounts automatisch
  zu erfassen — für einen späteren Ausbau des Space-Selektors.
- Refund-Berücksichtigung (`- SUM(t.refundedamount)`) als Option.
- Country-Breakdown.
- Status-Auswahl im Export (aktuell fix FULFILL/COMPLETED) z. B. für FAILED-Analysen.

## Kontext

- Sprache der UI und Doku: Deutsch (Schweiz — **ss statt ß**).
- Die Spalten in Modus 3 spiegeln die Anforderungen eines Pilotkunden aus der Gastronomie.
