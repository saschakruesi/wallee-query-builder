// Tests fuer den lokalen Proxy: Routing, Zugangsdaten-Pruefung, CORS und der
// Missbrauchsschutz. Alles ohne Netz und ohne laufenden Server.
//
// Die Signatur selbst wird in Task 10 gegen das offizielle SDK verifiziert;
// hier stehen erst die strukturellen Eigenschaften.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// wallee-proxy.mjs ist ein ES-Modul, diese Datei laeuft als CommonJS -
// deshalb dynamisch importieren. Der Import darf keinen Server starten
// (die Datei prueft dafuer process.argv[1]).
let P;
test.before(async () => { P = await import('../wallee-proxy.mjs'); });

// --- Routing ---------------------------------------------------------------

test('Routing: alle Endpunkte werden erkannt', () => {
  assert.strictEqual(P.findeRoute('GET', '/health').name, 'health');
  assert.strictEqual(P.findeRoute('GET', '/setup').name, 'setup-seite');
  assert.strictEqual(P.findeRoute('POST', '/setup').name, 'setup-speichern');
  assert.strictEqual(P.findeRoute('POST', '/submit').name, 'submit');
  assert.strictEqual(P.findeRoute('OPTIONS', '/submit').name, 'preflight');
});

test('Routing: Token wird aus dem Pfad gelesen', () => {
  const status = P.findeRoute('GET', '/status/abc-123');
  assert.strictEqual(status.name, 'status');
  assert.strictEqual(status.token, 'abc-123');

  const result = P.findeRoute('GET', '/result/abc-123');
  assert.strictEqual(result.name, 'result');
  assert.strictEqual(result.token, 'abc-123');

  const cancel = P.findeRoute('DELETE', '/query/abc-123');
  assert.strictEqual(cancel.name, 'cancel');
  assert.strictEqual(cancel.token, 'abc-123');
});

test('Routing: kodierte Token werden dekodiert', () => {
  assert.strictEqual(P.findeRoute('GET', '/status/a%2Fb').token, 'a/b');
});

test('Routing: Query-String und Schraegstrich am Ende stoeren nicht', () => {
  assert.strictEqual(P.findeRoute('GET', '/health?x=1').name, 'health');
  assert.strictEqual(P.findeRoute('GET', '/health/').name, 'health');
});

test('Routing: falsche Methode trifft nicht die richtige Route', () => {
  assert.strictEqual(P.findeRoute('GET', '/submit').name, 'unbekannt');
  assert.strictEqual(P.findeRoute('POST', '/status/abc').name, 'unbekannt');
  assert.strictEqual(P.findeRoute('GET', '/query/abc').name, 'unbekannt');
  assert.strictEqual(P.findeRoute('GET', '/gibtsnicht').name, 'unbekannt');
});

// --- Zugangsdaten ----------------------------------------------------------

test('Zugangsdaten: gueltige Eingabe wird angenommen', () => {
  const fehler = P.pruefeZugangsdaten({
    userId: '12345',
    secret: 'c2VjcmV0LXdlcnQtZnVlci1kZW4tdGVzdA==',
    accountId: '999',
  });
  assert.deepStrictEqual(fehler, []);
});

test('Zugangsdaten: fehlende Felder werden benannt', () => {
  const fehler = P.pruefeZugangsdaten({});
  assert.strictEqual(fehler.length, 2);
  assert.ok(fehler.some(f => /User-ID/.test(f)));
  assert.ok(fehler.some(f => /Secret/.test(f)));
});

test('Zugangsdaten: nicht-numerische User-ID faellt auf', () => {
  const fehler = P.pruefeZugangsdaten({ userId: 'abc', secret: 'c2VjcmV0LXdlcnQtZnVlcg==' });
  assert.ok(fehler.some(f => /User-ID muss eine Zahl/.test(f)));
});

test('Zugangsdaten: Secret, das kein Base64 ist, faellt auf', () => {
  const fehler = P.pruefeZugangsdaten({ userId: '1', secret: 'nicht base64!!' });
  assert.ok(fehler.some(f => /Base64/.test(f)));
});

test('Zugangsdaten: Account-ID ist optional, muss aber numerisch sein', () => {
  const ohne = P.pruefeZugangsdaten({ userId: '1', secret: 'c2VjcmV0LXdlcnQtZnVlcg==' });
  assert.deepStrictEqual(ohne, []);

  const falsch = P.pruefeZugangsdaten({ userId: '1', secret: 'c2VjcmV0LXdlcnQtZnVlcg==', accountId: 'x' });
  assert.ok(falsch.some(f => /Account-ID/.test(f)));
});

test('Zugangsdaten: Datei bekommt Rechte 600', async () => {
  const pfad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wallee-proxy-')), 'config.json');
  const ergebnis = await P.speichereZugangsdaten(
    { userId: '42', secret: 'c2VjcmV0LXdlcnQtZnVlci1kZW4tdGVzdA==', accountId: '7' }, pfad);

  assert.strictEqual(ergebnis.ok, true);
  const modus = fs.statSync(pfad).mode & 0o777;
  assert.strictEqual(modus, 0o600,
    `Config muss nur fuer den eigenen Benutzer lesbar sein, ist aber ${modus.toString(8)}`);

  const gelesen = P.ladeZugangsdaten(pfad);
  assert.strictEqual(gelesen.userId, '42');
  assert.strictEqual(gelesen.accountId, '7');
});

test('Zugangsdaten: fehlende oder kaputte Datei ergibt null statt Absturz', () => {
  assert.strictEqual(P.ladeZugangsdaten('/gibt/es/nicht.json'), null);

  const pfad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wallee-proxy-')), 'kaputt.json');
  fs.writeFileSync(pfad, '{ das ist kein json');
  assert.strictEqual(P.ladeZugangsdaten(pfad), null);
});

// --- Herkunft und Missbrauchsschutz ---------------------------------------
// Ein lokaler Server ist von jeder offenen Webseite aus erreichbar. Ohne
// Schutz koennte eine fremde Seite im Hintergrund /submit aufrufen und ueber
// die hinterlegten Zugangsdaten Transaktionsdaten abziehen.

test('Herkunft: file:// (Origin null) ist erlaubt', () => {
  assert.strictEqual(P.originErlaubt('null'), true);
});

test('Herkunft: fremde Webseiten werden abgewiesen', () => {
  assert.strictEqual(P.originErlaubt('https://boese.example'), false);
  assert.strictEqual(P.originErlaubt('http://localhost:3000'), false,
    'auch ein anderer lokaler Port ist nicht automatisch vertrauenswuerdig');
});

test('Herkunft: Aufruf ohne Origin (kein Browser) ist erlaubt', () => {
  assert.strictEqual(P.originErlaubt(undefined), true);
  assert.strictEqual(P.originErlaubt(''), true);
});

test('CORS: niemals Allow-Origin *', () => {
  const kopf = P.corsHeader('null');
  assert.strictEqual(kopf['Access-Control-Allow-Origin'], 'null');
  assert.notStrictEqual(kopf['Access-Control-Allow-Origin'], '*');
});

test('CORS: fremde Herkunft bekommt gar kein Allow-Origin', () => {
  const kopf = P.corsHeader('https://boese.example');
  assert.ok(!('Access-Control-Allow-Origin' in kopf),
    'ohne Allow-Origin verweigert der Browser den Zugriff');
});

test('CORS: Vary Origin gesetzt, damit nichts falsch gecacht wird', () => {
  assert.strictEqual(P.corsHeader('null').Vary, 'Origin');
});

test('CORS: der Zusatz-Header ist in Allow-Headers freigegeben', () => {
  // Ohne diese Freigabe schlaegt der Preflight der eigenen App fehl.
  assert.match(P.corsHeader('null')['Access-Control-Allow-Headers'],
    new RegExp(P.PROXY_HEADER));
});

// --- Setup-Seite -----------------------------------------------------------

test('Setup-Seite zeigt niemals ein gespeichertes Secret', async () => {
  const pfad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wallee-proxy-')), 'config.json');
  const geheim = 'c2VoclNlaHJHZWhlaW1lc1NlY3JldEhpZXI=';
  await P.speichereZugangsdaten({ userId: '42', secret: geheim }, pfad);

  const html = P.setupSeite({ gespeichert: true });
  assert.ok(!html.includes(geheim), 'Das Secret darf nirgends im HTML auftauchen');
  assert.match(html, /nicht angezeigt/, 'stattdessen ein Hinweis');
  assert.match(html, /type="password"/, 'Eingabefeld muss maskiert sein');
});

test('Setup-Seite meldet Fehler zurueck', () => {
  const html = P.setupSeite({ gespeichert: false, fehler: ['User-ID fehlt.'] });
  assert.match(html, /User-ID fehlt\./);
});

test('Setup-Seite maskiert HTML in Fehlermeldungen', () => {
  const html = P.setupSeite({ fehler: ['<script>alert(1)</script>'] });
  assert.ok(!html.includes('<script>alert(1)'), 'Fehlertext muss maskiert werden');
  assert.match(html, /&lt;script&gt;/);
});

// --- Durchreichen ----------------------------------------------------------

test('reicheDurch: JSON wird geparst', () => {
  const objekt = P.reicheDurch({ status: 200, text: '{"queryToken":"abc"}' });
  assert.strictEqual(objekt.queryToken, 'abc');
});

test('reicheDurch: Nicht-JSON wird als Rohtext verpackt statt zu werfen', () => {
  const objekt = P.reicheDurch({ status: 500, text: '<html>Fehler</html>' });
  assert.strictEqual(objekt.ok, false);
  assert.strictEqual(objekt.rohtext, '<html>Fehler</html>');
});
