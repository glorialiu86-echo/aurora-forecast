/* Aurora Capture 极光捕网 v2.4
 * - 1h: 10-min C值柱状图（0-10）+ 5档建议
 * - 3h: 4态状态机 + 送达能力 0-3/3 + 云量提示
 * - 72h: 按天范围预测 + 分列依据 + C值
 * - “可观测性门槛/窗口”后台计算，前台不出现相关字样
 * - 月角：按纬度软降权（后台），前台不露出
 */

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round1 = (x) => Math.round(x * 10) / 10;
const now = () => new Date();
const abs = Math.abs;

function setStatusDots(items){
  const box = $("statusDots");
  box.innerHTML = "";
  items.forEach(it=>{
    const d = document.createElement("div");
    d.className = `dot ${it.level}`;
    d.textContent = it.text;
    box.appendChild(d);
  });
}
function setStatusText(t){ $("statusText").textContent = t; }

function cacheSet(key, value){
  try{
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value }));
  }catch(e){}
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

function deg(rad){ return rad * 180 / Math.PI; }

function getSunAltDeg(date, lat, lon){
  try{
    const p = SunCalc.getPosition(date, lat, lon);
    return deg(p.altitude);
  }catch(e){ return -999; }
}
function getMoonAltDeg(date, lat, lon){
  try{
    const p = SunCalc.getMoonPosition(date, lat, lon);
    return deg(p.altitude);
  }catch(e){ return -999; }
}

/** 后台：可观测性门槛
 *  - 硬否决：太阳高度 > 0
 *  - 可用窗口：太阳高度 <= -12
 * 前台不出现相关词，只影响“不可观测”与分数。
 */
function obsGate(date, lat, lon){
  const s = getSunAltDeg(date, lat, lon);
  return {
    hardBlock: s > 0,
    inWindow: s <= -12,
  };
}

/** 月角软降权（按纬度档位 + 月亮高度）——前台不展示 */
function moonFactorByLat(lat, moonAltDeg){
  // 月亮不在天上：不降权
  if(moonAltDeg <= 0) return 1.0;

  const L = abs(lat);
  const zone = (L >= 67) ? "high" : (L >= 62 ? "mid" : "edge");

  // 用月亮高度分段近似“背景增亮”
  let tier = 0; // 0轻 1中 2强
  if(moonAltDeg > 35) tier = 2;
  else if(moonAltDeg > 15) tier = 1;

  const table = {
    high: [1.00, 0.92, 0.82],
    mid:  [1.00, 0.88, 0.72],
    edge: [1.00, 0.80, 0.55],
  };
  return table[zone][tier];
}

/** 72h 使用“温和版月角惩罚”，避免把范围预测打太狠 */
function soften(f, ratio=0.6){
  return 1 - (1 - f) * ratio;
}

/** NOAA SWPC 2h solar wind */
async function fetchSWPC2h(){
  const magUrl = "https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json";
  const plasmaUrl = "https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json";

  let mag, plasma;
  let note = null;

  try{
    const [r1, r2] = await Promise.all([
      fetch(magUrl, { cache: "no-store" }),
      fetch(plasmaUrl, { cache: "no-store" })
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
    const cPlasma = cacheGet("cache_noaa_plasma");
    if(cMag?.value && cPlasma?.value){
      mag = cMag.value;
      plasma = cPlasma.value;
      note = `⚠️ NOAA 暂不可用，使用缓存（${fmtAge(Date.now() - (cMag.ts || Date.now()))}）`;
    }else{
      return { ok:false, note:"❌ NOAA 暂不可用且无缓存", data:null };
    }
  }

  // 解析最新一条（2h产品：header在index0）
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

  const lastMag = magRows[magRows.length-1];
  const lastPl = plRows[plRows.length-1];

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
    },
    raw: { magRows, plRows }
  };
}

/** NOAA Kp forecast (1h-ish series) */
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
      return { ok:true, note:`⚠️ Kp 暂不可用，使用缓存（${fmtAge(Date.now() - (c.ts||Date.now()))}）`, data:c.value };
    }
    return { ok:false, note:"❌ Kp 暂不可用且无缓存", data:null };
  }
}

/** OVATION nowcast (global aurora power-ish) */
async function fetchOvation(){
  // 这个端点偶尔会波动，所以同样做缓存
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
      return { ok:true, note:`⚠️ OVATION 暂不可用，使用缓存（${fmtAge(Date.now() - (c.ts||Date.now()))}）`, data:c.value };
    }
    return { ok:false, note:"❌ OVATION 暂不可用且无缓存", data:null };
  }
}

/** Open-Meteo clouds */
async function fetchClouds(lat, lon){
  // cloudcover_low/mid/high: hourly
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
      return { ok:true, note:`⚠️ 云量暂不可用，使用缓存（${fmtAge(Date.now() - (c.ts||Date.now()))}）`, data:c.value.j };
    }
    return { ok:false, note:"❌ 云量暂不可用且无缓存", data:null };
  }
}

/** 粗略磁纬（不求科研精度，只做下限门槛）
 * 这里用一个非常轻量的近似：把“地磁极偏移”做成固定点近似。
 * 如果你后面想严谨，可以换 IGRF/WMM，但那会显著增加复杂度。
 */
function approxMagLat(lat, lon){
  // 近似地磁北极位置（随时间漂移，这里固定近似值）
  const poleLat = 80.65;
  const poleLon = -72.68;

  // 用球面余弦求与地磁极的夹角，再转成“磁纬”
  const toRad = (d)=>d*Math.PI/180;
  const a1 = toRad(lat), b1 = toRad(lon);
  const a2 = toRad(poleLat), b2 = toRad(poleLon);

  const cosc = Math.sin(a1)*Math.sin(a2) + Math.cos(a1)*Math.cos(a2)*Math.cos(b1-b2);
  const c = Math.acos(clamp(cosc, -1, 1));
  // 距离地磁极的角距 c，磁纬约 = 90 - c(度)
  return 90 - deg(c);
}

/** 结论映射（5档，1h用） */
function label1h(c){
  if(c >= 8.2) return { t:"强烈推荐", cls:"g" };
  if(c >= 6.8) return { t:"值得出门", cls:"g" };
  if(c >= 5.0) return { t:"可蹲守", cls:"b" };
  if(c >= 2.8) return { t:"低概率", cls:"y" };
  return { t:"不可观测", cls:"r" };
}

/** 72h结论（按天，5档） */
function label72(c){
  if(c >= 7.2) return { t:"可能性高", cls:"g" };
  if(c >= 5.6) return { t:"有窗口", cls:"b" };
  if(c >= 4.2) return { t:"小概率", cls:"y" };
  if(c >= 2.8) return { t:"低可能", cls:"y" };
  return { t:"不可观测", cls:"r" };
}

/** 1h：把实时太阳风转成基础分（0-10） */
function baseScoreFromSW(sw){
  // 你目前的偏好：不要太严苛，所以我放宽一点点
  const v = sw.v ?? 0;
  const bt = sw.bt ?? 0;
  const bz = sw.bz ?? 0;
  const n = sw.n ?? 0;

  // v: 380~650 映射
  const sv = clamp((v - 380) / (650 - 380), 0, 1);
  // bt: 4~12
  const sbt = clamp((bt - 4) / (12 - 4), 0, 1);
  // bz: 0~-10（越南向越好）
  const sbz = clamp(((-bz) - 1) / (10 - 1), 0, 1);
  // n: 1~8
  const sn = clamp((n - 1) / (8 - 1), 0, 1);

  // 权重（偏“可拍/可见”）
  const raw = (sv*0.28 + sbt*0.26 + sbz*0.32 + sn*0.14) * 10;

  return clamp(raw, 0, 10);
}

/** 送达能力：3项（Bt平台 / 速度背景 / 密度结构） */
function deliverModel(sw){
  const v = sw.v ?? 0;
  const bt = sw.bt ?? 0;
  const n = sw.n ?? 0;

  const okBt = bt >= 6.5;
  const okV = v >= 430;
  const okN = n >= 2.0;

  const count = (okBt?1:0) + (okV?1:0) + (okN?1:0);

  return {
    count,
    okBt, okV, okN
  };
}

/** 3h 状态机（不分分钟） */
function state3h(sw){
  const v = sw.v ?? 0;
  const bt = sw.bt ?? 0;
  const bz = sw.bz ?? 999;
  const n = sw.n ?? 0;

  // 放宽：只要出现“更南向 + 背景不差”，就算概率上升
  const trig = (bz <= -3.0);
  const bg = (v >= 420 && bt >= 6.0);
  const dense = (n >= 2.0);

  if(trig && bg) return { state:"爆发进行中", hint:"触发更明确，短时内值得马上看。", score: 8.0 };
  if(bg && (dense || trig)) return { state:"爆发概率上升", hint:"系统更容易发生，但未到持续触发。", score: 6.4 };
  if(bg) return { state:"爆发后衰落期", hint:"刚有过波动的概率更高，可能余震一会儿。", score: 5.4 };
  return { state:"静默", hint:"背景不足或触发不清晰，先别投入。", score: 3.0 };
}

/** 云量：取未来3小时内的“最优窗口” */
function bestCloud3h(cloud, baseDate){
  // cloud.hourly.time + low/mid/high arrays
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
    // 评分：低云最重要，其次中云
    const s = (100 - item.low)*0.6 + (100 - item.mid)*0.28 + (100 - item.high)*0.12;
    item.s = s;
    if(!best || item.s > best.s) best = item;
  }
  return best;
}

/** 72h：用 Kp forecast 当能量背景 + 送达能力 + 云量粗评 */
function kpMaxByDay(kpJson){
  // NOAA forecast json: header row + entries: [time_tag, kp, source]
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
    if(!tt || !isFinite(kp)) return;
    const d = new Date(tt);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const cur = map.get(key) ?? -1;
    if(kp > cur) map.set(key, kp);
  });
  return map;
}

/** 72h：按天输出三天 */
function next3DaysLocal(baseDate){
  const arr=[];
  const d0 = new Date(baseDate);
  d0.setHours(0,0,0,0);
  for(let i=0;i<3;i++){
    const d = new Date(d0.getTime() + i*86400000);
    arr.push(d);
  }
  return arr;
}

let chart = null;

function renderChart(labels, values){
  const ctx = $("cChart");
  if(chart) chart.destroy();

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
          grid: { display:false }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx)=> `C值：${round1(ctx.parsed.y)}`
          }
        }
      }
    }
  });
}

function badgeHTML(text, cls){
  return `<span class="badge ${cls}"><span class="bDot"></span>${text}</span>`;
}

function scoreHTML(v){
  return `<span class="scorePill">${round1(v)}</span>`;
}

function setupTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
      document.querySelectorAll(".pane").forEach(p=>p.classList.remove("active"));
      btn.classList.add("active");
      $(btn.dataset.tab).classList.add("active");
    });
  });
}

async function run(){
  const lat = Number($("lat").value);
  const lon = Number($("lon").value);

  if(!isFinite(lat) || !isFinite(lon)){
    setStatusText("请先输入有效经纬度。");
    return;
  }

  setStatusText("拉取数据中…");
  setStatusDots([
    { level:"warn", text:"NOAA 拉取中" },
    { level:"warn", text:"Kp 拉取中" },
    { level:"warn", text:"云量拉取中" },
    { level:"warn", text:"OVATION 拉取中" },
  ]);

  // 位置门槛（地理纬度下限：你之前说 50）
  if(abs(lat) < 50){
    // 直接输出“不可观测”，但不解释原因（按你要求）
    $("oneHeroLabel").textContent = "不可观测";
    $("oneHeroMeta").textContent = "—";
    $("swLine").textContent = "V — ｜ Bt — ｜ Bz — ｜ N —";
    $("swMeta").textContent = "—";
    renderChart(["+10m","+20m","+30m","+40m","+50m","+60m"], [0,0,0,0,0,0]);
    $("threeState").textContent = "静默";
    $("threeHint").textContent = "—";
    $("threeDeliver").textContent = "—";
    $("threeDeliverMeta").textContent = "—";
    $("threeClouds").textContent = "Low —% ｜ Mid —% ｜ High —%";
    $("daysBody").innerHTML = `<tr><td colspan="4" class="muted">不可观测。</td></tr>`;
    setStatusDots([
      { level:"ok", text:"NOAA —" },
      { level:"ok", text:"Kp —" },
      { level:"ok", text:"云量 —" },
      { level:"ok", text:"OVATION —" },
    ]);
    setStatusText("已生成。");
    return;
  }

  // 拉取数据
  const [noaa, kp, clouds, ova] = await Promise.all([
    fetchSWPC2h(),
    fetchKp(),
    fetchClouds(lat, lon),
    fetchOvation()
  ]);

  // 状态点
  const dots = [
    { level: noaa.ok ? "ok" : "bad", text: noaa.note || "NOAA" },
    { level: kp.ok ? "ok" : "bad", text: kp.note || "Kp" },
    { level: clouds.ok ? "ok" : "bad", text: clouds.note || "云量" },
    { level: ova.ok ? "ok" : "bad", text: ova.note || "OVATION" },
  ];
  setStatusDots(dots);

  // 如果 NOAA 都没数据，直接做一个“不可观测”（不弹窗）
  const sw = noaa.data;
  if(!sw){
    $("oneHeroLabel").textContent = "不可观测";
    $("oneHeroMeta").textContent = "—";
    $("swLine").textContent = "V — ｜ Bt — ｜ Bz — ｜ N —";
    $("swMeta").textContent = "—";
    renderChart(["+10m","+20m","+30m","+40m","+50m","+60m"], [0,0,0,0,0,0]);
    setStatusText("部分数据缺失，已用可用数据生成。");
    return;
  }

  // 近实时显示（允许有 null）
  const vTxt = sw.v == null ? "—" : round1(sw.v);
  const btTxt = sw.bt == null ? "—" : round1(sw.bt);
  const bzTxt = sw.bz == null ? "—" : round1(sw.bz);
  const nTxt = sw.n == null ? "—" : round1(sw.n);

  $("swLine").textContent = `V ${vTxt} ｜ Bt ${btTxt} ｜ Bz ${bzTxt} ｜ N ${nTxt}`;
  $("swMeta").textContent = sw.time_tag ? `NOAA 时间：${sw.time_tag}` : "—";

  // 计算磁纬（用于你自己的门槛/边缘判断）
  const mlat = approxMagLat(lat, lon);

  // 1小时：10分钟粒度
  const base = baseScoreFromSW(sw);

  const baseDate = now();
  const labels = [];
  const vals = [];

  let heroC = 0;
  let heroLabel = "—";

  for(let i=0;i<6;i++){
    const d = new Date(baseDate.getTime() + (i+1)*10*60000);

    // 后台：可观测性门槛
    const gate = obsGate(d, lat, lon);

    // 月角因子（按纬度软降权）
    const moonAlt = getMoonAltDeg(d, lat, lon);
    const moonF = moonFactorByLat(lat, moonAlt);

    // 磁纬边缘轻微修正（让漠河这种别被卡死）
    const latBoost = clamp((mlat - 55) / 12, 0, 1); // 55~67
    const latF = 0.85 + latBoost*0.15; // 0.85~1.0

    // 未来1小时无法真正预测 SW 走向：用“缓慢衰减”做保守外推（你之前想要的衰落期思路）
    const decay = Math.pow(0.92, i); // 逐步衰减
    let c = base * decay;

    // 门槛：硬否决直接 0（但不解释）
    if(gate.hardBlock){
      c = 0;
    }else{
      // 不在“更可观测窗口”的时候：做一个温和压制（不让结论胡乱变好）
      if(!gate.inWindow) c *= 0.55;
      // 月角软降权（不露出）
      c *= moonF;
      // 磁纬轻微因子
      c *= latF;
    }

    c = clamp(c, 0, 10);

    labels.push(fmtHM(d));
    vals.push(round1(c));

    if(i === 0){
      heroC = c;
      heroLabel = label1h(c).t;
    }
  }

  // 统一建议层：如果 1h 是“不可观测”，3h 不允许出现“爆发进行中”的强建议（防矛盾）
  const heroObj = label1h(heroC);
  $("oneHeroLabel").textContent = heroObj.t;
  $("oneHeroMeta").textContent = `本地时间：${fmtYMDHM(baseDate)} ・ OVATION：${ova.ok ? (pickOvationForLat(ova.data, lat) ?? "—") : "—"}`;

  renderChart(labels, vals);

  // 3小时：状态机 + 送达能力 + 云量
  let s3 = state3h(sw);
  const del = deliverModel(sw);

  // 3小时同样吃“可观测性门槛”（后台），但不出现说明
  const g3 = obsGate(baseDate, lat, lon);
  const moonAlt3 = getMoonAltDeg(baseDate, lat, lon);
  const moonF3 = moonFactorByLat(lat, moonAlt3);

  let s3score = s3.score;
  if(g3.hardBlock) s3score = 0;
  else{
    if(!g3.inWindow) s3score *= 0.65;
    s3score *= moonF3;
  }

  // 如果 1h 已经不可观测，则 3h 的输出“状态”仍可保留，但“建议层”要收敛
  // 你的要求：把“普通人”体验拉齐 —— 所以这里做统一降档
  if(heroObj.t === "不可观测"){
    if(s3.state === "爆发进行中") s3 = { ...s3, state:"爆发概率上升", hint:"—", score:s3.score };
    if(s3.state === "爆发概率上升") s3 = { ...s3, state:"爆发后衰落期", hint:"—", score:s3.score };
  }

  // 再用分数决定最终展示的状态（避免割裂）
  if(s3score < 3.2) s3 = { ...s3, state:"静默", hint:"—" };
  else if(s3score < 5.0 && s3.state === "爆发进行中") s3 = { ...s3, state:"爆发概率上升", hint:"—" };

  $("threeState").textContent = s3.state;
  $("threeHint").textContent = s3.hint || "—";

  $("threeDeliver").textContent = `${del.count}/3 成立`;
  $("threeDeliverMeta").textContent = `Bt平台${del.okBt ? "✅" : "⚠️"} ・ 速度背景${del.okV ? "✅" : "⚠️"} ・ 密度结构${del.okN ? "✅" : "⚠️"}`;

  let cloudBest = null;
  if(clouds.ok && clouds.data){
    cloudBest = bestCloud3h(clouds.data, baseDate);
  }
  if(cloudBest){
    $("threeClouds").textContent = `Low ${cloudBest.low}% ｜ Mid ${cloudBest.mid}% ｜ High ${cloudBest.high}%`;
  }else{
    $("threeClouds").textContent = `Low —% ｜ Mid —% ｜ High —%`;
  }

  // 72小时：按天
  const days = next3DaysLocal(baseDate);
  const kpMap = kp.ok ? kpMaxByDay(kp.data) : null;

  const tbody = [];
  days.forEach(d=>{
    const key = fmtYMD(d);
    const kpMax = kpMap?.get(key) ?? null;

    // 能量背景：kpMax 3.5~7.0 映射
    const sKp = kpMax == null ? 0.45 : clamp((kpMax - 3.5) / (7.0 - 3.5), 0, 1);

    // 送达能力：用当前 del 作为“背景参考”（你现在 v2 的思路）
    const sDel = del.count / 3; // 0~1

    // 云量：以当天“最低低云 + 中云”近似
    const sCloud = scoreCloudDay(clouds.ok ? clouds.data : null, d);

    // 组合为日 C 值
    let cDay = (sKp*0.48 + sDel*0.32 + sCloud*0.20) * 10;

    // 后台可观测性：按“夜间窗口占比”粗略压制（不展示）
    const nightRatio = estimateNightRatio(d, lat, lon); // 0~1
    cDay *= (0.55 + nightRatio*0.45);

    // 月角因子：温和版
    const mAlt = getMoonAltDeg(new Date(d.getTime()+12*3600*1000), lat, lon);
    const fMoon = soften(moonFactorByLat(lat, mAlt), 0.6);
    cDay *= fMoon;

    cDay = clamp(cDay, 0, 10);

    // 结论
    const lab = label72(cDay);

    // 依据（人话）：按你要求包含“日冕洞与日冕物质抛射模型 / 太阳风送达能力综合模型”
    // 注意：我们不在这里显示“可观测窗口/太阳”等字样
    const basis = [];
    if(kpMax != null) basis.push(`能量背景：Kp峰值≈${round1(kpMax)}`);
    else basis.push(`能量背景：Kp暂无有效数据（保守评估）`);

    basis.push(`日冕洞与日冕物质抛射模型：以 Kp 作为能量背景代理（值越高越有戏）`);
    basis.push(`太阳风送达能力综合模型：当前 ${del.count}/3（Bt/速度/密度）`);

    if(clouds.ok && clouds.data){
      const win = bestCloudHourForDay(clouds.data, d);
      if(win){
        basis.push(`云量更佳点：${win.hh}:00（Low≈${win.low}% Mid≈${win.mid}% High≈${win.high}%）`);
      }else{
        basis.push(`云量：暂无可用点（保守）`);
      }
    }else{
      basis.push(`云量：暂无可用数据（保守）`);
    }

    tbody.push(`
      <tr>
        <td>${key}</td>
        <td>${badgeHTML(lab.t, lab.cls)}</td>
        <td>${scoreHTML(cDay)}</td>
        <td class="muted2">${basis.map(x=>`• ${escapeHTML(x)}`).join("<br/>")}</td>
      </tr>
    `);
  });

  $("daysBody").innerHTML = tbody.join("");

  setStatusText("已生成。");
}

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
function fmtYMDHM(d){
  return `${fmtYMD(d)} ${fmtHM(d)}`;
}

function escapeHTML(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

/** OVATION: 这里不做复杂插值，只给一个“近似参考” */
function pickOvationForLat(ov, lat){
  // ovation json shape differs sometimes; keep simple & safe
  try{
    // 常见字段：ForecastTime / ObservationTime / coordinates etc.
    // 我们只返回一个“有/无”更安全，不引发误解
    if(!ov) return null;
    if(ov.ObservationTime || ov.ForecastTime) return "已拉取";
    return null;
  }catch(e){ return null; }
}

/** 云量日评分：越清越高（0~1） */
function scoreCloudDay(cloud, dayDate){
  if(!cloud?.hourly?.time) return 0.5; // 无数据保守
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
    const item = { low:low[i], mid:mid[i], high:high[i] };
    // 更偏向低云与中云
    const s = (100 - item.low)*0.55 + (100 - item.mid)*0.35 + (100 - item.high)*0.10;
    if(best == null || s > best) best = s;
  }
  if(best == null) return 0.5;
  return clamp(best/100, 0, 1);
}

/** 找到当天最佳云量时刻（用于72h依据人话） */
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

/** 夜间窗口占比估计（后台用，不展示）
 * 目的：避免“白天也给很高”
 */
function estimateNightRatio(dayDate, lat, lon){
  // 粗略：取 24h 每 2 小时采样，看“inWindow”的比例
  let ok = 0, total = 0;
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

function attach(){
  setupTabs();

  $("btnRun").addEventListener("click", run);

  $("btnMag").addEventListener("click", ()=>{
    const lat = Number($("lat").value);
    const lon = Number($("lon").value);
    if(!isFinite(lat) || !isFinite(lon)){
      setStatusText("请先输入有效经纬度。");
      return;
    }
    const m = approxMagLat(lat, lon);
    // 这条是你之前坚持要的弹窗（因为是“转换”动作），我保留
    alert(`磁纬约 ${round1(m)}°`);
  });

  // 初始值（不强求）
  if(!$("lat").value) $("lat").value = "53.47";
  if(!$("lon").value) $("lon").value = "122.35";
}

attach();
