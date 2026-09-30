// Taxi1729 Poll — accesso al server (richieste e collegamento in tempo reale)
(function () {
  var mem = {};
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) {
      if (v === undefined) return mem[k] || null;
      if (v === null) delete mem[k]; else mem[k] = v;
    }
    return null;
  }

  var T = window.T = window.T || {};
  T.store = store;
  T.token = function () { return store("t1729-token"); };
  T.setToken = function (t) { store("t1729-token", t || null); };
  T.base = location.origin;

  // Richiesta al server: restituisce una Promise con i dati, o un errore con .status e .message
  T.api = function (path, opts) {
    opts = opts || {};
    var headers = { "content-type": "application/json" };
    var tok = T.token(); if (tok) headers.authorization = "Bearer " + tok;
    return fetch("/api/" + path.replace(/^\//, ""), {
      method: opts.method || (opts.body ? "POST" : "GET"),
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || ("Errore " + r.status)); e.status = r.status; throw e; }
        return d;
      });
    }, function () { var e = new Error("Impossibile raggiungere il server. Controlla la connessione."); e.status = 0; throw e; });
  };

  // Collegamento in tempo reale che si riconnette da solo.
  // onMessage(msg), onStatus(connected:boolean)
  // - se il server non risponde a un "ping" entro 8 s la connessione è considerata morta (es. il telefono ha
  //   cambiato rete) e si riapre subito;
  // - quando la pagina torna visibile (telefono sbloccato) o la rete torna disponibile, si controlla subito.
  // opts.pingMs / opts.pongMs: ogni quanto controllare e quanto aspettare la risposta (la presentazione controlla
  // più spesso dei telefoni, così si accorge in pochi secondi se la rete del computer si è bloccata).
  T.live = function (params, onMessage, onStatus, opts) {
    opts = opts || {};
    var PING_MS = opts.pingMs || 25000, PONG_MS = opts.pongMs || 8000;
    var ws = null, closed = false, retry = 0, pingTimer = null, queue = [], retryTimer = null, pongTimer = null;
    function url() {
      var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
      return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws?" + q;
    }
    function open() {
      if (closed) return;
      clearTimeout(retryTimer); retryTimer = null;
      var me;
      try { me = ws = new WebSocket(url()); } catch (e) { schedule(); return; }
      // un tentativo che resta sospeso (né riuscito né fallito) viene abbandonato dopo 10 s
      var connT = setTimeout(function () { if (me === ws && me.readyState !== 1) drop(); }, 10000);
      me.onopen = function () {
        clearTimeout(connT);
        if (me !== ws) return;
        retry = 0; onStatus && onStatus(true);
        var q = queue; queue = []; q.forEach(function (m) { me.send(m); });
        clearInterval(pingTimer);
        pingTimer = setInterval(function () { probe(); }, PING_MS);
      };
      me.onmessage = function (e) {
        if (me !== ws) return;
        clearTimeout(pongTimer); pongTimer = null;
        var m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.t !== "pong") onMessage(m);
      };
      me.onclose = function () { if (me !== ws) return; drop(); };
      me.onerror = function () { try { me.close(); } catch (e) {} };
    }
    // connessione persa: si abbandona quella vecchia (anche se il sistema non l'ha ancora chiusa) e si riprova
    function drop(now) {
      clearInterval(pingTimer); clearTimeout(pongTimer); pongTimer = null;
      var old = ws; ws = null;
      if (old) { old.onopen = old.onmessage = old.onclose = old.onerror = null; try { old.close(); } catch (e) {} }
      onStatus && onStatus(false);
      if (now) { retry = 0; open(); } else schedule();
    }
    function probe(timeout) {
      if (!ws || ws.readyState !== 1 || pongTimer) return;
      try { ws.send(JSON.stringify({ t: "ping" })); } catch (e) { drop(true); return; }
      pongTimer = setTimeout(function () { pongTimer = null; drop(true); }, timeout || PONG_MS);
    }
    function schedule() {
      if (closed || retryTimer) return;
      retry++;
      // al primo tentativo l'attesa casuale è più ampia (0,8-3,3 s): se cadono tutti insieme (es. riavvio del server)
      // i rientri si distribuiscono invece di arrivare nello stesso istante
      retryTimer = setTimeout(open, Math.min(8000, 500 * Math.pow(1.6, retry)) + Math.random() * (retry === 1 ? 2500 : 600));
    }
    function wake() {
      if (closed) return;
      if (ws && ws.readyState === 1) probe(4000);
      else if (!ws || ws.readyState !== 0) { retry = 0; open(); }
    }
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") wake(); });
    function send(obj) {
      var s = JSON.stringify(obj);
      if (ws && ws.readyState === 1) ws.send(s);
      else if (obj.t !== "ping" && obj.t !== "show") { queue.push(s); if (queue.length > 20) queue.shift(); }
    }
    open();
    return {
      send: send,
      close: function () { closed = true; clearInterval(pingTimer); clearTimeout(pongTimer); clearTimeout(retryTimer); try { ws && ws.close(); } catch (e) {} },
      isOpen: function () { return !!ws && ws.readyState === 1; }
    };
  };

  T.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  T.optLabel = function (o, i) { return (o && String(o).trim()) ? o : "Opzione " + (i + 1); };
  // Numeri scritti all'italiana: "1.250" = milleduecentocinquanta, "1.250,5" o "12,5" con la virgola decimale.
  // Un solo punto seguito da 1-2 o 4+ cifre ("3.5") vale come virgola. Restituisce NaN se non è un numero.
  T.parseNum = function (txt) {
    var s = String(txt == null ? "" : txt).replace(/[\s\u00a0']/g, "");
    if (!s) return NaN;
    if (!/^[-+]?[\d.,]*\d[\d.,]*$/.test(s)) return NaN;
    if (s.indexOf(",") >= 0) {
      if ((s.match(/,/g) || []).length > 1) return NaN;
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    else if ((s.match(/\./g) || []).length > 1) return NaN;
    var x = Number(s);
    return isFinite(x) ? x : NaN;
  };
  T.fmtNum = function (x, maxDec) {
    if (x == null || !isFinite(x)) return "";
    return Number(x).toLocaleString("it-IT", { maximumFractionDigits: maxDec == null ? 2 : maxDec });
  };
  T.joinUrl = function (code) { return location.origin + "/?e=" + encodeURIComponent(code); };
})();
