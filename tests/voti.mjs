// Prova: conteggio dei voti, direttamente sul codice vero del server (senza browser, dura pochi secondi).
// - un voto per telefono, doppioni ignorati, riconnessione che ricorda il voto
// - scelta singola e multipla, risposte non valide, domanda non aperta, evento concluso
// - Crowd Wisdom: valori accettati e rifiutati, mediana/media, istogramma che somma al totale
// - due versioni della stessa domanda (gruppi 50/50, stabili) e risultati segmentati
// - 300 telefoni che votano insieme, riavvio del server a metà votazione
// - voti simulati esclusi dall'export, "Cancella voti simulati", "Svuota", export CSV
// Uso: node tests/voti.mjs
import vm from 'node:vm'; import fs from 'node:fs';
import { makeHub } from './harness.mjs';
import { reporter, apiClient, prepara, sleep, ultimo } from './strumenti.mjs';

const R = reporter('Conteggio dei voti');
const H = await makeHub();
const api = apiClient(H);
const { tok, ev, domanda } = await prepara(api);
const phone = (id) => H.connect(`role=audience&code=${ev.code}&voter=${id}`);
const presenter = await H.connect(`role=presenter&event=${ev.id}&token=${tok}`);
// la slide manda il suo segnale ogni 2 s, come l'add-in vero
let inOnda = null;
const mostra = async (q) => { inOnda = q; await presenter.send({ t: 'show', q, k: 'slide-' + q, fresh: true }); };
setInterval(() => { if (inOnda !== undefined) presenter.send({ t: 'show', q: inOnda, k: 'slide-' + inOnda }); }, 2000).unref();
const risultati = async (q) => { await sleep(450); return ultimo(presenter.msgs, 'results', q); };   // i totali partono ogni 0,3 s
const voti = (q) => H.db.prepare('SELECT COUNT(*) AS n FROM votes WHERE question_id = ?').get(q).n;

// ---------------------------------------------------------------------------------------------------------
R.sezione('Scelta singola');
const q1 = await domanda({ title: 'Colore preferito?', options: ['Rosso', 'Verde', 'Blu'] });
const tel = await phone('telefono01');
R.ok('Telefono collegato prima della domanda: schermata di attesa', ultimo(tel.msgs, 'state').q === null);
await mostra(q1.id);
const st = ultimo(tel.msgs, 'state');
R.ok('La domanda compare subito sul telefono', st.q && st.q.id === q1.id && st.q.options.length === 3);
await tel.send({ t: 'vote', q: q1.id, choices: [1] });
R.ok('Il voto viene confermato al telefono', !!ultimo(tel.msgs, 'voted', q1.id));
let r = await risultati(q1.id);
R.ok('La slide riceve il totale aggiornato', r && r.total === 1 && r.counts.join() === '0,1,0', r && r.counts.join());
await tel.send({ t: 'vote', q: q1.id, choices: [2] });
R.ok('Secondo voto dallo stesso telefono: rifiutato con "già votato"', ultimo(tel.msgs, 'voted', q1.id).already === true);
r = await risultati(q1.id);
R.ok('Il secondo voto non cambia i totali', r.total === 1 && r.counts.join() === '0,1,0', r.counts.join());
const tel2 = await phone('telefono01');   // stesso telefono che si ricollega (cambio di rete)
R.ok('Riconnessione: il telefono risulta già votato', ultimo(tel2.msgs, 'state').voted === true);
const t2 = await phone('telefono02');
await t2.send({ t: 'vote', q: q1.id, choices: [0, 2] });
r = await risultati(q1.id);
R.ok('Scelta singola con due risposte inviate: conta solo la prima', r.total === 2 && r.counts.join() === '1,1,0', r.counts.join());
const t3 = await phone('telefono03');
await t3.send({ t: 'vote', q: q1.id, choices: [7, -1, 'x'] });
R.ok('Risposte inesistenti: errore e nessun voto', ultimo(t3.msgs, 'error') && voti(q1.id) === 2);
await t3.send({ t: 'vote', q: 'domanda-inventata', choices: [0] });
R.ok('Voto per una domanda non aperta: rifiutato', /non è più aperta/.test(ultimo(t3.msgs, 'error').msg));
const bad = await H.connect(`role=audience&code=${ev.code}&voter=sim-12345`);
R.ok('Un telefono non può fingersi un voto simulato ("sim-…")', bad.status === 400);
const nocode = await H.connect(`role=audience&code=XXXXX&voter=telefono09`);
R.ok('Codice evento sbagliato: collegamento rifiutato', nocode.status === 404);

R.sezione('Scelta multipla');
const q2 = await domanda({ title: 'Quali pianeti conosci?', options: ['Marte', 'Venere', 'Giove', 'Saturno'], multi: true });
await mostra(q2.id);
await sleep(50);
R.ok('Cambio di domanda: il telefono passa alla nuova', ultimo(tel.msgs, 'state').q.id === q2.id && ultimo(tel.msgs, 'state').voted === false);
await tel.send({ t: 'vote', q: q2.id, choices: [0, 2, 2, 3] });
await t2.send({ t: 'vote', q: q2.id, choices: [2] });
await t3.send({ t: 'vote', q: q1.id, choices: [0] });
r = await risultati(q2.id);
R.ok('Più risposte per telefono, doppioni tolti', r.total === 2 && r.counts.join() === '1,0,2,1', r.counts.join());
R.ok('Voto alla domanda precedente (ormai chiusa): rifiutato', /non è più aperta/.test(ultimo(t3.msgs, 'error').msg) && voti(q1.id) === 2);

R.sezione('Crowd Wisdom (stime)');
const q3 = await domanda({ kind: 'cw', title: 'Quante caramelle nel barattolo?', min: 0, max: 5000, answer: 1729 });
await mostra(q3.id);
const stime = [100, 900, 1000, 1200, 1729, 2500, 4900];
for (let i = 0; i < stime.length; i++) { const p = await phone('stima0' + i); await p.send({ t: 'vote', q: q3.id, value: stime[i] }); }
const ps = await phone('stima99');
await ps.send({ t: 'vote', q: q3.id, value: 6000 });
R.ok('Stima fuori dall\'intervallo: rifiutata con il messaggio giusto', /tra 0 e 5\.?000/.test(ultimo(ps.msgs, 'error').msg), ultimo(ps.msgs, 'error').msg);
await ps.send({ t: 'vote', q: q3.id, value: 12.5 });
R.ok('Numero con decimali su domanda a numeri interi: rifiutato', ultimo(ps.msgs, 'error') && voti(q3.id) === stime.length);
await ps.send({ t: 'vote', q: q3.id, value: 'mille' });
R.ok('Testo al posto del numero: rifiutato', voti(q3.id) === stime.length);
r = await risultati(q3.id);
R.ok('Mediana corretta', r.stats.median === 1200, r.stats.median);
R.ok('Media corretta', Math.abs(r.stats.mean - stime.reduce((a, b) => a + b) / stime.length) < 1e-9, r.stats.mean.toFixed(2));
const somma = r.hist.counts.reduce((a, b) => a + b, 0) + r.hist.under + r.hist.over;
R.ok('L\'istogramma contiene tutte le stime (nessuna persa)', somma === stime.length, `${somma} su ${stime.length}`);

R.sezione('Due versioni della stessa domanda');
const q4 = await domanda({ title: 'Il Monte Bianco è più alto di 3000 m?', titleB: 'Il Monte Bianco è più alto di 6000 m?', options: ['Sì', 'No'], screenTitle: 'Il Monte Bianco' });
await mostra(q4.id);
const vers = new Map(); const gruppi = [];
for (let i = 0; i < 200; i++) {
  const p = await phone('gruppo' + String(i).padStart(3, '0'));
  const s = ultimo(p.msgs, 'state'); vers.set(i, s.q.title); gruppi.push(p);
  await p.send({ t: 'vote', q: q4.id, choices: [s.q.title.includes('3000') ? 0 : 1] });
}
const nA = [...vers.values()].filter(t => t.includes('3000')).length;
// il 50/50 vale su tutti i telefoni collegati (anche quelli entrati prima), non solo su questi 200
const tutti = H.db.prepare('SELECT g, COUNT(*) AS n FROM groups WHERE question_id = ? GROUP BY g').all(q4.id).map(x => x.n);
R.ok('Telefoni divisi a metà tra versione A e B', tutti.length === 2 && Math.abs(tutti[0] - tutti[1]) <= 1, `A ${tutti[0]}, B ${tutti[1]}`);
let stabili = true;
for (const i of [0, 37, 111, 199]) { const p = await phone('gruppo' + String(i).padStart(3, '0')); if (ultimo(p.msgs, 'state').q.title !== vers.get(i)) stabili = false; }
R.ok('Dopo una riconnessione ogni telefono rilegge la stessa versione', stabili);
r = await risultati(q4.id);
R.ok('Risultati divisi per versione: A ha votato "Sì", B "No"', r.seg && r.seg.counts[0].join() === `${nA},0` && r.seg.counts[1].join() === `0,${200 - nA}`, JSON.stringify(r.seg && r.seg.counts));
R.ok('Sullo schermo il titolo neutro (la domanda non mostra le versioni)', q4.data.screenTitle === 'Il Monte Bianco');

R.sezione('Risultati segmentati per una domanda precedente');
const q5 = await domanda({ title: 'Ti piace la matematica?', options: ['Sì', 'No'], segmentBy: q1.id });
await mostra(q5.id);
await tel.send({ t: 'vote', q: q5.id, choices: [0] });    // telefono01 aveva scelto "Verde"
await t2.send({ t: 'vote', q: q5.id, choices: [1] });     // telefono02 aveva scelto "Rosso"
const nuovo = await phone('telefono77'); await nuovo.send({ t: 'vote', q: q5.id, choices: [1] });   // non aveva risposto alla prima
r = await risultati(q5.id);
R.ok('Segmentazione: ognuno nella riga della sua risposta precedente', r.seg && r.seg.counts[0].join() === '0,1' && r.seg.counts[1].join() === '1,0' && r.seg.counts[3].join() === '0,1', JSON.stringify(r.seg && r.seg.counts));

R.sezione('300 telefoni che votano insieme');
const q6 = await domanda({ title: 'Voto di massa', options: ['A', 'B', 'C', 'D'] });
await mostra(q6.id);
const folla = await Promise.all(Array.from({ length: 300 }, (_, i) => phone('folla' + String(i).padStart(4, '0'))));
const attesi = [0, 0, 0, 0];
await Promise.all(folla.map((p, i) => { const c = (i * 7) % 4; attesi[c]++; return p.send({ t: 'vote', q: q6.id, choices: [c] }); }));
await Promise.all(folla.slice(0, 50).map(p => p.send({ t: 'vote', q: q6.id, choices: [3] })));   // 50 doppioni
r = await risultati(q6.id);
R.ok('Totale esatto: 300 voti, nessun doppione', r.total === 300 && voti(q6.id) === 300, `${r.total} nella slide, ${voti(q6.id)} salvati`);
R.ok('Conteggio per risposta esatto', r.counts.join() === attesi.join(), `${r.counts.join()} atteso ${attesi.join()}`);
R.ok('Ogni telefono ha ricevuto la conferma', folla.every(p => ultimo(p.msgs, 'voted', q6.id)));

R.sezione('Riavvio del server a metà votazione (pubblicazione)');
H.restart({ drop: true });
const presenter2 = await H.connect(`role=presenter&event=${ev.id}&token=${tok}`);
await presenter2.send({ t: 'show', q: q6.id, k: 'slide-' + q6.id, fresh: true });
presenter.send = presenter2.send; presenter.msgs = presenter2.msgs;   // da qui in poi il segnale ogni 2 s parte dalla nuova connessione
const torna = await phone('folla0007');
R.ok('Dopo il riavvio il telefono ritrova la domanda e risulta già votato', ultimo(torna.msgs, 'state').q.id === q6.id && ultimo(torna.msgs, 'state').voted === true);
await torna.send({ t: 'vote', q: q6.id, choices: [0] });
const ritardo = await phone('ritardo001'); await ritardo.send({ t: 'vote', q: q6.id, choices: [1] });
r = await risultati(q6.id);
R.ok('Totali conservati dopo il riavvio, voto ripetuto ignorato, voto nuovo contato', r.total === 301 && r.counts[1] === attesi[1] + 1, `${r.total} voti`);
H.restart({ drop: false });   // risveglio dall'ibernazione: i collegamenti restano aperti
await sleep(50);
await ritardo.send({ t: 'vote', q: q6.id, choices: [2] });
const dopo = await phone('ritardo002'); await dopo.send({ t: 'vote', q: q6.id, choices: [2] });
r = (await api(`questions/${q6.id}/results`, { token: tok })).data;
R.ok('Dopo il risveglio dall\'ibernazione: nessun voto doppio, i nuovi contano', r.total === 302, `${r.total} voti`);

R.sezione('Voti simulati, Svuota, export CSV');
await api(`questions/${q6.id}/simulate`, { body: { count: 40, seconds: 0 }, token: tok });
await sleep(100);
r = (await api(`questions/${q6.id}/results`, { token: tok })).data;
R.ok('Simulazione: 40 voti in più, marcati come simulati', r.total === 342 && r.sim === 40, `${r.total} totali, ${r.sim} simulati`);
let csv = (await api(`events/${ev.id}/export.csv`, { token: tok })).text;
const righeQ6 = csv.split('\r\n').filter(l => l.includes(';Voto di massa;'));
const sommaCsv = righeQ6.reduce((a, l) => a + Number(l.split(';')[4]), 0);
R.ok('Export CSV: i voti simulati sono esclusi', sommaCsv === 302, `${sommaCsv} nel CSV`);
R.ok('Export CSV: ci sono le stime una per riga, con la virgola dei decimali', csv.includes('Stime delle domande Crowd Wisdom') && csv.split('\r\n').filter(l => l.includes('Quante caramelle') && /;1729;?$/.test(l)).length === 1);
R.ok('Export CSV: le domande con due versioni hanno le righe per gruppo', csv.includes('[Gruppo A]') && csv.includes('[Gruppo B]'));
await api(`events/${ev.id}/simvotes`, { method: 'DELETE', token: tok });
r = (await api(`questions/${q6.id}/results`, { token: tok })).data;
R.ok('"Cancella voti simulati" toglie solo quelli simulati', r.total === 302 && r.sim === 0, `${r.total} voti`);
await api(`questions/${q6.id}/votes`, { method: 'DELETE', token: tok });
r = await risultati(q6.id);
R.ok('"Svuota": la domanda torna a zero e la slide lo sa subito', r.total === 0 && voti(q6.id) === 0 && voti(q1.id) === 2);

R.sezione('Evento concluso');
const telC = await phone('chiusura01'), telD = await phone('chiusura02');   // i telefoni di prima sono stati scollegati dal riavvio
await api(`events/${ev.id}`, { method: 'PATCH', body: { closed: true }, token: tok });
R.ok('"Chiudi evento": i telefoni passano subito a "evento concluso"', ultimo(telC.msgs, 'state').closed === true);
await telD.send({ t: 'vote', q: q6.id, choices: [0] });
R.ok('Evento concluso: non si vota', /concluso/.test(ultimo(telD.msgs, 'error').msg) && voti(q6.id) === 0);
await api(`events/${ev.id}`, { method: 'PATCH', body: { closed: false }, token: tok });
R.ok('"Riapri evento": i telefoni tornano alla domanda', ultimo(telC.msgs, 'state').q && ultimo(telC.msgs, 'state').q.id === q6.id);

R.sezione('Problemi noti (non bloccano)');
// un errore dentro un'operazione differita del server (es. l'invio dei totali) farebbe chiudere la prova: lo registriamo
const erroriDifferiti = []; process.on('uncaughtException', (e) => erroriDifferiti.push(e.message));
const ctxApi = { window: {}, location: { origin: 'https://x', protocol: 'https:', host: 'x' }, localStorage: null, document: { addEventListener() {} } };
vm.runInNewContext(fs.readFileSync(new URL('../app/public/shared/api.js', import.meta.url), 'utf8'), ctxApi);
const parse = ctxApi.window.T.parseNum;
R.ok('Lettura dei numeri: "1.250" = 1250, "12,5" = 12,5, "3.5" = 3,5', parse('1.250') === 1250 && parse('12,5') === 12.5 && parse('3.5') === 3.5);
R.noto('"0.125" letto come 125 invece di 0,125', parse('0.125') === 125, `risultato ${parse('0.125')}`);
await mostra(q1.id);
await api(`questions/${q1.id}`, { method: 'PATCH', body: { data: { kind: 'cw', title: 'Ora è una stima' } }, token: tok });
const dopoCambio = await api(`questions/${q5.id}/results`, { token: tok });
await sleep(450);
R.noto('Cambio di tipo di una domanda con voti: i risultati segmentati vanno in errore', dopoCambio.status === 500, `stato ${dopoCambio.status}` + (erroriDifferiti.length ? `, ${erroriDifferiti.length} errori nell'invio dei totali` : ''));

R.fine();
