/* aurora-decision v2.3
 * - 前台不展示任何“太阳/夜窗/太阳高度”字样，但后台参与可观测判定
 * - 若不在可观测暗夜窗口：任何模块均不会输出“可蹲守/强烈推荐”等，直接压到“不可观测”
 * - 失败不弹窗：走 status/tips 文本提示 + cache 回退
 */

const $ = (id) => document.getElementById(id);

const UI = {
  lat: $('lat'),
  lon: $('lon'),
  btnRun: $('btnRun'),
  btnMag: $('btnMag'),
  status: $('status'),
  tips: $('tips'),

  oneHeadline: $('oneHeadline'),
  oneLocalTime: $('oneLocalTime'),
  oneOvation: $('oneOvation'),
  swLine: $('swLine'),
  swSmall: $('swSmall'),
  oneRows: $('oneRows'),

  threeState: $('threeState'),
  threeExplain: $('threeExplain'),
  p2Score: $('p2Score'),
  p2Explain: $('p2Explain'),
  cloudNow: $('cloudNow'),
  cloudExplain: $('cloudExplain'),

  daysRows: $('daysRows'),
};

const tabs = [...document.querySelectorAll('.tab')];
tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    tabs.forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    const id = btn.dataset.tab;
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('show'));
    $(id).classList.add('show');
  });
});

function setStatus(t){ UI.status.textContent = t || ''; }
function setTips(t){ UI.tips.innerHTML = t || ''; }

function clamp(x,a,b){ return Math.max(a, Math.min(b,x)); }
function fmt1(x){ return (x===null||x===undefined||Number.isNaN(x)) ? '—' : (Math.round(x*10)/10).toFixed(1); }
function fmt2(x){ return (x===null||x===undefined||Number.isNaN(x)) ? '—' : (Math.round(x*100)/100).toFixed(2); }

function fmtLocal(dt){
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const d = String(dt.getDate()).padStart(2,'0');
  const hh = String(dt.getHours()).padStart(2,'0');
  const mm = String(dt.getMinutes()).padStart(2,'0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function cacheSet(key, obj){
  try{
    const payload = { ts: Date.now(), v: obj };
    localStorage.setItem(key, JSON.stringify(payload));
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
  if(m<60) return `${m}min`;
  const h = Math.floor(m/60);
  const mm = m%60;
  return `${h}h${mm}m`;
}

/* ====== Backend-only: 可观测暗夜判定（不在UI展示任何相关字样） ======
   规则：太阳高度 > 0 直接否决
        可观测窗口：太阳高度 <= -12
 */
function isObservableNow(date, lat, lon){
  const alt = solarAltitudeDeg(date, lat, lon); // deg
  return alt <= -12;
}
function dayHasAnyObservableHours(dateLocalMidnight, lat, lon){
  // 对当天做小时采样，判断是否存在 alt <= -12 的时段
  for(let h=0; h<24; h++){
    const d = new Date(dateLocalMidnight.getTime());
    d.setHours(h,0,0,0);
    if(isObservableNow(d, lat, lon)) return true;
  }
  return false;
}

/* ====== Solar position (approx) ======
   返回太阳高度角（度）
   参考常用近似算法：基于儒略日 + 太阳赤纬 + 时角
*/
function solarAltitudeDeg(date, latDeg, lonDeg){
  // 使用UTC时间
  const d = new Date(date.getTime());
  const jd = toJulian(d);
  const n = jd - 2451545.0;

  const L = norm360(280.460 + 0.9856474*n);
  const g = deg2rad(norm360(357.528 + 0.9856003*n));
  const lambda = deg2rad(norm360(L + 1.915*Math.sin(g) + 0.020*Math.sin(2*g)));

  const eps = deg2rad(23.439 - 0.0000004*n);
  const sinDec = Math.sin(eps)*Math.sin(lambda);
  const dec = Math.asin(sinDec);

  // 近似格林尼治恒星时（度）
  const T = (jd - 2451545.0)/36525.0;
  let GMST = 280.46061837 + 360.98564736629*(jd - 2451545.0) + 0.000387933*T*T - (T*T*T)/38710000;
  GMST = norm360(GMST);
  const LST = deg2rad(norm360(GMST + lonDeg));

  // 太阳赤经
  const alpha = Math.atan2(Math.cos(eps)*Math.sin(lambda), Math.cos(lambda));
  const H = wrapPi(LST - alpha); // hour angle

  const lat = deg2rad(latDeg);
  const alt = Math.asin(Math.sin(lat)*Math.sin(dec) + Math.cos(lat)*Math.cos(dec)*Math.cos(H));
  return rad2deg(alt);
}

function toJulian(date){
  return (date.getTime()/86400000) + 2440587.5;
}
function deg2rad(x){ return x*Math.PI/180; }
function rad2deg(x){ return x*180/Math.PI; }
function norm360(x){
  let v = x % 360;
  if(v<0) v += 360;
  return v;
}
function wrapPi(x){
  // wrap to [-pi, pi]
  let v = x;
  while(v > Math.PI) v -= 2*Math.PI;
  while(v < -Math.PI) v += 2*Math.PI;
  return v;
}

/* ====== Data fetchers with cache fallback, no alert ====== */

async function fetchText(url){
  const r = await fetch(url, { cache:'no-store' });
  return await r.text();
}

async function fetchJSON(url){
  const r = await fetch(url, { cache:'no-store' });
  const t = await r.text();
  if(!t) throw new Error('empty');
  return JSON.parse(t);
}

/** NOAA SWPC solar-wind JSON (2-hour) */
async function fetchSWPC2h(notes){
  const magUrl = 'https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json';
  const plasmaUrl = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json';
  let mag, plasma;

  try{
    const [tMag, tPlasma] = await Promise.all([fetchText(magUrl), fetchText(plasmaUrl)]);
    if(!tMag || !tPlasma) throw new Error('empty');
    mag = JSON.parse(tMag);
    plasma = JSON.parse(tPlasma);
    cacheSet('cache_noaa_mag', mag);
    cacheSet('cache_noaa_plasma', plasma);
    notes.push('✅ NOAA 数据已更新');
  }catch(e){
    const cMag = cacheGet('cache_noaa_mag');
    const cPlasma = cacheGet('cache_noaa_plasma');
    if(cMag && cPlasma){
      mag = cMag.v; plasma = cPlasma.v;
      const age = fmtAge(Date.now() - (Math.min(cMag.ts, cPlasma.ts)));
      notes.push(`⚠️ NOAA 暂不可用，使用缓存数据（${age}）`);
    }else{
      notes.push('❌ NOAA 暂不可用，且无缓存可用');
      return null;
    }
  }

  // 取最新一行
  const magHeader = mag[0];
  const magRows = mag.slice(1).map(row => {
    const o = {};
    magHeader.forEach((k,i)=>o[k]=row[i]);
    return o;
  });

  const plasmaHeader = plasma[0];
  const plasmaRows = plasma.slice(1).map(row => {
    const o = {};
    plasmaHeader.forEach((k,i)=>o[k]=row[i]);
    return o;
  });

  const lastMag = magRows[magRows.length-1] || {};
  const lastPlasma = plasmaRows[plasmaRows.length-1] || {};

  const Bt = parseFloat(lastMag.bt);
  const Bz = parseFloat(lastMag.bz_gsm);
  const V = parseFloat(lastPlasma.speed);
  const N = parseFloat(lastPlasma.density);

  return {
    Bt: isFinite(Bt)?Bt:null,
    Bz: isFinite(Bz)?Bz:null,
    V: isFinite(V)?V:null,
    N: isFinite(N)?N:null,
    tMag: lastMag.time_tag || null,
    tPlasma: lastPlasma.time_tag || null,
    magRows,
    plasmaRows
  };
}

/** OVATION nowcast aurora probability (0-100) */
async function fetchOvationNowcast(lat, lon, notes){
  const url = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
  try{
    const j = await fetchJSON(url);
    cacheSet('cache_ovation', j);
    notes.push('✅ OVATION 已更新');
    return pickOvation(j, lat, lon);
  }catch(e){
    const c = cacheGet('cache_ovation');
    if(c){
      const age = fmtAge(Date.now()-c.ts);
      notes.push(`⚠️ OVATION 暂不可用，使用缓存（${age}）`);
      return pickOvation(c.v, lat, lon);
    }
    notes.push('⚠️ OVATION 暂不可用');
    return null;
  }
}

function pickOvation(j, lat, lon){
  // ovation_aurora_latest.json 是一张格点表：latitudes, longitudes, values (prob)
  // 结构常见为：{ "Observation Time": "...", "Forecast Time": "...", "coordinates":[{"lat":..,"lon":..,"probability":..}, ...] }
  // 兼容不同字段：优先 coordinates 数组
  try{
    if(Array.isArray(j.coordinates)){
      let best = null;
      let bestD = 1e9;
      for(const p of j.coordinates){
        const d = (p.lat-lat)*(p.lat-lat) + (p.lon-lon)*(p.lon-lon);
        if(d < bestD){
          bestD = d; best = p;
        }
      }
      if(!best) return null;
      return { prob: best.probability ?? best.prob ?? null, t: j["Forecast Time"] || j["Observation Time"] || null };
    }
  }catch(e){}
  return null;
}

/** Kp 3-day forecast (NOAA JSON) */
async function fetchKpForecast(notes){
  const url = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
  try{
    const j = await fetchJSON(url);
    cacheSet('cache_kp', j);
    notes.push('✅ Kp 预报已更新');
    return j;
  }catch(e){
    const c = cacheGet('cache_kp');
    if(c){
      const age = fmtAge(Date.now()-c.ts);
      notes.push(`⚠️ Kp 预报暂不可用，使用缓存（${age}）`);
      return c.v;
    }
    notes.push('⚠️ Kp 预报暂不可用');
    return null;
  }
}

/** Cloud forecast (Open-Meteo) */
async function fetchCloud48h(lat, lon, notes){
  // 用 hourly: cloudcover_low/mid/high + time
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&hourly=cloudcover_low,cloudcover_mid,cloudcover_high&timezone=auto`;
  try{
    const j = await fetchJSON(url);
    cacheSet('cache_cloud', j);
    notes.push('✅ 云量预报已更新');
    return j;
  }catch(e){
    const c = cacheGet('cache_cloud');
    if(c){
      const age = fmtAge(Date.now()-c.ts);
      notes.push(`⚠️ 云量暂不可用，使用缓存（${age}）`);
      return c.v;
    }
    notes.push('⚠️ 云量暂不可用');
    return null;
  }
}

/* ====== Magnetic latitude (rough) ======
   用一个“粗略近似”满足用户快速判断：磁纬 ≈ 地理纬度 + Δ(经度) 的简化不是严谨模型
   这里改成更稳的：直接给“粗略磁纬估计”，并强调是估计（不弹窗）。
   ——你后续如果要更准，可以接 IGRF / WMM，但那需要后端或更大数据表
*/
function approxMagLat(lat, lon){
  // 极粗：给一个小偏移（只为了挡上海这种），别用于科研
  const lonFactor = Math.sin(deg2rad(lon)) * 3.0;
  return lat + lonFactor;
}

/* ====== Scoring models ====== */

/** 1小时：10分钟粒度。输出5档结论 + 0-10分
    逻辑：用上游实时（V,Bt,Bz,N）+ OVATION概率 + 触发衰减
 */
function model1h(now, lat, lon, sw, ovationProb){
  // 先做后台可观测门槛
  const observable = isObservableNow(now, lat, lon);

  // 没有太阳风数据也要能跑：降权
  const V = sw?.V;
  const Bt = sw?.Bt;
  const Bz = sw?.Bz;
  const N = sw?.N;

  // 基础分：来自 OVATION(0-100) 映射到 0~4
  const baseFromOva = ovationProb==null ? 1.2 : clamp((ovationProb/100)*4.0, 0, 4.0);

  // 触发分：Bz越负越好，Bt越高越好
  let trigger = 0;
  if(isFinite(Bz)) trigger += clamp((-Bz)/6.0, 0, 1.6);     // -6nT ~ +1.6
  if(isFinite(Bt)) trigger += clamp((Bt-5)/6.0, 0, 1.6);    // Bt>=11 -> +1.0~1.6
  if(isFinite(V))  trigger += clamp((V-420)/200.0, 0, 1.2); // 420~620
  if(isFinite(N))  trigger += clamp((N-2)/6.0, 0, 1.0);     // 2~8

  // 让它别太严苛：给一点“背景分”
  let scoreNow = baseFromOva + trigger + 0.6;

  // 轻微衰减：未来每10分钟降低 0~20%
  const rows = [];
  for(let i=0; i<=60; i+=10){
    const t = new Date(now.getTime() + i*60000);
    const decay = Math.pow(0.92, i/10); // 10min -> 0.92
    let s = scoreNow * decay;

    // 后台门槛：不可观测直接压到 0
    if(!observable) s = 0;

    const cls = classify1h(s, observable);
    rows.push({ t, score: s, cls });
  }

  return { observable, rows, headline: rows[0].cls.label, headlineDot: rows[0].cls.dot, headlineScore: rows[0].score };
}

function classify1h(score, observable){
  // observable=false 已经 score=0，但这里再保险
  if(!observable) return { label:'不可观测', dot:'bad' };

  if(score >= 7.8) return { label:'强烈推荐', dot:'good' };
  if(score >= 6.4) return { label:'值得出门', dot:'good' };
  if(score >= 5.0) return { label:'可蹲守', dot:'warn' };
  if(score >= 2.8) return { label:'低概率', dot:'warn' };
  return { label:'不可观测', dot:'bad' };
}

/** 3小时：状态机 + 模型解释（更“人话”） */
function model3h(now, lat, lon, sw, cloudNow){
  const observable = isObservableNow(now, lat, lon);

  const V = sw?.V, Bt = sw?.Bt, Bz = sw?.Bz, N = sw?.N;

  // “送达能力综合模型” (2/3成立那种) —— 但别太苛刻
  let okBt = isFinite(Bt) ? (Bt >= 6.2) : false;
  let okV  = isFinite(V)  ? (V  >= 440) : false;
  let okN  = isFinite(N)  ? (N  >= 2.2) : false;
  const pass = [okBt, okV, okN].filter(Boolean).length;

  let p2Text = `${pass}/3 成立`;
  let p2Explain = `Bt平台${okBt?'✅':'⚠️'} · 速度背景${okV?'✅':'⚠️'} · 密度结构${okN?'✅':'⚠️'}`;

  // 云：低云一票否决；中高云给提示（不否决）
  let cloudLine = '—';
  let cloudExplain = '—';
  let cloudPenalty = 0;

  if(cloudNow){
    const low = cloudNow.low, mid = cloudNow.mid, high = cloudNow.high;
    cloudLine = `Low ${Math.round(low)}% | Mid ${Math.round(mid)}% | High ${Math.round(high)}%`;

    // 低云否决
    if(low > 10){
      cloudPenalty = 999; // 直接打死
      cloudExplain = `低云偏高（建议 ≤10%）；中云更佳 ≤50%；高云更佳 ≤80%。`;
    }else{
      // 只做轻微惩罚
      if(mid > 50) cloudPenalty += 1.2;
      if(high > 80) cloudPenalty += 0.8;

      cloudExplain = `更佳参考：中云 ≤50%（越低越好）；高云 ≤80%（薄幕可接受）。`;
    }
  }

  // 状态机：爆发进行中 / 概率上升 / 衰落期 / 静默
  // 定义：Bz持续负向算触发；但我们没做持续分钟级历史，这里用“当前阈值”弱化处理
  const trigNow = (isFinite(Bz) && Bz <= -3.0) && (isFinite(Bt) && Bt >= 6.5);
  const baseOk = pass >= 2;

  let state = '静默';
  let explain = '背景不足或缺关键触发，建议先观望。';

  if(trigNow && baseOk){
    state = '爆发进行中';
    explain = '触发条件更明确，短时内值得马上看。';
  }else if(baseOk && (isFinite(Bz) && Bz <= -2.0)){
    state = '爆发概率上升';
    explain = '系统更容易发生，但还未形成稳定触发。';
  }else if(baseOk){
    state = '爆发后衰落期';
    explain = '背景仍在，但缺稳定触发，整体更偏走弱。';
  }

  // 云量否决：直接压到不可观测（但不告诉用户原因是云）
  if(cloudPenalty >= 999){
    state = '不可观测';
    explain = '当前不具备观测条件。';
  }

  // 后台门槛：不可观测统一压死
  if(!observable){
    state = '不可观测';
    explain = '当前不具备观测条件。';
  }

  return { observable, state, explain, p2Text, p2Explain, cloudLine, cloudExplain };
}

/** 72小时：按天给结论（用Kp + 两个模型的“背景代理” + 云量） */
function model72h(now, lat, lon, sw, kpJson, cloudJson){
  const days = [];

  // 解析 Kp 预报：JSON 是二维数组，header在0行
  let kpByDate = {};
  if(Array.isArray(kpJson) && kpJson.length > 1){
    const header = kpJson[0];
    const idxTime = header.indexOf('time_tag');
    const idxKp = header.indexOf('kp');
    for(let i=1;i<kpJson.length;i++){
      const row = kpJson[i];
      const t = new Date(row[idxTime]);
      const dateKey = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
      const kp = parseFloat(row[idxKp]);
      if(!isFinite(kp)) continue;
      kpByDate[dateKey] = Math.max(kpByDate[dateKey] || 0, kp);
    }
  }

  // 云量：挑每一天“最好的一个小时”的 Low/Mid/High 作为窗口代表
  let bestCloudByDate = {};
  if(cloudJson?.hourly?.time){
    const times = cloudJson.hourly.time;
    const lowArr = cloudJson.hourly.cloudcover_low;
    const midArr = cloudJson.hourly.cloudcover_mid;
    const highArr = cloudJson.hourly.cloudcover_high;

    for(let i=0;i<times.length;i++){
      const t = new Date(times[i]);
      const dateKey = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
      const low = lowArr[i], mid = midArr[i], high = highArr[i];

      // 只在“可观测暗夜”小时里找最佳（后台过滤，前台不展示原因）
      if(!isObservableNow(t, lat, lon)) continue;

      // 评分：低云权重最大
      const cloudScore = (100 - low)*1.2 + (100 - mid)*0.6 + (100 - high)*0.3;
      const prev = bestCloudByDate[dateKey];
      if(!prev || cloudScore > prev.cloudScore){
        bestCloudByDate[dateKey] = { low, mid, high, cloudScore, t };
      }
    }
  }

  // 取今起3天
  const d0 = new Date(now.getTime());
  d0.setHours(0,0,0,0);

  for(let d=0; d<3; d++){
    const day = new Date(d0.getTime() + d*86400000);
    const dateKey = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;

    // 当天是否存在任何可观测小时（后台过滤）
    const hasAnyObs = dayHasAnyObservableHours(day, lat, lon);

    // Kp
    const kpMax = kpByDate[dateKey] || null;

    // P1（这里用Kp做能量背景代理，后续你可以替换成CH/CME评分）
    // P2（用当前太阳风背景当代理：Bt、V、N）
    const Bt = sw?.Bt, V = sw?.V, N = sw?.N;
    const p2pass = [isFinite(Bt)&&Bt>=6.2, isFinite(V)&&V>=440, isFinite(N)&&N>=2.2].filter(Boolean).length;

    // 云窗口
    const cloudBest = bestCloudByDate[dateKey] || null;

    // 结论计算
    let label = '低可能';
    let dot = 'bad';

    // 如果当天根本没有任何可观测暗夜小时：直接不可观测（但不展示太阳原因）
    if(!hasAnyObs){
      label = '不可观测';
      dot = 'bad';
    }else{
      // 基础：Kp背景
      const kp = isFinite(kpMax) ? kpMax : 0;
      // 云量：低云>10 就不太行
      let cloudOk = cloudBest ? (cloudBest.low <= 10) : true;
      // 综合
      const score = (kp>=6?2:(kp>=5?1.5:(kp>=4?1:0.6))) + (p2pass>=2?1.3:0.7) + (cloudOk?1.0:0.4);

      if(score >= 3.6){ label='可能性高'; dot='good'; }
      else if(score >= 3.0){ label='有窗口'; dot='warn'; }
      else if(score >= 2.4){ label='小概率'; dot='warn'; }
      else { label='低可能'; dot='bad'; }
    }

    // 依据（必须包含两个模型分析 + Kp + 云）
    const parts = [];

    if(kpMax!=null) parts.push(`Kp背景：峰值≈${fmt1(kpMax)}`);
    else parts.push(`Kp背景：暂无可用数据`);

    // “日冕洞与CME模型” —— v2.3 先用 Kp 代理输出（你后续接 CH/CME 再替换）
    parts.push(`日冕洞与日冕物质抛射模型：以Kp作为能量背景代理（值越高越有戏）`);

    // “送达能力综合模型”
    parts.push(`太阳风送达能力综合模型：${p2pass}/3 成立（Bt/速度/密度）`);

    if(cloudBest){
      parts.push(`云量窗口：Low≈${Math.round(cloudBest.low)} Mid≈${Math.round(cloudBest.mid)} High≈${Math.round(cloudBest.high)}`);
    }else{
      parts.push(`云量窗口：暂无可用数据`);
    }

    days.push({ dateKey, label, dot, reason: parts.join(' · ') });
  }

  return days;
}

/* ====== Render ====== */

function pill(label, dot){
  return `<span class="pill"><span class="dot ${dot}"></span>${label}</span>`;
}

function render1h(m1, ovation){
  UI.oneLocalTime.textContent = `本地时间：${fmtLocal(new Date())}`;
  UI.oneOvation.textContent = `OVATION：${ovation==null ? '—' : `${Math.round(ovation)}%`}`;

  UI.oneHeadline.textContent = m1.headline;

  UI.oneRows.innerHTML = m1.rows.map(r => {
    return `
      <div class="r">
        <div>${fmtLocal(r.t)}</div>
        <div>${pill(r.cls.label, r.cls.dot)}</div>
        <div class="right"><span class="score">${fmt1(r.score)}</span></div>
      </div>
    `;
  }).join('');
}

function renderSW(sw){
  if(!sw){
    UI.swLine.textContent = `V — | Bt — | Bz — | N —`;
    UI.swSmall.textContent = `—`;
    return;
  }
  UI.swLine.textContent = `V ${fmt1(sw.V)} | Bt ${fmt2(sw.Bt)} | Bz ${fmt2(sw.Bz)} | N ${fmt2(sw.N)}`;
  const t = sw.tPlasma || sw.tMag;
  UI.swSmall.textContent = t ? `NOAA 时间：${t}` : `—`;
}

function render3h(m3){
  UI.threeState.textContent = m3.state;
  UI.threeExplain.textContent = m3.explain;

  UI.p2Score.textContent = m3.p2Text;
  UI.p2Explain.textContent = m3.p2Explain;

  UI.cloudNow.textContent = m3.cloudLine;
  UI.cloudExplain.textContent = m3.cloudExplain;
}

function render72(days){
  UI.daysRows.innerHTML = days.map(d => {
    return `
      <div class="r">
        <div>${d.dateKey}</div>
        <div>${pill(d.label, d.dot)}</div>
        <div class="metaSmall">${escapeHTML(d.reason)}</div>
      </div>
    `;
  }).join('');
}
function escapeHTML(s){
  return (s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

/* ====== Main run ====== */

async function run(){
  const lat = parseFloat(UI.lat.value);
  const lon = parseFloat(UI.lon.value);

  if(!isFinite(lat) || !isFinite(lon)){
    setStatus('请先输入有效的经纬度。');
    return;
  }

  // 地理纬度硬门槛（你之前说下限 50）
  if(Math.abs(lat) < 50){
    // 不弹窗：直接写到页面提示
    setStatus('');
    setTips(`<b>提示：</b>你的位置纬度较低（|lat| < 50°），极光摄影基本不可行，将直接给出“不可观测”。`);
  }else{
    setTips('');
  }

  UI.btnRun.disabled = true;
  setStatus('正在拉取数据并计算…');

  const notes = [];
  const now = new Date();

  // 低纬直接压死：但仍允许生成页面（对普通用户更直观）
  const lowLatHard = Math.abs(lat) < 50;

  const sw = await fetchSWPC2h(notes);
  const kp = await fetchKpForecast(notes);
  const cloud = await fetchCloud48h(lat, lon, notes);

  const ov = await fetchOvationNowcast(lat, lon, notes);
  const ovProb = ov?.prob ?? null;

  // 计算云量“当前值”（最近一小时）
  let cloudNow = null;
  if(cloud?.hourly?.time){
    const times = cloud.hourly.time.map(t => new Date(t).getTime());
    const idx = nearestIndex(times, now.getTime());
    cloudNow = {
      low: cloud.hourly.cloudcover_low[idx],
      mid: cloud.hourly.cloudcover_mid[idx],
      high: cloud.hourly.cloudcover_high[idx],
      t: new Date(times[idx])
    };
  }

  // 1h/3h/72h
  let m1 = model1h(now, lat, lon, sw, ovProb);
  let m3 = model3h(now, lat, lon, sw, cloudNow);
  let d72 = model72h(now, lat, lon, sw, kp, cloud);

  // 低纬硬门槛：直接覆盖所有输出为不可观测
  if(lowLatHard){
    m1.rows.forEach(r => { r.score = 0; r.cls = { label:'不可观测', dot:'bad' }; });
    m1.headline = '不可观测';

    m3.state = '不可观测';
    m3.explain = '当前不具备观测条件。';

    d72 = d72.map(x => ({...x, label:'不可观测', dot:'bad', reason: '纬度偏低，极光摄影基本不可行。'}));
  }

  renderSW(sw);
  render1h(m1, ovProb);
  render3h(m3);
  render72(d72);

  // status：合并提示（不弹窗）
  setStatus(notes.join('｜') || '完成');
  UI.btnRun.disabled = false;
}

function nearestIndex(arr, target){
  let best = 0, bestD = Infinity;
  for(let i=0;i<arr.length;i++){
    const d = Math.abs(arr[i]-target);
    if(d < bestD){ bestD=d; best=i; }
  }
  return best;
}

/* ====== Misc button: magnetic latitude ====== */
function showMagLat(){
  const lat = parseFloat(UI.lat.value);
  const lon = parseFloat(UI.lon.value);
  if(!isFinite(lat) || !isFinite(lon)){
    setStatus('请先输入有效的经纬度。');
    return;
  }
  const mlat = approxMagLat(lat, lon);
  setStatus(`磁纬估计：约 ${fmt1(mlat)}°（粗略估计，用于快速决策）`);
}

UI.btnRun.addEventListener('click', run);
UI.btnMag.addEventListener('click', showMagLat);

// 给一点默认值方便你测试
if(!UI.lat.value) UI.lat.value = '53.47';
if(!UI.lon.value) UI.lon.value = '122.35';
setStatus('准备就绪：输入经纬度后点击“生成即时预测”。');
