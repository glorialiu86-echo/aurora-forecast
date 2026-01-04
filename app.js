// 不在 app.js 里写死远程 AACGMv2 endpoint，避免覆盖 index.html 的配置与引发失败回退。
// 当前采用离线“近似 AACGMv2 语境”的磁纬（model.js 的 approxMagLat / aacgmV2MagLat 已统一为本地计算）。
window.MODEL_CONFIG = window.MODEL_CONFIG || { aacgmEndpoint: "" };

// --- UI proxies (robust against load-order / cache) ---
const uiReady = () =>
  window.UI &&
  typeof window.UI.$ === "function" &&
  typeof window.UI.safeText === "function";

// Fallback to raw DOM APIs when UI.js is not ready (prevents occasional blank renders)
const $ = (id) => (uiReady() ? window.UI.$(id) : document.getElementById(id));

const clamp = (x, a, b) => {
  const v = Number(x);
  if(!Number.isFinite(v)) return v;
  const lo = Number(a), hi = Number(b);
  if(!Number.isFinite(lo) || !Number.isFinite(hi)) return v;
  return Math.min(hi, Math.max(lo, v));
};

const round0 = (x) => {
  const v = Number(x);
  return Number.isFinite(v) ? Math.round(v) : v;
};

const abs = (x) => Math.abs(Number(x));

const safeText = (el, t) => {
  if(!el) return;
  try{
    if(uiReady()) return window.UI.safeText(el, t);
    el.textContent = (t == null ? "" : String(t));
  }catch(_){ /* ignore */ }
};

const safeHTML = (el, h) => {
  if(!el) return;
  try{
    if(uiReady()) return window.UI.safeHTML(el, h);
    el.innerHTML = (h == null ? "" : String(h));
  }catch(_){ /* ignore */ }
};

// --- Solar wind placeholder HTML (.swMain/.swAux layout) ---
const SW_PLACEHOLDER_HTML = `
  <div class="swMain">
    <span><span class="swK">V</span> <span class="swV">—</span></span>
    <span class="swSep">｜</span>
    <span><span class="swK">Bt</span> <span class="swV">—</span></span>
    <span class="swSep">｜</span>
    <span><span class="swK">Bz</span> <span class="swV">—</span></span>
    <span class="swSep">｜</span>
    <span><span class="swK">N</span> <span class="swV">—</span></span>
  </div>
  <div class="swAux">
    <span class="swAuxItem">云 L/M/H —/—/—%</span>
    <span class="swAuxItem">月角 —°</span>
  </div>
`;
// --- status / cache / format helpers (must work even when UI.js is not ready) ---
const setStatusText = (t) => {
  const el = document.getElementById("statusText");
  if(el) el.textContent = (t == null ? "" : String(t));
  if(uiReady() && typeof window.UI.setStatusText === "function"){
    try{ window.UI.setStatusText(t); }catch(_){ /* ignore */ }
  }
};

const setStatusDots = (items) => {
  // Prefer UI renderer when available
  if(uiReady() && typeof window.UI.setStatusDots === "function"){
    try{ window.UI.setStatusDots(items); return; }catch(_){ /* fall through */ }
  }
  // Fallback: render simple text list
  const wrap = document.getElementById("statusDots");
  if(!wrap) return;
  const arr = Array.isArray(items) ? items : [];
  wrap.innerHTML = arr.map(it => {
    const lvl = (it && it.level) ? String(it.level) : "warn";
    const txt = (it && it.text) ? String(it.text) : "";
    return `<span class="dot ${lvl}"></span><span class="dotText">${escapeHTML(txt)}</span>`;
  }).join(" ");
};

const cacheSet = (k, v) => {
  try{
    if(uiReady() && typeof window.UI.cacheSet === "function") return window.UI.cacheSet(k, v);
  }catch(_){ /* ignore */ }
  try{ localStorage.setItem(String(k), JSON.stringify(v)); }catch(_){ /* ignore */ }
};

const cacheGet = (k) => {
  try{
    if(uiReady() && typeof window.UI.cacheGet === "function") return window.UI.cacheGet(k);
  }catch(_){ /* ignore */ }
  try{
    const raw = localStorage.getItem(String(k));
    return raw ? JSON.parse(raw) : null;
  }catch(_){
    return null;
  }
};


const fmtAge = (ms) => {
  const m = Number(ms);
  if(!Number.isFinite(m)) return "";
  const sec = Math.max(0, Math.round(m/1000));
  if(sec < 60) return `${sec}s`;
  const min = Math.round(sec/60);
  if(min < 60) return `${min}m`;
  const hr = Math.round(min/60);
  return `${hr}h`;
};

// --- Simplified status pill helpers ---
const levelFromNote = (note, okFlag = true) => {
  const s = String(note || "");
  if(s.includes("❌")) return "bad";
  if(s.includes("⚠️")) return "warn";
  return okFlag ? "ok" : "bad";
};

const swPill = (rtStatus) => {
  const st = String(rtStatus || "").toUpperCase();
  if(st === "OK") return { level: "ok", text: "太阳风 ✅" };
  if(st === "DEGRADED") return { level: "warn", text: "太阳风 ⚠️" };
  return { level: "bad", text: "太阳风 ❌" };
};

const now = () => {
  try{ if(uiReady() && typeof window.UI.now === "function") return window.UI.now(); }catch(_){ /* ignore */ }
  return new Date();
};

const _pad2 = (n) => String(n).padStart(2, "0");
const fmtYMD = (d) => {
  try{ if(uiReady() && typeof window.UI.fmtYMD === "function") return window.UI.fmtYMD(d); }catch(_){ /* ignore */ }
  const x = (d instanceof Date) ? d : new Date(d);
  return `${x.getFullYear()}-${_pad2(x.getMonth()+1)}-${_pad2(x.getDate())}`;
};
const fmtHM = (d) => {
  try{ if(uiReady() && typeof window.UI.fmtHM === "function") return window.UI.fmtHM(d); }catch(_){ /* ignore */ }
  const x = (d instanceof Date) ? d : new Date(d);
  return `${_pad2(x.getHours())}:${_pad2(x.getMinutes())}`;
};
const fmtYMDHM = (d) => {
  try{ if(uiReady() && typeof window.UI.fmtYMDHM === "function") return window.UI.fmtYMDHM(d); }catch(_){ /* ignore */ }
  const x = (d instanceof Date) ? d : new Date(d);
  return `${fmtYMD(x)} ${fmtHM(x)}`;
};

const escapeHTML = (s) => {
  try{ if(uiReady() && typeof window.UI.escapeHTML === "function") return window.UI.escapeHTML(s); }catch(_){ /* ignore */ }
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const renderChart = (labels, vals, cols) => {
  try{
    if(uiReady() && typeof window.UI.renderChart === "function") window.UI.renderChart(labels, vals, cols);
  }catch(e){
    console.error("[AuroraCapture] renderChart error:", e);
  }
};

const badgeHTML = (text, cls) => {
  try{ if(uiReady() && typeof window.UI.badgeHTML === "function") return window.UI.badgeHTML(text, cls); }catch(_){ /* ignore */ }
  return `<span class="badge ${escapeHTML(cls||"")}">${escapeHTML(text||"")}</span>`;
};

const initTabs = () => { if (uiReady() && typeof window.UI.initTabs === "function") { try{ window.UI.initTabs(); }catch(_){ } } };
const initAbout = () => { if (uiReady() && typeof window.UI.initAbout === "function") { try{ window.UI.initAbout(); }catch(_){ } } };
const initLangToggle = () => { if (uiReady() && typeof window.UI.initLangToggle === "function") { try{ window.UI.initLangToggle(); }catch(_){ } } };

   const showAlertModal = (html) => { if (uiReady() && typeof window.UI.showAlertModal === "function") window.UI.showAlertModal(html); };

   // --- Alert overlay helpers (do not rely on UI.showAlertModal, which may not toggle .show) ---
   function openAlertOverlay(html){
     try{
       const body = document.getElementById("alertBody");
       if(body) body.innerHTML = html;
       const overlay = document.getElementById("alertOverlay");
       if(overlay){
         overlay.classList.add("show");
         overlay.setAttribute("aria-hidden", "false");
       }
     }catch(e){
       console.error("[AuroraCapture] openAlertOverlay error:", e);
     }
   }

   function closeAlertOverlay(){
     try{
       const overlay = document.getElementById("alertOverlay");
       if(overlay){
         overlay.classList.remove("show");
         overlay.setAttribute("aria-hidden", "true");
       }
     }catch(e){
       console.error("[AuroraCapture] closeAlertOverlay error:", e);
     }
   }

   // --- MLAT gating (hard stop + strong warning) ---

   const MLAT_HARD_STOP = 40;   // |MLAT| < 40° : always impossible
   const MLAT_STRONG_WARN = 50; // 40–50° : rare edge cases only

   // Prefer real AACGMv2 MLAT if available; otherwise fall back to dipole approx.
   // Note: window.Model.aacgmV2MagLat may be provided later (async, returns degrees).
   async function getMLAT(lat, lon, atDate = null){
     try{
       if(window.Model && typeof window.Model.aacgmV2MagLat === "function"){
         const v = await window.Model.aacgmV2MagLat(lat, lon, atDate);
         if(Number.isFinite(v)) return v;
       }
     }catch(_){ /* fall through */ }
     try{
       if(window.Model && typeof window.Model.approxMagLat === "function"){
         const v2 = window.Model.approxMagLat(lat, lon);
         if(Number.isFinite(v2)) return v2;
       }
     }catch(_){ /* fall through */ }
     return NaN;
   }

   function openAlertOverlayFull(titleText, html, noteText){
     try{
       const title = document.getElementById("alertTitle");
       const note  = document.getElementById("alertNote");
       if(title && titleText) title.textContent = titleText;
       if(note  && noteText)  note.textContent  = noteText;
       openAlertOverlay(html);
     }catch(e){
       console.error("[AuroraCapture] openAlertOverlayFull error:", e);
       openAlertOverlay(html);
     }
   }

   function mlatGateHtml(absM){
     return (
       `当前位置磁纬约 <b>${absM.toFixed(1)}°</b>（|MLAT|，近似值）。<br>` +
       `当 <b>|MLAT| &lt; ${MLAT_STRONG_WARN}°</b> 时，极光可见性高度依赖<strong>极端磁暴</strong>与<strong>北向开阔地平线</strong>，不适合“常规出门拍”的决策。<br>` +
       `建议：尽量提高磁纬（靠近/进入极光椭圆边缘）再使用本工具。`
     );
   }

   function showMlatHardStop(mlat){
     const absM = Math.abs(mlat);
     openAlertOverlayFull(
       "⚠️ 磁纬限制：不可观测",
       (
         `当前位置磁纬约 <b>${absM.toFixed(1)}°</b>（|MLAT|，近似值）。<br>` +
         `当 <b>|MLAT| &lt; ${MLAT_HARD_STOP}°</b> 时，极光几乎不可能到达你的可见范围。<br>` +
         `这是硬性地理限制：无论 Kp / Bz / 速度如何，都不建议投入等待与拍摄。`
       ),
       "这是硬性地理限制，不是数据缺失或模型不确定性。"
     );
   }

   function showMlatStrongWarn(mlat){
     const absM = Math.abs(mlat);
     openAlertOverlayFull(
       "⚠️ 磁纬较低：仅极端事件才可能",
       mlatGateHtml(absM),
       "提示：你仍可继续生成，但请把它当作“极端磁暴边缘赌局”。"
     );
   }

   // Wait until the user dismisses the alert overlay (OK / X). Used for strong-warning gate.
   function waitAlertDismiss(){
     return new Promise((resolve) => {
       const ok = document.getElementById("alertOk");
       const x  = document.getElementById("alertClose");
       let done = false;
       const finish = () => {
         if(done) return;
         done = true;
         resolve();
       };
       // Resolve on either button click (existing handlers will hide overlay)
       if(ok) ok.addEventListener("click", finish, { once: true });
       if(x)  x.addEventListener("click", finish, { once: true });
       // Fallback: if overlay is not present, just continue.
       if(!ok && !x) finish();
     });
   }

   // --- astro/model helpers from UI.js (must be proxied too) ---
   const obsGate = (d, lat, lon) =>
     (uiReady() && typeof window.UI.obsGate === "function")
       ? window.UI.obsGate(d, lat, lon)
       : { hardBlock: false, inWindow: true };
   
   const getMoonAltDeg = (d, lat, lon) =>
     (uiReady() && typeof window.UI.getMoonAltDeg === "function")
       ? window.UI.getMoonAltDeg(d, lat, lon)
       : -999;

   const getSunAltDeg = (d, lat, lon) =>
     (uiReady() && typeof window.UI.getSunAltDeg === "function")
       ? window.UI.getSunAltDeg(d, lat, lon)
       : -999;
   
   const moonFactorByLat = (lat, moonAltDeg) =>
     (uiReady() && typeof window.UI.moonFactorByLat === "function")
       ? window.UI.moonFactorByLat(lat, moonAltDeg)
       : 1.0;
   
   const soften = (f, ratio = 0.6) =>
     (uiReady() && typeof window.UI.soften === "function")
       ? window.UI.soften(f, ratio)
       : f;

// ===============================
// C-score helpers (1~5) for consistent coloring across 1h/3h/72h
// ===============================
function cClass(c){
  const n = Math.max(1, Math.min(5, Math.round(Number(c) || 1)));
  return `c${n}`;
}

function cColor(c){
  try{
    const n = Math.max(1, Math.min(5, Math.round(Number(c) || 1)));
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(`--c${n}`)
      .trim();
    return v || "rgba(255,255,255,.20)";
  }catch(_){
    return "rgba(255,255,255,.20)";
  }
}

// ===============================
// Language: conclusion translation (EN only; CN remains unchanged)
// ===============================
function getLangSafe(){
  try{
    const g = window.UI?.getLang;
    if(typeof g === "function"){
      const v = g();
      return (v === "en") ? "en" : "cn";
    }
  }catch(_){ /* ignore */ }
  return "cn";
}

function translateConclusionTextIfEN(cnPhrase){
  const cn = String(cnPhrase || "").trim() || "不可观测";
  if(getLangSafe() !== "en") return cn;

  const map = {
    "强烈推荐": "Highly Recommended",
    "值得出门": "Worth Going Out",
    "可蹲守": "Worth Waiting",
    "低概率": "Low Probability",
    "不可观测": "Not Observable",
  };

  return map[cn] || cn || "Not Observable";
}

// ===============================
// Language: dynamic text translation (EN only; CN remains unchanged)
// ===============================
function _tIfEN(cnText, enText){
  return (getLangSafe() === "en") ? (enText || cnText) : cnText;
}

function translateReasonIfEN(cnText){
  const cnRaw = String(cnText || "");
  const cn = cnRaw.trim();
  if(getLangSafe() !== "en") return cn;

  // Exact/near-exact mappings first (stable, no surprises)
  const map = {
    // energy / coupling
    "能量注入弱，难以形成有效极光": "Weak energy coupling. Effective aurora is unlikely.",
    "能量注入偏弱，难以形成有效极光": "Weak energy coupling. Effective aurora is unlikely.",
    "能量输入偏弱，难以形成有效极光": "Weak energy coupling. Effective aurora is unlikely.",
    "能量注入弱": "Weak energy coupling.",

    // bright sky (sun/moon merged)
    "天色偏亮，微弱极光难以分辨": "Bright sky. Faint aurora is hard to discern.",
    "天空偏亮，微弱极光难以分辨": "Bright sky. Faint aurora is hard to discern.",
    "天色偏亮": "Bright sky.",

    // clouds
    "天空被云层遮挡，不利于观测": "Cloud cover blocks the sky.",
    "天空被云层遮挡": "Cloud cover blocks the sky.",
    "云层遮挡，不利于观测": "Cloud cover blocks the sky.",
    "云层遮挡": "Cloud cover blocks the sky.",
    "云量过高，不利于观测": "Too cloudy for reliable viewing.",
    "云量过高": "Too cloudy for reliable viewing.",

    // generic / fallback strings sometimes produced by future edits
    "不可观测": "Not observable.",
    "—": "—",
  };

  if(map[cn]) return map[cn];

  // Keyword-based fallbacks (cover future phrasing changes without touching CN path)
  const s = cn;

  // Clouds
  if(s.includes("云")){
    // If wording hints at heavy cloud / blocking
    if(s.includes("遮挡") || s.includes("过高") || s.includes("很厚") || s.includes("覆盖")){
      return "Cloud cover blocks the sky.";
    }
    return "Cloud conditions are unfavorable.";
  }

  // Bright sky (sun/moon/twilight)
  if(s.includes("天色") || s.includes("天空") || s.includes("偏亮") || s.includes("月") || s.includes("太阳") || s.includes("晨") || s.includes("暮")){
    return "Bright sky. Faint aurora is hard to discern.";
  }

  // Energy / coupling / geomagnetic drive
  if(s.includes("能量") || s.includes("注入") || s.includes("输入") || s.includes("耦合") || s.includes("Bz") || s.includes("BT") || s.includes("Bt") || s.includes("南") || s.includes("北")){
    return "Weak geomagnetic driving. Effective aurora is unlikely.";
  }

  // Default: keep CN (better than wrong EN)
  return cn;
}

function primaryPrefixIfEN(){
  return (getLangSafe() === "en") ? "Primary factor: " : "主要影响因素：";
}

function actionNote1h(score5, gate){
  const s = Math.max(1, Math.min(5, Math.round(Number(score5) || 1)));
  // hardBlock also means not worth investing now
  if(gate && gate.hardBlock) return _tIfEN("当前时段不建议投入。", "Not recommended to invest effort now.");
  if(s <= 2) return _tIfEN("当前时段不建议投入。", "Not recommended to invest effort now.");
  if(s === 3) return _tIfEN("可尝试短时观测。", "Try a short watch.");
  return _tIfEN("值得出门尝试。", "Worth going out to try.");
}

function actionNote72h(score5){
  const s = Math.max(1, Math.min(5, Math.round(Number(score5) || 1)));
  if(s <= 2) return _tIfEN("暂不建议为此规划行程。", "Not recommended to plan a trip for this yet.");
  if(s === 3) return _tIfEN("可提前关注，临近再决定。", "Keep an eye on it; decide closer to the date.");
  return _tIfEN("值得提前规划行程。", "Worth planning ahead.");
}

// ===============================
// Cloud + 72h helper functions (stop-gap, stable)
// ===============================

function _omGetHourlyCloudArrays(openMeteoJson){
  const h = openMeteoJson?.hourly;
  if(!h) return null;

  const times = Array.isArray(h.time) ? h.time : [];
  const low  = Array.isArray(h.cloudcover_low)  ? h.cloudcover_low  : [];
  const mid  = Array.isArray(h.cloudcover_mid)  ? h.cloudcover_mid  : [];
  const high = Array.isArray(h.cloudcover_high) ? h.cloudcover_high : [];

  if(!times.length) return null;
  return { times, low, mid, high };
}

function _cloudTotal(low, mid, high){
  const a = Number(low), b = Number(mid), c = Number(high);
  // 如果有缺项，返回 Infinity，避免误判成“云量很棒”
  if(!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return Infinity;
  return (a + b + c) / 3;
}

    // 取 “未来3小时内” 云量最好的那个小时点（止血版：简单、稳）
    function bestCloud3h(openMeteoJson, baseDate){
      const pack = _omGetHourlyCloudArrays(openMeteoJson);
      if(!pack) return null;

      const t0 = baseDate instanceof Date ? baseDate.getTime() : Date.now();
      const t1 = t0 + 3 * 3600 * 1000;

      let best = null;
      let bestTotal = Infinity;

      for(let i=0;i<pack.times.length;i++){
        const ti = Date.parse(pack.times[i]);
        if(!Number.isFinite(ti)) continue;
        if(ti < t0 || ti > t1) continue;

        const low = pack.low[i], mid = pack.mid[i], high = pack.high[i];
        const total = _cloudTotal(low, mid, high);
        if(total < bestTotal){
          bestTotal = total;
          best = {
            ts: pack.times[i],
            low: Math.round(Number(low)),
            mid: Math.round(Number(mid)),
            high: Math.round(Number(high)),
            total: bestTotal
          };
        }
      }

      return best;
    }

    // 取最接近当前时间的“小时云量三层”(low/mid/high)
    function cloudNow3layer(openMeteoJson, baseDate){
      const pack = _omGetHourlyCloudArrays(openMeteoJson);
      if(!pack) return null;

      const t0 = baseDate instanceof Date ? baseDate.getTime() : Date.now();

      let bestI = -1;
      let bestD = Infinity;

      for(let i=0;i<pack.times.length;i++){
        const ti = Date.parse(pack.times[i]);
        if(!Number.isFinite(ti)) continue;
        const d = Math.abs(ti - t0);
        if(d < bestD){ bestD = d; bestI = i; }
      }

      if(bestI < 0) return null;

      const low  = Number(pack.low[bestI]);
      const mid  = Number(pack.mid[bestI]);
      const high = Number(pack.high[bestI]);

      if(!Number.isFinite(low) || !Number.isFinite(mid) || !Number.isFinite(high)) return null;

      return {
        ts: pack.times[bestI],
        low: Math.round(low),
        mid: Math.round(mid),
        high: Math.round(high)
      };
    }

      // 云量评分（止血版）：按总云量分档
      function cloudGradeFromBest(best){
        if(!best || !Number.isFinite(best.total)) return "—";
        const t = best.total;
        if(t <= 30) return "优";
        if(t <= 65) return "中";
        return "差";
      }
      
      // 未来3天（本地日历日）
      function next3DaysLocal(baseDate){
        const d0 = baseDate instanceof Date ? new Date(baseDate) : new Date();
        d0.setHours(0,0,0,0);
        return [0,1,2].map(k => new Date(d0.getTime() + k*24*3600*1000));
      }
      
      // Kp 预报 → Map(dateKey -> maxKp)
      function kpMaxByDay(kpJson){
        // NOAA kp forecast json: first row header, others: [time_tag, kp, ...]
        if(!Array.isArray(kpJson) || kpJson.length < 2) return null;
      
        const map = new Map();
        for(let i=1;i<kpJson.length;i++){
          const row = kpJson[i];
          if(!Array.isArray(row) || row.length < 2) continue;
      
          const t = Date.parse(row[0]);
          const kp = Number(row[1]);
      
          if(!Number.isFinite(t) || !Number.isFinite(kp)) continue;
      
          const key = (typeof fmtYMD === "function")
            ? fmtYMD(new Date(t))
            : new Date(t).toISOString().slice(0,10);
      
          const prev = map.get(key);
          if(prev == null || kp > prev) map.set(key, kp);
        }
        return map;
      }
      
      // 找某一天云量最好的小时点（用于 72h 表格里的“云量更佳点”）
      function bestCloudHourForDay(openMeteoJson, dayDate){
        const pack = _omGetHourlyCloudArrays(openMeteoJson);
        if(!pack) return null;
      
        const d0 = dayDate instanceof Date ? new Date(dayDate) : new Date();
        d0.setHours(0,0,0,0);
        const start = d0.getTime();
        const end = start + 24*3600*1000;
      
        let best = null;
        let bestTotal = Infinity;
      
        for(let i=0;i<pack.times.length;i++){
          const ti = Date.parse(pack.times[i]);
          if(!Number.isFinite(ti)) continue;
          if(ti < start || ti >= end) continue;
      
          const low = pack.low[i], mid = pack.mid[i], high = pack.high[i];
          const total = _cloudTotal(low, mid, high);
      
          if(total < bestTotal){
            bestTotal = total;
            const hh = new Date(ti).getHours();
            best = {
              hh,
              low: Math.round(Number(low)),
              mid: Math.round(Number(mid)),
              high: Math.round(Number(high)),
              total: bestTotal
            };
          }
        }
      
        return best;
      }
      
      // 当天云量 → 0~1 分数（越晴越高）
      function scoreCloudDay(openMeteoJson, dayDate){
        const win = bestCloudHourForDay(openMeteoJson, dayDate);
        if(!win || !Number.isFinite(win.total)) return 0.35; // 无数据时保守中低
        const t = win.total;
        if(t <= 30) return 1.0;
        if(t <= 60) return 0.65;
        if(t <= 85) return 0.35;
        return 0.15;
      }
      
      // 夜晚占比（止血版：用 SunCalc 算“日落到次日日出” / 24h，算不出就给个默认）
      function estimateNightRatio(dayDate, lat, lon){
        try{
          if(!window.SunCalc) return 0.70;
      
          const d0 = new Date(dayDate);
          d0.setHours(12,0,0,0); // 用当天中午求 times 稳一点
      
          const t = SunCalc.getTimes(d0, lat, lon);
          const sunset = t?.sunset?.getTime?.() ? t.sunset.getTime() : null;
      
          const d1 = new Date(d0.getTime() + 24*3600*1000);
          const t1 = SunCalc.getTimes(d1, lat, lon);
          const sunrise = t1?.sunrise?.getTime?.() ? t1.sunrise.getTime() : null;
      
          if(!Number.isFinite(sunset) || !Number.isFinite(sunrise)) return 0.70;
      
          const nightMin = Math.max(0, (sunrise - sunset) / 60000);
          return clamp(nightMin / 1440, 0.10, 1.00);
        }catch(_){
          return 0.70;
        }
      }

// ---------- btnGeo success flash (no color change / no animation) ----------
let __geoBtnResetTimer = null;

function flashGeoButtonSuccess(){
  const btn = $("btnGeo");
  if(!btn) return;

  // remember original label once
  if(!btn.dataset.labelOriginal){
    btn.dataset.labelOriginal = btn.textContent || "📍获取位置";
  }

  // clear pending reset if user clicks again
  if(__geoBtnResetTimer) clearTimeout(__geoBtnResetTimer);

  // temporary label (no class change -> no color jump)
  btn.textContent = "已获取 ✓";

  // restore after 1.5s
  __geoBtnResetTimer = setTimeout(() => {
    btn.textContent = btn.dataset.labelOriginal || "📍获取位置";
    __geoBtnResetTimer = null;
  }, 1500);
}

// ---------- geolocation (fill lat/lon) ----------
function fillCurrentLocation(){
  try{
    if(!navigator.geolocation){
      openAlertOverlayFull(
        "📍 无法获取定位",
        "当前浏览器不支持定位功能。<br><br>你可以手动输入经纬度。",
        "可选方案：手动输入 / 奥维地图 / 在线经纬度查询工具。"
      );
      return;
    }

    setStatusText("📍 正在获取当前位置…");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        try{
          const coords = pos && pos.coords ? pos.coords : null;
          const latitude = coords ? Number(coords.latitude) : NaN;
          const longitude = coords ? Number(coords.longitude) : NaN;
          const accuracy = coords ? Number(coords.accuracy) : NaN;

          if(!Number.isFinite(latitude) || !Number.isFinite(longitude)){
            setStatusText("⚠️ 定位返回无效坐标");
            openAlertOverlayFull(
              "📍 定位失败",
              "定位返回的经纬度无效，请重试或手动输入。",
              "可选方案：手动输入 / 奥维地图 / 在线经纬度查询工具。"
            );
            return;
          }

          // Fill inputs (keep enough precision for users; 5 decimals ≈ 1.1m lat)
          const latEl = $("lat");
          const lonEl = $("lon");
          if(latEl) latEl.value = latitude.toFixed(5);
          if(lonEl) lonEl.value = longitude.toFixed(5);

          const accTxt = Number.isFinite(accuracy) ? `（精度约 ${Math.round(accuracy)}m）` : "";
          setStatusText(`已获取当前位置 ${accTxt}`);
          flashGeoButtonSuccess();
        }catch(e){
          console.error("[AuroraCapture] geolocation success handler error:", e);
          setStatusText("⚠️ 定位处理异常");
          openAlertOverlayFull(
            "📍 定位失败",
            "定位成功返回，但处理坐标时发生异常。请重试或手动输入。",
            "可选方案：手动输入 / 奥维地图 / 在线经纬度查询工具。"
          );
        }
      },
      (err) => {
        const code = err && typeof err.code === "number" ? err.code : null;

        let reason = "定位失败，请重试或手动输入。";
        if(code === 1) reason = "你拒绝了定位授权。请在浏览器设置中允许定位后重试。";
        else if(code === 2) reason = "暂时无法获取定位（信号弱/系统未开启定位服务）。";
        else if(code === 3) reason = "获取定位超时，请稍后重试。";

        setStatusText("⚠️ 无法获取定位");
        openAlertOverlayFull(
          "📍 无法获取定位",
          reason,
          "可选方案：手动输入 / 奥维地图 / 在线经纬度查询工具。"
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000
      }
    );
  }catch(e){
    console.error("[AuroraCapture] geolocation error:", e);
    setStatusText("⚠️ 无法获取定位");
    openAlertOverlayFull(
      "📍 无法获取定位",
      "获取定位时发生异常，请重试或手动输入。",
      "可选方案：手动输入 / 奥维地图 / 在线经纬度查询工具。"
    );
  }
}

    // ===============================
    // Realtime solar-wind (B-route): keep generating unless catastrophic
    // Sources:
    //   1) NOAA RTSW 1m (more continuous, noisier)  -> realtime feel + continuity
    //   2) Local mirrored NOAA products (mag/plasma)-> steadier baseline
    //   3) Last-known-good cache                    -> outage fallback
    //   4) FMI (reference)                          -> hint when degraded/outage
    // ===============================

    const NOAA_RTSW_MAG_1M = "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json";
    const NOAA_RTSW_WIND_1M = "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json";
    const FMI_R_INDEX = "https://space.fmi.fi/MIRACLE/RWC/data/r_index_latest_en.json";

    const LKG_CACHE_KEY = "ac_last_good_sw_v1";

    const _num = (x) => {
      const v = Number(x);
      return Number.isFinite(v) ? v : null;
    };

    const _parseTimeLike = (v) => {
      if(!v) return null;
      const t = Date.parse(v);
      return Number.isFinite(t) ? t : null;
    };

    const _pick = (obj, keys) => {
      if(!obj) return null;
      for(const k of keys){
        if(obj[k] != null) return obj[k];
      }
      return null;
    };

    async function _fetchJson(url, timeoutMs = 12000){
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try{
        const res = await fetch(url, { cache:"no-store", signal: ctrl.signal });
        if(!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      }finally{
        clearTimeout(timer);
      }
    }

    function _latestValidFromNoaaTable(noaaTable, want){
      // noaaTable: [headerRow, ...dataRows]
      try{
        if(!Array.isArray(noaaTable) || noaaTable.length < 2) return null;
        const header = noaaTable[0];
        if(!Array.isArray(header)) return null;

        const idxT = header.indexOf(want.time);
        if(idxT < 0) return null;

        const idx = {};
        for(const [outKey, candKeys] of Object.entries(want.fields)){
          let found = -1;
          for(const ck of candKeys){
            const j = header.indexOf(ck);
            if(j >= 0){ found = j; break; }
          }
          idx[outKey] = found;
        }

        for(let i = noaaTable.length - 1; i >= 1; i--){
          const row = noaaTable[i];
          if(!Array.isArray(row)) continue;

          const tsStr = row[idxT];
          const ts = _parseTimeLike(tsStr);
          if(!Number.isFinite(ts)) continue;

          const out = { ts: tsStr };
          let hasAny = false;

          for(const [k, j] of Object.entries(idx)){
            if(j < 0) continue;
            const v = _num(row[j]);
            if(v != null){ out[k] = v; hasAny = true; }
          }

          if(hasAny) return out;
        }
        return null;
      }catch(_){
        return null;
      }
    }

    async function _fetchRtsw1m(){
      const out = {
        ok:false,
        src:"rtsw-1m",
        imf:{ bt_nT:null, bz_gsm_nT:null, ts:null, ageMin: Infinity, bz15_nT:null, bz30_nT:null, dbz15_nT:null, dbz30_nT:null },
        solarWind:{ speed_km_s:null, density_cm3:null, ts:null, ageMin: Infinity }
      };

      try{
        const [magJ, windJ] = await Promise.all([
          _fetchJson(NOAA_RTSW_MAG_1M, 12000),
          _fetchJson(NOAA_RTSW_WIND_1M, 12000)
        ]);

        const pickLast = (j) => {
          if(Array.isArray(j) && j.length) return j[j.length-1];
          if(j && Array.isArray(j.data) && j.data.length) return j.data[j.data.length-1];
          return null;
        };

        const magLast = pickLast(magJ);
        const windLast = pickLast(windJ);

        // --- Trend (dBz/dt) from RTSW 1m history ---
        const pickBzBack = (arr, minutesBack) => {
          try{
            const a = Array.isArray(arr) ? arr : (Array.isArray(arr?.data) ? arr.data : null);
            if(!a || !a.length) return null;

            // approximate: use latest timestamp and scan backward to nearest target time
            const last = a[a.length - 1];
            const tLastStr = _pick(last, ["time_tag","time","timestamp","datetime","date_time"]);
            const tLast = _parseTimeLike(tLastStr);
            if(!Number.isFinite(tLast)) return null;

            const target = tLast - minutesBack * 60000;
            let best = null;
            let bestD = Infinity;

            // scan from end backward (faster)
            for(let i = a.length - 1; i >= 0; i--){
              const row = a[i];
              const tsStr = _pick(row, ["time_tag","time","timestamp","datetime","date_time"]);
              const t = _parseTimeLike(tsStr);
              if(!Number.isFinite(t)) continue;

              // stop early if we are much older than target (array ordered by time)
              if(t < target - 10*60000) break;

              const d = Math.abs(t - target);
              if(d < bestD){
                const bzv = _num(_pick(row, ["bz_gsm","bz_gsm_nT","bz","bz_nt","Bz"]));
                if(bzv != null){
                  bestD = d;
                  best = bzv;
                }
              }
            }
            return best;
          }catch(_){
            return null;
          }
        };

        const bz15 = pickBzBack(magJ, 15);
        const bz30 = pickBzBack(magJ, 30);

        const magTs = _pick(magLast, ["time_tag","time","timestamp","datetime","date_time"]);
        const bt = _num(_pick(magLast, ["bt","bt_nT","bt_nt","B_t","total"]));
        const bz = _num(_pick(magLast, ["bz_gsm","bz_gsm_nT","bz","bz_nt","Bz"]));

        const windTs = _pick(windLast, ["time_tag","time","timestamp","datetime","date_time"]);
        const v = _num(_pick(windLast, ["speed","speed_km_s","v","V","flow_speed"]));
        const n = _num(_pick(windLast, ["density","density_cm3","n","N","proton_density"]));

        const nowMs = Date.now();
        const tMag = _parseTimeLike(magTs);
        const tWind = _parseTimeLike(windTs);

        if(bt != null) out.imf.bt_nT = bt;
        if(bz != null) out.imf.bz_gsm_nT = bz;
        if(bz15 != null) out.imf.bz15_nT = bz15;
        if(bz30 != null) out.imf.bz30_nT = bz30;
        if(bz != null && bz15 != null) out.imf.dbz15_nT = (bz - bz15);
        if(bz != null && bz30 != null) out.imf.dbz30_nT = (bz - bz30);
        if(magTs) out.imf.ts = magTs;
        if(Number.isFinite(tMag)) out.imf.ageMin = (nowMs - tMag) / 60000;

        if(v != null) out.solarWind.speed_km_s = v;
        if(n != null) out.solarWind.density_cm3 = n;
        if(windTs) out.solarWind.ts = windTs;
        if(Number.isFinite(tWind)) out.solarWind.ageMin = (nowMs - tWind) / 60000;

        const okMag = (out.imf.bt_nT != null || out.imf.bz_gsm_nT != null) && Number.isFinite(out.imf.ageMin);
        const okWind = (out.solarWind.speed_km_s != null || out.solarWind.density_cm3 != null) && Number.isFinite(out.solarWind.ageMin);
        out.ok = okMag || okWind;

        return out;
      }catch(e){
        out.err = String(e?.message || e);
        return out;
      }
    }

    async function _fetchMirrorProducts(){
      const out = {
        ok:false,
        src:"mirror-products",
        imf:{ bt_nT:null, bz_gsm_nT:null, ts:null, ageMin: Infinity },
        solarWind:{ speed_km_s:null, density_cm3:null, ts:null, ageMin: Infinity }
      };

      try{
        const [magWrap, plasmaWrap] = await Promise.all([
          _fetchJson(`./noaa/mag.json?t=${Date.now()}`, 12000),
          _fetchJson(`./noaa/plasma.json?t=${Date.now()}`, 12000),
        ]);

        const magLast = _latestValidFromNoaaTable(magWrap?.noaa, {
          time:"time_tag",
          fields:{
            bt:["bt","Bt","bt_nT","bt_nt"],
            bz:["bz_gsm","Bz","bz","bz_gsm_nT","bz_nt"]
          }
        });

        const plasmaLast = _latestValidFromNoaaTable(plasmaWrap?.noaa, {
          time:"time_tag",
          fields:{
            v:["speed","V","speed_km_s","flow_speed"],
            n:["density","N","density_cm3","proton_density"]
          }
        });

        const nowMs = Date.now();

        if(magLast){
          if(magLast.bt != null) out.imf.bt_nT = magLast.bt;
          if(magLast.bz != null) out.imf.bz_gsm_nT = magLast.bz;
          out.imf.ts = magLast.ts;
          const t = _parseTimeLike(magLast.ts);
          if(Number.isFinite(t)) out.imf.ageMin = (nowMs - t) / 60000;
        }

        if(plasmaLast){
          if(plasmaLast.v != null) out.solarWind.speed_km_s = plasmaLast.v;
          if(plasmaLast.n != null) out.solarWind.density_cm3 = plasmaLast.n;
          out.solarWind.ts = plasmaLast.ts;
          const t = _parseTimeLike(plasmaLast.ts);
          if(Number.isFinite(t)) out.solarWind.ageMin = (nowMs - t) / 60000;
        }

        const hasAny =
          out.imf.bt_nT != null || out.imf.bz_gsm_nT != null ||
          out.solarWind.speed_km_s != null || out.solarWind.density_cm3 != null;

        out.ok = hasAny && (Number.isFinite(out.imf.ageMin) || Number.isFinite(out.solarWind.ageMin));
        return out;
      }catch(e){
        out.err = String(e?.message || e);
        return out;
      }
    }

    async function _fetchFmiHint(){
      try{
        const j = await _fetchJson(FMI_R_INDEX, 12000);

        let bestProb = null;
        const scan = (node) => {
          if(!node) return;
          if(Array.isArray(node)) return node.forEach(scan);
          if(typeof node !== "object") return;

          const prob = _num(_pick(node, ["probability","prob","AuroraProbability","aurora_probability"]));
          if(prob != null) bestProb = (bestProb == null ? prob : Math.max(bestProb, prob));

          for(const v of Object.values(node)) scan(v);
        };
        scan(j);

        return { ok: bestProb != null, prob: bestProb };
      }catch(e){
        return { ok:false, err:String(e?.message || e) };
      }
    }

    function _mergeRt(primary, secondary){
      const out = JSON.parse(JSON.stringify(primary || {}));
      if(!out.imf) out.imf = { bt_nT:null, bz_gsm_nT:null, ts:null, ageMin:Infinity };
      if(!out.solarWind) out.solarWind = { speed_km_s:null, density_cm3:null, ts:null, ageMin:Infinity };

      const fill = (dst, src, k) => {
        if(dst[k] == null && src && src[k] != null) dst[k] = src[k];
      };

      if(secondary?.imf){
        fill(out.imf, secondary.imf, "bt_nT");
        fill(out.imf, secondary.imf, "bz_gsm_nT");
        if(!out.imf.ts && secondary.imf.ts) out.imf.ts = secondary.imf.ts;
        if(!Number.isFinite(out.imf.ageMin) && Number.isFinite(secondary.imf.ageMin)) out.imf.ageMin = secondary.imf.ageMin;
      }

      if(secondary?.solarWind){
        fill(out.solarWind, secondary.solarWind, "speed_km_s");
        fill(out.solarWind, secondary.solarWind, "density_cm3");
        if(!out.solarWind.ts && secondary.solarWind.ts) out.solarWind.ts = secondary.solarWind.ts;
        if(!Number.isFinite(out.solarWind.ageMin) && Number.isFinite(secondary.solarWind.ageMin)) out.solarWind.ageMin = secondary.solarWind.ageMin;
      }

      return out;
    }

    function _statusFromAge(rt){
      const magAge = Number(rt?.imf?.ageMin);
      const plaAge = Number(rt?.solarWind?.ageMin);

      const magOk = Number.isFinite(magAge) && magAge <= 30;
      const plaOk = Number.isFinite(plaAge) && plaAge <= 30;

      if(magOk && plaOk) return "OK";

      const hasAny =
        rt?.imf?.bt_nT != null || rt?.imf?.bz_gsm_nT != null ||
        rt?.solarWind?.speed_km_s != null || rt?.solarWind?.density_cm3 != null;

      if(hasAny) return "DEGRADED";
      return "OUTAGE";
    }

    function _isCatastrophicOutage(rt){
      const magAge = Number(rt?.imf?.ageMin);
      const plaAge = Number(rt?.solarWind?.ageMin);
      const magBad = !Number.isFinite(magAge) || magAge > 720; // 12h
      const plaBad = !Number.isFinite(plaAge) || plaAge > 720; // 12h
      return magBad && plaBad;
    }

    function _cacheLastGood(sw, rt){
      try{
        cacheSet(LKG_CACHE_KEY, { at: Date.now(), sw, rt });
      }catch(_){}
    }

    function _loadLastGood(){
      try{
        return cacheGet(LKG_CACHE_KEY);
      }catch(_){
        return null;
      }
    }

    async function getRealtimeStateSmart(){
      const [rtsw, mir, fmi] = await Promise.all([
        _fetchRtsw1m(),
        _fetchMirrorProducts(),
        _fetchFmiHint()
      ]);

      // Prefer mirror-products, merge rtsw to reduce dead air
      let merged = _mergeRt(mir, rtsw);

      let status = _statusFromAge(merged);
      if(status !== "OUTAGE" && _isCatastrophicOutage(merged)) status = "OUTAGE";

      // OUTAGE: try last-known-good
      const lkg = _loadLastGood();
      if(status === "OUTAGE" && lkg?.rt){
        merged = _mergeRt(merged, lkg.rt);
      }

      merged.status = status;
      merged.source = {
        primary: mir?.ok ? "mirror-products" : (rtsw?.ok ? "rtsw-1m" : "none"),
        merged: [mir?.ok ? "mirror-products" : null, rtsw?.ok ? "rtsw-1m" : null].filter(Boolean)
      };
      merged.fmi = fmi;

      // cache when usable and not outage
      const sw = {
        v: merged?.solarWind?.speed_km_s ?? null,
        n: merged?.solarWind?.density_cm3 ?? null,
        bt: merged?.imf?.bt_nT ?? null,
        bz: merged?.imf?.bz_gsm_nT ?? null,
        time_tag: merged?.imf?.ts || merged?.solarWind?.ts || null
      };
      const hasSome = sw.v!=null || sw.n!=null || sw.bt!=null || sw.bz!=null;
      if(hasSome && status !== "OUTAGE") _cacheLastGood(sw, merged);

      return merged;
    }

   // ---------- main run ----------
  async function run(){
    try{
      const lat = Number($("lat")?.value);
      const lon = Number($("lon")?.value);

      if(!Number.isFinite(lat) || !Number.isFinite(lon)){
        setStatusText("请先输入有效经纬度。");
        openAlertOverlayFull(
          "⚠️ 经纬度输入无效",
          "请输入数字格式的纬度/经度。<br>纬度范围：<b>-90° ～ +90°</b>；经度范围：<b>-180° ～ +180°</b>。",
          "示例：纬度 53.47，经度 122.35"
        );
        return;
      }

      // Range guard (hard)
      if(lat < -90 || lat > 90 || lon < -180 || lon > 180){
        setStatusText("⚠️ 经纬度超出范围");
        openAlertOverlayFull(
          "⚠️ 经纬度超出范围",
          `你输入的是：<b>Latitude ${lat}</b>，<b>Longitude ${lon}</b>。<br>` +
            `允许范围：<br>` +
            `纬度（Latitude）：<b>-90° ～ +90°</b><br>` +
            `经度（Longitude）：<b>-180° ～ +180°</b>` ,
          "请修正后再点击生成。"
        );
        return;
      }
      if(!window.SunCalc){
        setStatusText("关键计算模块未加载（SunCalc）。");
        return;
      }

      const baseDate = now();

      setStatusText("拉取数据中…");
      setStatusDots([
        { level:"warn", text:"太阳风 …" },
        { level:"warn", text:"KP …" },
        { level:"warn", text:"云量 …" },
        { level:"warn", text:"OVATION …" },
      ]);

      // Ensure placeholder layout before any run
      safeHTML($("swLine"), SW_PLACEHOLDER_HTML);
      safeText($("swMeta"), "—");

      // 先计算磁纬（用于“硬限制/强警告”门槛；避免误伤北京这类低地理纬度但仍可能事件）
      const mlat = await getMLAT(lat, lon, baseDate);
      const absMlat = Math.abs(mlat);

      // --- Aurora Oval (backend-only): soft spatial constraint ---
      // 只做“温和降级”，不做一票否决；并且用 model.js 的乐观边距抵消磁纬误差。
      const applyOvalC10 = (c10) => {
        try{
          if(window.Model && typeof window.Model.applyOvalConstraint === "function" && Number.isFinite(mlat)){
            const r = window.Model.applyOvalConstraint(c10, mlat);
            if(r && Number.isFinite(r.adjustedC10)) return r.adjustedC10;
          }
        }catch(_){ /* ignore */ }
        return c10;
      };

      // Hard Stop：|MLAT| < 40° -> 直接弹窗 + 不运行
      if(Number.isFinite(absMlat) && absMlat < MLAT_HARD_STOP){
        showMlatHardStop(mlat);

        safeHTML($("oneHeroLabel"), `<span style="color:${cColor(1)} !important;">${escapeHTML(translateConclusionTextIfEN("不可观测"))}</span>`);
        safeText($("oneHeroMeta"), actionNote1h(1, { hardBlock:true }));
        safeHTML(
          $("oneBlockers"),
          `<div class="blockerExplain s1"><div>${escapeHTML(primaryPrefixIfEN() + translateReasonIfEN("磁纬过低，已停止生成"))}</div></div>`
        );
        safeHTML($("swLine"), SW_PLACEHOLDER_HTML);
        safeText($("swMeta"), "—");

        const labels = ["+10m","+20m","+30m","+40m","+50m","+60m"];
        const vals = [0,0,0,0,0,0];
        const cols = vals.map(v => "rgba(255,255,255,.14)");
        renderChart(labels, vals, cols);

        // For 3-hour burst model: only state (big word) and one-line hint
        safeText($("threeState"), "静默");
        safeText($("threeBurst"), _tIfEN("磁纬过低，已停止生成", "MLAT too low. Generation stopped."));
        safeText($("threeDeliver"), "—");
        safeText($("threeDeliverMeta"), "—");

        // 3小时（三卡，与 72h 同模板）
        [0,1,2].forEach(i => {
          safeText($("threeSlot"+i+"Time"), "—");
          safeText($("threeSlot"+i+"Conclusion"), translateConclusionTextIfEN("不可观测"));
          safeText($("threeSlot"+i+"Note"), actionNote1h(1, { hardBlock:true }));
          safeText($("threeSlot"+i+"Reason"), "不可观测。");
          const card = $("threeSlot"+i);
          if(card) card.className = "dayCard c1";
        });

        // 72h（三列日卡）
        [0,1,2].forEach(i => {
          safeText($("day"+i+"Date"), "—");
          safeText($("day"+i+"Conclusion"), translateConclusionTextIfEN("不可观测"));
          safeText($("day"+i+"Note"), actionNote72h(1));
          safeText($("day"+i+"Basis"), "不可观测。");
          const card = $("day"+i);
          if(card) card.className = "dayCard c1";
        });

        setStatusDots([
          { level:"ok", text:"太阳风 —" },
          { level:"ok", text:"KP —" },
          { level:"ok", text:"云量 —" },
          { level:"ok", text:"OVATION —" },
        ]);
        setStatusText("⚠️ 磁纬过低：已停止生成。 ");
        return;
      }

      // Strong Warning：40–50° -> 弹窗教育，但允许继续（用户点击“知道了”后继续）
      if(Number.isFinite(absMlat) && absMlat < MLAT_STRONG_WARN){
        showMlatStrongWarn(mlat);
        await waitAlertDismiss();
      }

      // 继续正常拉取
      const [rt, kp, clouds, ova] = await Promise.all([
        getRealtimeStateSmart(),
        window.Data.fetchKp(),
        window.Data.fetchClouds(lat, lon),
        window.Data.fetchOvation()
      ]);
      
      // 状态点：太阳风来源固定为镜像 + 新鲜度状态
      setStatusDots([
        swPill(rt?.status),
        { level: levelFromNote(kp?.note, !!kp?.ok), text: kp?.note || "KP" },
        { level: levelFromNote(clouds?.note, !!clouds?.ok), text: clouds?.note || "云量" },
        { level: levelFromNote(ova?.note, !!ova?.ok), text: ova?.note || "OVATION" },
      ]);
      
      // 统一字段 → 旧模型 sw 结构（最小侵入：不改你后面模型）
      const sw = {
        v: rt.solarWind.speed_km_s,
        n: rt.solarWind.density_cm3,
        bt: rt.imf.bt_nT,
        bz: rt.imf.bz_gsm_nT,     // ✅ 只用 GSM Bz（来自 NOAA mag 的 bz_gsm）
        time_tag: rt.imf.ts || rt.solarWind.ts || null,
      };

      // missingKeys：用 null 判缺失（替代你旧的 missing 数组）
      // 说明：这里的 missingKeys 表示“输入不确定性”，即便后面做了 V/N 回溯，也仍然保留缺失标记用于触发可信度提醒。
      const missingKeys = [];
      if (sw.v == null)  missingKeys.push("v");
      if (sw.n == null)  missingKeys.push("n");
      if (sw.bt == null) missingKeys.push("bt");
      if (sw.bz == null) missingKeys.push("bz");

      // ===============================
      // "+" explanation layer (scheme A): trend-only, no score jump
      // ===============================
      // 人话：分数代表“现在”，加号代表“正在变好”。
      // 只在 2/3/4 分上允许出现“+”，并且不做一票否决。
      const trendPlus = (() => {
        try{
          const bt = Number(sw.bt);
          const bzNow = Number(sw.bz);

          // Prefer RTSW 1m-derived trend (more responsive)
          const bz15 = Number(rt?.imf?.bz15_nT);
          const bz30 = Number(rt?.imf?.bz30_nT);

          // Require usable field strength to avoid noise
          if(!Number.isFinite(bt) || bt < 5) return { on:false, level:0, reason:"" };
          if(!Number.isFinite(bzNow)) return { on:false, level:0, reason:"" };

          const drop15 = (Number.isFinite(bz15) ? (bz15 - bzNow) : null);
          const drop30 = (Number.isFinite(bz30) ? (bz30 - bzNow) : null);

          // Trigger rules (simple + stable)
          const ok30 = (drop30 != null && drop30 >= 3);
          const ok15 = (drop15 != null && drop15 >= 2);

          if(!(ok30 || ok15)) return { on:false, level:0, reason:"" };

          // copywriting: keep it short + actionable
          const desc = ok30
            ? `趋势：Bz 在过去 30 分钟明显转南（≈${drop30.toFixed(1)}nT），建议提前准备（30–60min）`
            : `趋势：Bz 在过去 15 分钟快速转南（≈${drop15.toFixed(1)}nT），建议提前准备（30–60min）`;

          return { on:true, level:1, reason: desc };
        }catch(_){
          return { on:false, level:0, reason:"" };
        }
      })();

      // Inline "+" badge HTML (no extra CSS dependency)
      const plusBadgeInline = () => (
        `<span style="position:absolute; top:-6px; right:-6px; width:18px; height:18px; line-height:18px; text-align:center; border-radius:999px; ` +
        `border:1px solid rgba(255,255,255,.22); background:rgba(255,255,255,.10); font-size:12px; font-weight:700; color:rgba(255,255,255,.88);">+</span>`
      );

      const maybePlusWrap = (innerHtml, allow) => {
        if(!(trendPlus?.on && allow)) return innerHtml;
        return `<span style="position:relative; display:inline-block; padding-right:10px;">${innerHtml}${plusBadgeInline()}</span>`;
      };

      const trendExplainInline = () => {
        if(!(trendPlus?.on && trendPlus.reason)) return "";
        return `<div style=\"margin-top:6px; font-size:12px; opacity:.88;\">${escapeHTML(trendPlus.reason)}</div>`;
      };

      // --- Plasma 回溯（退路方案 B）：当 NOAA plasma 最新点缺失时，回溯最近一次有效 speed/density ---
      // 仅用于补齐展示与模型输入；仍保留 missingKeys 用于“数据可信度提醒”。
      async function backfillPlasmaVNIfNeeded(swObj, maxAgeMin = 120){
        try{
          // 只有在 V 或 N 缺失时才回溯
          if(swObj.v != null && swObj.n != null) return { ok:false };

          // 拉取镜像的 plasma.json（同源静态文件，带缓存破坏参数）
          const url = `./noaa/plasma.json?t=${Date.now()}`;
          const res = await fetch(url, { cache: "no-store" });
          if(!res.ok) return { ok:false };
          const j = await res.json();

          // 兼容两种形态：
          // 1) noaa = [ [header...], [row...], ... ]
          // 2) noaa = ["time_tag","density","speed",...]（仅字段名，表示无数据）
          const arr = j?.noaa;
          if(!Array.isArray(arr) || arr.length < 2) return { ok:false };
          if(!Array.isArray(arr[0])) return { ok:false }; // 只有字段名时直接失败

          const header = arr[0];
          const idxT = header.indexOf("time_tag");
          const idxD = header.indexOf("density");
          const idxS = header.indexOf("speed");
          if(idxT < 0 || idxD < 0 || idxS < 0) return { ok:false };

          // 从最新往回找最近一次“speed + density 都有效”的点
          for(let i = arr.length - 1; i >= 1; i--){
            const row = arr[i];
            if(!Array.isArray(row)) continue;

            const tStr = row[idxT];
            const speed = Number(row[idxS]);
            const dens  = Number(row[idxD]);
            const t = Date.parse(tStr);

            if(!Number.isFinite(t) || !Number.isFinite(speed) || !Number.isFinite(dens)) continue;
            const ageMin = (Date.now() - t) / 60000;
            if(!Number.isFinite(ageMin) || ageMin < 0) continue;
            if(ageMin > maxAgeMin) continue;

            // ✅ 回填
            swObj.v = speed;
            swObj.n = dens;
            // 如果原来没有 plasma ts，就用回溯点的时间作为 sw.time_tag 的候选（优先级低于 IMF）
            if(!swObj.time_tag) swObj.time_tag = tStr;

            // 记录用于 UI 展示
            swObj._plasmaBackfillAgeMin = Math.round(ageMin);
            return { ok:true, ageMin: swObj._plasmaBackfillAgeMin };
          }

          return { ok:false };
        }catch(_){
          return { ok:false };
        }
      }

      // 执行回溯（只回溯 V/N，不回溯 Bt/Bz）
      if(missingKeys.includes("v") || missingKeys.includes("n")){
        await backfillPlasmaVNIfNeeded(sw, 120);
      }

      // (moved baseDate up)

    // ✅ always render realtime solar-wind line (otherwise UI stays "—")
    const fmtNum = (x, d=1) => (Number.isFinite(x) ? x.toFixed(d) : "—");

    // 实时云量（当前小时 L/M/H）
    let cloudLine = "";
    try{
      if(clouds?.ok && clouds?.data){
        const cnow = cloudNow3layer(clouds.data, baseDate);
        if(cnow){
          cloudLine = `云 L/M/H ${cnow.low}/${cnow.mid}/${cnow.high}%`;
        }
      }
    }catch(_){ cloudLine = ""; }

    // 实时月角（当前时刻月亮高度角）
    let moonLine = "";
    try{
      const moonAlt = getMoonAltDeg(baseDate, lat, lon);
      if(Number.isFinite(moonAlt)){
        moonLine = `月角 ${moonAlt.toFixed(1)}°`;
      }
    }catch(_){ moonLine = ""; }

    // 方案二：两行展示
    // 第一行：V / Bt / Bz / N（尽量不换行；未来你在 style.css 再细调）
    // 第二行：云量 / 月角（重要但次一级，单独一行更清爽）
    const kv = (k, v) => (
      `<span class="swK">${escapeHTML(k)}</span> ` +
      `<span class="swV">${escapeHTML(v)}</span>`
    );

    const line1 = [
      kv("V",  fmtNum(sw.v, 0)),
      kv("Bt", fmtNum(sw.bt, 1)),
      kv("Bz", fmtNum(sw.bz, 1)),
      kv("N",  fmtNum(sw.n, 2)),
    ].join(" <span class=\"swSep\">｜</span> ");

    const line2Parts = [];
    if(cloudLine) line2Parts.push(`<span class="swAuxItem">${escapeHTML(cloudLine)}</span>`);
    if(moonLine)  line2Parts.push(`<span class="swAuxItem">${escapeHTML(moonLine)}</span>`);

    const line2 = line2Parts.length
      ? `<div class="swAux">${line2Parts.join(" <span class=\"swSep\">｜</span> ")}</div>`
      : "";

    safeHTML(
      $("swLine"),
      `<div class="swMain" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${line1}</div>${line2}`
    );
      
      // meta: show timestamps + freshness
      const tsText = sw.time_tag ? fmtYMDHM(new Date(sw.time_tag)) : "—";
      safeText(
        $("swMeta"),
        `更新时间：${tsText} ・ 新鲜度：mag ${Math.round(rt.imf.ageMin)}m / plasma ${Math.round(rt.solarWind.ageMin)}m${Number.isFinite(sw._plasmaBackfillAgeMin) ? ` ・ V/N回溯：${sw._plasmaBackfillAgeMin}m` : ""}`
      );
      
      // OUTAGE 不硬停：提示 + 弱模式/降权
      if (rt.status === "OUTAGE") {
        setStatusText("⚠️ 太阳风数据源长时间不可用：已进入弱模式（保守估算）");
      }
      // NOAA 缺字段：强提示弹窗 + 页面状态文案（甩锅 NOAA + 保守估算）
      const hasMissing = missingKeys.length > 0;

      if(hasMissing){
        const missCN = missingKeys.map(k => (k==="v"?"V":k==="n"?"N":k==="bt"?"Bt":k==="bz"?"Bz":k)).join("、");

        // 数据可信度提醒：右侧可点击查看详情（不自动强弹）
        setStatusText("⚠️ 数据可信度提醒");

        const warnHtml = `
          <div>NOAA 数据口径变动或部分数据缺失：<b>${escapeHTML(missCN)}</b></div>
          <div class="mutedLine">当前预测可信度较低，建议谨慎参考。</div>
        `;

        const st = document.getElementById("statusText");
        if(st){
          st.classList.add("warn");
          st.title = "点击查看数据可信度说明";
          st.onclick = () => openAlertOverlay(warnHtml);
        }
      }else{
        setStatusText("已生成。");
        const st = document.getElementById("statusText");
        if(st){
          st.classList.remove("warn");
          st.title = "";
          st.onclick = null;
        }
      }

      const base10 = window.Model.baseScoreFromSW(sw, missingKeys);
      let base10Adj = base10;
      if (rt.status === "DEGRADED") base10Adj = base10 * 0.78;
      if (rt.status === "OUTAGE")   base10Adj = base10 * 0.60;

      // ---------- 1h: 10min bins ----------
      const labels = [];
      const vals = [];
      const cols = [];
      let heroScore = 1;
      let heroGate = null; // first bin gate snapshot

      for(let i=0;i<6;i++){
        const d = new Date(baseDate.getTime() + (i+1)*10*60000);
        const gate = obsGate(d, lat, lon);
        if(i===0) heroGate = gate;

        // 月角因子（后台）
        const moonAlt = getMoonAltDeg(d, lat, lon);
        const moonF = moonFactorByLat(lat, moonAlt);

        // 磁纬轻微因子（后台）
        const latBoost = Number.isFinite(mlat) ? clamp((mlat - 55) / 12, 0, 1) : 0;
        const latF = 0.85 + latBoost*0.15;

        // 保守外推：逐步衰减
        const decay = Math.pow(0.92, i);
        let c10 = base10Adj * decay;

        // 门槛/窗口（后台）
        if(gate.hardBlock){
          labels.push(fmtHM(d));
          // hardBlock 也要渲染为 1 分（避免“空白图”错觉）
          vals.push(1);
          cols.push(cColor(1));
          if(i===0) heroScore = 1;
          continue;
        }else{
          if(!gate.inWindow) c10 *= 0.55;
          c10 *= moonF;
          c10 *= latF;
        }

        c10 = clamp(c10, 0, 10);

        // Aurora Oval soft constraint (backend-only)
        c10 = applyOvalC10(c10);
        c10 = clamp(c10, 0, 10);

        // Low-density brightness attenuation (1h only)
        // Rationale: when N < 1 cm^-3, brightness potential is reduced (edge-latitude friendly)
        if(Number.isFinite(sw.n) && sw.n < 1){
          c10 = c10 * 0.8;
          c10 = clamp(c10, 0, 10);
        }

        const s5 = window.Model.score5FromC10(c10); // 1..5
        labels.push(fmtHM(d));
        vals.push(s5);
        cols.push(cColor(s5));
        if(i===0) heroScore = s5;
      }

      const heroObj = window.Model.labelByScore5(heroScore);
      // 1小时标题：整句跟随 C 值颜色（用 inline + !important 防止被 CSS 覆盖）
      const heroAllowPlus = (heroScore >= 2 && heroScore <= 4);
      const heroLabelText = translateConclusionTextIfEN(heroObj.t);
      const heroLabelInner = `<span style="color:${cColor(heroObj.score)} !important;">${escapeHTML(String(heroLabelText))}</span>`;
      safeHTML(
        $("oneHeroLabel"),
        maybePlusWrap(heroLabelInner, heroAllowPlus)
      );
      // OVATION meta (time + age)
      let ovaTxt = "—";
      try {
        if (ova?.ok && ova?.data) {
          const tStr = ova.data.ObservationTime || ova.data.ForecastTime || null;
          if (tStr) {
            const t = Date.parse(tStr);
            const ageMin = Number.isFinite(t)
              ? Math.round((Date.now() - t) / 60000)
              : null;
            ovaTxt = `OK（${ageMin == null ? "?" : ageMin}m）`;
          } else {
            ovaTxt = "OK";
          }
        } else if (ova?.note) {
          ovaTxt = "失败";
        }
      } catch (_) {
        ovaTxt = ova?.ok ? "OK" : "—";
      }
      
      // ----- 观测限制解释（C=1/2/3 时显示；hardBlock 也必须给出原因，避免空白）-----
      let blockerHTML = "";
      try{
        if(heroScore <= 3 && heroGate){
          let primary = "";

          // hardBlock：统一口径（不再区分太阳/月亮）
          if(heroGate.hardBlock){
            primary = "天色偏亮，微弱极光难以分辨";
          }else if(typeof window.Model?.explainUnobservable === "function"){
            // 云量：三层云取最大值（不向用户区分高/中/低云）
            let cloudMax = null;
            if(clouds?.ok && clouds?.data){
              const best = bestCloud3h(clouds.data, baseDate);
              if(best && Number.isFinite(best.low) && Number.isFinite(best.mid) && Number.isFinite(best.high)){
                cloudMax = Math.max(Number(best.low), Number(best.mid), Number(best.high));
              }
            }

            // 太阳 / 月亮高度
            const sunAltDeg  = getSunAltDeg(baseDate, lat, lon);
            const moonAltDeg = getMoonAltDeg(baseDate, lat, lon);

            // 月相亮度 fraction（0~1）
            let moonFrac = null;
            try{
              if(window.SunCalc?.getMoonIllumination){
                const mi = SunCalc.getMoonIllumination(baseDate);
                if(mi && mi.fraction != null) moonFrac = Number(mi.fraction);
              }
            }catch(_){ moonFrac = null; }

            const ex = window.Model.explainUnobservable({ cloudMax, moonAltDeg, moonFrac, sunAltDeg });
            primary = ex?.primaryText ? String(ex.primaryText) : "";

            // 兜底：如果解释为空，也统一为“天色偏亮…”
            if(!primary.trim()) primary = "天色偏亮，微弱极光难以分辨";
          }

          blockerHTML = `
            <div class="blockerExplain s${heroScore}">
              <div>${escapeHTML(primaryPrefixIfEN() + (translateReasonIfEN(primary) || "—"))}</div>
            </div>
          `;
        }
      }catch(e){ blockerHTML = ""; }

      safeText($("oneHeroMeta"), actionNote1h(heroScore, heroGate));
      safeHTML($("oneBlockers"), blockerHTML || "");

      renderChart(labels, vals, cols);

      // ---------- 3小时观测窗口：每小时独立判断 + 并列最佳 ----------

      // 旧版：极光爆发模型（保留，仅作为补充信息）
      let s3Burst = null;
      try{
        if(typeof window.Model?.state3h === "function"){
          s3Burst = window.Model.state3h(sw);
        }
      }catch(_){ s3Burst = null; }

      // 送达模型（保留：作为背景信息）
      const del = window.Model.deliverModel(sw);
      safeText($("threeDeliver"), `${del.count}/3 成立`);
      safeText(
        $("threeDeliverMeta"),
        `Bt平台${del.okBt ? "✅" : "⚠️"} ・ 速度背景${del.okV ? "✅" : "⚠️"} ・ 密度结构${del.okN ? "✅" : "⚠️"}`
      );

      // 取某个时刻对应的“小时云量三层”，并返回 cloudMax（不区分高/中/低云展示）
      function _cloudMaxAt(openMeteoJson, atDate){
        const pack = _omGetHourlyCloudArrays(openMeteoJson);
        if(!pack) return null;
        const t0 = atDate instanceof Date ? atDate.getTime() : Date.now();

        // 找最接近该时刻的小时点
        let bestI = -1;
        let bestD = Infinity;
        for(let i=0;i<pack.times.length;i++){
          const ti = Date.parse(pack.times[i]);
          if(!Number.isFinite(ti)) continue;
          const d = Math.abs(ti - t0);
          if(d < bestD){ bestD = d; bestI = i; }
        }
        if(bestI < 0) return null;

        const low  = Number(pack.low[bestI]);
        const mid  = Number(pack.mid[bestI]);
        const high = Number(pack.high[bestI]);
        if(!Number.isFinite(low) || !Number.isFinite(mid) || !Number.isFinite(high)) return null;

        return {
          low: Math.round(low),
          mid: Math.round(mid),
          high: Math.round(high),
          cloudMax: Math.max(low, mid, high)
        };
      }

      // 云量对“可观测”的保守因子（止血版：只影响分数，不对外暴露公式）
      function _cloudFactorByMax(cloudMax){
        if(!Number.isFinite(cloudMax)) return 0.65; // 无数据：保守中低
        if(cloudMax <= 30) return 1.0;
        if(cloudMax <= 60) return 0.75;
        if(cloudMax <= 85) return 0.45;
        return 0.25;
      }

      // 以当前时刻为基准：生成未来 3 个“整点小时窗口”（当前小时起算）
      const slots = [];
      const baseHour = new Date(baseDate);
      baseHour.setMinutes(0, 0, 0);

      for(let h=0; h<3; h++){
        const start = new Date(baseHour.getTime() + h * 3600 * 1000);
        const end   = new Date(start.getTime() + 3600 * 1000);
        const mid   = new Date(start.getTime() + 30 * 60000);

        const gate = obsGate(mid, lat, lon);

        // 月角/磁纬轻微因子（与 1h 口径一致）
        const moonAlt = getMoonAltDeg(mid, lat, lon);
        const moonF = moonFactorByLat(lat, moonAlt);

        const latBoost = Number.isFinite(mlat) ? clamp((mlat - 55) / 12, 0, 1) : 0;
        const latF = 0.85 + latBoost*0.15;

        // 1h 的 10min 外推是 0.92^i；这里按“每小时 = 6 个 bin”做同口径衰减
        const decay = Math.pow(0.92, h * 6);

        // 基础 C10
        let c10 = base10Adj * decay;

        // 门槛/窗口影响
        if(gate.hardBlock){
          c10 = 0;
        }else{
          if(!gate.inWindow) c10 *= 0.55;
          c10 *= moonF;
          c10 *= latF;
        }

        // 云量影响（不拆层，使用 cloudMax）
        let cloudMax = null;
        let cloud3 = null;
        if(clouds?.ok && clouds?.data){
          cloud3 = _cloudMaxAt(clouds.data, mid);
          cloudMax = cloud3?.cloudMax ?? null;
          c10 *= _cloudFactorByMax(cloudMax);
        }else{
          c10 *= _cloudFactorByMax(null);
        }

        c10 = clamp(c10, 0, 10);

        // Aurora Oval soft constraint (backend-only)
        c10 = applyOvalC10(c10);
        c10 = clamp(c10, 0, 10);

        const score5 = window.Model.score5FromC10(c10);

        // 主要影响因素：只在低分（<=2）时展示一个；hardBlock 也给出统一原因
        let factorText = "";
        if(score5 <= 2 && gate.hardBlock){
          factorText = "天色偏亮，微弱极光难以分辨";
        }else if(score5 <= 2 && typeof window.Model?.explainUnobservable === "function"){
          const sunAltDeg  = getSunAltDeg(mid, lat, lon);
          const moonAltDeg = moonAlt;

          let moonFrac = null;
          try{
            if(window.SunCalc?.getMoonIllumination){
              const mi = SunCalc.getMoonIllumination(mid);
              if(mi && mi.fraction != null) moonFrac = Number(mi.fraction);
            }
          }catch(_){ moonFrac = null; }

          const ex = window.Model.explainUnobservable({ cloudMax, moonAltDeg, moonFrac, sunAltDeg });
          factorText = ex?.primaryText ? String(ex.primaryText) : "";
        }

        slots.push({ start, end, mid, score5, factorText, cloud3 });
      }

      // 并列最佳逻辑：同分不选靠前，提示“机会均等”
      const maxScore = Math.max.apply(null, slots.map(s => s.score5));
      const best = slots.filter(s => s.score5 === maxScore);

      // 3h burst model: show only the state (big) + one-line hint (small)
      const burstStateCN = (s3Burst && s3Burst.state) ? String(s3Burst.state) : "—";
      const burstHintCN  = (s3Burst && s3Burst.hint)  ? String(s3Burst.hint)  : "—";

      // big word (静默/爆发)
      safeText($("threeState"), burstStateCN);

      // one-line hint under the big word
      safeText($("threeBurst"), burstHintCN);

      // 如果你以后想在 hero 里加一行“并列最佳/最佳窗口”，这里预留：
      // safeText($("threeBestLine"), bestLine);

      // 3小时云量摘要：云量模块已隐藏（停止向 threeClouds 写内容；保留计算逻辑做退路）
      // let cloudBest3h = null;
      // if(clouds.ok && clouds.data) cloudBest3h = bestCloud3h(clouds.data, baseDate);
      // if(cloudBest3h){
      //   const grade = cloudGradeFromBest(cloudBest3h);
      //   safeHTML(
      //     $("threeClouds"),
      //     `云量评分：<b>${grade}</b>
      //      <div class="cloudDetail">低云 ${cloudBest3h.low}% ｜ 中云 ${cloudBest3h.mid}% ｜ 高云 ${cloudBest3h.high}%</div>`
      //   );
      // }else{
      //   safeHTML(
      //     $("threeClouds"),
      //     `云量评分：<b>—</b><div class="cloudDetail">低云 —% ｜ 中云 —% ｜ 高云 —%</div>`
      //   );
      // }

      // ---------- 72h：三列日卡（今天/明天/后天） ----------
      const days = next3DaysLocal(baseDate);
      const kpMap = kp.ok ? kpMaxByDay(kp.data) : null;

      // p1a/p1b（高速风/能量输入）对三天相同，用于依据展示
      const p1a = window.Model.p1a_fastWind(sw) ? 1 : 0;
      const p1b = window.Model.p1b_energyInput(sw) ? 1 : 0;

      days.forEach((d, i) => {
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
          5: { t: "强烈推荐", cls: "c5" },
          4: { t: "值得出门", cls: "c4" },
          3: { t: "可蹲守", cls: "c3" },
          2: { t: "低概率", cls: "c2" },
          1: { t: "不可观测", cls: "c1" },
        };
        const lab = map5[score5];

        // 云量更佳点（即使云量模块隐藏，这里仍作为依据展示）
        let cloudDetail = "云量更佳点：—";
        if (clouds.ok && clouds.data) {
          const win = bestCloudHourForDay(clouds.data, d);
          if (win) {
            cloudDetail = `云量更佳点：${win.hh}:00（L/M/H≈${win.low}/${win.mid}/${win.high}%）`;
          }
        }

        // 依据（不折叠，允许换行）
        const kpLine = `能量背景：Kp峰值≈${kpMax == null ? "—" : round0(kpMax)}`;
        const delLine = `送达模型：${del.count}/3（Bt/速度/密度）`;
        const trigLine = `触发模型：高速风${p1a}/1 · 能量输入${p1b}/1`;
        const nightLine = `夜晚占比：${Math.round(nightRatio * 100)}%`;

        const basisHTML = [
          `<div class="basisItem">${escapeHTML(kpLine)}</div>`,
          `<div class="basisItem">${escapeHTML(delLine)}</div>`,
          `<div class="basisItem">${escapeHTML(trigLine)}</div>`,
          `<div class="basisItem">${escapeHTML(nightLine)}</div>`,
          `<div class="basisItem">${escapeHTML(cloudDetail)}</div>`,
        ].join("");

        // 写入到三列卡片
        safeText($("day"+i+"Date"), key);
        safeText($("day"+i+"Conclusion"), translateConclusionTextIfEN(lab.t));
        safeText($("day"+i+"Note"), actionNote72h(score5));
        safeHTML($("day"+i+"Basis"), basisHTML);

        const card = $("day"+i);
        if(card) card.className = `dayCard ${lab.cls}`;
      });

    }catch(err){
      console.error("[AuroraCapture] run error:", err);
      setStatusText("生成失败：请打开控制台查看错误。");
    }
  }

  // ---------- bootstrap ----------
  function bootstrap(){
    initTabs();
    initLangToggle();
    initAbout();

    if($("lat") && !$("lat").value) $("lat").value = "53.47";
    if($("lon") && !$("lon").value) $("lon").value = "122.35";

    // Ensure placeholder layout is consistent before any run()
    safeHTML($("swLine"), SW_PLACEHOLDER_HTML);
    safeText($("swMeta"), "—");


    $("btnRun")?.addEventListener("click", run);
    $("btnGeo")?.addEventListener("click", fillCurrentLocation);

    // Alert modal close buttons
    document.getElementById("alertClose")?.addEventListener("click", closeAlertOverlay);
    document.getElementById("alertOk")?.addEventListener("click", closeAlertOverlay);

  }
  document.addEventListener("DOMContentLoaded", bootstrap);

getRealtimeStateSmart().then(s => console.log("RealtimeState", s)).catch(e => console.error(e));
