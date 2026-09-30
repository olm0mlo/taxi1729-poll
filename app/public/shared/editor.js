// Taxi1729 Poll — editor di una domanda (usato da pannello e add-in)
// Tipi: scelta multipla ("mc") e Crowd Wisdom ("cw", il pubblico scrive una stima numerica).
(function () {
  var T = window.T = window.T || {};
  var uid = 0;

  // opts: { data, siblings: [{id, pos, title, multi, kind}], onSave(data) -> Promise, onCancel(), saveLabel }
  T.QuestionEditor = function (container, opts) {
    var n = ++uid;
    var d = opts.data || {};
    var isCw = d.kind === "cw";
    var data = {
      title: d.title || "", options: (d.options && d.options.length >= 2) ? d.options.slice() : ["", ""],
      multi: !!d.multi, chart: d.chart && d.chart !== "hist" ? d.chart : "bar", reveal: d.reveal || "live", segmentBy: d.segmentBy || ""
    };
    var siblings = (opts.siblings || []).filter(function (q) { return !q.multi && q.kind !== "cw"; });
    var esc = T.esc;
    var numTxt = function (x) { return x === null || x === undefined ? "" : T.fmtNum(x, 6); };

    container.innerHTML =
      '<div class="ui qe">' +
      '<label class="lbl">Tipo di domanda</label><div class="seg">' +
      '  <label><input type="radio" name="qe-kind-' + n + '" value="mc">Scelta multipla</label>' +
      '  <label><input type="radio" name="qe-kind-' + n + '" value="cw">Crowd Wisdom (stima numerica)</label></div>' +
      '<label class="lbl" for="qe-title-' + n + '">Domanda <span class="muted qe-optional" style="font-weight:400">(facoltativa)</span></label>' +
      '<input type="text" id="qe-title-' + n + '" maxlength="300" placeholder="Es. Quanto conosci la comunicazione scientifica?">' +

      // ---- scelta multipla
      '<div class="qe-mc">' +
      '<label class="lbl">Risposte</label>' +
      '<div class="qe-opts"></div>' +
      '<button type="button" class="btn ghost small qe-add" style="margin-top:8px">+ Aggiungi risposta</button>' +
      '<div class="qe-row">' +
      '  <div><label class="lbl">Il pubblico può scegliere</label><div class="seg">' +
      '    <label><input type="radio" name="qe-multi-' + n + '" value="0">Una risposta</label>' +
      '    <label><input type="radio" name="qe-multi-' + n + '" value="1">Più risposte</label></div></div>' +
      '  <div><label class="lbl">Grafico</label><div class="seg">' +
      '    <label><input type="radio" name="qe-chart-' + n + '" value="bar">Barre orizzontali</label>' +
      '    <label><input type="radio" name="qe-chart-' + n + '" value="vbar">Barre verticali</label>' +
      '    <label><input type="radio" name="qe-chart-' + n + '" value="pie">Torta</label>' +
      '    <label><input type="radio" name="qe-chart-' + n + '" value="dots">Dot cluster</label></div></div>' +
      '</div>' +
      '<label class="lbl" for="qe-seg-' + n + '">Segmenta le risposte</label>' +
      '<select id="qe-seg-' + n + '"></select>' +
      '<div class="hint">Colora il grafico in base a come le stesse persone hanno risposto a una domanda precedente (solo domande a risposta singola).</div>' +
      '</div>' +

      // ---- crowd wisdom
      '<div class="qe-cw">' +
      '<label class="check"><input type="checkbox" class="cw-showtitle"> Scrivi la domanda anche sulla slide</label>' +
      '<div class="hint">Di solito non serve: la domanda si vede sui telefoni e l\'istogramma ha più spazio.</div>' +
      '<div class="qe-row">' +
      '  <div><label class="lbl">Numeri accettati</label><div class="seg">' +
      '    <label><input type="radio" name="qe-dec-' + n + '" value="0">Solo interi</label>' +
      '    <label><input type="radio" name="qe-dec-' + n + '" value="1">Anche decimali</label></div></div>' +
      '  <div><label class="lbl">Minimo</label><input type="text" inputmode="decimal" class="cw-min" style="width:120px" placeholder="nessuno"></div>' +
      '  <div><label class="lbl">Massimo</label><input type="text" inputmode="decimal" class="cw-max" style="width:120px" placeholder="nessuno"></div>' +
      '  <div><label class="lbl">Unità di misura <span class="muted" style="font-weight:400">(facoltativa)</span></label><input type="text" class="cw-unit" maxlength="30" style="width:170px" placeholder="es. fagioli, €, km"></div>' +
      '</div>' +
      '<label class="lbl">Messaggio se il numero non è valido <span class="muted" style="font-weight:400">(facoltativo)</span></label>' +
      '<input type="text" class="cw-error" maxlength="140">' +
      '<div class="qe-row">' +
      '  <div><label class="lbl">Linea sul grafico</label><div class="seg">' +
      '    <label><input type="radio" name="qe-line-' + n + '" value="median">Mediana</label>' +
      '    <label><input type="radio" name="qe-line-' + n + '" value="mean">Media</label>' +
      '    <label><input type="radio" name="qe-line-' + n + '" value="none">Nessuna</label></div>' +
      '    <div class="hint" style="max-width:300px">La mediana risente meno delle stime esagerate.</div></div>' +
      '  <div><label class="lbl">Risposta esatta <span class="muted" style="font-weight:400">(facoltativa)</span></label><input type="text" inputmode="decimal" class="cw-answer" style="width:160px">' +
      '    <div class="hint" style="max-width:320px">Linea gialla sul grafico, visibile solo nelle slide in cui scegli di mostrarla (nell\'add-in o con il tasto A nel browser).</div></div>' +
      '</div>' +
      '<label class="lbl">Colonne dell\'istogramma</label><div class="seg">' +
      '  <label><input type="radio" name="qe-bins-' + n + '" value="auto">Automatiche</label>' +
      '  <label><input type="radio" name="qe-bins-' + n + '" value="manual">Personalizzate</label></div>' +
      '<div class="qe-row cw-binrow">' +
      '  <div><label class="lbl">Da</label><input type="text" inputmode="decimal" class="cw-bstart" style="width:120px"></div>' +
      '  <div><label class="lbl">A</label><input type="text" inputmode="decimal" class="cw-bend" style="width:120px"></div>' +
      '  <div><label class="lbl">Ogni colonna vale</label><input type="text" inputmode="decimal" class="cw-bsize" style="width:120px"></div>' +
      '</div>' +
      '<div class="hint cw-binhint"></div>' +
      '</div>' +

      '<div><label class="lbl">Risultati</label><div class="seg">' +
      '  <label><input type="radio" name="qe-rev-' + n + '" value="live">In tempo reale</label>' +
      '  <label><input type="radio" name="qe-rev-' + n + '" value="click">Su "Mostra le risposte"</label></div>' +
      '  <div class="hint" style="max-width:340px">In PowerPoint: duplica la slide e nella copia scegli "Risultati visibili". Nel browser: tasto R.</div></div>' +
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
    setRadio("qe-kind-" + n, isCw ? "cw" : "mc");
    setRadio("qe-multi-" + n, data.multi ? "1" : "0");
    setRadio("qe-chart-" + n, data.chart);
    setRadio("qe-rev-" + n, data.reveal);

    // valori Crowd Wisdom (una domanda nuova parte da "interi, minimo 0")
    var cwNew = !isCw;
    $(".cw-showtitle").checked = isCw ? !!d.showTitle : false;
    setRadio("qe-dec-" + n, isCw && d.decimals ? "1" : "0");
    $(".cw-min").value = cwNew ? "0" : numTxt(d.min);
    $(".cw-max").value = cwNew ? "" : numTxt(d.max);
    $(".cw-unit").value = isCw ? d.unit || "" : "";
    $(".cw-error").value = isCw ? d.error || "" : "";
    setRadio("qe-line-" + n, isCw && d.line ? d.line : "median");
    $(".cw-answer").value = isCw ? numTxt(d.answer) : "";
    var manualBins = isCw && d.binStart != null && d.binSize != null && d.binEnd != null;
    setRadio("qe-bins-" + n, manualBins ? "manual" : "auto");
    $(".cw-bstart").value = manualBins ? numTxt(d.binStart) : "";
    $(".cw-bend").value = manualBins ? numTxt(d.binEnd) : "";
    $(".cw-bsize").value = manualBins ? numTxt(d.binSize) : "";

    function numField(cls, label) {
      var v = $(cls).value.trim();
      if (!v) return null;
      var x = T.parseNum(v);
      if (isNaN(x)) throw new Error(label + ": scrivi un numero (es. 1.250 oppure 12,5)");
      return x;
    }
    function autoHint() {
      var dec = getRadio("qe-dec-" + n) === "1", mn = T.parseNum($(".cw-min").value), mx = T.parseNum($(".cw-max").value);
      var s = dec ? "Inserisci un numero" : "Inserisci un numero intero";
      if (!isNaN(mn) && !isNaN(mx)) s += " tra " + T.fmtNum(mn) + " e " + T.fmtNum(mx);
      else if (mn === 0 && !dec) s = "Inserisci un numero intero positivo o zero";
      else if (!isNaN(mn)) s += " non inferiore a " + T.fmtNum(mn);
      else if (!isNaN(mx)) s += " non superiore a " + T.fmtNum(mx);
      $(".cw-error").placeholder = "Se lo lasci vuoto: “" + s + "”";
    }
    function sync() {
      var cw = getRadio("qe-kind-" + n) === "cw";
      $(".qe-mc").classList.toggle("hidden", cw);
      $(".qe-cw").classList.toggle("hidden", !cw);
      $(".qe-optional").classList.toggle("hidden", cw);
      title.placeholder = cw ? "Es. Quanti fagioli ci sono nel barattolo?" : "Es. Quanto conosci la comunicazione scientifica?";
      var man = getRadio("qe-bins-" + n) === "manual";
      $(".cw-binrow").classList.toggle("hidden", !man);
      $(".cw-binhint").textContent = man
        ? "Le stime fuori da questo intervallo finiscono in una colonna a parte (“sotto…” / “oltre…”)."
        : "Le colonne si adattano alle risposte ricevute (circa 12); le stime più esagerate finiscono in una colonna a parte “oltre…”.";
      autoHint();
    }
    Array.prototype.forEach.call(container.querySelectorAll('input[type="radio"]'), function (r) { r.addEventListener("change", sync); });
    $(".cw-min").addEventListener("input", autoHint); $(".cw-max").addEventListener("input", autoHint);
    sync();

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
      var reveal = getRadio("qe-rev-" + n) || "live";
      if (getRadio("qe-kind-" + n) === "cw") {
        var man = getRadio("qe-bins-" + n) === "manual";
        var o = {
          kind: "cw", title: title.value.trim(), showTitle: $(".cw-showtitle").checked,
          decimals: getRadio("qe-dec-" + n) === "1", min: numField(".cw-min", "Minimo"), max: numField(".cw-max", "Massimo"),
          unit: $(".cw-unit").value.trim(), error: $(".cw-error").value.trim(),
          line: getRadio("qe-line-" + n) || "median", answer: numField(".cw-answer", "Risposta esatta"),
          binStart: man ? numField(".cw-bstart", "Colonne da") : null, binEnd: man ? numField(".cw-bend", "Colonne a") : null,
          binSize: man ? numField(".cw-bsize", "Larghezza delle colonne") : null, reveal: reveal
        };
        if (man && (o.binStart === null || o.binEnd === null || o.binSize === null)) throw new Error("Per le colonne personalizzate compila Da, A e Ogni colonna vale.");
        if (man && (o.binEnd - o.binStart) / o.binSize > 60) throw new Error("Troppe colonne: al massimo 60. Aumenta il valore di ogni colonna.");
        return o;
      }
      return {
        kind: "mc", title: title.value.trim(), options: data.options.map(function (o) { return o.trim(); }),
        multi: getRadio("qe-multi-" + n) === "1", chart: getRadio("qe-chart-" + n) || "bar",
        reveal: reveal, segmentBy: seg.value || null
      };
    }
    save.onclick = function () {
      var out;
      err.classList.add("hidden");
      try { out = collect(); } catch (e) { err.textContent = e.message; err.classList.remove("hidden"); return; }
      if (out.kind === "mc" && out.options.length < 2) { err.textContent = "Servono almeno 2 risposte."; err.classList.remove("hidden"); return; }
      if (out.kind === "cw" && !out.title) { err.textContent = "Scrivi la domanda: il pubblico la legge sul telefono."; err.classList.remove("hidden"); return; }
      save.disabled = true;
      Promise.resolve(opts.onSave(out)).then(function () { save.disabled = false; }, function (e) {
        save.disabled = false; err.textContent = e && e.message ? e.message : "Salvataggio non riuscito"; err.classList.remove("hidden");
      });
    };
    if (opts.onCancel) $(".qe-cancel").onclick = opts.onCancel;
    setTimeout(function () { if (!container.contains(document.activeElement)) title.focus(); }, 30);
    return { getData: function () { try { return collect(); } catch (e) { return null; } } };
  };
})();
