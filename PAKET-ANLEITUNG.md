# wallee Query Builder — Programm starten

Das Programm ist **eine einzige Datei**. Es braucht **keine Installation**, kein Node, kein
Terminal. Doppelklick — der Browser öffnet sich von selbst mit dem Query Builder.

## Herunterladen

Auf der **Releases**-Seite die Datei für dein System laden:

| System | Datei |
|---|---|
| macOS | `wallee-query-builder-macos` |
| Windows | `wallee-query-builder-windows.exe` |

## Starten

### macOS

1. Datei per **Doppelklick** starten.
2. Beim **ersten Mal** meldet macOS evtl.: *„… kann nicht geöffnet werden, da Apple es nicht
   auf Schadsoftware prüfen konnte."* Das ist normal (das Programm ist noch nicht signiert).
   → **Rechtsklick auf die Datei → „Öffnen" → im Dialog nochmals „Öffnen".** Danach startet
   es künftig per einfachem Doppelklick.
3. Der Browser öffnet automatisch `http://127.0.0.1:8787`.

### Windows

1. Datei per **Doppelklick** starten.
2. Beim **ersten Mal** zeigt Windows evtl. *„Der Computer wurde durch Windows geschützt"*.
   → **„Weitere Informationen" → „Trotzdem ausführen".** Das ist normal (noch nicht signiert).
3. Ein kleines Konsolenfenster erscheint und der Browser öffnet automatisch.

## Zugangsdaten einmalig hinterlegen

Beim ersten Start sind noch keine wallee-Zugangsdaten hinterlegt:

1. Im Query Builder oben rechts auf das **Zahnrad** klicken.
2. **Application User ID**, **Account** und **Secret (HMAC-Key)** eintragen und **speichern**.
3. Fertig — die Daten bleiben lokal auf deinem Rechner gespeichert (`~/.wallee-proxy.json`
   bzw. im Windows-Benutzerprofil) und verlassen ihn nie.

## Beenden

Das **Fenster/Programm offen lassen**, solange du arbeitest. Zum Beenden einfach das
Konsolenfenster schliessen (Windows) bzw. das Programm beenden (macOS: im Dock).

## Hinweise

- Das Programm läuft **nur lokal** (`127.0.0.1`) — es ist von aussen nicht erreichbar.
- Ist der **Port 8787** belegt, lässt er sich per Umgebungsvariable ändern:
  `WALLEE_PROXY_PORT=8790`.
- Wer lieber ohne Programm arbeitet, kann die Datei `wallee_query_builder.html` weiterhin per
  Doppelklick öffnen und im **Kopieren-Modus** SQL erzeugen und ins wallee-Portal einfügen —
  dafür ist gar nichts zu starten.
