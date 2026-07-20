WITH card AS (
    SELECT
        c.transaction_id,
        max_by(element_at(filter(ca.labels, l -> l['descriptor'] = '1456765125779'), 1)['shortTextContent'], ca.id) AS masked_card,
        max_by(element_at(filter(ca.labels, l -> l['descriptor'] = '1579287795628'), 1)['shortTextContent'], ca.id) AS auth_code
    FROM charge c
    JOIN chargeattempt ca ON ca.charge_id = c.id
    WHERE ca.spaceid = <SPACE_ID>
    GROUP BY c.transaction_id
),
settle AS (
    SELECT
        psr.transaction_id,
        max(bt.valuedate)                         AS auszahlungsdatum,
        max_by(w.internalreference, bt.valuedate) AS settlement_reference
    FROM payfacsettlementrecord psr
    JOIN banktransaction bt
      ON bt.id = psr.banktransaction_id
     AND bt.state = 'SETTLED'
    LEFT JOIN (
        SELECT bt_id, internalreference
        FROM (
            SELECT bt2.id AS bt_id,
                   catw.internalreference,
                   ROW_NUMBER() OVER (PARTITION BY bt2.id ORDER BY catw.createdon) AS rn
            FROM banktransaction bt2
            JOIN currentaccountwithdrawal catw
              ON bt2.valuedate <= catw.createdon
            WHERE bt2.state = 'SETTLED'
        )
        WHERE rn = 1
    ) w ON w.bt_id = bt.id
    WHERE psr.transaction_id IN (
        SELECT t.id
        FROM transaction t
        WHERE t.spaceid = <SPACE_ID>
          AND t.completedon >= TIMESTAMP '2026-05-01 00:00:00'
          AND t.completedon <  TIMESTAMP '2026-05-31 23:59:59'
          AND t.state IN ('FULFILL', 'COMPLETED')
    )
    GROUP BY psr.transaction_id
)
SELECT
    t.spaceid                                                  AS space_id,
    t.createdon                                                AS createdon,
    t.completedon                                              AS completedon,
    t.state                                                    AS state,
    t.currency                                                 AS currency,
    t.completedamount                                          AS gross_amount,
    COALESCE(t.totalappliedfees, 0)                            AS processing_fees,
    t.completedamount - COALESCE(t.totalappliedfees, 0)        AS net_amount,
    COALESCE(pc.name['en-US'], pcc.name, 'UNKNOWN')            AS payment_connector_name,
    pcc.connector                                              AS connector,
    pt.identifier                                              AS terminal_identifier,
    pt.name                                                    AS terminal_name,
    t.terminal_id                                              AS terminal_id,
    t.merchantreference                                        AS merchant_reference,
    settle.auszahlungsdatum                                    AS auszahlungsdatum,
    settle.settlement_reference                                AS settlement_reference,
    card.masked_card                                           AS masked_card,
    card.auth_code                                             AS auth_code
FROM transaction t
LEFT JOIN paymentconnectorconfiguration pcc
       ON pcc.id      = t.paymentconnectorconfiguration_id
      AND pcc.spaceid = t.spaceid
LEFT JOIN paymentconnector pc
       ON pc.id       = pcc.connector
LEFT JOIN paymentterminal pt
       ON pt.id       = t.terminal_id
      AND pt.spaceid  = t.spaceid
LEFT JOIN card   ON card.transaction_id   = t.id
LEFT JOIN settle ON settle.transaction_id = t.id
WHERE t.spaceid = <SPACE_ID>
  AND t.completedon >= TIMESTAMP '2026-05-01 00:00:00'
  AND t.completedon <  TIMESTAMP '2026-05-31 23:59:59'
  AND t.state IN ('FULFILL', 'COMPLETED')
ORDER BY t.spaceid, t.completedon;
