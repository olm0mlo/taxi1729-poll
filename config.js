// Configurazione condivisa del prototipo Taxi1729 Poll.
// Per il prototipo usiamo un "ripetitore" di messaggi pubblico e gratuito (MQTT su WebSocket),
// così non serve creare nessun account. Nella versione definitiva verrà sostituito da Supabase.
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

// Collegamento al ripetitore con tentativo sul server di riserva.
window.T1729.connect = function (onStatus) {
  var brokers = window.T1729.BROKERS, i = 0, client = null;
  var clientId = "t1729-" + Math.random().toString(16).slice(2, 10);
  function tryNext() {
    var url = brokers[i % brokers.length];
    onStatus && onStatus("connessione a " + url.split("/")[2] + "…");
    client = mqtt.connect(url, { clientId: clientId, reconnectPeriod: 2000, connectTimeout: 6000, clean: true });
    var ok = false;
    client.on("connect", function () { ok = true; onStatus && onStatus("connesso", true); });
    client.on("close", function () { onStatus && onStatus("disconnesso, riprovo…", false); });
    client.on("error", function (e) { onStatus && onStatus("errore: " + (e && e.message), false); });
    // Se il primo server non risponde entro 8 secondi passiamo al successivo.
    setTimeout(function () {
      if (!ok && brokers.length > 1) { client.end(true); i++; tryNext(); wrapper._swap(client); }
    }, 8000);
    return client;
  }
  // Oggetto stabile che inoltra le chiamate al client corrente.
  var handlers = [], subs = [];
  var wrapper = {
    publish: function (t, m, o) { if (client) client.publish(t, m, o || {}); },
    subscribe: function (t) { subs.push(t); if (client) client.subscribe(t); },
    onMessage: function (fn) { handlers.push(fn); if (client) client.on("message", fn); },
    _swap: function (c) { subs.forEach(function (t) { c.subscribe(t); }); handlers.forEach(function (fn) { c.on("message", fn); }); }
  };
  tryNext();
  return wrapper;
};

window.T1729.topic = function (eventCode) {
  var parts = [window.T1729.TOPIC_ROOT, String(eventCode || "").trim().toUpperCase()];
  for (var k = 1; k < arguments.length; k++) parts.push(arguments[k]);
  return parts.join("/");
};
