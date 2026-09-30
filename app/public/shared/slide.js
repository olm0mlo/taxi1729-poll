// Taxi1729 Poll — disegno della slide (usato da add-in, presentazione da browser e anteprime)
//
// I grafici restano "vivi": quando arrivano nuovi voti non vengono ridisegnati da zero ma aggiornati,
// così numeri e barre scorrono in modo fluido. Animazioni di comparsa:
//  - barre: partono da zero una dopo l'altra quando compaiono i risultati;
//  - dot cluster: i pallini compaiono uno dopo l'altro (anche quelli dei voti in arrivo);
//  - torta: nessuna animazione.
(function () {
  var T = window.T = window.T || {};
  var PALETTE = ["#e8ea6e", "#7fa6ad", "#f28f86", "#a9d18e", "#c7a3e0", "#f4b76a", "#8fd0e6", "#e0e0e0", "#d98fb5", "#9ea7f0", "#c9c26a", "#6fb59b"];
  var NONE_COLOR = "#56707a";
  T.PALETTE = PALETTE;
  var SVGNS = "http://www.w3.org/2000/svg";
  var BAR_EASE = "cubic-bezier(.2,.7,.2,1)";

  T.loadScript = function (src, cb) {
    var el = document.createElement("script"); el.src = src; el.async = true;
    el.onload = function () { cb && cb(true); }; el.onerror = function () { cb && cb(false); };
    document.head.appendChild(el);
  };

  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function s(tag, attrs) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function pct(n, tot) { return tot ? Math.round(n / tot * 100) : 0; }

  // Numero che "scorre" fino al nuovo valore invece di saltare (circa mezzo secondo).
  function tween(el, to, fmt, opts) {
    opts = opts || {};
    var from = opts.from != null ? opts.from : (el._v != null ? el._v : to);
    var dur = opts.dur || 500, delay = opts.delay || 0;
    if (el._raf) cancelAnimationFrame(el._raf);
    if (el._tm) clearTimeout(el._tm);
    el._v = to;
    if (from === to && !opts.force) { el.textContent = fmt(to); return; }
    el.textContent = fmt(from);
    function start() {
      var t0 = performance.now();
      (function step(now) {
        var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = fmt(Math.round(from + (to - from) * e));
        if (k < 1) el._raf = requestAnimationFrame(step); else el._raf = null;
      })(t0);
    }
    if (delay) el._tm = setTimeout(start, delay); else start();
  }
  var fmtPct = function (v) { return v + "%"; }, fmtInt = function (v) { return String(v); };

  T.Slide = function (root) {
    root.innerHTML = "";
    var stage = h("div", "t-stage"); root.appendChild(stage);
    var canvas = h("div", "t-canvas"); stage.appendChild(canvas);
    var left = h("div", "t-left"), right = h("div", "t-right");
    canvas.appendChild(left); canvas.appendChild(right);
    var kicker = h("div", "t-kicker"); var kNum = h("b", null, "01"), kTxt = h("span", null, "SONDAGGIO");
    kicker.appendChild(kNum); kicker.appendChild(kTxt); left.appendChild(kicker);
    var title = h("div", "t-title"); left.appendChild(title);
    var welcomeText = h("div", "t-welcome-text hidden");
    function drawWelcomeText() {
      // istruzioni della slide di benvenuto: indirizzo e codice per chi non riesce a inquadrare il QR
      welcomeText.innerHTML = "";
      welcomeText.appendChild(document.createTextNode("Inquadra il QR code"));
      welcomeText.appendChild(h("br"));
      welcomeText.appendChild(document.createTextNode("oppure vai su "));
      welcomeText.appendChild(h("b", null, location.host));
      welcomeText.appendChild(h("br"));
      welcomeText.appendChild(document.createTextNode("e inserisci il codice"));
      welcomeText.appendChild(h("div", "t-wcode", st.code || "—"));
    }
    left.appendChild(welcomeText);
    var chart = h("div", "t-chart"); left.appendChild(chart);
    var qr = h("div", "t-qr"); right.appendChild(qr);
    var codeLine = h("div", "t-code"); right.appendChild(codeLine);
    var join = h("div", "t-join"); right.appendChild(join);
    var total = h("div", "t-total"); right.appendChild(total);
    var totalNum = h("b", null, "0"), totalLab = document.createTextNode(" risposte");
    total.appendChild(totalNum); total.appendChild(totalLab);
    var logo = h("img", "t-logo"); logo.src = "/assets/logo-negativo.png"; logo.alt = "Taxi1729"; canvas.appendChild(logo);
    var notice = h("div", "t-notice hidden"); canvas.appendChild(notice);

    var st = { mode: "question", code: null, eventName: "", q: null, number: 1, res: null, revealed: false, welcomeTitle: "", chartOverride: null, armed: false, answer: false, qonly: false, split: "hist" };
    var view = null;             // grafico attualmente disegnato
    var pendingIntro = 0;        // animazione di comparsa richiesta prima che arrivassero i risultati

    drawWelcomeText();
    function fit() {
      var w = root.clientWidth || window.innerWidth, hgt = root.clientHeight || window.innerHeight;
      if (!w || !hgt) return;
      var k = Math.min(w / 1920, hgt / 1080);
      canvas.style.transform = "scale(" + k + ")";
      canvas.style.left = ((w - 1920 * k) / 2) + "px";
      canvas.style.top = ((hgt - 1080 * k) / 2) + "px";
    }
    window.addEventListener("resize", fit);
    setInterval(fit, 1000);

    function drawQr() {
      qr.innerHTML = "";
      if (!st.code) return;
      if (window.QRCode) new QRCode(qr, { text: T.joinUrl(st.code), width: 600, height: 600, colorDark: "#02151f", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
      join.innerHTML = "";
      join.appendChild(document.createTextNode("Inquadra il QR o vai su"));
      join.appendChild(h("br"));
      join.appendChild(document.createTextNode(location.host));
      join.appendChild(h("strong", null, st.code));
      codeLine.innerHTML = ""; codeLine.appendChild(document.createTextNode("codice ")); codeLine.appendChild(h("b", null, st.code));
      drawWelcomeText();
    }

    function currentRes() { return st.res && st.q && st.res.q === st.q.id ? st.res : null; }

    function render() {
      var welcome = st.mode === "welcome";
      stage.classList.toggle("welcome", welcome);
      welcomeText.classList.toggle("hidden", !welcome);
      chart.classList.toggle("hidden", welcome);
      total.classList.toggle("hidden", welcome);
      kNum.textContent = welcome ? "00" : String(st.number).padStart(2, "0");
      kTxt.textContent = welcome ? "BENVENUTI" : (st.eventName || "SONDAGGIO");
      if (welcome) { title.className = "t-title"; title.textContent = st.welcomeTitle || "Partecipa con il tuo smartphone"; chart.innerHTML = ""; view = null; return; }
      var q = st.q || { title: "", options: [] };
      var cw = q.kind === "cw", qonly = cw && st.qonly, noTitle = cw && !q.showTitle && !qonly;
      stage.classList.toggle("qonly", qonly);
      chart.classList.toggle("hidden", qonly);
      // domanda con due versioni: sullo schermo solo il titolo neutro, uguale per tutti
      var tt = noTitle ? "" : q.titleB ? (q.screenTitle || "Rispondi sul tuo telefono") : (q.title || "");
      if (title.textContent !== tt) title.textContent = tt;
      title.className = "t-title" + (tt.length > 110 ? " s" : tt.length > 60 ? " m" : "") + (tt ? "" : " hidden");
      var res = currentRes();
      var tot = res ? res.total : 0;
      tween(totalNum, tot, fmtInt);
      totalLab.textContent = tot === 1 ? " risposta" : " risposte";
      // il grafico parte sempre sotto il QR e il suo codice (in alto a destra)…
      chart.style.marginTop = "0px"; chart.style.marginRight = "0px";
      if (qonly) { chart.innerHTML = ""; view = null; return; }   // Crowd Wisdom "mostra domanda": solo il testo
      if (noTitle && q.splitBy && st.split === "numbers") chart.style.marginTop = "44px";   // numeri grandi: centrati nella slide
      else if (noTitle) {
        // …tranne il Crowd Wisdom senza domanda scritta: sale subito sotto il nome dell'evento, a fianco del QR
        chart.style.marginTop = "44px"; chart.style.marginRight = "250px";
      } else {
        var minTop = 380, t0 = chart.offsetTop;
        if (t0 && t0 < minTop) chart.style.marginTop = (minTop - t0) + "px";
      }
      drawChart(q, res);
    }

    // ---------------------------------------------------------------- scelta del grafico
    function drawChart(q, res) {
      var hidden = q.reveal === "click" && !st.revealed;
      if (q.kind === "cw") {
        var tp = hidden ? "hidden" : q.splitBy ? (st.split === "numbers" ? "bignum" : "hsplit") : "hist";
        var k2 = [tp, q.id, q.line, q.answer, q.decimals, q.unit, chart.clientWidth, chart.clientHeight].join("|");
        if (!view || view.key !== k2) {
          chart.innerHTML = "";
          view = (tp === "hidden" ? hiddenView : tp === "bignum" ? bigNumView : tp === "hsplit" ? histSplitView : histView)(q); view.key = k2;
        }
        view.update(q, res);
        if (st.armed && view.arm) view.arm();
        if (pendingIntro && res && Date.now() - pendingIntro < 2500) { pendingIntro = 0; view.intro && view.intro(q, res); }
        return;
      }
      var n = (q.options || []).length;
      if (!n) { chart.innerHTML = ""; view = null; return; }
      var seg = !hidden && res && res.seg ? res.seg : null;
      var ch = st.chartOverride || q.chart;
      var type = hidden ? "hidden" : (ch === "pie" ? "pie" : ch === "dots" ? "dots" : ch === "vbar" ? "vbars" : "bars");
      var key = [type, q.id, n, q.options.join("\u0001"), seg ? segItems(seg).map(function (x) { return x.si; }).join(",") + "|" + (seg.title || "") : "",
        chart.clientWidth, chart.clientHeight].join("|");
      if (!view || view.key !== key) {
        chart.innerHTML = "";
        view = (type === "hidden" ? hiddenView : type === "pie" ? pieView : type === "dots" ? dotsView : type === "vbars" ? vbarsView : barsView)(q, seg);
        view.key = key;
      }
      view.update(q, res);
      if (st.armed && view.arm) view.arm();
      if (pendingIntro && res && Date.now() - pendingIntro < 2500) { pendingIntro = 0; view.intro && view.intro(q, res); }
    }

    function legend(items, ttl) {
      var lg = h("div", "t-legend");
      if (ttl) lg.appendChild(h("div", "ttl", ttl));
      items.forEach(function (it) {
        var sp = h("span"); var dot = h("i"); dot.style.background = it.color; sp.appendChild(dot);
        sp.appendChild(document.createTextNode(it.label)); lg.appendChild(sp);
      });
      return lg;
    }
    function segItems(seg) {
      var items = [];
      seg.labels.forEach(function (l, si) {
        var used = seg.counts[si].some(function (x) { return x > 0; });
        var isNone = si === seg.labels.length - 1;
        if (isNone && !used) return;
        // domanda con due versioni: gli stessi colori dei gruppi usati negli istogrammi separati
        var color = isNone ? NONE_COLOR : seg.variant ? GROUP_COLORS[si][0] : PALETTE[si % PALETTE.length];
        items.push({ label: isNone ? l : T.optLabel(l, si), color: color, si: si });
      });
      return items;
    }
    function countsOf(q, res) { return res ? res.counts : q.options.map(function () { return 0; }); }

    // ---------------------------------------------------------------- risultati nascosti
    function hiddenView() {
      var hr = h("div", "t-hiddenres"), big = h("div", "big", "0"), lab = h("div", "lab");
      hr.appendChild(big); hr.appendChild(lab); chart.appendChild(hr);
      return {
        update: function (q, res) {
          var tot = res ? res.total : 0;
          tween(big, tot, fmtInt);
          lab.textContent = tot === 1 ? "persona ha risposto" : "persone hanno risposto";
        }
      };
    }

    // ---------------------------------------------------------------- barre
    function barsView(q, seg) {
      var top = 0, items = seg ? segItems(seg) : null;
      if (seg) { var lg = legend(items); chart.appendChild(lg); top = lg.offsetHeight + 18; }
      var box = h("div", "t-bars"); box.style.top = top + "px"; box.style.bottom = "0px"; chart.appendChild(box);
      var n = q.options.length, H = chart.clientHeight - top;
      // barre sottili: dimensioni fisse finché c'è spazio, più piccole solo con molte risposte
      var fs = 32, trackH = 15, gap = 34, pad = 0;
      var need = function () { return pad + n * (fs * 1.2 + 14 + trackH) + (n - 1) * gap; };
      while (need() > H && fs > 20) { fs -= 1; gap = Math.max(12, gap - 1.5); trackH = Math.max(10, trackH - 0.3); pad = Math.max(0, pad - 2); }
      box.style.gap = Math.round(gap) + "px"; box.style.paddingTop = pad + "px";
      var rows = q.options.map(function (o, i) {
        var b = h("div", "t-bar");
        var l = h("div", "l", T.optLabel(o, i)); l.style.fontSize = fs + "px";
        var v = h("div", "v"); v.style.fontSize = fs + "px";
        var p = h("span", null, "0%"), c = h("small", null, "0"); v.appendChild(p); v.appendChild(c);
        var tr = h("div", "tr"); tr.style.height = Math.round(trackH) + "px"; tr.style.marginTop = "14px";
        var fills = (items || [{ color: PALETTE[i % PALETTE.length], si: -1 }]).map(function (it) {
          var f = h("div", "f"); f.style.background = it.color; f.style.width = "0%"; f._si = it.si; tr.appendChild(f); return f;
        });
        b.appendChild(l); b.appendChild(v); b.appendChild(tr); box.appendChild(b);
        return { p: p, c: c, fills: fills };
      });
      function targets(q, res) {
        var counts = countsOf(q, res), max = Math.max.apply(null, counts.concat([1]));
        return rows.map(function (r, i) {
          return r.fills.map(function (f) {
            var v = f._si < 0 ? counts[i] : (res && res.seg ? res.seg.counts[f._si][i] : 0);
            return (v / max * 100) + "%";
          });
        });
      }
      return {
        update: function (q, res) {
          var counts = countsOf(q, res), tot = res ? res.total : 0, tg = targets(q, res);
          rows.forEach(function (r, i) {
            r.fills.forEach(function (f, k) { f.style.width = tg[i][k]; });
            tween(r.p, pct(counts[i], tot), fmtPct);
            tween(r.c, counts[i], fmtInt);
          });
        },
        // Grafico "in attesa": barre a zero, pronte per l'animazione alla prossima comparsa della slide.
        arm: function () {
          rows.forEach(function (r) {
            r.fills.forEach(function (f) { f.style.transition = "none"; f.style.width = "0%"; });
            tween(r.p, 0, fmtPct); tween(r.c, 0, fmtInt);
          });
          void box.offsetWidth;
          rows.forEach(function (r) { r.fills.forEach(function (f) { f.style.transition = ""; }); });
        },
        // Le barre ripartono da zero e crescono una dopo l'altra (tutto in meno di un secondo).
        intro: function (q, res) {
          var counts = countsOf(q, res), tot = res ? res.total : 0, tg = targets(q, res);
          var stagger = rows.length > 1 ? Math.min(90, 300 / (rows.length - 1)) : 0, dur = 600;
          rows.forEach(function (r) { r.fills.forEach(function (f) { f.style.transition = "none"; f.style.width = "0%"; }); });
          void box.offsetWidth;
          rows.forEach(function (r, i) {
            var d = Math.round(i * stagger);
            r.fills.forEach(function (f, k) { f.style.transition = "width " + dur + "ms " + BAR_EASE + " " + d + "ms"; f.style.width = tg[i][k]; });
            tween(r.p, pct(counts[i], tot), fmtPct, { from: 0, dur: dur, delay: d, force: true });
            tween(r.c, counts[i], fmtInt, { from: 0, dur: dur, delay: d, force: true });
          });
          clearTimeout(box._reset);
          box._reset = setTimeout(function () { rows.forEach(function (r) { r.fills.forEach(function (f) { f.style.transition = ""; }); }); }, dur + rows.length * stagger + 50);
        }
      };
    }

    // ---------------------------------------------------------------- barre verticali (colonne sottili)
    function vbarsView(q, seg) {
      var top = 0, items = seg ? segItems(seg) : null;
      if (seg) { var lg = legend(items); chart.appendChild(lg); top = lg.offsetHeight + 12; }
      var box = h("div", "t-vbars"); box.style.top = top + "px"; chart.appendChild(box);
      var n = q.options.length, W = chart.clientWidth, H = chart.clientHeight - top;
      var slot = Math.min(W / n, 300), colW = Math.min(slot * 0.28, 72);
      var pfs = Math.round(Math.max(24, Math.min(38, slot * 0.3))), lfs = Math.round(Math.max(20, Math.min(28, slot * 0.2)));
      var pctH = pfs + 26, labH = lfs * 2.6 + 20, chartH = Math.max(120, Math.min(H - pctH - labH, 440));
      var y0 = Math.max(0, (H - pctH - chartH - labH) / 2), baseY = y0 + pctH + chartH, x0 = (W - slot * n) / 2;
      var base = h("div", "base"); base.style.cssText = "left:" + x0 + "px;width:" + (slot * n) + "px;top:" + baseY + "px"; box.appendChild(base);
      var cols = q.options.map(function (o, i) {
        var cx = x0 + slot * i + slot / 2, x = cx - colW / 2, rad = colW / 2 + "px " + colW / 2 + "px 0 0";
        var f = h("div", "fil"); f.style.cssText = "left:" + x + "px;width:" + colW + "px;top:auto;bottom:" + (H - baseY) + "px;height:0px;border-radius:" + rad; box.appendChild(f);
        var parts = (items || [{ color: PALETTE[i % PALETTE.length], si: -1 }]).map(function (it) {
          var p = h("div"); p.style.background = it.color; p._si = it.si; if (it.si < 0) p.style.flex = "1 1 auto"; f.appendChild(p); return p;
        });
        var pc = h("div", "pct", "0%"); pc.style.cssText = "left:" + (cx - slot / 2) + "px;width:" + slot + "px;bottom:" + (H - baseY + 14) + "px;font-size:" + pfs + "px"; box.appendChild(pc);
        var lb = h("div", "lab", T.optLabel(o, i)); lb.style.cssText = "left:" + (cx - slot / 2 + 10) + "px;width:" + (slot - 20) + "px;top:" + (baseY + 18) + "px;font-size:" + lfs + "px"; box.appendChild(lb);
        return { f: f, parts: parts, pc: pc };
      });
      function heights(q, res) {
        var counts = countsOf(q, res), max = Math.max.apply(null, counts.concat([1]));
        return counts.map(function (c) { return c / max * chartH; });
      }
      function setParts(res, i, c) {
        cols[i].parts.forEach(function (p) {
          if (p._si < 0) return;
          var v = res && res.seg ? res.seg.counts[p._si][i] : 0;
          p.style.flex = "0 0 " + (c ? v / c * 100 : 0) + "%";
        });
      }
      function place(i, hgt) { cols[i].f.style.height = hgt + "px"; cols[i].pc.style.bottom = (H - baseY + 14 + hgt) + "px"; }
      return {
        update: function (q, res) {
          var counts = countsOf(q, res), tot = res ? res.total : 0, hs = heights(q, res);
          cols.forEach(function (c, i) { setParts(res, i, counts[i]); place(i, hs[i]); tween(c.pc, pct(counts[i], tot), fmtPct); });
        },
        arm: function () {
          cols.forEach(function (c, i) { c.f.style.transition = c.pc.style.transition = "none"; place(i, 0); tween(c.pc, 0, fmtPct); });
          void box.offsetWidth;
          cols.forEach(function (c) { c.f.style.transition = c.pc.style.transition = ""; });
        },
        // Le colonne crescono da zero una dopo l'altra (meno di un secondo in tutto).
        intro: function (q, res) {
          var counts = countsOf(q, res), tot = res ? res.total : 0, hs = heights(q, res);
          var stagger = cols.length > 1 ? Math.min(90, 300 / (cols.length - 1)) : 0, dur = 600;
          cols.forEach(function (c, i) { c.f.style.transition = c.pc.style.transition = "none"; setParts(res, i, counts[i]); place(i, 0); });
          void box.offsetWidth;
          cols.forEach(function (c, i) {
            var d = Math.round(i * stagger), tr = dur + "ms " + BAR_EASE + " " + d + "ms";
            c.f.style.transition = "height " + tr; c.pc.style.transition = "bottom " + tr;
            place(i, hs[i]);
            tween(c.pc, pct(counts[i], tot), fmtPct, { from: 0, dur: dur, delay: d, force: true });
          });
          clearTimeout(box._reset);
          box._reset = setTimeout(function () { cols.forEach(function (c) { c.f.style.transition = c.pc.style.transition = ""; }); }, dur + cols.length * stagger + 50);
        }
      };
    }


    // ---------------------------------------------------------------- istogramma (Crowd Wisdom)
    // Blocchi affiancati con un filo di spazio; le stime fuori scala stanno in colonne separate ("sotto…"/"oltre…").
    // Sopra il grafico le etichette della linea (mediana o media, tratteggiata) e della risposta esatta (gialla):
    // se si toccherebbero, si aprono "a bandiera" in direzioni opposte, e se non basta vanno su due righe.
    // o (facoltativo, per i due istogrammi dei gruppi): host, W, H, color, side, pick(res) -> {hist, stats} del gruppo,
    // shape(res) -> {u, o} colonne laterali da mostrare comunque (così i due grafici hanno lo stesso asse),
    // label(res) -> {text, color} nome del gruppo in alto a sinistra
    function histView(q, o) {
      o = o || {};
      var box = h("div", "t-hist"); (o.host || chart).appendChild(box);
      var W = o.W || chart.clientWidth, H = o.H || chart.clientHeight;
      var PILL_H = 50, topH = PILL_H + 26, axisH = 60, baseY = H - axisH, plotH = baseY - topH;
      var MAIN = o.color || "#7fa6ad", SIDE = o.side || "#46666d", EASE = BAR_EASE;
      var struct = "", bars = [], g = null, stat = null, ans = null, answerOn = false, lastRes = null, labEl = null, labW = 0;
      var sub = function (res) { return o.pick ? o.pick(res) : res; };
      var dec = function (x, d) { return T.fmtNum(x, d); };

      function mkLine(cls) {
        var ln = h("div", "ln " + cls), pill = h("div", "pill " + cls);
        box.appendChild(ln); box.appendChild(pill);
        return { ln: ln, pill: pill, x: null, shown: false };
      }
      function build(hist, shape) {
        box.innerHTML = ""; bars = [];
        labEl = null; labW = 0;
        if (o.label) { labEl = h("div", "glab"); box.appendChild(labEl); }
        var nb = hist.counts.length, hasU = hist.under > 0 || shape.u, hasO = hist.over > 0 || shape.o, sides = (hasU ? 1 : 0) + (hasO ? 1 : 0), sep = 34;
        var bw0 = (W - sides * sep) / (nb + sides), sideW = Math.max(80, Math.min(150, bw0));
        var bw = Math.min(190, (W - sides * (sep + sideW)) / nb);
        var totalW = nb * bw + sides * (sep + sideW), x0 = (W - totalW) / 2;
        var gap = Math.max(3, Math.min(8, bw * 0.1));
        var xm0 = x0 + (hasU ? sideW + sep : 0), xm1 = xm0 + nb * bw;
        g = { nb: nb, bw: bw, gap: gap, xm0: xm0, xm1: xm1, start: hist.start, size: hist.size, hasU: hasU, hasO: hasO };
        function addBar(left, width, color) {
          var b = h("div", "bar"); b.style.cssText = "left:" + left + "px;width:" + width + "px;bottom:" + (H - baseY) + "px;height:0px;background:" + color;
          box.appendChild(b); bars.push(b); return b;
        }
        function addBase(left, width) { var l = h("div", "base"); l.style.cssText = "left:" + left + "px;width:" + width + "px;top:" + baseY + "px"; box.appendChild(l); }
        function addLab(cx, text) {
          var t = h("div", "tick", text), w = 220, L = Math.max(0, Math.min(W - w, cx - w / 2));
          t.style.cssText = "left:" + L + "px;width:" + w + "px;top:" + (baseY + 14) + "px;text-align:" + (L === 0 && cx < w / 2 ? "left" : L === W - w && cx > W - w / 2 ? "right" : "center");
          box.appendChild(t);
        }
        if (hasU) { addBar(x0, sideW, SIDE)._k = "u"; addBase(x0, sideW); addLab(x0 + sideW / 2, "sotto " + dec(hist.start)); }
        for (var i = 0; i < nb; i++) addBar(xm0 + i * bw + gap / 2, bw - gap, MAIN)._k = i;
        addBase(xm0, nb * bw);
        var every = Math.max(1, Math.ceil(130 / bw));
        for (var e = 0; e <= nb; e += every) {
          if ((e === 0 && hasU) || (e === nb && hasO)) continue;     // c'è già "sotto…" / "oltre…"
          addLab(xm0 + e * bw, dec(hist.start + e * hist.size));
        }
        if (hasO) { var xo = xm1 + sep; addBar(xo, sideW, SIDE)._k = "o"; addBase(xo, sideW); addLab(xo + sideW / 2, "oltre " + dec(hist.start + nb * hist.size)); }
        stat = q.line !== "none" ? mkLine("stat") : null;
        ans = q.answer != null ? mkLine("ans") : null;
        if (ans) ans.pill.textContent = "Risposta esatta " + dec(q.answer);
      }
      function xOf(v) { return Math.max(g.xm0, Math.min(g.xm1, g.xm0 + (v - g.start) / g.size * g.bw)); }
      function heights(hist) {
        var vals = bars.map(function (b) { return b._k === "u" ? hist.under : b._k === "o" ? hist.over : hist.counts[b._k]; });
        var max = Math.max.apply(null, vals.concat([1]));
        return vals.map(function (v) { return v / max * plotH; });
      }
      // posizione delle etichette in alto, senza sovrapposizioni
      function placeLabels() {
        var items = [stat, ans].filter(function (it) { return it && it.shown && it.x != null; });
        items.forEach(function (it) { it.pill.classList.remove("fl", "fr"); it.w = it.pill.offsetWidth || 260; it.left = it.x - it.w / 2; it.row = 0; });
        var clamp = function (it) { it.left = Math.max(labW, Math.min(W - it.w, it.left)); };
        items.forEach(clamp);
        if (items.length === 2) {
          var a = items[0].x <= items[1].x ? items[0] : items[1], b = a === items[0] ? items[1] : items[0], M = 14;
          if (a.left + a.w + M > b.left) {
            // "a bandiera": l'etichetta di sinistra si apre verso sinistra, quella di destra verso destra,
            // ciascuna col lato piatto attaccato alla sua linea
            a.pill.classList.add("fl"); b.pill.classList.add("fr");
            a.w = a.pill.offsetWidth || a.w; b.w = b.pill.offsetWidth || b.w;
            a.left = a.x - a.w + 2; b.left = b.x - 2;
            if (a.left < labW || b.left + b.w > W || a.left + a.w + 4 > b.left) {       // non c'è spazio: due righe
              a.pill.classList.remove("fl"); b.pill.classList.remove("fr");
              a.w = a.pill.offsetWidth || a.w; b.w = b.pill.offsetWidth || b.w;
              a.left = a.x - a.w / 2; b.left = b.x - b.w / 2; clamp(a); clamp(b);
              (ans === a ? b : a).row = 1;
            }
          }
        }
        items.forEach(function (it) {
          var top = it.row ? PILL_H + 8 : 0;
          it.pill.style.left = it.left + "px"; it.pill.style.top = top + "px";
          it.ln.style.left = (it.x - 2) + "px"; it.ln.style.top = top + "px"; it.ln.style.height = Math.max(0, baseY - top) + "px";   // la linea parte dall'etichetta (asta della bandiera)
        });
      }
      function setLines(full) {
        var res = sub(full), ok = res && res.stats;
        if (labEl) {
          var L = o.label(full); labEl.innerHTML = "";
          var dot = h("i"); dot.style.background = L.color; labEl.appendChild(dot); labEl.appendChild(document.createTextNode(L.text));
          labW = labEl.offsetWidth + 28;
        }
        if (stat) {
          var v = ok ? (q.line === "mean" ? res.stats.mean : res.stats.median) : null;
          stat.shown = v != null; stat.x = v != null ? xOf(v) : null;
          if (v != null) stat.pill.textContent = (q.line === "mean" ? "Media " : "Mediana ") + dec(v, q.decimals ? 1 : (q.line === "mean" ? 0 : 1));
        }
        if (ans) { ans.shown = answerOn; ans.x = xOf(q.answer); }
        [stat, ans].forEach(function (it) {
          if (!it) return;
          it.ln.classList.toggle("off", !it.shown); it.pill.classList.toggle("off", !it.shown);
        });
        placeLabels();
      }
      function noTrans(fn) {
        var els = box.querySelectorAll(".bar,.ln,.pill");
        Array.prototype.forEach.call(els, function (e) { e.style.transition = "none"; });
        fn(); void box.offsetWidth;
        Array.prototype.forEach.call(els, function (e) { e.style.transition = ""; });
      }
      function ensure(full) {
        var res = sub(full), shape = o.shape ? o.shape(full) : { u: false, o: false };
        var hist = res && res.hist ? res.hist : { start: q.min != null ? q.min : 0, size: 10, counts: Array(10).fill(0), under: 0, over: 0 };
        var k = [hist.start, hist.size, hist.counts.length, hist.under > 0 || shape.u, hist.over > 0 || shape.o].join("|"), fresh = k !== struct;
        if (fresh) { struct = k; build(hist, shape); }
        return { hist: hist, fresh: fresh };
      }
      var api2 = {
        update: function (q2, res) {
          lastRes = res;
          var r = ensure(res), hs = heights(r.hist);
          if (r.fresh) noTrans(function () { bars.forEach(function (b, i) { b.style.height = hs[i] + "px"; }); setLines(res); });
          else { bars.forEach(function (b, i) { b.style.height = hs[i] + "px"; }); setLines(res); }
        },
        arm: function () {
          noTrans(function () {
            bars.forEach(function (b) { b.style.height = "0px"; });
            box.querySelectorAll(".ln,.pill").forEach(function (e) { e.classList.add("off"); });
          });
        },
        // colonne che crescono da sinistra a destra, poi compaiono le linee
        intro: function (q2, res) {
          lastRes = res;
          var r = ensure(res), hs = heights(r.hist), n = bars.length;
          var stagger = n > 1 ? Math.min(45, 450 / (n - 1)) : 0, dur = 600, end = dur + (n - 1) * stagger;
          noTrans(function () { bars.forEach(function (b) { b.style.height = "0px"; }); box.querySelectorAll(".ln,.pill").forEach(function (e) { e.classList.add("off"); }); });
          bars.forEach(function (b, i) { b.style.transition = "height " + dur + "ms " + EASE + " " + Math.round(i * stagger) + "ms"; b.style.height = hs[i] + "px"; });
          clearTimeout(box._t);
          box._t = setTimeout(function () { bars.forEach(function (b) { b.style.transition = ""; }); setLines(lastRes); }, end - 150);
        },
        setAnswer: function (on) { answerOn = !!on; if (bars.length) setLines(lastRes); }
      };
      answerOn = !!st.answer;
      return api2;
    }

    // ---------------------------------------------------------------- Crowd Wisdom separato per gruppi
    var GROUP_COLORS = [["#7fa6ad", "#46666d"], ["#f28f86", "#7d4d4a"]];
    function groupOf(res, i) { return res && res.groups ? res.groups[i] : null; }
    function groupLabel(res, i) {
      var gr = groupOf(res, i), n = gr ? gr.total : 0;
      return { text: (gr ? gr.label : i ? "Gruppo B" : "Gruppo A") + " · " + n + (n === 1 ? " risposta" : " risposte"), color: GROUP_COLORS[i][0] };
    }
    // A: due istogrammi uno sopra l'altro, stessa scala orizzontale, ciascuno con la sua linea
    function histSplitView(q) {
      var W = chart.clientWidth, H = chart.clientHeight, gap = 34, h2 = (H - gap) / 2;
      var shape = function (res) { return { u: !!(res && res.hist && res.hist.under), o: !!(res && res.hist && res.hist.over) }; };
      var views = [0, 1].map(function (i) {
        var host = h("div", "t-hsub"); host.style.cssText = "position:absolute;left:0;right:0;top:" + (i * (h2 + gap)) + "px;height:" + h2 + "px";
        chart.appendChild(host);
        return histView(q, { host: host, W: W, H: h2, color: GROUP_COLORS[i][0], side: GROUP_COLORS[i][1], shape: shape,
          pick: function (res) { return groupOf(res, i); }, label: function (res) { return groupLabel(res, i); } });
      });
      function all(fn) { return function () { var a = arguments; views.forEach(function (v) { v[fn].apply(null, a); }); }; }
      return { update: all("update"), arm: all("arm"), intro: all("intro"), setAnswer: all("setAnswer") };
    }
    // C: solo i due numeri, grandi, affiancati (per lo "svelamento")
    function bigNumView(q) {
      var box = h("div", "t-bignum"); chart.appendChild(box);
      var row = h("div", "row"); box.appendChild(row);
      var which = q.line === "mean" ? "mean" : "median";
      var fmt = function (v) { return v == null ? "–" : T.fmtNum(v, Math.abs(v) >= 100 || !q.decimals ? 0 : 1); };
      var cols = [0, 1].map(function (i) {
        var c = h("div", "col"), gn = h("div", "gname"), num = h("div", "num"), val = h("span", null, "–"), sb = h("div", "sub");
        var dot = h("i"); dot.style.background = GROUP_COLORS[i][0]; gn.appendChild(dot); var gt = document.createTextNode(""); gn.appendChild(gt);
        num.appendChild(val); if (q.unit) num.appendChild(h("small", null, q.unit));
        c.appendChild(gn); c.appendChild(num); c.appendChild(sb); row.appendChild(c);
        return { gt: gt, val: val, sb: sb };
      });
      var ans = h("div", "ans"); box.appendChild(ans);
      if (q.answer != null) ans.textContent = "Risposta esatta " + T.fmtNum(q.answer) + (q.unit ? " " + q.unit : "");
      var answerOn = !!st.answer;
      function draw(res, animate) {
        cols.forEach(function (c, i) {
          var gr = groupOf(res, i), v = gr && gr.stats ? gr.stats[which] : null, n = gr ? gr.total : 0;
          c.gt.textContent = gr ? gr.label : (i ? "Gruppo B" : "Gruppo A");
          c.sb.textContent = (which === "mean" ? "media" : "mediana") + " di " + n + (n === 1 ? " risposta" : " risposte");
          if (animate && v != null && Math.abs(v) >= 10) tween(c.val, Math.round(v), function (x) { return x === Math.round(v) ? fmt(v) : T.fmtNum(x, 0); }, { from: 0, dur: 900, delay: i * 150, force: true });
          else { c.val._v = null; c.val.textContent = fmt(v); }
        });
        ans.classList.toggle("off", !(answerOn && q.answer != null));
      }
      var last = null;
      return {
        update: function (q2, res) { last = res; draw(res, false); },
        arm: function () { cols.forEach(function (c) { c.val.textContent = "–"; }); ans.classList.add("off"); },
        intro: function (q2, res) { last = res; draw(res, true); },
        setAnswer: function (on) { answerOn = !!on; ans.classList.toggle("off", !(answerOn && q.answer != null)); }
      };
    }

    // ---------------------------------------------------------------- ciambella (nessuna animazione)
    function hexRgb(c) { var m = c.replace("#", ""); return [0, 2, 4].map(function (i) { return parseInt(m.substr(i, 2), 16); }); }
    function mix(a, b, t) { var x = hexRgb(a), y = hexRgb(b); return "rgb(" + x.map(function (v, i) { return Math.round(v + (y[i] - v) * t); }).join(",") + ")"; }
    function shade(color, i, n) {
      var t = n > 1 ? i / (n - 1) : 0, amt = 0.38 - 0.93 * t;       // da più chiaro a più scuro
      return amt >= 0 ? mix(color, "#ffffff", amt) : mix(color, "#02151f", -amt);
    }
    function ringPath(cx, cy, r0, r1, a0, a1) {
      if (a1 - a0 > Math.PI * 2 - 1e-4) a1 = a0 + Math.PI * 2 - 1e-4;
      var L = a1 - a0 > Math.PI ? 1 : 0, sn = Math.sin, cs = Math.cos;
      return "M" + (cx + r1 * sn(a0)) + " " + (cy - r1 * cs(a0)) + " A" + r1 + " " + r1 + " 0 " + L + " 1 " + (cx + r1 * sn(a1)) + " " + (cy - r1 * cs(a1)) +
        " L" + (cx + r0 * sn(a1)) + " " + (cy - r0 * cs(a1)) + " A" + r0 + " " + r0 + " 0 " + L + " 0 " + (cx + r0 * sn(a0)) + " " + (cy - r0 * cs(a0)) + " Z";
    }
    function drawDonut(svg, cx, cy, r, values, colors, center, cfs) {
      var sum = values.reduce(function (a, b) { return a + b; }, 0), a = 0, used = values.filter(function (v) { return v > 0; }).length;
      var gap = used > 1 ? 0.012 : 0;
      if (!sum) svg.appendChild(s("circle", { cx: cx, cy: cy, r: r * 0.82, fill: "none", stroke: "rgba(255,255,255,.1)", "stroke-width": r * 0.36 }));
      values.forEach(function (v, i) {
        if (!v) return;
        var a1 = a + v / sum * Math.PI * 2;
        svg.appendChild(s("path", { d: ringPath(cx, cy, r * 0.64, r, a + gap, a1 - gap), fill: colors[i] }));
        a = a1;
      });
      if (center != null) {
        var t = s("text", { x: cx, y: cy + cfs * 0.35, "font-size": cfs, "text-anchor": "middle", "font-weight": 800, style: "fill:#fff;font-family:Inter,sans-serif" });
        t.textContent = center; svg.appendChild(t);
      }
    }
    function pieView(q, seg) {
      var colors = q.options.map(function (o, i) { return PALETTE[i % PALETTE.length]; });
      return {
        update: function (q, res) {
          chart.innerHTML = "";
          var counts = countsOf(q, res), tot = res ? res.total : 0;
          if (res && res.seg) return pieSegDraw(q, res.seg);
          var W = chart.clientWidth, H = chart.clientHeight;
          var svg = s("svg", { "class": "t-svg", width: W, height: H, viewBox: "0 0 " + W + " " + H }); chart.appendChild(svg);
          // ciambella e legenda affiancate, blocco centrato nella slide
          var n = counts.length, fs = Math.max(24, Math.min(40, H / (n * 1.9))), lh = fs * 1.8;
          var r = Math.min(H / 2 - 20, 230), gapX = 90;
          var legW = Math.min(W - 2 * r - gapX, Math.max(fs * 8, fs * 0.55 * Math.max.apply(null, q.options.map(function (o, i) { return T.optLabel(o, i).length; })) + fs * 5));
          var x0 = (W - (2 * r + gapX + legW)) / 2, cy = H / 2;
          drawDonut(svg, x0 + r, cy, r, counts, colors, String(tot), Math.round(r * 0.34));
          var y0 = cy - (n - 1) * lh / 2, lx = x0 + 2 * r + gapX;
          counts.forEach(function (c, i) {
            var y = y0 + i * lh;
            svg.appendChild(s("circle", { cx: lx + fs * 0.35, cy: y - fs * 0.3, r: fs * 0.35, fill: colors[i] }));
            var t = s("text", { x: lx + fs * 1.2, y: y, "font-size": fs }); t.textContent = T.optLabel(q.options[i], i); svg.appendChild(t);
            var p = s("text", { x: lx + legW, y: y, "font-size": fs, "text-anchor": "end", "font-weight": 800, style: "fill:#fff;font-family:Inter,sans-serif" });
            p.textContent = pct(c, tot) + "%"; svg.appendChild(p);
          });
        }
      };
    }
    // Ciambelle segmentate "a tabella": una ciambella per gruppo della domanda base, nel colore del gruppo
    // (lo stesso di barre e dot cluster). I nomi delle risposte sono scritti una sola volta a sinistra e sotto
    // ogni ciambella c'è la colonna delle percentuali, allineata alle righe.
    function pieSegDraw(q, seg) {
      var n = q.options.length, groups = segItems(seg);
      var W = chart.clientWidth, H = chart.clientHeight;
      var svg = s("svg", { "class": "t-svg", width: W, height: H, viewBox: "0 0 " + W + " " + H }); chart.appendChild(svg);
      var labW = Math.min(460, W * 0.26), k = Math.max(1, groups.length), colW = (W - labW) / k;
      var lh = Math.max(34, Math.min(58, (H - 300) / n)), fs = Math.round(lh * 0.55), groupH = fs * 2.1;
      var r = Math.max(50, Math.min(colW / 2 - 40, 150, (H - n * lh - groupH - 30) / 2));
      var blockH = 2 * r + fs * 3.5 + (n - 1) * lh + lh * 0.4, offY = Math.max(0, (H - blockH) / 2);
      var cy = offY + r + 6, gy = cy + r + fs * 1.6, rowY0 = gy + fs * 1.9;
      var maxCh = Math.floor((labW - 20) / (fs * 0.5));
      q.options.forEach(function (o, i) {
        var y = rowY0 + i * lh, name = T.optLabel(o, i);
        var t = s("text", { x: 0, y: y, "font-size": fs }); t.textContent = name.length > maxCh ? name.slice(0, maxCh - 1) + "…" : name; svg.appendChild(t);
        svg.appendChild(s("line", { x1: 0, x2: W, y1: y + lh * 0.32, y2: y + lh * 0.32, stroke: "rgba(255,255,255,.07)", "stroke-width": 2 }));
      });
      groups.forEach(function (g, j) {
        var cx = labW + colW * j + colW / 2, vals = seg.counts[g.si], sum = vals.reduce(function (a, b) { return a + b; }, 0);
        var colors = q.options.map(function (o, i) { return shade(g.color, i, n); });
        drawDonut(svg, cx, cy, r, vals, colors, String(sum), Math.round(r * 0.3));
        var gl = s("text", { x: cx + fs * 0.45, y: gy, "font-size": Math.round(fs * 1.05), "text-anchor": "middle", "font-weight": 600 });
        gl.textContent = g.label; svg.appendChild(gl);
        var glW = gl.getComputedTextLength ? gl.getComputedTextLength() : g.label.length * fs * 0.55;
        svg.appendChild(s("circle", { cx: cx + fs * 0.45 - glW / 2 - fs * 0.6, cy: gy - fs * 0.36, r: fs * 0.36, fill: g.color }));
        vals.forEach(function (v, i) {
          var y = rowY0 + i * lh;
          svg.appendChild(s("rect", { x: cx - fs * 2.1, y: y - fs * 0.78, width: fs * 0.8, height: fs * 0.8, rx: fs * 0.2, fill: colors[i] }));
          var p = s("text", { x: cx + fs * 2.1, y: y, "font-size": fs, "text-anchor": "end", "font-weight": 800, style: "fill:#fff;font-family:Inter,sans-serif" });
          p.textContent = (sum ? Math.round(v / sum * 100) : 0) + "%"; svg.appendChild(p);
        });
      });
    }

    // ---------------------------------------------------------------- dot cluster
    function dotsView(q, seg) {
      var top = 0, items = seg ? segItems(seg) : null;
      if (seg) { var lg = legend(items); chart.appendChild(lg); top = lg.offsetHeight + 12; }
      var W = chart.clientWidth, H = chart.clientHeight - top, n = q.options.length;
      var svg = s("svg", { "class": "t-svg", width: W, height: H, viewBox: "0 0 " + W + " " + H }); svg.style.top = top + "px"; chart.appendChild(svg);
      // colonne ben separate, larghe uguali; pallini in righe regolari
      var colGap = n > 1 ? Math.min(90, W * 0.06) : 0, colW = (W - colGap * (n - 1)) / n, labH = 100, areaH = Math.min(H - labH, 460);
      var root = s("g", { transform: "translate(0," + Math.max(0, (H - labH - areaH) / 2) + ")" }); svg.appendChild(root);
      var colX = function (i) { return i * (colW + colGap); };
      var gDots = s("g", {}); root.appendChild(gDots);
      var cols = q.options.map(function (o, i) {
        root.appendChild(s("line", { x1: colX(i), x2: colX(i) + colW, y1: areaH + 8, y2: areaH + 8, stroke: "rgba(255,255,255,.18)", "stroke-width": 2 }));
        var fs = Math.max(18, Math.min(30, colW / 8));
        var lab = s("text", { x: colX(i) + colW / 2, y: areaH + fs + 18, "font-size": fs, "text-anchor": "middle" });
        var txt = T.optLabel(o, i), maxCh = Math.floor(colW / (fs * 0.52));
        lab.textContent = txt.length > maxCh ? txt.slice(0, maxCh - 1) + "…" : txt; root.appendChild(lab);
        var pv = s("text", { x: colX(i) + colW / 2, y: areaH + fs * 2 + 30, "font-size": fs, "text-anchor": "middle", "font-weight": 800, style: "fill:#fff;font-family:Inter,sans-serif" });
        pv.textContent = "0%"; root.appendChild(pv);
        return { pv: pv, dots: [] };
      });
      var lay = null;
      // Sempre 10 pallini per riga; se le colonne diventano troppo alte si allargano le righe
      // e, solo se serve, i pallini si rimpiccioliscono.
      function layout(maxN) {
        var cn = 10, maxStep = 30, step = Math.min(colW / cn, maxStep), maxCn = Math.max(10, Math.floor(colW / 11));
        while (Math.ceil(maxN / cn) * step > areaH && cn < maxCn) { cn += 2; step = Math.min(colW / cn, maxStep); }
        step = Math.min(step, areaH / Math.max(1, Math.ceil(maxN / cn)));
        return { r: step * 0.36, step: step, cn: cn };
      }
      function pos(i, k) {
        var row = Math.floor(k / lay.cn), c = k % lay.cn;
        var x0 = colX(i) + (colW - lay.cn * lay.step) / 2 + lay.step / 2;
        return { x: x0 + c * lay.step, y: areaH - lay.step / 2 - row * lay.step };
      }
      function colorsFor(q, res, i, count) {
        var out = [];
        if (res && res.seg) segItems(res.seg).forEach(function (it) { for (var k = 0; k < res.seg.counts[it.si][i]; k++) out.push(it.color); });
        while (out.length < count) out.push(PALETTE[i % PALETTE.length]);
        return out;
      }
      function makeDot(x, y, color, delay) {
        var d = s("circle", { cx: x, cy: y, r: lay.r, fill: color });
        if (delay != null) { d.setAttribute("class", "t-dot-in"); d.style.animationDelay = delay + "ms"; }
        gDots.appendChild(d); return d;
      }
      return {
        update: function (q, res) {
          var counts = countsOf(q, res), tot = res ? res.total : 0;
          var nl = layout(Math.max.apply(null, counts.concat([1])));
          var relayout = !lay || nl.r !== lay.r || nl.cn !== lay.cn;
          lay = nl;
          var added = 0; counts.forEach(function (c, i) { added += Math.max(0, c - cols[i].dots.length); });
          var gap = added ? Math.min(40, 450 / added) : 0, seq = 0;
          counts.forEach(function (c, i) {
            var col = cols[i], colors = colorsFor(q, res, i, c);
            while (col.dots.length > c) gDots.removeChild(col.dots.pop());
            col.dots.forEach(function (d, k) {
              if (relayout) { var p = pos(i, k, c); d.setAttribute("cx", p.x); d.setAttribute("cy", p.y); d.setAttribute("r", lay.r); }
              d.setAttribute("fill", colors[k]);
            });
            for (var k = col.dots.length; k < c; k++) { var p3 = pos(i, k, c); col.dots.push(makeDot(p3.x, p3.y, colors[k], Math.round(seq++ * gap))); }
            tween(col.pv, pct(c, tot), fmtPct);
          });
        },
        arm: function () {
          gDots.innerHTML = ""; cols.forEach(function (c) { c.dots = []; tween(c.pv, 0, fmtPct); });
        },
        // Tutti i pallini ricompaiono uno dopo l'altro, dal basso, riempiendo le colonne insieme.
        intro: function (q, res) {
          var counts = countsOf(q, res), tot = res ? res.total : 0, totalDots = counts.reduce(function (a, b) { return a + b; }, 0);
          gDots.innerHTML = ""; cols.forEach(function (c) { c.dots = []; });
          lay = layout(Math.max.apply(null, counts.concat([1])));
          var gap = totalDots ? Math.min(60, 1300 / totalDots) : 0, seq = 0;
          var colorsAll = counts.map(function (c, i) { return colorsFor(q, res, i, c); });
          var maxRows = Math.ceil(Math.max.apply(null, counts.concat([1])) / lay.cn);
          for (var row = 0; row < maxRows; row++) {
            counts.forEach(function (c, i) {
              for (var k = row * lay.cn; k < Math.min(c, (row + 1) * lay.cn); k++) {
                var p = pos(i, k, c); cols[i].dots[k] = makeDot(p.x, p.y, colorsAll[i][k], Math.round(seq++ * gap));
              }
            });
          }
          counts.forEach(function (c, i) { tween(cols[i].pv, pct(c, tot), fmtPct, { from: 0, dur: Math.max(500, seq * gap), force: true }); });
        }
      };
    }

    var api = {
      setEvent: function (ev) {
        if (!ev) return;
        if (ev.code !== st.code) { st.code = ev.code; drawQr(); }
        if ((ev.name || "") !== st.eventName) { st.eventName = ev.name || ""; render(); }
      },
      // Grafico diverso da quello della domanda solo per questa slide (null = come la domanda)
      setChartOverride: function (type) {
        type = type || null;
        if (type !== st.chartOverride) { st.chartOverride = type; view = null; chart.innerHTML = ""; render(); }
      },
      // Azzera il grafico mentre la slide non si vede: alla ricomparsa l'animazione parte da vuoto.
      arm: function () {
        if (st.mode !== "question" || !st.q) return;
        st.armed = true; if (view && view.arm) view.arm();
      },
      setWelcome: function (t) { st.mode = "welcome"; st.welcomeTitle = t; render(); },
      setQuestion: function (q, number) {
        if (!st.q || !q || st.q.id !== q.id) { view = null; chart.innerHTML = ""; totalNum._v = null; }
        st.mode = "question"; st.q = q; st.number = number || 1; render();
      },
      setResults: function (res) { st.res = res; if (st.mode === "question") render(); },
      // Crowd Wisdom: mostra o nasconde la linea della risposta esatta in questa slide
      setAnswerVisible: function (on) {
        on = !!on; if (st.answer === on) return;
        st.answer = on; if (view && view.setAnswer) view.setAnswer(on);
      },
      // Crowd Wisdom: slide con la sola domanda (true) o con i risultati (false)
      setQuestionOnly: function (on) {
        on = !!on; if (st.qonly === on) return;
        st.qonly = on; render();
        if (!on) api.playIntro();
      },
      // Crowd Wisdom separato per gruppi: "hist" (due istogrammi) o "numbers" (solo i numeri)
      setSplitView: function (mode) {
        mode = mode === "numbers" ? "numbers" : "hist";
        if (st.split === mode) return;
        st.split = mode; if (st.mode === "question") render();
      },
      setRevealed: function (on) {
        if (st.revealed === !!on) return;
        st.revealed = !!on; render();
        if (on) api.playIntro();
      },
      // Animazione di comparsa dei risultati: da chiamare quando la slide (o la sua versione con i risultati) compare.
      playIntro: function () {
        if (st.mode !== "question" || !st.q || (st.q.kind === "cw" && st.qonly)) return;
        if (st.q.reveal === "click" && !st.revealed) return;
        st.armed = false;
        if (view && view.intro && currentRes()) view.intro(st.q, currentRes());
        else if (view && !view.intro) render();
        else pendingIntro = Date.now();
      },
      setNotice: function (text) {
        notice.innerHTML = ""; notice.classList.toggle("hidden", !text);
        if (text) notice.appendChild(h("span", null, text));
      },
      redrawQr: drawQr, fit: fit, render: render
    };
    fit();
    return api;
  };
})();
