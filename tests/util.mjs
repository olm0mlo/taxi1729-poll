// Utilità comuni alle prove: Playwright (installato nel progetto o globalmente) e percorsi relativi a tests/
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
function load() {
  try { return require('playwright'); } catch (e) {}
  for (const p of ['/opt/node22/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright', '/usr/lib/node_modules/playwright']) {
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error("Playwright non trovato: installalo con `npm i -D playwright` (e `npx playwright install chromium`)");
}
export const playwright = load();
export const here = (p) => fileURLToPath(new URL(p, import.meta.url));
fs.mkdirSync(here('.tmp'), { recursive: true });
