-- =============================================================================
-- Reporting-Modus · Task 0: Discovery
-- Welche Label-Descriptors, States, Environments und Sales Channels kommen auf
-- den Chargeattempts der Ziel-Spaces tatsaechlich vor?
--
-- Jede Query EINZELN unter Account > Analytics > Submit Query ausfuehren
-- (PrestoDB/Athena, Tabellen- und Spaltennamen lowercase).
-- VOR DEM AUSFUEHREN ANPASSEN (in jeder Query, 3 Stellen):
--   ca.spaceid IN (40402)                      -> eigene Space-ID(s), kommagetrennt
--   TIMESTAMP '2026-07-01 00:00:00'            -> Beginn des Zeitraums
--   TIMESTAMP '2026-08-01 00:00:00'            -> Ende (exklusiv)
-- Die Beispielwerte sind gueltiges SQL, die Queries laufen auch unveraendert.
--
-- ACHTUNG: Die Ergebnisse enthalten Produktivdaten (Beispielwerte der Labels,
-- u. a. maskierte Kartennummern). Sie gehoeren nach dashboard/discovery-results/
-- (in .gitignore) und NIE ins oeffentliche Repo.
-- =============================================================================

-- Q1: Grundgesamtheit - States x Environment x Sales Channel.
--     Erwartung: state in (SUCCESSFUL, FAILED, PENDING); environment PRODUCTION/PREVIEW
--     (oder LIVE/TEST - genau das wollen wir hier sehen); saleschannel
--     1582816223150 = E-Commerce, 1582819151330 = Physical Terminal.
SELECT
    ca.state,
    ca.environment,
    ca.saleschannel,
    ca.customerspresence,
    COUNT(*)                     AS anzahl,
    MIN(ca.createdon)            AS erster,
    MAX(ca.createdon)            AS letzter
FROM chargeattempt ca
WHERE ca.spaceid IN (40402)
  AND ca.createdon >= TIMESTAMP '2026-07-01 00:00:00'
  AND ca.createdon <  TIMESTAMP '2026-08-01 00:00:00'
GROUP BY 1, 2, 3, 4
ORDER BY anzahl DESC;

-- Q2: Alle vorkommenden Label-Descriptors pro Sales Channel, mit Haeufigkeit
--     und bis zu drei Beispielwerten. Das ist die Kernfrage: Welche IDs tragen
--     Issuer-Land, Kartentyp (Commercial/Consumer, Debit/Credit), 3-D Secure?
--     Anschliessend die Namen ueber
--     https://app-wallee.com/en-us/doc/api/label-descriptor/view/<ID> nachschlagen.
--     ohne_shorttext > 0 heisst: der Descriptor fuellt einen anderen Map-Key
--     (dann Q2b ausfuehren).
SELECT
    ca.saleschannel,
    l['descriptor']                                       AS descriptor_id,
    COUNT(*)                                              AS anzahl_attempts,
    COUNT(DISTINCT l['shortTextContent'])                 AS anzahl_werte,
    min(l['shortTextContent'])                            AS beispiel_min,
    max(l['shortTextContent'])                            AS beispiel_max,
    SUM(CASE WHEN l['shortTextContent'] IS NULL THEN 1 ELSE 0 END) AS ohne_shorttext
FROM chargeattempt ca
CROSS JOIN UNNEST(ca.labels) AS u (l)
WHERE ca.spaceid IN (40402)
  AND ca.createdon >= TIMESTAMP '2026-07-01 00:00:00'
  AND ca.createdon <  TIMESTAMP '2026-08-01 00:00:00'
GROUP BY 1, 2
ORDER BY 1, anzahl_attempts DESC;

-- Q2b (nur falls Q2 'ohne_shorttext' > 0 zeigt): welche Keys tragen die Label-Maps?
SELECT
    l['descriptor']              AS descriptor_id,
    array_join(map_keys(l), ',') AS keys,
    COUNT(*)                     AS anzahl
FROM chargeattempt ca
CROSS JOIN UNNEST(ca.labels) AS u (l)
WHERE ca.spaceid IN (40402)
  AND ca.createdon >= TIMESTAMP '2026-07-01 00:00:00'
  AND ca.createdon <  TIMESTAMP '2026-08-01 00:00:00'
  AND l['shortTextContent'] IS NULL
GROUP BY 1, 2
ORDER BY anzahl DESC;

-- Q3: Wie viele Attempts hat eine Transaktion (Retry-Verhalten, pro Channel)?
--     Basis fuer den Unterschied "Attempt-Erfolgsrate" vs. "Transaktions-Conversion".
SELECT
    x.saleschannel,
    x.attempts_pro_tx,
    COUNT(*) AS anzahl_transaktionen
FROM (
    SELECT c.transaction_id, ca.saleschannel, COUNT(*) AS attempts_pro_tx
    FROM chargeattempt ca
    JOIN charge c ON c.id = ca.charge_id
    WHERE ca.spaceid IN (40402)
      AND ca.createdon >= TIMESTAMP '2026-07-01 00:00:00'
      AND ca.createdon <  TIMESTAMP '2026-08-01 00:00:00'
    GROUP BY c.transaction_id, ca.saleschannel
) x
GROUP BY 1, 2
ORDER BY 1, 2;

-- Q4: Failure Reasons (nur IDs - die Namen liefert Analytics nicht).
--     Die Top-IDs dienen als Seed fuer die Namensaufloesung (Proxy-Route oder
--     statische Tabelle, siehe SPEC 6.4).
SELECT
    ca.saleschannel,
    ca.failurereason                     AS failure_reason_id,
    COUNT(*)                             AS anzahl
FROM chargeattempt ca
WHERE ca.spaceid IN (40402)
  AND ca.createdon >= TIMESTAMP '2026-07-01 00:00:00'
  AND ca.createdon <  TIMESTAMP '2026-08-01 00:00:00'
  AND ca.state = 'FAILED'
GROUP BY 1, 2
ORDER BY anzahl DESC;

-- Q5: Brand-Aufloesung ueber die Connector-Konfiguration des Attempts
--     (ca.connectorconfiguration, NICHT t.paymentconnectorconfiguration_id -
--     bei mehreren Attempts kann sich die Methode aendern) plus Wallet.
SELECT
    ca.saleschannel,
    COALESCE(pc.name['en-US'], pcc.name, 'UNKNOWN') AS brand,
    wt.name['en-US']                                 AS wallet,
    ca.state,
    COUNT(*)                                         AS anzahl
FROM chargeattempt ca
LEFT JOIN paymentconnectorconfiguration pcc ON pcc.id = ca.connectorconfiguration AND pcc.spaceid = ca.spaceid
LEFT JOIN paymentconnector pc ON pc.id = pcc.connector
LEFT JOIN wallettype wt ON wt.id = ca.wallet
WHERE ca.spaceid IN (40402)
  AND ca.createdon >= TIMESTAMP '2026-07-01 00:00:00'
  AND ca.createdon <  TIMESTAMP '2026-08-01 00:00:00'
GROUP BY 1, 2, 3, 4
ORDER BY 1, anzahl DESC;

-- Q6: Betragsbasis pro Attempt - welche Betragsspalte ist bei FAILED gefuellt?
--     (chargeattempt hat keine Betragsspalte; Kandidaten: t.authorizationamount,
--     t.completedamount). Ergebnis bestimmt die Formel fuer "Durchschnittsbetrag".
SELECT
    ca.state,
    COUNT(*)                                                     AS anzahl,
    SUM(CASE WHEN t.authorizationamount IS NULL THEN 1 ELSE 0 END) AS auth_null,
    SUM(CASE WHEN t.completedamount     IS NULL THEN 1 ELSE 0 END) AS completed_null,
    AVG(t.authorizationamount)                                   AS avg_auth,
    AVG(t.completedamount)                                       AS avg_completed
FROM chargeattempt ca
JOIN charge c ON c.id = ca.charge_id
JOIN transaction t ON t.id = c.transaction_id AND t.spaceid = ca.spaceid
WHERE ca.spaceid IN (40402)
  AND ca.createdon >= TIMESTAMP '2026-07-01 00:00:00'
  AND ca.createdon <  TIMESTAMP '2026-08-01 00:00:00'
GROUP BY 1;

-- Q7: Werteverteilung der vier fuer den Report entscheidenden Karten-Labels
--     (IDs aus dem POS-Lauf Space 40402, Juli 2026 - siehe discovery-results/DESCRIPTORS.md).
--     Liefert das Mapping Rohwert -> Report-Bucket (Business/Privat, Debit/Credit,
--     Kontaktlos/Chip, Issuer-Land). Pro Sales Channel.
SELECT
    ca.saleschannel,
    l['descriptor'] AS descriptor_id,
    CASE l['descriptor']
        WHEN '1474552618699' THEN 'Issuer Card Type (CREDIT/DEBIT)'
        WHEN '1474552618999' THEN 'Issuer Card Category (Produkt)'
        WHEN '1474552618629' THEN 'Issuer Country'
        WHEN '1761481788939' THEN 'Authorization Method'
    END AS descriptor_name,
    COALESCE(l['shortTextContent'], l['countryContent'], l['staticValueContent']) AS wert,
    COUNT(*)                                                    AS anzahl_attempts,
    SUM(CASE WHEN ca.state = 'SUCCESSFUL' THEN 1 ELSE 0 END)    AS erfolgreich
FROM chargeattempt ca
CROSS JOIN UNNEST(ca.labels) AS u (l)
WHERE ca.spaceid IN (40402)
  AND ca.createdon >= TIMESTAMP '2026-07-01 00:00:00'
  AND ca.createdon <  TIMESTAMP '2026-08-01 00:00:00'
  AND l['descriptor'] IN ('1474552618699', '1474552618999', '1474552618629', '1761481788939')
GROUP BY 1, 2, 3, 4
ORDER BY 2, anzahl_attempts DESC;

-- Q8 (nur E-Commerce-Space): 3-D-Secure-Labels. Q1, Q2, Q2b und Q4 zusaetzlich in
--     einem E-Com-Space ausfuehren - Space 40402 ist reiner POS (kein einziger
--     Attempt mit saleschannel 1582816223150), dort gibt es keine 3DS-Labels.
--     Q8 listet danach alle Descriptors der Gruppe mit Beispielwerten, deren Name
--     ueber die Doku aufgeloest wird (3-D Secure Authenticated / Status / Liability Shift).
--     -> gleiche Query wie Q2, nur mit dem E-Com-Space; keine eigene SQL noetig.
