// ui.js (v18) — MUST export window.UI
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

  // ---------- cache ----------
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

  // ---------- status note (short, no details) ----------
  function statusNote(name, state){
    // state: "ok" | "warn" | "bad"
    if(state === "ok") return `${name} ✅`;
    if(state === "warn") return `${name} ⚠️`;
    return `${name} ❌`;
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
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#39;");
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
    // hardBlock: sky too bright for weak aurora (sun higher than -10°)
    // inWindow: the "best" observing window (sun <= -12°)
    return { hardBlock: s > -10, inWindow: s <= -12 };
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

  // ---------- UI bits: tabs / modal / alert ----------
  function initTabs(){
    const tabs = Array.from(document.querySelectorAll(".tab"));
    const panes = Array.from(document.querySelectorAll(".pane"));
    if(!tabs.length || !panes.length) return;

    const activate = (tabId) => {
      tabs.forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
      panes.forEach(p => p.classList.toggle("active", p.id === tabId));
    };

    tabs.forEach(b => {
      b.addEventListener("click", () => activate(b.dataset.tab));
    });
  }

  function initAbout(){
    const modal = $("aboutModal");
    const btn = $("btnAbout");
    const close = $("btnAboutClose");

    if(!modal || !btn) return;

    const open = () => {
      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
    };

    const hide = () => {
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
      try{ btn.focus?.(); }catch(e){}
    };

    btn.addEventListener("click", open);
    close?.addEventListener("click", hide);

    modal.addEventListener("click", (e) => {
      const t = e.target;
      if(t && t.getAttribute && t.getAttribute("data-close") === "1") hide();
    });

    document.addEventListener("keydown", (e) => {
      if(e.key === "Escape") hide();
    });
  }

  function showAlertModal(html){
    const overlay = $("alertOverlay");
    const body = $("alertBody");
    const btnX = $("alertClose");
    const btnOk = $("alertOk");
    if(!overlay || !body) return;

    safeHTML(body, html);

    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");

    const hide = () => {
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
    };
    btnX?.addEventListener("click", hide, { once:true });
    btnOk?.addEventListener("click", hide, { once:true });
  }

  // ---------- chart ----------
  let _chart = null;
  function renderChart(labels, vals, cols){
    const canvas = $("cChart");
    if(!canvas || !window.Chart) return;

    const ctx = canvas.getContext("2d");
    if(!ctx) return;

    // rebuild each time (simple + stable)
    if(_chart){
      try{ _chart.destroy(); }catch(e){}
      _chart = null;
    }

    _chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data: vals,
          backgroundColor: cols,
          borderWidth: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { display:false },
            ticks: {
              // Make time labels more visible (important for decision-making)
              color: "rgba(255,255,255,0.78)",
              font: { size: 12, weight: "600" },
              padding: 10,
              maxRotation: 0,
              minRotation: 0,
            }
          },
          y: {
            min: 0,
            max: 5,
            ticks: {
              stepSize: 1,
              color: "rgba(255,255,255,0.55)",
              font: { size: 11, weight: "500" },
              padding: 6,
            },
            grid: { display:false }
          }
        }
      }
    });
  }

  function badgeHTML(text, cls){
    const safe = escapeHTML(text);
    return `<span class="badge ${cls}">${safe}</span>`;
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
      return { ok:true, note: statusNote("KP", "ok"), data:j };
    }catch(e){
      const c = cacheGet("cache_kp");
      if(c?.value){
        // cache fallback: still usable, but warn
        return { ok:true, note: statusNote("KP", "warn"), data:c.value };
      }
      return { ok:false, note: statusNote("KP", "bad"), data:null };
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
      return { ok:true, note: statusNote("OVATION", "ok"), data:j };
    }catch(e){
      const c = cacheGet("cache_ovation");
      if(c?.value){
        return { ok:true, note: statusNote("OVATION", "warn"), data:c.value };
      }
      return { ok:false, note: statusNote("OVATION", "bad"), data:null };
    }
  }

  async function fetchClouds(lat, lon){
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&hourly=cloudcover_low,cloudcover_mid,cloudcover_high&forecast_days=3&timezone=auto`;
    const k = `cache_clouds_${Number(lat).toFixed(2)}_${Number(lon).toFixed(2)}`;
    try{
      const r = await fetch(url, { cache:"no-store" });
      const t = await r.text();
      if(!t) throw new Error("empty");
      const j = JSON.parse(t);
      cacheSet(k, { lat, lon, j });
      return { ok:true, note: statusNote("云量", "ok"), data:j };
    }catch(e){
      const c = cacheGet(k);
      if(c?.value?.j){
        return { ok:true, note: statusNote("云量", "warn"), data:c.value.j };
      }
      return { ok:false, note: statusNote("云量", "bad"), data:null };
    }
  }

  // ---------- expose ----------
  window.UI = {
    $,
    clamp,
    round0,
    abs,
    safeText,
    safeHTML,
    setStatusDots,
    setStatusText,
    cacheSet,
    cacheGet,
    fmtAge,
    now,
    fmtYMD,
    fmtHM,
    fmtYMDHM,
    escapeHTML,

    // chart / badges
    renderChart,
    badgeHTML,

    // astro helpers used by app.js
    getSunAltDeg,
    getMoonAltDeg,
    obsGate,
    moonFactorByLat,
    soften,

    // ui controls
    initTabs,
    initAbout,
    showAlertModal,
  };

  // Data fetchers kept as window.Data.* for app.js
  window.Data = window.Data || {};
  Object.assign(window.Data, { fetchKp, fetchClouds, fetchOvation });
})();
