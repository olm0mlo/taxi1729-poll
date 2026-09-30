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
    welcomeText.innerHTML = "Inquadra il QR code con la fotocamera del telefono.<br>Durante l'evento le domande compariranno lì, in automatico.";
    left.appendChild(welcomeText);
    var chart = h("div", "t-chart"); left.appendChild(chart);
    var qr = h("div", "t-qr"); right.appendChild(qr);
    var join = h("div", "t-join"); right.appendChild(join);
    var total = h("div", "t-total"); right.appendChild(total);
    var totalNum = h("b", null, "0"), totalLab = document.createTextNode(" risposte");
    total.appendChild(totalNum); total.appendChild(totalLab);
    var logo = h("img", "t-logo"); logo.src = "/assets/logo-negativo.png"; logo.alt = "Taxi1729"; canvas.appendChild(logo);
    var notice = h("div", "t-notice hidden"); canvas.appendChild(notice);

    var st = { mode: "question", code: null, eventName: "", q: null, number: 1, res: null, revealed: false, welcomeTitle: "", chartOverride: null, armed: false };
    var view = null;             // grafico attualmente disegnato
    var pendingIntro = 0;        // animazione di comparsa richiesta prima che arrivassero i risultati

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
      if (welcome) { title.className = "t-title"; title.textContent = st.welcomeTitle || "Partecipa dal tuo smartphone"; chart.innerHTML = ""; view = null; return; }
      var q = st.q || { title: "", options: [] };
      var tt = q.title || "";
      if (title.textContent !== tt) title.textContent = tt;
      title.className = "t-title" + (tt.length > 110 ? " s" : tt.length > 60 ? " m" : "") + (tt ? "" : " hidden");
      var res = currentRes();
      var tot = res ? res.total : 0;
      tween(totalNum, tot, fmtInt);
      totalLab.textContent = tot === 1 ? " risposta" : " risposte";
      drawChart(q, res);
    }

    // ---------------------------------------------------------------- scelta del grafico
    function drawChart(q, res) {
      var n = (q.options || []).length;
      if (!n) { chart.innerHTML = ""; view = null; return; }
      var hidden = q.reveal === "click" && !st.revealed;
      var seg = !hidden && res && res.seg ? res.seg : null;
      var ch = st.chartOverride || q.chart;
      var type = hidden ? "hidden" : (ch === "pie" ? "pie" : ch === "dots" ? "dots" : "bars");
      var key = [type, q.id, n, q.options.join("\u0001"), seg ? segItems(seg).map(function (x) { return x.si; }).join(",") + "|" + (seg.title || "") : "",
        chart.clientWidth, chart.clientHeight].join("|");
      if (!view || view.key !== key) {
        chart.innerHTML = "";
        view = (type === "hidden" ? hiddenView : type === "pie" ? pieView : type === "dots" ? dotsView : barsView)(q, seg);
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
        items.push({ label: isNone ? l : T.optLabel(l, si), color: isNone ? NONE_COLOR : PALETTE[si % PALETTE.length], si: si });
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
      if (seg) { var lg = legend(items, seg.title ? "Colori in base alle risposte a: " + seg.title : "Colori in base alla domanda precedente"); chart.appendChild(lg); top = lg.offsetHeight + 18; }
      var box = h("div", "t-bars"); box.style.top = top + "px"; chart.appendChild(box);
      var n = q.options.length, H = chart.clientHeight - top;
      // dimensioni in base allo spazio: poche risposte = barre più grandi, così il grafico riempie l'altezza
      var rowH = H / n, fs = Math.max(22, Math.min(58, rowH * 0.3)), trackH = Math.max(14, Math.min(46, fs * 0.75));
      var content = fs * 1.2 + 6 + trackH, gap = n > 1 ? Math.max(8, Math.min(fs * 1.3, (H - n * content) / (n - 1))) : 0;
      box.style.gap = Math.round(gap) + "px";
      var rows = q.options.map(function (o, i) {
        var b = h("div", "t-bar");
        var l = h("div", "l", T.optLabel(o, i)); l.style.fontSize = fs + "px";
        var v = h("div", "v"); v.style.fontSize = fs + "px";
        var p = h("span", null, "0%"), c = h("small", null, "0"); v.appendChild(p); v.appendChild(c);
        var tr = h("div", "tr"); tr.style.height = Math.round(trackH) + "px"; tr.style.marginTop = "6px";
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

    // ---------------------------------------------------------------- torta (nessuna animazione)
    function arcPath(cx, cy, r, a0, a1) {
      if (a1 - a0 >= Math.PI * 2 - 1e-6) return null;
      var x0 = cx + r * Math.sin(a0), y0 = cy - r * Math.cos(a0), x1 = cx + r * Math.sin(a1), y1 = cy - r * Math.cos(a1);
      return "M" + cx + " " + cy + " L" + x0 + " " + y0 + " A" + r + " " + r + " 0 " + (a1 - a0 > Math.PI ? 1 : 0) + " 1 " + x1 + " " + y1 + " Z";
    }
    function drawPie(svg, cx, cy, r, values, colors) {
      var sum = values.reduce(function (a, b) { return a + b; }, 0);
      if (!sum) { svg.appendChild(s("circle", { cx: cx, cy: cy, r: r - 6, fill: "none", stroke: "rgba(255,255,255,.12)", "stroke-width": 12 })); return; }
      var a = 0;
      values.forEach(function (v, i) {
        if (!v) return;
        var a1 = a + v / sum * Math.PI * 2, d = arcPath(cx, cy, r, a, a1);
        svg.appendChild(d ? s("path", { d: d, fill: colors[i], stroke: "#02151f", "stroke-width": 3 }) : s("circle", { cx: cx, cy: cy, r: r, fill: colors[i] }));
        a = a1;
      });
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
          var r = Math.min(H / 2 - 4, W * 0.3), cx = r + 8, cy = H / 2;
          drawPie(svg, cx, cy, r, counts, colors);
          var n = counts.length, fs = Math.max(22, Math.min(46, H / (n * 1.8))), lh = fs * 1.6;
          var y0 = cy - (n * lh) / 2 + lh / 2, x = cx + r + 70;
          counts.forEach(function (c, i) {
            var y = y0 + i * lh;
            svg.appendChild(s("circle", { cx: x, cy: y, r: fs * 0.4, fill: colors[i] }));
            var t = s("text", { x: x + fs * 0.9, y: y + fs * 0.35, "font-size": fs }); t.textContent = T.optLabel(q.options[i], i); svg.appendChild(t);
            var p = s("text", { x: W - 4, y: y + fs * 0.35, "font-size": fs, "text-anchor": "end", "font-weight": 800, style: "fill:#e8ea6e;font-family:Inter,sans-serif" });
            p.textContent = pct(c, tot) + "%"; svg.appendChild(p);
          });
        }
      };
    }
    // Torta segmentata: una torta per ogni gruppo della domanda base, tutta nel colore del gruppo
    // (lo stesso colore usato da barre e dot cluster). Gli spicchi sono sfumature dello stesso colore,
    // sempre nello stesso ordine (la più chiara è la prima risposta) e con nome e percentuale scritti sopra.
    function hexRgb(c) { var m = c.replace("#", ""); return [0, 2, 4].map(function (i) { return parseInt(m.substr(i, 2), 16); }); }
    function mix(a, b, t) { var x = hexRgb(a), y = hexRgb(b); return "rgb(" + x.map(function (v, i) { return Math.round(v + (y[i] - v) * t); }).join(",") + ")"; }
    function shade(color, i, n) {
      var t = n > 1 ? i / (n - 1) : 0, amt = 0.38 - 0.93 * t;       // da più chiaro a più scuro
      return amt >= 0 ? mix(color, "#ffffff", amt) : mix(color, "#02151f", -amt);
    }
    function isLight(rgb) { var v = rgb.match(/\d+/g).map(Number); return (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) / 255 > 0.55; }
    function pieSegDraw(q, seg) {
      var n = q.options.length;
      if (seg.title) { var cap = legend([], "Una torta per ogni risposta a: " + seg.title); cap.style.marginBottom = "6px"; chart.appendChild(cap); }
      var top = seg.title ? chart.lastChild.offsetHeight + 6 : 0, groups = segItems(seg);
      var W = chart.clientWidth, H = chart.clientHeight - top;
      var svg = s("svg", { "class": "t-svg", width: W, height: H, viewBox: "0 0 " + W + " " + H }); svg.style.top = top + "px"; chart.appendChild(svg);
      var k = Math.max(1, groups.length), cellW = W / k;
      var fs = Math.max(18, Math.min(30, cellW / 11, H / ((n + 1.6) * 1.45 + 6)));   // testo dell'elenco
      var lh = fs * 1.45, listH = lh * n + fs * 1.9;
      var r = Math.max(40, Math.min(cellW / 2 - 24, (H - listH - 18) / 2));
      var inner = Math.min(cellW - 36, Math.max(2 * r, fs * 14));
      groups.forEach(function (g, j) {
        var cx = cellW * j + cellW / 2, cy = r + 4, vals = seg.counts[g.si];
        var colors = q.options.map(function (o, i) { return shade(g.color, i, n); });
        var sum = vals.reduce(function (a, b) { return a + b; }, 0);
        drawPie(svg, cx, cy, r, vals, colors);
        // nome del gruppo sotto la torta
        var y = cy + r + fs * 1.45;
        var gl = s("text", { x: cx + fs * 0.45, y: y, "font-size": fs * 1.05, "text-anchor": "middle", "font-weight": 600 });
        gl.textContent = g.label; svg.appendChild(gl);
        var glW = g.label.length * fs * 1.05 * 0.52;
        svg.appendChild(s("circle", { cx: cx - glW / 2 - fs * 0.3, cy: y - fs * 0.36, r: fs * 0.36, fill: g.color }));
        // elenco delle risposte, sempre nello stesso ordine
        var x0 = cx - inner / 2, x1 = cx + inner / 2, maxCh = Math.max(6, Math.floor((inner - fs * 4.2) / (fs * 0.5)));
        q.options.forEach(function (o, i) {
          var yy = y + fs * 0.55 + lh * (i + 1);
          svg.appendChild(s("rect", { x: x0, y: yy - fs * 0.78, width: fs * 0.8, height: fs * 0.8, rx: fs * 0.18, fill: colors[i] }));
          var name = T.optLabel(o, i), t = s("text", { x: x0 + fs * 1.25, y: yy, "font-size": fs });
          t.textContent = name.length > maxCh ? name.slice(0, maxCh - 1) + "…" : name; svg.appendChild(t);
          var p = s("text", { x: x1, y: yy, "font-size": fs, "text-anchor": "end", "font-weight": 800, style: "fill:#e8ea6e;font-family:Inter,sans-serif" });
          p.textContent = (sum ? Math.round(vals[i] / sum * 100) : 0) + "%"; svg.appendChild(p);
        });
      });
    }

    // ---------------------------------------------------------------- dot cluster
    function dotsView(q, seg) {
      var top = 0, items = seg ? segItems(seg) : null;
      if (seg) { var lg = legend(items, seg.title ? "Colori in base alle risposte a: " + seg.title : null); chart.appendChild(lg); top = lg.offsetHeight + 12; }
      var W = chart.clientWidth, H = chart.clientHeight - top, n = q.options.length;
      var svg = s("svg", { "class": "t-svg", width: W, height: H, viewBox: "0 0 " + W + " " + H }); svg.style.top = top + "px"; chart.appendChild(svg);
      var colW = W / n, labH = 96, areaH = H - labH;
      var gDots = s("g", {}); svg.appendChild(gDots);
      var cols = q.options.map(function (o, i) {
        svg.appendChild(s("line", { x1: colW * i + 12, x2: colW * (i + 1) - 12, y1: areaH + 6, y2: areaH + 6, stroke: "rgba(255,255,255,.18)", "stroke-width": 2 }));
        var fs = Math.max(18, Math.min(30, colW / 8));
        var lab = s("text", { x: colW * i + colW / 2, y: areaH + fs + 16, "font-size": fs, "text-anchor": "middle" });
        var txt = T.optLabel(o, i), maxCh = Math.floor(colW / (fs * 0.52));
        lab.textContent = txt.length > maxCh ? txt.slice(0, maxCh - 1) + "…" : txt; svg.appendChild(lab);
        var pv = s("text", { x: colW * i + colW / 2, y: areaH + fs * 2 + 26, "font-size": fs, "text-anchor": "middle", "font-weight": 800, style: "fill:#e8ea6e;font-family:Inter,sans-serif" });
        pv.textContent = "0%"; svg.appendChild(pv);
        return { pv: pv, dots: [] };
      });
      var lay = null;
      function layout(maxN) {
        var r = 44, step, cn;
        for (; r > 2; r -= 0.5) { step = r * 2.35; cn = Math.max(1, Math.floor((colW - 16) / step)); if (Math.ceil(maxN / cn) * step <= areaH) break; }
        step = r * 2.35; cn = Math.max(1, Math.floor((colW - 16) / step));
        return { r: r, step: step, cn: cn };
      }
      function pos(i, k, count) {
        var perRow = Math.min(lay.cn, Math.max(1, count)), row = Math.floor(k / lay.cn), c = k % lay.cn;
        var x0 = colW * i + colW / 2 - (perRow - 1) * lay.step / 2;
        return { x: x0 + c * lay.step, y: areaH - lay.r - row * lay.step };
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
              else if (k < lay.cn) { var p2 = pos(i, k, c); d.setAttribute("cx", p2.x); }   // la prima fila si ricentra
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
      setRevealed: function (on) {
        if (st.revealed === !!on) return;
        st.revealed = !!on; render();
        if (on) api.playIntro();
      },
      // Animazione di comparsa dei risultati: da chiamare quando la slide (o la sua versione con i risultati) compare.
      playIntro: function () {
        if (st.mode !== "question" || !st.q) return;
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
