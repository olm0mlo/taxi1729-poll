// Office.js finto, per provare l'add-in nel browser senza PowerPoint.
// Pilotabile prima del caricamento con window.__settings (impostazioni della slide), window.__view ("edit" o "read"),
// window.__slideId (slide selezionata); window.__viewHandler({activeView}) simula il cambio di vista.
window.Office = (function () {
  var store = window.__settings || {};
  return {
    CoercionType: { SlideRange: "slideRange" }, AsyncResultStatus: { Succeeded: "succeeded" }, EventType: { ActiveViewChanged: "avc" },
    GoToType: { Index: "index" }, Index: { Next: "n", Previous: "p", First: "f", Last: "l" },
    onReady: function (cb) { setTimeout(function () { cb({ host: "PowerPoint" }); }, 50); },
    context: { diagnostics: { platform: "Stub", version: "1" }, requirements: { isSetSupported: function () { return false; } },
      document: {
        settings: { get: function (k) { return k in store ? store[k] : null; }, set: function (k, v) { store[k] = v; }, saveAsync: function (cb) { cb && cb({ status: "succeeded" }); } },
        getActiveViewAsync: function (cb) { cb({ value: window.__view || "edit" }); },
        addHandlerAsync: function (t, h) { window.__viewHandler = h; },
        getSelectedDataAsync: function (t, cb) {
          if (window.__fail) return cb({ status: "failed", error: { message: "errore simulato" } });   // window.__fail = true: rilevamento che fallisce
          cb({ status: "succeeded", value: { slides: [{ id: window.__slideId || "256#1", index: 1 }] } });
        },
        goToByIdAsync: function () {} } } };
})();
