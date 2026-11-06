// Prova: le anteprime dell'add-in e del pannello non si accumulano e mostrano sempre le impostazioni correnti.
// Uso: node tests/anteprime.mjs
import fs from 'node:fs';
import { startServer } from './devserver.mjs';
import { playwright as pw, here } from './util.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { srv, bridge } = await startServer(8811);
const B = 'http://localhost:8811';
const j = async (p, body, tok) => (await fetch(B + '/api/' + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const tok = (await j('setup', { name: 'Olmo', email: 'a@t.it', password: 'segretissima' })).token;
const ev = (await j('events', { name: 'Festival della Scienza' }, tok)).event;
const q1 = (await j(`events/${ev.id}/questions`, { data: { title: 'Prima domanda', options: ['A', 'B', 'C'], reveal: 'click' } }, tok)).question;
const q2 = (await j(`events/${ev.id}/questions`, { data: { title: 'Seconda domanda', options: ['Sì', 'No'] } }, tok)).question;
const b = await pw.chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1000, height: 1000 } });
await ctx.route(/fonts\.g|cdnjs/, r => r.abort());
await ctx.route(/appsforoffice/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(here('officestub.js'), 'utf8') }));
await ctx.routeWebSocket(/\/ws\?/, bridge);
// conta i timer "ogni secondo" attivi (uno per ogni slide/anteprima viva)
await ctx.addInitScript(() => {
  const si = window.setInterval, ci = window.clearInterval; window.__live = new Set();
  window.setInterval = function (f, ms) { const id = si.apply(this, arguments); if (ms === 1000) window.__live.add(id); return id; };
  window.clearInterval = function (id) { window.__live.delete(id); return ci.apply(this, arguments); };
});
const errs = [];
const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
await p.goto(B + '/assets/icon-16.png'); await p.evaluate(([t, e]) => { localStorage.setItem('t1729-token', t); localStorage.setItem('t1729-last-event', e); }, [tok, ev.id]);
await p.goto(B + '/addin'); await sleep(1500);
let failures = 0;
const ok = (name, cond, det) => { if (!cond) failures++; console.log(cond ? 'OK   ' : 'ERRORE', name, det || ''); };
const live = () => p.evaluate(() => window.__live.size);
await p.selectOption('#selQ', q1.id); await sleep(400);
const start = await live();
for (let i = 0; i < 15; i++) {
  await p.click('input[name="sch"][value="pie"] >> xpath=..'); await sleep(80);
  await p.click('input[name="sch"][value=""] >> xpath=..'); await sleep(80);
  await p.click('input[name="res"][value="shown"] >> xpath=..'); await sleep(80);
  await p.click('input[name="res"][value="hidden"] >> xpath=..'); await sleep(80);
}
await sleep(500);
const after = await live();
ok('60 cambi di impostazione: le anteprime non si accumulano', after === start, `timer attivi prima ${start}, dopo ${after}`);
// l'anteprima mostra sempre le impostazioni correnti
await p.click('input[name="sch"][value="pie"] >> xpath=..'); await p.click('input[name="res"][value="shown"] >> xpath=..'); await sleep(500);
await p.locator('#mini').screenshot({ path: here('.tmp/anteprima-torta.png') });
const hasPie = await p.evaluate(() => !!document.querySelector('#mini svg circle'));
ok('Anteprima aggiornata: ciambella visibile dopo aver scelto "Torta" e "Visibili"', hasPie);
await p.selectOption('#selQ', q2.id); await sleep(500);
const t2 = await p.evaluate(() => document.querySelector('#mini .t-title').textContent);
ok('Cambiando domanda l\'anteprima mostra quella nuova', t2 === 'Seconda domanda', t2);
await p.click('input[name="kind"][value="welcome"] >> xpath=..'); await sleep(400);
const wel = await p.evaluate(() => document.querySelector('#mini .t-stage').classList.contains('welcome'));
ok('Slide di benvenuto in anteprima', wel);
await p.click('input[name="kind"][value="summary"] >> xpath=..'); await sleep(300);
await p.selectOption('#selSA', q1.id); await sleep(200); await p.selectOption('#selSB', q2.id); await sleep(600);
const sum = await p.evaluate(() => document.querySelector('#mini .t-stage').classList.contains('summary'));
ok('Riepilogo in anteprima', sum);
await p.click('input[name="kind"][value="question"] >> xpath=..'); await sleep(400);
const back = await p.evaluate(() => { const st = document.querySelector('#mini .t-stage'); return !st.classList.contains('summary') && !st.classList.contains('welcome'); });
ok('Tornando a "Domanda" l\'anteprima non resta sul riepilogo', back);
await p.locator('#editor').screenshot({ path: here('.tmp/anteprima-editor.png') });
// pannello: finestra Risultati aperta e chiusa più volte
const ad = await ctx.newPage(); ad.on('pageerror', e => errs.push('admin: ' + e.message));
await ad.goto(B + '/admin#/event/' + ev.id); await sleep(1200);
const a0 = await ad.evaluate(() => window.__live.size);
for (let i = 0; i < 8; i++) { await ad.locator('[data-a="res"]').first().click(); await sleep(250); await ad.click('#mClose'); await sleep(100); }
const a1 = await ad.evaluate(() => window.__live.size);
ok('Pannello: 8 aperture di "Risultati" non lasciano anteprime attive', a1 === a0, `prima ${a0}, dopo ${a1}`);
ok('Nessun errore nelle pagine', !errs.length, errs.join(' | '));
await b.close(); srv.close(); process.exit(failures ? 1 : 0);
