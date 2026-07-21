// Prueft, dass jede im App-Code per getElementById angesprochene ID im Markup
// wirklich existiert.
//
// Hintergrund: der DOM-Stub in test/harness.js liefert fuer JEDE ID irgendein
// No-Op-Element zurueck. Eine verwaiste Referenz - falsch geschriebene oder
// geloeschte ID - faellt den Builder-Tests deshalb nie auf, sondern erst im
// Browser, wo dann still gar nichts passiert. Dieser Test schliesst die Luecke
// statisch, ohne DOM.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'wallee_query_builder_v2.html');
const html = fs.readFileSync(APP, 'utf8');

// Nur der Markup-Teil bis zum Vendor-Block - der minifizierte SheetJS-Code
// enthaelt massenhaft Strings, die wie IDs aussehen.
const markup = html.slice(0, html.indexOf('<script id="vendor-xlsx">'));

const appOpen = '<script id="app-logic">';
const appFrom = html.indexOf(appOpen) + appOpen.length;
const appCode = html.slice(appFrom, html.indexOf('</script>', appFrom));

function vorhandeneIds() {
  const ids = new Set();
  const re = /\sid="([^"]+)"/g;
  let m;
  while ((m = re.exec(markup)) !== null) ids.add(m[1]);
  return ids;
}

function angefragteIds() {
  const ids = new Set();
  const re = /getElementById\(\s*'([^']+)'\s*\)/g;
  let m;
  while ((m = re.exec(appCode)) !== null) ids.add(m[1]);
  return ids;
}

test('jede per getElementById angefragte ID existiert im Markup', () => {
  const vorhanden = vorhandeneIds();
  const angefragt = angefragteIds();
  assert.ok(angefragt.size > 20, `Zu wenige IDs gefunden (${angefragt.size}) - Regex greift nicht`);

  const verwaist = [...angefragt].filter(id => !vorhanden.has(id)).sort();
  assert.deepStrictEqual(verwaist, [], 'Verwaiste getElementById-Referenzen: ' + verwaist.join(', '));
});

test('Terminal-Report ist im terminal-Modus aufgegangen, kein eigener Report-Tab mehr', () => {
  // Der eigenstaendige Report-Tab wurde aufgeloest (siehe CLAUDE.md): der
  // 'terminal'-Modus heisst jetzt "Terminal-Report" und zeigt Filter + Report
  // im selben Panel. Ein eigener data-mode="report"-Button darf nicht mehr
  // existieren, das reportSection-Panel (jetzt ohne CSV-Upload) bleibt.
  assert.doesNotMatch(markup, /data-mode="report"/, 'Report-Button haette entfernt werden muessen');
  assert.match(markup, /id="reportSection"/, 'Report-Panel fehlt');
  assert.doesNotMatch(markup, /id="reportDropzone"/, 'CSV-Upload-Dropzone haette entfernt werden muessen');
  assert.doesNotMatch(markup, /id="reportFileInput"/, 'CSV-Datei-Input haette entfernt werden muessen');
});
