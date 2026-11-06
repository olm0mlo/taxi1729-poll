// Server di prova: il codice vero del Durable Object (app/src/worker.js) con un database SQLite di Node
// (node:sqlite, Node 22+) e WebSocket finti. Nessun dato reale: tutto in memoria.
// H.restart() simula un riavvio del server (come dopo una pubblicazione): i dati restano, il server riparte da zero
// in memoria e, con { drop: true }, tutti i collegamenti si chiudono come succede davvero.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const SRC = new URL('../app/src/worker.js', import.meta.url);
const TMP = new URL('./.tmp/', import.meta.url);
const RealResponse = globalThis.Response;
globalThis.Response = class extends RealResponse {
  constructor(body, init) { if (init && init.status === 101) { super(null, { status: 200 }); this._s = 101; this.webSocket = init.webSocket; } else super(body, init); }
  get status() { return this._s || super.status; }
};
class FakeWS {
  constructor() { this.listeners = []; this.onClose = []; this.peer = null; this.att = null; this.closed = false; this.queue = []; }
  send(d) { if (this.closed) throw new Error('closed'); this.peer._recv(d); }
  _recv(d) { if (!this.listeners.length) { this.queue.push(d); return; } this.listeners.forEach(f => f(d)); }
  serializeAttachment(a) { this.att = JSON.parse(JSON.stringify(a)); }
  deserializeAttachment() { return this.att; }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.peer && !this.peer.closed) { this.peer.closed = true; this.peer.onClose.forEach(f => f()); }
  }
}
export async function makeHub() {
  fs.mkdirSync(TMP, { recursive: true });
  fs.copyFileSync(SRC, new URL('./worker.mjs', TMP));
  const { Hub } = await import(new URL('./worker.mjs?' + Math.random(), TMP).href);
  const db = new DatabaseSync(':memory:'); let alarm = null; let sockets = [];
  const ctx = {
    storage: { sql: { exec(q, ...a) { const st = db.prepare(q); const rows = /^\s*(SELECT|PRAGMA|WITH)/i.test(q) ? st.all(...a).map(r => ({ ...r })) : (st.run(...a), []); return { toArray: () => rows }; } },
      async getAlarm() { return alarm; }, async setAlarm(t) { alarm = t; } },
    acceptWebSocket(ws, tags) { ws.tags = tags; sockets.push(ws); },
    getWebSockets(tag) { return sockets.filter(s => !s.closed && (!tag || s.tags.includes(tag))); }
  };
  globalThis.WebSocketPair = function () { const c = new FakeWS(), s = new FakeWS(); c.peer = s; s.peer = c; return { 0: c, 1: s }; };
  const H = { db, ctx, restarts: 0 };
  H.hub = new Hub(ctx, {});
  setInterval(async () => { if (alarm && alarm <= Date.now()) { alarm = null; await H.hub.alarm(); } }, 250).unref();
  H.connect = async (qs) => {
    const r = await H.hub.fetch(new Request('https://x.test/ws?' + qs, { headers: { upgrade: 'websocket' } }));
    if (r.status !== 101) return { status: r.status };
    const client = r.webSocket, server = client.peer, msgs = [];
    client.listeners.push(d => msgs.push(JSON.parse(d))); client.queue.forEach(d => msgs.push(JSON.parse(d)));
    return { client, server, msgs, send: (o) => H.hub.webSocketMessage(server, JSON.stringify(o)), close: () => client.close() };
  };
  // Riavvio: nuovo Hub sugli stessi dati. drop = true chiude anche tutti i collegamenti (pubblicazione di una modifica);
  // drop = false li lascia aperti (il server "si sveglia" dall'ibernazione).
  H.restart = ({ drop = true } = {}) => {
    if (drop) { for (const s of sockets) s.close(); sockets = []; }
    H.hub = new Hub(ctx, {}); H.restarts++;
    return H.hub;
  };
  return H;
}
