/* Aurora Capture 极光捕网 v2.5.2
 * - C值图表改为 0–5（整数）
 * - 结论统一：5档（5强烈推荐 / 4值得出门 / 3可蹲守 / 2低概率 / 1不可观测）
 * - NOAA 数据缺失：强提示 + 保守估算（不直接降到不可观测）
 * - 云量显示：低云/中云/高云 + 评分（优/良/中/差）
 * - 72h 表格结论与底部注释同一命名体系
 * - 新增：背景介绍 Modal
 * - 再次修改按钮无法点击问题
 */

(() => {
  "use strict";

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const round0 = (x) => Math.round(x);
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

  function cacheSet(key, value){
    try{ localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value })); }catch(e){}
  }
  function cacheGet(key){
    try{
      const raw = localStorage.getItem(key);
      if(!raw) return null;
      return JSON.parse(raw);
    }catch(e){ return null; }
  }
  function fmtAge(ms){
    const m = Math.floor(ms/60000);
    if(m < 1) return "刚刚";
    if(m < 60) return `${m} 分钟前`;
    const h = Math.floor(m/60);
    return `${h} 小时前`;
  }

  // ---------- time fmt ----------
  function now(){ return new Date(); }
  function fmtYMD(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }
  function fmtHM(d){
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return `${hh}:${mm}`;
  }
  function fmtYMDHM(d){ return `${fmtYMD(d)} ${fmtHM(d)}`; }

  function escapeHTML(s){
    return String(s)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;");
  }

  // ---------- astro (SunCalc required) ----------
  function deg(rad){ return rad * 180 / Math.PI; }

  function getSunAltDeg(date, lat, lon){
    try{
      if(!window.SunCalc) return -999;
      const p = SunCalc.getPosition(date, lat, lon);
      return deg(p.altitude);
    }catch(e){ return -999; }
  }
  function getMoonAltDeg(date, lat, lon){
    try{
      if(!window.SunCalc) return -999;
      const p = SunCalc.getMoonPosition(date, lat, lon);
      return deg(p.altitude);
    }catch(e){ return -999; }
  }

  // 后台：可观测性门槛（不解释）
  function obsGate(date, lat, lon){
    const s = getSunAltDeg(date, lat, lon);
    return { hardBlock: s > 0, inWindow: s <= -12 };
  }

  // 月角软降权（不展示）
  function moonFactorByLat(lat, moonAltDeg){
    if(moonAltDeg <= 0) return 1.0;
    const L = abs(lat);
    const zone = (L >= 67) ? "high" : (L >= 62 ? "mid" : "edge");
    let tier = 0;
    if(moonAltDeg > 35) tier = 2;
    else if(moonAltDeg > 15) tier = 1;

    const table = {
      high: [1.00, 0.92, 0.82],
      mid:  [1.00, 0.88, 0.72],
      edge: [1.00, 0.80, 0.55],
    };
    return table[zone][tier];
  }
  function soften(f, ratio=0.6){
    return 1 - (1 - f) * ratio;
  }

  // ---------- NOAA fetch helpers ----------
  function lastFinite(rows, key){
    for(let i = rows.length - 1; i >= 0; i--){
      const v = Number(rows[i]?.[key]);
      if(Number.isFinite(v)) return v;
    }
    return null;
  }
  function lastTimeTag(rows){
    for(let i = rows.length - 1; i >= 0; i--){
      const t = rows[i]?.time_tag;
      if(t) return t;
    }
    return null;
  }

  // ---------- data fetch ----------
  async function fetchSWPC2h(){
    const magUrl = "https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json";
    const plasmaUrl = "https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json";

    let mag, plasma, note = null;

    try{
      const [r1, r2] = await Promise.all([
        fetch(magUrl, { cache:"no-store" }),
        fetch(plasmaUrl, { cache:"no-store" })
      ]);

      const t1 = await r1.text();
      const t2 = await r2.text();
      if(!t1 || !t2) throw new Error("empty");

      mag = JSON.parse(t1);
      plasma = JSON.parse(t2);

      cacheSet("cache_noaa_mag", mag);
      cacheSet("cache_noaa_plasma", plasma);

      note = "✅ NOAA 已更新";
    }catch(e){
      const cMag = cacheGet("cache_noaa_mag");
      const cPl = cacheGet("cache_noaa_plasma");
      if(cMag?.value && cPl?.value){
        mag = cMag.value;
        plasma = cPl.value;
        note = `⚠️ NOAA 拉取失败，使用缓存（${fmtAge(Date.now() - (cMag.ts || Date.now()))}）`;
      }else{
        return { ok:false, note:"❌ NOAA 拉取失败且无缓存", data:null, missing: ["v","n","bt","bz"] };
      }
    }

    // parse tables
    const magHeader = mag[0];
    const magRows = mag.slice(1).map(row=>{
      const o={};
      magHeader.forEach((k,i)=>o[k]=row[i]);
      return o;
    });

    const plHeader = plasma[0];
    const plRows = plasma.slice(1).map(row=>{
      const o={};
      plHeader.forEach((k,i)=>o[k]=row[i]);
      return o;
    });

    // scan backwards for valid values
    const v  = lastFinite(plRows, "speed");
    const n  = lastFinite(plRows, "density");
    const bt = lastFinite(magRows, "bt");
    const bz = lastFinite(magRows, "bz");

    const time = lastTimeTag(magRows) || lastTimeTag(plRows) || null;

    const missing = [];
    if(v == null)  missing.push("v");
    if(n == null)  missing.push("n");
    if(bt == null) missing.push("bt");
    if(bz == null) missing.push("bz");

    return {
      ok: true,
      note,
      data: { v, n, bt, bz, time_tag: time },
      missing
    };
  }

  async function fetchKp(){
    const url = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json";
    try{
      const r = await fetch(url, { cache:"no-store" });
      const t = await r.text();
      if(!t) throw new Error("empty");
      const j = JSON.parse(t);
      cacheSet("cache_kp", j);
      return { ok:true, note:"✅ Kp 已更新", data:j };
    }catch(e){
      const c = cacheGet("cache_kp");
      if(c?.value){
        return { ok:true, note:`⚠️ Kp 拉取失败，使用缓存（${fmtAge(Date.now() - (c.ts || Date.now()))}）`, data:c.value };
      }
      return { ok:false, note:"❌ Kp 拉取失败且无缓存", data:null };
    }
  }

  async function fetchOvation(){
    const url = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
    try{
      const r = await fetch(url, { cache:"no-store" });
      const t = await r.text();
      if(!t) throw new Error("empty");
      const j = JSON.parse(t);
      cacheSet("cache_ovation", j);
      return { ok:true, note:"✅ OVATION 已更新", data:j };
    }catch(e){
      const c = cacheGet("cache_ovation");
      if(c?.value){
        return { ok:true, note:`⚠️ OVATION 拉取失败，使用缓存（${fmtAge(Date.now() - (c.ts || Date.now()))}）`, data:c.value };
      }
      return { ok:false, note:"❌ OVATION 拉取失败且无缓存", data:null };
    }
  }

  async function fetchClouds(lat, lon){
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&hourly=cloudcover_low,cloudcover_mid,cloudcover_high&forecast_days=3&timezone=auto`;
    try{
      const r = await fetch(url, { cache:"no-store" });
      const t = await r.text();
      if(!t) throw new Error("empty");
      const j = JSON.parse(t);
      cacheSet("cache_clouds", { lat, lon, j });
      return { ok:true, note:"✅ 云量已更新", data:j };
    }catch(e){
      const c = cacheGet("cache_clouds");
      if(c?.value?.j){
        return { ok:true, note:`⚠️ 云量拉取失败，使用缓存（${fmtAge(Date.now() - (c.ts || Date.now()))}）`, data:c.value.j };
      }
      return { ok:false, note:"❌ 云量拉取失败且无缓存", data:null };
    }
  }

  // ---------- models ----------
  function approxMagLat(lat, lon){
    const poleLat = 80.65;
    const poleLon = -72.68;
    const toRad = (d)=>d*Math.PI/180;
    const a1 = toRad(lat), b1 = toRad(lon);
    const a2 = toRad(poleLat), b2 = toRad(poleLon);
    const cosc = Math.sin(a1)*Math.sin(a2) + Math.cos(a1)*Math.cos(a2)*Math.cos(b1-b2);
    const c = Math.acos(clamp(cosc, -1, 1));
    return 90 - deg(c);
  }

  function labelByScore5(s){
    if(s >= 5) return { score:5, t:"强烈推荐", cls:"g" };
    if(s >= 4) return { score:4, t:"值得出门", cls:"g" };
    if(s >= 3) return { score:3, t:"可蹲守", cls:"b" };
    if(s >= 2) return { score:2, t:"低概率", cls:"y" };
    return { score:1, t:"不可观测", cls:"r" };
  }

  // 太阳风 → 0~10 的内部基准（仍用，但前台只输出 0~5）
  function baseScoreFromSW(sw, missingKeys){
    const v  = sw.v  ?? 0;
    const bt = sw.bt ?? 0;
    const bz = sw.bz ?? 0;
    const n  = sw.n  ?? 0;

    const sv  = clamp((v - 380) / (650 - 380), 0, 1);
    const sbt = clamp((bt - 4) / (12 - 4), 0, 1);

    // bz: 0~-10（越南向越好）
    // 如果 bz 缺失：按“保守”（当作 0，即没有南向贡献）
    const bzMissing = missingKeys?.includes("bz");
    const sbz = bzMissing ? 0 : clamp(((-bz) - 1) / (10 - 1), 0, 1);

    const sn  = clamp((n - 1) / (8 - 1), 0, 1);

    let raw = (sv*0.28 + sbt*0.26 + sbz*0.32 + sn*0.14) * 10;

    // 若关键项缺失，额外保守压制一点（但不直接归零）
    if(bzMissing) raw *= 0.78;
    if(missingKeys?.includes("bt")) raw *= 0.85;
    if(missingKeys?.includes("v"))  raw *= 0.85;

    return clamp(raw, 0, 10);
  }

  function deliverModel(sw){
    const v  = sw.v  ?? 0;
    const bt = sw.bt ?? 0;
    const n  = sw.n  ?? 0;

    const okBt = bt >= 6.5;
    const okV  = v >= 430;
    const okN  = n >= 2.0;

    const count = (okBt?1:0) + (okV?1:0) + (okN?1:0);
    return { count, okBt, okV, okN };
  }

  function state3h(sw){
    const v  = sw.v  ?? 0;
    const bt = sw.bt ?? 0;
    const bz = (sw.bz == null) ? 999 : sw.bz; // 缺失时不触发 trig
    const n  = sw.n  ?? 0;

    const trig  = (bz <= -3.0);
    const bg    = (v >= 420 && bt >= 6.0);
    const dense = (n >= 2.0);

    if(trig && bg) return { state:"爆发进行中", hint:"触发更明确，短时内值得马上看。", score:8.0 };
    if(bg && (dense || trig)) return { state:"爆发概率上升", hint:"系统更容易发生，但未到持续触发。", score:6.4 };
    if(bg) return { state:"爆发后衰落期", hint:"刚有过波动，仍可能余震一会儿。", score:5.4 };
    return { state:"静默", hint:"背景不足或触发不清晰，先别投入。", score:3.0 };
  }

  // 云量：取未来3小时内最佳点
  function bestCloud3h(cloud, baseDate){
    const t = cloud?.hourly?.time;
    const low = cloud?.hourly?.cloudcover_low;
    const mid = cloud?.hourly?.cloudcover_mid;
    const high = cloud?.hourly?.cloudcover_high;
    if(!t || !low || !mid || !high) return null;

    const start = baseDate.getTime();
    const end = start + 3*3600*1000;

    let best = null;
    for(let i=0;i<t.length;i++){
      const dt = new Date(t[i]).getTime();
      if(dt < start || dt > end) continue;
      const item = { dt, low:low[i], mid:mid[i], high:high[i] };
      // 更偏向低云/中云
      const s = (100 - item.low)*0.6 + (100 - item.mid)*0.28 + (100 - item.high)*0.12;
      item.s = s;
      if(!best || item.s > best.s) best = item;
    }
    return best;
  }

  // 3小时云量评分（优/良/中/差）——直觉阈值：你说“80%低云就是差”
  function cloudGradeFromBest(best){
    const low = Number(best?.low ?? 100);
    const mid = Number(best?.mid ?? 100);
    const high = Number(best?.high ?? 100);

    if(low <= 20 && mid <= 40 && high <= 70) return "优";
    if(low <= 40 && mid <= 55 && high <= 80) return "良";
    if(low <= 60 && mid <= 70 && high <= 90) return "中";
    return "差";
  }

  // 72h：kp按天最大
  function kpMaxByDay(kpJson){
    if(!kpJson || !Array.isArray(kpJson) || kpJson.length < 2) return null;
    const header = kpJson[0];
    const rows = kpJson.slice(1).map(r=>{
      const o={};
      header.forEach((k,i)=>o[k]=r[i]);
      return o;
    });

    const map = new Map();
    rows.forEach(o=>{
      const tt = o.time_tag;
      const kp = Number(o.kp);
      if(!tt || !Number.isFinite(kp)) return;
      const d = new Date(tt);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const cur = map.get(key) ?? -1;
      if(kp > cur) map.set(key, kp);
    });
    return map;
  }

  function next3DaysLocal(baseDate){
    const arr=[];
    const d0 = new Date(baseDate);
    d0.setHours(0,0,0,0);
    for(let i=0;i<3;i++) arr.push(new Date(d0.getTime() + i*86400000));
    return arr;
  }

  function scoreCloudDay(cloud, dayDate){
    if(!cloud?.hourly?.time) return 0.5;
    const t = cloud.hourly.time;
    const low = cloud.hourly.cloudcover_low;
    const mid = cloud.hourly.cloudcover_mid;
    const high = cloud.hourly.cloudcover_high;

    const start = new Date(dayDate);
    start.setHours(0,0,0,0);
    const end = new Date(start.getTime() + 24*3600*1000);

    let best = null;
    for(let i=0;i<t.length;i++){
      const dt = new Date(t[i]);
      if(dt < start || dt >= end) continue;
      const s = (100 - low[i])*0.55 + (100 - mid[i])*0.35 + (100 - high[i])*0.10;
      if(best == null || s > best) best = s;
    }
    if(best == null) return 0.5;
    return clamp(best/100, 0, 1);
  }

  function bestCloudHourForDay(cloud, dayDate){
    if(!cloud?.hourly?.time) return null;
    const t = cloud.hourly.time;
    const low = cloud.hourly.cloudcover_low;
    const mid = cloud.hourly.cloudcover_mid;
    const high = cloud.hourly.cloudcover_high;

    const start = new Date(dayDate);
    start.setHours(0,0,0,0);
    const end = new Date(start.getTime() + 24*3600*1000);

    let best = null;
    for(let i=0;i<t.length;i++){
      const dt = new Date(t[i]);
      if(dt < start || dt >= end) continue;
      const item = {
        hh: String(dt.getHours()).padStart(2,'0'),
        low: low[i], mid: mid[i], high: high[i]
      };
      const s = (100 - item.low)*0.55 + (100 - item.mid)*0.35 + (100 - item.high)*0.10;
      item.s = s;
      if(!best || item.s > best.s) best = item;
    }
    return best;
  }

  function estimateNightRatio(dayDate, lat, lon){
    let ok=0, total=0;
    const base = new Date(dayDate);
    base.setHours(0,0,0,0);
    for(let h=0; h<24; h+=2){
      const d = new Date(base.getTime() + h*3600*1000);
      const g = obsGate(d, lat, lon);
      if(g.inWindow) ok++;
      total++;
    }
    if(total === 0) return 0;
    return ok/total;
  }

  function pickOvation(ov){
    try{
      if(!ov) return null;
      if(ov.ObservationTime || ov.ForecastTime) return "已拉取";
      return null;
    }catch(e){ return null; }
  }

  // ---------- score mapping ----------
  // internal c10 -> score5 (1..5), and chart can show 0 when hardBlock
  function score5FromC10(c10){
    if(c10 >= 8.2) return 5;
    if(c10 >= 6.8) return 4;
    if(c10 >= 5.0) return 3;
    if(c10 >= 2.8) return 2;
    return 1;
  }

  // ---------- chart ----------
  let chart = null;

  function renderChart(labels, values, colors){
    const canvas = $("cChart");
    if(!canvas) return;

    if(!window.Chart){
      setStatusText("图表模块未加载（Chart.js）。");
      return;
    }

    const ctx = canvas.getContext("2d");
    if(!ctx) return;

    if(chart) chart.destroy();

    chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "C值",
          data: values,
          borderWidth: 0,
          borderRadius: 10,
          backgroundColor: colors
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            max: 5,
            ticks: {
              stepSize: 1,
              color: "rgba(255,255,255,.55)"
            },
            grid: { color: "rgba(255,255,255,.08)" }
          },
          x: {
            ticks: { color: "rgba(255,255,255,.55)" },
            grid: { display:false }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx2)=> `C值：${ctx2.parsed.y}`
            }
          }
        }
      }
    });
  }

  function badgeHTML(text, cls){
    return `<span class="badge ${cls}"><span class="bDot"></span>${text}</span>`;
  }

  // ---------- tabs ----------
  function initTabs(){
    const tabs = Array.from(document.querySelectorAll(".tabs .tab"));
    const panes = Array.from(document.querySelectorAll(".pane"));
    if(!tabs.length || !panes.length) return;

    const activate = (id) => {
      tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === id));
      panes.forEach(p => p.classList.toggle("active", p.id === id));
    };

    const defaultTab = tabs.find(t => t.classList.contains("active")) || tabs[0];
    activate(defaultTab.dataset.tab);

    tabs.forEach(t => t.addEventListener("click", () => activate(t.dataset.tab)));
  }

  // ---------- background modal ----------
  function initAbout(){
    const btn = $("btnAbout");
    const modal = $("aboutModal");
    const closeBtn = $("btnAboutClose");
    if(!btn || !modal) return;

    const open = () => {
      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    };
    const close = () => {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    };

    btn.addEventListener("click", open);
    closeBtn?.addEventListener("click", close);

    modal.addEventListener("click", (e) => {
      const t = e.target;
      if(t && t.dataset && t.dataset.close) close();
    });

    document.addEventListener("keydown", (e) => {
      if(e.key === "Escape" && !modal.classList.contains("hidden")) close();
    });
  }

  // ---------- NOAA 强提示弹窗（必须手动关闭） ----------
  let __alertBound = false;
  function showAlertModal(html){
    const overlay = $("alertOverlay");
    const body = $("alertBody");
    const close = $("alertClose");
    const ok = $("alertOk");
    if(!overlay || !body) return;

    body.innerHTML = html;

    overlay.classList.add("show");
    overlay.setAttribute("aria-hidden", "false");

    if(!__alertBound){
      __alertBound = true;
      const hide = () => {
        overlay.classList.remove("show");
        overlay.setAttribute("aria-hidden", "true");
      };
      close && close.addEventListener("click", hide);
      ok && ok.addEventListener("click", hide);
      overlay.addEventListener("click", (e) => { if(e.target === overlay) hide(); });
      document.addEventListener("keydown", (e) => { if(e.key === "Escape") hide(); });
    }
  }

  // ---------- 72h：高速风/能量输入 1/1 的代理规则 ----------
  function p1a_fastWind(sw){
    const v = Number(sw?.v ?? 0);
    return v >= 480; // 高速风代理：速度>=480
  }
  function p1b_energyInput(sw){
    const bt = Number(sw?.bt ?? 0);
    const bz = Number(sw?.bz ?? 999);
    return (bt >= 6.5) && (bz <= -2.0);
  }

   // ---------- main run ----------
  async function run(){
    try{
      const lat = Number($("lat")?.value);
      const lon = Number($("lon")?.value);

      if(!Number.isFinite(lat) || !Number.isFinite(lon)){
        setStatusText("请先输入有效经纬度。");
        return;
      }
      if(!window.SunCalc){
        setStatusText("关键计算模块未加载（SunCalc）。");
        return;
      }

      setStatusText("拉取数据中…");
      setStatusDots([
        { level:"warn", text:"NOAA 拉取中" },
        { level:"warn", text:"Kp 拉取中" },
        { level:"warn", text:"云量拉取中" },
        { level:"warn", text:"OVATION 拉取中" },
      ]);

      // 位置门槛（不解释）
      if(abs(lat) < 50){
        safeText($("oneHeroLabel"), "1分 不可观测");
        safeText($("oneHeroMeta"), "—");
        safeText($("swLine"), "V — ｜ Bt — ｜ Bz — ｜ N —");
        safeText($("swMeta"), "—");

        const labels = ["+10m","+20m","+30m","+40m","+50m","+60m"];
        const vals = [0,0,0,0,0,0];
        const cols = vals.map(v => "rgba(255,255,255,.14)");
        renderChart(labels, vals, cols);

        safeText($("threeState"), "静默");
        safeText($("threeHint"), "—");
        safeText($("threeDeliver"), "—");
        safeText($("threeDeliverMeta"), "—");
        safeHTML($("threeClouds"), "云量评分：—");

        safeHTML($("daysBody"), `<tr><td colspan="4" class="muted">不可观测。</td></tr>`);
        setStatusDots([
          { level:"ok", text:"NOAA —" },
          { level:"ok", text:"Kp —" },
          { level:"ok", text:"云量 —" },
          { level:"ok", text:"OVATION —" },
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

      // NOAA 完全不可用：直接停止生成
      const sw = noaa.data;
      if(!sw){
        safeText($("oneHeroLabel"), "—");
        safeText($("oneHeroMeta"), "—");
        safeText($("swLine"), "V — ｜ Bt — ｜ Bz — ｜ N —");
        safeText($("swMeta"), "NOAA 数据不可用");

        const labels = ["+10m","+20m","+30m","+40m","+50m","+60m"];
        const vals = [0,0,0,0,0,0];
        const cols = vals.map(()=> "rgba(255,255,255,.14)");
        renderChart(labels, vals, cols);

        setStatusText("🚫 NOAA 当前不可用（且无缓存），无法生成可靠预测。请稍后重试。");
        return;
      }

      // 近实时行（四舍五入整数）
      const vTxt  = sw.v  == null ? "—" : round0(sw.v);
      const btTxt = sw.bt == null ? "—" : round0(sw.bt);
      const bzTxt = sw.bz == null ? "—" : round0(sw.bz);
      const nTxt  = sw.n  == null ? "—" : round0(sw.n);

      safeText($("swLine"), `V ${vTxt} ｜ Bt ${btTxt} ｜ Bz ${bzTxt} ｜ N ${nTxt}`);
      safeText($("swMeta"), sw.time_tag ? `NOAA 时间：${sw.time_tag}` : "NOAA 时间：—");

      // NOAA 缺字段：强提示弹窗 + 页面状态文案（甩锅 NOAA + 保守估算）
      const missingKeys = Array.isArray(noaa.missing) ? noaa.missing : [];
      const hasMissing = missingKeys.length > 0;

      if(hasMissing){
        const missCN = missingKeys.map(k => (k==="v"?"V":k==="n"?"N":k==="bt"?"Bt":k==="bz"?"Bz":k)).join("、");
        setStatusText(`⚠️ 重要警告`);
        showAlertModal(`
          <div> NOAA 返回数据缺失：<b>${escapeHTML(missCN)}</b></div>
          <div class="mutedLine">下面结果为 <b>缺乏部分数据情况下的保守估算</b>（仅供参考），不是你这边的问题。</div>
        `);
      }else{
        setStatusText("已生成。");
      }

      const mlat = approxMagLat(lat, lon);
      const base10 = baseScoreFromSW(sw, missingKeys);
      const baseDate = now();

      // ---------- 1h: 10min bins ----------
      const labels = [];
      const vals = [];
      const cols = [];
      let heroScore = 1;

      for(let i=0;i<6;i++){
        const d = new Date(baseDate.getTime() + (i+1)*10*60000);
        const gate = obsGate(d, lat, lon);

        // 月角因子（后台）
        const moonAlt = getMoonAltDeg(d, lat, lon);
        const moonF = moonFactorByLat(lat, moonAlt);

        // 磁纬轻微因子（后台）
        const latBoost = clamp((mlat - 55) / 12, 0, 1);
        const latF = 0.85 + latBoost*0.15;

        // 保守外推：逐步衰减
        const decay = Math.pow(0.92, i);
        let c10 = base10 * decay;

        // 门槛/窗口（后台）
        if(gate.hardBlock){
          labels.push(fmtHM(d));
          vals.push(0);
          cols.push("rgba(255,255,255,.14)");
          if(i===0) heroScore = 1;
          continue;
        }else{
          if(!gate.inWindow) c10 *= 0.55;
          c10 *= moonF;
          c10 *= latF;
        }

        c10 = clamp(c10, 0, 10);

        const s5 = score5FromC10(c10); // 1..5
        labels.push(fmtHM(d));
        vals.push(s5);
        cols.push(s5 <= 1 ? "rgba(255,255,255,.20)" : "rgba(91,124,255,.72)");
        if(i===0) heroScore = s5;
      }

      const heroObj = labelByScore5(heroScore);
      safeText($("oneHeroLabel"), `${heroObj.score}分 ${heroObj.t}`);
      safeText(
        $("oneHeroMeta"),
        `本地时间：${fmtYMDHM(baseDate)} ・ OVATION：${ova.ok ? (pickOvation(ova.data) ?? "—") : "—"}`
      );

      renderChart(labels, vals, cols);

      // ---------- 3h：状态机 + 送达 + 云评分 ----------
      let s3 = state3h(sw);
      const del = deliverModel(sw);

      // 3h 同样吃后台门槛（但不解释）
      const g3 = obsGate(baseDate, lat, lon);
      const moonAlt3 = getMoonAltDeg(baseDate, lat, lon);
      const moonF3 = moonFactorByLat(lat, moonAlt3);

      let s3score = s3.score;
      if(g3.hardBlock) s3score = 0;
      else{
        if(!g3.inWindow) s3score *= 0.65;
        s3score *= moonF3;
      }

      if(s3score < 3.2) s3 = { ...s3, state:"静默", hint:"—" };
      else if(s3score < 5.0 && s3.state === "爆发进行中") s3 = { ...s3, state:"爆发概率上升", hint:"—" };

      safeText($("threeState"), s3.state);
      safeText($("threeHint"), s3.hint || "—");
      safeText($("threeDeliver"), `${del.count}/3 成立`);
      safeText($("threeDeliverMeta"), `Bt平台${del.okBt ? "✅" : "⚠️"} ・ 速度背景${del.okV ? "✅" : "⚠️"} ・ 密度结构${del.okN ? "✅" : "⚠️"}`);

      let cloudBest3h = null;
      if(clouds.ok && clouds.data) cloudBest3h = bestCloud3h(clouds.data, baseDate);

      if(cloudBest3h){
        const grade = cloudGradeFromBest(cloudBest3h);
        safeHTML(
          $("threeClouds"),
          `云量评分：<b>${grade}</b>
           <div class="cloudDetail">低云 ${cloudBest3h.low}% ｜ 中云 ${cloudBest3h.mid}% ｜ 高云 ${cloudBest3h.high}%</div>`
        );
      }else{
        safeHTML(
          $("threeClouds"),
          `云量评分：<b>—</b><div class="cloudDetail">低云 —% ｜ 中云 —% ｜ 高云 —%</div>`
        );
      }

      // ---------- 72h：表格 ----------
      const days = next3DaysLocal(baseDate);
      const kpMap = kp.ok ? kpMaxByDay(kp.data) : null;

      const tbody = [];

      days.forEach(d => {
        const key = fmtYMD(d);
        const kpMax = kpMap?.get(key) ?? null;

        // 分数（0-10内部） -> 1-5整数（全站统一）
        const sKp = kpMax == null ? 0.40 : clamp((kpMax - 3.5) / (7.0 - 3.5), 0, 1);
        const sDel = del.count / 3;
        const sCloud = scoreCloudDay(clouds.ok ? clouds.data : null, d);

        let cDay10 = (sKp * 0.48 + sDel * 0.32 + sCloud * 0.20) * 10;

        const nightRatio = estimateNightRatio(d, lat, lon);
        cDay10 *= (0.55 + nightRatio * 0.45);

        const mAlt = getMoonAltDeg(new Date(d.getTime() + 12 * 3600 * 1000), lat, lon);
        const fMoon = soften(moonFactorByLat(lat, mAlt), 0.6);
        cDay10 *= fMoon;

        cDay10 = clamp(cDay10, 0, 10);

        let score5 = Math.round((cDay10 / 10) * 5);
        score5 = clamp(score5, 1, 5);

        const map5 = {
          5: { t: "强烈推荐", cls: "g" },
          4: { t: "值得出门", cls: "g" },
          3: { t: "可蹲守", cls: "b" },
          2: { t: "低概率", cls: "y" },
          1: { t: "不可观测", cls: "r" },
        };
        const lab = map5[score5];

        // 云量更佳点
        let cloudLine = "云量更佳点：—";
        if (clouds.ok && clouds.data) {
          const win = bestCloudHourForDay(clouds.data, d);
          if (win) cloudLine = `云量更佳点：${win.hh}:00（低云≈${win.low}% 中云≈${win.mid}% 高云≈${win.high}%）`;
        }

        // p1a/p1b（高速风/能量输入）
        const p1a = p1a_fastWind(sw) ? 1 : 0;
        const p1b = p1b_energyInput(sw) ? 1 : 0;

        const basis = [
          `• 能量背景：Kp峰值≈${kpMax == null ? "—" : round0(kpMax)}`,
          `• 日冕洞与日冕物质抛射模型：高速风${p1a}/1，能量输入${p1b}/1`,
          `• 太阳风送达能力综合模型：当前 ${del.count}/3（Bt/速度/密度）`,
          `• ${cloudLine}`,
        ].join("<br/>");

        tbody.push(`
          <tr>
            <td>${key}</td>
            <td>${badgeHTML(lab.t, lab.cls)}</td>
            <td>${score5}</td>
            <td class="muted2">${basis}</td>
          </tr>
        `);
      });

      safeHTML($("daysBody"), tbody.join(""));

    }catch(err){
      console.error("[AuroraCapture] run error:", err);
      setStatusText("生成失败：请打开控制台查看错误。");
    }
  }

  // ---------- bootstrap ----------
  function bootstrap(){
    initTabs();
    initAbout();

    if($("lat") && !$("lat").value) $("lat").value = "53.47";
    if($("lon") && !$("lon").value) $("lon").value = "122.35";

    $("btnRun")?.addEventListener("click", run);

    $("btnMag")?.addEventListener("click", ()=>{
      const lat = Number($("lat")?.value);
      const lon = Number($("lon")?.value);
      if(!Number.isFinite(lat) || !Number.isFinite(lon)){
        setStatusText("请先输入有效经纬度。");
        return;
      }
      const m = approxMagLat(lat, lon);
      alert(`磁纬约 ${Math.round(m * 10) / 10}°`);
    });
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
