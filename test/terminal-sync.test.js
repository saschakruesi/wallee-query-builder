const test = require('node:test');
const assert = require('node:assert');
const { loadBuilders, plain } = require('./harness');

let X;
test.before(() => { X = loadBuilders(); });

test('mergeSyncTerminals: neue Terminals werden ausgewaehlt angehaengt', () => {
  const r = X.mergeSyncTerminals([], [
    { identifier: '100', name: 'Kasse 1' },
    { identifier: '200', name: '' },
  ]);
  assert.strictEqual(r.neuCount, 2);
  assert.strictEqual(r.aktualisiertCount, 0);
  assert.deepStrictEqual(plain(r.liste), [
    { id: '100', label: 'Kasse 1', selected: true, space: '', spaceId: '' },
    { id: '200', label: '200', selected: true, space: '', spaceId: '' },
  ], 'leerer Name faellt auf den identifier als Label zurueck');
});

test('mergeSyncTerminals: bestehende behalten Auswahl, Label wird aktualisiert', () => {
  const vorhanden = [
    { id: '100', label: 'alt', selected: false },
    { id: 'manuell', label: 'Hand', selected: true },
  ];
  const r = X.mergeSyncTerminals(vorhanden, [{ identifier: '100', name: 'Neu' }]);
  assert.strictEqual(r.neuCount, 0);
  assert.strictEqual(r.aktualisiertCount, 1);
  assert.deepStrictEqual(plain(r.liste), [
    { id: '100', label: 'Neu', selected: false },
    { id: 'manuell', label: 'Hand', selected: true },
  ]);
});

test('mergeSyncTerminals: leerer Name laesst bestehendes Label stehen', () => {
  const r = X.mergeSyncTerminals([{ id: '1', label: 'behalten', selected: true }],
    [{ identifier: '1', name: '' }]);
  assert.strictEqual(plain(r.liste)[0].label, 'behalten');
  assert.strictEqual(r.aktualisiertCount, 0, 'ohne Aenderung kein aktualisiert-Zaehler');
});

test('mergeSyncTerminals: Duplikate in neu werden per identifier entschaerft, leere uebersprungen', () => {
  const r = X.mergeSyncTerminals([], [
    { identifier: '5', name: 'erst' },
    { identifier: '5', name: 'zweit' },
    { identifier: '', name: 'leer' },
  ]);
  assert.strictEqual(r.neuCount, 1);
  assert.deepStrictEqual(plain(r.liste), [{ id: '5', label: 'erst', selected: true, space: '', spaceId: '' }]);
});

test('mergeSyncTerminals: space wird gesetzt und bei bestehenden aktualisiert', () => {
  // neu: space landet am neuen Eintrag
  const r1 = X.mergeSyncTerminals([], [{ identifier: '9', name: 'T9', space: '83954 · Zürich' }]);
  assert.deepStrictEqual(plain(r1.liste), [
    { id: '9', label: 'T9', selected: true, space: '83954 · Zürich', spaceId: '' },
  ]);
  // bestehend ohne space -> bekommt space, zaehlt als aktualisiert
  const r2 = X.mergeSyncTerminals([{ id: '9', label: 'T9', selected: false }],
    [{ identifier: '9', name: 'T9', space: '73192 · Bern' }]);
  assert.strictEqual(r2.aktualisiertCount, 1, 'Space-Aenderung zaehlt');
  assert.strictEqual(plain(r2.liste)[0].space, '73192 · Bern');
  assert.strictEqual(plain(r2.liste)[0].selected, false, 'Auswahl bleibt');
});

test('syncButtonZustand: im API-Modus immer aktiv, Info-Marker nur im Kopiermodus', () => {
  // Der Button haengt bewusst NICHT mehr an einem Proxy-Health-Signal (das war
  // teils faelschlich false und liess den Button in einer Sackgasse ausgegraut).
  // Erreichbarkeit/Zugangsdaten werden erst beim Klick geprueft und als klare
  // Fehlermeldung gezeigt.
  assert.deepStrictEqual(plain(X.syncButtonZustand(true)),  { aktiv: true,  infoSichtbar: false });
  assert.deepStrictEqual(plain(X.syncButtonZustand(false)), { aktiv: false, infoSichtbar: true });
});
