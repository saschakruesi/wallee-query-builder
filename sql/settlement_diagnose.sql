-- BITTE JEDE ABFRAGE EINZELN AUSFUEHREN (nur den Text einer Abfrage markieren
-- und laufen lassen - NICHT die ganze Datei auf einmal).


-- Q1: Gibt es ueberhaupt Settlement-Records fuer die Mai-Transaktionen
--     dieses Accounts (egal unter welcher Space-ID)?
--     Ergebnis 0  -> es existieren keine Settlement-Records -> Datum/Referenz
--                    koennen nicht ausgegeben werden (Auszahlung noch nicht
--                    verbucht oder Verknuepfung laeuft anders).
--     Ergebnis >0 -> Records existieren -> weiter mit Q2.
SELECT count(*) AS settle_records
FROM payfacsettlementrecord psr
WHERE psr.transaction_id IN (
    SELECT t.id FROM transaction t
    WHERE t.spaceid = <SPACE_ID>
      AND t.completedon >= TIMESTAMP '2026-05-01 00:00:00'
      AND t.completedon <  TIMESTAMP '2026-05-31 23:59:59'
      AND t.state IN ('FULFILL','COMPLETED')
);


-- Q2: Falls Q1 > 0 - sind reference und paymentdate auf der banktransaction
--     ueberhaupt gefuellt? Wenn hier leer -> die Felder werden auf diesem Pfad
--     nicht gespeichert (-> wir brauchen die richtigen Spalten, siehe Q3).
SELECT psr.transaction_id, bt.id AS banktransaction_id, bt.reference, bt.paymentdate
FROM payfacsettlementrecord psr
JOIN banktransaction bt ON bt.id = psr.banktransaction_id
WHERE psr.transaction_id IN (
    SELECT t.id FROM transaction t
    WHERE t.spaceid = <SPACE_ID>
      AND t.completedon >= TIMESTAMP '2026-05-01 00:00:00'
      AND t.completedon <  TIMESTAMP '2026-05-31 23:59:59'
      AND t.state IN ('FULFILL','COMPLETED')
)
LIMIT 50;


-- Q3: Welche Spalten hat banktransaction wirklich? (Falls paymentdate/reference
--     gar nicht die richtigen Feldnamen sind - z.B. valuedate, bookingdate,
--     paymentreference, endtoendreference o.ae.)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'banktransaction'
ORDER BY ordinal_position;
