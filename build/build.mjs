// Baut das Standalone-Binary (Node Single Executable Application) fuer das
// aktuelle Betriebssystem. Laeuft lokal (macOS) und auf den GitHub-Actions-
// Runnern (macOS/Windows) gleichermassen - siehe .github/workflows/release.yml.
//
// Voraussetzung: Node >= 20. esbuild und postject werden per npx geholt
// (nur Build-Zeit; das fertige Binary hat keine Runtime-Dependency).
//
// Ablauf: entry.mjs + wallee-proxy.mjs zu einer CJS-Datei buendeln -> SEA-Blob
// erzeugen -> Node-Binary kopieren -> Signatur entfernen (macOS) -> Blob per
// postject einbetten -> ad-hoc neu signieren (macOS).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(wurzel, 'dist');
const istWin = process.platform === 'win32';
const istMac = process.platform === 'darwin';
const npx = istWin ? 'npx.cmd' : 'npx';
const binName = 'wallee-query-builder' + (istWin ? '.exe' : '');
const binPfad = path.join(dist, binName);
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function lauf(cmd, args, opts = {}) {
  console.log('  $', cmd, args.join(' '));
  execFileSync(cmd, args, { stdio: 'inherit', cwd: wurzel, ...opts });
}

fs.mkdirSync(dist, { recursive: true });

console.log('1/6 Buendeln (esbuild) ...');
lauf(npx, ['--yes', 'esbuild@0.24.0', 'build/entry.mjs',
  '--bundle', '--platform=node', '--format=cjs', '--outfile=dist/server.cjs']);

console.log('2/6 SEA-Blob erzeugen ...');
lauf(process.execPath, ['--experimental-sea-config', 'build/sea-config.json']);

console.log('3/6 Node-Binary kopieren ...');
fs.copyFileSync(process.execPath, binPfad);
if (!istWin) fs.chmodSync(binPfad, 0o755);

if (istMac) {
  // Node von nodejs.org/Homebrew ist oft ein Universal-Binary (x86_64+arm64).
  // Dann steht der SEA-Sentinel doppelt drin und postject bricht ab. Auf die
  // Host-Architektur reduzieren (lipo faellt bei schon-single-arch durch).
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  try {
    lauf('lipo', [binPfad, '-thin', arch, '-output', binPfad]);
  } catch (e) {
    console.log('  (lipo uebersprungen - Binary ist bereits single-arch)');
  }
  console.log('4/6 Signatur entfernen (macOS) ...');
  lauf('codesign', ['--remove-signature', binPfad]);
} else {
  console.log('4/6 (nur macOS) - uebersprungen');
}

console.log('5/6 Blob einbetten (postject) ...');
const postjectArgs = [binName, 'NODE_SEA_BLOB', 'sea.blob', '--sentinel-fuse', SEA_FUSE];
if (istMac) postjectArgs.push('--macho-segment-name', 'NODE_SEA');
lauf(npx, ['--yes', 'postject@1.0.0-alpha.6', ...postjectArgs], { cwd: dist });

if (istMac) {
  console.log('6/6 Ad-hoc-Signatur (macOS) ...');
  lauf('codesign', ['--sign', '-', binPfad]);
} else {
  console.log('6/6 (nur macOS) - uebersprungen');
}

console.log('\nFertig:', binPfad);
console.log('Groesse:', (fs.statSync(binPfad).size / 1e6).toFixed(1), 'MB');
