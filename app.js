/* Aurora Capture 极光捕网 v2.4.2 (Hotfix)
 * - 修复：按钮/选项卡事件绑定失效（2.4.x）
 * - 统一 tabs：.tab-btn + .tab-panel
 * - 绑定按钮：优先 btnRun/btnMag，其次 runBtn/magBtn，其次按文字兜底
 * - 自检：SunCalc/Chart/关键DOM缺失时给出明确提示（不“无反应”）
 *
 * 说明（前台不出现相关字样）：
 * - “可观测性门槛/窗口”、月角软降权仅用于后台打分，不在前台解释
 */

(() => {
  "use strict";

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const round1 = (x) => Math.round(x * 10) / 10;
  const abs = Math.abs;

  function safeText(el, t) { if (el) el.textContent = t; }
  function safeHTML(el, h) { if (el) el.innerHTML = h; }

  function setStatusDots(items) {
    const box = $("statusDots");
    if (!box) return;
    box.innerHTML = "";
    items.forEach(it => {
      const d = document.createElement("div");
      d.className = `dot ${it.level}`;
      d.textContent = it.text;
      box.appendChild(d);
    });
  }
  function setStatusText(t) { safeText($("statusText"), t); }

  function cacheSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value })); } catch (e) {}
  }
  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  function fmtAge(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return "刚刚";
    if (m < 60) return `${m} 分钟前`;
    const h = Math.floor(m / 60);
    return `${h} 小时前`;
  }

  // ---------- time fmt ----------
  function now() { return new Date(); }
  function fmtYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }
  function fmtHM(d) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  function fmtYMDHM(d) { return `${fmtYMD(d)} ${fmtHM(d)}`; }

  function escapeHTML(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  // ---------- astro (SunCalc required) ----------
  function deg(rad) { return rad * 180 / Math.PI; }

  function getSunAltDeg(date, lat, lon) {
    try {
      if (!window.SunCalc) return -999;
      const p = SunCalc.getPosition(date, lat, lon);
      return deg(p.altitude);
    } catch (e) { return -999; }
  }
  function getMoonAltDeg(date, lat, lon) {
    try {
      if (!window.SunCalc) return -999;
      const p = SunCalc.getMoonPosition(date, lat, lon);
      return deg(p.altitude);
    } catch (e) { return -999; }
  }

  // 后台：可观测性门槛（前台不解释）
  function obsGate(date, lat, lon) {
    const s = getSunAltDeg(date, lat, lon);
    return {
      hardBlock: s > 0,
      inWindow: s <= -12,
    };
  }

  // 月角软降权（按纬度档位 + 月亮高度，前台不展示）
  function moonFactorByLat(lat, moonAltDeg) {
    if (moonAltDeg <= 0) return 1.0;

    const L = abs(lat);
    const zone = (L >= 67) ? "high" : (L >= 62 ? "mid" : "edge");

    let tier = 0;
    if (moonAltDeg > 35) tier = 2;
    else if (moonAltDeg > 15) tier = 1;

    const table = {
      high: [1.00, 0.92, 0.82],
      mid:  [1.00, 0.88, 0.72],
      edge: [1.00, 0.80, 0.55],
    };
    return table[zone][tier];
  }

  function soften(f, ratio = 0.6) {
    return 1 - (1 - f) * ratio;
  }

  // ---------- data fetch ----------
  async function fetchSWPC2h() {
    const magUrl = "https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json";
    const plasmaUrl = "https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json";

    let mag, plasma, note = null;

    try {
      const [r1, r2] = await Promise.all([
        fetch(magUrl, { cache: "no-store" }),
        fetch(plasmaUrl, { cache: "no-store" })
      ]);

      const t1 = await r1.text();
      const t2 = await r2.text();
      if (!t1 || !t2) throw new Error("empty");

      mag = JSON.parse(t1);
      plasma = JSON.parse(t2);

      cacheSet("cache_noaa_mag", mag);
      cacheSet("cache_noaa_plasma", plasma);
      note = "✅ NOAA 已更新";
    } catch (e) {
      const cMag = cacheGet("cache_noaa_mag");
      const cPlasma = cacheGet("cache_noaa_plasma");
      if (cMag?.value && cPlasma?.value) {
        mag = cMag.value;
        plasma = cPlasma.value;
        note = `⚠️ NOAA 暂不可用，使用缓存（${fmtAge(Date.now() - (cMag.ts || Date.now()))}）`;
      } else {
        return { ok: false, note: "❌ NOAA 暂不可用且无缓存", data: null };
      }
    }

    const magHeader = mag[0];
    const magRows = mag.slice(1).map(row => {
      const o = {};
      magHeader.forEach((k, i) => o[k] = row[i]);
      return o;
    });

    const plHeader = plasma[0];
    const plRows = plasma.slice(1).map(row => {
      const o = {};
      plHeader.forEach((k, i) => o[k] = row[i]);
      return o;
    });

    const lastMag = magRows[magRows.length - 1];
    const lastPl = plRows[plRows.length - 1];

    const v = Number(lastPl?.speed);
    const n = Number(lastPl?.density);
    const bt = Number(lastMag?.bt);
    const bz = Number(lastMag?.bz);
    const time = lastMag?.time_tag || lastPl?.time_tag || null;

    return {
      ok: true,
      note,
      data: {
        v: isFinite(v) ? v : null,
        n: isFinite(n) ? n : null,
        bt: isFinite(bt) ? bt : null,
        bz: isFinite(bz) ? bz : null,
        time_tag: time
      }
    };
  }

  async function fetchKp() {
    const url = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json";
    try {
      const r = await fetch(url, { cache: "no-store" });
      const t = await r.text();
      if (!t) throw new Error("empty");
      const j = JSON.parse(t);
      cacheSet("cache_kp", j);
      return { ok: true, note: "✅ Kp 已更新", data: j };
    } catch (e) {
      const c = cacheGet("cache_kp");
      if (c?.value) {
        return { ok: true, note: `⚠️ Kp 暂不可用，使用缓存（${fmtAge(Date.now() - (c.ts || Date.now()))}）`, data: c.value };
      }
      return { ok: false, note: "❌ Kp 暂不可用且无缓存", data: null };
    }
  }

  async function fetchOvation() {
    const url = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
    try {
      const r = await fetch(url, { cache: "no-store" });
      const t = await r.text();
      if (!t) throw new Error("empty");
      const j = JSON.parse(t);
      cacheSet("cache_ovation", j);
      return { ok: true, note: "✅ OVATION 已更新", data: j };
    } catch (e) {
      const c = cacheGet("cache_ovation");
      if (c?.value) {
        return { ok: true, note: `⚠️ OVATION 暂不可用，使用缓存（${fmtAge(Date.now() - (c.ts || Date.now()))}）`, data: c.value };
      }
      return { ok: false, note: "❌ OVATION 暂不可用且无缓存", data: null };
    }
  }

  async function fetchClouds(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&hourly=cloudcover_low,cloudcover_mid,cloudcover_high&forecast_days=3&timezone=auto`;
    try {
      const r = await fetch(url, { cache: "no-store" });
      const t = await r.text();
      if (!t) throw new Error("empty");
      const j = JSON.parse(t);
      cacheSet("cache_clouds", { lat, lon, j });
      return { ok: true, note: "✅ 云量已更新", data: j };
    } catch (e) {
      const c = cacheGet("cache_clouds");
      if (c?.value?.j) {
        return { ok: true, note: `⚠️ 云量暂不可用，使用缓存（${fmtAge(Date.now() - (c.ts || Date.now()))}）`, data: c.value.j };
      }
      return { ok: false, note: "❌ 云量暂不可用且无缓存", data: null };
    }
  }

  // ---------- models ----------
  function approxMagLat(lat, lon) {
    const poleLat = 80.65;
    const poleLon = -72.68;

    const toRad = (d) => d * Math.PI / 180;
    const a1 = toRad(lat), b1 = toRad(lon);
    const a2 = toRad(poleLat), b2 = toRad(poleLon);

    const cosc = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(b1 - b2);
    const c = Math.acos(clamp(cosc, -1, 1));
    return 90 - deg(c);
  }

  function label1h(c) {
    if (c >= 8.2) return { t: "强烈推荐", cls: "g" };
    if (c >= 6.8) return { t: "值得出门", cls: "g" };
    if (c >= 5.0) return { t: "可蹲守", cls: "b" };
    if (c >= 2.8) return { t: "低概率", cls: "y" };
    return { t: "不可观测", cls: "r" };
  }

  function label72(c) {
    if (c >= 7.2) return { t: "可能性高", cls: "g" };
    if (c >= 5.6) return { t: "有窗口", cls: "b" };
    if (c >= 4.2) return { t: "小概率", cls: "y" };
    if (c >= 2.8) return { t: "低可能", cls: "y" };
    return { t: "不可观测", cls: "r" };
  }

  function baseScoreFromSW(sw) {
    const v = sw.v ?? 0;
    const bt = sw.bt ?? 0;
    const bz = sw.bz ?? 0;
    const n = sw.n ?? 0;

    const sv = clamp((v - 380) / (650 - 380), 0, 1);
    const sbt = clamp((bt - 4) / (12 - 4), 0, 1);
    const sbz = clamp(((-bz) - 1) / (10 - 1), 0, 1);
    const sn = clamp((n - 1) / (8 - 1), 0, 1);

    const raw = (sv * 0.28 + sbt * 0.26 + sbz * 0.32 + sn * 0.14) * 10;
    return clamp(raw, 0, 10);
  }

  function deliverModel(sw) {
    const v = sw.v ?? 0;
    const bt = sw.bt ?? 0;
    const n = sw.n ?? 0;

    const okBt = bt >= 6.5;
    const okV = v >= 430;
    const okN = n >= 2.0;
    const count = (okBt ? 1 : 0) + (okV ? 1 : 0) + (okN ? 1 : 0);

    return { count, okBt, okV, okN };
  }

  function state3h(sw) {
    const v = sw.v ?? 0;
    const bt = sw.bt ?? 0;
    const bz = sw.bz ?? 999;
    const n = sw.n ?? 0;

    const trig = (bz <= -3.0);
    const bg = (v >= 420 && bt >= 6.0);
    const dense = (n >= 2.0);

    if (trig && bg) return { state: "爆发进行中", hint: "触发更明确，短时内值得马上看。", score: 8.0 };
    if (bg && (dense || trig)) return { state: "爆发概率上升", hint: "系统更容易发生，但未到持续触发。", score: 6.4 };
    if (bg) return { state: "爆发后衰落期", hint: "刚有过波动的概率更高，可能余震一会儿。", score: 5.4 };
    return { state: "静默", hint: "背景不足或触发不清晰，先别投入。", score: 3.0 };
  }

  function bestCloud3h(cloud, baseDate) {
    const t = cloud?.hourly?.time;
    const low = cloud?.hourly?.cloudcover_low;
    const mid = cloud?.hourly?.cloudcover_mid;
    const high = cloud?.hourly?.cloudcover_high;
    if (!t || !low || !mid || !high) return null;

    const start = baseDate.getTime();
    const end = start + 3 * 3600 * 1000;

    let best = null;
    for (let i = 0; i < t.length; i++) {
      const dt = new Date(t[i]).getTime();
      if (dt < start || dt > end) continue;

      const item = { dt, low: low[i], mid: mid[i], high: high[i] };
      const s = (100 - item.low) * 0.6 + (100 - item.mid) * 0.28 + (100 - item.high) * 0.12;
      item.s = s;
      if (!best || item.s > best.s) best = item;
    }
    return best;
  }

  function kpMaxByDay(kpJson) {
    if (!kpJson || !Array.isArray(kpJson) || kpJson.length < 2) return null;
    const header = kpJson[0];
    const rows = kpJson.slice(1).map(r => {
      const o = {};
      header.forEach((k, i) => o[k] = r[i]);
      return o;
    });

    const map = new Map();
    rows.forEach(o => {
      const tt = o.time_tag;
      const kp = Number(o.kp);
      if (!tt || !isFinite(kp)) return;

      const d = new Date(tt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const cur = map.get(key) ?? -1;
      if (kp > cur) map.set(key, kp);
    });
    return map;
  }

  function next3DaysLocal(baseDate) {
    const arr = [];
    const d0 = new Date(baseDate);
    d0.setHours(0, 0, 0, 0);
    for (let i = 0; i < 3; i++) arr.push(new Date(d0.getTime() + i * 86400000));
    return arr;
  }

  function scoreCloudDay(cloud, dayDate) {
    if (!cloud?.hourly?.time) return 0.5;
    const t = cloud.hourly.time;
    const low = cloud.hourly.cloudcover_low;
    const mid = cloud.hourly.cloudcover_mid;
    const high = cloud.hourly.cloudcover_high;

    const start = new Date(dayDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);

    let best = null;
    for (let i = 0; i < t.length; i++) {
      const dt = new Date(t[i]);
      if (dt < start || dt >= end) continue;

      const s = (100 - low[i]) * 0.55 + (100 - mid[i]) * 0.35 + (100 - high[i]) * 0.10;
      if (best == null || s > best) best = s;
    }
    if (best == null) return 0.5;
    return clamp(best / 100, 0, 1);
  }

  function bestCloudHourForDay(cloud, dayDate) {
    if (!cloud?.hourly?.time) return null;
    const t = cloud.hourly.time;
    const low = cloud.hourly.cloudcover_low;
    const mid = cloud.hourly.cloudcover_mid;
    const high = cloud.hourly.cloudcover_high;

    const start = new Date(dayDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);

    let best = null;
    for (let i = 0; i < t.length; i++) {
      const dt = new Date(t[i]);
      if (dt < start || dt >= end) continue;

      const item = {
        hh: String(dt.getHours()).padStart(2, "0"),
        low: low[i], mid: mid[i], high: high[i]
      };
      const s = (100 - item.low) * 0.55 + (100 - item.mid) * 0.35 + (100 - item.high) * 0.10;
      item.s = s;
      if (!best || item.s > best.s) best = item;
    }
    return best;
  }

  function estimateNightRatio(dayDate, lat, lon) {
    let ok = 0, total = 0;
    const base = new Date(dayDate);
    base.setHours(0, 0, 0, 0);
    for (let h = 0; h < 24; h += 2) {
      const d = new Date(base.getTime() + h * 3600 * 1000);
      const g = obsGate(d, lat, lon);
      if (g.inWindow) ok++;
      total++;
    }
    if (total === 0) return 0;
    return ok / total;
  }

  function pickOvationForLat(ov) {
    try {
      if (!ov) return null;
      if (ov.ObservationTime || ov.ForecastTime) return "已拉取";
      return null;
    } catch (e) { return null; }
  }

  // ---------- chart ----------
  let chart = null;

  function renderChart(labels, values) {
    const canvas = $("cChart");
    if (!canvas) return;

    // Chart.js required
    if (!window.Chart) {
      setStatusText("图表模块未加载（Chart.js）。");
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "C值",
          data: values,
          borderWidth: 0,
          borderRadius: 10
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            max: 10,
            ticks: { color: "rgba(255,255,255,.55)" },
            grid: { color: "rgba(255,255,255,.08)" }
          },
          x: {
            ticks: { color: "rgba(255,255,255,.55)" },
            grid: { display: false }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx2) => `C值：${round1(ctx2.parsed.y)}`
            }
          }
        }
      }
    });
  }

  function badgeHTML(text, cls) {
    return `<span class="badge ${cls}"><span class="bDot"></span>${text}</span>`;
  }
  function scoreHTML(v) {
    return `<span class="scorePill">${round1(v)}</span>`;
  }

  // ---------- core run ----------
  async function run() {
    try {
      const latEl = $("lat");
      const lonEl = $("lon");

      const lat = Number(latEl?.value);
      const lon = Number(lonEl?.value);

      if (!isFinite(lat) || !isFinite(lon)) {
        setStatusText("请先输入有效经纬度。");
        return;
      }

      // SunCalc sanity (without telling user why)
      if (!window.SunCalc) {
        setStatusText("关键计算模块未加载（SunCalc）。");
        return;
      }

      setStatusText("拉取数据中…");
      setStatusDots([
        { level: "warn", text: "NOAA 拉取中" },
        { level: "warn", text: "Kp 拉取中" },
        { level: "warn", text: "云量拉取中" },
        { level: "warn", text: "OVATION 拉取中" },
      ]);

      // 地理纬度门槛（你要求：不解释）
      if (abs(lat) < 50) {
        safeText($("oneHeroLabel"), "不可观测");
        safeText($("oneHeroMeta"), "—");
        safeText($("swLine"), "V — ｜ Bt — ｜ Bz — ｜ N —");
        safeText($("swMeta"), "—");
        renderChart(["+10m", "+20m", "+30m", "+40m", "+50m", "+60m"], [0, 0, 0, 0, 0, 0]);
        safeText($("threeState"), "静默");
        safeText($("threeHint"), "—");
        safeText($("threeDeliver"), "—");
        safeText($("threeDeliverMeta"), "—");
        safeText($("threeClouds"), "Low —% ｜ Mid —% ｜ High —%");
        safeHTML($("daysBody"), `<tr><td colspan="4" class="muted">不可观测。</td></tr>`);
        setStatusDots([
          { level: "ok", text: "NOAA —" },
          { level: "ok", text: "Kp —" },
          { level: "ok", text: "云量 —" },
          { level: "ok", text: "OVATION —" },
        ]);
        setStatusText("已生成。");
        return;
      }

      const [noaa, kp, clouds, ova] = await Promise.all([
        fetchSWPC2h(),
        fetchKp(),
        fetchClouds(lat, lon),
        fetchOvation()
      ]);

      setStatusDots([
        { level: noaa.ok ? "ok" : "bad", text: noaa.note || "NOAA" },
        { level: kp.ok ? "ok" : "bad", text: kp.note || "Kp" },
        { level: clouds.ok ? "ok" : "bad", text: clouds.note || "云量" },
        { level: ova.ok ? "ok" : "bad", text: ova.note || "OVATION" },
      ]);

      const sw = noaa.data;
      if (!sw) {
        safeText($("oneHeroLabel"), "不可观测");
        safeText($("oneHeroMeta"), "—");
        safeText($("swLine"), "V — ｜ Bt — ｜ Bz — ｜ N —");
        safeText($("swMeta"), "—");
        renderChart(["+10m", "+20m", "+30m", "+40m", "+50m", "+60m"], [0, 0, 0, 0, 0, 0]);
        setStatusText("部分数据缺失，已用可用数据生成。");
        return;
      }

      const vTxt = sw.v == null ? "—" : round1(sw.v);
      const btTxt = sw.bt == null ? "—" : round1(sw.bt);
      const bzTxt = sw.bz == null ? "—" : round1(sw.bz);
      const nTxt = sw.n == null ? "—" : round1(sw.n);

      safeText($("swLine"), `V ${vTxt} ｜ Bt ${btTxt} ｜ Bz ${bzTxt} ｜ N ${nTxt}`);
      safeText($("swMeta"), sw.time_tag ? `NOAA 时间：${sw.time_tag}` : "—");

      const mlat = approxMagLat(lat, lon);
      const base = baseScoreFromSW(sw);
      const baseDate = now();

      // 1h: 10min bins
      const labels = [];
      const vals = [];
      let heroC = 0;

      for (let i = 0; i < 6; i++) {
        const d = new Date(baseDate.getTime() + (i + 1) * 10 * 60000);

        const gate = obsGate(d, lat, lon);
        const moonAlt = getMoonAltDeg(d, lat, lon);
        const moonF = moonFactorByLat(lat, moonAlt);

        const latBoost = clamp((mlat - 55) / 12, 0, 1);
        const latF = 0.85 + latBoost * 0.15;

        const decay = Math.pow(0.92, i);
        let c = base * decay;

        if (gate.hardBlock) {
          c = 0;
        } else {
          if (!gate.inWindow) c *= 0.55;
          c *= moonF;
          c *= latF;
        }

        c = clamp(c, 0, 10);
        labels.push(fmtHM(d));
        vals.push(round1(c));
        if (i === 0) heroC = c;
      }

      const heroObj = label1h(heroC);
      safeText($("oneHeroLabel"), heroObj.t);
      safeText(
        $("oneHeroMeta"),
        `本地时间：${fmtYMDHM(baseDate)} ・ OVATION：${ova.ok ? (pickOvationForLat(ova.data) ?? "—") : "—"}`
      );

      renderChart(labels, vals);

      // 3h
      let s3 = state3h(sw);
      const del = deliverModel(sw);

      const g3 = obsGate(baseDate, lat, lon);
      const moonAlt3 = getMoonAltDeg(baseDate, lat, lon);
      const moonF3 = moonFactorByLat(lat, moonAlt3);

      let s3score = s3.score;
      if (g3.hardBlock) s3score = 0;
      else {
        if (!g3.inWindow) s3score *= 0.65;
        s3score *= moonF3;
      }

      if (heroObj.t === "不可观测") {
        if (s3.state === "爆发进行中") s3 = { ...s3, state: "爆发概率上升", hint: "—" };
        if (s3.state === "爆发概率上升") s3 = { ...s3, state: "爆发后衰落期", hint: "—" };
      }

      if (s3score < 3.2) s3 = { ...s3, state: "静默", hint: "—" };
      else if (s3score < 5.0 && s3.state === "爆发进行中") s3 = { ...s3, state: "爆发概率上升", hint: "—" };

      safeText($("threeState"), s3.state);
      safeText($("threeHint"), s3.hint || "—");
      safeText($("threeDeliver"), `${del.count}/3 成立`);
      safeText($("threeDeliverMeta"), `Bt平台${del.okBt ? "✅" : "⚠️"} ・ 速度背景${del.okV ? "✅" : "⚠️"} ・ 密度结构${del.okN ? "✅" : "⚠️"}`);

      let cloudBest = null;
      if (clouds.ok && clouds.data) cloudBest = bestCloud3h(clouds.data, baseDate);
      safeText(
        $("threeClouds"),
        cloudBest
          ? `Low ${cloudBest.low}% ｜ Mid ${cloudBest.mid}% ｜ High ${cloudBest.high}%`
          : `Low —% ｜ Mid —% ｜ High —%`
      );

      // 72h
      const days = next3DaysLocal(baseDate);
      const kpMap = kp.ok ? kpMaxByDay(kp.data) : null;

      const tbody = [];
      days.forEach(d => {
        const key = fmtYMD(d);
        const kpMax = kpMap?.get(key) ?? null;

        const sKp = kpMax == null ? 0.45 : clamp((kpMax - 3.5) / (7.0 - 3.5), 0, 1);
        const sDel = del.count / 3;
        const sCloud = scoreCloudDay(clouds.ok ? clouds.data : null, d);

        let cDay = (sKp * 0.48 + sDel * 0.32 + sCloud * 0.20) * 10;

        const nightRatio = estimateNightRatio(d, lat, lon);
        cDay *= (0.55 + nightRatio * 0.45);

        const mAlt = getMoonAltDeg(new Date(d.getTime() + 12 * 3600 * 1000), lat, lon);
        const fMoon = soften(moonFactorByLat(lat, mAlt), 0.6);
        cDay *= fMoon;

        cDay = clamp(cDay, 0, 10);

        const lab = label72(cDay);

        const basis = [];
        if (kpMax != null) basis.push(`能量背景：Kp峰值≈${round1(kpMax)}`);
        else basis.push(`能量背景：Kp暂无有效数据（保守评估）`);

        basis.push(`日冕洞与日冕物质抛射模型：以 Kp 作为能量背景代理（值越高越有戏）`);
        basis.push(`太阳风送达能力综合模型：当前 ${del.count}/3（Bt/速度/密度）`);

        if (clouds.ok && clouds.data) {
          const win = bestCloudHourForDay(clouds.data, d);
          if (win) basis.push(`云量更佳点：${win.hh}:00（Low≈${win.low}% Mid≈${win.mid}% High≈${win.high}%）`);
          else basis.push(`云量：暂无可用点（保守）`);
        } else {
          basis.push(`云量：暂无可用数据（保守）`);
        }

        tbody.push(`
          <tr>
            <td>${key}</td>
            <td>${badgeHTML(lab.t, lab.cls)}</td>
            <td>${scoreHTML(cDay)}</td>
            <td class="muted2">${basis.map(x => `• ${escapeHTML(x)}`).join("<br/>")}</td>
          </tr>
        `);
      });

      safeHTML($("daysBody"), tbody.join(""));
      setStatusText("已生成。");
    } catch (err) {
      console.error("[AuroraCapture] run error:", err);
      setStatusText("生成失败：请打开控制台查看错误。");
    }
  }

  // ---------- tabs (ONLY ONE system) ----------
  function initTabs() {
    const btns = Array.from(document.querySelectorAll(".tab-btn"));
    const panels = Array.from(document.querySelectorAll(".tab-panel"));

    if (!btns.length || !panels.length) return;

    const activate = (name) => {
      btns.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
      panels.forEach(p => p.classList.toggle("active", p.dataset.panel === name));
    };

    activate(btns[0].dataset.tab);

    btns.forEach(b => {
      b.addEventListener("click", (e) => {
        e.preventDefault();
        activate(b.dataset.tab);
      });
    });
  }

  // ---------- binding ----------
  function bindRunButton() {
    const candidates = [
      $("btnRun"),
      $("runBtn"),
      document.querySelector('[data-action="run"]'),
    ].filter(Boolean);

    // 兜底：按文字匹配
    if (!candidates.length) {
      const all = Array.from(document.querySelectorAll("button,a,input[type='button'],input[type='submit']"));
      all.forEach(el => {
        const text = (el.textContent || el.value || "").trim();
        if (text.includes("生成即时预测")) candidates.push(el);
      });
    }

    if (!candidates.length) {
      console.warn("[AuroraCapture] RUN button not found");
      setStatusText("未找到“生成即时预测”按钮（请检查按钮 id）。");
      return;
    }

    candidates.forEach(el => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        run();
      });
    });
  }

  function bindMagButton() {
    const candidates = [
      $("btnMag"),
      $("magBtn"),
      document.querySelector('[data-action="mag"]'),
    ].filter(Boolean);

    if (!candidates.length) {
      const all = Array.from(document.querySelectorAll("button,a,input[type='button']"));
      all.forEach(el => {
        const text = (el.textContent || el.value || "").trim();
        if (text.includes("转换磁纬度")) candidates.push(el);
      });
    }

    if (!candidates.length) {
      console.warn("[AuroraCapture] MAG button not found");
      return;
    }

    candidates.forEach(el => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const lat = Number($("lat")?.value);
        const lon = Number($("lon")?.value);
        if (!isFinite(lat) || !isFinite(lon)) {
          setStatusText("请先输入有效经纬度。");
          return;
        }
        const m = approxMagLat(lat, lon);
        alert(`磁纬约 ${round1(m)}°`);
      });
    });
  }

  function bootstrap() {
    console.log("[AuroraCapture] v2.4.2 bootstrap");

    // defaults
    if ($("lat") && !$("lat").value) $("lat").value = "53.47";
    if ($("lon") && !$("lon").value) $("lon").value = "122.35";

    initTabs();
    bindRunButton();
    bindMagButton();

    // basic DOM sanity
    const must = ["lat", "lon", "statusText", "statusDots"];
    const missing = must.filter(id => !$(id));
    if (missing.length) {
      console.warn("[AuroraCapture] missing DOM ids:", missing);
      setStatusText("页面组件缺失：请检查 HTML 的 id 是否一致。");
    }
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
