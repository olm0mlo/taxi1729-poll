// Server di prova: il codice vero del Durable Object (app/src/worker.js) con un database SQLite di Node
// (node:sqlite, Node 22+) e WebSocket finti. Nessun dato reale: tutto in memoria.
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
  constructor() { this.listeners = []; this.peer = null; this.att = null; this.closed = false; this.queue = []; }
  send(d) { if (this.closed) throw new Error('closed'); this.peer._recv(d); }
  _recv(d) { if (!this.listeners.length) { this.queue.push(d); return; } this.listeners.forEach(f => f(d)); }
  serializeAttachment(a) { this.att = JSON.parse(JSON.stringify(a)); }
  deserializeAttachment() { return this.att; }
  close() { this.closed = true; }
}
export async function makeHub() {
  fs.mkdirSync(TMP, { recursive: true });
  fs.copyFileSync(SRC, new URL('./worker.mjs', TMP));
  const { Hub } = await import(new URL('./worker.mjs?' + Math.random(), TMP).href);
  const db = new DatabaseSync(':memory:'); let alarm = null; const sockets = [];
  const ctx = {
    storage: { sql: { exec(q, ...a) { const st = db.prepare(q); const rows = /^\s*(SELECT|PRAGMA|WITH)/i.test(q) ? st.all(...a).map(r => ({ ...r })) : (st.run(...a), []); return { toArray: () => rows }; } },
      async getAlarm() { return alarm; }, async setAlarm(t) { alarm = t; } },
    acceptWebSocket(ws, tags) { ws.tags = tags; sockets.push(ws); },
    getWebSockets(tag) { return sockets.filter(s => !s.closed && (!tag || s.tags.includes(tag))); }
  };
  globalThis.WebSocketPair = function () { const c = new FakeWS(), s = new FakeWS(); c.peer = s; s.peer = c; return { 0: c, 1: s }; };
  const hub = new Hub(ctx, {});
  setInterval(async () => { if (alarm && alarm <= Date.now()) { alarm = null; await hub.alarm(); } }, 250).unref();
  const connect = async (qs) => {
    const r = await hub.fetch(new Request('https://x.test/ws?' + qs, { headers: { upgrade: 'websocket' } }));
    if (r.status !== 101) return { status: r.status };
    const client = r.webSocket, server = client.peer, msgs = [];
    client.listeners.push(d => msgs.push(JSON.parse(d))); client.queue.forEach(d => msgs.push(JSON.parse(d)));
    return { client, server, msgs, send: (o) => hub.webSocketMessage(server, JSON.stringify(o)) };
  };
  return { hub, connect, db };
}
