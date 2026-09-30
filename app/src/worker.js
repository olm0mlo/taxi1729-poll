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

// ---------------------------------------------------------------------------------------------
// Hub: dati + tempo reale
// ---------------------------------------------------------------------------------------------
export class Hub {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    this.migrate();
    this.qcache = new Map();      // domande lette di recente
    this.tallies = new Map();     // voti in memoria, per domanda: voter -> scelte
    this.live = new Map();        // eventId -> stato della presentazione
    for (const r of this.all("SELECT * FROM live")) {
      this.live.set(r.event_id, { qid: r.question_id || null, since: r.since, userId: r.user_id, userName: r.user_name,
        lastBeat: Date.now(), revealed: !!r.revealed });
    }
    this.dirty = new Set(); this.flushTimer = null;
    this.sims = new Map();        // simulazioni di voto in corso, per domanda
    this.loginFails = new Map();
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
      "CREATE TABLE IF NOT EXISTS live (event_id TEXT PRIMARY KEY, question_id TEXT, since INTEGER, user_id TEXT, user_name TEXT, revealed INTEGER NOT NULL DEFAULT 0)"
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
    const o = { kind: "mc" };
    o.title = str(d.title, 300);
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
      if (b && b.eventId === eventId && !b.data.multi) o.segmentBy = b.id;
    }
    return o;
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
    const n = q.data.options.length, t = this.tally(qid);
    const counts = Array(n).fill(0);
    for (const ch of t.byVoter.values()) for (const i of ch) if (i >= 0 && i < n) counts[i]++;
    let sim = 0; for (const v of t.byVoter.keys()) if (v.startsWith("sim-")) sim++;
    const res = { t: "results", q: qid, total: t.byVoter.size, counts, sim };
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
    const n = q.data.options.length;
    const base = q.data.segmentBy ? this.getQ(q.data.segmentBy) : null;
    const bn = base ? base.data.options.length : 0;
    const mkW = () => Array.from({ length: n }, () => 0.2 + Math.random() ** 1.5);   // alcune risposte più popolari di altre
    const weights = base ? Array.from({ length: bn }, mkW) : [mkW()];
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
        const ws = weights[seg];
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
  stopSim(qid) {
    const job = this.sims.get(qid);
    if (job) { clearTimeout(job.timer); this.sims.delete(qid); }
  }

  clearVotes(qids) {
    for (const id of qids) { this.run("DELETE FROM votes WHERE question_id = ?", id); this.tallies.delete(id); this.markDirty(id); }
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
    return {
      t: "state",
      q: q ? { id: q.id, title: q.data.title, options: q.data.options, multi: !!q.data.multi } : null,
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
      return json({ needsSetup: !this.get("SELECT id FROM users LIMIT 1") });
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
        return json({ event: this.pubEvent(this.getEvent(ev.id)) });
      }
      if (!p[2] && m === "DELETE") {
        const qids = this.eventQuestions(ev.id).map(q => q.id);
        for (const id of qids) { this.run("DELETE FROM votes WHERE question_id = ?", id); this.tallies.delete(id); this.qcache.delete(id); }
        this.run("DELETE FROM questions WHERE event_id = ?", ev.id);
        this.live.delete(ev.id); this.saveLive(ev.id);
        this.run("DELETE FROM events WHERE id = ?", ev.id);
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
          this.run("DELETE FROM votes WHERE question_id = ? AND sim = 1", q.id);
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
        this.run("DELETE FROM votes WHERE question_id = ?", q.id);
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
    for (const q of this.eventQuestions(ev.id)) {
      // conteggi dai soli voti veri (i simulati sono esclusi)
      const n = q.data.options.length, r = { counts: Array(n).fill(0), total: 0 };
      for (const v of this.all("SELECT choices FROM votes WHERE question_id = ? AND sim = 0", q.id)) {
        r.total++; for (const i of JSON.parse(v.choices)) if (i >= 0 && i < n) r.counts[i]++;
      }
      q.data.options.forEach((o, i) => {
        rows.push([ev.name, q.pos, q.data.title || "(senza testo)", o || `Opzione ${i + 1}`, r.counts[i],
          r.total ? (Math.round(r.counts[i] / r.total * 1000) / 10).toString().replace(".", ",") + "%" : "0%", r.total]);
      });
    }
    const csv = "﻿" + rows.map(r => r.map(csvCell).join(";")).join("\r\n");
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
      const e = this.get("SELECT * FROM events WHERE code = ?", String(url.searchParams.get("code") || "").toUpperCase());
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
      const ev = this.getEvent(att.eventId);
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
      const q = this.getQ(msg.q); const n = q.data.options.length;
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
