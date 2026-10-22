#!/usr/bin/env node
/*
 * GitHub Actions helper: the 15-minute refresh deploys snapshots to GitHub Pages without committing
 * them, so the checked-out js/*Data.js can be older than what is live. Before the fetchers run, copy
 * each published snapshot over the local one when it is newer (by generatedAt). The fetchers then use
 * it as their "previous" data: failed sections keep the latest value, AAII is reused between its
 * Thursday releases, and ECOS official closes carry over.
 *
 *   node scripts/restore-published-snapshots.mjs [siteUrl]   (default: PAGES_URL env)
 *
 * Never fails the job: a missing or unreadable copy just leaves the local file as it is.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (process.argv[2] || process.env.PAGES_URL || '').replace(/\/+$/, '');
const FILES = [
  ['marketData.js', 'MARKET_DATA'],
  ['macroData.js', 'MACRO_DATA'],
  ['sectorData.js', 'SECTOR_DATA'],
  ['semiData.js', 'SEMI_DATA'],
];

function generatedAt(source, global) {
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(source, sandbox, { timeout: 2000 });
    const t = Date.parse(sandbox.window[global]?.generatedAt);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

async function main() {
  if (!SITE) { console.log('restore skipped: no site URL'); return; }
  for (const [file, global] of FILES) {
    const local = path.join(ROOT, 'js', file);
    try {
      const res = await fetch(`${SITE}/js/${file}?v=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const remote = await res.text();
      const remoteAt = generatedAt(remote, global);
      const localAt = generatedAt(await readFile(local, 'utf8').catch(() => ''), global);
      if (remoteAt && (!localAt || remoteAt > localAt)) {
        await writeFile(local, remote, 'utf8');
        console.log(`${file}: restored published snapshot (${new Date(remoteAt).toISOString()})`);
      } else {
        console.log(`${file}: kept checked-out snapshot`);
      }
    } catch (err) {
      console.log(`${file}: restore skipped (${err.message})`);
    }
  }
}

main();
