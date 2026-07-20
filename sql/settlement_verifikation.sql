-- Verifikations-Queries fuer die Settlement-Annahmen des Query Builders.
--
-- Diese fuenf Queries klaeren, was sich aus dem Analytics-Schema allein nicht
-- ableiten laesst. Jede beantwortet genau eine Frage, die im Generator als
-- Annahme steckt (oder steckte - siehe Kommentare bei (1), (2) und (4)).
-- Einzeln ausfuehren, Ergebnis-CSV zurueckmelden.
--
-- Vor dem Ausfuehren: <SPACE_ID>, <START> und <ENDE> ersetzen.
-- Zeitraum bewusst grosszuegig waehlen (mehrere Wochen), damit auch die
-- langsameren Auszahlungslaeufe im Ergebnis auftauchen.
--
-- Alle Queries sind ueber die Transaktionen des Zeitraums eingegrenzt. Das ist
-- Absicht: ein ungebremster Join gegen banktransaction oder
-- currentaccountwithdrawal war die Ursache eines frueheren Timeouts.
--
-- WICHTIG bei der Interpretation neuer Ergebnisse: Jeder bisherige Lauf deckt
-- genau einen Space ueber genau einen Zeitraum ab. "Bisher beobachtet" heisst
-- nicht "gibt es nicht" - ein anderer Acquirer oder Space kann sich anders
-- verhalten. Ergebnisse entsprechend vorsichtig einordnen, bevor sie als
-- generelle Aussage in die Doku wandern.


-- =====================================================================
-- (1) Welche Zustaende hat banktransaction wirklich - und hat valuedate
--     bei nicht ausbezahlten Records ueberhaupt einen Wert?
-- =====================================================================
--
-- Warum das zaehlt:
--   Der Settlement-Modus zeigt SETTLED, UPCOMING, PARTIAL und NO_RECORD.
--   Ausserdem behandelt der Generator jeden Zustand ungleich 'SETTLED' als
--   "noch nicht ausbezahlt". Gibt es weitere Zustaende (etwa fehlgeschlagene
--   oder stornierte), waeren die dort faelschlich einsortiert.
--
-- Bisheriger Befund (ein Space, ein Zeitraum von mehreren Wochen):
--   Es kam ausschliesslich der Zustand SETTLED vor, kein UPCOMING und kein
--   anderer Wert. Alle Records hatten ein gefuelltes valuedate, keiner war
--   leer. Das deutet darauf hin, dass ein payfacsettlementrecord erst
--   entsteht, wenn tatsaechlich abgerechnet wurde - eine Transaktion, die
--   noch auf ihre Auszahlung wartet, haette demnach ueberhaupt keinen Record
--   und erschiene im Settlement-Modus als NO_RECORD, nicht als UPCOMING.
--   UPCOMING und PARTIAL bleiben im Generator dennoch als moegliche Werte
--   vorgesehen, falls ein anderer Space oder Acquirer sich anders verhaelt.
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
-- Bisheriger Befund (ein Space, ein Zeitraum von mehreren Wochen):
--   (postingamount - valueamount) war ausnahmslos positiv - keine negativen
--   und keine Null-Werte. Die Formel im Generator gilt damit als bestaetigt.
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
-- Vorherige Fassung lief ins Timeout:
--   Die Bedingung auf w war ausschliesslich korreliert (abhaengig von
--   bt.valuedate). Ohne ein absolutes, konstantes Praedikat auf
--   w.createdon kann der Optimizer currentaccountwithdrawal nicht per
--   Partition beschneiden und scannt die ganze Tabelle - das liess diese
--   Query selbst bei nur einer Woche Transaktionen ins Timeout laufen.
--   Deshalb hier, analog zum payoutref-CTE im Generator, zusaetzlich ein
--   absolutes Zeitfenster aus dem Berichtszeitraum, sowie das Messfenster
--   von vormals 90 auf 45 Tage reduziert (genuegt, um den Ueberhang zu
--   sehen, haelt die Query aber deutlich guenstiger).
--
-- Lesart:
--   Die Verteilung zeigt, wo die Masse liegt. Sind praktisch alle Faelle
--   innerhalb weniger Tage, kann das Fenster im Generator deutlich enger
--   gesetzt werden - das macht die Query spuerbar schneller. Reichen
--   einzelne Faelle ueber 30 Tage hinaus, muss es im Gegenteil groesser
--   werden.

SELECT
    date_diff('day', bt.valuedate, w.createdon)    AS tage_bis_auszahlung,
    count(*)                                       AS anzahl
FROM payfacsettlementrecord psr
JOIN banktransaction bt
  ON bt.id = psr.banktransaction_id
 AND bt.state = 'SETTLED'
JOIN currentaccountwithdrawal w
  ON w.createdon >= bt.valuedate
 AND w.createdon <  bt.valuedate + INTERVAL '45' DAY        -- bewusst weiter als
                                                              -- die 30 Tage des
                                                              -- Generators, um den
                                                              -- Ueberhang zu sehen
 AND w.createdon >= TIMESTAMP '<START>'                      -- absolutes Fenster,
 AND w.createdon <  TIMESTAMP '<ENDE>' + INTERVAL '45' DAY   -- fuer den Optimizer
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
-- Bisheriger Befund (ein Space, ein Zeitraum von mehreren Wochen):
--   Jede Transaktion hatte genau einen Settlement-Record - kein Mehrfachfall
--   aufgetreten. Die Vor-Aggregation war in diesem Zeitraum also nicht noetig,
--   bleibt aber bewusst bestehen: Refunds aus einem spaeteren Settlement-Lauf
--   sind weiterhin denkbar, und ein anderer Space kann sich anders verhalten.
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
    count(*)                                        AS anzahl_transaktionen
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


-- =====================================================================
-- (5) Wie viele Transaktionen des Zeitraums haben ueberhaupt keinen
--     Settlement-Record?
-- =====================================================================
--
-- Warum das zaehlt:
--   (1) legt nahe, dass ein payfacsettlementrecord erst entsteht, wenn
--   tatsaechlich abgerechnet wurde - "noch nicht ausbezahlt" zeigt sich also
--   als NO_RECORD, nicht als UPCOMING. Diese Query beantwortet den bisher
--   unbekannten Anteil dahinter: wie viele Transaktionen des Zeitraums haben
--   ueberhaupt (noch) keinen Settlement-Record. Das ist die eigentliche
--   Kennzahl fuer "noch nicht abgerechnet".
--
-- Bewusst als voraggregierte Existenzpruefung (analog zu settleExistsCte im
-- Generator) statt als direkter Join: payfacsettlementrecord ist N:1 zur
-- Transaktion, ein direkter Join wuerde Transaktionen mit mehreren Records
-- vervielfachen und die Zaehlung verfaelschen.
--
-- Lesart:
--   anzahl_ohne_record ins Verhaeltnis zu anzahl_transaktionen setzen - das
--   ist der Anteil, der im Settlement-Modus als NO_RECORD erscheint.

WITH tx AS (
    SELECT t.id
    FROM transaction t
    WHERE t.spaceid = <SPACE_ID>
      AND t.completedon >= TIMESTAMP '<START>'
      AND t.completedon <  TIMESTAMP '<ENDE>'
      AND t.state IN ('FULFILL', 'COMPLETED')
),
settle_exists AS (
    SELECT DISTINCT psr.transaction_id
    FROM payfacsettlementrecord psr
    WHERE psr.transaction_id IN (SELECT id FROM tx)
)
SELECT
    count(*)                                       AS anzahl_transaktionen,
    count(se.transaction_id)                       AS anzahl_mit_record,
    count(*) - count(se.transaction_id)            AS anzahl_ohne_record
FROM tx t
LEFT JOIN settle_exists se
       ON se.transaction_id = t.id;
