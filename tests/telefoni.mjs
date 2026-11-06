// Prova: la pagina vera del pubblico (index.html) in un browser con lo schermo di un telefono.
// - schermate "non in corso", "tieni d'occhio lo schermo", domanda, "risposta inviata", "evento concluso"
// - voto e ricarica della pagina (il telefono si ricorda di aver votato)
// - voto perso per strada mentre cade la rete: al ritorno viene rispedito e contato una volta sola
// - caduta di rete e riavvio del server (pubblicazione): i telefoni si ricollegano da soli
// - 8 telefoni insieme che votano, poi riavvio: nessun voto perso o doppio
// - stima Crowd Wisdom scritta all'italiana ("1.250") e messaggio per un valore non valido
// Fotografie delle schermate in tests/.tmp/telefono-*.png
// Uso: node tests/telefoni.mjs
import fs from 'node:fs';
import { startServer } from './devserver.mjs';
import { playwright as pw, here } from './util.mjs';
import { reporter, apiClient, prepara, sleep } from './strumenti.mjs';

const R = reporter('Telefoni e riconnessioni');
const PORT = 8813, B = 'http://localhost:' + PORT;
const { srv, bridge, H } = await startServer(PORT);
const api = apiClient(B);
const { tok, ev, domanda } = await prepara(api, 'Serata dei numeri');
const q1 = await domanda({ title: 'Qual è il numero di Ramanujan?', options: ['1089', '1729', '2025'] });
const q2 = await domanda({ kind: 'cw', title: 'Quanti gradini ha la Mole Antonelliana?', min: 0, max: 100000, unit: 'gradini' });
const q3 = await domanda({ title: 'Ultima domanda', options: ['Sì', 'No'] });
const voti = (q) => H.db.prepare('SELECT COUNT(*) AS n FROM votes WHERE question_id = ?').get(q).n;

// Presentazione finta (lato server), che manda il segnale ogni 2 s come l'add-in e si ricollega dopo un riavvio
const pres = { q: undefined, conn: null };
pres.connetti = async () => { pres.conn = await H.connect(`role=presenter&event=${ev.id}&token=${tok}`); if (pres.q !== undefined) await pres.conn.send({ t: 'show', q: pres.q, k: 's', fresh: true }); };
pres.mostra = async (q) => { pres.q = q; await pres.conn.send({ t: 'show', q, k: 's', fresh: true }); };
setInterval(() => { if (pres.conn && pres.q !== undefined) { if (pres.conn.client.closed) pres.connetti(); else pres.conn.send({ t: 'show', q: pres.q, k: 's' }); } }, 2000).unref();
await pres.connetti();

const b = await pw.chromium.launch();
const errs = [];
async function telefono(nome) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route(/fonts\.g|cdnjs/, r => r.abort());
  await ctx.routeWebSocket(/\/ws\?/, bridge);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(nome + ': ' + e.message));
  p.nome = nome;
  await p.goto(B + '/?e=' + ev.code);
  return p;
}
const testo = (p) => p.locator('#main').innerText().then(t => t.replace(/\s+/g, ' ').trim());
const rete = (p) => p.locator('#net').innerText();
async function aspetta(cond, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await sleep(150); } return false; }
const foto = async (p, nome) => { await sleep(900); await p.screenshot({ path: here(`.tmp/telefono-${nome}.png`) }); };   // attesa: fine dell'animazione di comparsa
async function vota(p, i) { await p.locator('.opt').nth(i).click(); await p.click('#send'); }

// ---------------------------------------------------------------------------------------------------------
R.sezione('Schermate');
const t1 = await telefono('t1');
R.ok('Nessuna presentazione ancora: "La presentazione non è in corso"', await aspetta(async () => /non è in corso/.test(await testo(t1))), await testo(t1));
await foto(t1, '1-non-in-corso');
await pres.mostra(null);
R.ok('Presentazione avviata senza domanda: "Tieni d\'occhio lo schermo"', await aspetta(async () => /Tieni d'occhio/.test(await testo(t1))));
R.ok('Indicatore di collegamento "in diretta"', /in diretta/.test(await rete(t1)));
await foto(t1, '2-attesa');
await pres.mostra(q1.id);
R.ok('La domanda compare da sola, con le tre risposte', await aspetta(async () => (await t1.locator('.opt').count()) === 3));
await t1.locator('.opt').nth(1).click();
await foto(t1, '3-domanda');
await t1.click('#send');
R.ok('Dopo "Invia": "Risposta inviata"', await aspetta(async () => /Risposta inviata/.test(await testo(t1))));
R.ok('Il voto è salvato sul server', voti(q1.id) === 1);
await foto(t1, '4-inviata');
await t1.reload();
R.ok('Ricaricando la pagina il telefono ricorda di aver votato', await aspetta(async () => /Risposta inviata/.test(await testo(t1))));

R.sezione('Voto perso mentre cade la rete');
const t2 = await telefono('t2');
await aspetta(async () => (await t2.locator('.opt').count()) === 3);
H.perdi = (m) => m.t === 'vote';                 // il prossimo voto si perde per strada…
await vota(t2, 0);
await sleep(300);
R.ok('Il voto non è arrivato al server', voti(q1.id) === 1);
H.perdi = null;
const caduti = H.dropLinks(c => c.server.att.role === 'audience');   // …e subito dopo la connessione cade
R.ok('Rete caduta: il telefono mostra "connessione persa"', await aspetta(async () => /persa/.test(await rete(t2)), 3000), `${caduti} collegamenti chiusi`);
R.ok('Il telefono si ricollega da solo', await aspetta(async () => /in diretta/.test(await rete(t2)), 10000));
R.ok('Il voto perso viene rispedito e contato una volta sola', await aspetta(async () => voti(q1.id) === 2) && /Risposta inviata/.test(await testo(t2)), `${voti(q1.id)} voti`);
await sleep(1500);
R.ok('Nessun doppione dopo il rinvio', voti(q1.id) === 2);
R.ok('Anche l\'altro telefono si è ricollegato', /in diretta/.test(await rete(t1)));

R.sezione('8 telefoni insieme e riavvio del server');
const folla = await Promise.all(Array.from({ length: 8 }, (_, i) => telefono('f' + i)));
await Promise.all(folla.map(p => aspetta(async () => (await p.locator('.opt').count()) === 3)));
await Promise.all(folla.map((p, i) => vota(p, i % 3)));
R.ok('8 voti contati', await aspetta(async () => voti(q1.id) === 10), `${voti(q1.id)} voti`);
H.restart({ drop: true });                          // pubblicazione di una modifica: tutti scollegati
const tutti = [t1, t2, ...folla];
R.ok('Riavvio: i telefoni vedono la connessione persa', await aspetta(async () => (await Promise.all(tutti.map(rete))).some(t => /persa/.test(t)), 3000));
const t0 = Date.now();
R.ok('Tutti i 10 telefoni si ricollegano da soli', await aspetta(async () => (await Promise.all(tutti.map(rete))).every(t => /in diretta/.test(t)), 15000), `in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
R.ok('Dopo il riavvio nessuno deve rivotare ("Risposta inviata")', await aspetta(async () => (await Promise.all(tutti.map(testo))).every(t => /Risposta inviata/.test(t))));
R.ok('Nessun voto perso o raddoppiato', voti(q1.id) === 10, `${voti(q1.id)} voti`);

R.sezione('Stima Crowd Wisdom');
await pres.mostra(q2.id);
R.ok('La casella per la stima compare con l\'unità', await aspetta(async () => (await t1.locator('#num').count()) === 1) && /gradini/.test(await testo(t1)));
await t1.fill('#num', 'circa cento');
await t1.click('#send');
R.ok('Testo non valido: messaggio sotto la casella, nessun voto', /Inserisci un numero intero/.test(await t1.locator('#nerr').innerText()) && voti(q2.id) === 0);
await foto(t1, '5-stima-errore');
await t1.fill('#num', '1.250');
await t1.click('#send');
R.ok('"1.250" accettato e salvato come 1250', await aspetta(async () => voti(q2.id) === 1) && JSON.parse(H.db.prepare('SELECT choices FROM votes WHERE question_id = ?').get(q2.id).choices)[0] === 1250);
await t2.fill('#num', '250000'); await t2.click('#send');
R.ok('Valore oltre il massimo: rifiutato già sul telefono', /tra 0 e 100\.000/.test(await t2.locator('#nerr').innerText()), await t2.locator('#nerr').innerText());

R.sezione('Fine della domanda ed evento concluso');
await pres.mostra(null);
R.ok('Slide senza domanda: i telefoni tornano in attesa', await aspetta(async () => /Tieni d'occhio/.test(await testo(t2))));
await pres.mostra(q3.id);
await aspetta(async () => (await t2.locator('.opt').count()) === 2);
await api(`events/${ev.id}`, { method: 'PATCH', body: { closed: true }, token: tok });
R.ok('"Chiudi evento": "L\'evento è concluso" anche con una domanda aperta', await aspetta(async () => /evento è concluso/.test(await testo(t2))));
await foto(t2, '6-concluso');
await t2.reload();
R.ok('…e resta così ricaricando la pagina', await aspetta(async () => /evento è concluso/.test(await testo(t2))));
await api(`events/${ev.id}`, { method: 'PATCH', body: { closed: false }, token: tok });
R.ok('"Riapri evento": la domanda torna', await aspetta(async () => (await t2.locator('.opt').count()) === 2));
pres.q = undefined; await pres.conn.send({ t: 'stop' });
R.ok('Fine presentazione: i telefoni lo vedono', await aspetta(async () => /non è in corso|Tieni d'occhio/.test(await testo(t2))));

R.sezione('Codice sbagliato');
const ctxX = await b.newContext({ viewport: { width: 390, height: 780 } });
await ctxX.route(/fonts\.g|cdnjs/, r => r.abort());
const px = await ctxX.newPage(); await px.goto(B + '/?e=99999');
R.ok('Codice inesistente: messaggio chiaro e casella per riscriverlo', await aspetta(async () => /non trovato/.test(await testo(px))) && (await px.locator('#ec').count()) === 1);
await foto(px, '7-codice-sbagliato');

R.ok('Nessun errore nelle pagine', !errs.length, errs.join(' | '));
await b.close(); srv.close();
R.fine();
