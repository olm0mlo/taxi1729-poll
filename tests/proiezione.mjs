// Prova: comportamento dell'add-in in proiezione, con PowerPoint simulato (officestub.js).
// - due slide che si credono entrambe in proiezione (slide duplicata): i telefoni non sfarfallano
// - una copia aperta in Modifica corregge da sola l'identificativo della slide
// - un errore passeggero di rilevamento non cambia la domanda sui telefoni
// - uscendo dalla proiezione la domanda si chiude subito e l'evento si libera per un collega
// Uso: node tests/proiezione.mjs
import fs from 'node:fs';
import { startServer } from './devserver.mjs';
import { playwright as pw, here } from './util.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { srv, bridge, H } = await startServer(8812);
const B = 'http://localhost:8812';
const j = async (p, body, tok) => (await fetch(B + '/api/' + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const tok = (await j('setup', { name: 'Olmo', email: 'a@t.it', password: 'segretissima' })).token;
await j('users', { name: 'Collega', email: 'c@t.it', password: 'segretissima' }, tok);
const tokC = (await j('login', { email: 'c@t.it', password: 'segretissima' })).token;
const ev = (await j('events', { name: 'Festival' }, tok)).event;
const q1 = (await j(`events/${ev.id}/questions`, { data: { title: 'Domanda uno', options: ['A', 'B'] } }, tok)).question;
const q2 = (await j(`events/${ev.id}/questions`, { data: { title: 'Domanda due', options: ['C', 'D'] } }, tok)).question;
const base = { eventId: ev.id, eventCode: ev.code, eventName: ev.name, fitted: true };
const QSET = { ...base, kind: 'question', questionId: q1.id, snapshot: q1.data, number: 1, slideId: '256#1' };
const SUMSET = { ...base, kind: 'summary', summaryA: q1.id, summaryB: q2.id, snapA: q1.data, snapB: q2.data, slideId: '256#1' };   // copia con l'id dell'originale
const b = await pw.chromium.launch(); const ctx = await b.newContext({ viewport: { width: 960, height: 540 } });
await ctx.route(/fonts\.g|cdnjs/, r => r.abort());
await ctx.route(/appsforoffice/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(here('officestub.js'), 'utf8') }));
await ctx.routeWebSocket(/\/ws\?/, bridge);
const errs = []; let failures = 0;
const p0 = await ctx.newPage(); await p0.goto(B + '/assets/icon-16.png'); await p0.evaluate(t => localStorage.setItem('t1729-token', t), tok);
async function addin(settings, view, slideId) {
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(([s, v, id]) => { window.__settings = s; window.__view = v; window.__slideId = id; }, [JSON.parse(JSON.stringify(settings)), view, slideId]);
  await p.goto(B + '/addin'); return p;
}
const phone = await H.connect(`role=audience&code=${ev.code}&voter=phone0001`);
const changes = () => phone.msgs.filter(m => m.t === 'state').map(m => m.q ? m.q.title : (m.idle ? 'non in corso' : 'attesa'));
const ok = (name, cond, det) => { if (!cond) failures++; console.log(cond ? 'OK   ' : 'ERRORE', name, det || ''); };

let n0 = changes().length;
const pq = await addin(QSET, 'read', '256#1'); await sleep(1500);
const ps = await addin(SUMSET, 'read', '256#1'); await sleep(9000);
const seq = changes().slice(n0);
ok('Slide duplicata: i telefoni non saltano avanti e indietro', seq.length <= 3, seq.join(' → '));
await pq.close(); await ps.close(); await sleep(9000);

const pe = await addin(SUMSET, 'edit', '257#2'); await sleep(2500);
const sid = await pe.evaluate(() => Office.context.document.settings.get('slideId'));
ok('Copia aperta in Modifica: id della slide corretto da solo', sid === '257#2', sid);
await pe.close();

n0 = changes().length;
const pa = await addin(QSET, 'read', '256#1');
const pb = await addin({ ...QSET, questionId: q2.id, snapshot: q2.data, slideId: '258#3' }, 'read', '256#1');
await sleep(2500);
for (const p of [pa, pb]) await p.evaluate(() => { window.__fail = true; });
await sleep(1500);
for (const p of [pa, pb]) await p.evaluate(() => { window.__fail = false; });
await sleep(2500);
const seq3 = changes().slice(n0);
ok('Errore passeggero di rilevamento: la domanda non cambia', !seq3.includes('Domanda due'), seq3.join(' → '));
await pb.close();

n0 = changes().length;
await pa.evaluate(() => window.__viewHandler({ activeView: 'edit' }));
await sleep(3500);
const seq4 = changes().slice(n0);
ok('Uscita dalla proiezione: i telefoni tornano in attesa entro 3 s', seq4.length && seq4[seq4.length - 1] === 'attesa', seq4.join(' → '));
const col = await H.connect(`role=presenter&event=${ev.id}&token=${tokC}`);
col.send({ t: 'show', q: q2.id, k: 'x', fresh: true }); await sleep(300);
ok('Un collega può presentare subito (niente blocco di 10 minuti)', !col.msgs.some(m => m.t === 'locked'));
ok('Nessun errore nelle pagine', !errs.length, errs.join(' | '));
await b.close(); srv.close(); process.exit(failures ? 1 : 0);
