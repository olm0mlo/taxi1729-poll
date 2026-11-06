// Strumenti comuni alle prove: resoconto OK / ERRORE / NOTO, attese, chiamate al server di prova.
//   OK      la verifica è passata
//   ERRORE  qualcosa che funzionava non funziona più: la prova termina con errore
//   NOTO    problema già conosciuto (elencato in docs/PASSAGGIO-DI-CONSEGNE.md): viene segnalato ma non blocca.
//           Quando il problema verrà corretto la riga diventerà "RISOLTO": a quel punto va trasformata in verifica normale.
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function reporter(nome) {
  let errori = 0, noti = 0;
  console.log(`\n== ${nome} ==`);
  const R = {
    ok(name, cond, det) { if (!cond) errori++; console.log(cond ? 'OK     ' : 'ERRORE ', name, det !== undefined && det !== '' ? `(${det})` : ''); return cond; },
    // problema noto: "cond" è vera quando il problema c'è ancora
    noto(name, cond, det) { if (cond) noti++; console.log(cond ? 'NOTO   ' : 'RISOLTO', name, det !== undefined && det !== '' ? `(${det})` : ''); },
    sezione(t) { console.log(`-- ${t}`); },
    fine() {
      console.log(errori ? `\n${errori} verifiche NON passate.` : `\nTutte le verifiche passate${noti ? ` (${noti} problemi noti segnalati)` : ''}.`);
      process.exit(errori ? 1 : 0);
    },
    get errori() { return errori; }
  };
  return R;
}

// Chiamate alle API: con un server Hub diretto (harness) oppure con un indirizzo http (devserver)
export function apiClient(target) {
  return async function api(path, { method, body, token } = {}) {
    const init = { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json' } };
    if (token) init.headers.authorization = 'Bearer ' + token;
    if (body) init.body = JSON.stringify(body);
    const url = (typeof target === 'string' ? target : 'https://x.test') + '/api/' + path;
    const r = typeof target === 'string' ? await fetch(url, init) : await target.hub.fetch(new Request(url, init));
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: r.status, data, text };
  };
}

// Prepara un utente e un evento vuoto; restituisce token ed evento
export async function prepara(api, nomeEvento = 'Festival di prova') {
  const tok = (await api('setup', { body: { name: 'Olmo', email: 'olmo@prova.it', password: 'segretissima' } })).data.token;
  const ev = (await api('events', { body: { name: nomeEvento }, token: tok })).data.event;
  const domanda = async (data) => (await api(`events/${ev.id}/questions`, { body: { data }, token: tok })).data.question;
  return { tok, ev, domanda };
}

// Ultimo messaggio di un certo tipo ricevuto da un collegamento (e, se serve, per una certa domanda)
export const ultimo = (msgs, t, q) => [...msgs].reverse().find(m => m.t === t && (q === undefined || m.q === q || (m.q && m.q.id === q)));
