// Taxi1729 Poll — test di carico e di riconnessione.
//
// Simula un evento con N telefoni collegati (1000 di default) e una presentazione, e controlla che:
//  1. tutti i telefoni si colleghino e ricevano la domanda;
//  2. tutti possano votare e ogni voto venga contato una sola volta;
//  3. dopo una caduta di rete (30% dei telefoni) chi si ricollega ritrovi il suo stato e non possa votare due volte;
//  4. il cambio di domanda arrivi a tutti in fretta (Crowd Wisdom);
//  5. se TUTTI i telefoni cadono insieme (es. il server si riavvia) si ricolleghino tutti senza perdere voti;
//  6. un voto spedito proprio mentre la connessione cade non vada perso;
//  7. una breve caduta della presentazione (< 8 s) non chiuda la domanda ai telefoni, una lunga sì,
//     e al ritorno della presentazione la domanda riappaia.
//
// Uso:
//   BASE_URL=https://... EMAIL=... PASSWORD=... node loadtest/carico.mjs
// Opzioni (variabili d'ambiente): USERS=1000, RAMP_SECONDS=20, VOTE_SECONDS=10, KEEP=1 (non cancella l'evento di prova)
// Serve Node 22 o successivo (WebSocket incluso).

const BASE = (process.env.BASE_URL || "http://localhost:8787").replace(/\/$/, "");
const WS_BASE = BASE.replace(/^http/, "ws");
const USERS = +process.env.USERS || 1000;
const RAMP = +process.env.RAMP_SECONDS || 20;
const VOTE_SEC = +process.env.VOTE_SECONDS || 10;
const KEEP = process.env.KEEP === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const rnd = (a, b) => a + Math.random() * (b - a);
const results = [];          // righe del riepilogo
const reasons = {};          // motivi dei tentativi di collegamento falliti
let failures = 0;
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "ERRORE"}  ${name}${detail ? " — " + detail : ""}`);
}
function pct(arr, p) { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function ms(x) { return isNaN(x) ? "–" : x < 1000 ? Math.round(x) + " ms" : (x / 1000).toFixed(1) + " s"; }
function stats(arr) { return `mediana ${ms(pct(arr, 0.5))}, 95% entro ${ms(pct(arr, 0.95))}, peggiore ${ms(Math.max(...arr))}`; }
async function until(cond, timeoutMs, step = 100) {
  const t0 = now();
  while (now() - t0 < timeoutMs) { if (cond()) return true; await sleep(step); }
  return cond();
}

let token = null;
async function api(path, body, method) {
  const r = await fetch(BASE + "/api/" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${r.status} ${d.error || ""}`);
  return d;
}

// ------------------------------------------------------------------ un telefono finto
class Phone {
  constructor(i, code) {
    this.i = i; this.code = code;
    this.voter = "lt" + i.toString(36) + Math.random().toString(36).slice(2, 10);
    this.ws = null; this.open = false; this.state = null; this.voted = {}; this.acks = {}; this.errors = 0;
    this.stateAt = 0; this.connects = 0; this.onState = null;
  }
  connect() {
    return new Promise((resolve) => {
      const t0 = now();
      let done = false;
      const ws = new WebSocket(`${WS_BASE}/ws?role=audience&code=${this.code}&voter=${this.voter}`);
      this.ws = ws;
      const fin = (ok, why) => {
        if (done) return; done = true;
        if (!ok) { reasons[why] = (reasons[why] || 0) + 1; try { ws.close(); } catch {} }
        resolve(ok ? now() - t0 : null);
      };
      ws.onopen = () => { this.open = true; this.connects++; };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === "state") {
          this.state = m; this.stateAt = now();
          if (m.q && m.voted) this.voted[m.q.id] = true;
          if (this.onState) this.onState(m);
          fin(true);
        } else if (m.t === "voted") { this.voted[m.q] = true; this.acks[m.q] = (this.acks[m.q] || 0) + 1; if (m.already) this.already = (this.already || 0) + 1; if (this._voteT0) { this.voteLat = now() - this._voteT0; this._voteT0 = null; } }
        else if (m.t === "error") this.errors++;
      };
      ws.onclose = (e) => { this.open = false; fin(false, this.connects && ws.readyState !== 0 ? `chiusa dal server (codice ${e.code})` : `rifiutata (codice ${e.code})`); };
      ws.onerror = (e) => { if (!this.open) fin(false, "errore: " + ((e && e.message) || "connessione non riuscita")); };
      setTimeout(() => fin(false, "nessuna risposta entro 10 s"), 10000);
    });
  }
  // come la pagina vera: se il tentativo fallisce riprova (attesa 0,8-3,3 s, poi sempre più lunga, max 8 s)
  async connectRetry(maxMs = 60000) {
    const t0 = now(); let attempt = 0;
    while (now() - t0 < maxMs) {
      if (attempt) await sleep(Math.min(8000, 500 * Math.pow(1.6, attempt)) + Math.random() * (attempt === 1 ? 2500 : 600));
      attempt++;
      const t = await this.connect();
      if (t !== null) { this.attempts = attempt; return now() - t0; }
    }
    this.attempts = attempt; return null;
  }
  send(o) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(o)); return true; } return false; }
  vote(q, payload) { this._voteT0 = now(); return this.send({ t: "vote", q, ...payload }); }
  drop() { try { this.ws.close(); } catch {} this.open = false; }
}

// ------------------------------------------------------------------ la presentazione finta
class Presenter {
  constructor(eventId) { this.eventId = eventId; this.q = null; this.results = {}; this.beat = null; this.ws = null; }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_BASE}/ws?role=presenter&event=${this.eventId}&token=${token}`);
      this.ws = ws;
      ws.onopen = () => { this.announce(); resolve(); };
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "results") this.results[m.q] = m; if (m.t === "locked") console.log("evento bloccato da", m.by); };
      ws.onerror = () => reject(new Error("presentazione: collegamento non riuscito"));
      clearInterval(this.beat); this.beat = setInterval(() => this.announce(), 2000);
    });
  }
  announce() { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: "show", q: this.q, k: "loadtest", force: true })); }
  show(q) { this.q = q; this.announce(); }
  drop() { clearInterval(this.beat); try { this.ws.close(); } catch {} }
  stop() { clearInterval(this.beat); try { this.ws.send(JSON.stringify({ t: "stop" })); this.ws.close(); } catch {} }
}

const t00 = Date.now();
// Riepilogo in tabella (anche nella pagina "Summary" di GitHub), scritto anche se il test si interrompe a metà.
async function writeSummary(extra) {
  const summary = [`## Test di carico Taxi1729 Poll`, ``, `Server: ${BASE} · Telefoni simulati: ${USERS} · Durata: ${Math.round((Date.now() - t00) / 1000)} s`, ``,
    `| Esito | Prova | Dettagli |`, `|---|---|---|`,
    ...results.map((r) => `| ${r.ok ? "✅" : "❌"} | ${r.name} | ${r.detail} |`), ``,
    extra ? `**Test interrotto:** ${extra}` : failures ? `**${failures} prove non superate.**` : `**Tutte le prove superate.**`].join("\n");
  console.log("\n" + summary);
  if (process.env.GITHUB_STEP_SUMMARY) (await import("node:fs")).appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
}

async function main() {
  console.log(`Test su ${BASE} con ${USERS} telefoni\n`);
  token = (await api("login", { email: process.env.EMAIL, password: process.env.PASSWORD })).token;
  const ev = (await api("events", { name: "Test di carico " + new Date().toISOString().slice(0, 16).replace("T", " ") })).event;
  console.log(`Evento di prova creato: ${ev.name} (codice ${ev.code})`);
  const q1 = (await api(`events/${ev.id}/questions`, { data: { title: "Test di carico: scelta multipla", options: ["A", "B", "C", "D"] } })).question;
  const q2 = (await api(`events/${ev.id}/questions`, { data: { kind: "cw", title: "Test di carico: stima", min: 0 } })).question;

  const pres = new Presenter(ev.id);
  try {
    await pres.connect();
    pres.show(q1.id);
    await sleep(500);

    // ---------------------------------------------------------------- 1. collegamento graduale
    const phones = Array.from({ length: USERS }, (_, i) => new Phone(i, ev.code));
    const connT = [];
    const tRamp = now();
    await Promise.all(phones.map(async (p, i) => {
      await sleep((i / USERS) * RAMP * 1000);
      const t = await p.connectRetry();
      if (t !== null) connT.push(t);
    }));
    const withQ = phones.filter((p) => p.state && p.state.q && p.state.q.id === q1.id).length;
    check(`Collegamento di ${USERS} telefoni in ${RAMP} s`, connT.length === USERS && withQ === USERS,
      `${connT.length} collegati, ${withQ} vedono la domanda; tempo di collegamento: ${stats(connT)} (totale ${ms(now() - tRamp)})`);

    // ---------------------------------------------------------------- 2. voto di tutti
    await Promise.all(phones.map(async (p) => { await sleep(rnd(0, VOTE_SEC * 1000)); p.vote(q1.id, { choices: [Math.floor(Math.random() * 4)] }); }));
    await until(() => phones.every((p) => p.voted[q1.id]), 15000);
    const voteLat = phones.map((p) => p.voteLat).filter((x) => x != null);
    let r1 = await api(`questions/${q1.id}/results`);
    check("Tutti i voti ricevuti e confermati", r1.total === USERS && voteLat.length === USERS,
      `${r1.total}/${USERS} contati, conferma al telefono: ${stats(voteLat)}`);
    await until(() => pres.results[q1.id] && pres.results[q1.id].total === USERS, 3000);
    check("La slide riceve il totale aggiornato", pres.results[q1.id] && pres.results[q1.id].total === USERS, `la slide mostra ${pres.results[q1.id] ? pres.results[q1.id].total : 0}`);

    // ---------------------------------------------------------------- 3. caduta del 30% e ritorno
    const drop = phones.filter(() => Math.random() < 0.3);
    drop.forEach((p) => p.drop());
    await sleep(300);
    const reconT = [];
    await Promise.all(drop.map(async (p) => { await sleep(rnd(200, 3000)); const t = await p.connectRetry(); if (t !== null) reconT.push(t); }));
    const kept = drop.filter((p) => p.state && p.state.voted).length;
    check(`Caduta di rete di ${drop.length} telefoni: si ricollegano e ritrovano "risposta inviata"`, reconT.length === drop.length && kept === drop.length,
      `${reconT.length} ricollegati (${stats(reconT)}), ${kept} riconosciuti come già votanti`);
    drop.forEach((p) => { p.already = 0; p.vote(q1.id, { choices: [0] }); });
    await until(() => drop.every((p) => p.already), 8000);
    r1 = await api(`questions/${q1.id}/results`);
    check("Chi prova a votare di nuovo non viene contato due volte", r1.total === USERS && drop.every((p) => p.already), `totale ${r1.total}/${USERS}`);

    // ---------------------------------------------------------------- 4. cambio domanda
    const tSwitch = now();
    phones.forEach((p) => { p.gotQ2 = null; p.onState = (m) => { if (m.q && m.q.id === q2.id && p.gotQ2 == null) p.gotQ2 = now() - tSwitch; }; });
    pres.show(q2.id);
    await until(() => phones.every((p) => p.gotQ2 != null), 10000);
    const sw = phones.map((p) => p.gotQ2).filter((x) => x != null);
    check("Cambio di domanda arriva a tutti i telefoni", sw.length === USERS, `${sw.length}/${USERS}; ritardo: ${stats(sw)}`);
    await Promise.all(phones.map(async (p) => { await sleep(rnd(0, VOTE_SEC * 1000)); p.vote(q2.id, { value: Math.round(rnd(100, 900)) }); }));
    await until(() => phones.every((p) => p.voted[q2.id]), 15000);
    const r2 = await api(`questions/${q2.id}/results`);
    check("Stime Crowd Wisdom ricevute", r2.total === USERS, `${r2.total}/${USERS}, mediana ${r2.stats ? r2.stats.median : "–"}`);

    // ---------------------------------------------------------------- 5. tutti giù insieme (come un riavvio del server)
    phones.forEach((p) => p.drop());
    await sleep(500);
    const tAll = now(); const allT = [];
    // i telefoni veri riprovano dopo 0,8-3,3 s (attesa casuale per non arrivare tutti nello stesso istante)
    await Promise.all(phones.map(async (p) => { await sleep(rnd(800, 3300)); const t = await p.connectRetry(); if (t !== null) allT.push(t); }));
    const back = phones.filter((p) => p.state && p.state.q && p.state.q.id === q2.id && p.state.voted).length;
    const retried = phones.filter((p) => p.attempts > 1).length;
    check("Riconnessione di massa: tutti tornano con il loro stato", allT.length === USERS && back === USERS,
      `${allT.length} ricollegati, ultimo dopo ${ms(now() - tAll)}; ${back} ritrovano la domanda come già votata; ` +
      `${retried} hanno avuto bisogno di più tentativi; tempo per rientrare: ${stats(allT)}`);

    // ---------------------------------------------------------------- 6. voto spedito mentre la connessione cade
    const q3 = (await api(`events/${ev.id}/questions`, { data: { title: "Test di carico: voto durante la caduta", options: ["Sì", "No"] } })).question;
    pres.show(q3.id);
    await until(() => phones.every((p) => p.state && p.state.q && p.state.q.id === q3.id), 8000);
    const flaky = phones.slice(0, Math.round(USERS * 0.1));
    flaky.forEach((p) => { p.vote(q3.id, { choices: [1] }); p.drop(); });   // voto e caduta nello stesso istante
    await sleep(200);
    await Promise.all(flaky.map(async (p) => { await sleep(rnd(300, 1500)); await p.connectRetry(); }));
    // come fa la pagina del pubblico: se al ritorno il voto non risulta, lo rispedisce
    const resent = flaky.filter((p) => !(p.state && p.state.voted));
    resent.forEach((p) => p.vote(q3.id, { choices: [1] }));
    await until(() => flaky.every((p) => p.voted[q3.id]), 8000);
    const r3 = await api(`questions/${q3.id}/results`);
    check("Voto spedito durante una caduta: nessuno perso, nessuno doppio", r3.total === flaky.length,
      `${r3.total}/${flaky.length} contati (${flaky.length - resent.length} erano già arrivati, ${resent.length} rispediti al ritorno)`);

    // ---------------------------------------------------------------- 7. caduta della presentazione
    const sawWait = () => phones.filter((p) => p.state && !p.state.q).length;
    pres.drop();
    await sleep(4000);
    await pres.connect(); pres.show(q3.id);
    await sleep(1000);
    check("Breve caduta della presentazione (4 s): i telefoni non se ne accorgono", sawWait() === 0, `${sawWait()} telefoni sono passati all'attesa`);
    pres.drop();
    await until(() => sawWait() === USERS, 20000);
    check("Caduta lunga della presentazione: i telefoni passano all'attesa", sawWait() === USERS, `${sawWait()}/${USERS} in attesa`);
    const tBack = now();
    phones.forEach((p) => { p.backAt = null; p.onState = (m) => { if (m.q && p.backAt == null) p.backAt = now() - tBack; }; });
    await pres.connect(); pres.show(q3.id);
    await until(() => phones.every((p) => p.backAt != null), 10000);
    const bk = phones.map((p) => p.backAt).filter((x) => x != null);
    check("Al ritorno della presentazione la domanda riappare a tutti", bk.length === USERS, `${bk.length}/${USERS}; ritardo: ${stats(bk)}`);

    const nFail = Object.values(reasons).reduce((a, b) => a + b, 0);
    const totTries = phones.reduce((a, p) => a + p.connects, 0) + nFail;
    check("Tentativi di collegamento falliti (poi ripetuti) sotto l'1%", nFail <= totTries * 0.01,
      nFail ? `${nFail} su ${totTries}: ` + Object.entries(reasons).map(([k, v]) => `${v} × ${k}`).join(", ") : `0 su ${totTries}`);
    const errs = phones.reduce((a, p) => a + p.errors, 0);
    check("Nessun errore segnalato dal server ai telefoni", errs === 0, errs ? `${errs} errori` : "");
    phones.forEach((p) => p.drop());
  } finally {
    pres.stop();
    if (!KEEP) { await api(`events/${ev.id}`, null, "DELETE").catch((e) => console.log("pulizia non riuscita:", e.message)); console.log("Evento di prova cancellato."); }
  }

  await writeSummary();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => { console.error("Test interrotto:", e.message); await writeSummary(e.message); process.exit(2); });
