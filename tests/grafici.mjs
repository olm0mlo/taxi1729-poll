// Prova: i grafici della slide (slide.js), disegnati con risultati veri calcolati dal server di prova.
// Per ogni grafico controlla che:
//   - si disegni senza errori nella pagina;
//   - i numeri sullo schermo (totale, percentuali, mediana) siano quelli giusti;
//   - niente esca dalla slide o finisca sopra QR, codice, totale o logo.
// Fotografa ogni slide in tests/.tmp/grafico-*.png (il QR è un riquadro grigio: il generatore vero sta su internet).
// Uso: node tests/grafici.mjs
import { startServer } from './devserver.mjs';
import { playwright as pw, here } from './util.mjs';
import { reporter, apiClient, prepara, sleep } from './strumenti.mjs';

const R = reporter('Grafici delle slide');
const PORT = 8814, B = 'http://localhost:' + PORT;
const { srv, bridge, H } = await startServer(PORT);
const api = apiClient(B);
const { tok, ev, domanda } = await prepara(api, 'Festival della Scienza');

// --- voti veri, dati dal "pubblico" del server di prova ---
const pres = await H.connect(`role=presenter&event=${ev.id}&token=${tok}`);
let n = 0;
async function votaTutti(q, scelte) {          // scelte: array, un elemento per telefono (indici, array di indici o numero)
  await pres.send({ t: 'show', q: q.id, k: 's', fresh: true });
  const voters = [];
  for (const s of scelte) {
    const id = 'tel' + String(n++).padStart(5, '0'); voters.push(id);
    const p = await H.connect(`role=audience&code=${ev.code}&voter=${id}`);
    await p.send(typeof s === 'number' && q.data.kind === 'cw' ? { t: 'vote', q: q.id, value: s } : { t: 'vote', q: q.id, choices: Array.isArray(s) ? s : [s] });
    p.close();
  }
  return voters;
}
async function votaGli(q, voters, scelte) {    // stessi telefoni di una domanda precedente (per segmentazione e gruppi)
  await pres.send({ t: 'show', q: q.id, k: 's', fresh: true });
  for (let i = 0; i < voters.length; i++) {
    const p = await H.connect(`role=audience&code=${ev.code}&voter=${voters[i]}`);
    const s = typeof scelte === 'function' ? scelte(i, p) : scelte[i];
    await p.send(q.data.kind === 'cw' ? { t: 'vote', q: q.id, value: s } : { t: 'vote', q: q.id, choices: [s] });
    p.close();
  }
}
const ripeti = (lista) => lista.flatMap(([v, k]) => Array(k).fill(v));     // [[0,40],[1,30]] → 40 volte 0, 30 volte 1
const risultati = async (q) => (await api(`questions/${q.id}/results`, { token: tok })).data;

// --- pagina di prova: solo la slide, 1920×1080 come in proiezione ---
const QR_FINTO = `window.QRCode = function (el, o) { var d = document.createElement('div'); d.style.cssText = 'width:100%;aspect-ratio:1;background:repeating-linear-gradient(45deg,#ccc 0 12px,#eee 12px 24px)'; el.appendChild(d); }; QRCode.CorrectLevel = { M: 0 };`;
const PAGINA = `<!doctype html><html lang="it"><head><meta charset="utf-8"><link rel="stylesheet" href="/shared/theme.css"><link rel="stylesheet" href="/shared/slide.css">
<style>html,body{margin:0;height:100%;background:#02151f;overflow:hidden}#slide{position:absolute;inset:0}</style></head>
<body><div id="slide"></div><script>${QR_FINTO}</script><script src="/shared/api.js"></script><script src="/shared/slide.js"></script>
<script>window.S = T.Slide(document.getElementById('slide'));</script></body></html>`;
const b = await pw.chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.route(/fonts\.g|cdnjs/, r => r.abort());
await ctx.route(B + '/__prova-grafici', r => r.fulfill({ contentType: 'text/html', body: PAGINA }));
const errs = [];
const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
await p.goto(B + '/__prova-grafici');
await p.evaluate((e) => S.setEvent(e), ev);

// Mostra una domanda come fa la presentazione e aspetta la fine delle animazioni
async function slide(q, res, opz = {}) {
  await p.evaluate(([q, res, o]) => {
    S.setChartOverride(o.chart || null); S.setAnswerVisible(!!o.answer); S.setQuestionOnly(!!o.qonly); S.setSplitView(o.split || 'hist');
    S.setQuestion(Object.assign({ id: q.id }, q.data), o.num || 1);
    S.setRevealed(o.revealed !== false);
    if (res) S.setResults(res);
    S.playIntro();
  }, [q, res, opz]);
  await sleep(opz.attesa || 2200);
}
// Testo visibile nel grafico e nel totale
const testoGrafico = () => p.evaluate(() => document.querySelector('.t-chart').innerText.replace(/\s+/g, ' '));
const totale = () => p.evaluate(() => document.querySelector('.t-total').innerText.replace(/\s+/g, ' ').trim());
// Controllo degli spazi: ogni elemento del grafico deve stare dentro la slide e lontano da QR, codice, totale e logo.
// Restituisce l'elenco dei problemi trovati (vuoto = tutto a posto).
const spazi = () => p.evaluate(() => {
  const cv = document.querySelector('.t-canvas').getBoundingClientRect(), k = cv.width / 1920;
  const rel = (r) => ({ x: (r.left - cv.left) / k, y: (r.top - cv.top) / k, w: r.width / k, h: r.height / k });
  const vieti = ['.t-total', '.t-code', '.t-qr', '.t-logo'].map(s => document.querySelector(s)).filter(e => e && e.offsetParent !== null && !e.classList.contains('hidden'))
    .map(e => ({ nome: e.className, r: rel(e.getBoundingClientRect()) })).filter(v => v.r.w > 0 && v.r.h > 0);
  const nomeDi = (e) => (e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className) || e.tagName;
  const pezzi = [...document.querySelectorAll('.t-chart *')].filter(e => {
    if (e.children.length && e.tagName !== 'text') return false;                       // solo i pezzi finali (testi, barre, pallini)
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
    if (e.tagName === 'g' || e.tagName === 'defs' || e.closest('defs')) return false;
    const r = e.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5;
  });
  const inter = (a, b) => a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2;
  const probl = [];
  for (const e of pezzi) {
    const r = rel(e.getBoundingClientRect()), nome = nomeDi(e) + (e.textContent ? ` "${e.textContent.trim().slice(0, 20)}"` : '');
    if (r.x < -2 || r.y < -2 || r.x + r.w > 1922 || r.y + r.h > 1082) probl.push(`${nome} esce dalla slide`);
    for (const v of vieti) if (inter(r, v.r)) probl.push(`${nome} sopra ${v.nome}`);
  }
  return [...new Set(probl)];
});
const foto = (nome) => p.screenshot({ path: here(`.tmp/grafico-${nome}.png`) });
async function controllaSpazi(nome, noto) {
  const pr = await spazi();
  if (noto) R.noto(`${nome}: ${noto}`, pr.length > 0, pr.slice(0, 3).join('; '));
  else R.ok(`${nome}: niente fuori posto`, pr.length === 0, pr.slice(0, 3).join('; '));
}

// ---------------------------------------------------------------------------------------------------------
R.sezione('Scelta multipla: i quattro grafici');
const qa = await domanda({ title: 'Qual è il tuo numero preferito?', options: ['π (pi greco)', 'e (numero di Nepero)', 'φ (sezione aurea)', '1729'] });
await votaTutti(qa, ripeti([[0, 40], [1, 30], [2, 20], [3, 10]]));
const ra = await risultati(qa);
for (const [chart, nome] of [['bar', 'barre orizzontali'], ['vbar', 'barre verticali'], ['pie', 'ciambella'], ['dots', 'dot cluster']]) {
  await slide(qa, ra, { chart, attesa: chart === 'dots' ? 4500 : 2200 });
  const t = await testoGrafico();
  R.ok(`${nome}: percentuali giuste (40%, 30%, 20%, 10%)`, ['40%', '30%', '20%', '10%'].every(x => t.includes(x)), t.slice(0, 120));
  if (chart !== 'dots') R.ok(`${nome}: tutte le risposte scritte`, ['pi greco', 'Nepero', 'sezione aurea', '1729'].every(x => t.includes(x)));
  else R.ok(`${nome}: 100 pallini`, (await p.locator('.t-chart circle, .t-chart .t-dot-in').count()) >= 100);
  R.ok(`${nome}: totale "100 risposte"`, (await totale()) === '100 risposte', await totale());
  await controllaSpazi(nome);
  await foto(`1-${chart}`);
}

R.sezione('Casi limite');
const q0 = await domanda({ title: 'Domanda senza voti', options: ['Sì', 'No'] });
await slide(q0, await risultati(q0));
R.ok('Nessun voto: "0 risposte" e 0%', (await totale()) === '0 risposte' && (await testoGrafico()).includes('0%'), await totale());
await controllaSpazi('Nessun voto');
const q1v = await domanda({ title: 'Un solo voto', options: ['Sì', 'No'] });
await votaTutti(q1v, [0]);
await slide(q1v, await risultati(q1v));
R.ok('Un voto: "1 risposta" al singolare e 100%', (await totale()) === '1 risposta' && (await testoGrafico()).includes('100%'), await totale());
const qm = await domanda({ title: 'Quali di questi hai visitato?', options: ['Museo Egizio', 'Mole Antonelliana', 'Superga', 'Museo dell\'Automobile', 'Venaria Reale'], multi: true });
await votaTutti(qm, [[0, 1], [0, 2, 4], [1], [0, 1, 2, 3, 4], [3]]);
await slide(qm, await risultati(qm));
const tm = await testoGrafico();
R.ok('Risposta multipla: percentuali sul numero di persone (Museo Egizio 3 su 5 = 60%)', tm.includes('60%') && (await totale()) === '5 risposte', tm.slice(0, 160));
await controllaSpazi('Risposta multipla, 5 risposte');
await foto('2-multipla');
const qLunga = await domanda({ title: 'Secondo voi, quale di queste affermazioni sulla probabilità è vera quando si lancia molte volte una moneta non truccata e si contano le teste?', options: ['La frequenza delle teste si avvicina a un mezzo', 'Dopo cinque teste di fila è più probabile croce', 'Le teste e le croci saranno sempre esattamente uguali'] });
await votaTutti(qLunga, ripeti([[0, 12], [1, 7], [2, 3]]));
await slide(qLunga, await risultati(qLunga));
await controllaSpazi('Titolo lungo e risposte lunghe');
await foto('3-testi-lunghi');
const q12 = await domanda({ title: 'Mese di nascita?', options: ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'] });
await votaTutti(q12, ripeti(Array.from({ length: 12 }, (_, i) => [i, 3 + (i * 5) % 11])));
const r12 = await risultati(q12);
await slide(q12, r12, { chart: 'bar' });
await controllaSpazi('Barre orizzontali con 12 risposte', 'escono dallo spazio (problema noto n. 4)');
await foto('4-barre-12');
for (const c of ['vbar', 'pie', 'dots']) { await slide(q12, r12, { chart: c, attesa: c === 'dots' ? 5000 : 2200 }); await controllaSpazi(`12 risposte, ${c === 'vbar' ? 'barre verticali' : c === 'pie' ? 'ciambella' : 'dot cluster'}`); await foto(`4-${c}-12`); }
const qEt = await domanda({ title: 'Il tuo campo preferito?', options: ['Teoria dei numeri e crittografia moderna applicata', 'Geometria differenziale e relatività generale', 'Statistica'], chart: 'pie' });
await votaTutti(qEt, ripeti([[0, 5], [1, 4], [2, 3]]));
await slide(qEt, await risultati(qEt));
await controllaSpazi('Ciambella con etichette lunghe');
await foto('5-ciambella-etichette-lunghe');

R.sezione('Risultati nascosti e "Mostra le risposte"');
const qc = await domanda({ title: 'Risposta su click', options: ['A', 'B'], reveal: 'click' });
await votaTutti(qc, ripeti([[0, 3], [1, 1]]));
const rc = await risultati(qc);
await slide(qc, rc, { revealed: false });
const nascosto = await testoGrafico();
R.ok('Risultati nascosti: nessuna percentuale sullo schermo', !/\d+%/.test(nascosto), nascosto.slice(0, 80));
await foto('6-nascosti');
await p.evaluate(() => { S.setRevealed(true); }); await sleep(2200);
R.ok('Dopo "Mostra le risposte": 75% e 25%', /75%/.test(await testoGrafico()) && /25%/.test(await testoGrafico()));

R.sezione('Segmentazione e due versioni');
const qBase = await domanda({ title: 'Sei studente?', options: ['Sì', 'No'] });
const vBase = await votaTutti(qBase, ripeti([[0, 30], [1, 20]]));
const qSeg = await domanda({ title: 'Ti piace la matematica?', options: ['Molto', 'Abbastanza', 'Poco'], segmentBy: qBase.id });
await votaGli(qSeg, vBase, (i) => (i < 30 ? [0, 1, 1][i % 3] : [0, 2][i % 2]));
const rSeg = await risultati(qSeg);
R.ok('Server: risultati segmentati con le righe giuste', rSeg.seg && rSeg.seg.counts[0].join() === '10,20,0' && rSeg.seg.counts[1].join() === '10,0,10', JSON.stringify(rSeg.seg && rSeg.seg.counts));
for (const c of ['bar', 'vbar', 'pie', 'dots']) {
  await slide(qSeg, rSeg, { chart: c, attesa: c === 'dots' ? 4500 : 2200 });
  R.ok(`Segmentato (${c}): nessun errore e legenda dei gruppi`, /Sì/.test(await p.evaluate(() => document.querySelector('.t-chart').innerText)));
  await controllaSpazi(`Segmentato (${c})`);
  await foto(`7-segmentato-${c}`);
}
const qV = await domanda({ title: 'Il Monte Bianco è più alto di 3000 m?', titleB: 'Il Monte Bianco è più alto di 6000 m?', screenTitle: 'Quanto è alto il Monte Bianco?', options: ['Sì', 'No'] });
const vV = await votaTutti(qV, []);
await pres.send({ t: 'show', q: qV.id, k: 's', fresh: true });
const gruppo = {};
for (let i = 0; i < 40; i++) {
  const id = 'ver' + String(i).padStart(4, '0'); vV.push(id);
  const ph = await H.connect(`role=audience&code=${ev.code}&voter=${id}`);
  const tit = [...ph.msgs].reverse().find(m => m.t === 'state').q.title; gruppo[id] = tit.includes('3000') ? 0 : 1;
  await ph.send({ t: 'vote', q: qV.id, choices: [gruppo[id] ? (i % 4 === 0 ? 0 : 1) : (i % 5 === 0 ? 1 : 0)] }); ph.close();
}
const rV = await risultati(qV);
await slide(qV, rV);
R.ok('Due versioni: sullo schermo solo il titolo neutro', (await p.locator('.t-title').innerText()) === 'Quanto è alto il Monte Bianco?');
await controllaSpazi('Due versioni');
await foto('8-due-versioni');

R.sezione('Crowd Wisdom');
const stime = [];
for (let i = 0; i < 120; i++) stime.push(Math.round(4808 * Math.exp(0.35 * Math.sin(i * 12.9898) * 1.7)));
stime.push(25000, 30);
const qCw = await domanda({ kind: 'cw', title: 'Quanto è alto il Monte Bianco?', unit: 'm', min: 0, answer: 4806, showTitle: true });
await votaTutti(qCw, stime);
const rCw = await risultati(qCw);
const ord = [...stime].sort((a, b) => a - b), med = (ord[60] + ord[61]) / 2;
R.ok('Server: mediana delle 122 stime giusta', rCw.stats.median === med, `${rCw.stats.median} atteso ${med}`);
await slide(qCw, rCw);
const tCw = await testoGrafico();
const medTxt = med.toLocaleString('it-IT', { maximumFractionDigits: 2 });
R.ok('Istogramma: la mediana scritta sullo schermo', tCw.includes(medTxt), `cerco ${medTxt} in: ${tCw.slice(0, 160)}`);
R.ok('Istogramma: colonne laterali per le stime estreme ("sotto"/"oltre")', /oltre|sotto/i.test(tCw));
// la linea della risposta esatta resta nella pagina anche quando è nascosta: conta se si vede davvero (opacità)
const rispostaVisibile = () => p.evaluate(() => {
  const el = [...document.querySelectorAll('.t-chart *')].find(e => !e.children.length && /^Risposta esatta/.test(e.textContent.trim()));
  if (!el) return false;
  for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (+cs.opacity < 0.5 || cs.visibility === 'hidden' || cs.display === 'none') return false; }
  return true;
});
R.ok('Risposta esatta nascosta finché non si sceglie "Visibile"', !(await rispostaVisibile()));
await controllaSpazi('Istogramma');
await foto('9-istogramma');
await slide(qCw, rCw, { answer: true });
const tAns = await testoGrafico();
R.ok('Con "Visibile": la risposta esatta (4806) si vede, insieme alla mediana', (await rispostaVisibile()) && tAns.includes('4806') && tAns.includes(medTxt));
const sovrapposte = await p.evaluate(() => {
  const trova = (re) => [...document.querySelectorAll('.t-chart *')].find(e => !e.children.length && re.test(e.textContent.trim()));
  const a = trova(/^Mediana/), b = trova(/^Risposta esatta/); if (!a || !b) return 'etichette non trovate';
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  return ra.left < rb.right && rb.left < ra.right && ra.top < rb.bottom && rb.top < ra.bottom ? 'sovrapposte' : '';
});
R.ok('Etichette "Mediana" e "Risposta esatta" vicine (4868 e 4806) ma non sovrapposte', !sovrapposte, sovrapposte);
await controllaSpazi('Istogramma con risposta esatta');
await foto('9-istogramma-risposta');
await slide(qCw, rCw, { qonly: true, attesa: 800 });
R.ok('"Mostra domanda": solo la domanda, nessun grafico', (await p.evaluate(() => document.querySelector('.t-chart').classList.contains('hidden'))) && /Monte Bianco/.test(await p.locator('.t-title').innerText()));
await foto('9-solo-domanda');
const qCwV = await domanda({ kind: 'cw', title: 'Stima l\'altezza', unit: 'm', min: 0, splitBy: qV.id });
await votaGli(qCwV, vV.filter(v => v.startsWith('ver')), (i) => (gruppo['ver' + String(i).padStart(4, '0')] ? 5200 + i * 37 : 3100 + i * 29));
const rCwV = await risultati(qCwV);
R.ok('Server: stime separate per gruppo', rCwV.groups && rCwV.groups[0].total + rCwV.groups[1].total === 40, rCwV.groups && rCwV.groups.map(g => g.total).join('+'));
await slide(qCwV, rCwV);
await controllaSpazi('Istogrammi separati per gruppo');
await foto('10-gruppi-istogrammi');
await slide(qCwV, rCwV, { split: 'numbers' });
const tNum = await testoGrafico();
R.ok('Vista "solo numeri": le due mediane scritte in grande (arrotondate)', [0, 1].every(g => tNum.includes(Math.round(rCwV.groups[g].stats.median).toLocaleString('it-IT'))), tNum.slice(0, 120));
await controllaSpazi('Gruppi, solo numeri');
await foto('10-gruppi-numeri');

R.sezione('Benvenuto e riepilogo');
await p.evaluate(() => S.setWelcome()); await sleep(600);
R.ok('Benvenuto: "Inquadra il QR code" e indirizzo con il codice', /Inquadra/.test(await p.locator('.t-title').innerText()) && (await p.locator('.t-welcome-text').innerText()).includes(ev.code));
await foto('11-benvenuto');
await p.evaluate(([a, b2, ra, rb]) => { S.setSummary(Object.assign({ id: a.id }, a.data), Object.assign({ id: b2.id }, b2.data)); S.setResults(ra); S.setResults(rb); }, [qa, qBase, ra, await risultati(qBase)]);
await sleep(1500);
const tSum = await p.evaluate(() => document.querySelector('.t-stage').innerText.replace(/\s+/g, ' '));
R.ok('Riepilogo: le due domande con le loro percentuali (40% e 60%)', tSum.includes('numero preferito') && tSum.includes('Sei studente') && tSum.includes('40%') && tSum.includes('60%'), tSum.slice(0, 160));
await foto('12-riepilogo');

R.ok('Nessun errore nelle pagine', !errs.length, errs.join(' | '));
await b.close(); srv.close();
R.fine();
