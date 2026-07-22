# wallee Query Builder — starten

Der Query Builder läuft lokal auf deinem Rechner. Zum Starten gibt es je System eine
**Doppelklick-Datei**. Der Browser öffnet sich dann von selbst mit der App.

## Das Paket

Der Ordner enthält:

| Datei | Wofür |
|---|---|
| `Start-macOS.command` | Starter für **macOS** (Doppelklick) |
| `Start-Windows.bat` | Starter für **Windows** (Doppelklick) |
| `wallee_query_builder.html` | die App selbst |
| `wallee-proxy.mjs` | der lokale Server (wird vom Starter aufgerufen) |

Alle Dateien im **selben Ordner** lassen — die Starter suchen die anderen daneben.

## Voraussetzung: Node.js (einmalig)

Der Starter braucht **Node.js**. Einmalig installieren, falls noch nicht vorhanden:

1. Auf <https://nodejs.org> die **LTS**-Version laden.
2. Installer ausführen (Next → Next → Fertig). Keine besonderen Einstellungen nötig.

Ist Node nicht da, sagt dir der Starter beim ersten Versuch Bescheid und öffnet die
Download-Seite.

## Starten

### macOS
1. **Doppelklick** auf `Start-macOS.command`.
2. Beim **allerersten Mal** blockt macOS die Datei evtl. (*„… nicht geöffnet, weil der
   Entwickler nicht verifiziert werden konnte"*). → **Rechtsklick auf die Datei → „Öffnen" →
   im Dialog nochmals „Öffnen".** Danach reicht künftig der Doppelklick.
3. Ein Terminal-Fenster erscheint, der Browser öffnet die App.

### Windows
1. **Doppelklick** auf `Start-Windows.bat`.
2. Beim **allerersten Mal** zeigt Windows evtl. *„Der Computer wurde durch Windows
   geschützt"*. → **„Weitere Informationen" → „Trotzdem ausführen".**
3. Ein kleines Fenster erscheint, der Browser öffnet die App.

## Zugangsdaten einmalig hinterlegen

Beim ersten Start sind noch keine wallee-Zugangsdaten gespeichert:

1. Im Query Builder oben rechts auf das **Zahnrad** klicken.
2. **Application User ID**, **Account** und **Secret (HMAC-Key)** eintragen, **speichern**.
3. Fertig — die Daten bleiben lokal auf deinem Rechner und verlassen ihn nie.

## Beenden

Das **Starter-Fenster offen lassen**, solange du arbeitest. Zum Beenden das Fenster
schliessen.

## Hinweise

- Läuft **nur lokal** (`127.0.0.1`) — von aussen nicht erreichbar.
- Ist der Standard-Port **8787** belegt, vorher in einer Konsole `WALLEE_PROXY_PORT` setzen
  (z. B. `8790`).
- Ganz ohne Starter geht auch: `wallee_query_builder.html` direkt per Doppelklick öffnen und
  im **Kopieren-Modus** SQL erzeugen und ins wallee-Portal einfügen — dann ist nichts zu
  starten (dafür gibt es aber keinen Ergebnis-Download in der App).
