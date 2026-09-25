# Reporting-Modus — Iteration 3: Der Ausgang der 3-D-Secure-Challenge

Stand 2026-09-25. Status: **§3.1, §3.2 und §3.4 gebaut in v5.16.0 (2026-09-25)**; §3.3
(Stichprobe), §4 (Anfrage an wallee) und §5 (Umsetzung mit Plattformdaten) sind offen.
Fachliche Grundlage: `SPEC.md`, `SPEC-ITERATION-2.md` (§3 «3DS-Failures», §3.6/§3.7
Ablauf und EMVCo-Codes, §4.4 API-Anreicherung). Der auslösende Fall heisst hier
«Referenzfall C»; Space-ID, Händler und die konkreten Attempt-IDs stehen in
`dashboard/discovery-results/FALL-C.md` (gitignored — das Repo ist öffentlich). In SQL
und Tests steht dafür der Platzhalter `90005`.

## 0. Die Frage, und die Antwort in vier Sätzen

Das Portal zeigt an einem gescheiterten E-Commerce-Charge-Attempt unter **«3-D Secure
Authentication Attempts»** den Ausgang der Authentifizierung — im auslösenden Fall
«The challenge authentication of the customer failed or was canceled», Version V2. Die
3DS-Failure-Liste des Query Builders führt denselben Versuch, aber nur mit dem
generischen Grund «3-D Secure Failure» und einer Dauer von 611 Sekunden. **Frage:
sehen wir diesen Grund in den Analytics-Daten, und lässt er sich ergänzen?**

**Antwort:** Nein — und zwar nicht, weil die Query ihn nicht abfragt, sondern weil er
im Analytics-Export **nicht existiert**. Der Ausgang hängt an einer eigenen wallee-Entität
(«3-D Secure Authentication Attempt»), die weder als Analytics-Tabelle exportiert wird
noch als Label am Charge Attempt ankommt noch über die Web-Service-API erreichbar ist.
Händler- oder Tool-seitig ist er deshalb **nicht ergänzbar**; er braucht eine Änderung
am Analytics-Export durch wallee (§4). Bis dahin gibt es eine belastbare, aber
ausdrücklich als Näherung ausgewiesene Zwischenlösung: die gemessene Dauer trennt den
10-Minuten-Timeout des ACS sauber vom sofortigen Abbruch (§3).

## 1. Befund — die Beweiskette

Jeder Punkt ist am 2026-09-25 gemessen oder abgelesen, keiner ist angenommen.

1. **Der Versuch ist im Export.** Die 3DS-Failure-Liste (Referenzfall C, drei Monate,
   7'952 Zeilen) enthält den Charge Attempt aus dem Portal: Grund `1568360440179`
   «3-D Secure Failure», `tds_started_on`/`tds_finished_on` gesetzt, Dauer 611 s,
   `tds_cavv = false`, PAN-Typ Google Pay. **Was fehlt, ist allein der Challenge-Grund.**
2. **Das Analytics-Schema kennt die Entität nicht.** 28 Tabellen
   (<https://app-wallee.com/en-us/doc/api/analytics-schema>), keine mit `secure`, `3d`,
   `tds`, `authentication`, `challenge` oder `acs` im Namen. `chargeattempt` hat 20
   Spalten; 3DS-Information trägt allein `labels` (`array<map<string,string>>`).
3. **Am betroffenen Charge Attempt hängen genau acht Labels** (Discovery Q2 in
   `sql/02_tds_label_discovery.sql`): BIN, Issuer-Land, Funding, Kartenkategorie,
   3-D Secure Process Started, Process Finished, Recurring Indicator, PAN-Typ. Kein
   Label aus den Katalog-Gruppen «Netcetera Attempt Data», «Endeavour Attempt Data V2»
   oder «3-D Secure Details».
4. **Das gilt für den ganzen Space, nicht nur für diesen Versuch** (Discovery Q1, alle
   E-Com-Attempts April–Juni 2026): 6'371 gescheiterte Attempts mit 3DS-Grund, jeder
   trägt nur Started/Finished plus Kartendaten (und bei Wallets Cryptogram Present).
   Kein einziger der in Q3 gesuchten Descriptors — auch nicht auf den 47'043
   erfolgreichen Karten-Attempts. Das ist derselbe Befund wie in Referenzfall B
   (`SPEC-ITERATION-2.md` §4.3, dort für die 13 «3-D Secure Details»-IDs), jetzt an
   einem **zweiten Connector mit einem anderen 3DS-Server** und um die
   Netcetera-/Endeavour-IDs erweitert: **die Labels des 3DS-Servers kommen im
   Analytics-Export nicht an.**
5. **Wo die Information wirklich liegt:** Die Lupe neben dem Portal-Satz führt auf die
   Detailseite der Entität `threed-secure/authentication-attempt/view/<id>`. Sie zeigt
   (Netcetera 3-D Process Information): 3DS process state, Enrolled, Scheme, AReq/ARes
   protocol version (2.2.0), Directory Server ID, 3DS Method Completion samt zwei
   Zeitstempeln, Challenge ACS URL, **ARes Status** (`C` = Challenge Required),
   **Challenge Status** (`N` = Nicht authentifiziert), **Challenge Status Reason**
   (`14` = Zeitüberschreitung beim ACS), **Challenge cancel** (`04` = Transaction Timed
   Out at ACS – other timeouts), dazu State *Rejected* und die Zeitpunkte created/failed.
   Das sind **genau die EMVCo-Felder aus `SPEC-ITERATION-2.md` §3.6/§3.7**, und der
   angezeigte Satz ist wortgleich der Katalog-Ablehngrund **`1534308616423` «Challenge
   Authentication Failure»** (End User) aus `dashboard/catalog/failure-reasons.json` —
   ein Ablehngrund der *Authentifizierung*, während der Charge Attempt den groben
   `1568360440179` trägt. Die Entität hat also einen **eigenen `failureReason`**, und der
   eingebettete Katalog kennt ihn bereits (die Gruppe `15343…`: Challenge Authentication
   Failure, Unexpected Challenge Authentication Failure, Authentication Failure,
   Enrollment failed, Authentication Response Validation Failure, Connection Failure …).
6. **Kein Export, keine API.** Die Portal-Liste
   `threed-secure/authentication-attempt/list` zeigt ID, State (Successful / Rejected /
   Processing), Charge Attempt ID, Transaction, 3-D Secure Processor ID und «3-D Secure
   Response» (`FULLY_AUTHENTICATED` bzw. leer) — Status Reason und Cancel stehen nur auf
   der Detailseite, und die Liste hat **keinen Export-Knopf**. Das offizielle SDK
   (`wallee-payment/python-sdk`, 95 Services) hat weder Service noch Modell für die
   Entität; `ChargeAttempt` trägt `failureReason`, `userFailureMessage` und `labels`,
   aber keinen Verweis auf Authentifizierungsversuche. `CardholderAuthentication` ist
   das *Eingabe*-Modell für händlerseitig mitgelieferte 3DS-Ergebnisse, nicht das
   Ergebnis des wallee-3DS-Servers. Die Proxy-Route aus `SPEC-ITERATION-2.md` §4.4
   (Charge Attempts je 20 über die API) würde den Grund also **ebenfalls nicht** liefern.

Was der Fall nebenbei gezeigt hat und in §3.2 und §3.4 landet: der Connector dieses Space
schreibt den Ablehncode unter einem dritten Descriptor, und die 3DS-Query ist mit diesem
Export erstmals gegen echte Daten gelaufen.

## 2. Was daraus folgt

- **Für die App:** Es gibt heute keine Datenquelle, aus der die Seite «3DS-Failures» den
  Challenge-Ausgang beziehen könnte. Die Achsen «Challenge-Status-Grund», «Abbruch-
  Indikator» und «ACS» aus `SPEC-ITERATION-2.md` §3.6/§3.7 bleiben **nicht baubar** —
  nicht «noch nicht», sondern bis wallee die Entität exportiert. Die Doku führt das
  bereits so (CLAUDE.md, «Die Seite «3DS-Failures»»); Referenzfall C macht daraus eine
  an zwei Connectoren gemessene Aussage.
- **Für den Händler:** Die Frage «bricht der Kunde ab, scheitert er am Code, oder läuft
  die Challenge ins Leere?» beantwortet heute nur der Blick ins Portal, Versuch für
  Versuch. Die 3DS-Seite kann sie **näherungsweise** über die Dauer beantworten (§3.1)
  und muss dabei sagen, dass es eine Näherung ist.
- **Für wallee:** Die Daten existieren, sind im Portal sichtbar und im Katalog als
  Label-Descriptors modelliert — es fehlt nur der Export. Das ist eine kleine
  Plattformänderung mit grossem Nutzen für jeden E-Commerce-Händler, dessen grösster
  Ablehngrund «3-D Secure Failure» ist (Referenzfall B: 64.8 % aller Fehlschläge;
  Referenzfall C: 6'305 von 7'952 Zeilen der Liste). §4 formuliert die Anforderung.

## 3. Zwischenlösung ohne Plattformänderung (Vorschlag: v5.16)

### 3.1 Dauer-Eimer «Signatur ACS-Timeout»

Die Dauer zwischen *Process Started* und *Process Finished* ist in Referenzfall C
**bimodal**: 2'949 der 6'305 «3-D Secure Failure»-Zeilen (46.8 %) liegen unter 30 s,
weitere 1'806 (28.6 %) bei **590 s oder mehr**, davon 1'549 zwischen 600 und 690 s;
zwischen 540 und 600 s liegen nur 10 Zeilen. Der zweite Gipfel ist der Challenge-Timeout
des ACS (bei EMVCo-3DS-2 typischerweise 10 Minuten nach dem CReq): der Kunde hat die
Challenge-Seite geöffnet und nie abgeschlossen — App nicht bestätigt, SMS-Code nicht
eingegeben, Fenster geschlossen. Der auslösende Fall (611 s) trägt im Portal genau
diese Kennzeichnung (Status Reason 14, Challenge cancel 04).

**Umsetzung:** `TDS_DAUER_GRENZEN_SEK = [10, 60, 300, 570]` statt `[10, 60, 300]`, also
ein fünfter Eimer **`UEBER_9MIN30`** («≥ 9.5 min · Signatur ACS-Timeout») neben dem auf
5–9.5 min verkürzten `UEBER_5MIN` («5–9.5 min»). Halboffen wie bisher, die Summe der
Eimer bleibt die Zeilenzahl. Die Grenze 570 s steht **bewusst unter** 600: der Gipfel
beginnt bei 605 s, die Lücke davor ist leer, und ein Connector, dessen ACS bei 9.5 min
abbricht, fiele sonst in den falschen Eimer. `REPORTING_TDS_DAUER`, `REPORTING_LABEL`
und die Kuchenfarbe des neuen Eimers sind nachzuziehen (`SVG_KUCHEN_FARBEN`-Whitelist,
Grau bleibt «Unbekannt» vorbehalten).

**Hinweis im Block «Dauer bis zum Abbruch»** (alle vier Ausgaben), Wortlaut: «Der Eimer
«≥ 9.5 min» entspricht dem Challenge-Timeout des ACS (in der Regel 10 Minuten): der Kunde
hat die Challenge begonnen und nie abgeschlossen. Das ist aus der Dauer geschlossen, nicht
aus dem Challenge-Status — den exportiert wallee Analytics nicht.» Der Satz ist die
Bedingung, unter der die Näherung überhaupt in den Report darf: ohne ihn läse ein Leser
«Timeout» als gemessen.

**Warum kein Eimer «< 30 s = Kunde hat abgebrochen»:** Der erste Gipfel mischt
Kundenabbruch (Challenge cancel 01), sofortige Ablehnung durch den Issuer (ARes N/R ohne
Challenge) und technische Fehler. Die Dauer trennt das nicht, und ein Name wie
«Abgebrochen» behauptete es. `UNTER_10S` und `S10_60` bleiben, wie sie sind.

**Was die Näherung nicht ist:** kein Ersatz für §5. Sie erkennt genau einen Ausgang
(Timeout) an einer Signatur, die von ACS und Connector abhängt. Sie wird deshalb in §3.3
an einer Stichprobe geprüft und in `FALL-C.md` mit Datum, Space und 3DS-Server notiert,
damit ein anderer Space sie nicht ungeprüft erbt.

### 3.2 Ablehncode: dritter Descriptor

Der Connector in Referenzfall C schreibt den Ablehncode unter **`1532425961680`
«Response Code»** (Gruppe *Transaction Details*, `shortTextContent`, 13 Werte auf
gescheiterten Nicht-3DS-Attempts, z. B. `AUTHORIZATION_DECLINED`, `VERIFICATION_DATA_
FAILED`; auf erfolgreichen `COMPLETED_SUCCESSFUL` / `…_NO_LIABILITY_SHIFT`). Die beiden
bekannten Descriptors (`DESC_AUTH_RESPONSE_POS`, `DESC_AUTH_RESPONSE_ECOM`) kommen in
diesem Space gar nicht vor — `response_code` steht in allen 7'952 Zeilen der 3DS-Liste auf
UNKNOWN, und der P6-Block des Aggregats fiele für diesen Space unter die 25-%-Schwelle.

**Umsetzung:** neue Konstante `DESC_AUTH_RESPONSE_SIX = '1532425961680'` (Map-Key
`shortTextContent`, in Q1 gemessen) als **drittes** Glied des `COALESCE` in
`buildReportingQuery` und als zweites in `buildReportingTdsQuery` (die 3DS-Query ist
fest E-Commerce). Auf 3DS-Fehlschlägen bleibt der Code leer — die Autorisierung fand
nie statt —, die 1'581 `ANDERER_GRUND`-Zeilen der Liste bekommen ihn. Die Konstante
trägt wie alle anderen ihren Beleg als Kommentar (Discovery Q1, Referenzfall C). Das
Wertevokabular ist ein anderes als die ISO-8583-Codes am POS; `ISO_RESPONSE_CODES`
greift hier nicht, die Werte sind aber selbsterklärend und bleiben roh.

### 3.3 Validierungsstichprobe (vor dem Bau von 3.1)

Je 20 zufällige Zeilen aus dem Export mit Dauer ≥ 590 s und mit Dauer < 30 s im Portal
öffnen (Dashboard-Link der Liste → Charge Attempt → Lupe) und notieren: ARes Status,
Challenge Status, Status Reason, Challenge cancel. Erwartung: ≥ 590 s → durchgehend
Reason 14 / Cancel 04 (oder 03/05/08); < 30 s → gemischt (01 Cardholder Cancel, ARes N/R
ohne Challenge, technische Gründe). Ergebnis nach `FALL-C.md`. Trifft die Erwartung im
ersten Eimer nicht zu, entfällt 3.1 — eine Näherung, die an 20 Fällen wackelt, gehört
nicht in einen Report. Die Stichprobe ist **eine** Portal-Sitzung von rund einer Stunde.

### 3.4 Doku-Nachträge (keine Code-Änderung)

- Der **Referenzlauf der 3DS-Query** ist mit Referenzfall C erledigt (CLAUDE.md führte
  ihn als offen): drei Monate, 7'952 Zeilen. Gemessen ist die Schreibweise der beiden
  3DS-Zeitstempel — `YYYY-MM-DDTHH:MM:SS.fffZ`, also UTC **mit** Zone —, während
  `created_on` als Athena-Lokalzeit ohne Zone kommt. Die Dauer wird aus zwei Z-Werten
  gebildet und ist korrekt; `REPORTING_TDS_MUSTER_ZEIT` passt. Die Fixture
  `test/fixtures/reporting-tds-beispiel.csv` ist auf diese Schreibweise umzustellen
  (Struktur bleibt erfunden, Schreibweise wird gemessen — dieselbe Regel wie bei der
  Aggregat-Fixture).
- `dashboard/sql/02_tds_label_discovery.sql` ist die Discovery dieser Iteration und der
  Auslöser für §5 (siehe §7).

## 4. Anforderung an wallee: den Ausgang exportieren

Drei Wege, jeder löst das Problem; sie unterscheiden sich in Aufwand und in dem, was der
Report daraus machen kann. Adressat ist das Plattform-Team (Analytics-Export /
3DS-Server), nicht der Händler.

### 4.1 Variante A — neue Analytics-Tabelle `threedsecureauthenticationattempt`

Eine Zeile je Authentifizierungsversuch, mindestens: `id`, `spaceid`, `chargeattempt_id`,
`transaction_id`, `state` (Successful / Rejected / Processing), `response`
(`FULLY_AUTHENTICATED` …), `failurereason` (bigint, die `15343…`-Gründe), `processor`
(Netcetera / Endeavour), `createdon`, `failedon`/`succeededon`, `version`
(2.1.0 / 2.2.0) und `labels` im selben Format wie `chargeattempt.labels`, mit den
Descriptors, die die Detailseite zeigt (ARes/RRes Status, Status Reason, Cancel, Method
Completion, Enrolled, DS-ID, ACS Transaction ID, Challenge ACS URL). **Empfohlen**, weil
sie die Realität abbildet: die Portal-Überschrift heisst *Attempts* — ein Charge Attempt
kann mehrere Authentifizierungsversuche haben, und nur eine eigene Tabelle zeigt alle.

### 4.2 Variante B — Labels am Charge Attempt

Der Connector schreibt nach Abschluss der Authentifizierung den Ausgang als Labels auf
den Charge Attempt, so wie er heute schon *Process Started* / *Process Finished* schreibt
(beide gehören der Gruppe «Card Data Processing Information» und kommen an). Die
Descriptors existieren im Katalog: für Netcetera `1555882394269` ARes status,
`1556882394269` RRes status, `1557886394269` RRes status reason, `1558882394269` RRes
result status, `1552776387359` Enrolled V2, `1553882394269` AReq protocol version,
`1551953661029` Challenge ACS URL; für Endeavour `1552399220645`/`1552555790369` AReq/
RReq Status, `1552399220644`/`1552555790370` Status Reason Code, `1552557191573` Cancel
Indicator. Dazu der `failureReason` der Authentifizierung als eigenes Label (Descriptor
zu vergeben). **Billigster Weg** — kein neuer Export, `chargeattempt.labels` fliesst
schon —, aber nur der **letzte** Versuch je Charge Attempt ist sichtbar, und die Labels
sind connectorabhängig (jeder 3DS-Server braucht seinen Satz).

### 4.3 Variante C — Web-Service-Endpunkt

`GET /api/v2.0/threed-secure/authentication-attempts?chargeAttempt=<id>` (oder ein
`expand` am Charge Attempt). Löst nur den Proxy-Weg aus `SPEC-ITERATION-2.md` §4.4
(Batch je 20 Attempts) und nichts im Analytics-Report; als **Ergänzung** zu A oder B
sinnvoll, allein zu langsam für 6'000 Fehlschläge im Quartal.

### 4.4 Empfehlung und Formulierung

**A als Ziel, B als Minimum.** Für die Anfrage reicht ein Absatz: «Die Entität 3-D Secure
Authentication Attempt (Portal: `threed-secure/authentication-attempt`) mit State,
Response, Failure Reason, Version und den Netcetera-/Endeavour-Labels (ARes/RRes Status,
Status Reason, Cancel Indicator, Enrolled, Method Completion, ACS-URL) ist im
Analytics-Export nicht enthalten — weder als Tabelle noch in `chargeattempt.labels`
(gemessen an zwei Spaces mit zwei Connectoren, 2026-09-04 und 2026-09-25). Händler mit
«3-D Secure Failure» als grösstem Ablehngrund können deshalb nicht unterscheiden, ob der
Kunde abbricht, am Code scheitert oder die Challenge ins Leere läuft. Bitte die Entität
als eigene Tabelle exportieren (Variante A) oder mindestens den Ausgang als Labels am
Charge Attempt schreiben (Variante B).» `FALL-C.md` liefert die Belegstellen.

## 5. Umsetzung im Query Builder, sobald die Daten da sind

Gebaut wird erst, wenn `sql/02_tds_label_discovery.sql` Q3 (Variante B) Zeilen liefert
oder das Schema die Tabelle aus Variante A führt. Bis dahin ist §5 die Vorgabe, nicht
der Auftrag. Gleiche Bauweise wie die ganze Seite: reine Funktionen, eine Blockquelle
für vier Ausgaben, jede Konstante mit gemessenem Map-Key.

### 5.1 Query

**Variante B:** fünf Spalten im `att`-CTE von `buildReportingTdsQuery`, über `labelExpr`
mit dem in Q3 gemessenen Key (nicht geraten — ein falscher Key liefert dauerhaft NULL):

| Spalte | Quelle (Netcetera / Endeavour) | Inhalt |
|---|---|---|
| `tds_ares_status` | `1555882394269` / `1552399220645` | `Y` `N` `U` `A` `C` `D` `R` `I` |
| `tds_challenge_status` | `1556882394269` / `1552555790369` | `Y` `N` … (nur nach `C`) |
| `tds_status_reason` | `1557886394269` / `1552555790370` | EMVCo `01`…`26`, `80`…`99` |
| `tds_challenge_cancel` | (Descriptor von wallee zu nennen) / `1552557191573` | `01`…`08` |
| `tds_auth_failure_reason_id` | (Descriptor von wallee zu nennen) | `15343…`-ID |

Dazu, wo vorhanden: `tds_protocol_version` (`1553882394269`, ersetzt das in diesem
Space leere `tds_version`) und `tds_acs_host` = **nur der Hostname** der Challenge ACS
URL (`1551953661029`) über `url_extract_host(...)` — die URL selbst trägt die
ACS-Transaktions-ID und bleibt draussen. Die beiden Server-Varianten stehen je Spalte in
einem `COALESCE`, wie heute die beiden Ablehncode-Descriptors. **Die PII-Sperrliste
bleibt unverändert; keine der neuen Spalten ist personenbezogen.** CReq-Inhalt, ACS
Signed Content und Notification-URLs werden nie exportiert.

**Variante A:** `LEFT JOIN` auf ein vor-aggregiertes CTE `tds_auth` — **eine Zeile je
Charge Attempt**, der jüngste Versuch per `max_by(..., createdon)`, dazu
`tds_auth_versuche = COUNT(*)`. Derselbe Fallstrick wie bei `lineitem`: die Entität ist
N:1 zum Charge Attempt, ein direkter Join vervielfachte die Zeilen und die Fensterzähler
der Bestellung. Die Ausgabespalten heissen gleich wie in Variante B, plus
`tds_auth_state`, `tds_auth_versuche`.

### 5.2 Parser

Die neuen Spalten sind **optional** (Präzedenz: `autorisiert_gross` im Terminal-Report),
nicht Teil von `REPORTING_TDS_PFLICHT` — ein Export aus v5.13–v5.16 bleibt lesbar. Der
Parser unterscheidet drei Zustände, und die Ausgabe muss alle drei benennen:
**Spalte fehlt** (älterer Export → die neuen Blöcke entfallen mit dem Hinweis «nicht
im Export»), **Spalte da, Wert leer** (der Connector schreibt das Label nicht → Eimer
`UNKNOWN`), **Wert da**. Ein leerer Wert darf nie als «nicht im Export» durchgehen —
sonst sähe ein Connector ohne Labels aus wie ein alter Export.

### 5.3 Modell

`klassifiziereTdsFlow(z)` je Zeile, Vorrang von oben nach unten, aus den Rohwerten —
`SPEC-ITERATION-2.md` §3.6 **ohne** den Drei-Sekunden-Rückfall (der bleibt bewusst
ungebaut, siehe CLAUDE.md):

| `tds_flow` | Bedingung |
|---|---|
| `CHALLENGE_TIMEOUT` | Cancel ∈ {`03`,`04`,`05`,`08`} oder Status Reason `14` oder Grund `1568360434240` |
| `CHALLENGE_CANCELLED` | Cancel ∈ {`01`,`02`} |
| `CHALLENGE_FAILED` | ARes `C` und Challenge Status `N`/`R` (Cancel leer) |
| `CHALLENGE_OK` | ARes `C` und Challenge Status `Y` |
| `FRICTIONLESS` | ARes `Y` |
| `ATTEMPTED` | ARes `A` |
| `UNAVAILABLE` | ARes `U` |
| `REJECTED` | ARes `N` oder `R` (Issuer lehnt ohne Challenge ab) |
| `NOT_ENROLLED` | Enrolled = false |
| `UNKNOWN` | nichts davon lesbar |

Ein Test nagelt fest: keine Zeile mit `attempt_state = SUCCESSFUL` landet in
`CHALLENGE_FAILED`/`CHALLENGE_CANCELLED`/`CHALLENGE_TIMEOUT` (die 3DS-Liste ist per
Konstruktion FAILED; die Regel gilt für §5.5). Dazu die drei statischen Tabellen aus
`SPEC-ITERATION-2.md` §3.7 (`TDS_TRANS_STATUS`, `TDS_STATUS_REASONS`,
`TDS_CHALLENGE_CANCEL`) — **vor dem Bau gegen die EMVCo-Spezifikation gegenlesen**; drei
Werte sind seit Referenzfall C an einer echten Portal-Ausgabe belegt (`N`, `14`, `04`,
mit genau den Texten, die §3.7 nennt). Der `15343…`-Grund läuft über
`reportingFailureName` — der eingebettete Katalog kennt alle Einträge der Gruppe.

Der Dauer-Eimer aus §3.1 bleibt daneben stehen: er misst dieselbe Frage auf anderem
Weg, und der Vergleich der beiden Achsen (Timeout-Signatur gegen Cancel 04) ist genau
die Prüfung, ob die Näherung an einem Space hält.

### 5.4 Ausgabe (vier Ausgaben aus einer Blockquelle)

Neue Blöcke in `reportingTdsExportBloecke`, jeweils Tabelle + Kuchen wie die bestehenden
Verteilungen, nach dem Block «Grund-Einordnung»:

1. **«3DS-Ablauf»** — `tds_flow`, Anzahl, Anteil; Hinweis nennt den Vorrang der Regeln.
2. **«Challenge-Status-Grund»** — Reason-Code mit Klartext aus `TDS_STATUS_REASONS`,
   nur Zeilen mit ARes `C`; Hinweis: «Nenner sind die Versuche mit Challenge».
3. **«Abbruch-Indikator»** — Cancel-Code mit Klartext.
4. **«Ablehngrund des 3DS-Servers»** — `tds_auth_failure_reason_id` über den Katalog
   (Name, Kategorie), dieselbe Form wie K8.
5. **«ACS»** — `tds_acs_host`, Top 10 + Übrige, **nur Variante A/B mit ACS-URL**; das ist
   die einzige ACS-Achse ohne ACS-Referenznummer (Referenzfall C: `secure5.arcot.com`).

Die Zeilentabelle bekommt die Spalten `3DS-Ablauf`, `Status-Grund`, `Abbruch` (CSV/Excel
zusätzlich die Rohcodes). Fehlt die Spaltengruppe im Export, steht an Stelle der Blöcke
**ein** Hinweisblock («Challenge-Ausgang nicht im Export — Abfrage vor Iteration 3 oder
Connector ohne 3DS-Labels»), nicht fünf leere Tabellen.

### 5.5 Aggregat (zweiter Schritt, eigener Task)

Mit Variante B trägt auch die Aggregat-Query die Werte: `tds_flow` als 19. DIM-Dimension
(typisierter Platzhalter in `TIME`/`CONV`, wie alle anderen), im E-Com-Kanal der Block
**«3DS-Ablauf»** mit Erfolgsquote je Zeile und die **Frictionless-Quote** als KPI
(`FRICTIONLESS / (alle mit ARes ≠ leer)`) — die Kennzahl, nach der Referenzfall B
gefragt hat (§3.6). Mit Variante A braucht das Aggregat den Join aus 5.1. Bewusst
getrennt vom ersten Schritt: das Aggregat ist PII-frei und weitergabefähig, jede
Änderung an seiner Spaltenliste macht ältere Tokens unlesbar (`REPORTING_PFLICHT` ist
die volle SELECT-Liste).

### 5.6 Tests

Keine neue Testdatei; die Nähte sitzen in `reporting-tds-queries` (Spalten, Map-Keys,
`COALESCE` beider Server, Hostname statt URL, kein CReq/Signed Content im SQL),
`reporting-tds-model` (Vorrang der `tds_flow`-Regeln mit je einem Beispiel, die
SUCCESSFUL-Zusicherung, «Spalte fehlt» ≠ «Wert leer», neuer Dauer-Eimer mit den Grenzen
569/570/599/600), `reporting-tds-export`/`-render`/`-xlsx` (fünf Blöcke bzw. ein
Hinweisblock, Kuchenfarbe des neuen Eimers im `:root`-Wächter) und `reporting-queries`
(dritter Response-Code-Descriptor im `COALESCE`). Die Fixture bekommt die neuen Spalten
mit von Hand gerechneten Erwartungswerten — und die gemessene Zeitstempel-Schreibweise
aus §3.4.

### 5.7 Was bewusst nicht gebaut wird

- Kein Portal-Scraping über den Proxy: die Entität ist nur mit Session-Login erreichbar,
  und ein Proxy, der Portal-Sitzungen fährt, wäre eine andere Anwendung mit einem
  anderen Sicherheitsmodell.
- Kein CSV-Import der Portal-Liste: sie hat keinen Export, und ihre Spalten trügen den
  Grund ohnehin nicht.
- Keine «Abgebrochen»-Deutung der kurzen Dauern (§3.1).
- Kein Nachbau der EMVCo-Achsen aus dem Drei-Sekunden-Rückfall.

## 6. Reihenfolge und Definition of Done

1. **Stichprobe §3.3** (Portal, eine Stunde) → `FALL-C.md`. Ergebnis entscheidet über 2.
2. **v5.16** — §3.1 (Dauer-Eimer), §3.2 (Response Code), §3.4 (Fixture, Doku); Tests
   grün, Export von Referenzfall C erneut fahren und die Eimer gegen die Zahlen in
   `FALL-C.md` halten (1'806 / 2'949).
3. **Anfrage an wallee** nach §4.4, mit Verweis auf `FALL-C.md`.
4. **Sobald Q3 Zeilen liefert oder die Tabelle existiert:** Discovery erneut fahren (Keys
   messen), dann §5.1–5.4, danach 5.5 als eigener Task. Done, wenn der auslösende Fall in
   der Liste unter «Challenge-Timeout» mit Grund `14`, Abbruch `04` und Katalogname
   «Challenge Authentication Failure» steht — also genau das zeigt, was das Portal zeigt.

## 7. Wann die Discovery erneut zu fahren ist

`sql/02_tds_label_discovery.sql` Q3, mit `<SPACE_ID>` des betroffenen Space: nach jeder
Ankündigung einer Analytics- oder Connector-Änderung durch wallee, bei einem neuen
3DS-Server (ein dritter neben Netcetera und Endeavour hätte einen eigenen Label-Satz),
und bevor jemand behauptet, die Achse sei «immer noch nicht» da. Liefert Q3 Zeilen, ist
§5 zu bauen; liefert sie keine, bleibt §3 der Stand — mit Datum in `FALL-C.md`.
