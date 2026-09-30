// Taxi1729 Poll — editor di una domanda a risposta multipla (usato da pannello e add-in)
(function () {
  var T = window.T = window.T || {};
  var uid = 0;

  // opts: { data, siblings: [{id, pos, title, multi}], onSave(data) -> Promise, onCancel(), saveLabel }
  T.QuestionEditor = function (container, opts) {
    var n = ++uid;
    var d = opts.data || {};
    var data = {
      title: d.title || "", options: (d.options && d.options.length >= 2) ? d.options.slice() : ["", ""],
      multi: !!d.multi, chart: d.chart || "bar", reveal: d.reveal || "live", segmentBy: d.segmentBy || ""
    };
    var siblings = (opts.siblings || []).filter(function (q) { return !q.multi; });
    var esc = T.esc;

    container.innerHTML =
      '<div class="ui qe">' +
      '<label class="lbl" for="qe-title-' + n + '">Domanda <span class="muted" style="font-weight:400">(facoltativa)</span></label>' +
      '<input type="text" id="qe-title-' + n + '" maxlength="300" placeholder="Es. Quanto conosci la comunicazione scientifica?">' +
      '<label class="lbl">Risposte</label>' +
      '<div class="qe-opts"></div>' +
      '<button type="button" class="btn ghost small qe-add" style="margin-top:8px">+ Aggiungi risposta</button>' +
      '<div class="qe-row">' +
      '  <div><label class="lbl">Il pubblico può scegliere</label><div class="seg">' +
      '    <label><input type="radio" name="qe-multi-' + n + '" value="0">Una risposta</label>' +
      '    <label><input type="radio" name="qe-multi-' + n + '" value="1">Più risposte</label></div></div>' +
      '  <div><label class="lbl">Grafico</label><div class="seg">' +
      '    <label><input type="radio" name="qe-chart-' + n + '" value="bar">Barre</label>' +
      '    <label><input type="radio" name="qe-chart-' + n + '" value="pie">Torta</label>' +
      '    <label><input type="radio" name="qe-chart-' + n + '" value="dots">Dot cluster</label></div></div>' +
      '  <div><label class="lbl">Risultati</label><div class="seg">' +
      '    <label><input type="radio" name="qe-rev-' + n + '" value="live">In tempo reale</label>' +
      '    <label><input type="radio" name="qe-rev-' + n + '" value="click">Su "Mostra le risposte"</label></div></div>' +
      '</div>' +
      '<label class="lbl" for="qe-seg-' + n + '">Segmenta le risposte</label>' +
      '<select id="qe-seg-' + n + '"></select>' +
      '<div class="hint">Colora il grafico in base a come le stesse persone hanno risposto a una domanda precedente (solo domande a risposta singola).</div>' +
      '<div class="err hidden"></div>' +
      '<div class="qe-actions"><button type="button" class="btn qe-save"></button>' +
      (opts.onCancel ? '<button type="button" class="btn ghost qe-cancel">Annulla</button>' : '') + '</div>' +
      '</div>';

    var $ = function (sel) { return container.querySelector(sel); };
    var title = $("#qe-title-" + n), list = $(".qe-opts"), seg = $("#qe-seg-" + n), err = $(".err"), save = $(".qe-save");
    title.value = data.title;
    save.textContent = opts.saveLabel || "Salva";

    seg.innerHTML = '<option value="">Nessuna segmentazione</option>' + siblings.map(function (q) {
      return '<option value="' + esc(q.id) + '">' + esc((q.pos ? q.pos + ". " : "") + (q.title || "(domanda senza testo)")) + '</option>';
    }).join("");
    seg.value = siblings.some(function (q) { return q.id === data.segmentBy; }) ? data.segmentBy : "";
    if (!siblings.length) { seg.disabled = true; seg.options[0].textContent = "Nessuna domanda precedente a risposta singola"; }

    function setRadio(name, v) { var r = container.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; }
    function getRadio(name) { var r = container.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : null; }
    setRadio("qe-multi-" + n, data.multi ? "1" : "0");
    setRadio("qe-chart-" + n, data.chart);
    setRadio("qe-rev-" + n, data.reveal);

    function drawOptions() {
      list.innerHTML = "";
      data.options.forEach(function (o, i) {
        var row = document.createElement("div"); row.className = "qe-opt";
        row.innerHTML = '<span class="n">' + (i + 1) + '.</span><input type="text" maxlength="140" placeholder="Opzione ' + (i + 1) + '"><button type="button" title="Rimuovi">×</button>';
        var inp = row.querySelector("input"); inp.value = o;
        inp.oninput = function () { data.options[i] = inp.value; };
        inp.onkeydown = function (e) {
          if (e.key === "Enter") { e.preventDefault(); if (i === data.options.length - 1 && data.options.length < 12) { data.options.push(""); drawOptions(); list.querySelectorAll("input")[i + 1].focus(); } else { var nx = list.querySelectorAll("input")[i + 1]; if (nx) nx.focus(); } }
        };
        var del = row.querySelector("button");
        del.disabled = data.options.length <= 2; del.style.visibility = data.options.length <= 2 ? "hidden" : "visible";
        del.onclick = function () { data.options.splice(i, 1); drawOptions(); };
        list.appendChild(row);
      });
      $(".qe-add").disabled = data.options.length >= 12;
    }
    drawOptions();
    $(".qe-add").onclick = function () { data.options.push(""); drawOptions(); var ins = list.querySelectorAll("input"); ins[ins.length - 1].focus(); };

    function collect() {
      return {
        title: title.value.trim(), options: data.options.map(function (o) { return o.trim(); }),
        multi: getRadio("qe-multi-" + n) === "1", chart: getRadio("qe-chart-" + n) || "bar",
        reveal: getRadio("qe-rev-" + n) || "live", segmentBy: seg.value || null
      };
    }
    save.onclick = function () {
      var out = collect();
      err.classList.add("hidden");
      if (out.options.length < 2) { err.textContent = "Servono almeno 2 risposte."; err.classList.remove("hidden"); return; }
      save.disabled = true;
      Promise.resolve(opts.onSave(out)).then(function () { save.disabled = false; }, function (e) {
        save.disabled = false; err.textContent = e && e.message ? e.message : "Salvataggio non riuscito"; err.classList.remove("hidden");
      });
    };
    if (opts.onCancel) $(".qe-cancel").onclick = opts.onCancel;
    setTimeout(function () { if (!container.contains(document.activeElement)) title.focus(); }, 30);
    return { getData: collect };
  };
})();
