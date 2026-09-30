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
  T.live = function (params, onMessage, onStatus) {
    var ws = null, closed = false, retry = 0, pingTimer = null, queue = [];
    function url() {
      var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
      return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws?" + q;
    }
    function open() {
      if (closed) return;
      try { ws = new WebSocket(url()); } catch (e) { schedule(); return; }
      ws.onopen = function () {
        retry = 0; onStatus && onStatus(true);
        var q = queue; queue = []; q.forEach(function (m) { ws.send(m); });
        clearInterval(pingTimer);
        pingTimer = setInterval(function () { send({ t: "ping" }); }, 25000);
      };
      ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.t !== "pong") onMessage(m); };
      ws.onclose = function () { clearInterval(pingTimer); onStatus && onStatus(false); schedule(); };
      ws.onerror = function () { try { ws.close(); } catch (e) {} };
    }
    function schedule() {
      if (closed) return;
      retry++;
      setTimeout(open, Math.min(8000, 500 * Math.pow(1.6, retry)) + Math.random() * 600);
    }
    function send(obj) {
      var s = JSON.stringify(obj);
      if (ws && ws.readyState === 1) ws.send(s);
      else if (obj.t !== "ping" && obj.t !== "show") { queue.push(s); if (queue.length > 20) queue.shift(); }
    }
    open();
    return {
      send: send,
      close: function () { closed = true; clearInterval(pingTimer); try { ws && ws.close(); } catch (e) {} },
      isOpen: function () { return !!ws && ws.readyState === 1; }
    };
  };

  T.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  T.optLabel = function (o, i) { return (o && String(o).trim()) ? o : "Opzione " + (i + 1); };
  T.joinUrl = function (code) { return location.origin + "/?e=" + encodeURIComponent(code); };
})();
