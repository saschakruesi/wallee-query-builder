-- Iteration 3 (v5.15), Stufe 1 der Selbstpruefung (Terminal-Report-Tool/SPEC-ITERATION-3.md §6):
-- Rohexport der Transaktionen eines Space mit ALLEN Zeitstempeln und Zustaenden, um den
-- Autorisierungszeitpunkt gegen den wallee Financial Report ("Trans Date/Time") zu beweisen.
-- Gelaufen am 2026-09-15 an Space 73192 (Kaufleuten), 09.09. 12:00 - 12.09. 12:00; Befunde in
-- CLAUDE.md unter "Wallee-Referenzwissen" > "Autorisierungszeitpunkt (v5.15)".
--
-- Im Portal einzeln ausfuehren (Space-ID und Fenster anpassen). Das Fenster liegt hier bewusst
-- breit auf createdon und OHNE State-Filter: es soll zeigen, welche Zeitstempel bei welchem
-- Zustand gefuellt sind (authorizedon fehlt bei FAILED, completedon bei AUTHORIZED/FAILED).
WITH tx AS (
    SELECT t.id
    FROM transaction t
    WHERE t.spaceid = 73192
      AND t.createdon >= TIMESTAMP '2026-09-09 12:00:00'
      AND t.createdon <  TIMESTAMP '2026-09-12 12:00:00'
),
tip AS (
    SELECT
        tl.transaction_id,
        SUM(li.amountincludingtax) AS tip_amount
    FROM transaction_lineitem tl
    JOIN lineitem li
      ON li.id      = tl.lineitems_id
     AND li.spaceid = tl.spaceid
    WHERE tl.spaceid = 73192
      AND li.type = 'TIP'
      AND tl.transaction_id IN (SELECT id FROM tx)
    GROUP BY tl.transaction_id
)
SELECT
    t.id                                            AS transaction_id,
    pt.identifier                                   AS tid,
    pt.name                                         AS terminal_name,
    COALESCE(pc.name['en-US'], pcc.name, 'UNKNOWN') AS brand,
    t.state                                         AS state,
    t.createdon                                     AS createdOn,
    t.authorizedon                                  AS authorizedOn,
    t.completedon                                   AS completedOn,
    t.failedon                                      AS failedOn,
    t.authorizationamount                           AS authorizedAmount,
    t.completedamount                               AS completedAmount,
    COALESCE(tip.tip_amount, 0)                     AS tipAmount,
    t.currency                                      AS currency
FROM transaction t
LEFT JOIN paymentconnectorconfiguration pcc
       ON pcc.id      = t.paymentconnectorconfiguration_id
      AND pcc.spaceid = t.spaceid
LEFT JOIN paymentconnector pc
       ON pc.id       = pcc.connector
LEFT JOIN paymentterminal pt
       ON pt.id       = t.terminal_id
      AND pt.spaceid  = t.spaceid
LEFT JOIN tip ON tip.transaction_id = t.id
WHERE t.spaceid = 73192
  AND t.createdon >= TIMESTAMP '2026-09-09 12:00:00'
  AND t.createdon <  TIMESTAMP '2026-09-12 12:00:00'
ORDER BY t.createdon;
