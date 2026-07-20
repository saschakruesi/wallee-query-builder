-- Verifikations-Queries fuer die offenen Settlement-Annahmen des Query Builders.
--
-- Diese vier Queries klaeren, was sich aus dem Analytics-Schema allein nicht
-- ableiten laesst. Jede beantwortet genau eine Frage, die heute im Generator als
-- Annahme steckt. Einzeln ausfuehren, Ergebnis-CSV zurueckmelden.
--
-- Vor dem Ausfuehren: <SPACE_ID>, <START> und <ENDE> ersetzen.
-- Zeitraum bewusst grosszuegig waehlen (mehrere Wochen), damit auch die
-- langsameren Auszahlungslaeufe im Ergebnis auftauchen.
--
-- Alle Queries sind ueber die Transaktionen des Zeitraums eingegrenzt. Das ist
-- Absicht: ein ungebremster Join gegen banktransaction oder
-- currentaccountwithdrawal war die Ursache des frueheren Timeouts.


-- =====================================================================
-- (1) Welche Zustaende hat banktransaction wirklich - und hat valuedate
--     bei nicht ausbezahlten Records ueberhaupt einen Wert?
-- =====================================================================
--
-- Warum das zaehlt:
--   Der Settlement-Modus zeigt SETTLED, UPCOMING, PARTIAL und NO_RECORD.
--   'UPCOMING' ist eine Annahme - der tatsaechliche Wert ist unbestaetigt.
--   Ausserdem behandelt der Generator jeden Zustand ungleich 'SETTLED' als
--   "noch nicht ausbezahlt". Gibt es weitere Zustaende (etwa fehlgeschlagene
--   oder stornierte), waeren die dort faelschlich einsortiert.
--
-- Lesart:
--   Spalte 'ohne_valuedate' > 0 bei einem nicht-SETTLED-Zustand bestaetigt,
--   warum der Generator settlement_state NICHT mehr ueber
--   max_by(bt.state, bt.valuedate) bestimmt: Presto ignoriert dort Zeilen mit
--   NULL im Sortierfeld, wodurch ausgerechnet SETTLED gewonnen haette und eine
--   offene Auszahlung unsichtbar geworden waere.

SELECT
    bt.state                                       AS zustand,
    count(*)                                       AS anzahl,
    count(bt.valuedate)                            AS mit_valuedate,
    count(*) - count(bt.valuedate)                 AS ohne_valuedate,
    min(bt.valuedate)                              AS frueheste_valuta,
    max(bt.valuedate)                              AS spaeteste_valuta
FROM payfacsettlementrecord psr
JOIN banktransaction bt
  ON bt.id = psr.banktransaction_id
WHERE psr.transaction_id IN (
    SELECT t.id
    FROM transaction t
    WHERE t.spaceid = <SPACE_ID>
      AND t.completedon >= TIMESTAMP '<START>'
      AND t.completedon <  TIMESTAMP '<ENDE>'
      AND t.state IN ('FULFILL', 'COMPLETED')
)
GROUP BY bt.state
ORDER BY anzahl DESC;


-- =====================================================================
-- (2) Vorzeichen der Settlement-Gebuehren
-- =====================================================================
--
-- Warum das zaehlt:
--   Der Generator rechnet processing_fees als (postingamount - valueamount)
--   und nimmt an, dass dabei ein positiver Gebuehrenbetrag herauskommt.
--   Stimmt das Vorzeichen nicht, stehen im CSV des Kunden negative Gebuehren
--   und das Netto ist um den doppelten Betrag daneben.
--
-- Lesart:
--   min_differenz und max_differenz beide >= 0  -> Annahme bestaetigt.
--   Beide <= 0                                  -> Vorzeichen drehen, also
--                                                  (valueamount - postingamount).
--   Gemischte Vorzeichen                        -> genauer hinsehen, dann
--                                                  vermutlich Refunds oder
--                                                  Korrekturen im Spiel.

SELECT
    bt.state                                       AS zustand,
    count(*)                                       AS anzahl,
    sum(bt.postingamount)                          AS summe_postingamount,
    sum(bt.valueamount)                            AS summe_valueamount,
    sum(bt.postingamount - bt.valueamount)         AS summe_differenz,
    min(bt.postingamount - bt.valueamount)         AS min_differenz,
    max(bt.postingamount - bt.valueamount)         AS max_differenz,
    count_if(bt.postingamount - bt.valueamount < 0) AS anzahl_negativ,
    count_if(bt.postingamount - bt.valueamount = 0) AS anzahl_null
FROM payfacsettlementrecord psr
JOIN banktransaction bt
  ON bt.id = psr.banktransaction_id
WHERE psr.transaction_id IN (
    SELECT t.id
    FROM transaction t
    WHERE t.spaceid = <SPACE_ID>
      AND t.completedon >= TIMESTAMP '<START>'
      AND t.completedon <  TIMESTAMP '<ENDE>'
      AND t.state IN ('FULFILL', 'COMPLETED')
)
GROUP BY bt.state
ORDER BY anzahl DESC;


-- =====================================================================
-- (3) Wie lange dauert es real vom Valutadatum bis zur Auszahlung?
-- =====================================================================
--
-- Warum das zaehlt:
--   Die Spalte settlement_reference ordnet einer Transaktion die Auszahlung
--   ueber ein Zeitfenster von 30 Tagen zu - eine reine Annahme, weil es keinen
--   direkten Fremdschluessel von der Banktransaktion zur Auszahlung gibt.
--   Ist das Fenster zu klein, bleibt die Referenz leer. Ist es zu gross, wird
--   die Query unnoetig teuer und ordnet im Zweifel falsch zu.
--
-- Lesart:
--   Die Verteilung zeigt, wo die Masse liegt. Sind praktisch alle Faelle
--   innerhalb weniger Tage, kann das Fenster deutlich enger gesetzt werden -
--   das macht die Query spuerbar schneller. Reichen einzelne Faelle ueber
--   30 Tage hinaus, muss es im Gegenteil groesser werden.
--
-- Hinweis: Diese Query bildet bewusst denselben Range-Join ab wie der
--   Generator, damit das Ergebnis uebertragbar ist. Sie ist deshalb die
--   teuerste der vier - zuerst mit einem kurzen Zeitraum testen.

SELECT
    date_diff('day', bt.valuedate, w.createdon)    AS tage_bis_auszahlung,
    count(*)                                       AS anzahl
FROM payfacsettlementrecord psr
JOIN banktransaction bt
  ON bt.id = psr.banktransaction_id
 AND bt.state = 'SETTLED'
JOIN currentaccountwithdrawal w
  ON w.createdon >= bt.valuedate
 AND w.createdon <  bt.valuedate + INTERVAL '90' DAY   -- bewusst weiter als die
                                                       -- 30 Tage des Generators,
                                                       -- um den Ueberhang zu sehen
WHERE psr.transaction_id IN (
    SELECT t.id
    FROM transaction t
    WHERE t.spaceid = <SPACE_ID>
      AND t.completedon >= TIMESTAMP '<START>'
      AND t.completedon <  TIMESTAMP '<ENDE>'
      AND t.state IN ('FULFILL', 'COMPLETED')
)
GROUP BY date_diff('day', bt.valuedate, w.createdon)
ORDER BY tage_bis_auszahlung;


-- =====================================================================
-- (4) Wie oft hat eine Transaktion mehrere Settlement-Records?
-- =====================================================================
--
-- Warum das zaehlt:
--   Der Generator aggregiert Settlement-Records pro Transaktion vor, bevor er
--   an transaction joint. Ohne diese Vor-Aggregation wuerden Transaktionen mit
--   mehreren Records doppelt gezaehlt und Umsatz sowie Gebuehren waeren zu hoch.
--   Diese Query zeigt, ob und wie haeufig der Fall real vorkommt.
--
-- Lesart:
--   Nur eine Zeile mit anzahl_records = 1  -> im geprueften Zeitraum kein
--                                             Mehrfachfall aufgetreten; die
--                                             Vor-Aggregation schadet nicht.
--   Zeilen mit anzahl_records > 1          -> die Vor-Aggregation war zwingend
--                                             noetig, und die Spalte
--                                             anzahl_settlement_records im
--                                             Settlement-Modus zeigt es an.

SELECT
    anzahl_records                                 AS records_pro_transaktion,
    count(*)                                       AS anzahl_transaktionen
FROM (
    SELECT
        psr.transaction_id,
        count(*) AS anzahl_records
    FROM payfacsettlementrecord psr
    WHERE psr.transaction_id IN (
        SELECT t.id
        FROM transaction t
        WHERE t.spaceid = <SPACE_ID>
          AND t.completedon >= TIMESTAMP '<START>'
          AND t.completedon <  TIMESTAMP '<ENDE>'
          AND t.state IN ('FULFILL', 'COMPLETED')
    )
    GROUP BY psr.transaction_id
)
GROUP BY anzahl_records
ORDER BY records_pro_transaktion;
