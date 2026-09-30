// Taxi1729 Poll — server su Cloudflare.
//
// Il Worker fa da "portinaio": le pagine web le serve Cloudflare direttamente (cartella public/),
// mentre tutto ciò che riguarda dati e tempo reale (/api/... e /ws) viene passato a un unico
// Durable Object, "Hub", che conserva i dati in un database SQLite interno e tiene aperti
// i collegamenti con PowerPoint, il pannello e i telefoni del pubblico.

const STALE_MS = 8000;              // senza conferme dalla slide per 8 s, la domanda si chiude per il pubblico
const HIDE_GRACE_MS = 2500;         // attesa prima di chiudere una domanda quando la sua slide si chiude
const LOCK_MS = 10 * 60 * 1000;     // una presentazione senza segnali da 10 minuti è considerata "sospesa"
const SESSION_MS = 60 * 24 * 3600 * 1000;
const PBKDF2_ITER = 20000;
const MAX_OPTIONS = 12;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
      return hubStub(env).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

// Un solo Hub per tutta l'applicazione, con i dati conservati nell'Unione Europea.
function hubStub(env) {
  let ns = env.HUB;
  try { ns = env.HUB.jurisdiction("eu"); } catch (e) { /* giurisdizione non disponibile: si usa quella standard */ }
  return ns.get(ns.idFromName("main"));
}

// ---------------------------------------------------------------------------------------------
// Funzioni di servizio
// ---------------------------------------------------------------------------------------------
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function fail(status, msg) { throw new HttpError(status, msg); }
function str(v, max) { return (typeof v === "string" ? v : "").trim().slice(0, max); }
function rid(n = 12) {
  const a = "abcdefghijkmnpqrstuvwxyz23456789", b = crypto.getRandomValues(new Uint8Array(n));
  let s = ""; for (const x of b) s += a[x % a.length]; return s;
}
function hex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join(""); }
async function hashPassword(password, saltHex, iter = PBKDF2_ITER) {
  const salt = saltHex ? Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16))) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
  return `pbkdf2$${iter}$${hex(salt)}$${hex(bits)}`;
}
async function checkPassword(password, stored) {
  const [, iter, salt] = String(stored).split("$");
  const again = await hashPassword(password, salt, parseInt(iter, 10));
  if (again.length !== stored.length) return false;
  let diff = 0; for (let i = 0; i < again.length; i++) diff |= again.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}
function csvCell(v) { const s = String(v ?? ""); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

// Messaggio per un numero non valido (se l'utente non ne ha scritto uno suo)
function crowdHint(d) {
  const f = (x) => Number(x).toLocaleString("it-IT");
  let s = d.decimals ? "Inserisci un numero" : "Inserisci un numero intero";
  if (d.min !== null && d.max !== null) s += ` tra ${f(d.min)} e ${f(d.max)}`;
  else if (d.min === 0 && !d.decimals) s = "Inserisci un numero intero positivo o zero";
  else if (d.min !== null) s += ` non inferiore a ${f(d.min)}`;
  else if (d.max !== null) s += ` non superiore a ${f(d.max)}`;
  return s;
}
// Larghezza "tonda" delle colonne: 1, 2, 2,5, 5 × 10^k
function niceStep(x, decimals) {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p;
  let s = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 && p >= 10 ? 2.5 : m <= 5 ? 5 : 10) * p;
  if (!decimals) s = Math.max(1, Math.round(s));
  return s;
}
// Istogramma delle stime. Se chi crea la domanda non fissa inizio/larghezza/fine, le colonne si calcolano
// sui valori ricevuti (circa 12 colonne), ignorando le stime più estreme, che finiscono nelle colonne
// laterali "sotto …" / "oltre …".
function histogram(vals, d) {
  const n = vals.length;
  const q = (p) => vals[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
  let start = d.binStart, size = d.binSize, end = d.binEnd;
  if (start === null || size === null || end === null) {
    let lo, hi;
    if (!n) { lo = d.min ?? 0; hi = d.max ?? lo + 100; }
    else if (n < 20) { lo = vals[0]; hi = vals[n - 1]; }
    else { lo = q(0.02); hi = q(0.95); }
    if (start !== null) lo = start;
    if (end !== null) hi = end;
    if (d.min !== null && lo < d.min) lo = d.min;
    if (d.max !== null && hi > d.max) hi = d.max;
    if (!(hi > lo)) hi = lo + (d.decimals ? 1 : 10);
    if (size === null) size = niceStep((hi - lo) / 12, d.decimals);
    if (start === null) { start = Math.floor(lo / size) * size; if (lo >= 0 && start < 0) start = 0; }
    let nb = Math.max(1, Math.ceil((hi - start) / size - 1e-9));
    if (end === null) {
      if (start + nb * size <= hi) nb++;
      // allarga per includere le stime fuori scala se bastano poche colonne in più
      if (n) while (nb < 16 && vals[n - 1] >= start + nb * size && vals[n - 1] < start + (nb + 3) * size) nb++;
    }
    end = start + Math.min(nb, 40) * size;
  }
  const nb = Math.max(1, Math.min(60, Math.round((end - start) / size)));
  return binValues(vals, start, size, nb, d);
}
// Conta i valori negli intervalli dati (usata anche per i gruppi, con gli stessi intervalli del totale)
function binValues(vals, start, size, nb, d) {
  const end = start + nb * size;
  const counts = Array(nb).fill(0);
  let under = 0, over = 0;
  for (const v of vals) {
    if (v < start) under++;
    else if (v >= end && !(v === end && d.max !== null && v === d.max)) over++;
    else counts[Math.min(nb - 1, Math.floor((v - start) / size + 1e-9))]++;
  }
  return { start, size, counts, under, over };
}
// Media, mediana, minimo e massimo di valori già ordinati
function statsOf(vals) {
  const n = vals.length;
  if (!n) return null;
  return { mean: vals.reduce((a, b) => a + b, 0) / n, median: n % 2 ? vals[(n - 1) / 2] : (vals[n / 2 - 1] + vals[n / 2]) / 2, min: vals[0], max: vals[n - 1] };
}

// ---------------------------------------------------------------------------------------------
// Hub: dati + tempo reale
// ---------------------------------------------------------------------------------------------
export class Hub {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    this.migrate();
    this.qcache = new Map();      // domande lette di recente
    this.tallies = new Map();     // voti in memoria, per domanda: voter -> scelte
    this.groupCache = new Map();  // gruppi delle domande con due versioni, per domanda: { map: voter -> 0/1, n: [quanti A, quanti B] }
    this.live = new Map();        // eventId -> stato della presentazione
    for (const r of this.all("SELECT * FROM live")) {
      this.live.set(r.event_id, { qid: r.question_id || null, since: r.since, userId: r.user_id, userName: r.user_name,
        lastBeat: Date.now(), revealed: !!r.revealed });
    }
    this.dirty = new Set(); this.flushTimer = null;
    this.sims = new Map();        // simulazioni di voto in corso, per domanda
    this.loginFails = new Map();
    this.boot = rid(8);           // cambia a ogni riavvio (usato dal test di carico per accorgersene)
  }

  // ----- database -----
  migrate() {
    const ddl = [
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pass TEXT NOT NULL, created INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, template TEXT NOT NULL DEFAULT 'taxi1729', created_by TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, pos INTEGER NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL)",
      "CREATE INDEX IF NOT EXISTS questions_event ON questions(event_id, pos)",
      "CREATE TABLE IF NOT EXISTS votes (question_id TEXT NOT NULL, voter TEXT NOT NULL, choices TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (question_id, voter))",
      "CREATE TABLE IF NOT EXISTS live (event_id TEXT PRIMARY KEY, question_id TEXT, since INTEGER, user_id TEXT, user_name TEXT, revealed INTEGER NOT NULL DEFAULT 0)",
      // domande con due versioni: a quale gruppo (0 = A, 1 = B) è stato assegnato ogni telefono
      "CREATE TABLE IF NOT EXISTS groups (question_id TEXT NOT NULL, voter TEXT NOT NULL, g INTEGER NOT NULL, PRIMARY KEY (question_id, voter))"
    ];
    for (const q of ddl) this.sql.exec(q);
    // v2: voti simulati (per provare la grafica), marcati a parte
    const cols = this.sql.exec("PRAGMA table_info(votes)").toArray().map(c => c.name);
    if (!cols.includes("sim")) this.sql.exec("ALTER TABLE votes ADD COLUMN sim INTEGER NOT NULL DEFAULT 0");
  }
  all(q, ...a) { return this.sql.exec(q, ...a).toArray(); }
  get(q, ...a) { return this.all(q, ...a)[0] || null; }
  run(q, ...a) { this.sql.exec(q, ...a); }

  getQ(id) {
    if (!id) return null;
    if (this.qcache.has(id)) return this.qcache.get(id);
    const r = this.get("SELECT * FROM questions WHERE id = ?", id);
    const q = r ? { id: r.id, eventId: r.event_id, pos: r.pos, data: JSON.parse(r.data), updated: r.updated } : null;
    if (q) this.qcache.set(id, q);
    return q;
  }
  eventQuestions(eventId) {
    return this.all("SELECT * FROM questions WHERE event_id = ? ORDER BY pos", eventId)
      .map(r => ({ id: r.id, eventId: r.event_id, pos: r.pos, data: JSON.parse(r.data), updated: r.updated }));
  }
  getEvent(id) { return this.get("SELECT * FROM events WHERE id = ?", id); }
  pubEvent(e) {
    const L = this.live.get(e.id);
    const presenting = L && Date.now() - L.lastBeat < LOCK_MS ? { by: L.userName, userId: L.userId, q: L.qid } : null;
    return { id: e.id, code: e.code, name: e.name, template: e.template, created: e.created, updated: e.updated, presenting };
  }

  // ----- autenticazione -----
  userFromToken(token) {
    if (!token) return null;
    const r = this.get("SELECT u.id, u.email, u.name, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?", token);
    if (!r || r.expires < Date.now()) return null;
    return { id: r.id, email: r.email, name: r.name };
  }
  tokenOf(request, url) {
    const h = request.headers.get("authorization") || "";
    return h.replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
  }
  newSession(userId) {
    const token = rid(40);
    this.run("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)", token, userId, Date.now() + SESSION_MS);
    this.run("DELETE FROM sessions WHERE expires < ?", Date.now());
    return token;
  }

  // ----- pulizia dei dati delle domande -----
  cleanQuestion(d, eventId) {
    d = d || {};
    if (d.kind === "cw") return this.cleanCrowd(d, eventId);
    const o = { kind: "mc" };
    o.title = str(d.title, 300);
    this.cleanVariant(d, o);
    let opts = Array.isArray(d.options) ? d.options.map(x => str(x, 140)) : [];
    if (opts.length < 2) fail(400, "Servono almeno 2 risposte");
    if (opts.length > MAX_OPTIONS) fail(400, `Al massimo ${MAX_OPTIONS} risposte`);
    o.options = opts;
    o.multi = !!d.multi;
    o.chart = ["bar", "vbar", "pie", "dots"].includes(d.chart) ? d.chart : "bar";
    o.reveal = d.reveal === "click" ? "click" : "live";
    o.segmentBy = null;
    if (typeof d.segmentBy === "string" && d.segmentBy) {
      const b = this.getQ(d.segmentBy);
      if (b && b.eventId === eventId && !b.data.multi && b.data.kind !== "cw") o.segmentBy = b.id;
    }
    if (o.titleB) o.segmentBy = null;     // i risultati sono già divisi per versione
    return o;
  }
  // Due versioni della stessa domanda: metà del pubblico legge "title" (gruppo A), metà "titleB" (gruppo B).
  // Sullo schermo compare solo "screenTitle", neutro, così nessuno vede la versione dell'altro gruppo.
  cleanVariant(d, o) {
    o.titleB = str(d.titleB, 300);
    if (!o.titleB) { delete o.titleB; return; }
    o.groupA = str(d.groupA, 40) || "Gruppo A";
    o.groupB = str(d.groupB, 40) || "Gruppo B";
    o.screenTitle = str(d.screenTitle, 160);
  }
  // Crowd Wisdom: il pubblico scrive un numero (una stima), i risultati sono un istogramma.
  cleanCrowd(d, eventId) {
    const num = (v) => { if (v === null || v === undefined || v === "") return null; const x = Number(v); return Number.isFinite(x) && Math.abs(x) < 1e12 ? x : null; };
    const o = { kind: "cw" };
    o.title = str(d.title, 300);
    o.showTitle = !!d.showTitle;
    o.unit = str(d.unit, 30);
    o.decimals = !!d.decimals;
    o.min = num(d.min); o.max = num(d.max);
    if (o.min !== null && o.max !== null && o.max <= o.min) fail(400, "Il massimo deve essere più grande del minimo");
    o.error = str(d.error, 140);
    o.line = ["median", "mean", "none"].includes(d.line) ? d.line : "median";
    o.answer = num(d.answer);
    o.binStart = num(d.binStart); o.binSize = num(d.binSize); o.binEnd = num(d.binEnd);
    if (o.binSize !== null && o.binSize <= 0) fail(400, "La larghezza delle colonne deve essere maggiore di zero");
    if (o.binStart !== null && o.binEnd !== null && o.binEnd <= o.binStart) fail(400, "Il valore finale dell'istogramma deve essere più grande di quello iniziale");
    o.reveal = d.reveal === "click" ? "click" : "live";
    o.chart = "hist";
    // risultati separati per i gruppi di una domanda precedente con due versioni
    o.splitBy = null;
    if (typeof d.splitBy === "string" && d.splitBy) {
      const b = this.getQ(d.splitBy);
      if (b && b.eventId === eventId && b.data.titleB) o.splitBy = b.id;
    }
    this.cleanVariant(d, o);
    return o;
  }

  // ----- gruppi (domande con due versioni) -----
  groupsOf(qid) {
    let G = this.groupCache.get(qid);
    if (G) return G;
    G = { map: new Map(), n: [0, 0] };
    for (const r of this.all("SELECT voter, g FROM groups WHERE question_id = ?", qid)) { G.map.set(r.voter, r.g); G.n[r.g]++; }
    this.groupCache.set(qid, G);
    return G;
  }
  // Gruppo di un telefono; se non ne ha ancora uno lo assegna al gruppo meno numeroso (così restano 50 e 50).
  groupFor(qid, voter, create) {
    const G = this.groupsOf(qid);
    if (G.map.has(voter)) return G.map.get(voter);
    if (!create) return null;
    const g = G.n[0] === G.n[1] ? (Math.random() < 0.5 ? 0 : 1) : G.n[0] < G.n[1] ? 0 : 1;
    G.map.set(voter, g); G.n[g]++;
    this.run("INSERT OR IGNORE INTO groups (question_id, voter, g) VALUES (?, ?, ?)", qid, voter, g);
    return g;
  }
  dropGroups(qid, simOnly) {
    this.run("DELETE FROM groups WHERE question_id = ?" + (simOnly ? " AND voter LIKE 'sim-%'" : ""), qid);
    this.groupCache.delete(qid);
  }

  // ----- voti e risultati -----
  tally(qid) {
    let t = this.tallies.get(qid);
    if (t) return t;
    t = { byVoter: new Map() };
    for (const r of this.all("SELECT voter, choices FROM votes WHERE question_id = ?", qid)) t.byVoter.set(r.voter, JSON.parse(r.choices));
    this.tallies.set(qid, t);
    return t;
  }
  results(qid) {
    const q = this.getQ(qid); if (!q) return null;
    if (q.data.kind === "cw") return this.crowdResults(q);
    const n = q.data.options.length, t = this.tally(qid);
    const counts = Array(n).fill(0);
    for (const ch of t.byVoter.values()) for (const i of ch) if (i >= 0 && i < n) counts[i]++;
    let sim = 0; for (const v of t.byVoter.keys()) if (v.startsWith("sim-")) sim++;
    const res = { t: "results", q: qid, total: t.byVoter.size, counts, sim };
    if (q.data.titleB) {
      // risultati divisi per versione della domanda
      const G = this.groupsOf(qid), seg = [Array(n).fill(0), Array(n).fill(0), Array(n).fill(0)];
      for (const [voter, ch] of t.byVoter) { const g = G.map.get(voter); const s = g === 0 || g === 1 ? g : 2; for (const i of ch) if (i >= 0 && i < n) seg[s][i]++; }
      res.seg = { base: qid, variant: true, title: "Versione della domanda", labels: [q.data.groupA, q.data.groupB, "Senza gruppo"], counts: seg };
      return res;
    }
    const base = q.data.segmentBy ? this.getQ(q.data.segmentBy) : null;
    if (base) {
      const bt = this.tally(base.id), bn = base.data.options.length;
      const seg = Array.from({ length: bn + 1 }, () => Array(n).fill(0));   // ultima riga: chi non ha risposto alla domanda base
      for (const [voter, ch] of t.byVoter) {
        const b = bt.byVoter.get(voter); const s = b && b.length && b[0] < bn ? b[0] : bn;
        for (const i of ch) if (i >= 0 && i < n) seg[s][i]++;
      }
      res.seg = { base: base.id, title: base.data.title, labels: base.data.options.concat(["Nessuna risposta"]), counts: seg };
    }
    return res;
  }
  crowdResults(q) {
    const t = this.tally(q.id), vals = [];
    const base = q.data.splitBy ? this.getQ(q.data.splitBy) : null;
    const G = base && base.data.titleB ? this.groupsOf(base.id) : null;
    const byG = [[], [], []];
    let sim = 0;
    for (const [v, ch] of t.byVoter) {
      if (v.startsWith("sim-")) sim++;
      if (typeof ch[0] !== "number") continue;
      vals.push(ch[0]);
      if (G) { const g = G.map.get(v); byG[g === 0 || g === 1 ? g : 2].push(ch[0]); }
    }
    vals.sort((a, b) => a - b);
    const hist = histogram(vals, q.data);
    const res = { t: "results", q: q.id, kind: "cw", total: t.byVoter.size, sim, stats: statsOf(vals), hist };
    if (G) {
      // stessi intervalli per tutti i gruppi, così i due istogrammi sono confrontabili
      res.groups = [0, 1, 2].map((g) => {
        const vs = byG[g].sort((a, b) => a - b);
        return { label: g === 2 ? "Senza gruppo" : g ? base.data.groupB : base.data.groupA, total: vs.length, stats: statsOf(vs), hist: binValues(vs, hist.start, hist.size, hist.counts.length, q.data) };
      });
    }
    return res;
  }
  markDirty(qid) {
    this.dirty.add(qid);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 300);
  }
  flush() {
    this.flushTimer = null;
    const ids = [...this.dirty]; this.dirty.clear();
    for (const qid of ids) {
      const q = this.getQ(qid); if (!q) continue;
      const res = this.results(qid);
      this.sendAll("p:" + q.eventId, res);
      // anche le domande segmentate su questa cambiano
      for (const other of this.eventQuestions(q.eventId)) if (other.data.segmentBy === qid) this.sendAll("p:" + q.eventId, this.results(other.id));
    }
  }
  // ----- simulazione di voti (solo per provare la grafica) -----
  // I votanti simulati hanno un identificativo "sim-…", che i telefoni veri non possono usare.
  startSim(q, count, seconds) {
    this.stopSim(q.id);
    if (q.data.kind === "cw") return this.startCrowdSim(q, count, seconds);
    const n = q.data.options.length;
    const base = q.data.segmentBy ? this.getQ(q.data.segmentBy) : null;
    const bn = base ? base.data.options.length : 0;
    const mkW = () => Array.from({ length: n }, () => 0.2 + Math.random() ** 1.5);   // alcune risposte più popolari di altre
    const weights = base ? Array.from({ length: bn }, mkW) : q.data.titleB ? [mkW(), mkW()] : [mkW()];
    const baseW = base ? Array.from({ length: bn }, () => 0.25 + Math.random()) : null;
    const pick = (ws) => { let r = Math.random() * ws.reduce((a, b) => a + b, 0); for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r <= 0) return i; } return ws.length - 1; };
    const baseVoters = base ? [...this.tally(base.id).byVoter.entries()].filter(([v]) => v.startsWith("sim-")) : [];
    let bi = 0;
    const perTick = seconds > 0 ? Math.max(1, Math.ceil(count / (seconds * 4))) : count;
    const job = { made: 0, total: count, timer: null };
    this.sims.set(q.id, job);
    const tick = () => {
      if (this.sims.get(q.id) !== job) return;
      const L = this.live.get(q.eventId);
      if (!L || L.qid !== q.id) { this.stopSim(q.id); return; }      // domanda chiusa: la simulazione si ferma
      const t = this.tally(q.id), now = Date.now();
      for (let k = 0; k < perTick && job.made < job.total; k++) {
        let voter = null, seg = 0;
        if (base) {
          while (bi < baseVoters.length && t.byVoter.has(baseVoters[bi][0])) bi++;
          if (bi < baseVoters.length) { voter = baseVoters[bi][0]; seg = Math.min(bn - 1, baseVoters[bi][1][0] || 0); bi++; }
          else {
            voter = "sim-" + rid(10); seg = pick(baseW);
            this.run("INSERT OR IGNORE INTO votes (question_id, voter, choices, created, sim) VALUES (?, ?, ?, ?, 1)", base.id, voter, JSON.stringify([seg]), now);
            this.tally(base.id).byVoter.set(voter, [seg]); this.markDirty(base.id);
          }
        } else voter = "sim-" + rid(10);
        if (q.data.titleB) seg = this.groupFor(q.id, voter, true);     // domanda con due versioni: ogni gruppo vota a modo suo
        const ws = weights[Math.min(seg, weights.length - 1)];
        let choices;
        if (q.data.multi) {
          const mx = Math.max(...ws);
          choices = ws.map((w, i) => (Math.random() < Math.min(0.85, w / mx * 0.6) ? i : -1)).filter(i => i >= 0);
          if (!choices.length) choices = [pick(ws)];
        } else choices = [pick(ws)];
        this.run("INSERT OR IGNORE INTO votes (question_id, voter, choices, created, sim) VALUES (?, ?, ?, ?, 1)", q.id, voter, JSON.stringify(choices), now);
        t.byVoter.set(voter, choices);
        job.made++;
      }
      this.markDirty(q.id);
      if (job.made < job.total) job.timer = setTimeout(tick, 250); else this.sims.delete(q.id);
    };
    tick();
    return job;
  }
  // Stime simulate: distribuzione asimmetrica (log-normale) attorno a un valore centrale, come nelle stime vere.
  startCrowdSim(q, count, seconds) {
    const d = q.data;
    let center = d.answer;
    if (center === null || center === undefined) center = d.min !== null && d.max !== null ? (d.min + d.max) / 2 : d.max !== null ? d.max / 2 : 100 + Math.random() * 900;
    if (center <= 0) center = Math.abs(center) + 10;
    const center2 = center * (0.8 + Math.random() * 0.3);
    const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const one = () => {
      let x = center2 * Math.exp(0.38 * gauss());
      if (Math.random() < 0.04) x *= 2 + Math.random() * 2;     // qualche stima esagerata
      if (d.min !== null) x = Math.max(d.min, x);
      if (d.max !== null) x = Math.min(d.max, x);
      return d.decimals ? Math.round(x * 10) / 10 : Math.round(x);
    };
    // risultati separati per gruppi: si riusano i votanti simulati della domanda con due versioni, e il gruppo B
    // (di solito quello con il valore di riferimento più alto) stima un po' di più, come nell'effetto ancoraggio
    const base = d.splitBy ? this.getQ(d.splitBy) : null;
    const baseVoters = base ? [...this.groupsOf(base.id).map.keys()].filter((v) => v.startsWith("sim-")) : [];
    let bi = 0;
    const perTick = seconds > 0 ? Math.max(1, Math.ceil(count / (seconds * 4))) : count;
    const job = { made: 0, total: count, timer: null };
    this.sims.set(q.id, job);
    const tick = () => {
      if (this.sims.get(q.id) !== job) return;
      const L = this.live.get(q.eventId);
      if (!L || L.qid !== q.id) { this.stopSim(q.id); return; }
      const t = this.tally(q.id), now = Date.now();
      for (let k = 0; k < perTick && job.made < job.total; k++) {
        let voter;
        if (base) {
          while (bi < baseVoters.length && t.byVoter.has(baseVoters[bi])) bi++;
          voter = bi < baseVoters.length ? baseVoters[bi++] : "sim-" + rid(10);
        } else voter = "sim-" + rid(10);
        const g = base ? this.groupFor(base.id, voter, true) : 0;
        let x = one();
        if (g === 1) { x = x * 2.2; if (d.max !== null) x = Math.min(d.max, x); x = d.decimals ? Math.round(x * 10) / 10 : Math.round(x); }
        const v = [x];
        this.run("INSERT OR IGNORE INTO votes (question_id, voter, choices, created, sim) VALUES (?, ?, ?, ?, 1)", q.id, voter, JSON.stringify(v), now);
        t.byVoter.set(voter, v); job.made++;
      }
      this.markDirty(q.id);
      if (job.made < job.total) job.timer = setTimeout(tick, 250); else this.sims.delete(q.id);
    };
    tick();
    return job;
  }
  stopSim(qid) {
    const job = this.sims.get(qid);
    if (job) { clearTimeout(job.timer); this.sims.delete(qid); }
  }

  clearVotes(qids) {
    for (const id of qids) { this.run("DELETE FROM votes WHERE question_id = ?", id); this.dropGroups(id); this.tallies.delete(id); this.markDirty(id); }
  }

  // ----- stato della presentazione -----
  saveLive(eventId) {
    const L = this.live.get(eventId);
    if (!L) { this.run("DELETE FROM live WHERE event_id = ?", eventId); return; }
    this.run("INSERT OR REPLACE INTO live (event_id, question_id, since, user_id, user_name, revealed) VALUES (?, ?, ?, ?, ?, ?)",
      eventId, L.qid, L.since, L.userId, L.userName, L.revealed ? 1 : 0);
  }
  liveMsg(eventId) {
    const L = this.live.get(eventId);
    return { t: "live", q: L ? L.qid : null, revealed: L ? !!L.revealed : false, by: L ? L.userName : null, userId: L ? L.userId : null };
  }
  audienceState(eventId, voter) {
    const L = this.live.get(eventId);
    const q = L && L.qid ? this.getQ(L.qid) : null;
    // domanda con due versioni: ogni telefono legge quella del suo gruppo
    const title = q ? (q.data.titleB && voter && this.groupFor(q.id, voter, true) === 1 ? q.data.titleB : q.data.title) : "";
    return {
      t: "state",
      q: q ? (q.data.kind === "cw"
        ? { id: q.id, kind: "cw", title: title, unit: q.data.unit, decimals: q.data.decimals, min: q.data.min, max: q.data.max, error: q.data.error }
        : { id: q.id, title: title, options: q.data.options, multi: !!q.data.multi }) : null,
      voted: q ? this.tally(q.id).byVoter.has(voter) : false
    };
  }
  pushLive(eventId) {
    this.sendAll("p:" + eventId, this.liveMsg(eventId));
    for (const ws of this.ctx.getWebSockets("a:" + eventId)) {
      const att = ws.deserializeAttachment() || {};
      try { ws.send(JSON.stringify(this.audienceState(eventId, att.voter))); } catch (e) {}
    }
  }
  async ensureAlarm() {
    const a = await this.ctx.storage.getAlarm();
    if (!a) await this.ctx.storage.setAlarm(Date.now() + 4000);
  }
  async alarm() {
    const now = Date.now(); let any = false;
    for (const [ev, L] of this.live) {
      if (L.qid && now - L.lastBeat > STALE_MS) { L.qid = null; L.revealed = false; this.saveLive(ev); this.pushLive(ev); }
      if (L.qid) any = true;
    }
    if (any) await this.ctx.storage.setAlarm(now + 4000);
  }
  sendAll(tag, msg) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets(tag)) { try { ws.send(s); } catch (e) {} }
  }

  // ---------------------------------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------------------------------
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/ws") return this.openSocket(request, url);
      return await this.api(request, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e && e.stack || e);
      return json({ error: "Errore interno del server" }, 500);
    }
  }

  async api(request, url) {
    const m = request.method;
    const p = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "").split("/");
    const body = async () => { try { return await request.json(); } catch (e) { return {}; } };

    // --- pubbliche ---
    if (p[0] === "status" && m === "GET") {
      return json({ needsSetup: !this.get("SELECT id FROM users LIMIT 1"), boot: this.boot });
    }
    if (p[0] === "setup" && m === "POST") {
      if (this.get("SELECT id FROM users LIMIT 1")) fail(403, "Il sistema è già configurato");
      const b = await body();
      return json(await this.createUser(b, true));
    }
    if (p[0] === "login" && m === "POST") {
      const b = await body();
      const email = str(b.email, 200).toLowerCase();
      const f = this.loginFails.get(email);
      if (f && f.n >= 8 && Date.now() - f.t < 10 * 60 * 1000) fail(429, "Troppi tentativi: riprova tra qualche minuto");
      const u = this.get("SELECT * FROM users WHERE email = ?", email);
      if (!u || !(await checkPassword(String(b.password || ""), u.pass))) {
        this.loginFails.set(email, { n: (f && Date.now() - f.t < 10 * 60 * 1000 ? f.n : 0) + 1, t: Date.now() });
        fail(401, "Email o password non corretti");
      }
      this.loginFails.delete(email);
      return json({ token: this.newSession(u.id), user: { id: u.id, email: u.email, name: u.name } });
    }
    if (p[0] === "join" && p[1] && m === "GET") {
      const e = this.get("SELECT * FROM events WHERE code = ?", p[1].toUpperCase());
      if (!e) fail(404, "Codice evento non trovato");
      return json({ id: e.id, code: e.code, name: e.name, template: e.template });
    }

    // --- riservate ---
    const user = this.userFromToken(this.tokenOf(request, url));
    if (!user) fail(401, "Accesso richiesto");

    if (p[0] === "logout" && m === "POST") {
      this.run("DELETE FROM sessions WHERE token = ?", this.tokenOf(request, url)); return json({ ok: true });
    }
    if (p[0] === "me" && !p[1] && m === "GET") return json({ user });
    if (p[0] === "me" && p[1] === "password" && m === "POST") {
      const b = await body();
      const u = this.get("SELECT * FROM users WHERE id = ?", user.id);
      if (!(await checkPassword(String(b.current || ""), u.pass))) fail(400, "La password attuale non è corretta");
      if (String(b.password || "").length < 8) fail(400, "La nuova password deve avere almeno 8 caratteri");
      this.run("UPDATE users SET pass = ? WHERE id = ?", await hashPassword(String(b.password)), user.id);
      return json({ ok: true });
    }

    // utenti
    if (p[0] === "users") {
      if (!p[1] && m === "GET") return json({ users: this.all("SELECT id, email, name, created FROM users ORDER BY created") });
      if (!p[1] && m === "POST") { const r = await this.createUser(await body(), false); return json({ user: r.user }); }
      if (p[1] && m === "DELETE") {
        if (p[1] === user.id) fail(400, "Non puoi eliminare il tuo stesso utente");
        this.run("DELETE FROM sessions WHERE user_id = ?", p[1]);
        this.run("DELETE FROM users WHERE id = ?", p[1]);
        return json({ ok: true });
      }
    }

    // eventi
    if (p[0] === "events") {
      if (!p[1] && m === "GET") {
        const counts = new Map(this.all("SELECT event_id, COUNT(*) AS n FROM questions GROUP BY event_id").map(r => [r.event_id, r.n]));
        const events = this.all("SELECT e.*, u.name AS author FROM events e LEFT JOIN users u ON u.id = e.created_by ORDER BY e.updated DESC")
          .map(e => ({ ...this.pubEvent(e), author: e.author, questions: counts.get(e.id) || 0 }));
        return json({ events });
      }
      if (!p[1] && m === "POST") {
        const b = await body();
        const name = str(b.name, 150) || "Nuovo evento";
        const code = await this.pickCode(b.code);
        const id = rid(), now = Date.now();
        this.run("INSERT INTO events (id, code, name, template, created_by, created, updated) VALUES (?, ?, ?, 'taxi1729', ?, ?, ?)", id, code, name, user.id, now, now);
        return json({ event: this.pubEvent(this.getEvent(id)) });
      }
      const ev = this.getEvent(p[1]); if (!ev) fail(404, "Evento non trovato");
      if (!p[2] && m === "GET") {
        const questions = this.eventQuestions(ev.id).map(q => {
          const t = this.tally(q.id); let sim = 0; for (const v of t.byVoter.keys()) if (v.startsWith("sim-")) sim++;
          return { id: q.id, pos: q.pos, data: q.data, updated: q.updated, votes: t.byVoter.size, sim, simulating: this.sims.has(q.id) };
        });
        return json({ event: this.pubEvent(ev), questions });
      }
      if (!p[2] && m === "PATCH") {
        const b = await body();
        const name = b.name !== undefined ? (str(b.name, 150) || ev.name) : ev.name;
        const code = b.code !== undefined && String(b.code).toUpperCase() !== ev.code ? await this.pickCode(b.code) : ev.code;
        this.run("UPDATE events SET name = ?, code = ?, updated = ? WHERE id = ?", name, code, Date.now(), ev.id);
        this.evByCode = null;
        return json({ event: this.pubEvent(this.getEvent(ev.id)) });
      }
      if (!p[2] && m === "DELETE") {
        const qids = this.eventQuestions(ev.id).map(q => q.id);
        for (const id of qids) { this.run("DELETE FROM votes WHERE question_id = ?", id); this.dropGroups(id); this.tallies.delete(id); this.qcache.delete(id); }
        this.run("DELETE FROM questions WHERE event_id = ?", ev.id);
        this.live.delete(ev.id); this.saveLive(ev.id);
        this.run("DELETE FROM events WHERE id = ?", ev.id);
        this.evByCode = null;
        return json({ ok: true });
      }
      if (p[2] === "questions" && m === "POST") {
        const b = await body();
        const data = this.cleanQuestion(b.data, ev.id);
        const pos = (this.get("SELECT MAX(pos) AS m FROM questions WHERE event_id = ?", ev.id)?.m ?? 0) + 1;
        const id = rid(), now = Date.now();
        this.run("INSERT INTO questions (id, event_id, pos, data, created, updated) VALUES (?, ?, ?, ?, ?, ?)", id, ev.id, pos, JSON.stringify(data), now, now);
        this.touch(ev.id);
        return json({ question: { id, pos, data, updated: now, votes: 0 } });
      }
      if (p[2] === "reorder" && m === "POST") {
        const b = await body(); const ids = Array.isArray(b.ids) ? b.ids : [];
        ids.forEach((id, i) => { this.run("UPDATE questions SET pos = ? WHERE id = ? AND event_id = ?", i + 1, id, ev.id); this.qcache.delete(id); });
        this.touch(ev.id);
        return json({ ok: true });
      }
      if (p[2] === "votes" && m === "DELETE") {
        this.clearVotes(this.eventQuestions(ev.id).map(q => q.id));
        return json({ ok: true });
      }
      if (p[2] === "simvotes" && m === "DELETE") {
        for (const q of this.eventQuestions(ev.id)) {
          this.stopSim(q.id);
          this.run("DELETE FROM votes WHERE question_id = ? AND sim = 1", q.id); this.dropGroups(q.id, true);
          this.tallies.delete(q.id); this.markDirty(q.id);
        }
        return json({ ok: true });
      }
      if (p[2] === "export.csv" && m === "GET") return this.exportCsv(ev);
    }

    // domande
    if (p[0] === "questions" && p[1]) {
      const q = this.getQ(p[1]); if (!q) fail(404, "Domanda non trovata");
      if (!p[2] && m === "GET") return json({ question: { id: q.id, eventId: q.eventId, pos: q.pos, data: q.data, updated: q.updated } });
      if (!p[2] && m === "PATCH") {
        const b = await body();
        const data = this.cleanQuestion(b.data, q.eventId);
        if (data.segmentBy === q.id) data.segmentBy = null;
        const now = Date.now();
        this.run("UPDATE questions SET data = ?, updated = ? WHERE id = ?", JSON.stringify(data), now, q.id);
        this.qcache.delete(q.id); this.touch(q.eventId);
        const L = this.live.get(q.eventId);
        if (L && L.qid === q.id) this.pushLive(q.eventId);   // aggiorna subito i telefoni
        this.markDirty(q.id);
        return json({ question: { id: q.id, pos: q.pos, data, updated: now, votes: this.tally(q.id).byVoter.size } });
      }
      if (!p[2] && m === "DELETE") {
        this.stopSim(q.id);
        this.run("DELETE FROM votes WHERE question_id = ?", q.id); this.dropGroups(q.id);
        this.run("DELETE FROM questions WHERE id = ?", q.id);
        this.tallies.delete(q.id); this.qcache.delete(q.id); this.touch(q.eventId);
        return json({ ok: true });
      }
      if (p[2] === "duplicate" && m === "POST") {
        const id = rid(), now = Date.now();
        this.run("UPDATE questions SET pos = pos + 1 WHERE event_id = ? AND pos > ?", q.eventId, q.pos);
        for (const r of this.all("SELECT id FROM questions WHERE event_id = ?", q.eventId)) this.qcache.delete(r.id);
        const data = { ...q.data };
        this.run("INSERT INTO questions (id, event_id, pos, data, created, updated) VALUES (?, ?, ?, ?, ?, ?)", id, q.eventId, q.pos + 1, JSON.stringify(data), now, now);
        this.touch(q.eventId);
        return json({ question: { id, pos: q.pos + 1, data, updated: now, votes: 0 } });
      }
      if (p[2] === "results" && m === "GET") return json(this.results(q.id));
      if (p[2] === "votes" && m === "DELETE") { this.stopSim(q.id); this.clearVotes([q.id]); return json({ ok: true }); }
      if (p[2] === "simulate" && m === "POST") {
        const b = await body();
        if (b.stop) { this.stopSim(q.id); return json({ ok: true }); }
        const L = this.live.get(q.eventId);
        if (!L || L.qid !== q.id) fail(409, "Per simulare i voti la domanda deve essere in presentazione: vai sulla sua slide e riprova.");
        const count = Math.max(1, Math.min(2000, parseInt(b.count, 10) || 100));
        const seconds = Math.max(0, Math.min(300, parseInt(b.seconds, 10) || 0));
        this.startSim(q, count, seconds);
        return json({ ok: true, count, seconds });
      }
    }

    fail(404, "Richiesta non riconosciuta");
  }

  touch(eventId) { this.run("UPDATE events SET updated = ? WHERE id = ?", Date.now(), eventId); }

  async createUser(b, first) {
    const email = str(b.email, 200).toLowerCase(), name = str(b.name, 100), password = String(b.password || "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, "Email non valida");
    if (!name) fail(400, "Inserisci il nome");
    if (password.length < 8) fail(400, "La password deve avere almeno 8 caratteri");
    if (this.get("SELECT id FROM users WHERE email = ?", email)) fail(400, "Esiste già un utente con questa email");
    const id = rid();
    this.run("INSERT INTO users (id, email, name, pass, created) VALUES (?, ?, ?, ?, ?)", id, email, name, await hashPassword(password), Date.now());
    const user = { id, email, name };
    return first ? { token: this.newSession(id), user } : { user };
  }

  async pickCode(wanted) {
    if (wanted !== undefined && wanted !== null && String(wanted).trim() !== "") {
      const c = String(wanted).trim().toUpperCase();
      if (!/^[A-Z0-9]{3,10}$/.test(c)) fail(400, "Il codice evento deve avere da 3 a 10 lettere o cifre");
      if (this.get("SELECT id FROM events WHERE code = ?", c)) fail(400, "Codice evento già usato da un altro evento");
      return c;
    }
    for (let i = 0; i < 50; i++) {
      const c = String(10000 + Math.floor(Math.random() * 90000));
      if (!this.get("SELECT id FROM events WHERE code = ?", c)) return c;
    }
    fail(500, "Impossibile generare un codice evento");
  }

  exportCsv(ev) {
    const rows = [["Evento", "Domanda n.", "Domanda", "Risposta", "Voti", "Percentuale", "Partecipanti alla domanda"]];
    const crowd = [["Evento", "Domanda n.", "Domanda", "Stima", "Gruppo"]];
    const dec = (x) => String(Math.round(x * 100) / 100).replace(".", ",");
    for (const q of this.eventQuestions(ev.id)) {
      if (q.data.kind === "cw") {
        const base = q.data.splitBy ? this.getQ(q.data.splitBy) : null;
        const G = base && base.data.titleB ? this.groupsOf(base.id) : null;
        const gName = (voter) => { if (!G) return ""; const g = G.map.get(voter); return g === 0 ? base.data.groupA : g === 1 ? base.data.groupB : "Senza gruppo"; };
        const rowsV = this.all("SELECT voter, choices FROM votes WHERE question_id = ? AND sim = 0", q.id)
          .map(v => ({ x: JSON.parse(v.choices)[0], g: gName(v.voter) })).filter(r => typeof r.x === "number").sort((a, b) => a.x - b.x);
        const title = q.data.title || "(senza testo)";
        const block = (suffix, vals) => {
          const n = vals.length, st = statsOf(vals);
          const stat = (lab, x) => rows.push([ev.name, q.pos, title, lab + suffix, x === null || x === undefined ? "" : dec(x), "", n]);
          stat("Mediana", st && st.median); stat("Media", st && st.mean); stat("Minimo", st && st.min); stat("Massimo", st && st.max);
        };
        block("", rowsV.map(r => r.x));
        if (G) for (const name of [base.data.groupA, base.data.groupB]) block(` (${name})`, rowsV.filter(r => r.g === name).map(r => r.x));
        if (q.data.answer !== null && q.data.answer !== undefined) rows.push([ev.name, q.pos, title, "Risposta esatta", dec(q.data.answer), "", ""]);
        for (const r of rowsV) crowd.push([ev.name, q.pos, title, dec(r.x), r.g]);
        continue;
      }
      // conteggi dai soli voti veri (i simulati sono esclusi)
      const n = q.data.options.length, r = { counts: Array(n).fill(0), total: 0 };
      for (const v of this.all("SELECT choices FROM votes WHERE question_id = ? AND sim = 0", q.id)) {
        r.total++; for (const i of JSON.parse(v.choices)) if (i >= 0 && i < n) r.counts[i]++;
      }
      const pctS = (c, tot) => tot ? (Math.round(c / tot * 1000) / 10).toString().replace(".", ",") + "%" : "0%";
      q.data.options.forEach((o, i) => {
        rows.push([ev.name, q.pos, q.data.title || "(senza testo)", o || `Opzione ${i + 1}`, r.counts[i], pctS(r.counts[i], r.total), r.total]);
      });
      if (q.data.titleB) {
        // domanda con due versioni: risultati anche per gruppo, ciascuno con il testo che ha letto
        const G = this.groupsOf(q.id);
        const vv = this.all("SELECT voter, choices FROM votes WHERE question_id = ? AND sim = 0", q.id);
        [0, 1].forEach((g) => {
          const mine = vv.filter(v => G.map.get(v.voter) === g), c = Array(n).fill(0);
          for (const v of mine) for (const i of JSON.parse(v.choices)) if (i >= 0 && i < n) c[i]++;
          q.data.options.forEach((o, i) => rows.push([ev.name, q.pos, (g ? q.data.titleB : q.data.title) + ` [${g ? q.data.groupB : q.data.groupA}]`,
            o || `Opzione ${i + 1}`, c[i], pctS(c[i], mine.length), mine.length]));
        });
      }
    }
    const all = crowd.length > 1 ? rows.concat([[], ["Stime delle domande Crowd Wisdom (una riga per risposta)"]], crowd) : rows;
    const csv = "﻿" + all.map(r => r.map(csvCell).join(";")).join("\r\n");
    const fname = (ev.name || "evento").replace(/[^\w\-]+/g, "_").slice(0, 60);
    return new Response(csv, { headers: {
      "content-type": "text/csv; charset=utf-8", "cache-control": "no-store",
      "content-disposition": `attachment; filename="${fname}-risultati.csv"` } });
  }

  // ---------------------------------------------------------------------------------------------
  // Tempo reale (WebSocket, con "ibernazione": il Durable Object dorme quando nessuno parla)
  // ---------------------------------------------------------------------------------------------
  openSocket(request, url) {
    if (request.headers.get("upgrade") !== "websocket") return json({ error: "WebSocket richiesto" }, 426);
    const role = url.searchParams.get("role");
    let att, tag;
    if (role === "audience") {
      // evento cercato in memoria: con 1000 telefoni che si ricollegano insieme ogni lavoro risparmiato conta
      const code = String(url.searchParams.get("code") || "").toUpperCase();
      if (!this.evByCode) this.evByCode = new Map();
      let e = this.evByCode.get(code);
      if (!e) { e = this.get("SELECT * FROM events WHERE code = ?", code); if (e) this.evByCode.set(code, e); }
      if (!e) return json({ error: "Codice evento non trovato" }, 404);
      const voter = String(url.searchParams.get("voter") || "");
      if (!/^[a-z0-9]{6,40}$/i.test(voter)) return json({ error: "Identificativo non valido" }, 400);
      att = { role, eventId: e.id, voter }; tag = "a:" + e.id;
    } else if (role === "presenter") {
      const user = this.userFromToken(url.searchParams.get("token"));
      if (!user) return json({ error: "Accesso richiesto" }, 401);
      const e = this.getEvent(url.searchParams.get("event"));
      if (!e) return json({ error: "Evento non trovato" }, 404);
      att = { role, eventId: e.id, userId: user.id, userName: user.name }; tag = "p:" + e.id;
    } else return json({ error: "Ruolo non valido" }, 400);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [tag]);
    server.serializeAttachment(att);
    if (role === "audience") {
      const ev = this.evByCode.get(String(url.searchParams.get("code") || "").toUpperCase()) || this.getEvent(att.eventId);
      server.send(JSON.stringify({ t: "hello", event: { name: ev.name, code: ev.code } }));
      server.send(JSON.stringify(this.audienceState(att.eventId, att.voter)));
    } else {
      server.send(JSON.stringify(this.liveMsg(att.eventId)));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let msg; try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch (e) { return; }
    const att = ws.deserializeAttachment() || {};
    const reply = (o) => { try { ws.send(JSON.stringify(o)); } catch (e) {} };
    if (msg.t === "ping") return reply({ t: "pong" });

    if (att.role === "audience") {
      if (msg.t !== "vote") return;
      const L = this.live.get(att.eventId);
      if (!L || !L.qid || L.qid !== msg.q) return reply({ t: "error", msg: "Questa domanda non è più aperta." });
      const q = this.getQ(msg.q);
      if (q.data.kind === "cw") {
        const d = q.data, v = typeof msg.value === "number" ? msg.value : NaN;
        const bad = !Number.isFinite(v) || Math.abs(v) >= 1e12 || (!d.decimals && !Number.isInteger(v)) ||
          (d.min !== null && v < d.min) || (d.max !== null && v > d.max);
        if (bad) return reply({ t: "error", msg: d.error || crowdHint(d) });
        const t = this.tally(q.id);
        if (t.byVoter.has(att.voter)) return reply({ t: "voted", q: q.id, already: true });
        const val = [Math.round(v * 1e6) / 1e6];
        this.run("INSERT OR IGNORE INTO votes (question_id, voter, choices, created) VALUES (?, ?, ?, ?)", q.id, att.voter, JSON.stringify(val), Date.now());
        t.byVoter.set(att.voter, val);
        reply({ t: "voted", q: q.id });
        this.markDirty(q.id);
        return;
      }
      const n = q.data.options.length;
      let choices = Array.isArray(msg.choices) ? [...new Set(msg.choices.filter(i => Number.isInteger(i) && i >= 0 && i < n))] : [];
      if (!choices.length) return reply({ t: "error", msg: "Seleziona una risposta." });
      if (!q.data.multi) choices = choices.slice(0, 1);
      const t = this.tally(q.id);
      if (t.byVoter.has(att.voter)) return reply({ t: "voted", q: q.id, already: true });
      this.run("INSERT OR IGNORE INTO votes (question_id, voter, choices, created) VALUES (?, ?, ?, ?)", q.id, att.voter, JSON.stringify(choices), Date.now());
      t.byVoter.set(att.voter, choices);
      reply({ t: "voted", q: q.id });
      this.markDirty(q.id);
      return;
    }

    if (att.role === "presenter") {
      const ev = att.eventId, now = Date.now();
      let L = this.live.get(ev);
      if (msg.t === "watch") {
        if (msg.q) { const q = this.getQ(msg.q); if (q && q.eventId === ev) reply(this.results(q.id)); }
        return;
      }
      if (msg.t === "show") {
        const qid = msg.q || null;
        if (qid) { const q = this.getQ(qid); if (!q || q.eventId !== ev) return reply({ t: "error", msg: "Domanda non trovata in questo evento" }); }
        if (L && L.userId !== att.userId && now - L.lastBeat < LOCK_MS && !msg.force) {
          return reply({ t: "locked", by: L.userName, since: L.since });
        }
        const changed = !L || L.qid !== qid || L.userId !== att.userId;
        if (!L || L.userId !== att.userId || L.qid !== qid) {
          L = { qid, since: now, userId: att.userId, userName: att.userName, lastBeat: now, revealed: false };
          this.live.set(ev, L);
        }
        L.lastBeat = now; L.hideToken = null;
        L.k = typeof msg.k === "string" ? msg.k.slice(0, 60) : null;   // quale slide sta mostrando la domanda
        if (changed) { this.saveLive(ev); this.pushLive(ev); if (qid) reply(this.results(qid)); }
        if (qid) await this.ensureAlarm();
        return;
      }
      if (msg.t === "hide") {
        // Una slide che si chiude non deve spegnere la stessa domanda appena aperta da un'altra slide
        // (ad esempio passando dalla slide della domanda a quella con i risultati visibili).
        // Chiusura con un attimo di ritardo: se nel frattempo un'altra slide riapre la stessa domanda,
        // il pubblico non vede lampeggiare la schermata d'attesa.
        if (L && L.qid && L.qid === msg.q && L.userId === att.userId && (!msg.k || !L.k || msg.k === L.k)) {
          const token = L.hideToken = rid(6);
          setTimeout(() => {
            const cur = this.live.get(ev);
            if (!cur || cur.hideToken !== token || cur.qid !== msg.q) return;
            cur.qid = null; cur.revealed = false; cur.hideToken = null; cur.lastBeat = Date.now();
            this.saveLive(ev); this.pushLive(ev);
          }, HIDE_GRACE_MS);
        }
        return;
      }
      if (msg.t === "reveal") {
        if (L && L.qid === msg.q) { L.revealed = !!msg.on; this.saveLive(ev); this.sendAll("p:" + ev, this.liveMsg(ev)); }
        return;
      }
      if (msg.t === "stop") {   // fine presentazione: libera l'evento
        if (L && L.userId === att.userId) { this.live.delete(ev); this.saveLive(ev); this.pushLive(ev); }
        return;
      }
    }
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch (e) {}
  }
  async webSocketError(ws) {
    try { ws.close(1011, "errore"); } catch (e) {}
  }
}
