// --- UI proxies (robust against load-order / cache) ---
   const uiReady = () =>
     window.UI &&
     typeof window.UI.$ === "function" &&
     typeof window.UI.safeText === "function";
   
   const $ = (id) => (uiReady() ? window.UI.$(id) : null);
   
   const clamp = (x, a, b) => (uiReady() ? window.UI.clamp(x, a, b) : x);
   const round0 = (x) => (uiReady() ? window.UI.round0(x) : x);
   const abs = (x) => (uiReady() ? window.UI.abs(x) : Math.abs(x));
   
   const safeText = (el, t) => { if (uiReady()) window.UI.safeText(el, t); };
   const safeHTML = (el, h) => { if (uiReady()) window.UI.safeHTML(el, h); };
   
   const setStatusDots = (items) => { if (uiReady()) window.UI.setStatusDots(items); };
   const setStatusText = (t) => { if (uiReady()) window.UI.setStatusText(t); };
   
   const cacheSet = (k, v) => { if (uiReady()) window.UI.cacheSet(k, v); };
   const cacheGet = (k) => (uiReady() ? window.UI.cacheGet(k) : null);
   const fmtAge = (ms) => (uiReady() ? window.UI.fmtAge(ms) : "");
   
   const now = () => (uiReady() ? window.UI.now() : new Date());
   const fmtYMD = (d) => (uiReady() ? window.UI.fmtYMD(d) : "");
   const fmtHM = (d) => (uiReady() ? window.UI.fmtHM(d) : "");
   const fmtYMDHM = (d) => (uiReady() ? window.UI.fmtYMDHM(d) : "");
   
   const escapeHTML = (s) => (uiReady() ? window.UI.escapeHTML(s) : String(s));
   const renderChart = (labels, vals, cols) => { if (uiReady()) window.UI.renderChart(labels, vals, cols); };
   const badgeHTML = (text, cls) => (uiReady() ? window.UI.badgeHTML(text, cls) : "");
   
   const initTabs = () => { if (uiReady() && typeof window.UI.initTabs === "function") window.UI.initTabs(); };
   const initAbout = () => { if (uiReady() && typeof window.UI.initAbout === "function") window.UI.initAbout(); };

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
        safeHTML($("oneHeroLabel"), `<span style="color:${cColor(1)} !important;">1分 不可观测</span>`);
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
        // 云量模块已隐藏：停止向 threeClouds 写内容（保留云量逻辑供未来恢复）
        // safeHTML($("threeClouds"), "云量评分：—");

        // 72h（三列日卡）
        [0,1,2].forEach(i => {
          safeText($("day"+i+"Date"), "—");
          safeText($("day"+i+"Conclusion"), "1分 不可观测");
          safeText($("day"+i+"Basis"), "不可观测。");
          const card = $("day"+i);
          if(card) card.className = "dayCard c1";
        });
        setStatusDots([
          { level:"ok", text:"NOAA —" },
          { level:"ok", text:"Kp —" },
          { level:"ok", text:"云量 —" },
          { level:"ok", text:"OVATION —" },
        ]);
        setStatusText("已生成。");
        return;
      }
      const [rt, kp, clouds, ova] = await Promise.all([
        getRealtimeState(),
        window.Data.fetchKp(),
        window.Data.fetchClouds(lat, lon),
        window.Data.fetchOvation()
      ]);
      
      // 状态点：太阳风来源固定为镜像 + 新鲜度状态
      setStatusDots([
        { level: rt.status === "OK" ? "ok" : (rt.status === "DEGRADED" ? "warn" : "bad"),
          text: `太阳风：${rt.status}（mag ${Math.round(rt.imf.ageMin)}m / plasma ${Math.round(rt.solarWind.ageMin)}m）` },
        { level: kp.ok ? "ok" : "bad", text: kp.note || "Kp" },
        { level: clouds.ok ? "ok" : "bad", text: clouds.note || "云量" },
        { level: ova.ok ? "ok" : "bad", text: ova.note || "OVATION" },
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

      const baseDate = now();

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
      
      // 不可用：>3小时 或者关键全空
      if (rt.status === "INVALID") {
        safeText($("oneHeroLabel"), "—");
        safeText($("oneHeroMeta"), "—");
        safeText($("swLine"), "V — ｜ Bt — ｜ Bz — ｜ N —");
        safeText($("swMeta"), "太阳风数据不可用（断流>3小时）");
        const labels = ["+10m","+20m","+30m","+40m","+50m","+60m"];
        const vals = [0,0,0,0,0,0];
        const cols = vals.map(()=> "rgba(255,255,255,.14)");
        renderChart(labels, vals, cols);
        setStatusText("🚫 太阳风数据断流超过 3 小时：已停止生成预测。");
        return;
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

      const mlat = window.Model.approxMagLat(lat, lon);
      const base10 = window.Model.baseScoreFromSW(sw, missingKeys);

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

        const s5 = window.Model.score5FromC10(c10); // 1..5
        labels.push(fmtHM(d));
        vals.push(s5);
        cols.push(cColor(s5));
        if(i===0) heroScore = s5;
      }

      const heroObj = window.Model.labelByScore5(heroScore);
      // 1小时标题：分数字体跟随 C 值颜色（c1~c5）
      safeHTML(
        $("oneHeroLabel"),
        `<span class="${cClass(heroObj.score)} cText">${escapeHTML(String(heroObj.score))}分</span> ${escapeHTML(heroObj.t)}`
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
      
      // ----- 观测限制解释（C=1/2/3 时显示，且非 hardBlock）-----
      let blockerHTML = "";
      try{
        if(heroScore <= 3 && heroGate && !heroGate.hardBlock && typeof window.Model?.explainUnobservable === "function"){
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

          // 文案体系统一：只用“主要影响因素”（与 3 小时模块一致）
          const title = "主要影响因素";

          blockerHTML = `
            <div class="blockerExplain s${heroScore}">
              <div>${escapeHTML(title)}：${escapeHTML(ex.primaryText || "—")}</div>
            </div>
          `;
        }
      }catch(e){ blockerHTML = ""; }

      safeHTML(
        $("oneHeroMeta"),
        `本地时间：${escapeHTML(fmtYMDHM(baseDate))} ・ OVATION：${escapeHTML(ovaTxt)}${blockerHTML}`
      );

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

        const latBoost = clamp((mlat - 55) / 12, 0, 1);
        const latF = 0.85 + latBoost*0.15;

        // 1h 的 10min 外推是 0.92^i；这里按“每小时 = 6 个 bin”做同口径衰减
        const decay = Math.pow(0.92, h * 6);

        // 基础 C10
        let c10 = base10 * decay;

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
        const score5 = window.Model.score5FromC10(c10);

        // 主要影响因素：只在低分（<=2）时展示一个
        let factorText = "";
        if(score5 <= 2 && !gate.hardBlock && typeof window.Model?.explainUnobservable === "function"){
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

      if(best.length >= 2){
        safeText($("threeState"), "观测机会均等");
      }else{
        safeText($("threeState"), "最佳观测窗口");
      }

      const fmtWin = (s) => `${fmtHM(s.start)}–${fmtHM(s.end)}`;

      // 渲染三小时条（用 HTML，方便并列/换行；后面你再用 style.css 微调）
      const slotHtml = slots.map(s => {
        const score = Number.isFinite(s.score5) ? s.score5 : "—";
        const win = fmtWin(s);
        const isBest = s.score5 === maxScore;
        const badge = `<span class="badge c${escapeHTML(String(score))}">${escapeHTML(score)}分</span>`;

        const factor = s.factorText
          ? `<div class="mutedLine">主要影响因素：${escapeHTML(s.factorText)}</div>`
          : ``;

        return `
          <div class="slot ${cClass(s.score5)} cFrame ${isBest ? "best" : ""}">
            <div><b>${escapeHTML(win)}</b> ${badge}</div>
            ${factor}
          </div>
        `;
      }).join("");

      const bestWindows = best.map(fmtWin).join(" / ");
      const bestLine = (best.length >= 2)
        ? `并列最佳：${escapeHTML(bestWindows)}`
        : `最佳窗口：${escapeHTML(bestWindows)}`;
      const burstText = (s3Burst && s3Burst.state)
        ? `爆发模型：${s3Burst.state}${s3Burst.hint ? ` · ${s3Burst.hint}` : ""}`
        : "—";
      safeText($("threeBurst"), burstText);

      safeHTML($("threeHint"), `${slotHtml}<div class="mutedLine">${bestLine}</div>`);

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
        safeText($("day"+i+"Conclusion"), `${score5}分 ${lab.t}`);
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
    initAbout();

    if($("lat") && !$("lat").value) $("lat").value = "53.47";
    if($("lon") && !$("lon").value) $("lon").value = "122.35";

    $("btnRun")?.addEventListener("click", run);

    // Alert modal close buttons
    document.getElementById("alertClose")?.addEventListener("click", closeAlertOverlay);
    document.getElementById("alertOk")?.addEventListener("click", closeAlertOverlay);

  }
      document.addEventListener("DOMContentLoaded", () => {
        const t0 = Date.now();
        const tick = () => {
          if (uiReady()) return bootstrap();
          if (Date.now() - t0 > 3000) {
            console.error("[AuroraCapture] UI not ready (ui.js maybe not loaded).");
            return;
          }
          setTimeout(tick, 50);
        };
        tick();
      });

getRealtimeState().then(s => console.log("RealtimeState", s)).catch(e => console.error(e));
