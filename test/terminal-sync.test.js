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
    { id: '100', label: 'Kasse 1', selected: true },
    { id: '200', label: '200', selected: true },
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
    { id: '100', label: 'Neu', selected: false },      // Auswahl unveraendert, Label neu
    { id: 'manuell', label: 'Hand', selected: true },  // ohne API-Treffer unveraendert
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
  assert.deepStrictEqual(plain(r.liste), [{ id: '5', label: 'erst', selected: true }]);
});

test('syncButtonZustand: aktiv nur bei apiMode UND proxyOk, Info nur ohne apiMode', () => {
  assert.deepStrictEqual(plain(X.syncButtonZustand(false, false)), { aktiv: false, infoSichtbar: true });
  assert.deepStrictEqual(plain(X.syncButtonZustand(false, true)),  { aktiv: false, infoSichtbar: true });
  assert.deepStrictEqual(plain(X.syncButtonZustand(true, false)),  { aktiv: false, infoSichtbar: false });
  assert.deepStrictEqual(plain(X.syncButtonZustand(true, true)),   { aktiv: true,  infoSichtbar: false });
});
