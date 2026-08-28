-- =============================================================================
-- Reporting-Modus · Task 1: Referenz-Query mit Terminal-Aufschluesselung
--
-- Zweite Form derselben Query (buildReportingQuery), generiert mit:
--   spaceIds   = ['40402']            (POS-Referenz-Space - nur dort gibt es Terminals)
--   start      = 2026-07-01 00:00:00
--   end        = 2026-08-01 00:00:00  (exklusiv)
--   channels   = []                   (keine Kanalwahl = alle)
--   byTerminal = true                 (LEFT JOIN paymentterminal, Terminal-Spalten im DIM-Block)
--   terminalIds= []                   (kein Terminal-Filter)
--
-- Zweck: EINMAL im Portal ausfuehren, zusammen mit 01_reporting_reference.sql.
-- Diese Variante deckt ab, was die erste nicht kann: den Join ueber
-- ca.terminal_id (die Spalte steht in SPEC 3.1, ist aber in Task 0 in keiner
-- Query vorgekommen - die uebrigen Modi joinen t.terminal_id auf transaction)
-- sowie die beiden zusaetzlichen DIM-Spalten im UNION ALL.
--
-- Erwartet: dieselben drei Bloecke, im DIM-Block zusaetzlich
-- terminal_identifier / terminal_name (nur bei POS-Zeilen gefuellt).
-- Nicht von Hand editieren - bei Aenderungen am Builder neu generieren.
-- =============================================================================

WITH att AS (
    -- Eine Zeile pro Charge Attempt. Alle abgeleiteten Spalten entstehen hier
    -- einmal, die drei Bloecke unten aggregieren nur noch darueber.
    SELECT
        ca.spaceid                                      AS space_id,
        CASE ca.saleschannel
            WHEN 1582819151330 THEN 'POS'
            WHEN 1582816223150 THEN 'ECOM'
            ELSE 'OTHER'
        END                                             AS channel,
        -- Brand ueber ca.connectorconfiguration (die Konfiguration DIESES
        -- Versuchs), NICHT ueber die Konfiguration der Transaktion wie in den
        -- Modi brand/terminal: bei einem Retry mit anderer Zahlungsmethode
        -- waere der Attempt sonst der falschen Brand zugeordnet.
        COALESCE(pc.name['en-US'], pcc.name, 'UNKNOWN') AS brand,
        COALESCE(wt.name['en-US'], '-')                 AS wallet,
        t.currency                                      AS waehrung,
        ca.state                                        AS attempt_state,
        ca.failurereason                                AS failure_reason_id,
        -- Feinerer Ablehngrund als failurereason: am POS der ISO-8583-Code des
        -- Issuers, im E-Commerce der Response Code des Processors. Ein Attempt
        -- traegt immer nur eines der beiden Labels.
        COALESCE(element_at(filter(ca.labels, l -> l['descriptor'] = '1579287790513'), 1)['shortTextContent'],
                 element_at(filter(ca.labels, l -> l['descriptor'] = '15537739985478'), 1)['shortTextContent']) AS auth_response_code,
        element_at(filter(ca.labels, l -> l['descriptor'] = '1474552618629'), 1)['countryContent'] AS issuer_country,
        element_at(filter(ca.labels, l -> l['descriptor'] = '1474552618999'), 1)['shortTextContent'] AS card_category,
        element_at(filter(ca.labels, l -> l['descriptor'] = '1474552618699'), 1)['shortTextContent'] AS funding,
        element_at(filter(ca.labels, l -> l['descriptor'] = '1634723429555'), 1)['shortTextContent'] AS pan_type,
        element_at(filter(ca.labels, l -> l['descriptor'] = '1695119783358'), 1)['shortTextContent'] IS NOT NULL AS dcc,
        element_at(filter(ca.labels, l -> l['descriptor'] = '1568637480278'), 1)['dateTimeContent'] IS NOT NULL AS tds_started,
        -- CAVV nur als Existenzpruefung: das Kryptogramm selbst ist ein
        -- Sicherheitsmerkmal und darf nie in eine Ausgabespalte geraten.
        element_at(filter(ca.labels, l -> l['descriptor'] = '1569496536590'), 1)['longTextContent'] IS NOT NULL AS tds_cavv,
        element_at(filter(ca.labels, l -> l['descriptor'] = '1634723429552'), 1)['shortTextContent'] AS eci,
        -- Betrag nur bei erfolgreichen Attempts (bei FAILED ist completedamount
        -- 0); der abgelehnte Betrag kommt aus authorizationamount, das auch bei
        -- FAILED gefuellt ist (Task 0, Q6).
        CASE WHEN ca.state = 'SUCCESSFUL' THEN t.completedamount     END AS amount,
        CASE WHEN ca.state = 'FAILED'     THEN t.authorizationamount END AS amount_failed,
        CASE WHEN ca.state = 'SUCCESSFUL' THEN t.refundedamount      END AS refund,
        t.id                                            AS transaction_id,
        ca.createdon                                    AS created_on,
        pt.identifier                                   AS terminal_identifier,
        pt.name                                         AS terminal_name
    FROM chargeattempt ca
    JOIN charge c
      ON c.id      = ca.charge_id
    JOIN transaction t
      ON t.id      = c.transaction_id
     AND t.spaceid = ca.spaceid
    LEFT JOIN paymentconnectorconfiguration pcc
           ON pcc.id      = ca.connectorconfiguration
          AND pcc.spaceid = ca.spaceid
    LEFT JOIN paymentconnector pc
           ON pc.id       = pcc.connector
    LEFT JOIN wallettype wt
           ON wt.id       = ca.wallet
    LEFT JOIN paymentterminal pt
           ON pt.id      = ca.terminal_id
          AND pt.spaceid = ca.spaceid
    WHERE ca.spaceid = 40402
      AND ca.createdon >= TIMESTAMP '2026-07-01 00:00:00'
      AND ca.createdon <  TIMESTAMP '2026-08-01 00:00:00'
      AND ca.environment = 'PRODUCTION'
)
SELECT
    'DIM'                                           AS block,
    space_id,
    channel,
    brand,
    wallet,
    waehrung,
    attempt_state,
    -- Explizit auf varchar: der Typ von chargeattempt.failurereason ist nicht
    -- belegt (Task 0 las ihn aus CSV, das beweist nichts). Bliebe er der
    -- Herleitung ueberlassen und waere varchar, faende Presto gegen die
    -- bigint-Platzhalter der anderen Bloecke keinen gemeinsamen Supertyp und
    -- die GANZE Query scheiterte. Die ID ist ohnehin nur ein Nachschlage-
    -- schluessel (SPEC 6.4), nie ein Rechenwert.
    CAST(failure_reason_id AS varchar)              AS failure_reason_id,
    auth_response_code,
    issuer_country,
    card_category,
    funding,
    pan_type,
    dcc,
    tds_started,
    tds_cavv,
    eci,
    terminal_identifier,
    terminal_name,
    CAST(NULL AS date)                              AS tag,
    CAST(NULL AS integer)                           AS stunde,
    COUNT(*)                                        AS anzahl_attempts,
    COUNT(DISTINCT transaction_id)                  AS anzahl_transaktionen,
    CAST(SUM(amount) AS decimal(38,8))              AS summe_betrag,
    CAST(SUM(amount_failed) AS decimal(38,8))       AS summe_betrag_failed,
    -- Bewusst in Kauf genommene Ungenauigkeit (SPEC 3.2): refundedamount haengt
    -- an der TRANSAKTION, nicht am Attempt. Fallen mehrere erfolgreiche
    -- Attempts derselben Transaktion in dasselbe DIM-Tupel, zaehlt der Refund
    -- mehrfach. Die Refund-Quote ist damit eine Obergrenze - am POS praktisch
    -- exakt (Task 0: 12'507 von 12'522 Transaktionen mit genau einem Attempt).
    -- Dasselbe gilt fuer summe_betrag_failed: jeder gescheiterte Versuch
    -- derselben Transaktion addiert authorizationamount erneut, und genau das
    -- ist im E-Commerce mit Retries der Normalfall. Nur summe_betrag ist exakt
    -- (pro Transaktion gibt es hoechstens einen erfolgreichen Attempt).
    CAST(SUM(refund) AS decimal(38,8))              AS summe_refund,
    CAST(NULL AS bigint)                            AS tx_mit_attempt,
    CAST(NULL AS bigint)                            AS tx_erfolgreich
FROM att
GROUP BY
    space_id, channel, brand, wallet, waehrung, attempt_state,
    failure_reason_id, auth_response_code, issuer_country, card_category,
    funding, pan_type, dcc, tds_started, tds_cavv, eci, terminal_identifier, terminal_name

UNION ALL

SELECT
    'TIME'                                          AS block,
    space_id,
    channel,
    brand,
    CAST(NULL AS varchar)                           AS wallet,
    waehrung,
    attempt_state,
    CAST(NULL AS varchar)                           AS failure_reason_id,
    CAST(NULL AS varchar)                           AS auth_response_code,
    CAST(NULL AS varchar)                           AS issuer_country,
    CAST(NULL AS varchar)                           AS card_category,
    CAST(NULL AS varchar)                           AS funding,
    CAST(NULL AS varchar)                           AS pan_type,
    CAST(NULL AS boolean)                           AS dcc,
    CAST(NULL AS boolean)                           AS tds_started,
    CAST(NULL AS boolean)                           AS tds_cavv,
    CAST(NULL AS varchar)                           AS eci,
    CAST(NULL AS varchar)                           AS terminal_identifier,
    CAST(NULL AS varchar)                           AS terminal_name,
    date(created_on)                                AS tag,
    CAST(hour(created_on) AS integer)               AS stunde,
    COUNT(*)                                        AS anzahl_attempts,
    CAST(NULL AS bigint)                            AS anzahl_transaktionen,
    CAST(SUM(amount) AS decimal(38,8))              AS summe_betrag,
    CAST(NULL AS decimal(38,8))                     AS summe_betrag_failed,
    CAST(NULL AS decimal(38,8))                     AS summe_refund,
    CAST(NULL AS bigint)                            AS tx_mit_attempt,
    CAST(NULL AS bigint)                            AS tx_erfolgreich
FROM att
GROUP BY
    space_id, channel, brand, waehrung, attempt_state,
    date(created_on), CAST(hour(created_on) AS integer)

UNION ALL

SELECT
    'CONV'                                          AS block,
    space_id,
    channel,
    brand,
    CAST(NULL AS varchar)                           AS wallet,
    waehrung,
    CAST(NULL AS varchar)                           AS attempt_state,
    CAST(NULL AS varchar)                           AS failure_reason_id,
    CAST(NULL AS varchar)                           AS auth_response_code,
    CAST(NULL AS varchar)                           AS issuer_country,
    CAST(NULL AS varchar)                           AS card_category,
    CAST(NULL AS varchar)                           AS funding,
    CAST(NULL AS varchar)                           AS pan_type,
    CAST(NULL AS boolean)                           AS dcc,
    CAST(NULL AS boolean)                           AS tds_started,
    CAST(NULL AS boolean)                           AS tds_cavv,
    CAST(NULL AS varchar)                           AS eci,
    CAST(NULL AS varchar)                           AS terminal_identifier,
    CAST(NULL AS varchar)                           AS terminal_name,
    CAST(NULL AS date)                              AS tag,
    CAST(NULL AS integer)                           AS stunde,
    CAST(NULL AS bigint)                            AS anzahl_attempts,
    CAST(NULL AS bigint)                            AS anzahl_transaktionen,
    CAST(NULL AS decimal(38,8))                     AS summe_betrag,
    CAST(NULL AS decimal(38,8))                     AS summe_betrag_failed,
    CAST(NULL AS decimal(38,8))                     AS summe_refund,
    -- COUNT(DISTINCT) gehoert in einen eigenen Block: ueber DIM-Tupel hinweg
    -- ist er nicht summierbar, weil dieselbe Transaktion in mehreren Tupeln
    -- steckt (Retry mit anderer Zahlungsmethode).
    COUNT(DISTINCT transaction_id)                  AS tx_mit_attempt,
    COUNT(DISTINCT CASE WHEN attempt_state = 'SUCCESSFUL' THEN transaction_id END) AS tx_erfolgreich
FROM att
GROUP BY
    space_id, channel, brand, waehrung

ORDER BY block, channel, anzahl_attempts DESC;
