-- =============================================================================
-- Reporting-Modus · Iteration 3 (SPEC-ITERATION-3.md §1 und §7): Discovery
-- "Kommt der Ausgang der 3-D-Secure-Challenge im Analytics-Export an?"
--
-- Hintergrund: Das Portal zeigt am Charge Attempt unter «3-D Secure
-- Authentication Attempts» den Ausgang der Authentifizierung (z. B. «The
-- challenge authentication of the customer failed or was canceled», dazu
-- Challenge Status N, Status Reason 14, Challenge cancel 04). Diese Werte
-- haengen an einer EIGENEN Entitaet (threed-secure/authentication-attempt),
-- nicht am Charge Attempt. Ob sie in chargeattempt.labels ankommen, ist
-- connectorabhaengig und wird hier GEMESSEN, nicht angenommen - ein falsch
-- geratener Descriptor wirft nicht, er liefert dauerhaft NULL.
--
-- Jede Query EINZELN unter Account > Analytics > Submit Query ausfuehren
-- (oder im API-Modus ueber den Proxy). Tabellen-/Spaltennamen lowercase.
-- VOR DEM AUSFUEHREN ANPASSEN:
--   ca.spaceid = <SPACE_ID>                    -> eigene Space-ID
--   TIMESTAMP '2026-04-01 00:00:00'            -> Beginn des Zeitraums
--   TIMESTAMP '2026-07-01 00:00:00'            -> Ende (exklusiv)
--   ca.id = <ATTEMPT_ID>                       -> (nur Q2) ein Charge Attempt, dessen
--                                                 Portal-Ansicht man daneben legt
-- <SPACE_ID> / <ATTEMPT_ID> sind Platzhalter und MUESSEN ersetzt werden.
--
-- Zugriff auf die Map-Werte ueber element_at(l, '<key>'), nicht l['<key>']:
-- element_at liefert bei fehlendem Key NULL statt eines Fehlers, und genau
-- das "fehlt" wollen wir hier messen.
--
-- ACHTUNG: Die Ergebnisse enthalten Produktivdaten. Karteninhaber-Name,
-- maskierte Kartennummer, Ablaufdatum und PAR werden in der Wert-Spalte
-- ausgeblendet (<ausgeblendet>); die uebrigen Beispielwerte (Bestellnummern,
-- Referenzen) gehoeren trotzdem nach dashboard/discovery-results/ (in
-- .gitignore) und NIE ins oeffentliche Repo.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Q1: Inventar ALLER Label-Descriptors der E-Commerce-Attempts, getrennt nach
--     Zustand und danach, ob der Ablehngrund ein 3DS-Grund ist (die beiden
--     IDs aus TDS_FAILURE_REASONS). Erwartet werden auf den 3DS-Fehlschlaegen
--     die bekannten Labels (Issuer-Land, Kartentyp, BIN, PAN-Typ, Started/
--     Finished). Die Entscheidungsfrage lautet: taucht DARUEBER HINAUS ein
--     Descriptor aus den Gruppen «Netcetera Attempt Data», «Endeavour
--     Attempt Data V2» oder «3-D Secure Details» auf (ARes/RRes Status,
--     Status Reason, Cancel Indicator, Enrolled, ACS ...)?
--
--     Referenzfall C (2026-09-25): NEIN. 6'371 3DS-Fehlschlaege in drei
--     Monaten, kein einziger davon traegt einen dieser Descriptors.
-- -----------------------------------------------------------------------------
WITH lab AS (
    SELECT
        ca.id                                            AS attempt_id,
        ca.state                                         AS attempt_state,
        CAST(ca.failurereason AS varchar)                AS failure_reason_id,
        element_at(l, 'descriptor')                      AS descriptor_id,
        array_join(map_keys(l), ',')                     AS keys,
        CASE WHEN element_at(l, 'descriptor') IN ('1456765000789', '1456765125779',
                                                  '1456765711187', '1739873828282',
                                                  '1768224685000', '1615568869167')
             THEN '<ausgeblendet>'
             ELSE COALESCE(element_at(l, 'shortTextContent'), element_at(l, 'longTextContent'),
                  element_at(l, 'staticValueContent'), element_at(l, 'booleanContent'),
                  element_at(l, 'integerContent'), element_at(l, 'dateTimeContent'),
                  element_at(l, 'countryContent'), element_at(l, 'decimalContent'),
                  element_at(l, 'yearMonthContent')) END AS wert
    FROM chargeattempt ca
    CROSS JOIN UNNEST(ca.labels) AS u (l)
    WHERE ca.spaceid = <SPACE_ID>
      AND ca.createdon >= TIMESTAMP '2026-04-01 00:00:00'
      AND ca.createdon <  TIMESTAMP '2026-07-01 00:00:00'
      AND ca.environment = 'PRODUCTION'
      AND ca.saleschannel = 1582816223150
)
SELECT
    attempt_state,
    CASE WHEN failure_reason_id IN ('1568360440179', '1568360434240')
         THEN 'TDS' ELSE 'ANDERE' END        AS grund_gruppe,
    descriptor_id,
    keys,
    COUNT(*)                                  AS anzahl_attempts,
    COUNT(DISTINCT wert)                      AS anzahl_werte,
    min(wert)                                 AS beispiel_min,
    max(wert)                                 AS beispiel_max
FROM lab
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 5 DESC;


-- -----------------------------------------------------------------------------
-- Q2: Alle Labels EINES Charge Attempts, dessen Portal-Ansicht man daneben
--     legt. Das ist der direkteste Beweis: steht im Portal unter «3-D Secure
--     Authentication Attempts» ein Grund und hier keine Zeile dazu, kommt er
--     nicht im Analytics-Export an. Das Zeitfenster grenzt den Partition-Scan
--     ein - ohne es liest Athena die ganze Tabelle.
--
--     Referenzfall C: acht Zeilen (BIN, Issuer-Land, Funding, Kategorie,
--     Started, Finished, Recurring Indicator, PAN-Typ). Kein Netcetera-Label.
-- -----------------------------------------------------------------------------
SELECT
    element_at(l, 'descriptor')                     AS descriptor_id,
    array_join(map_keys(l), ',')                    AS keys,
    COALESCE(element_at(l, 'shortTextContent'), element_at(l, 'longTextContent'),
             element_at(l, 'staticValueContent'), element_at(l, 'booleanContent'),
             element_at(l, 'integerContent'), element_at(l, 'dateTimeContent'),
             element_at(l, 'countryContent'), element_at(l, 'decimalContent'),
             element_at(l, 'yearMonthContent'))     AS wert
FROM chargeattempt ca
CROSS JOIN UNNEST(ca.labels) AS u (l)
WHERE ca.spaceid = <SPACE_ID>
  AND ca.id = <ATTEMPT_ID>
  AND ca.createdon >= TIMESTAMP '2026-06-30 00:00:00'
  AND ca.createdon <  TIMESTAMP '2026-07-01 00:00:00'
  AND element_at(l, 'descriptor') NOT IN ('1456765000789', '1456765125779', '1456765711187')
ORDER BY 1;


-- -----------------------------------------------------------------------------
-- Q3: Gezielt die Descriptors, die den Challenge-Ausgang tragen wuerden -
--     die Namen stammen aus dashboard/catalog/label-descriptors.json, die
--     Felder sind dieselben, die das Portal auf der Detailseite der Entitaet
--     «3-D Secure Authentication Attempt» zeigt. Kommt hier NICHTS zurueck,
--     gilt SPEC-ITERATION-3 §2: der Grund ist aus dem Analytics-Export nicht
--     baubar, bis wallee die Entitaet exportiert (§4).
--
--     Erneut fahren, sobald wallee eine Aenderung an Analytics oder am
--     Connector ankuendigt - liefert Q3 Zeilen, ist §5 zu bauen.
-- -----------------------------------------------------------------------------
SELECT
    element_at(l, 'descriptor')                     AS descriptor_id,
    array_join(map_keys(l), ',')                    AS keys,
    COUNT(*)                                        AS anzahl_attempts,
    COUNT(DISTINCT element_at(l, 'shortTextContent')) AS anzahl_werte,
    min(element_at(l, 'shortTextContent'))          AS beispiel_min,
    max(element_at(l, 'shortTextContent'))          AS beispiel_max
FROM chargeattempt ca
CROSS JOIN UNNEST(ca.labels) AS u (l)
WHERE ca.spaceid = <SPACE_ID>
  AND ca.createdon >= TIMESTAMP '2026-04-01 00:00:00'
  AND ca.createdon <  TIMESTAMP '2026-07-01 00:00:00'
  AND ca.environment = 'PRODUCTION'
  AND element_at(l, 'descriptor') IN (
        -- Netcetera Attempt Data (der 3DS-Server in Referenzfall C)
        '1555882394269',  -- ARes status              (C = Challenge Required, Y, N, A, U, R)
        '1557882394269',  -- ARes status reason
        '1556882394269',  -- RRes status              (= Challenge Status: Y / N / ...)
        '1557886394269',  -- RRes status reason       (= Challenge Status Reason: EMVCo 01..26)
        '1558882394269',  -- RRes result status
        '1552776387359',  -- Enrolled V2
        '1552951295369',  -- 3DS Method Completion    (Y / N / U)
        '1564356246811',  -- Entered phases
        '1562301419959',  -- Authentication has been started
        '1562301417759',  -- Result response received
        '1553882394269',  -- AReq protocol version    (2.1.0 / 2.2.0)
        '1864357246811',  -- Scheme identified by Wallee
        '1551953661029',  -- Challenge ACS URL        (Host = der ACS, die einzige ACS-Achse)
        '1552058836149',  -- ACS Transaction ID
        '1698042396612',  -- ACS Reference Number
        -- Endeavour Attempt Data V2 (der andere 3DS-Server)
        '1552399220645',  -- AReq Status
        '1552399220644',  -- AReq Status Reason Code
        '1552555790369',  -- RReq Status
        '1552555790370',  -- RReq Status Reason Code
        '1552557191573',  -- Cancel Indicator
        '1552301417759',  -- Challenge Active
        '1552301749305',  -- Challenge Mandate
        '1552307278788',  -- Challenge Authentication Type
        '1551776387353',  -- Enrolled V2
        -- 3-D Secure Details (die 13 aus SPEC-ITERATION-2 §4.3, in Fall B ebenfalls nicht da)
        '1611157230835',  -- Transaction Status
        '1611160961002',  -- Transaction Status Reason
        '1611161612971',  -- Challenge Cancel
        '1611161618236',  -- Authentication Type
        '1562759930422',  -- 3-D Secure Status (Static Value)
        -- 3-D Secure Information
        '1485183660219',  -- 3-D Secure Failure (Klartext-Grund)
        '1484060156585',  -- 3D Secure Authentication Status
        '1482414044065'   -- 3-D Secure Authentication Status (Static Value)
      )
GROUP BY 1, 2
ORDER BY anzahl_attempts DESC;
