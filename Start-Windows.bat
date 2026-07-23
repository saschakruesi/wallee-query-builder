@echo off
setlocal
rem wallee Query Builder - Starter fuer Windows.
rem Doppelklick startet den lokalen Server und oeffnet den Browser mit der App.
rem Voraussetzung: Node.js ist installiert (einmalig von https://nodejs.org).

rem In den Ordner dieser Datei wechseln. pushd statt "cd /d", weil der Ordner auf
rem einem Netzlaufwerk (UNC-Pfad \\server\...) liegen kann: cmd kann UNC nicht als
rem Arbeitsverzeichnis setzen und faellt sonst auf C:\Windows zurueck. pushd mappt
rem den UNC-Pfad automatisch auf einen temporaeren Laufwerksbuchstaben und wechselt
rem dorthin - danach ist der Ordner ein normaler Laufwerkspfad.
pushd "%~dp0"

rem Node vorhanden?
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

rem Liegt die Proxy-Datei wirklich neben dem Starter? Wenn pushd wider Erwarten
rem nicht wechseln konnte, faellt das hier sofort mit klarer Meldung auf, statt
rem dass node stumm ins Leere laeuft.
if not exist "wallee-proxy.mjs" (
  echo.
  echo   wallee-proxy.mjs wurde im aktuellen Ordner nicht gefunden:
  echo   %CD%
  echo   Bitte den kompletten Ordner entpacken - Starter, wallee-proxy.mjs und
  echo   wallee_query_builder.html muessen zusammen liegen.
  echo.
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
rem Relativer Aufruf aus dem per pushd gemappten Ordner - node bekommt so einen
rem normalen Laufwerkspfad statt eines UNC-Pfads (den node als Argument nicht
rem immer mag). Der Aufruf blockiert, solange der Server laeuft.
set WALLEE_OPEN=1
node wallee-proxy.mjs

rem Hierhin kommt es nur, wenn der Server beendet wurde. Exit-Code zeigen und das
rem Fenster fuer die Ausgabe offen halten.
echo.
echo   Der Server wurde beendet. Code: %ERRORLEVEL%
popd
pause
