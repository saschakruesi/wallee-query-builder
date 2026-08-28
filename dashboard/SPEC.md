# Reporting-Modus (Händler-KPIs) — Design-Spezifikation

Datum: 2026-08-28 · Zielversion: v5.11.0 · Status: **Task 0 abgeschlossen** — POS (Space 40402) und E-Com (Space 12622), Juli 2026, siehe `dashboard/discovery-results/DESCRIPTORS.md`

## 1. Ziel

Ein sechster Modus **«Reporting»** im wallee Analytics Query Builder, der einem Händler
die Kennzahlen liefert, die ihn an seiner Zahlungsabwicklung wirklich interessieren —
getrennt nach **POS** (Physical Terminal) und **E-Commerce** — und sie wie Terminal- und
Settlement-Report als gebrandeten Report (Bildschirm, XLSX, PDF, CSV) ausgibt.

Erfolgskriterium: Ein Händler wählt Spaces, Zeitraum und Kanal, klickt *Query absetzen*
und sieht ohne weitere Handarbeit Success Rate, Zahlungsmittel-Mix, Karten-Herkunft,
Business/Privat-Anteil, Durchschnittsbeträge und (E-Com) 3DS-Akzeptanz sowie die
wichtigsten Ablehngründe.

## 2. Grundsatzentscheide

1. **Basis ist der Charge Attempt, nie die Transaktion.** Im E-Commerce entsteht eine
   Transaktion bereits beim Befüllen des Warenkorbs; eine Erfolgsquote auf Transaktionen
   wäre systematisch falsch. Der Entscheid gilt bewusst **für beide Kanäle**, damit POS
   und E-Com dieselbe Definition haben und die Query nur einmal existiert.
2. **Zeitfilter auf `chargeattempt.createdon`**, nicht auf `t.completedon` wie in den
   übrigen Modi — gescheiterte Attempts haben kein `completedon`. Im UI wird das
   ausgewiesen («Zeitraum = Zeitpunkt des Zahlungsversuchs»).
3. **Nur `environment = PRODUCTION`** (Wert in Task 0 an POS und E-Com bestätigt; `ca.state`
   kommt als `SUCCESSFUL`/`FAILED`, `PENDING` in keinem der beiden Spaces beobachtet). Testtransaktionen
   verfälschen jede Quote.
4. **Vor-Aggregation in SQL.** Die Query liefert keine Zeile pro Attempt, sondern
   Zählwerte pro Dimensions-Tupel (Block `DIM`) und pro Tag/Stunde (Block `TIME`). Das
   hält das CSV klein (hunderte bis wenige tausend Zeilen statt zehntausende), enthält
   keine personenbezogenen Daten (keine maskierten Kartennummern, keine
   Kundenadressen) und macht den Report auch im Kopieren-Modus per CSV-Import nutzbar.
5. **Karten-Attribute kommen ausschliesslich aus `chargeattempt.labels`.** Das
   Analytics-Schema kennt keine Karten-/Issuer-Tabelle. Welche Descriptor-IDs Issuer-Land,
   Kartentyp und 3DS tragen, ist connectorabhängig und wird in **Task 0 (Discovery)** an
   echten Daten ermittelt, bevor sie fix verdrahtet werden. Fehlt ein Label, landet der
   Attempt im Bucket **«Unbekannt»** — nie stillschweigend in einem anderen.
6. **Herkunft = Issuer-Land vs. Händler-Land**, letzteres als Eingabefeld (Default `CH`,
   persistiert). Domestisch = gleich; Intra = Issuer-Land in der Europa-Region
   (EWR + CH + UK + Liechtenstein, Konstante `EUROPA_REGION`); Inter = alles andere;
   Unbekannt = kein Issuer-Land-Label.
7. **Mehrere Währungen werden nie addiert.** Beträge werden pro Währung ausgewiesen;
   Zählwerte (Anzahl, Quoten) sind währungsübergreifend.

## 3. Datenmodell der Query

### 3.1 Basis-CTE `att` (eine Zeile pro Charge Attempt)

```
chargeattempt ca
  JOIN charge c                         ON c.id = ca.charge_id
  JOIN transaction t                    ON t.id = c.transaction_id AND t.spaceid = ca.spaceid
  LEFT JOIN paymentconnectorconfiguration pcc ON pcc.id = ca.connectorconfiguration AND pcc.spaceid = ca.spaceid
  LEFT JOIN paymentconnector pc         ON pc.id = pcc.connector
  LEFT JOIN wallettype wt               ON wt.id = ca.wallet
WHERE ca.spaceid IN (<spaces>)
  AND ca.createdon >= TIMESTAMP '<start>' AND ca.createdon < TIMESTAMP '<end>'
  AND ca.environment = 'PRODUCTION'
  AND ca.saleschannel IN (<gewählte Kanäle>)
```

Brand kommt über **`ca.connectorconfiguration`** (die Konfiguration des Versuchs), nicht
über `t.paymentconnectorconfiguration_id` — bei Retry mit anderer Methode wäre die
Transaktion sonst falsch zugeordnet.

Abgeleitete Spalten pro Attempt:

| Spalte | Herleitung |
|---|---|
| `channel` | `CASE ca.saleschannel WHEN 1582819151330 THEN 'POS' WHEN 1582816223150 THEN 'ECOM' ELSE 'OTHER' END` |
| `brand` | `COALESCE(pc.name['en-US'], pcc.name, 'UNKNOWN')` (wie Brand-Modus) |
| `wallet` | `COALESCE(wt.name['en-US'], '-')` (Apple Pay / Google Pay / …) |
| `attempt_state` | `ca.state` (`SUCCESSFUL` / `FAILED` / `PENDING`) |
| `failure_reason_id` | `ca.failurereason` (nur bei FAILED) |
| `issuer_country` | Label `DESC_ISSUER_COUNTRY` = `1474552618629` (Issuer Country), **Map-Key `countryContent`**, sonst `NULL` |
| `card_category` | Label `DESC_CARD_CATEGORY` = `1474552618999` (Issuer Card category, Produktname wie `CLASSIC`, `WORLD_ELITE_BUSINESS`, 37 Werte), Rohwert wird ausgegeben; die Einstufung passiert **clientseitig**: `KARTEN_BUSINESS_REGEX` = `BUSINESS|CORPORATE|COMMERCIAL|PURCHASING|FLEET` → `BUSINESS`; `NOT_SPECIFIED` oder fehlend → `UNKNOWN`; alles andere → `PRIVATE` (Q7 an 37 Werten verifiziert) |
| `funding` | Label `DESC_CARD_TYPE` = `1474552618699` (Issuer Card type) → `CREDIT` / `DEBIT` (bestätigt), sonst `UNKNOWN` |
| `pan_type` | Label `DESC_PAN_TYPE` = `1634723429555` (Pan Type: `DEVICE_TOKEN_APPLE_PAY`, `SCHEME_TOKEN_CLICK_TO_PAY`, …) → Rohwert; Ersatz für `ca.tokenversion_id`, das in Task 0 durchgehend NULL war |
| `auth_response_code` | POS: Label `1579287790513` (Authorization Response Code, ISO-8583 `00`…`Z3`); E-Com: Label `15537739985478` (Response Code des Processors, `AUTHORIZATION_DECLINED`…`SECURITY`) — `COALESCE` beider, feinerer Ablehngrund als `failurereason` |
| `dcc` | `true`, wenn Label `1695119783358` (DCC Cardholder Currency) vorhanden |
| `tds_started` | `true`, wenn Label `DESC_TDS_STARTED` = `1568637480278` (3-D Secure Process Started, `dateTimeContent`) vorhanden |
| `tds_cavv` | `true`, wenn Label `DESC_TDS_CAVV` = `1569496536590` (3-D Secure CAVV, `longTextContent`) vorhanden — **der Wert selbst wird nie ausgegeben** |
| `eci` | Label `DESC_ECI` = `1634723429552` (Cryptogram Eci, `02`/`05`/`06`/`07`) → Rohwert |
| `tds_status` | **clientseitig** aus den drei Feldern: `AUTHENTICATED` (started ∧ cavv) / `FAILED_OR_ABANDONED` (started ∧ ¬cavv) / `WALLET_CRYPTOGRAM` (¬started ∧ eci vorhanden) / `NOT_REQUESTED` (sonst, nur Karten). Der Connector schreibt keine «Authenticated/Status/Liability-Shift»-Labels — Liability Shift wird nicht ausgewiesen |
| `amount` | `CASE WHEN ca.state = 'SUCCESSFUL' THEN t.completedamount END` (Q6: bei SUCCESSFUL identisch mit `authorizationamount`, bei FAILED ist `completedamount` 0 und `authorizationamount` gefüllt) |
| `amount_failed` | `CASE WHEN ca.state = 'FAILED' THEN t.authorizationamount END` — Ø abgelehnter Betrag (Q6 zeigt: am POS 24.04 vs. 20.98 erfolgreich) |
| `tip_amount` | `CASE WHEN ca.state = 'SUCCESSFUL' THEN tip.tip_amount END` — Trinkgeld je Transaktion aus dem wiederverwendeten `tipCte` (`LEFT JOIN tip ON tip.transaction_id = t.id`). `lineitem` wird **nie** direkt gejoint (eine Transaktion hat mehrere Line Items); `tipCte` aggregiert pro Transaktion vor. Der `CASE` ist zwingend: `att` hat die Körnigkeit des Attempts, ohne ihn zählte die Summe das Trinkgeld einer wiederholten Transaktion einmal je Versuch. `tipCte` braucht ein CTE `tx`; es entsteht hier aus den Attempts des Zeitraums (`chargeattempt` + `charge`), **nicht** aus `txCte` — das filtert auf `t.completedon` und `t.state` und wäre ein anderer Zeitschnitt |
| `currency` | `t.currency` |
| `transaction_id` | `t.id` (nur für `COUNT(DISTINCT …)`, wird nicht ausgegeben) |
| `terminal_id` | `ca.terminal_id` (POS; Terminal-Filter wie im Terminal-Modus optional) |

Label-Zugriff wie im bestehenden `cardCte`:
`element_at(filter(ca.labels, l -> l['descriptor'] = '<ID>'), 1)['<key>']` — der Map-Key
ist **descriptorabhängig**: `shortTextContent` (Card type, Card category, Response Code),
`countryContent` (Issuer Country), `staticValueContent` (Authorization Method). Helper
`labelExpr(id, key)` mit explizitem Key, Default `shortTextContent`.

### 3.2 Ausgabe: ein CSV, zwei Blöcke (`UNION ALL`, Spalte `block`)

**Block `DIM`** — `GROUP BY space_id, channel, brand, wallet, currency, attempt_state,
failure_reason_id, auth_response_code, issuer_country, card_category, funding, pan_type,
dcc, tds_started, tds_cavv, eci`

| Spalte | Inhalt |
|---|---|
| `anzahl_attempts` | `COUNT(*)` |
| `anzahl_transaktionen` | `COUNT(DISTINCT transaction_id)` — Attempts pro Transaktion (Retry-Rate) innerhalb des Tupels |
| `summe_betrag` | `SUM(amount)` (nur SUCCESSFUL, sonst 0) |
| `summe_betrag_failed` | `SUM(amount_failed)` (nur FAILED) |
| `summe_refund` | `SUM(t.refundedamount)` je erfolgreichem Attempt (Refund-Quote) |
| `summe_tip` | `SUM(tip_amount)` (nur SUCCESSFUL) — Grundlage von P3. Exakt wie `summe_betrag`, weil pro Transaktion höchstens ein erfolgreicher Attempt existiert; in TIME und CONV ein typisierter `CAST(NULL AS decimal(38,8))`-Platzhalter |

**Block `TIME`** — `GROUP BY space_id, channel, brand, currency, attempt_state,
date(ca.createdon) AS tag, hour(ca.createdon) AS stunde` mit `anzahl_attempts`,
`summe_betrag`. Alle DIM-only-Spalten sind hier `NULL` und umgekehrt.

Spaltenreihenfolge beider Blöcke identisch (UNION ALL verlangt das); der Parser
verzweigt über `block`.

**Transaktions-Conversion (E-Com, Sekundär-KPI):** eigener kleiner Block `CONV` —
`GROUP BY space_id, channel, brand, currency` mit
`COUNT(DISTINCT transaction_id) AS tx_mit_attempt` und
`COUNT(DISTINCT CASE WHEN attempt_state = 'SUCCESSFUL' THEN transaction_id END) AS tx_erfolgreich`.
Bewusst als eigener Block, weil `COUNT(DISTINCT)` über DIM-Tupel hinweg nicht summierbar
ist (eine Transaktion kann Brand wechseln). Wird nur pro Brand/Total ausgewiesen.

## 4. KPI-Katalog

Alle Quoten: Nenner = Attempts mit Endzustand (`SUCCESSFUL + FAILED`); `PENDING` wird
separat als «offen» gezählt und aus Quoten ausgeschlossen. Prozentwerte mit einer
Nachkommastelle, Schweizer Zahlformat (`formatZahlCH`, `CH_TAUSENDER`).

### 4.1 Gemeinsam (POS und E-Com, je Kanal ausgewiesen)

| # | KPI | Formel | Quelle |
|---|---|---|---|
| K1 | **Success Rate** | SUCCESSFUL / (SUCCESSFUL + FAILED) | DIM |
| K2 | **Zahlungsmittel-Verteilung** | Anteil Attempts (und Anteil Betrag) pro Brand, sortiert nach Betrag; Wallet-Anteil (Apple/Google Pay) als eigene Zeile | DIM |
| K3 | **Success Rate pro Zahlungsmittel** | K1 gruppiert nach Brand | DIM |
| K4 | **Failure Rate pro Zahlungsmittel** | 1 − K3, plus absolute Zahl | DIM |
| K5 | **Business vs. Privat** | Anteil `card_type` BUSINESS / PRIVATE / UNKNOWN an erfolgreichen **Karten**-Attempts (Brand ∈ `KARTEN_BRANDS`) | DIM |
| K6 | **Herkunft Karten** | Domestisch / Intra / Inter / Unbekannt an erfolgreichen Karten-Attempts, Anteil Anzahl und Betrag; Top-10 Issuer-Länder als Tabelle | DIM + `EUROPA_REGION` + Händler-Land |
| K7 | **Durchschnittsbetrag** | `summe_betrag / anzahl_attempts(SUCCESSFUL)` pro Währung, gesamt und pro Brand | DIM |
| K8 | **Ablehngründe Top 10** | FAILED-Attempts nach `failure_reason_id`, Name via Proxy (§6.4), Anteil an allen FAILED | DIM |
| K9 | **Refund-Quote** | `summe_refund / summe_betrag` pro Währung | DIM |
| K10 | **Verlauf** | Success Rate und Betrag pro Tag (Linie/Balken), Attempts pro Stunde (Heatmap-Tabelle 24×7 oder Balken 0–23) | TIME |

### 4.2 POS-spezifisch

| # | KPI | Formel |
|---|---|---|
| P1 | **Debit vs. Credit** | Anteil `funding` an erfolgreichen Karten-Attempts (Label bestätigt, 89 % Abdeckung = alle Scheme-Karten) |
| P6 | **Ablehncodes** | FAILED-Attempts nach `auth_response_code` (ISO-Code des Issuers, z. B. `51` = ungenügende Deckung) — am POS aussagekräftiger als `failurereason`, das dort nur «declined»/«cancelled» kennt; Namenstabelle `ISO_RESPONSE_CODES` im Code (statisch, ~30 Einträge) |
| P7 | **DCC-Anteil** | Attempts mit `dcc = true` an erfolgreichen Karten-Attempts (Label vorhanden, am Referenz-Space 2 von 12'537) |
| P2 | **Attempts pro Terminal** | Success Rate und Betrag pro Terminal (Terminal-Filter optional, Join `paymentterminal` wie Terminal-Modus) — zeigt auffällige Geräte (hohe Failure Rate = Hardware/Netz) |
| P3 | **Trinkgeld-Quote** | `summe_tip / summe_betrag` je Währung (`tipCte` wiederverwendet, siehe §3.1). Trinkgeld ist im Bruttobetrag bereits **enthalten** (an Produktivdaten belegt), die Quote ist also ein Anteil am Umsatz, kein Aufschlag. Ausgewiesen als die beiden Spalten `Trinkgeld` / `Trinkgeld-Quote %` im Block «Beträge je Währung» — und nur dort, wo überhaupt Trinkgeld gebucht ist (`tip > 0`); sonst entfallen beide Spalten, statt eine Nullspalte zu zeigen. Datengetrieben statt auf POS verdrahtet |
| P4 | **Stosszeiten** | K10 pro Stunde, als Balken |

### 4.3 E-Com-spezifisch

| # | KPI | Formel |
|---|---|---|
| E1 | **3DS-Akzeptanz (Kreditkarte)** | AUTHENTICATED / (AUTHENTICATED + FAILED_OR_ABANDONED) — Referenzmonat 281/310 = 90.6 %; zusätzlich «3DS angefordert»-Anteil an allen Karten-Attempts (73 %) und Wallet-Kryptogramm-Anteil. Kein Liability-Shift-Label vorhanden |
| E2 | **Success Rate nach 3DS-Status** | K1 gruppiert nach `tds_status` — zeigt, ob 3DS-Failures die Conversion drücken |
| E3 | **Transaktions-Conversion** | `tx_erfolgreich / tx_mit_attempt` (Block CONV) — der Wert, den der Shop-Betreiber «Conversion» nennt; neben K1 ausgewiesen, mit Erklärung des Unterschieds |
| E4 | **Retry-Rate** | `anzahl_attempts / anzahl_transaktionen` pro Brand — > 1.3 deutet auf Reibung im Checkout |
| E5 | **Ablehngründe pro Zahlungsmittel** | K8 × Brand (Tabelle, Top 5 je Brand) |
| E6 | **PAN-Quelle / Token-Anteil** | Verteilung `pan_type` (Klartext-PAN vs. Device Token Apple/Google Pay vs. Scheme Token Click to Pay) mit Success Rate je Typ — `ca.tokenversion_id` ist in Task 0 durchgehend NULL und taugt nicht |

### 4.4 Weitere Ideen (bewusst nicht in v5.11, im Spec festgehalten)

Billing-Land ≠ Issuer-Land (Fraud-Signal, braucht `t.billingaddress`-Land → PII-Abwägung);
Chargeback-/Dispute-Quote (kein Analytics-Tisch dafür); wiederkehrende Karten über PAR
(`1739873828282`, 38 % Abdeckung — «Stammkunden-Anteil» am POS); Vergleich zur
Vorperiode (zweite Query, Delta-Spalte); Benchmark gegen wallee-Durchschnitt (nur
account-übergreifend, nicht in der Händler-Query möglich).

## 5. UI

- Mode-Button **«Reporting»** rechts von «Settlement / Auszahlung».
- Panel `reportingSection` (nur Modus `reporting`): Kanal-Wahl (Radio: POS / E-Commerce /
  Beide), Händler-Land (ISO-2, Default `CH`), Checkbox «Terminal-Aufschlüsselung» (nur
  POS, nutzt Terminal-Panel), Hinweis «Zeitraum bezieht sich auf den Zahlungsversuch».
- Space-Panel und Zeitraum-Picker wie in `brand`.
- Report-Panel `reportingReportSection` (nur Modus `reporting`): Statuszeile, KPI-Kacheln
  (Success Rate, Attempts, Betrag, Ø-Betrag, Conversion/3DS) je Kanal-Tab, danach die
  Tabellen aus §4 in fester Reihenfolge, Balken als **inline-SVG** (kein Chart-Vendor —
  Single-File-Constraint, Datei ist bereits ~1.06 MB).
- Aktionen: XLSX (ein Blatt pro Kanal, Abschnitte gestapelt wie Terminal-Report), PDF
  (jsPDF + autotable wie Settlement-Report), CSV (Rohergebnis), «CSV importieren»
  (Kopieren-Modus: Ergebnis aus dem Portal laden — anders als Terminal-/Settlement-Report
  sinnvoll, weil das Aggregat keine PII enthält).
- Kopieren-Modus: SQL wird wie gewohnt angezeigt; Failure-Reason-Namen bleiben dort IDs
  mit Link `https://app-wallee.com/…` (Hinweiszeile).

## 6. Architektur-Einordnung

### 6.1 State (additiv, kein `STORAGE_KEY`-Bump)

`reportingChannel: 'BOTH'`, `reportingMerchantCountry: 'CH'`,
`reportingByTerminal: false`. Mode-Whitelist in `loadState()` um `'reporting'` erweitern.

### 6.2 Reine Funktionen (ohne DOM testbar, `test/harness.js`)

- `buildReportingQuery({ spaceIds, start, end, channels, byTerminal, terminalIds })` → SQL
- `parseReportingCsv(text)` → `{ rows, error }` (Blöcke DIM/TIME/CONV, Beträge als
  1e-8-Ganzzahlen wie Settlement-Parser)
- `buildReportingModel(rows, { merchantCountry, failureReasons })` → Modell pro Kanal:
  `{ kpi, brands[], herkunft, kartentyp, funding, tds, failures[], verlauf[], stunden[],
  terminals[], waehrungen[] }`
- `klassifiziereHerkunft(issuerCountry, merchantCountry)` → `DOMESTIC|INTRA|INTER|UNKNOWN`
- `reportingExportBloecke(modell)` → Export-Blöcke (gemeinsame Quelle für Screen/XLSX/PDF,
  Muster `settlementExportBloecke`)

### 6.3 Konstanten

`SALES_CHANNEL_ECOM = '1582816223150'`, `SALES_CHANNEL_POS = '1582819151330'`,
`DESC_ISSUER_COUNTRY = '1474552618629'` (Key `countryContent`),
`DESC_CARD_TYPE = '1474552618699'` (CREDIT/DEBIT), `DESC_CARD_CATEGORY = '1474552618999'`,
`DESC_AUTH_RESPONSE_POS = '1579287790513'`, `DESC_AUTH_RESPONSE_ECOM = '15537739985478'`,
`DESC_DCC_CURRENCY = '1695119783358'`, `DESC_PAN_TYPE = '1634723429555'`,
`DESC_TDS_STARTED = '1568637480278'` (Key `dateTimeContent`), `DESC_TDS_CAVV = '1569496536590'`
(Key `longTextContent`, nur Existenz-Check), `DESC_ECI = '1634723429552'`,
`EUROPA_REGION` (ISO-2-Set), `KARTEN_BRANDS` (Regex auf Brand-Name:
`Visa|Mastercard|Maestro|V PAY|American Express|Amex|Diners|Discover|JCB|UnionPay` —
PostFinance Card, TWINT, Lunch Check, Reka tragen keine Karten-Labels und zählen nicht
als Karte), `KARTEN_BUSINESS_REGEX`, `ISO_RESPONSE_CODES`, `ATTEMPT_ENVIRONMENT = 'PRODUCTION'`.

### 6.4 Proxy: Failure-Reason-Namen

Neue Route `GET /failure-reasons` → JSON `{ id: name }`, beim ersten Aufruf von der
wallee-API geholt und im Prozess gecacht (Referenzdaten, ändern sich praktisch nie).
Endpunkt in Task 6 verifizieren: Kandidaten `GET /api/v2.0/failure-reasons`
(v2-Doku) bzw. `GET /api/failure-reason/all` (v1). Liefert der Endpunkt nichts,
fällt die App auf die ID zurück — der Report bleibt vollständig, nur ohne Klartext.

## 7. Edge Cases

- Keine Attempts im Zeitraum → leeres Modell, Report zeigt «Keine Zahlungsversuche».
- Kanal `OTHER` (saleschannel weder POS noch ECOM) → eigener Tab «Andere», nicht verworfen.
- Attempts ohne Brand (`UNKNOWN`) → in K2 sichtbar, nicht in K5/K6 (keine Karte).
- `PENDING` → in Kacheln als «offen» ausgewiesen, aus allen Quoten ausgeschlossen.
- Mehrere Währungen → Beträge pro Währung, Zählwerte gesamt; keine Verweigerung wie im
  Settlement-Report, weil Quoten währungsunabhängig sind.
- Issuer-Land in unerwartetem Format (ISO-3, Name) → Task 0 zeigt es; Parser normalisiert
  oder wertet als UNKNOWN, nie als INTER.
- Terminal-Aufschlüsselung bei «Beide» → nur der POS-Teil bekommt Terminal-Zeilen.

## 8. Validierung (Definition of Done, fachlich)

1. `SUM(anzahl_attempts)` im DIM-Block = Q1-Gesamtzahl aus Task 0 für denselben Zeitraum.
2. Success Rate gesamt = Q1 (SUCCESSFUL / (SUCCESSFUL+FAILED)) auf ±0.05 %.
3. Zahlungsmittel-Verteilung nach Betrag stimmt für erfolgreiche Attempts mit dem
   Brand-Modus (gleicher Zeitraum, `t.completedon` vs. `ca.createdon` erklärt kleine
   Randabweichungen — dokumentieren, nicht wegdiskutieren).
4. K5 + K6: Summe der Buckets = 100 % der erfolgreichen Karten-Attempts.
5. E1: Nenner = alle Karten-Attempts mit 3DS-Status ≠ NOT_REQUESTED; kein Attempt zählt
   doppelt.
6. Referenzlauf mit echten Daten unter `dashboard/discovery-results/` (gitignored)
   dokumentieren: Space, Zeitraum, erwartete Werte.

## 9. Offen (vor Task 1 zu klären)

- Failure-Reason-Endpunkt (§6.4) — wird in Task 6 verifiziert.
- Alles andere ist erledigt (Task 0 POS + E-Com, siehe `DESCRIPTORS.md`). Bekannte
  Grenzen, die im Report als Hinweis stehen: kein Liability-Shift-Label; Labels sind
  connectorabhängig — ein anderer Acquirer kann andere IDs schreiben, dann zeigt der
  Report `UNKNOWN` und `dashboard/sql/00_label_discovery.sql` ist erneut zu fahren.
- **PII-Sperrliste:** `1456765000789` (Card Holder Name) und `1456765125779` (Masked Card
  Number) dürfen in der Reporting-Query nie referenziert werden.
