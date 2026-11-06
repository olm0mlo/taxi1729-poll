// Lancia tutte le prove una dopo l'altra e alla fine dice quali sono passate.
// Uso, dalla cartella principale del progetto:  node tests/tutte.mjs
// Per lanciarne solo alcune:                   node tests/tutte.mjs voti telefoni
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROVE = [
  ['voti', 'Conteggio dei voti (server)'],
  ['telefoni', 'Telefoni e riconnessioni'],
  ['grafici', 'Grafici delle slide'],
  ['proiezione', 'Add-in in proiezione'],
  ['anteprime', 'Anteprime di add-in e pannello']
];
const scelte = process.argv.slice(2);
const daFare = scelte.length ? PROVE.filter(([f]) => scelte.includes(f)) : PROVE;
const esiti = [];
for (const [file, nome] of daFare) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(new URL(`./${file}.mjs`, import.meta.url))], { stdio: 'inherit' });
  esiti.push({ nome, ok: r.status === 0, s: ((Date.now() - t0) / 1000).toFixed(0) });
}
console.log('\n================ RIEPILOGO ================');
for (const e of esiti) console.log(`${e.ok ? 'OK    ' : 'ERRORE'}  ${e.nome}  (${e.s} s)`);
const ko = esiti.filter(e => !e.ok).length;
console.log(ko ? `\n${ko} prove con errori: guarda le righe ERRORE più sopra.` : '\nTutto a posto.');
process.exit(ko ? 1 : 0);
