// Server di prova completo: pagine vere da app/public + API e tempo reale del server vero (harness.mjs).
// Con Playwright, i WebSocket delle pagine si collegano tramite `ctx.routeWebSocket(/\/ws\?/, bridge)`.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { makeHub } from './harness.mjs';
const ROOT = fileURLToPath(new URL('../app/public', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
export async function startServer(port) {
  const H = await makeHub();
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost:' + port);
    if (url.pathname.startsWith('/api/')) {
      const ch = []; for await (const c of req) ch.push(c);
      const r = await H.hub.fetch(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(ch) }));
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
    }
    let f = path.join(ROOT, url.pathname === '/' ? '/index.html' : url.pathname);
    if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(port, r));
  const bridge = async (ws) => {
    const c = await H.connect(new URL(ws.url()).searchParams.toString());
    if (c.status) { ws.close({ code: 1008, reason: 'no' }); return; }
    c.msgs.forEach(m => ws.send(JSON.stringify(m)));
    c.client.listeners.push(d => { try { ws.send(d); } catch (e) {} });
    c.client.onClose.push(() => { try { ws.close({ code: 1012, reason: 'riavvio' }); } catch (e) {} });   // il server ha chiuso (riavvio)
    // H.perdi(msg) → true: il messaggio della pagina "si perde per strada" (per simulare una rete che cade durante l'invio)
    ws.onMessage(m => { const o = JSON.parse(m); if (H.perdi && H.perdi(o, c)) return; if (!c.client.closed) c.send(o); });
    ws.onClose(() => { links.delete(c); c.close(); });                                                    // la pagina ha chiuso
    links.add(c); c.client.onClose.push(() => links.delete(c));
  };
  // Collegamenti aperti dalle pagine. H.dropLinks(filtro) simula una caduta di rete: chiude i collegamenti scelti
  // (per esempio solo quelli dei telefoni) da entrambe le parti.
  const links = H.links = new Set();
  H.dropLinks = (keep = () => true) => { let n = 0; for (const c of [...links]) if (keep(c)) { c.server.close(); n++; } return n; };
  return { srv, H, bridge };
}
