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
  assert.strictEqual(gesehen.url, 'https://app-wallee.com/api/v2.0/analytics/queries/submit',
    'Pfad inkl. /api/v2.0-Praefix');
  assert.strictEqual(gesehen.opts.method, 'POST');
  assert.match(gesehen.opts.headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/,
    'JWT-Bearer-Header');
  assert.deepStrictEqual(JSON.parse(gesehen.opts.body), { sql: 'SELECT 1' },
    'Body traegt genau das Feld sql');

  // Und die Signatur im Token passt zum requestPath.
  const token = gesehen.opts.headers.Authorization.replace('Bearer ', '');
  const inhalt = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.strictEqual(inhalt.requestPath, '/api/v2.0/analytics/queries/submit');
  assert.strictEqual(inhalt.requestMethod, 'POST');
  assert.strictEqual(inhalt.sub, '12345');
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
