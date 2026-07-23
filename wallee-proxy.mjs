#!/usr/bin/env node
// Lokaler Proxy fuer den wallee Analytics Query Builder.
//
// Start:  node wallee-proxy.mjs
// Danach: http://localhost:8787/setup im Browser oeffnen und die Zugangsdaten
//         einmalig hinterlegen.
//
// WARUM ES DEN PROXY UEBERHAUPT BRAUCHT
// Zwei Gruende, die beide nicht im Browser loesbar sind:
//  1. CORS - app-wallee.com erlaubt keine Aufrufe aus einer lokalen HTML-Datei.
//  2. Das Secret. Die Analytics-API verlangt eine HMAC-Signatur. Im Browser
//     signieren hiesse, das Secret in die Seite zu legen; von dort kaeme es in
//     den localStorage, in den Verlauf, in jeden Screenshot. Der Proxy
//     signiert stattdessen hier, lokal, und gibt das Secret nie heraus.
//
// KEINE ABHAENGIGKEITEN - nur Node-Builtins. Kein npm install.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

// --- Konfiguration ---------------------------------------------------------

export const PORT = Number(process.env.WALLEE_PROXY_PORT || 8787);

// Bewusst nur 127.0.0.1, nicht 0.0.0.0: sonst haengt ein Dienst mit
// Zugangsdaten am ganzen Netz und jeder im selben WLAN koennte ihn ansprechen.
export const HOST = process.env.WALLEE_PROXY_HOST || '127.0.0.1';

export const API_BASE = process.env.WALLEE_API_BASE || 'https://app-wallee.com';

export const CONFIG_PATH = process.env.WALLEE_PROXY_CONFIG
  || path.join(os.homedir(), '.wallee-proxy.json');

// Alle API-Pfade tragen diesen Praefix, und genau so gehen sie auch in die
// Signatur ein (siehe baueToken).
export const API_PATH = '/api/v2.0';

// Analytics-Endpunkte, ausgelesen aus dem offiziellen python-sdk
// (wallee/service/analytics_queries_service.py). Der Token wird ueber den
// PFAD uebergeben, nicht als Query-Parameter.
export const API_PFADE = {
  submit: '/analytics/queries/submit',
  status: token => `/analytics/queries/queryToken/${encodeURIComponent(token)}`,
  result: token => `/analytics/queries/queryToken/${encodeURIComponent(token)}/result`,
  cancel: token => `/analytics/queries/queryToken/${encodeURIComponent(token)}`,
};

// Terminal-Endpunkt (REST, verifiziert am python-sdk payment_terminals_service.py):
//   GET /api/v2.0/payment/terminals  Header "Space: <id>", Cursor-Paginierung
//   ueber limit (max 100) + after=<letzte objId>, Antwort { data, hasMore, limit }.
// Der Query-String gehoert in den signierten requestPath (baueToken haengt pfad an),
// deshalb wird er hier deterministisch gebaut, damit Signatur und Fetch identisch sind.
export function terminalPfad({ limit = 100, after } = {}) {
  let pfad = `/payment/terminals?limit=${limit}&order=ASC`;
  if (after !== undefined && after !== null && Number(after) > 0) {
    pfad += `&after=${encodeURIComponent(after)}`;
  }
  return pfad;
}

// Ein wallee-PaymentTerminal auf die von der App benoetigten Felder eindampfen.
// identifier = der auf dem Geraet angezeigte Wert (in SQL pt.identifier),
// id = interne Objekt-ID (Cursor fuer die Paginierung).
export function mappeTerminal(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const idZahl = Number(o.id);
  return {
    identifier: o.identifier == null ? '' : String(o.identifier),
    name: o.name == null ? '' : String(o.name),
    id: Number.isFinite(idZahl) ? idZahl : null,
    state: o.state == null ? '' : String(o.state),
  };
}

// --- Zugangsdaten ----------------------------------------------------------
// Liegen ausschliesslich hier und in der Config-Datei. Sie gehen NIE an die
// App zurueck und werden NIE geloggt.

let zugangsdaten = null;

export function ladeZugangsdaten(pfad = CONFIG_PATH) {
  try {
    const roh = fs.readFileSync(pfad, 'utf8');
    const c = JSON.parse(roh);
    if (!c || !c.userId || !c.secret) return null;
    return { userId: String(c.userId), secret: String(c.secret), accountId: String(c.accountId || '') };
  } catch (e) {
    return null;
  }
}

export async function speichereZugangsdaten(werte, pfad = CONFIG_PATH) {
  const fehler = pruefeZugangsdaten(werte);
  if (fehler.length) return { ok: false, fehler };

  const inhalt = JSON.stringify({
    userId: String(werte.userId).trim(),
    secret: String(werte.secret).trim(),
    accountId: String(werte.accountId || '').trim(),
  }, null, 2);

  // mode 0o600 schon beim Anlegen mitgeben - ein nachtraegliches chmod liesse
  // die Datei fuer einen Moment lesbar fuer andere Konten auf dem Rechner.
  await fsp.writeFile(pfad, inhalt, { mode: 0o600 });
  await fsp.chmod(pfad, 0o600);        // falls die Datei schon existierte
  zugangsdaten = ladeZugangsdaten(pfad);
  return { ok: true, fehler: [] };
}

// Fuer die Anzeige im App-Dialog: userId/accountId sind keine Geheimnisse und
// duerfen zurueck; das Secret NIE - nur, ob eines hinterlegt ist.
export function credentialsAnzeige(daten) {
  const z = daten || {};
  return {
    userId: String(z.userId || ''),
    accountId: String(z.accountId || ''),
    hasSecret: !!(z.secret && String(z.secret).trim()),
  };
}

// Beim Speichern aus dem Dialog: ein leeres Secret bedeutet "unveraendert
// lassen". So kann der Nutzer userId/accountId aendern, ohne das Secret erneut
// eintippen zu muessen (er sieht es ohnehin nie).
export function mischeZugangsdaten(alt, neu) {
  const a = alt || {};
  const n = neu || {};
  const secretNeu = String(n.secret || '').trim();
  return {
    userId: String(n.userId || a.userId || '').trim(),
    accountId: String(n.accountId || a.accountId || '').trim(),
    secret: secretNeu || String(a.secret || ''),
  };
}

export function pruefeZugangsdaten(werte) {
  const fehler = [];
  const w = werte || {};
  if (!String(w.userId || '').trim()) fehler.push('User-ID fehlt.');
  else if (!/^\d+$/.test(String(w.userId).trim())) fehler.push('User-ID muss eine Zahl sein.');

  const secret = String(w.secret || '').trim();
  if (!secret) fehler.push('Secret fehlt.');
  else if (!/^[A-Za-z0-9+/]+={0,2}$/.test(secret) || secret.length < 16) {
    fehler.push('Secret sieht nicht nach einem Base64-Wert aus.');
  }

  // Account-ID ist fuer die Analytics-Endpunkte Pflicht (Header "Account").
  // Ohne sie antwortet wallee mit 400 account_invalid.
  const account = String(w.accountId || '').trim();
  if (!account) fehler.push('Account-ID fehlt.');
  else if (!/^\d+$/.test(account)) fehler.push('Account-ID muss eine Zahl sein.');

  return fehler;
}

// --- Self-Update ----------------------------------------------------------
// Die App und der Proxy tragen dieselbe Version; pro Release gebumpt (auch der
// <h1>-Badge in der HTML). Der Updater laedt ausschliesslich vom fest
// verdrahteten GitHub-Repo ueber HTTPS - Owner/Repo kommen NIE aus Eingaben.
export const APP_VERSION = '5.5.1';
export const UPDATE_REPO = { owner: 'saschakruesi', repo: 'wallee-query-builder' };
export const UPDATE_DATEIEN = ['wallee_query_builder.html', 'wallee-proxy.mjs'];

export function tagValide(tag) {
  return typeof tag === 'string' && /^v?\d+\.\d+\.\d+$/.test(tag);
}

export function updatePfad(tag, datei) {
  if (!tagValide(tag)) throw new Error('Ungueltiger Tag.');
  if (!UPDATE_DATEIEN.includes(datei)) throw new Error('Unerlaubte Datei.');
  const { owner, repo } = UPDATE_REPO;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(tag)}/${datei}`;
}

// Grobe Plausibilitaet der heruntergeladenen Dateien, bevor irgendetwas
// ueberschrieben wird - fangen z. B. eine GitHub-Fehlerseite statt der Datei ab.
export function sanityHtml(text) {
  return typeof text === 'string' && text.includes('<script id="app-logic">');
}
export function sanityProxy(text) {
  return typeof text === 'string' && text.includes('function starteServer');
}

// --- Authentifizierung -----------------------------------------------------
// Am offiziellen SDK verifiziert. Drei unabhaengige Implementierungen stimmen
// ueberein:
//   php-sdk        lib/Auth/HttpBearerAuth.php
//   python-sdk     wallee/api_client.py, _apply_auth_params
//   typescript-sdk src/auth/HttpBearerAuth.ts
//
// Es ist ein JWT-Bearer-Token, KEINE x-mac-*-Header. Die aelteren SDKs
// (magento-1, salesforce-cartridge) signieren noch per HMAC-SHA512 in
// x-mac-value; das ist das Legacy-Schema und hier bewusst nicht umgesetzt.
//
//   header  = { alg: "HS256", typ: "JWT", ver: 1 }
//   payload = { sub: "<userId>", iat: <unix-sekunden>,
//               requestPath: "/api/v2.0<pfad>", requestMethod: "GET" }
//   Schluessel = das BASE64-DEKODIERTE Secret, nicht die Zeichenkette selbst
//   Header     = Authorization: Bearer <token>

function base64url(wert) {
  return Buffer.from(wert).toString('base64url');
}

// Die eigentliche JWS-Operation, absichtlich getrennt: so laesst sie sich gegen
// den Testvektor aus RFC 7515 A.1 pruefen, statt nur gegen sich selbst.
// teile = "<base64url(header)>.<base64url(payload)>", schluessel = Rohbytes.
export function jwtSignatur(teile, schluessel) {
  return crypto.createHmac('sha256', schluessel).update(teile).digest('base64url');
}

export function baueToken({ userId, secret, methode, pfad, iat }) {
  const kopf = { alg: 'HS256', typ: 'JWT', ver: 1 };
  const inhalt = {
    // Das SDK setzt sub ausdruecklich als Zeichenkette (php castet, typescript
    // ruft toString auf).
    sub: String(userId),
    iat: iat === undefined ? Math.floor(Date.now() / 1000) : iat,
    requestPath: API_PATH + pfad,
    requestMethod: String(methode).toUpperCase(),
  };

  const teile = base64url(JSON.stringify(kopf)) + '.' + base64url(JSON.stringify(inhalt));
  const schluessel = Buffer.from(secret, 'base64');

  return `${teile}.${jwtSignatur(teile, schluessel)}`;
}

export function authHeader(argumente) {
  return { Authorization: `Bearer ${baueToken(argumente)}` };
}

// --- CORS und Missbrauchsschutz -------------------------------------------
// Ein lokaler Server ist von JEDER Webseite aus erreichbar, die der Nutzer
// offen hat. Ohne Schutz koennte eine beliebige Seite im Hintergrund
// http://localhost:8787/submit aufrufen und ueber die hinterlegten
// Zugangsdaten Transaktionsdaten abziehen. Zwei Riegel dagegen:
//
//  1. Herkunft: erlaubt sind nur "null" (die per file:// geoeffnete App) und
//     ausdruecklich konfigurierte Origins. Nicht "*".
//  2. Ein eigener Header (X-Wallee-Proxy). Den kann eine fremde Seite nicht
//     einfach mitschicken: sobald sie es versucht, macht der Browser erst
//     einen Preflight, und der schlaegt an Punkt 1 fehl. Einfache Formulare
//     oder <img>-Aufrufe kommen so gar nicht erst durch.

export const PROXY_HEADER = 'x-wallee-proxy';

export const ERLAUBTE_ORIGINS = new Set(
  (process.env.WALLEE_PROXY_ORIGINS || 'null')
    .split(',').map(s => s.trim()).filter(Boolean),
);

// Die eigenen Adressen des Proxys. Die Setup-Seite wird vom Proxy selbst
// ausgeliefert; ihr Formular-POST auf /setup ist damit same-origin und traegt
// die Herkunft des Proxys (z. B. http://localhost:8787). Ohne diese Origins
// wuerde der Missbrauchsschutz die eigene Setup-Seite abweisen. localhost und
// 127.0.0.1 sind beide dabei, weil der Nutzer die Seite unter beiden Namen
// oeffnen kann. Reingelassen wird trotzdem nur die eigene Herkunft - keine
// fremde Seite.
export function selbstOrigins(host = HOST, port = PORT) {
  const namen = new Set([host, 'localhost', '127.0.0.1']);
  const origins = new Set();
  namen.forEach(n => origins.add(`http://${n}:${port}`));
  return origins;
}

// Kommando, um den Default-Browser zu oeffnen - je Plattform. Rein, damit die
// Auswahl ohne echten Prozess getestet werden kann.
export function browserOeffnenBefehl(platform) {
  if (platform === 'darwin') return 'open';
  if (platform === 'win32') return 'start';
  return 'xdg-open';
}

export function originErlaubt(origin) {
  if (origin === undefined || origin === null || origin === '') return true;  // kein Browser
  return ERLAUBTE_ORIGINS.has(origin) || selbstOrigins().has(origin);
}

// privateNetwork: true setzt zusaetzlich Access-Control-Allow-Private-Network.
// Chrome (Private Network Access) verlangt diesen Header im Preflight, wenn eine
// Seite aus einem weniger privaten Kontext - insbesondere die per file://
// geoeffnete App - localhost anspricht. Fehlt er, blockiert Chrome den fetch
// komplett, noch bevor er beim Proxy ankommt. Nur im Preflight noetig und nur,
// wenn der Browser ihn ueber Access-Control-Request-Private-Network anfragt.
export function corsHeader(origin, { privateNetwork = false } = {}) {
  const kopf = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': `content-type, ${PROXY_HEADER}`,
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (origin && originErlaubt(origin)) kopf['Access-Control-Allow-Origin'] = origin;
  if (privateNetwork && origin && originErlaubt(origin)) {
    kopf['Access-Control-Allow-Private-Network'] = 'true';
  }
  return kopf;
}

// --- Routing ---------------------------------------------------------------

export function findeRoute(methode, pfad) {
  const m = String(methode || '').toUpperCase();
  const p = String(pfad || '').split('?')[0].replace(/\/+$/, '') || '/';

  if (m === 'OPTIONS') return { name: 'preflight' };
  // Die App selbst ausliefern (Standalone-Binary bzw. Serve-Betrieb). Damit laeuft
  // die Seite same-origin mit dem Proxy - kein CORS/PNA noetig.
  if (m === 'GET' && (p === '/' || p === '/app' || p === '/index.html')) return { name: 'app-seite' };
  if (m === 'GET' && p === '/health') return { name: 'health' };
  if (m === 'GET' && p === '/setup') return { name: 'setup-seite' };
  if (m === 'POST' && p === '/setup') return { name: 'setup-speichern' };
  if (m === 'GET' && p === '/credentials') return { name: 'credentials-lesen' };
  if (m === 'POST' && p === '/credentials') return { name: 'credentials-speichern' };
  if (m === 'POST' && p === '/submit') return { name: 'submit' };

  let treffer = /^\/status\/(.+)$/.exec(p);
  if (m === 'GET' && treffer) return { name: 'status', token: decodeURIComponent(treffer[1]) };

  treffer = /^\/result\/(.+)$/.exec(p);
  if (m === 'GET' && treffer) return { name: 'result', token: decodeURIComponent(treffer[1]) };

  treffer = /^\/query\/(.+)$/.exec(p);
  if (m === 'DELETE' && treffer) return { name: 'cancel', token: decodeURIComponent(treffer[1]) };

  if (m === 'GET' && p === '/terminals') {
    const query = String(pfad || '').split('?')[1] || '';
    const space = (new URLSearchParams(query).get('space') || '').trim();
    return { name: 'terminals', space };
  }

  if (m === 'POST' && p === '/update') return { name: 'update' };

  return { name: 'unbekannt' };
}

// --- Aufrufe an die wallee-API --------------------------------------------

async function rufeApi(methode, pfad, koerper, optionen = {}) {
  if (!zugangsdaten) {
    const e = new Error('Keine Zugangsdaten hinterlegt. Bitte /setup aufrufen.');
    e.status = 428;
    throw e;
  }

  const kopf = {
    ...authHeader({
      userId: zugangsdaten.userId,
      secret: zugangsdaten.secret,
      methode,
      pfad,
    }),
    // Der Ergebnis-Endpunkt liefert CSV als text/plain. Mit Accept
    // application/json antwortet wallee dort mit 406. Der Accept-Header ist
    // deshalb pro Aufruf setzbar; Default ist JSON fuer submit/status/cancel.
    Accept: optionen.accept || 'application/json',
  };
  // Analytics-Endpunkte verlangen die Account-ID als Header "Account" (im SDK:
  // AnalyticsQueriesService, headerParameters['Account']; ohne ihn antwortet
  // wallee mit 400 account_invalid); der Terminal-Endpunkt verlangt stattdessen
  // "Space: <id>" und kennt Account nicht. Ist optionen.space gesetzt, wird
  // Space gesendet und Account weggelassen. Keiner der Header ist Teil der
  // JWT-Signatur, deshalb genuegt es, ihn zusaetzlich zu setzen.
  if (optionen.space !== undefined && optionen.space !== null && optionen.space !== '') {
    kopf.Space = String(optionen.space);
  } else if (zugangsdaten.accountId) {
    kopf.Account = String(zugangsdaten.accountId);
  }
  if (koerper !== undefined) kopf['Content-Type'] = 'application/json';

  const antwort = await fetch(API_BASE + API_PATH + pfad, {
    method: methode,
    headers: kopf,
    body: koerper === undefined ? undefined : JSON.stringify(koerper),
  });

  const text = await antwort.text();
  return { status: antwort.status, text, headers: antwort.headers };
}

// Liest den Retry-After-Header (in Sekunden) aus einer wallee-Antwort. Der
// Status-Endpunkt liefert ihn bei 202 (noch in Bearbeitung). Faellt auf einen
// Standardwert zurueck, falls der Header fehlt oder unbrauchbar ist.
export function leseRetryAfter(headers, standard = 2) {
  try {
    const wert = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null;
    const n = parseInt(String(wert), 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 97) : standard;
  } catch (e) {
    return standard;
  }
}

// --- HTTP-Hilfen -----------------------------------------------------------

function sendeJson(res, status, objekt, origin) {
  const koerper = JSON.stringify(objekt);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(koerper),
    ...corsHeader(origin),
  });
  res.end(koerper);
}

function sendeText(res, status, text, typ, origin) {
  res.writeHead(status, {
    'Content-Type': typ,
    'Content-Length': Buffer.byteLength(text),
    ...corsHeader(origin),
  });
  res.end(text);
}

function leseKoerper(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((erfuellen, ablehnen) => {
    let daten = '';
    let laenge = 0;
    req.on('data', stueck => {
      laenge += stueck.length;
      if (laenge > maxBytes) {
        ablehnen(Object.assign(new Error('Anfrage zu gross.'), { status: 413 }));
        req.destroy();
        return;
      }
      daten += stueck;
    });
    req.on('end', () => erfuellen(daten));
    req.on('error', ablehnen);
  });
}

// --- Setup-Seite -----------------------------------------------------------
// Bewusst schlicht und ohne Assets. Zeigt NIE ein gespeichertes Secret an -
// nur, ob ueberhaupt schon etwas hinterlegt ist.

export function setupSeite({ gespeichert, meldung, fehler } = {}) {
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const meldungHtml = meldung ? `<p class="ok">${esc(meldung)}</p>` : '';
  const fehlerHtml = (fehler && fehler.length)
    ? `<ul class="fehler">${fehler.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : '';

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>wallee-Proxy – Zugangsdaten</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         max-width: 620px; margin: 40px auto; padding: 0 16px; color: #17302e; }
  h1 { font-size: 20px; }
  label { display: block; margin-top: 16px; font-size: 13px; color: #5b706e; }
  input { width: 100%; padding: 8px 10px; font-size: 14px; margin-top: 4px;
          border: 1px solid #cfdcda; border-radius: 6px; box-sizing: border-box; }
  button { margin-top: 20px; padding: 9px 18px; font-size: 14px; cursor: pointer;
           background: #11d9cc; border: none; border-radius: 6px; font-weight: 600; }
  .hint { font-size: 13px; color: #5b706e; line-height: 1.5; }
  .ok { background: #e6f9f7; border-left: 3px solid #0da69c; padding: 10px 12px; }
  .fehler { background: #fdecec; border-left: 3px solid #d64545; padding: 10px 12px 10px 30px; }
  .status { font-size: 13px; color: #5b706e; }
</style>
</head>
<body>
<h1>wallee-Proxy – Zugangsdaten</h1>

${meldungHtml}
${fehlerHtml}

<p class="hint">
  Diese Daten werden <strong>nur auf diesem Rechner</strong> gespeichert
  (<code>${esc(CONFIG_PATH)}</code>, nur für dich lesbar) und niemals an die
  Query-Builder-Seite zurückgegeben. Der Proxy signiert die Aufrufe damit selbst.
</p>

<p class="status">Aktuell hinterlegt: <strong>${gespeichert ? 'ja' : 'nein'}</strong>${
  gespeichert ? ' (Secret wird aus Sicherheitsgründen nicht angezeigt)' : ''}</p>

<form method="POST" action="/setup">
  <label>Application-User-ID
    <input name="userId" inputmode="numeric" autocomplete="off" required>
  </label>
  <label>Authentication-Key / Secret (Base64)
    <input name="secret" type="password" autocomplete="off" required>
  </label>
  <label>Account-ID
    <input name="accountId" inputmode="numeric" autocomplete="off" required>
  </label>
  <button type="submit">Speichern</button>
</form>

<p class="hint" style="margin-top:24px;">
  Die Werte findest du im wallee-Portal unter <em>Account &gt; Application Users</em>.
  Der Benutzer braucht Leserechte auf die Analytics-Abfragen.
</p>
</body>
</html>`;
}

// --- Anfragebehandlung -----------------------------------------------------

export async function behandleAnfrage(req, res) {
  const origin = req.headers.origin;
  const route = findeRoute(req.method, req.url);

  if (!originErlaubt(origin)) {
    sendeJson(res, 403, { ok: false, fehler: 'Herkunft nicht erlaubt.' }, undefined);
    return;
  }

  if (route.name === 'preflight') {
    // PNA-Header nur spiegeln, wenn der Browser ihn anfragt.
    const pna = req.headers['access-control-request-private-network'] === 'true';
    res.writeHead(204, corsHeader(origin, { privateNetwork: pna }));
    res.end();
    return;
  }

  // Die Setup-Seite wird direkt im Browser aufgerufen (kein fetch), deshalb
  // ohne den Zusatz-Header. Alles andere ist eine API und verlangt ihn.
  // Die App-Seite und die Setup-Seite werden direkt im Browser aufgerufen (kein
  // fetch), deshalb ohne den Zusatz-Header. Alles andere ist eine API.
  const brauchtHeader = !['app-seite', 'setup-seite', 'setup-speichern', 'health'].includes(route.name);
  if (brauchtHeader && req.headers[PROXY_HEADER] === undefined) {
    sendeJson(res, 403, {
      ok: false,
      fehler: `Header ${PROXY_HEADER} fehlt.`,
    }, origin);
    return;
  }

  try {
    switch (route.name) {
      case 'app-seite':
        sendeText(res, 200, ladeAppHtml(), 'text/html; charset=utf-8', origin);
        return;

      case 'health':
        sendeJson(res, 200, {
          ok: true,
          zugangsdaten: !!zugangsdaten,
          setupUrl: `http://${HOST}:${PORT}/setup`,
        }, origin);
        return;

      case 'setup-seite':
        sendeText(res, 200, setupSeite({ gespeichert: !!zugangsdaten }), 'text/html; charset=utf-8', origin);
        return;

      case 'setup-speichern': {
        const roh = await leseKoerper(req);
        const werte = Object.fromEntries(new URLSearchParams(roh));
        const ergebnis = await speichereZugangsdaten(werte);
        sendeText(res, ergebnis.ok ? 200 : 400, setupSeite({
          gespeichert: !!zugangsdaten,
          meldung: ergebnis.ok ? 'Gespeichert. Der Query Builder kann den Proxy jetzt nutzen.' : '',
          fehler: ergebnis.fehler,
        }), 'text/html; charset=utf-8', origin);
        return;
      }

      case 'credentials-lesen':
        sendeJson(res, 200, { ok: true, ...credentialsAnzeige(zugangsdaten) }, origin);
        return;

      case 'credentials-speichern': {
        const roh = await leseKoerper(req);
        let werte;
        try { werte = JSON.parse(roh); } catch (e) { werte = null; }
        if (!werte || typeof werte !== 'object' || Array.isArray(werte)) {
          sendeJson(res, 400, { ok: false, fehler: ['Ungueltiger JSON-Koerper.'] }, origin);
          return;
        }
        const gemischt = mischeZugangsdaten(zugangsdaten, werte);
        const ergebnis = await speichereZugangsdaten(gemischt);
        sendeJson(res, ergebnis.ok ? 200 : 400,
          { ok: ergebnis.ok, fehler: ergebnis.fehler }, origin);
        return;
      }

      case 'submit': {
        const roh = await leseKoerper(req);
        let sql;
        try { sql = JSON.parse(roh).sql; } catch (e) { sql = undefined; }
        if (!sql || !String(sql).trim()) {
          sendeJson(res, 400, { ok: false, fehler: 'Feld "sql" fehlt.' }, origin);
          return;
        }
        // Der Request-Body traegt das Feld "sql" (analytics_query_execution_request
        // im python-sdk, Property "sql"), nicht "query".
        //
        // wallee verlangt zusaetzlich einen queryExternalId als Query-Parameter -
        // eine vom Client vergebene ID, um die Query spaeter referenzieren zu
        // koennen. Im SDK ist er als optional markiert, der Server besteht aber
        // darauf. Wir erzeugen je Submit eine frische UUID. Sie geht in den PFAD,
        // damit rufeApi sie signiert UND sendet - waere sie nur an der URL, ohne
        // in der Signatur, wuerde die Auth fehlschlagen (wallee signiert die URL
        // inkl. Query).
        const externalId = crypto.randomUUID();
        const submitPfad = `${API_PFADE.submit}?queryExternalId=${encodeURIComponent(externalId)}`;
        const antwort = await rufeApi('POST', submitPfad, { sql: String(sql) });
        reicheWalleeDurch(res, antwort, origin, 'submit');
        return;
      }

      case 'status': {
        // Long-Polling laut Doku: 200 = Endzustand erreicht (Body traegt
        // status: SUCCESS/FAILED/CANCELLED), 202 = laeuft noch, mit Retry-After.
        // Die App entscheidet ueber den HTTP-Code, deshalb bleibt er erhalten.
        const antwort = await rufeApi('GET', API_PFADE.status(route.token));
        if (antwort.status === 202) {
          // Retry-After steht im Header; der Browser koennte ihn wegen CORS
          // nicht lesen, also ins JSON-Body legen.
          const roh = reicheDurch(antwort);
          const body = roh && typeof roh === 'object' ? roh : {};
          body.retryAfter = leseRetryAfter(antwort.headers);
          sendeJson(res, 202, body, origin);
          return;
        }
        reicheWalleeDurch(res, antwort, origin, 'status');
        return;
      }

      case 'result': {
        // Der Result-Endpunkt liefert NICHT das CSV, sondern eine kurzlebige
        // (5 Minuten) Download-URL - laut wallee-Doku und SDK (Rueckgabetyp str).
        // Die URL kommt als text/plain, deshalb muss Accept text/plain zulassen
        // (sonst 406). Jede URL-Erzeugung zaehlt bei wallee als Download, daher
        // ruft die App das nur bei Status SUCCESS auf.
        const antwort = await rufeApi('GET', API_PFADE.result(route.token), undefined,
          { accept: 'text/plain, application/json' });

        // 204 = Query lief durch, lieferte aber keine Zeilen. Leeres CSV zurueck.
        if (antwort.status === 204) {
          sendeText(res, 200, '', 'text/csv; charset=utf-8', origin);
          return;
        }
        // 202 = Ergebnis trotz SUCCESS noch nicht bereit. Der App sagen, sie
        // soll es gleich erneut versuchen.
        if (antwort.status === 202) {
          sendeJson(res, 202, { ok: false, fehler: 'Das Ergebnis ist noch nicht bereit.' }, origin);
          return;
        }
        if (antwort.status >= 400) {
          reicheWalleeDurch(res, antwort, origin, 'result');
          return;
        }

        const downloadUrl = extrahiereDownloadUrl(antwort.text);
        if (!/^https:\/\//.test(downloadUrl)) {
          console.error(`[wallee result] Keine Download-URL erhalten: ${String(antwort.text).slice(0, 300)}`);
          sendeJson(res, 502, { ok: false, fehler: 'wallee lieferte keine Download-URL für das Ergebnis.' }, origin);
          return;
        }

        // Die CSV-Datei von der signierten URL laden - server-seitig, ohne
        // Auth-Header (die URL traegt ihre eigene Signatur) und ohne den
        // Umweg ueber den Browser (der scheiterte sonst an CORS).
        const datei = await fetch(downloadUrl);
        if (!datei.ok) {
          sendeJson(res, 502, { ok: false,
            fehler: `Download des Ergebnisses fehlgeschlagen (Status ${datei.status}).` }, origin);
          return;
        }
        const csv = await datei.text();
        sendeText(res, 200, csv, 'text/csv; charset=utf-8', origin);
        return;
      }

      case 'cancel': {
        // Das SDK bricht per DELETE ab, nicht per POST.
        const antwort = await rufeApi('DELETE', API_PFADE.cancel(route.token));
        reicheWalleeDurch(res, antwort, origin, 'cancel');
        return;
      }

      case 'terminals': {
        // Terminals eines Space laden. wallee paginiert per Cursor (after=<id>),
        // hier wird intern durchgeblaettert, bis hasMore false ist, damit die App
        // in einem Aufruf die volle Liste bekommt.
        if (!/^\d+$/.test(route.space)) {
          sendeJson(res, 400, { ok: false, fehler: 'Query-Parameter "space" (Zahl) fehlt.' }, origin);
          return;
        }
        const gesammelt = [];
        let after;
        // Sicherheitsnetz gegen Endlosschleifen: max. 100 Seiten (= bis 10'000 Terminals).
        for (let seite = 0; seite < 100; seite++) {
          const antwort = await rufeApi('GET', terminalPfad({ limit: 100, after }), undefined,
            { space: route.space });
          if (antwort.status >= 400) {
            reicheWalleeDurch(res, antwort, origin, 'terminals');
            return;
          }
          const body = reicheDurch(antwort);
          const daten = body && Array.isArray(body.data) ? body.data : [];
          daten.forEach(t => gesammelt.push(mappeTerminal(t)));
          const letzte = daten.length ? daten[daten.length - 1] : null;
          if (!body || body.hasMore !== true || !letzte || letzte.id == null) break;
          after = letzte.id;
        }
        sendeJson(res, 200, { ok: true, terminals: gesammelt }, origin);
        return;
      }

      case 'update': {
        // Selbst-Update: neue Laufzeit-Dateien vom Release-Tag laden, pruefen,
        // ersetzen und den Proxy neu starten. Der Tag kommt von der App (die ihn
        // aus der GitHub-Releases-API hat) und wird streng validiert.
        const roh = await leseKoerper(req);
        let tag; try { tag = JSON.parse(roh).tag; } catch (e) { tag = undefined; }
        if (!tagValide(tag)) {
          sendeJson(res, 400, { ok: false, fehler: 'Ungueltiger oder fehlender Tag.' }, origin);
          return;
        }
        const verzeichnis = path.dirname(fileURLToPath(import.meta.url));
        const ziel = {
          verzeichnis,
          htmlPfad: path.join(verzeichnis, 'wallee_query_builder.html'),
          proxyPfad: path.join(verzeichnis, 'wallee-proxy.mjs'),
        };
        let ergebnis;
        try {
          ergebnis = await ladeUndSchreibeUpdate(tag, ziel);
        } catch (e) {
          sendeJson(res, e.status || 500, { ok: false, fehler: e.message || 'Update fehlgeschlagen.' }, origin);
          return;
        }
        // Erst antworten, dann neu starten - sonst sieht die App nie das ok.
        res.on('finish', () => { setTimeout(() => starteNeustart(ziel.verzeichnis), 150); });
        sendeJson(res, 200, { ok: true, restarting: true, ...ergebnis }, origin);
        return;
      }

      default:
        sendeJson(res, 404, { ok: false, fehler: 'Unbekannter Endpunkt.' }, origin);
    }
  } catch (fehler) {
    // Nie den Originalfehler durchreichen - er koennte Header oder URL mit
    // Signaturdaten enthalten.
    const status = fehler && fehler.status ? fehler.status : 502;
    sendeJson(res, status, {
      ok: false,
      fehler: status === 428
        ? 'Keine Zugangsdaten hinterlegt. Bitte /setup aufrufen.'
        : 'Der Aufruf an wallee ist fehlgeschlagen.',
    }, origin);
  }
}

// Zieht aus einer wallee-Fehlerantwort einen lesbaren Text. wallee liefert je
// nach Fehlerart unterschiedliche Formen (message, defaultMessage, detail, oder
// eine Liste von Validierungsfehlern). Der Text ist gefahrlos - er enthaelt die
// Fehlerbeschreibung, nicht die Signatur oder das Secret.
export function walleeFehlertext(body) {
  if (!body || typeof body !== 'object') return '';
  const kandidaten = [body.message, body.defaultMessage, body.detail, body.error, body.title];
  const treffer = kandidaten.find(x => typeof x === 'string' && x.trim());
  if (treffer) return treffer.trim();
  // Validierungsfehler kommen oft als Liste mit einzelnen Meldungen.
  if (Array.isArray(body.errors)) {
    const texte = body.errors.map(e => (e && (e.message || e.defaultMessage)) || '').filter(Boolean);
    if (texte.length) return texte.join('; ');
  }
  return '';
}

// Der Result-Endpunkt liefert eine Download-URL als Zeichenkette. Je nach
// Content-Type kommt sie als JSON-String ("https://...") oder als reiner Text
// (https://...). Beide Formen werden zur nackten URL aufgeloest.
export function extrahiereDownloadUrl(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return '';
  try {
    const parsed = JSON.parse(t);
    if (typeof parsed === 'string') return parsed.trim();
    if (parsed && typeof parsed === 'object') {
      return String(parsed.url || parsed.downloadUrl || parsed.href || '').trim();
    }
  } catch (e) {
    // kein JSON - dann ist der Rohtext bereits die URL
  }
  return t;
}

// Antworten der wallee-API moeglichst unveraendert weiterreichen, aber als
// JSON-Objekt, damit die App eine verlaessliche Form bekommt. Im Fehlerfall wird
// zusaetzlich ein lesbarer "fehler"-Text gesetzt, damit die App nicht nur den
// Statuscode zeigt.
export function reicheDurch(antwort) {
  let body;
  try {
    body = JSON.parse(antwort.text);
  } catch (e) {
    return { ok: antwort.status < 400, rohtext: antwort.text };
  }
  if (antwort.status >= 400 && body && typeof body === 'object' && body.fehler === undefined) {
    const text = walleeFehlertext(body);
    if (text) body.fehler = text;
  }
  return body;
}

// Reicht eine wallee-Antwort an die App weiter und protokolliert Fehler auf der
// Konsole (dem Terminal, in dem der Proxy laeuft), damit man die Ursache sieht,
// ohne dass Fehlertexte im Browser verloren gehen. Geloggt wird nur Status und
// Fehlerbeschreibung - nie Header, Signatur oder Secret.
function reicheWalleeDurch(res, antwort, origin, kontext) {
  const body = reicheDurch(antwort);
  if (antwort.status >= 400) {
    // Den vollen Rohtext der wallee-Antwort loggen, nicht nur die extrahierte
    // Meldung - so geht bei der Diagnose kein Detail verloren. Der Text ist die
    // Fehlerbeschreibung von wallee, nie Header/Signatur/Secret.
    const roh = String(antwort.text || '').slice(0, 800);
    console.error(`[wallee ${kontext}] Status ${antwort.status}: ${roh}`);
    // Bei Auth-Fehlern die Zeit ausgeben, mit der das Token signiert wurde.
    // wallee prueft den Zeitstempel gegen die Serverzeit; laeuft die lokale Uhr
    // zu weit ab, scheitert die Signatur trotz korrekter Zugangsdaten. Wenn die
    // hier gezeigte UTC-Zeit nicht zur echten Uhrzeit passt, ist das die Ursache.
    if (antwort.status === 401 || antwort.status === 403) {
      const jetzt = new Date();
      console.error(`[wallee ${kontext}] Signatur-Zeit dieses Rechners (UTC): `
        + `${jetzt.toISOString()} (${Math.floor(jetzt.getTime() / 1000)}). `
        + `Weicht sie von der echten Uhrzeit ab, ist die Systemuhr die Ursache.`);
    }
  }
  sendeJson(res, antwort.status, body, origin);
}

// --- Start -----------------------------------------------------------------

// Die App-HTML fuer die /-Route: aus der Datei neben diesem Script. Einmal
// gelesen und gecacht. So laesst sich die App same-origin vom Proxy laden
// (Doppelklick-Launcher, siehe Start-macOS.command / Start-Windows.bat).
let appHtmlCache = null;
function ladeAppHtml() {
  if (appHtmlCache !== null) return appHtmlCache;
  const datei = path.join(path.dirname(fileURLToPath(import.meta.url)), 'wallee_query_builder.html');
  appHtmlCache = fs.readFileSync(datei, 'utf8');
  return appHtmlCache;
}

// Den Browser nur auf Wunsch oeffnen (WALLEE_OPEN=1) - die Launcher setzen das,
// damit sich beim Doppelklick sofort die App zeigt. Ein blosses
// `node wallee-proxy.mjs` reisst so nicht ungefragt ein Fenster auf.
function sollBrowserOeffnen() {
  return process.env.WALLEE_OPEN === '1';
}

function oeffneBrowser(url) {
  try {
    if (process.platform === 'win32') {
      // Der leere erste Parameter ist der Fenstertitel, den `start` sonst aus der URL zieht.
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn(browserOeffnenBefehl(process.platform), [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) { /* Browser laesst sich nicht oeffnen - Nutzer oeffnet die URL selbst */ }
}

// Klartext-Meldung fuer Fehler beim Serverstart - allen voran der belegte Port
// (EADDRINUSE), damit statt eines Node-Stacktraces ein verstaendlicher Hinweis
// kommt (die Launcher richten sich an nicht-technische Nutzer). Rein, damit sie
// ohne echten Server getestet werden kann.
export function startFehlertext(err, host = HOST, port = PORT) {
  if (err && err.code === 'EADDRINUSE') {
    return `Port ${port} ist bereits belegt - vermutlich laeuft der Proxy schon. `
      + `Pruefe ${`http://${host}:${port}`}/health im Browser; ist er erreichbar, ist `
      + `kein zweiter Start noetig. Sonst den anderen Prozess auf Port ${port} beenden `
      + `oder mit der Umgebungsvariable WALLEE_PROXY_PORT einen anderen Port waehlen.`;
  }
  if (err && err.code === 'EACCES') {
    return `Keine Berechtigung, Port ${port} zu oeffnen. Bitte ueber WALLEE_PROXY_PORT `
      + `einen Port oberhalb von 1024 waehlen.`;
  }
  return `Server konnte nicht gestartet werden: ${err && err.message ? err.message : String(err)}`;
}

// Laedt die neuen Laufzeit-Dateien vom Release-Tag und ersetzt sie - aber erst,
// wenn ALLE Gates bestehen (nicht leer, Sanity, node --check). Vorher wird nichts
// ueberschrieben; die alten Dateien werden als <datei>.bak gesichert. Der neue
// Proxy-Code wird als .mjs-Temp geschrieben, damit `node --check` ihn als ES-Modul
// prueft. rename im selben Verzeichnis ist atomar.
export async function ladeUndSchreibeUpdate(tag, ziel) {
  const [htmlR, proxyR] = await Promise.all([
    fetch(updatePfad(tag, 'wallee_query_builder.html')),
    fetch(updatePfad(tag, 'wallee-proxy.mjs')),
  ]);
  if (!htmlR.ok || !proxyR.ok) { const e = new Error('Download vom Release fehlgeschlagen.'); e.status = 502; throw e; }
  const htmlText = await htmlR.text();
  const proxyText = await proxyR.text();
  if (!htmlText || !proxyText) { const e = new Error('Leere Datei vom Release erhalten.'); e.status = 502; throw e; }
  if (!sanityHtml(htmlText) || !sanityProxy(proxyText)) {
    const e = new Error('Heruntergeladene Dateien sehen nicht wie der Query Builder aus.'); e.status = 422; throw e;
  }
  // Neuen Proxy als .mjs-Temp schreiben und syntaktisch pruefen.
  const tmpProxy = path.join(ziel.verzeichnis, '.proxy-update.mjs');
  fs.writeFileSync(tmpProxy, proxyText);
  try {
    execFileSync(process.execPath, ['--check', tmpProxy], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    console.error('[update] node --check fehlgeschlagen:', err && err.stderr ? String(err.stderr) : (err && err.message) || err);
    try { fs.unlinkSync(tmpProxy); } catch (e2) {}
    const e = new Error('Neuer Proxy-Code ist fehlerhaft (node --check).'); e.status = 422; throw e;
  }
  // Backups (bewusst ueberschreibend - immer nur der letzte Stand).
  if (fs.existsSync(ziel.htmlPfad)) fs.copyFileSync(ziel.htmlPfad, ziel.htmlPfad + '.bak');
  if (fs.existsSync(ziel.proxyPfad)) fs.copyFileSync(ziel.proxyPfad, ziel.proxyPfad + '.bak');
  // Atomar ersetzen.
  const tmpHtml = path.join(ziel.verzeichnis, '.app-update.html');
  fs.writeFileSync(tmpHtml, htmlText);
  fs.renameSync(tmpHtml, ziel.htmlPfad);
  fs.renameSync(tmpProxy, ziel.proxyPfad);
  return { from: APP_VERSION, to: tag };
}

// Detached-Neustart: der Kindprozess wartet ueber WALLEE_RESTART_DELAY_MS, bis der
// Elternprozess seinen Port freigegeben hat (process.exit beendet ihn sofort).
export function starteNeustart(verzeichnis) {
  const skript = path.join(verzeichnis, 'wallee-proxy.mjs');
  spawn(process.execPath, [skript], {
    cwd: verzeichnis, detached: true, stdio: 'ignore',
    // WALLEE_OPEN explizit auf '0': location.reload() im Browser haengt sich bereits an den
    // bestehenden Tab, ein zusaetzliches Browser-Oeffnen durch den neu gestarteten Prozess
    // (WALLEE_OPEN=1 wird sonst vom Launcher geerbt) waere ein doppelter Tab.
    env: { ...process.env, WALLEE_OPEN: '0', WALLEE_RESTART_DELAY_MS: '1200' },
  }).unref();
  process.exit(0);
}

export function starteServer({ port = PORT, host = HOST } = {}) {
  zugangsdaten = ladeZugangsdaten();
  const server = http.createServer((req, res) => { behandleAnfrage(req, res); });
  // Ohne diesen Handler wirft ein Listen-Fehler (z. B. belegter Port) ein
  // unbehandeltes 'error'-Event und beendet den Prozess mit Stacktrace.
  server.on('error', (err) => {
    console.error(startFehlertext(err, host, port));
    process.exit(1);
  });
  const startenListen = () => server.listen(port, host, () => {
    const url = `http://${host}:${port}`;
    console.log(`wallee Query Builder laeuft auf ${url}`);
    console.log(zugangsdaten
      ? 'Zugangsdaten sind hinterlegt.'
      : `Noch keine Zugangsdaten. Im Browser unter ${url} das Zahnrad oeffnen und eintragen.`);
    if (sollBrowserOeffnen()) oeffneBrowser(url);
  });
  const verzoegerung = Number(process.env.WALLEE_RESTART_DELAY_MS) || 0;
  if (verzoegerung > 0) setTimeout(startenListen, verzoegerung); else startenListen();
  return server;
}

// Nur starten, wenn die Datei direkt aufgerufen wird - beim Import aus den
// Tests soll kein Server hochkommen.
const direktAufgerufen = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (direktAufgerufen) starteServer();
