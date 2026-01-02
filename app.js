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
      const missingKeys = [];
      if (sw.v == null)  missingKeys.push("v");
      if (sw.n == null)  missingKeys.push("n");
      if (sw.bt == null) missingKeys.push("bt");
      if (sw.bz == null) missingKeys.push("bz");

      // ✅ always render realtime solar-wind line (otherwise UI stays "—")
      const fmtNum = (x, d=1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
      
      safeText(
        $("swLine"),
        `V ${fmtNum(sw.v, 0)} ｜ Bt ${fmtNum(sw.bt, 1)} ｜ Bz ${fmtNum(sw.bz, 1)} ｜ N ${fmtNum(sw.n, 2)}`
      );
      
      // meta: show timestamps + freshness
      const tsText = sw.time_tag ? fmtYMDHM(new Date(sw.time_tag)) : "—";
      safeText(
        $("swMeta"),
        `更新时间：${tsText} ・ 新鲜度：mag ${Math.round(rt.imf.ageMin)}m / plasma ${Math.round(rt.solarWind.ageMin)}m`
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
        setStatusText(`⚠️ 重要警告`);
        showAlertModal(`
          <div> NOAA 端口无法更新数据：<b>${escapeHTML(missCN)}</b></div>
          <div class="mutedLine">下面结果为缺乏部分数据情况下的<b>极端保守估算</b>，建议谨慎参考。</div>
        `);
      }else{
        setStatusText("已生成。");
      }

      const mlat = window.Model.approxMagLat(lat, lon);
      const base10 = window.Model.baseScoreFromSW(sw, missingKeys);
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

        const s5 = window.Model.score5FromC10(c10); // 1..5
        labels.push(fmtHM(d));
        vals.push(s5);
        cols.push(s5 <= 1 ? "rgba(255,255,255,.20)" : "rgba(91,124,255,.72)");
        if(i===0) heroScore = s5;
      }

      const heroObj = window.Model.labelByScore5(heroScore);
      safeText($("oneHeroLabel"), `${heroObj.score}分 ${heroObj.t}`);
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
      
      safeText(
        $("oneHeroMeta"),
        `本地时间：${fmtYMDHM(baseDate)} ・ OVATION：${ovaTxt}`
      );

      renderChart(labels, vals, cols);

      // ---------- 3h：状态机 + 送达 + 云评分 ----------
      let s3 = window.Model.state3h(sw);
      const del = window.Model.deliverModel(sw);

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
        const p1a = window.Model.p1a_fastWind(sw) ? 1 : 0;
        const p1b = window.Model.p1b_energyInput(sw) ? 1 : 0;

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
      const m = window.Model.approxMagLat(lat, lon);
      alert(`磁纬约 ${Math.round(m * 10) / 10}°`);
    });
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
