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
export function credentialsAnzeige(zugangsdaten) {
  const z = zugangsdaten || {};
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
  // Alle Analytics-Endpunkte verlangen die Account-ID als Header "Account"
  // (im SDK: AnalyticsQueriesService, headerParameters['Account']). Ohne ihn
  // antwortet wallee mit 400 account_invalid. Der Header ist NICHT Teil der
  // JWT-Signatur, deshalb genuegt es, ihn zusaetzlich zu setzen.
  if (zugangsdaten.accountId) kopf.Account = String(zugangsdaten.accountId);
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
  const brauchtHeader = !['setup-seite', 'setup-speichern', 'health'].includes(route.name);
  if (brauchtHeader && req.headers[PROXY_HEADER] === undefined) {
    sendeJson(res, 403, {
      ok: false,
      fehler: `Header ${PROXY_HEADER} fehlt.`,
    }, origin);
    return;
  }

  try {
    switch (route.name) {
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
        if (!werte || typeof werte !== 'object') {
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

export function starteServer({ port = PORT, host = HOST } = {}) {
  zugangsdaten = ladeZugangsdaten();
  const server = http.createServer((req, res) => { behandleAnfrage(req, res); });
  server.listen(port, host, () => {
    console.log(`wallee-Proxy laeuft auf http://${host}:${port}`);
    console.log(zugangsdaten
      ? 'Zugangsdaten sind hinterlegt.'
      : `Noch keine Zugangsdaten. Bitte http://${host}:${port}/setup oeffnen.`);
  });
  return server;
}

// Nur starten, wenn die Datei direkt aufgerufen wird - beim Import aus den
// Tests soll kein Server hochkommen.
const direktAufgerufen = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (direktAufgerufen) starteServer();
