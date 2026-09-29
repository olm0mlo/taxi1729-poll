// Configurazione condivisa del prototipo Taxi1729 Poll.
// Per il prototipo usiamo due "ripetitori" di messaggi pubblici e gratuiti (MQTT su WebSocket),
// così non serve creare nessun account. Nella versione definitiva verranno sostituiti da Supabase.
window.T1729 = {
  BROKERS: [
    "wss://broker.hivemq.com:8884/mqtt",
    "wss://test.mosquitto.org:8081/mqtt"
  ],
  TOPIC_ROOT: "taxi1729-poc-v1",
  HEARTBEAT_MS: 2000,     // ogni quanto la slide attiva conferma "sono in proiezione"
  STALE_MS: 7000,         // dopo quanto il telefono considera scaduta una slide senza conferme
  POLL_SLIDE_MS: 700      // ogni quanto l'add-in controlla quale slide è in proiezione
};

// Ci colleghiamo a TUTTI i ripetitori insieme: ogni messaggio viene inviato su tutti,
// e chi riceve scarta i doppioni. Così, se uno dei due è lento o irraggiungibile,
// PowerPoint e telefoni continuano comunque a parlarsi sull'altro.
window.T1729.connect = function (onStatus) {
  var clientId = "t1729-" + Math.random().toString(16).slice(2, 10);
  var clients = [], state = {}, handlers = [], seen = {}, seenQueue = [];

  function report() {
    var up = Object.keys(state).filter(function (k) { return state[k]; });
    if (up.length) onStatus && onStatus("connesso (" + up.join(", ") + ")", true);
    else onStatus && onStatus("connessione in corso…", false);
  }
  function deliver(topic, payload) {
    // Scarta i doppioni che arrivano da ripetitori diversi (entro pochi secondi).
    var key = topic + "|" + payload;
    if (seen[key] && Date.now() - seen[key] < 3000) return;
    seen[key] = Date.now(); seenQueue.push(key);
    if (seenQueue.length > 500) delete seen[seenQueue.shift()];
    handlers.forEach(function (fn) { fn(topic, { toString: function () { return payload; } }); });
  }

  window.T1729.BROKERS.forEach(function (url) {
    var name = url.split("/")[2].split(":")[0];
    state[name] = false;
    var c = mqtt.connect(url, { clientId: clientId + "-" + clients.length, reconnectPeriod: 2000, connectTimeout: 10000, clean: true });
    c.on("connect", function () { state[name] = true; report(); });
    c.on("close", function () { if (state[name]) { state[name] = false; report(); } });
    c.on("error", function (e) { onStatus && onStatus(name + ": " + (e && e.message)); });
    c.on("message", function (t, buf) { deliver(t, buf.toString()); });
    clients.push(c);
  });
  report();

  return {
    publish: function (t, m, o) { clients.forEach(function (c) { c.publish(t, m, o || {}); }); },
    subscribe: function (t) { clients.forEach(function (c) { c.subscribe(t); }); },
    onMessage: function (fn) { handlers.push(fn); }
  };
};

window.T1729.topic = function (eventCode) {
  var parts = [window.T1729.TOPIC_ROOT, String(eventCode || "").trim().toUpperCase()];
  for (var k = 1; k < arguments.length; k++) parts.push(arguments[k]);
  return parts.join("/");
};
