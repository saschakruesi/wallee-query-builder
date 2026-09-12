-- Verifikations-Queries fuer den autorisierten Betrag (Terminal-Report-Tool/
-- SPEC-ITERATION-2.md, Task 0 / §2.4 - siehe CLAUDE.md, "Wallee-Referenzwissen").
--
-- Fragestellung: Seit v5.14 zeigen die Modi brand und terminal neben dem
-- abgeschlossenen Betrag (SUM(t.completedamount), "Complete Demand") auch den
-- autorisierten Betrag (SUM(t.authorizationamount), "Autorisiert") und nehmen
-- dafuer Transaktionen im Zustand AUTHORIZED in die Basis auf - eingeordnet nach
-- t.authorizedon statt t.completedon. Die Queries unten pruefen die Annahmen,
-- auf denen dieser Umbau steht:
--
--   Q1  t.authorizedon ist bei AUTHORIZED und bei FULFILL/COMPLETED gefuellt
--       (sonst Rueckfall auf t.createdon - Entscheid dann in CLAUDE.md).
--   Q2  Gibt es ueberhaupt liegengebliebene Autorisierungen, und wie alt?
--   Q3  Bei abgeschlossenen Transaktionen: completedamount vs. authorizationamount
--       (Teil-Captures? Trinkgeld-Nachbuchung?) - bestimmt den Wortlaut des
--       Hinweises (SPEC §10 O3).
--   Q4  Bei AUTHORIZED: completedamount, totalappliedfees, Trinkgeld-Lineitems
--       alle 0/NULL? (Schutz der bestehenden Kennzahlen, SPEC §2.3.)
--   Q5  Bei AUTHORIZED: Terminal und Connector-Konfiguration gesetzt? (Sonst
--       landet die Zeile im Terminal-Report nicht unter ihrem Terminal, SPEC A2.)
--
-- <SPACE_ID> durch die zu pruefende Space-ID ersetzen (Referenz: 40402, POS).
-- Jede Query einzeln im wallee-Portal unter Account > Analytics > Submit Query
-- ausfuehren. Tabellen-/Spaltennamen zwingend lowercase.
--
-- Zeitfenster: die Queries grenzen auf t.createdon der letzten 90 Tage ein -
-- bewusst createdon und nicht completedon, denn eine AUTHORIZED-Transaktion hat
-- kein completedon, und genau die sollen hier sichtbar werden.


-- ---------------------------------------------------------------------------
-- Q1: Existiert t.authorizedon, und ist es je Zustand gefuellt?
--
-- Erwartung: bei AUTHORIZED, FULFILL, COMPLETED ist authorizedon_null = 0.
-- Ist authorizedon bei AUTHORIZED leer, funktioniert das
-- COALESCE(t.completedon, t.authorizedon)-Fenster nicht; dann Rueckfall auf
-- t.createdon (Entscheid in CLAUDE.md festhalten). Zum Vergleich steht daneben,
-- wie oft completedon fehlt - bei AUTHORIZED muss das 100 % sein.
-- ---------------------------------------------------------------------------
SELECT
    t.state,
    count(*)                                                          AS anzahl,
    SUM(CASE WHEN t.authorizedon IS NULL THEN 1 ELSE 0 END)           AS authorizedon_null,
    SUM(CASE WHEN t.completedon  IS NULL THEN 1 ELSE 0 END)           AS completedon_null,
    SUM(CASE WHEN t.authorizedon IS NOT NULL AND t.completedon IS NOT NULL
              AND t.authorizedon > t.completedon THEN 1 ELSE 0 END)   AS authorizedon_nach_completedon,
    min(t.authorizedon)                                               AS erste_autorisierung,
    max(t.authorizedon)                                               AS letzte_autorisierung
FROM transaction t
WHERE t.spaceid = <SPACE_ID>
  AND t.createdon >= current_timestamp - INTERVAL '90' DAY
GROUP BY t.state
ORDER BY anzahl DESC;


-- ---------------------------------------------------------------------------
-- Q2: Liegengebliebene Autorisierungen - Anteil und Alter.
--
-- Alter = Tage zwischen authorizedon und jetzt, in Eimern. Gibt es AUTHORIZED
-- aelter als ein paar Tage, ist das genau der Fall "freigegeben, aber nie
-- eingereicht", den der Report sichtbar machen soll. Daneben VOIDED (die
-- Autorisierung wurde storniert) und FAILED, damit klar ist, wie das Ende einer
-- liegengebliebenen Autorisierung im Schema aussieht.
-- ---------------------------------------------------------------------------
SELECT
    t.state,
    CASE
        WHEN t.authorizedon IS NULL THEN 'ohne authorizedon'
        WHEN date_diff('day', t.authorizedon, current_timestamp) < 1  THEN '0: < 1 Tag'
        WHEN date_diff('day', t.authorizedon, current_timestamp) < 3  THEN '1: 1-2 Tage'
        WHEN date_diff('day', t.authorizedon, current_timestamp) < 8  THEN '2: 3-7 Tage'
        WHEN date_diff('day', t.authorizedon, current_timestamp) < 31 THEN '3: 8-30 Tage'
        ELSE '4: > 30 Tage'
    END                                                               AS alter_seit_autorisierung,
    count(*)                                                          AS anzahl,
    SUM(t.authorizationamount)                                        AS summe_autorisiert,
    SUM(t.completedamount)                                            AS summe_abgeschlossen
FROM transaction t
WHERE t.spaceid = <SPACE_ID>
  AND t.createdon >= current_timestamp - INTERVAL '90' DAY
  AND t.state IN ('AUTHORIZED', 'VOIDED', 'FAILED')
GROUP BY 1, 2
ORDER BY 1, 2;


-- ---------------------------------------------------------------------------
-- Q3: Abgeschlossene Transaktionen - completedamount vs. authorizationamount.
--
-- Bisheriger Befund (CLAUDE.md, Charge-Attempt-Befunde): bei SUCCESSFUL sind
-- beide identisch. Hier auf Transaktionsebene nachgemessen. Gibt es Zeilen mit
-- Differenz <> 0 (Teil-Capture, Trinkgeld-Nachbuchung am Terminal), muss der
-- Hinweis G2 um "... oder eine Teil-Einreichung" ergaenzt werden (SPEC §10 O3).
-- Die Richtung der Differenz steht getrennt da: completed > authorized ist eine
-- Nachbuchung (z. B. Trinkgeld nach der Autorisierung), completed < authorized
-- ein Teil-Capture.
-- ---------------------------------------------------------------------------
SELECT
    t.state,
    t.currency,
    count(*)                                                          AS anzahl,
    SUM(t.completedamount)                                            AS summe_abgeschlossen,
    SUM(t.authorizationamount)                                        AS summe_autorisiert,
    SUM(t.completedamount) - SUM(t.authorizationamount)               AS differenz,
    SUM(CASE WHEN t.completedamount <> t.authorizationamount THEN 1 ELSE 0 END)
                                                                      AS zeilen_mit_differenz,
    SUM(CASE WHEN t.completedamount > t.authorizationamount THEN 1 ELSE 0 END)
                                                                      AS zeilen_nachbuchung,
    SUM(CASE WHEN t.completedamount < t.authorizationamount THEN 1 ELSE 0 END)
                                                                      AS zeilen_teilcapture,
    SUM(CASE WHEN t.authorizationamount IS NULL THEN 1 ELSE 0 END)    AS authorizationamount_null
FROM transaction t
WHERE t.spaceid = <SPACE_ID>
  AND t.createdon >= current_timestamp - INTERVAL '90' DAY
  AND t.state IN ('FULFILL', 'COMPLETED')
GROUP BY t.state, t.currency
ORDER BY t.state, t.currency;


-- Q3b: Stichprobe der Zeilen mit Differenz - nur ausfuehren, wenn Q3 welche
-- zeigt. Zeigt, ob es das Trinkgeld ist (tip = Differenz) oder etwas anderes.
SELECT
    t.id,
    t.state,
    t.currency,
    t.authorizedon,
    t.completedon,
    t.authorizationamount,
    t.completedamount,
    t.completedamount - t.authorizationamount                         AS differenz,
    tip.tip_amount
FROM transaction t
LEFT JOIN (
    SELECT tl.transaction_id, SUM(li.amountincludingtax) AS tip_amount
    FROM transaction_lineitem tl
    JOIN lineitem li ON li.id = tl.lineitems_id AND li.spaceid = tl.spaceid
    WHERE tl.spaceid = <SPACE_ID>
      AND li.type = 'TIP'
    GROUP BY tl.transaction_id
) tip ON tip.transaction_id = t.id
WHERE t.spaceid = <SPACE_ID>
  AND t.createdon >= current_timestamp - INTERVAL '90' DAY
  AND t.state IN ('FULFILL', 'COMPLETED')
  AND t.completedamount <> t.authorizationamount
ORDER BY t.completedon DESC
LIMIT 50;


-- ---------------------------------------------------------------------------
-- Q4: AUTHORIZED - sind completedamount, totalappliedfees und Trinkgeld 0/NULL?
--
-- Erwartung: completedamount_ungleich_null = 0, fees_ungleich_null = 0,
-- tip_ungleich_null = 0. Dann verfaelschen die AUTHORIZED-Zeilen die
-- bestehenden Summen (brutto_gross, transaction_fee_total, netto, tip_total)
-- nicht, und der Schutz in SPEC §2.3 muss nur die Zaehler betreffen. Liegt
-- eine der drei Zahlen ueber 0, brauchen auch die Summen einen CASE-Guard.
-- Das Trinkgeld-CTE ist bewusst wie tipCte in der App gebaut (vor-aggregiert,
-- LEFT JOIN) - lineitem nie direkt joinen.
-- ---------------------------------------------------------------------------
SELECT
    count(*)                                                          AS anzahl_authorized,
    SUM(t.authorizationamount)                                        AS summe_autorisiert,
    SUM(CASE WHEN t.completedamount IS NOT NULL AND t.completedamount <> 0 THEN 1 ELSE 0 END)
                                                                      AS completedamount_ungleich_null,
    SUM(CASE WHEN t.totalappliedfees IS NOT NULL AND t.totalappliedfees <> 0 THEN 1 ELSE 0 END)
                                                                      AS fees_ungleich_null,
    SUM(CASE WHEN tip.tip_amount IS NOT NULL AND tip.tip_amount <> 0 THEN 1 ELSE 0 END)
                                                                      AS tip_ungleich_null,
    SUM(CASE WHEN psr.transaction_id IS NOT NULL THEN 1 ELSE 0 END)   AS mit_settlement_record,
    SUM(CASE WHEN t.totalsettledamount IS NOT NULL AND t.totalsettledamount <> 0 THEN 1 ELSE 0 END)
                                                                      AS settledamount_ungleich_null
FROM transaction t
LEFT JOIN (
    SELECT tl.transaction_id, SUM(li.amountincludingtax) AS tip_amount
    FROM transaction_lineitem tl
    JOIN lineitem li ON li.id = tl.lineitems_id AND li.spaceid = tl.spaceid
    WHERE tl.spaceid = <SPACE_ID>
      AND li.type = 'TIP'
    GROUP BY tl.transaction_id
) tip ON tip.transaction_id = t.id
LEFT JOIN (
    SELECT DISTINCT psr.transaction_id
    FROM payfacsettlementrecord psr
) psr ON psr.transaction_id = t.id
WHERE t.spaceid = <SPACE_ID>
  AND t.createdon >= current_timestamp - INTERVAL '90' DAY
  AND t.state = 'AUTHORIZED';


-- ---------------------------------------------------------------------------
-- Q5: AUTHORIZED - Terminal und Connector-Konfiguration gesetzt?
--
-- Der Terminal-Report gruppiert nach paymentterminal.identifier und nach dem
-- Connector-Namen. Fehlt bei einer AUTHORIZED-Transaktion terminal_id oder
-- paymentconnectorconfiguration_id, landet sie nicht unter ihrem Terminal bzw.
-- als Brand 'UNKNOWN' - dann waere SPEC A2 nicht erfuellbar. Erwartung: beide
-- _null-Spalten = 0 (am POS).
-- ---------------------------------------------------------------------------
SELECT
    t.state,
    count(*)                                                          AS anzahl,
    SUM(CASE WHEN t.terminal_id IS NULL THEN 1 ELSE 0 END)            AS terminal_null,
    SUM(CASE WHEN t.paymentconnectorconfiguration_id IS NULL THEN 1 ELSE 0 END)
                                                                      AS connector_null,
    SUM(CASE WHEN pt.id IS NULL THEN 1 ELSE 0 END)                    AS terminal_ohne_treffer
FROM transaction t
LEFT JOIN paymentterminal pt
       ON pt.id      = t.terminal_id
      AND pt.spaceid = t.spaceid
WHERE t.spaceid = <SPACE_ID>
  AND t.createdon >= current_timestamp - INTERVAL '90' DAY
  AND t.state IN ('AUTHORIZED', 'FULFILL', 'COMPLETED')
GROUP BY t.state
ORDER BY t.state;
