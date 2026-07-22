@echo off
rem wallee Query Builder - Starter fuer Windows.
rem Doppelklick startet den lokalen Server und oeffnet den Browser mit der App.
rem Voraussetzung: Node.js ist installiert (einmalig von https://nodejs.org).

rem Ins Verzeichnis dieser Datei wechseln, damit wallee-proxy.mjs und die HTML
rem gefunden werden - egal, von wo aus doppelgeklickt wird.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js ist auf diesem PC nicht installiert.
  echo   Bitte einmalig die LTS-Version von https://nodejs.org installieren
  echo   und diese Datei danach erneut doppelklicken.
  echo.
  start "" "https://nodejs.org/de/download"
  pause
  exit /b 1
)

echo.
echo   wallee Query Builder startet ...
echo   Der Browser oeffnet sich gleich. Dieses Fenster bitte offen lassen -
echo   zum Beenden einfach schliessen.
echo.

rem WALLEE_OPEN=1 laesst den Server den Standardbrowser selbst oeffnen.
set WALLEE_OPEN=1
node wallee-proxy.mjs

rem Falls der Server beendet wird, Fenster offen halten fuer die Ausgabe.
pause
