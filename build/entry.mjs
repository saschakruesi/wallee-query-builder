// Einstiegspunkt fuer das gebaute Standalone-Binary (Node SEA).
// esbuild buendelt diese Datei samt wallee-proxy.mjs zu einer einzelnen CJS-Datei
// (dist/server.cjs), die dann als SEA-Main in das Node-Binary eingebettet wird.
// Hier wird der Server bewusst explizit gestartet - der Auto-Start in
// wallee-proxy.mjs greift im Binary nicht (siehe laeuftAlsBinary()).
import { starteServer } from '../wallee-proxy.mjs';

starteServer();
