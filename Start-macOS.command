#!/bin/bash
# wallee Query Builder - Starter fuer macOS.
# Doppelklick startet den lokalen Server und oeffnet den Browser mit der App.
# Voraussetzung: Node.js ist installiert (einmalig von https://nodejs.org).

# Ins Verzeichnis dieser Datei wechseln, damit wallee-proxy.mjs und die HTML
# gefunden werden - egal, von wo aus doppelgeklickt wird. Den absoluten Pfad
# aufloesen und die .mjs spaeter absolut aufrufen, damit es auch von einem
# Netzlaufwerk/Share aus zuverlaessig startet.
DIR="$(cd "$(dirname "$0")" && pwd)" || exit 1
cd "$DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js ist auf diesem Mac nicht installiert."
  echo "  Bitte einmalig die LTS-Version von https://nodejs.org installieren"
  echo "  und diese Datei danach erneut doppelklicken."
  echo
  open "https://nodejs.org/de/download" 2>/dev/null
  read -n 1 -s -r -p "  Zum Schliessen eine beliebige Taste druecken ..."
  echo
  exit 1
fi

echo
echo "  wallee Query Builder startet ..."
echo "  Der Browser oeffnet sich gleich. Dieses Fenster bitte offen lassen -"
echo "  zum Beenden einfach schliessen."
echo

# WALLEE_OPEN=1 laesst den Server den Standardbrowser selbst oeffnen.
export WALLEE_OPEN=1
exec node "$DIR/wallee-proxy.mjs"
