# dashboard/ — Reporting-Modus (Händler-KPIs)

Arbeitsordner für die neue Kategorie **Reporting** im wallee Analytics Query Builder.

| Datei | Zweck |
|---|---|
| `SPEC.md` | Fachliche Vorgabe: Grundsatzentscheide, Datenmodell der Query, KPI-Katalog (POS / E-Commerce), UI, Edge Cases, Definition of Done. |
| `PLAN.md` | Goal-driven Implementierungsplan für Claude Code — Task 0 (Discovery) bis Task 7 (Doku/Version), je mit Tests und Commit. |
| `SPEC-ITERATION-2.md` | **Iteration 2 (v5.12):** Ablehngründe im Klartext (Katalog-Scrape), Kuchendiagramme, 3DS-Failure-Seite mit Export und Dashboard-Link, Datenkatalog für Security-/3DS-Analysen, Antworten auf die Support-Anfrage aus Referenzfall B (Details gitignored in `discovery-results/FALL-B.md`). |
| `catalog/failure-reasons.json`, `catalog/label-descriptors.json` | Gescrapte wallee-Kataloge (2'254 Failure Reasons mit Kategorie, 755 Label Descriptors) — Quelle für `FAILURE_REASONS` und die Descriptor-Konstanten. `tools/scrape_wallee_catalogs.py` aktualisiert sie. |
| `sql/00_label_discovery.sql` | Task 0: Discovery-Queries (Q1–Q7), die an echten Daten klären, welche Label-Descriptors, States und Environments vorkommen. Einzeln im Portal ausführen. |
| `sql/00b_ecom_discovery.sql` | Task 0b: dieselben Queries, Zeitraum fertig parametrisiert für den E-Com-Referenzspace (plus Q9 Token/Wallet). Space-ID als Platzhalter `<SPACE_ID>` — vor dem Ausführen ersetzen. |
| `sql/01_reporting_reference.sql` | Entsteht in Task 1: die generierte Referenz-Query zum Gegenprüfen im Portal. |
| `discovery-results/` | **Gitignored.** Ergebnisse der Discovery- und Referenzläufe (Produktivdaten), `DESCRIPTORS.md`, `ABNAHME.md`. |

## Einstieg mit Claude Code

```
Lies CLAUDE.md, dann dashboard/SPEC.md und dashboard/PLAN.md.
Für v5.12: dashboard/SPEC-ITERATION-2.md (§6 = Task-Reihenfolge), Kataloge in dashboard/catalog/.
Task 0 ist abgeschlossen (POS + E-Com) — Konstanten in SPEC §6.3, Herleitung in dashboard/discovery-results/DESCRIPTORS.md.
Arbeite PLAN.md ab Task 1 Task für Task ab (superpowers:subagent-driven-development),
jede Task endet mit `node --test "test/*.test.js"` grün und einem Commit.
Halte an, bevor du Task 1 Step 4 (Referenz-Query im Portal) und Task 7 Step 4 (Abnahme) brauchst.
```

Task 0 ist für den POS- und den E-Com-Referenzspace erledigt (Zuordnung der Space-IDs in
`discovery-results/SPACE-IDS.md`, gitignored). Für einen Space mit anderem
Acquirer/Connector die Discovery-Queries erneut fahren — Label-IDs sind connectorabhängig.
