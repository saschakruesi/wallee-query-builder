@echo off
rem wallee Query Builder - Starter fuer Windows.
rem Doppelklick startet den lokalen Server und oeffnet den Browser mit der App.
rem Voraussetzung: Node.js ist installiert (einmalig von https://nodejs.org).

rem Ins Verzeichnis dieser Datei wechseln, damit wallee-proxy.mjs und die HTML
rem gefunden werden - egal, von wo aus doppelgeklickt wird.
rem
rem WICHTIG: pushd statt "cd /d". Liegt der Ordner auf einem Netzlaufwerk
rem (UNC-Pfad \\server\freigabe\...), kann cmd ihn NICHT als Arbeitsverzeichnis
rem setzen ("UNC-Pfade werden nicht unterstuetzt") und faellt still auf
rem C:\Windows zurueck - dann sucht node die .mjs im falschen Ordner und bricht
rem mit "Cannot find module" ab. pushd mappt einen UNC-Pfad automatisch auf einen
rem temporaeren Laufwerksbuchstaben und wechselt dorthin.
pushd "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js ist auf diesem PC nicht installiert.
  echo   Bitte einmalig die LTS-Version von https://nodejs.org installieren
  echo   und diese Datei danach erneut doppelklicken.
  echo.
  start "" "https://nodejs.org/de/download"
  popd
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
rem Absoluter Pfad zur .mjs (%~dp0 endet auf \) - unabhaengig vom
rem Arbeitsverzeichnis, auch falls pushd wider Erwarten nicht greift.
node "%~dp0wallee-proxy.mjs"

rem Falls der Server beendet wird, Fenster offen halten fuer die Ausgabe.
popd
pause
