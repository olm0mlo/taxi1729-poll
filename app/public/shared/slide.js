// Taxi1729 Poll — disegno della slide (usato da add-in e presentazione da browser)
(function () {
  var T = window.T = window.T || {};
  var PALETTE = ["#e8ea6e", "#7fa6ad", "#f28f86", "#a9d18e", "#c7a3e0", "#f4b76a", "#8fd0e6", "#e0e0e0", "#d98fb5", "#9ea7f0", "#c9c26a", "#6fb59b"];
  var NONE_COLOR = "#56707a";
  T.PALETTE = PALETTE;
  var SVGNS = "http://www.w3.org/2000/svg";

  T.loadScript = function (src, cb) {
    var el = document.createElement("script"); el.src = src; el.async = true;
    el.onload = function () { cb && cb(true); }; el.onerror = function () { cb && cb(false); };
    document.head.appendChild(el);
  };

  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function s(tag, attrs) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function pct(n, tot) { return tot ? Math.round(n / tot * 100) : 0; }

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
    var logo = h("img", "t-logo"); logo.src = "/assets/logo-negativo.png"; logo.alt = "Taxi1729"; canvas.appendChild(logo);
    var notice = h("div", "t-notice hidden"); canvas.appendChild(notice);

    var st = { mode: "question", code: null, q: null, number: 1, res: null, revealed: false, welcomeTitle: "" };
    var prevWidths = {};

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

    function render() {
      var welcome = st.mode === "welcome";
      stage.classList.toggle("welcome", welcome);
      welcomeText.classList.toggle("hidden", !welcome);
      chart.classList.toggle("hidden", welcome);
      total.classList.toggle("hidden", welcome);
      kNum.textContent = welcome ? "00" : String(st.number).padStart(2, "0");
      kTxt.textContent = welcome ? "BENVENUTI" : "SONDAGGIO";
      if (welcome) { title.className = "t-title"; title.textContent = st.welcomeTitle || "Partecipa dal tuo smartphone"; return; }
      var q = st.q || { title: "", options: [] };
      var tt = q.title || "";
      title.textContent = tt;
      title.className = "t-title" + (tt.length > 110 ? " s" : tt.length > 60 ? " m" : "");
      title.classList.toggle("hidden", !tt);
      var res = st.res && st.q && st.res.q === st.q.id ? st.res : null;
      var tot = res ? res.total : 0;
      total.innerHTML = "<b>" + tot + "</b> " + (tot === 1 ? "risposta" : "risposte");
      drawChart(q, res);
    }

    function drawChart(q, res) {
      chart.innerHTML = "";
      var n = (q.options || []).length; if (!n) return;
      var counts = res ? res.counts : q.options.map(function () { return 0; });
      var tot = res ? res.total : 0;
      if (q.reveal === "click" && !st.revealed) {
        var hr = h("div", "t-hiddenres");
        hr.appendChild(h("div", "big", String(tot)));
        hr.appendChild(h("div", "lab", tot === 1 ? "persona ha risposto" : "persone hanno risposto"));
        chart.appendChild(hr);
        return;
      }
      var seg = res && res.seg ? res.seg : null;
      if (q.chart === "pie") return seg ? pieSeg(q, seg, tot) : pie(q, counts, tot);
      if (q.chart === "dots") return dots(q, counts, tot, seg);
      return bars(q, counts, tot, seg);
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

    function bars(q, counts, tot, seg) {
      var wrap = chart, top = 0;
      if (seg) { var lg = legend(segItems(seg), seg.title ? "Colori in base alle risposte a: " + seg.title : "Colori in base alla domanda precedente"); chart.appendChild(lg); top = lg.offsetHeight + 18; }
      var box = h("div", "t-bars"); box.style.top = top + "px"; wrap.appendChild(box);
      var n = counts.length, H = chart.clientHeight - top;
      var fs = Math.max(22, Math.min(40, H / (n * 2.7)));
      var max = Math.max.apply(null, counts.concat([1]));
      box.style.gap = Math.round(fs * 0.55) + "px";
      counts.forEach(function (c, i) {
        var b = h("div", "t-bar");
        var l = h("div", "l", T.optLabel(q.options[i], i)); l.style.fontSize = fs + "px";
        var v = h("div", "v", pct(c, tot) + "%"); v.style.fontSize = fs + "px";
        var small = h("small", null, String(c)); v.appendChild(small);
        var tr = h("div", "tr"); tr.style.height = Math.round(fs * 0.62) + "px"; tr.style.marginTop = "6px";
        if (seg) {
          segItems(seg).forEach(function (it) {
            var f = h("div", "f"); f.style.background = it.color;
            f.style.width = (seg.counts[it.si][i] / max * 100) + "%"; tr.appendChild(f);
          });
        } else {
          var f = h("div", "f"); f.style.background = PALETTE[i % PALETTE.length];
          var key = q.id + ":" + i, target = (c / max * 100) + "%";
          f.style.width = prevWidths[key] || "0%"; tr.appendChild(f);
          prevWidths[key] = target;
          requestAnimationFrame(function () { requestAnimationFrame(function () { f.style.width = target; }); });
        }
        b.appendChild(l); b.appendChild(v); b.appendChild(tr); box.appendChild(b);
      });
    }

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
    function pie(q, counts, tot) {
      var W = chart.clientWidth, H = chart.clientHeight;
      var svg = s("svg", { "class": "t-svg", width: W, height: H, viewBox: "0 0 " + W + " " + H }); chart.appendChild(svg);
      var r = Math.min(H / 2 - 8, W * 0.26), cx = r + 8, cy = H / 2;
      var colors = counts.map(function (c, i) { return PALETTE[i % PALETTE.length]; });
      drawPie(svg, cx, cy, r, counts, colors);
      var n = counts.length, fs = Math.max(22, Math.min(38, H / (n * 1.7))), lh = fs * 1.55;
      var y0 = cy - (n * lh) / 2 + lh / 2, x = cx + r + 70;
      counts.forEach(function (c, i) {
        var y = y0 + i * lh;
        svg.appendChild(s("circle", { cx: x, cy: y, r: fs * 0.4, fill: colors[i] }));
        var t = s("text", { x: x + fs * 0.9, y: y + fs * 0.35, "font-size": fs });
        t.textContent = T.optLabel(q.options[i], i);
        svg.appendChild(t);
        var p = s("text", { x: W - 4, y: y + fs * 0.35, "font-size": fs, "text-anchor": "end", "font-weight": 800, style: "fill:#e8ea6e;font-family:Inter,sans-serif" });
        p.textContent = pct(c, tot) + "%";
        svg.appendChild(p);
      });
    }
    function pieSeg(q, seg, tot) {
      var colors = q.options.map(function (o, i) { return PALETTE[i % PALETTE.length]; });
      var lg = legend(q.options.map(function (o, i) { return { label: T.optLabel(o, i), color: colors[i] }; }), seg.title ? "Una torta per ogni risposta a: " + seg.title : null); chart.appendChild(lg);
      var top = lg.offsetHeight + 12;
      var groups = segItems(seg);
      var W = chart.clientWidth, H = chart.clientHeight - top;
      var svg = s("svg", { "class": "t-svg", width: W, height: H, viewBox: "0 0 " + W + " " + H }); svg.style.top = top + "px"; chart.appendChild(svg);
      var k = Math.max(1, groups.length), labH = 90;
      var cellW = W / k, r = Math.max(30, Math.min(cellW / 2 - 18, (H - labH) / 2 - 6));
      groups.forEach(function (g, j) {
        var cx = cellW * j + cellW / 2, cy = r + 6;
        drawPie(svg, cx, cy, r, seg.counts[g.si], colors);
        var fs = Math.max(20, Math.min(30, cellW / 9));
        var t = s("text", { x: cx, y: cy + r + fs + 14, "font-size": fs, "text-anchor": "middle" });
        t.textContent = g.label; svg.appendChild(t);
        var dot = s("circle", { cx: cx, cy: cy + r + fs * 2 + 22, r: fs * 0.35, fill: g.color }); svg.appendChild(dot);
      });
    }
    function dots(q, counts, tot, seg) {
      var top = 0;
      if (seg) { var lg = legend(segItems(seg), seg.title ? "Colori in base alle risposte a: " + seg.title : null); chart.appendChild(lg); top = lg.offsetHeight + 12; }
      var W = chart.clientWidth, H = chart.clientHeight - top, n = counts.length;
      var svg = s("svg", { "class": "t-svg", width: W, height: H, viewBox: "0 0 " + W + " " + H }); svg.style.top = top + "px"; chart.appendChild(svg);
      var colW = W / n, labH = 96, areaH = H - labH, maxN = Math.max.apply(null, counts.concat([1]));
      var r = 44, step, cols;
      for (; r > 2; r -= 0.5) {
        step = r * 2.35; cols = Math.max(1, Math.floor((colW - 16) / step));
        if (Math.ceil(maxN / cols) * step <= areaH) break;
      }
      step = r * 2.35; cols = Math.max(1, Math.floor((colW - 16) / step));
      counts.forEach(function (c, i) {
        var colors = [];
        if (seg) segItems(seg).forEach(function (it) { for (var k = 0; k < seg.counts[it.si][i]; k++) colors.push(it.color); });
        else for (var k = 0; k < c; k++) colors.push(PALETTE[i % PALETTE.length]);
        var perRow = Math.min(cols, Math.max(1, colors.length));
        var x0 = colW * i + colW / 2 - (perRow - 1) * step / 2;
        colors.forEach(function (col, k) {
          var row = Math.floor(k / cols), cix = k % cols;
          svg.appendChild(s("circle", { cx: x0 + cix * step, cy: areaH - r - row * step, r: r, fill: col }));
        });
        svg.appendChild(s("line", { x1: colW * i + 12, x2: colW * (i + 1) - 12, y1: areaH + 6, y2: areaH + 6, stroke: "rgba(255,255,255,.18)", "stroke-width": 2 }));
        var fs = Math.max(18, Math.min(30, colW / 8));
        var lab = s("text", { x: colW * i + colW / 2, y: areaH + fs + 16, "font-size": fs, "text-anchor": "middle" });
        var txt = T.optLabel(q.options[i], i), maxCh = Math.floor(colW / (fs * 0.52));
        lab.textContent = txt.length > maxCh ? txt.slice(0, maxCh - 1) + "…" : txt; svg.appendChild(lab);
        var pv = s("text", { x: colW * i + colW / 2, y: areaH + fs * 2 + 26, "font-size": fs, "text-anchor": "middle", "font-weight": 800, style: "fill:#e8ea6e;font-family:Inter,sans-serif" });
        pv.textContent = pct(c, tot) + "%"; svg.appendChild(pv);
      });
    }

    var api = {
      setEvent: function (ev) { if (!ev) return; if (ev.code !== st.code) { st.code = ev.code; drawQr(); } },
      setWelcome: function (t) { st.mode = "welcome"; st.welcomeTitle = t; render(); },
      setQuestion: function (q, number) { st.mode = "question"; st.q = q; st.number = number || 1; render(); },
      setResults: function (res) { st.res = res; if (st.mode === "question") render(); },
      setRevealed: function (on) { if (st.revealed !== !!on) { st.revealed = !!on; render(); } },
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
