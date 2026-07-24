// Tests fuer den lokalen Proxy: Routing, Zugangsdaten-Pruefung, CORS und der
// Missbrauchsschutz. Alles ohne Netz und ohne laufenden Server.
//
// Die Authentifizierung ist gegen die offiziellen SDKs verifiziert (siehe den
// Abschnitt weiter unten) und die Signatur-Primitive zusaetzlich gegen den
// Testvektor aus RFC 7515.

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

test('Routing: die App-Seite wird unter / und /app ausgeliefert', () => {
  assert.strictEqual(P.findeRoute('GET', '/').name, 'app-seite');
  assert.strictEqual(P.findeRoute('GET', '/app').name, 'app-seite');
  assert.strictEqual(P.findeRoute('GET', '/index.html').name, 'app-seite');
});

test('browserOeffnenBefehl waehlt das OS-Kommando', () => {
  assert.strictEqual(P.browserOeffnenBefehl('darwin'), 'open');
  assert.strictEqual(P.browserOeffnenBefehl('win32'), 'start');
  assert.strictEqual(P.browserOeffnenBefehl('linux'), 'xdg-open');
  assert.strictEqual(P.browserOeffnenBefehl('freebsd'), 'xdg-open');
});

test('startFehlertext: belegter Port ergibt eine klare Meldung statt Stacktrace', () => {
  const belegt = P.startFehlertext({ code: 'EADDRINUSE' }, '127.0.0.1', 8787);
  assert.match(belegt, /8787/, 'Port wird genannt');
  assert.match(belegt, /bereits belegt|laeuft der Proxy schon/i, 'Ursache benannt');
  assert.match(belegt, /WALLEE_PROXY_PORT/, 'Hinweis auf den Ausweg-Port');

  const rechte = P.startFehlertext({ code: 'EACCES' }, '127.0.0.1', 80);
  assert.match(rechte, /Berechtigung/i, 'EACCES eigene Meldung');

  const sonst = P.startFehlertext({ message: 'irgendwas' }, '127.0.0.1', 8787);
  assert.match(sonst, /irgendwas/, 'unbekannter Fehler reicht die Message durch');
  assert.doesNotThrow(() => P.startFehlertext(null), 'null-Eingabe wirft nicht');
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

test('findeRoute erkennt /credentials GET und POST', () => {
  assert.strictEqual(P.findeRoute('GET', '/credentials').name, 'credentials-lesen');
  assert.strictEqual(P.findeRoute('POST', '/credentials').name, 'credentials-speichern');
  assert.strictEqual(P.findeRoute('GET', '/credentials?x=1').name, 'credentials-lesen');
});

test('Routing: /terminals wird erkannt und liest space aus dem Query', () => {
  const r = P.findeRoute('GET', '/terminals?space=73192');
  assert.strictEqual(r.name, 'terminals');
  assert.strictEqual(r.space, '73192');
  assert.strictEqual(P.findeRoute('GET', '/terminals').space, '', 'ohne space leerer String');
});

// --- Account pro Abfrage ----------------------------------------------------

test('apiKopfZusatz: Space schlaegt Account (Terminal-Endpunkt kennt Account nicht)', () => {
  assert.deepStrictEqual(
    P.apiKopfZusatz({ accountId: '52238' }, { space: '50161', account: '99999' }),
    { Space: '50161' },
  );
});

test('apiKopfZusatz: optionen.account ueberschreibt den konfigurierten Account', () => {
  assert.deepStrictEqual(
    P.apiKopfZusatz({ accountId: '52238' }, { account: '99999' }),
    { Account: '99999' },
  );
});

test('apiKopfZusatz: ohne Override gilt der Account aus den Zugangsdaten', () => {
  assert.deepStrictEqual(P.apiKopfZusatz({ accountId: '52238' }, {}), { Account: '52238' });
});

test('apiKopfZusatz: ohne alles bleibt der Header weg', () => {
  assert.deepStrictEqual(P.apiKopfZusatz({ accountId: '' }, {}), {});
});

test('accountValide nimmt nur Ziffern an', () => {
  assert.strictEqual(P.accountValide('52238'), true);
  assert.strictEqual(P.accountValide(''), false);
  assert.strictEqual(P.accountValide('52238; DROP'), false);
  assert.strictEqual(P.accountValide('abc'), false);
});

test('findeRoute liest den Account aus der Query von status und result', () => {
  assert.deepStrictEqual(
    P.findeRoute('GET', '/status/abc?account=52238'),
    { name: 'status', token: 'abc', account: '52238' },
  );
  assert.deepStrictEqual(
    P.findeRoute('GET', '/result/abc'),
    { name: 'result', token: 'abc', account: '' },
  );
});

test('terminalPfad: baut Pfad mit limit/order und optionalem after', () => {
  assert.strictEqual(P.terminalPfad(), '/payment/terminals?limit=100&order=ASC');
  assert.strictEqual(P.terminalPfad({ limit: 50 }), '/payment/terminals?limit=50&order=ASC');
  assert.strictEqual(P.terminalPfad({ after: 4711 }),
    '/payment/terminals?limit=100&order=ASC&after=4711');
  assert.strictEqual(P.terminalPfad({ limit: 100, after: 0 }),
    '/payment/terminals?limit=100&order=ASC', 'after=0 ist kein gueltiger Cursor und entfaellt');
});

test('mappeTerminal: liest identifier/name/id/state defensiv', () => {
  assert.deepStrictEqual(
    P.mappeTerminal({ identifier: '33024744', name: 'Kasse 1', id: 42, state: 'ACTIVE', extra: 'x' }),
    { identifier: '33024744', name: 'Kasse 1', id: 42, state: 'ACTIVE' });
  assert.deepStrictEqual(
    P.mappeTerminal({ identifier: '9' }),
    { identifier: '9', name: '', id: null, state: '' }, 'fehlende Felder werden neutralisiert');
  assert.deepStrictEqual(
    P.mappeTerminal(null),
    { identifier: '', name: '', id: null, state: '' }, 'null-Eingabe wirft nicht');
});

test('tagValide akzeptiert nur Semver-Tags', () => {
  assert.ok(P.tagValide('v5.5.0'));
  assert.ok(P.tagValide('5.5.0'));
  assert.ok(!P.tagValide('main'));
  assert.ok(!P.tagValide('5.5'));
  assert.ok(!P.tagValide('v5.5.0; rm -rf /'));
  assert.ok(!P.tagValide(''));
  assert.ok(!P.tagValide(undefined));
});

test('updatePfad baut die raw-URL nur fuer erlaubte Dateien', () => {
  assert.strictEqual(P.updatePfad('v5.5.0', 'wallee-proxy.mjs'),
    'https://raw.githubusercontent.com/saschakruesi/wallee-query-builder/v5.5.0/wallee-proxy.mjs');
  assert.strictEqual(P.updatePfad('v5.5.0', 'wallee_query_builder.html'),
    'https://raw.githubusercontent.com/saschakruesi/wallee-query-builder/v5.5.0/wallee_query_builder.html');
  assert.throws(() => P.updatePfad('main', 'wallee-proxy.mjs'), /Tag/);
  assert.throws(() => P.updatePfad('v5.5.0', '../secret'), /Datei/);
});

test('sanityHtml/sanityProxy erkennen die echten Dateien', () => {
  assert.ok(P.sanityHtml('<html><script id="app-logic">x</script>'));
  assert.ok(!P.sanityHtml('<html>nix</html>'));
  assert.ok(P.sanityProxy('export function starteServer(){}'));
  assert.ok(!P.sanityProxy('nur text'));
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
  assert.strictEqual(fehler.length, 3);
  assert.ok(fehler.some(f => /User-ID/.test(f)));
  assert.ok(fehler.some(f => /Secret/.test(f)));
  assert.ok(fehler.some(f => /Account-ID/.test(f)));
});

test('Zugangsdaten: nicht-numerische User-ID faellt auf', () => {
  const fehler = P.pruefeZugangsdaten({ userId: 'abc', secret: 'c2VjcmV0LXdlcnQtZnVlcg==' });
  assert.ok(fehler.some(f => /User-ID muss eine Zahl/.test(f)));
});

test('Zugangsdaten: Secret, das kein Base64 ist, faellt auf', () => {
  const fehler = P.pruefeZugangsdaten({ userId: '1', secret: 'nicht base64!!' });
  assert.ok(fehler.some(f => /Base64/.test(f)));
});

test('Zugangsdaten: Account-ID ist Pflicht (Analytics verlangt den Account-Header)', () => {
  const ohne = P.pruefeZugangsdaten({ userId: '1', secret: 'c2VjcmV0LXdlcnQtZnVlcg==' });
  assert.ok(ohne.some(f => /Account-ID fehlt/.test(f)), 'fehlende Account-ID muss auffallen');

  const falsch = P.pruefeZugangsdaten({ userId: '1', secret: 'c2VjcmV0LXdlcnQtZnVlcg==', accountId: 'x' });
  assert.ok(falsch.some(f => /Account-ID muss eine Zahl/.test(f)));

  const gut = P.pruefeZugangsdaten({ userId: '1', secret: 'c2VjcmV0LXdlcnQtZnVlcg==', accountId: '99001' });
  assert.deepStrictEqual(gut, []);
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

// --- Authentifizierung (JWT Bearer) ---------------------------------------
// Am offiziellen SDK verifiziert, drei unabhaengige Implementierungen stimmen
// ueberein (php-sdk lib/Auth/HttpBearerAuth.php, python-sdk wallee/api_client.py
// _apply_auth_params, typescript-sdk src/auth/HttpBearerAuth.ts):
//
//   payload = { sub: "<userId>", iat: <unix>, requestPath: "/api/v2.0<pfad>",
//               requestMethod: "GET" }
//   header  = { alg: "HS256", typ: "JWT", ver: 1 }
//   token   = JWT-HS256, signiert mit dem BASE64-DEKODIERTEN Secret
//   Header  = Authorization: Bearer <token>
//
// Die aelteren SDKs (magento-1, salesforce-cartridge) nutzen noch x-mac-*-Header
// mit HMAC-SHA512. Das ist das Legacy-Schema und hier bewusst nicht umgesetzt.

const crypto = require('node:crypto');

const TEST_SECRET = 'c2VjcmV0LXdlcnQtZnVlci1kZW4tdGVzdC1kZXItbGFuZy1nZW51Zy1pc3Q=';

function teileToken(token) {
  const [h, p, s] = token.split('.');
  const dek = teil => JSON.parse(Buffer.from(teil, 'base64url').toString('utf8'));
  return { kopf: dek(h), inhalt: dek(p), signatur: s, signiert: `${h}.${p}` };
}

test('JWT: Kopf entspricht dem SDK', () => {
  const { kopf } = teileToken(P.baueToken({
    userId: '12345', secret: TEST_SECRET, methode: 'GET',
    pfad: '/analytics/queries', iat: 1700000000,
  }));

  assert.strictEqual(kopf.alg, 'HS256');
  assert.strictEqual(kopf.typ, 'JWT');
  assert.strictEqual(kopf.ver, 1, 'das SDK setzt ein nicht-standardmaessiges ver:1');
});

test('JWT: Inhalt entspricht dem SDK', () => {
  const { inhalt } = teileToken(P.baueToken({
    userId: '12345', secret: TEST_SECRET, methode: 'GET',
    pfad: '/analytics/queries', iat: 1700000000,
  }));

  assert.strictEqual(inhalt.sub, '12345', 'sub ist eine Zeichenkette, nicht eine Zahl');
  assert.strictEqual(inhalt.iat, 1700000000);
  assert.strictEqual(inhalt.requestPath, '/api/v2.0/analytics/queries',
    'requestPath traegt den /api/v2.0-Praefix');
  assert.strictEqual(inhalt.requestMethod, 'GET');
});

test('JWT: Signatur laesst sich mit dem dekodierten Secret pruefen', () => {
  const token = P.baueToken({
    userId: '12345', secret: TEST_SECRET, methode: 'POST',
    pfad: '/analytics/queries/submit', iat: 1700000000,
  });
  const { signiert, signatur } = teileToken(token);

  // Der springende Punkt: der Schluessel ist das BASE64-DEKODIERTE Secret,
  // nicht die Zeichenkette selbst.
  const erwartet = crypto.createHmac('sha256', Buffer.from(TEST_SECRET, 'base64'))
    .update(signiert).digest('base64url');

  assert.strictEqual(signatur, erwartet);

  const falsch = crypto.createHmac('sha256', TEST_SECRET).update(signiert).digest('base64url');
  assert.notStrictEqual(signatur, falsch, 'das Secret darf nicht roh als Schluessel dienen');
});

test('JWT: base64url ohne Polsterung und ohne + /', () => {
  const token = P.baueToken({
    userId: '999999', secret: TEST_SECRET, methode: 'GET',
    pfad: '/analytics/queries/queryToken/ab+cd/result', iat: 1700000123,
  });

  assert.ok(!token.includes('='), 'keine Polsterung');
  assert.ok(!token.includes('+') && !token.includes('/'), 'base64url statt base64');
  assert.strictEqual(token.split('.').length, 3);
});

test('JWT: Query-String gehoert in den requestPath', () => {
  const { inhalt } = teileToken(P.baueToken({
    userId: '1', secret: TEST_SECRET, methode: 'GET',
    pfad: '/analytics/queries?spaceId=73192', iat: 1700000000,
  }));
  assert.strictEqual(inhalt.requestPath, '/api/v2.0/analytics/queries?spaceId=73192');
});

test('JWT: unterschiedliche Pfade ergeben unterschiedliche Signaturen', () => {
  const basis = { userId: '1', secret: TEST_SECRET, methode: 'GET', iat: 1700000000 };
  const a = P.baueToken({ ...basis, pfad: '/analytics/queries' });
  const b = P.baueToken({ ...basis, pfad: '/analytics/queries/submit' });
  assert.notStrictEqual(a, b, 'der Pfad muss in die Signatur eingehen');
});

test('Authorization-Header hat die Form "Bearer <token>"', () => {
  const kopf = P.authHeader({
    userId: '1', secret: TEST_SECRET, methode: 'GET', pfad: '/analytics/queries', iat: 1700000000,
  });
  assert.match(kopf.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
});

// --- API-Pfade -------------------------------------------------------------
// Aus dem python-sdk (wallee/service/analytics_queries_service.py) ausgelesen.

test('API-Pfade entsprechen dem SDK', () => {
  assert.strictEqual(P.API_PFADE.submit, '/analytics/queries/submit');
  assert.strictEqual(P.API_PFADE.status('abc'), '/analytics/queries/queryToken/abc');
  assert.strictEqual(P.API_PFADE.result('abc'), '/analytics/queries/queryToken/abc/result');
  assert.strictEqual(P.API_PFADE.cancel('abc'), '/analytics/queries/queryToken/abc');
});

test('API-Pfade kodieren den Token', () => {
  assert.strictEqual(P.API_PFADE.status('a/b'), '/analytics/queries/queryToken/a%2Fb');
});

test('JWT: Signatur-Primitive entspricht dem Testvektor aus RFC 7515 A.1', () => {
  // Unabhaengige Gegenprobe. Die Tests oben rechnen die Signatur mit derselben
  // Bibliothek nach und pruefen damit nur Konsistenz. Dieser Vektor stammt aus
  // dem RFC selbst und zeigt, dass base64url und HS256 wirklich standardkonform
  // sind - Kopf und Inhalt sind dort mit CRLF formatiert und lassen sich nicht
  // aus JSON.stringify herstellen, deshalb der direkte Weg ueber die Primitive.
  const teile = 'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9'
    + '.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ';
  const schluessel = Buffer.from(
    'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow',
    'base64url');

  assert.strictEqual(P.jwtSignatur(teile, schluessel),
    'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
});

// --- Ausgehende Anfrage an wallee (durch den Proxy) -----------------------
// Der kritischste Teil, weil hier zusammenkommt, was alles am SDK abgeleitet
// wurde: Pfad, JWT-Bearer und Body-Feld. Statt ins Netz zu gehen, wird das
// globale fetch gestubbt und die ausgehende Anfrage eingefangen. behandleAnfrage
// nutzt die intern hinterlegten Zugangsdaten - die setzt speichereZugangsdaten.

const http = require('node:http');

// Minimales req/res-Paar fuer behandleAnfrage.
function fakeReqRes({ method, url, body, origin }) {
  const req = new (require('node:events').EventEmitter)();
  req.method = method;
  req.url = url;
  req.headers = { 'x-wallee-proxy': '1' };
  if (origin) req.headers.origin = origin;

  const res = {
    _status: 0, _headers: {}, _body: '',
    writeHead(status, headers) { this._status = status; Object.assign(this._headers, headers || {}); },
    end(text) { this._body = text || ''; this._fertig = true; },
  };

  // Body nach dem naechsten Tick nachreichen, damit die Handler ihre
  // data/end-Listener registrieren koennen.
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(body));
    req.emit('end');
  });
  return { req, res };
}

function warteAufAntwort(res) {
  return new Promise(resolve => {
    const t = setInterval(() => { if (res._fertig) { clearInterval(t); resolve(res); } }, 2);
  });
}

test('Proxy /submit: ausgehende Anfrage an wallee stimmt (Pfad, JWT, Body)', async () => {
  const pfad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wallee-proxy-')), 'config.json');
  await P.speichereZugangsdaten(
    { userId: '12345', secret: 'c2VjcmV0LXdlcnQtZnVlci1kZW4tdGVzdC1sYW5nLWdlbnVn', accountId: '1' }, pfad);
  // Der Modulzustand liest die Zugangsdaten beim Serverstart; hier direkt neu laden.
  const zug = P.ladeZugangsdaten(pfad);

  // Globales fetch einfangen. Der Proxy signiert mit den intern hinterlegten
  // Zugangsdaten - die hat speichereZugangsdaten oben gesetzt.
  const original = globalThis.fetch;
  let gesehen = null;
  globalThis.fetch = async (url, opts) => {
    gesehen = { url, opts };
    return { status: 200, text: async () => '{"portalQueryToken":"tok-1","status":"PROCESSING"}',
      headers: new Map() };
  };

  try {
    const { req, res } = fakeReqRes({
      method: 'POST', url: '/submit', origin: 'null',
      body: JSON.stringify({ sql: 'SELECT 1' }),
    });
    await P.behandleAnfrage(req, res);
    await warteAufAntwort(res);
  } finally {
    globalThis.fetch = original;
  }

  assert.ok(gesehen, 'es haette ein Aufruf an wallee rausgehen muessen');
  const url = new URL(gesehen.url);
  assert.strictEqual(url.origin + url.pathname, 'https://app-wallee.com/api/v2.0/analytics/queries/submit',
    'Pfad inkl. /api/v2.0-Praefix');
  assert.ok(url.searchParams.get('queryExternalId'),
    'submit verlangt einen queryExternalId-Query-Parameter');
  assert.strictEqual(gesehen.opts.method, 'POST');
  assert.match(gesehen.opts.headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/,
    'JWT-Bearer-Header');
  assert.deepStrictEqual(JSON.parse(gesehen.opts.body), { sql: 'SELECT 1' },
    'Body traegt genau das Feld sql');
  assert.strictEqual(gesehen.opts.headers.Account, '1',
    'Account-Header muss gesetzt sein - alle Analytics-Endpunkte verlangen ihn');

  // Der entscheidende Punkt: der signierte requestPath muss GENAU dem
  // gesendeten Pfad inkl. Query entsprechen. wallee signiert die URL mit Query;
  // weicht die Signatur vom gesendeten Pfad ab, schlaegt die Auth fehl.
  const token = gesehen.opts.headers.Authorization.replace('Bearer ', '');
  const inhalt = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.strictEqual(inhalt.requestPath, '/api/v2.0' + url.pathname.replace('/api/v2.0', '') + url.search,
    'signierter Pfad muss den gesendeten Pfad inkl. Query exakt abbilden');
  assert.strictEqual(inhalt.requestMethod, 'POST');
  assert.strictEqual(inhalt.sub, '12345');
});

test('Proxy /terminals: Space-Header, signierter Pfad und Paginierung', async () => {
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wallee-proxy-')), 'config.json');
  await P.speichereZugangsdaten(
    { userId: '12345', secret: 'c2VjcmV0LXdlcnQtZnVlci1kZW4tdGVzdC1sYW5nLWdlbnVn', accountId: '1' }, cfg);
  P.ladeZugangsdaten(cfg);

  const original = globalThis.fetch;
  const aufrufe = [];
  globalThis.fetch = async (url, opts) => {
    aufrufe.push({ url, opts });
    // Erste Seite hasMore:true, zweite Seite hasMore:false.
    const erste = aufrufe.length === 1;
    return {
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify(erste
        ? { data: [{ identifier: '100', name: 'A', id: 1, state: 'ACTIVE' }], hasMore: true, limit: 1 }
        : { data: [{ identifier: '200', name: 'B', id: 2, state: 'ACTIVE' }], hasMore: false, limit: 1 }),
    };
  };

  let res;
  try {
    const paar = fakeReqRes({ method: 'GET', url: '/terminals?space=73192', origin: 'null' });
    await P.behandleAnfrage(paar.req, paar.res);
    res = await warteAufAntwort(paar.res);
  } finally {
    globalThis.fetch = original;
  }

  assert.strictEqual(aufrufe.length, 2, 'zwei Seiten wegen hasMore');
  const u0 = new URL(aufrufe[0].url);
  assert.strictEqual(u0.origin + u0.pathname, 'https://app-wallee.com/api/v2.0/payment/terminals');
  assert.strictEqual(aufrufe[0].opts.headers.Space, '73192', 'Space-Header statt Account');
  assert.strictEqual(aufrufe[0].opts.headers.Account, undefined, 'kein Account-Header fuer Terminals');
  // Zweite Seite muss den after-Cursor der letzten id der ersten Seite tragen.
  assert.match(String(aufrufe[1].url), /after=1/, 'Cursor after=<letzte id>');

  const body = JSON.parse(res._body);
  assert.strictEqual(body.ok, true);
  assert.deepStrictEqual(body.terminals.map(t => t.identifier), ['100', '200'], 'beide Seiten aggregiert');
});

test('Proxy /terminals: fehlender space ergibt 400', async () => {
  const paar = fakeReqRes({ method: 'GET', url: '/terminals', origin: 'null' });
  await P.behandleAnfrage(paar.req, paar.res);
  const res = await warteAufAntwort(paar.res);
  assert.strictEqual(res._status, 400);
  assert.match(JSON.parse(res._body).fehler, /space/i);
});

// --- Selbst-Herkunft der Setup-Seite --------------------------------------
// Die Setup-Seite wird vom Proxy ausgeliefert; ihr Formular-POST auf /setup ist
// same-origin und traegt die Herkunft des Proxys. Diese muss erlaubt sein,
// sonst weist der Proxy seine eigene Seite ab (der Fall "Herkunft nicht
// erlaubt." beim Speichern).

test('Selbst-Herkunft: die eigene Adresse des Proxys ist erlaubt', () => {
  assert.strictEqual(P.originErlaubt('http://localhost:8787'), true);
  assert.strictEqual(P.originErlaubt('http://127.0.0.1:8787'), true);
});

test('Selbst-Herkunft: fremde Seiten bleiben abgewiesen', () => {
  // Gleicher Host, anderer Port ist NICHT der Proxy - bleibt draussen.
  assert.strictEqual(P.originErlaubt('http://localhost:3000'), false);
  assert.strictEqual(P.originErlaubt('https://boese.example'), false);
  // Auch die eigene Adresse ueber https (nicht das, was der Proxy spricht).
  assert.strictEqual(P.originErlaubt('https://localhost:8787'), false);
});

test('selbstOrigins deckt localhost und 127.0.0.1 am Proxy-Port ab', () => {
  const o = P.selbstOrigins('127.0.0.1', 8787);
  assert.ok(o.has('http://localhost:8787'));
  assert.ok(o.has('http://127.0.0.1:8787'));
});

// --- Private Network Access (Chrome) --------------------------------------
// Eine per file:// geoeffnete Seite, die localhost anspricht, loest in Chrome
// einen PNA-Preflight aus. Antwortet der nicht mit Allow-Private-Network,
// blockiert Chrome den fetch komplett - die App-Anfrage kommt gar nicht erst
// beim Proxy an ("nichts passiert").

test('Preflight mit PNA-Anfrage bekommt Allow-Private-Network', () => {
  const kopf = P.corsHeader('null', { privateNetwork: true });
  assert.strictEqual(kopf['Access-Control-Allow-Private-Network'], 'true');
  assert.strictEqual(kopf['Access-Control-Allow-Origin'], 'null');
});

test('ohne PNA-Anfrage kein Allow-Private-Network (nicht unnoetig setzen)', () => {
  const kopf = P.corsHeader('null');
  assert.ok(!('Access-Control-Allow-Private-Network' in kopf));
});

test('PNA nur fuer erlaubte Herkunft', () => {
  const kopf = P.corsHeader('https://boese.example', { privateNetwork: true });
  assert.ok(!('Access-Control-Allow-Private-Network' in kopf),
    'einer fremden Seite wird auch PNA nicht zugestanden');
});

// --- Fehlertext aus wallee-Antworten --------------------------------------
// Ohne Aufbereitung sieht die App nur den Statuscode. Der Proxy zieht wallees
// Meldung heraus, damit die Ursache sichtbar wird.

test('walleeFehlertext: message wird erkannt', () => {
  assert.strictEqual(P.walleeFehlertext({ message: 'Invalid SQL near LIMIT' }),
    'Invalid SQL near LIMIT');
});

test('walleeFehlertext: weitere uebliche Felder', () => {
  assert.strictEqual(P.walleeFehlertext({ defaultMessage: 'Bad' }), 'Bad');
  assert.strictEqual(P.walleeFehlertext({ detail: 'Detail' }), 'Detail');
});

test('walleeFehlertext: Liste von Validierungsfehlern', () => {
  assert.strictEqual(
    P.walleeFehlertext({ errors: [{ message: 'A' }, { message: 'B' }] }),
    'A; B');
});

test('walleeFehlertext: nichts Brauchbares ergibt leeren String', () => {
  assert.strictEqual(P.walleeFehlertext({ irgendwas: 1 }), '');
  assert.strictEqual(P.walleeFehlertext(null), '');
});

test('reicheDurch setzt fehler-Text bei Statusfehlern', () => {
  const obj = P.reicheDurch({ status: 400, text: JSON.stringify({ message: 'Query rejected' }) });
  assert.strictEqual(obj.fehler, 'Query rejected',
    'die App liest d.fehler - der muss aus wallees message kommen');
});

test('reicheDurch laesst Erfolgsantworten unangetastet', () => {
  const obj = P.reicheDurch({ status: 200, text: JSON.stringify({ portalQueryToken: 'tok', status: 'PROCESSING' }) });
  assert.strictEqual(obj.portalQueryToken, 'tok');
  assert.ok(!('fehler' in obj));
});

// --- Accept-Header je Endpunkt --------------------------------------------
// Der Ergebnis-Endpunkt liefert CSV als text/plain. Mit Accept application/json
// antwortet wallee mit 406. submit/status/cancel bleiben bei JSON.

async function fangeAusgang(url, method, body) {
  const original = globalThis.fetch;
  let gesehen = null;
  globalThis.fetch = async (u, o) => {
    gesehen = { url: u, opts: o };
    return { status: 200, text: async () => 'a,b\n1,2\n', headers: new Map() };
  };
  const pfad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wallee-proxy-')), 'config.json');
  await P.speichereZugangsdaten(
    { userId: '12345', secret: 'c2VjcmV0LXdlcnQtZnVlci1kZW4tdGVzdC1sYW5n', accountId: '1' }, pfad);
  try {
    const { req, res } = fakeReqRes({ method, url, origin: 'null', body });
    await P.behandleAnfrage(req, res);
    await warteAufAntwort(res);
  } finally {
    globalThis.fetch = original;
  }
  return gesehen;
}

test('result: Accept laesst text/plain zu (sonst 406)', async () => {
  const g = await fangeAusgang('/result/tok-1', 'GET');
  assert.ok(/text\/plain/.test(g.opts.headers.Accept),
    `Accept muss text/plain enthalten, war: ${g.opts.headers.Accept}`);
});

test('status: Accept bleibt JSON', async () => {
  const g = await fangeAusgang('/status/tok-1', 'GET');
  assert.strictEqual(g.opts.headers.Accept, 'application/json');
});

test('submit: Accept bleibt JSON', async () => {
  const g = await fangeAusgang('/submit', 'POST', JSON.stringify({ sql: 'SELECT 1' }));
  assert.strictEqual(g.opts.headers.Accept, 'application/json');
});

// --- Ergebnis-Abruf: zweistufig (URL erzeugen, dann herunterladen) --------
// Der Result-Endpunkt liefert eine kurzlebige Download-URL, nicht das CSV. Der
// Proxy muss die URL herunterladen und das CSV an die App zurueckgeben.

test('extrahiereDownloadUrl: JSON-String, Rohtext und Objekt', () => {
  assert.strictEqual(P.extrahiereDownloadUrl('"https://dl.example/f.csv"'), 'https://dl.example/f.csv');
  assert.strictEqual(P.extrahiereDownloadUrl('https://dl.example/f.csv'), 'https://dl.example/f.csv');
  assert.strictEqual(P.extrahiereDownloadUrl('{"url":"https://dl.example/f.csv"}'), 'https://dl.example/f.csv');
  assert.strictEqual(P.extrahiereDownloadUrl(''), '');
});

// Router-fetch: erst die wallee-Result-Antwort (eine URL), dann der Download.
async function ergebnisLauf({ resultStatus = 200, resultBody, downloadStatus = 200, csv = 'a,b\n1,2\n' }) {
  const original = globalThis.fetch;
  const rufe = [];
  globalThis.fetch = async (u, o) => {
    rufe.push({ url: String(u), opts: o });
    if (String(u).includes('/queryToken/')) {
      return { status: resultStatus, ok: resultStatus < 400,
        text: async () => (resultBody !== undefined ? resultBody : '"https://dl.example/result.csv"'),
        headers: new Map() };
    }
    // Download der signierten URL
    return { status: downloadStatus, ok: downloadStatus < 400, text: async () => csv, headers: new Map() };
  };
  const pfad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wallee-proxy-')), 'config.json');
  await P.speichereZugangsdaten(
    { userId: '12345', secret: 'c2VjcmV0LXdlcnQtZnVlci1kZW4tdGVzdC1sYW5n', accountId: '1' }, pfad);
  const { req, res } = fakeReqRes({ method: 'GET', url: '/result/tok-1', origin: 'null' });
  try {
    await P.behandleAnfrage(req, res);
    await warteAufAntwort(res);
  } finally {
    globalThis.fetch = original;
  }
  return { res, rufe };
}

test('result: laedt die Download-URL und gibt das CSV zurueck', async () => {
  const { res, rufe } = await ergebnisLauf({ csv: 'terminal,brutto\nT1,10.00\n' });

  // Zwei Aufrufe: Result-Endpunkt (URL) und der Download selbst.
  assert.strictEqual(rufe.length, 2);
  assert.ok(rufe[0].url.includes('/analytics/queries/queryToken/tok-1/result'));
  assert.strictEqual(rufe[1].url, 'https://dl.example/result.csv', 'die zurueckgegebene URL wird geladen');

  assert.strictEqual(res._status, 200);
  assert.match(res._headers['Content-Type'], /text\/csv/);
  assert.strictEqual(res._body, 'terminal,brutto\nT1,10.00\n', 'die App bekommt das CSV, nicht die URL');
});

test('result: Download-URL wird ohne Auth-Header geladen (signierte URL)', async () => {
  const { rufe } = await ergebnisLauf({});
  const download = rufe[1];
  assert.ok(!download.opts || !download.opts.headers || !download.opts.headers.Authorization,
    'die signierte URL darf keinen Bearer-Header bekommen');
});

test('result: 204 (keine Daten) ergibt leeres CSV, kein zweiter Abruf', async () => {
  const { res, rufe } = await ergebnisLauf({ resultStatus: 204, resultBody: '' });
  assert.strictEqual(rufe.length, 1, 'ohne Daten kein Download');
  assert.strictEqual(res._status, 200);
  assert.strictEqual(res._body, '');
});

test('result: 202 (noch nicht bereit) wird als solches gemeldet', async () => {
  const { res, rufe } = await ergebnisLauf({ resultStatus: 202, resultBody: '' });
  assert.strictEqual(rufe.length, 1);
  assert.strictEqual(res._status, 202);
  assert.match(res._body, /noch nicht bereit/);
});

test('result: unerwartete Antwort statt URL ergibt 502, kein Download', async () => {
  const { res, rufe } = await ergebnisLauf({ resultBody: 'kein-link' });
  assert.strictEqual(rufe.length, 1, 'ohne gueltige URL kein Download');
  assert.strictEqual(res._status, 502);
});

// --- Status-Polling: 202 + Retry-After ------------------------------------
// Der Status-Endpunkt long-pollt: 200 = fertig, 202 = laeuft noch (mit
// Retry-After). Der Proxy erhaelt den HTTP-Code und reicht Retry-After im Body
// weiter, weil der Browser den Header wegen CORS nicht lesen koennte.

test('leseRetryAfter: Header wird gelesen, sonst Standard', () => {
  assert.strictEqual(P.leseRetryAfter(new Map([['retry-after', '5']])), 5);
  assert.strictEqual(P.leseRetryAfter(new Map()), 2, 'Standard bei fehlendem Header');
  assert.strictEqual(P.leseRetryAfter(new Map([['retry-after', 'abc']])), 2);
  assert.strictEqual(P.leseRetryAfter(new Map([['retry-after', '999']])), 97, 'auf Long-Poll-Timeout gedeckelt');
});

async function statusLauf({ status, body, retryAfterHeader }) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    status,
    ok: status < 400,
    text: async () => (body !== undefined ? body : '{}'),
    headers: new Map(retryAfterHeader ? [['retry-after', retryAfterHeader]] : []),
  });
  const pfad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wallee-proxy-')), 'config.json');
  await P.speichereZugangsdaten(
    { userId: '12345', secret: 'c2VjcmV0LXdlcnQtZnVlci1kZW4tdGVzdC1sYW5n', accountId: '1' }, pfad);
  const { req, res } = fakeReqRes({ method: 'GET', url: '/status/tok-1', origin: 'null' });
  try {
    await P.behandleAnfrage(req, res);
    await warteAufAntwort(res);
  } finally {
    globalThis.fetch = original;
  }
  return res;
}

test('status 202: HTTP-Code bleibt 202, Retry-After landet im Body', async () => {
  const res = await statusLauf({ status: 202, body: '{"status":"PROCESSING"}', retryAfterHeader: '5' });
  assert.strictEqual(res._status, 202);
  const body = JSON.parse(res._body);
  assert.strictEqual(body.retryAfter, 5);
  assert.strictEqual(body.status, 'PROCESSING');
});

test('status 200: Endzustand wird unveraendert durchgereicht', async () => {
  const res = await statusLauf({ status: 200, body: '{"status":"SUCCESS","portalQueryToken":"tok-1"}' });
  assert.strictEqual(res._status, 200);
  assert.strictEqual(JSON.parse(res._body).status, 'SUCCESS');
});

// --- Anzeige und Aenderung von Zugangsdaten --------------------------------

test('credentialsAnzeige gibt das Secret nie preis', () => {
  const z = { userId: '42', secret: 'AAAAAAAAAAAAAAAA', accountId: '99' };
  assert.deepStrictEqual(P.credentialsAnzeige(z), { userId: '42', accountId: '99', hasSecret: true });
});

test('credentialsAnzeige vertraegt null', () => {
  assert.deepStrictEqual(P.credentialsAnzeige(null), { userId: '', accountId: '', hasSecret: false });
});

test('mischeZugangsdaten behaelt altes Secret bei leerer Eingabe', () => {
  const alt = { userId: '1', secret: 'OLDSECRETOLDSECRET', accountId: '2' };
  const neu = { userId: '1', secret: '   ', accountId: '2' };
  assert.strictEqual(P.mischeZugangsdaten(alt, neu).secret, 'OLDSECRETOLDSECRET');
});

test('mischeZugangsdaten uebernimmt neues Secret bei Eingabe', () => {
  const alt = { userId: '1', secret: 'OLDSECRETOLDSECRET', accountId: '2' };
  const neu = { userId: '1', secret: 'NEWSECRETNEWSECRET', accountId: '2' };
  assert.strictEqual(P.mischeZugangsdaten(alt, neu).secret, 'NEWSECRETNEWSECRET');
});

// --- Selbst-Update -----------------------------------------------------

test('Routing: POST /update wird erkannt', () => {
  assert.strictEqual(P.findeRoute('POST', '/update').name, 'update');
});

test('ladeUndSchreibeUpdate: Erfolg schreibt Dateien und legt Backups an', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallee-update-'));
  const ziel = {
    verzeichnis: dir,
    htmlPfad: path.join(dir, 'wallee_query_builder.html'),
    proxyPfad: path.join(dir, 'wallee-proxy.mjs'),
  };
  fs.writeFileSync(ziel.htmlPfad, 'ALT-HTML');
  fs.writeFileSync(ziel.proxyPfad, 'ALT-PROXY');

  const original = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true, status: 200,
    text: async () => String(url).endsWith('.html')
      ? '<html><script id="app-logic">neu</script></html>'
      : 'export function starteServer(){ /* neu */ }',
  });
  try {
    const r = await P.ladeUndSchreibeUpdate('v5.6.0', ziel);
    assert.strictEqual(r.to, 'v5.6.0');
    assert.match(fs.readFileSync(ziel.htmlPfad, 'utf8'), /app-logic/);
    assert.match(fs.readFileSync(ziel.proxyPfad, 'utf8'), /starteServer/);
    assert.strictEqual(fs.readFileSync(ziel.htmlPfad + '.bak', 'utf8'), 'ALT-HTML');
    assert.strictEqual(fs.readFileSync(ziel.proxyPfad + '.bak', 'utf8'), 'ALT-PROXY');
  } finally { globalThis.fetch = original; }
});

test('ladeUndSchreibeUpdate: Download-Fehler laesst Dateien unveraendert (502)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallee-update-'));
  const ziel = { verzeichnis: dir,
    htmlPfad: path.join(dir, 'wallee_query_builder.html'),
    proxyPfad: path.join(dir, 'wallee-proxy.mjs') };
  fs.writeFileSync(ziel.htmlPfad, 'ALT'); fs.writeFileSync(ziel.proxyPfad, 'ALT');
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
  try {
    await assert.rejects(() => P.ladeUndSchreibeUpdate('v5.6.0', ziel), e => e.status === 502);
    assert.strictEqual(fs.readFileSync(ziel.htmlPfad, 'utf8'), 'ALT', 'unveraendert');
  } finally { globalThis.fetch = original; }
});

test('ladeUndSchreibeUpdate: kaputter Proxy faellt an node --check durch (422)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallee-update-'));
  const ziel = { verzeichnis: dir,
    htmlPfad: path.join(dir, 'wallee_query_builder.html'),
    proxyPfad: path.join(dir, 'wallee-proxy.mjs') };
  fs.writeFileSync(ziel.htmlPfad, 'ALT'); fs.writeFileSync(ziel.proxyPfad, 'ALT');
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true, status: 200,
    text: async () => String(url).endsWith('.html')
      ? '<script id="app-logic">x</script>'
      : 'function starteServer(){ (((  // Syntaxfehler, passt aber die Sanity',
  });
  try {
    await assert.rejects(() => P.ladeUndSchreibeUpdate('v5.6.0', ziel), e => e.status === 422);
    assert.strictEqual(fs.readFileSync(ziel.proxyPfad, 'utf8'), 'ALT', 'unveraendert');
  } finally { globalThis.fetch = original; }
});

test('/update ohne X-Wallee-Proxy-Header wird abgelehnt (403, gleicher Schutz wie /submit)', async () => {
  // Bewusst nicht fakeReqRes() - der setzt den Header immer. Minimaler req/res
  // ohne den Header, um das Gate selbst zu pruefen (nicht nur den Helper).
  const req = new (require('node:events').EventEmitter)();
  req.method = 'POST';
  req.url = '/update';
  req.headers = { origin: 'null' }; // kein x-wallee-proxy

  const res = {
    _status: 0, _headers: {}, _body: '',
    writeHead(status, headers) { this._status = status; Object.assign(this._headers, headers || {}); },
    end(text) { this._body = text || ''; this._fertig = true; },
  };
  setImmediate(() => { req.emit('end'); });

  await P.behandleAnfrage(req, res);
  await new Promise(resolve => {
    const t = setInterval(() => { if (res._fertig) { clearInterval(t); resolve(); } }, 2);
  });

  assert.strictEqual(res._status, 403, 'ohne den Header muss /update wie /submit blockiert werden');
  assert.match(res._body, /x-wallee-proxy/i, 'Fehlermeldung soll den fehlenden Header benennen');
});
