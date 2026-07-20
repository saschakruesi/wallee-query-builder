-- Verifikations-Queries fuer die Trinkgeld-Frage (Erweiterung 1, siehe CLAUDE.md).
--
-- Bereits geklaert: Das Trinkgeld (lineitem.type = 'TIP') ist im completedamount der
-- Transaktion bereits enthalten (nicht additiv). Das ist an Produktivdaten geprueft
-- und bestaetigt (siehe CLAUDE.md, Abschnitt "Wallee-Referenzwissen"). Die beiden
-- Queries unten dienen der erneuten Gegenpruefung, z. B. in einem anderen Space oder
-- nach Schema-Aenderungen.
--
-- <SPACE_ID> durch die zu pruefende Space-ID ersetzen. Jede Query einzeln im
-- wallee-Portal unter Account > Analytics > Submit Query ausfuehren.


-- (a) Welche lineitem.type-Werte kommen im Space vor, und mit welchen Summen?
-- Bestaetigt (oder widerlegt), dass der Typ 'TIP' tatsaechlich fuer Trinkgeld
-- verwendet wird und wie relevant er volumenmaessig ist.
--
-- WARNUNG: Diese Query filtert BEWUSST nicht nach Zeitraum und scannt damit die
-- gesamte lineitem-Historie des Space (im Unterschied zu jeder anderen Query in
-- diesem Projekt, die immer auf transaction.completedon eingrenzt). Grund: das
-- Ziel ist ein Ueberblick ueber alle jemals vorgekommenen lineitem.type-Werte,
-- nicht nur die eines Zeitfensters. Auf grossen Spaces ist das entsprechend
-- teuer/langsam. Falls das ein Problem ist, entweder per JOIN auf
-- transaction_lineitem/transaction zeitlich eingrenzen (wie in Query (b) unten)
-- oder zuerst an einem kleinen/Pilot-Space ausfuehren.
SELECT
    li.type,
    count(*)                    AS anzahl_lineitems,
    sum(li.amountincludingtax)  AS summe
FROM lineitem li
WHERE li.spaceid = <SPACE_ID>
GROUP BY li.type
ORDER BY anzahl_lineitems DESC;


-- (b) Ist das Trinkgeld im completedamount enthalten, oder ist es additiv?
--
-- lineitems_total = Summe ALLER Line Items einer Transaktion (inkl. TIP).
-- tip             = Summe NUR der TIP-Line-Items.
--
-- Auswertung pro Transaktion:
--   lineitems_total  ≈  t.completedamount            -> Trinkgeld ist im Brutto
--                                                        enthalten (bereits bestaetigt,
--                                                        siehe CLAUDE.md; diese Query
--                                                        dient der Gegenpruefung).
--   lineitems_total + tip  ≈  t.completedamount       -> Trinkgeld waere ZUSÄTZLICH
--                                                        zum Brutto -> in diesem Fall
--                                                        CLAUDE.md / EXPORT_COLUMNS
--                                                        (tip, grossnotip) korrigieren
--                                                        und den bisherigen Befund
--                                                        revidieren.
--
-- Zeitraum/Limit nach Bedarf anpassen - bewusst eng gehalten, damit die Stichprobe
-- schnell durchsuchbar bleibt.
SELECT
    t.id,
    t.completedamount,
    SUM(CASE WHEN li.type = 'TIP' THEN li.amountincludingtax ELSE 0 END) AS tip,
    SUM(li.amountincludingtax)                                          AS lineitems_total,
    t.completedamount - SUM(li.amountincludingtax)                      AS differenz_brutto_zu_lineitems
FROM transaction t
JOIN transaction_lineitem tl ON tl.transaction_id = t.id AND tl.spaceid = t.spaceid
JOIN lineitem li              ON li.id = tl.lineitems_id  AND li.spaceid = tl.spaceid
WHERE t.spaceid = <SPACE_ID>
  AND t.completedon >= TIMESTAMP '2026-07-01 00:00:00'
  AND t.completedon <  TIMESTAMP '2026-07-08 00:00:00'
  AND t.state IN ('FULFILL', 'COMPLETED')
GROUP BY t.id, t.completedamount
HAVING SUM(CASE WHEN li.type = 'TIP' THEN li.amountincludingtax ELSE 0 END) > 0
ORDER BY t.id
LIMIT 50;
