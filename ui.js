(() => {
  
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

window.UI = {
  $, clamp, round0, abs,
  safeText, safeHTML,
  setStatusDots, setStatusText,
  cacheSet, cacheGet, fmtAge,
  now, fmtYMD, fmtHM, fmtYMDHM,
  escapeHTML,
  renderChart, badgeHTML,
  initTabs, initAbout,
  showAlertModal
};
window.approxMagLat = approxMagLat;  
  // expose data fetchers for app.js (window.Data.fetchKp/fetchClouds/fetchOvation)
window.Data = window.Data || {};
Object.assign(window.Data, { fetchKp, fetchClouds, fetchOvation });
  
})();
