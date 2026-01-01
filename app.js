// Aurora Decision v2.2
// - 加入太阳高度：>0° 一票否决；夜窗门槛 -12°
// - 每个Tab内有分级说明
// - 所有结论/状态放大
// - 72h 依据增加“日冕洞与日冕物质抛射模型 / 太阳风送达能力综合模型”分析（人话+代理）

const $ = (id) => document.getElementById(id);

const H1_MINUTES = 60;
const H1_STEP = 10;
const DAYS = 3;

function setStatus(s){ $('status').textContent = s; }
function setNote(s){ $('note').textContent = s || ''; }

function pad(n){ return String(n).padStart(2,'0'); }
function fmtLocal(d){
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtHM(d){ return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function addMin(d, m){ return new Date(d.getTime() + m*60000); }
function addHour(d, h){ return new Date(d.getTime() + h*3600000); }

function cacheSet(key, obj){ try{ localStorage.setItem(key, JSON.stringify(obj)); }catch{} }
function cacheGet(key){ try{ const t=localStorage.getItem(key); return t?JSON.parse(t):null; }catch{ return null; } }
function fmtAge(ms){
  const m = Math.round(ms/60000);
  if (m < 60) return `${m} 分钟前`;
  const h = m/60;
  return `${h.toFixed(h < 10 ? 1 : 0)} 小时前`;
}
async function fetchJSONWithFallback(url, label, cacheKey, notes){
  const now = Date.now();
  try{
    const res = await fetch(url, { cache:'no-store' });
    if(!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    if(!text) throw new Error('empty');
    const data = JSON.parse(text);
    cacheSet(cacheKey, { ts: now, data });
    notes.push(`✅ ${label} 已更新`);
    return { data, ts: now, stale:false };
  }catch(e){
    const c = cacheGet(cacheKey);
    if(c?.data){
      notes.push(`⚠️ ${label}接口暂时无法拉取目前数据，将使用此前最新数据做解析（${fmtAge(now-c.ts)}）`);
      return { data:c.data, ts:c.ts, stale:true };
    }
    notes.push(`❌ ${label}接口无法拉取，且本地无历史缓存`);
    return { data:null, ts:null, stale:true };
  }
}

// ---------- 太阳高度（简化天文算法：足够用于 0°/-12° 门槛判断） ----------
function deg2rad(x){ return x*Math.PI/180; }
function rad2deg(x){ return x*180/Math.PI; }

function julianDay(date){
  // UTC
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth()+1;
  const D = date.getUTCDate()
    + (date.getUTCHours() + (date.getUTCMinutes() + date.getUTCSeconds()/60)/60)/24;

  let A = Math.floor((14 - m)/12);
  let Y = y + 4800 - A;
  let M = m + 12*A - 3;

  let JDN = Math.floor(D)
    + Math.floor((153*M + 2)/5)
    + 365*Y
    + Math.floor(Y/4)
    - Math.floor(Y/100)
    + Math.floor(Y/400)
    - 32045;

  // add fractional day
  const frac = D - Math.floor(D);
  return JDN + frac - 0.5;
}

function solarElevationDeg(date, lat, lon){
  // Based on common NOAA-style approximations (good enough for twilight thresholds)
  // date: JS Date (local ok) but we compute using UTC inside
  const jd = julianDay(date);
  const T = (jd - 2451545.0)/36525.0;

  // Sun mean longitude
  let L0 = 280.46646 + T*(36000.76983 + T*0.0003032);
  L0 = ((L0 % 360) + 360) % 360;

  // Sun mean anomaly
  const M = 357.52911 + T*(35999.05029 - 0.0001537*T);

  // eccentricity
  const e = 0.016708634 - T*(0.000042037 + 0.0000001267*T);

  // equation of center
  const C = (1.914602 - T*(0.004817 + 0.000014*T))*Math.sin(deg2rad(M))
          + (0.019993 - 0.000101*T)*Math.sin(deg2rad(2*M))
          + 0.000289*Math.sin(deg2rad(3*M));

  const trueLong = L0 + C;

  // apparent longitude
  const omega = 125.04 - 1934.136*T;
  const lambda = trueLong - 0.00569 - 0.00478*Math.sin(deg2rad(omega));

  // obliquity
  const eps0 = 23 + (26 + ((21.448 - T*(46.815 + T*(0.00059 - T*0.001813))))/60)/60;
  const eps = eps0 + 0.00256*Math.cos(deg2rad(omega));

  // declination
  const sinDec = Math.sin(deg2rad(eps))*Math.sin(deg2rad(lambda));
  const dec = rad2deg(Math.asin(sinDec));

  // equation of time (minutes)
  const y = Math.tan(deg2rad(eps/2))*Math.tan(deg2rad(eps/2));
  const Etime = 4 * rad2deg(
    y*Math.sin(2*deg2rad(L0)) - 2*e*Math.sin(deg2rad(M))
    + 4*e*y*Math.sin(deg2rad(M))*Math.cos(2*deg2rad(L0))
    - 0.5*y*y*Math.sin(4*deg2rad(L0))
    - 1.25*e*e*Math.sin(2*deg2rad(M))
  );

  // true solar time
  const utcMin = date.getUTCHours()*60 + date.getUTCMinutes() + date.getUTCSeconds()/60;
  const tst = (utcMin + Etime + 4*lon) % 1440; // lon east positive
  const ha = (tst/4 < 0) ? (tst/4 + 180) : (tst/4 - 180); // hour angle in degrees

  // elevation
  const latRad = deg2rad(lat);
  const decRad = deg2rad(dec);
  const haRad = deg2rad(ha);

  const sinEl = Math.sin(latRad)*Math.sin(decRad) + Math.cos(latRad)*Math.cos(decRad)*Math.cos(haRad);
  let el = rad2deg(Math.asin(sinEl));

  // crude refraction correction near horizon (optional, keep simple)
  if(el > -1 && el < 90){
    const refr = 1.02 / Math.tan(deg2rad(el + 10.3/(el+5.11))) / 60; // deg
    el += refr;
  }
  return el;
}

function lightGateLabel(el){
  if(el > 0) return '白天（不可观测）';
  if(el > -12) return '暮光（可见性很差）';
  return '夜窗（可拍）';
}

// ---------- NOAA ----------
async function fetchOvation(notes){
  const url = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
  const r = await fetchJSONWithFallback(url, 'OVATION(30–90min)', 'cache_ovation_latest', notes);
  return r.data || null;
}

async function fetchSWPC2h(notes){
  const magUrl = 'https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json';
  const plasmaUrl = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json';

  const magR = await fetchJSONWithFallback(magUrl, 'NOAA磁场', 'cache_mag_2h', notes);
  const plaR = await fetchJSONWithFallback(plasmaUrl, 'NOAA等离子体', 'cache_plasma_2h', notes);
  if(!magR.data || !plaR.data) return null;

  const mag = magR.data, plasma = plaR.data;
  const magH = mag[0], plaH = plasma[0];

  const magRows = mag.slice(1).map(row => Object.fromEntries(magH.map((k,i)=>[k,row[i]])));
  const plaRows = plasma.slice(1).map(row => Object.fromEntries(plaH.map((k,i)=>[k,row[i]])));

  const map = new Map();

  for(const r of magRows){
    const t = r.time_tag || r.time || r.timestamp;
    if(!t) continue;
    if(!map.has(t)) map.set(t, { time: new Date(t+'Z') });
    map.get(t).bt = Number(r.bt);
    map.get(t).bz = Number(r.bz_gsm ?? r.bz);
  }

  const pick = (obj, keys) => {
    for(const k of keys){
      const v = obj[k];
      if(v !== undefined && v !== null && v !== '') return Number(v);
    }
    return NaN;
  };

  for(const r of plaRows){
    const t = r.time_tag || r.time || r.timestamp;
    if(!t) continue;
    if(!map.has(t)) map.set(t, { time: new Date(t+'Z') });
    map.get(t).v = pick(r, ['speed','flow_speed','V','v']);
    map.get(t).n = pick(r, ['density','proton_density','N','n']);
  }

  const series = Array.from(map.values())
    .filter(x => x.time instanceof Date && !isNaN(x.time))
    .sort((a,b)=>a.time-b.time);

  return { series };
}

async function fetchKpForecast(notes){
  const url = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
  const r = await fetchJSONWithFallback(url, 'Kp三日预报', 'cache_kp_3day', notes);
  return r.data || null;
}

// ---------- 云量 ----------
async function fetchClouds3Days(lat, lon, notes){
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('hourly', 'cloud_cover_low,cloud_cover_mid,cloud_cover_high');
  url.searchParams.set('forecast_days', String(DAYS));
  url.searchParams.set('timezone', 'auto');

  const r = await fetchJSONWithFallback(url.toString(), '云量', 'cache_cloud_3d', notes);
  const j = r.data;
  if(!j?.hourly?.time) return null;

  const h = j.hourly;
  return h.time.map((t,i)=>({
    timeLocal: new Date(t),
    low: Number(h.cloud_cover_low?.[i] ?? NaN),
    mid: Number(h.cloud_cover_mid?.[i] ?? NaN),
    high:Number(h.cloud_cover_high?.[i] ?? NaN),
  }));
}

// ---------- helpers ----------
function mean(arr){
  const v = arr.filter(x=>Number.isFinite(x));
  if(!v.length) return NaN;
  return v.reduce((a,b)=>a+b,0)/v.length;
}
function std(arr){
  const v = arr.filter(x=>Number.isFinite(x));
  if(v.length<2) return NaN;
  const m = mean(v);
  const s2 = v.reduce((a,b)=>a+(b-m)*(b-m),0)/(v.length-1);
  return Math.sqrt(s2);
}

// ---------- OVATION point ----------
function ovationValueAt(ovation, lat, lon){
  if(!ovation?.coordinates?.length) return NaN;
  const lonN = ((lon % 360) + 360) % 360;
  const lonI = Math.round(lonN);
  const latI = Math.round(lat);
  if(latI < -90 || latI > 90) return NaN;
  const idx = (latI + 90) * 360 + lonI;
  const p = ovation.coordinates[idx]?.[2];
  return Number(p);
}

// ---------- features ----------
function computeFeatures(series){
  if(!series?.length) return null;
  const last = series[series.length-1];
  const t0 = last.time;

  const w120 = series.filter(x => (t0 - x.time) <= 120*60*1000);
  const w60  = series.filter(x => (t0 - x.time) <= 60*60*1000);

  let bzMinutes = 0;
  for(let i=w120.length-1;i>=0;i--){
    const bz = w120[i].bz;
    if(!Number.isFinite(bz)) break;
    if(bz <= -2) bzMinutes++;
    else break;
  }

  const bzTouches = w60.filter(x => Number.isFinite(x.bz) && x.bz <= -1.0).length;

  let flips = 0;
  let prev = null;
  for(const x of w60){
    if(!Number.isFinite(x.bz)) continue;
    const s = x.bz >= 0 ? 1 : -1;
    if(prev !== null && s !== prev) flips++;
    prev = s;
  }
  const bzSaw = flips >= 7;

  const btArr = w60.map(x=>x.bt);
  const vArr  = w60.map(x=>x.v);
  const nArr  = w60.map(x=>x.n);

  const btMean = mean(btArr);
  const btStd  = std(btArr);
  const vMean  = mean(vArr);
  const nMean  = mean(nArr);

  const btPlatform = (btMean >= 5.5) && (btStd <= 1.8);
  const vOk = vMean >= 400;
  const nBack = nMean >= 1.6;
  const nRebounds = w60.filter(x=>Number.isFinite(x.n) && x.n >= 3).length >= 4;
  const hadStrongBz = w60.some(x=>Number.isFinite(x.bz) && x.bz <= -4);

  // deliver score 0..3（用于72h“兑现度参考”）
  const deliverCount = (btPlatform?1:0) + (vOk?1:0) + ((nBack||nRebounds)?1:0);

  return {
    now:last,
    t0,
    bzMinutes,
    bzTouches,
    bzSaw,
    btMean, btStd, btPlatform,
    vMean, vOk,
    nMean, nBack, nRebounds,
    hadStrongBz,
    deliverCount
  };
}

// ---------- 3h state machine ----------
function classifyState(f){
  if(!f?.now) return { state:'未知', reason:['缺少近实时太阳风数据'] };

  const { bzMinutes, btPlatform, vOk, nBack, nRebounds, bzSaw, bzTouches, hadStrongBz } = f;
  const p2Count = (btPlatform?1:0) + (vOk?1:0) + ((nBack||nRebounds)?1:0);
  const deliverReady = p2Count >= 2;

  if(deliverReady && (bzMinutes >= 8 || (Number.isFinite(f.now.bz) && f.now.bz <= -3))){
    return {
      state:'爆发进行中',
      reason:[
        `触发成立：Bz南向持续≈${bzMinutes}min（或出现更强南向）`,
        `太阳风送达能力综合模型：${p2Count}/3 成立`,
        `锯齿：${bzSaw ? '偏明显（但仍在爆发态）' : '不明显'}`
      ]
    };
  }

  if((hadStrongBz || bzTouches >= 18) && bzMinutes < 2 && (bzSaw || !btPlatform)){
    return {
      state:'爆发后衰落期',
      reason:[
        `近1h 发生过较强南向/频繁触及（触及≈${bzTouches}）`,
        `当前连续南向不足（≈${bzMinutes}min）`,
        `平台/方向趋于松散（锯齿或平台破坏）`
      ]
    };
  }

  if(deliverReady && bzTouches >= 6){
    return {
      state:'爆发概率上升',
      reason:[
        `太阳风送达能力综合模型：${p2Count}/3 成立（“更容易发生”）`,
        `Bz 近1h 多次触及南向（触及≈${bzTouches}）`,
        `尚未形成持续触发（连续<8min）`
      ]
    };
  }

  return {
    state:'静默',
    reason:[
      `太阳风送达能力综合模型：${p2Count}/3（不足以支撑爆发态）`,
      `Bz 触及南向偏少（≈${bzTouches}）`,
      `建议：只在出现持续南向时再提高关注`
    ]
  };
}

// ---------- 1h scoring（5档） ----------
function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }

function scoreTo5(score10, sunEl){
  if(sunEl > 0) return '不可观测';
  if(score10 >= 8.5) return '强烈推荐';
  if(score10 >= 6.8) return '值得出门';
  if(score10 >= 5.0) return '可蹲守';
  if(score10 >= 3.0) return '低概率';
  return '不建议';
}

function getCSS(v){ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function dotColorByLabel(label){
  if(label === '不可观测') return getCSS('--g0');
  if(label === '强烈推荐') return getCSS('--g3');
  if(label === '值得出门') return getCSS('--g2');
  if(label === '可蹲守') return getCSS('--g1');
  if(label === '低概率') return getCSS('--y1');
  return getCSS('--r2');
}

function score1h(prob, f, minutesAhead, sunEl){
  // 太阳高度 >0：一票否决
  if(sunEl > 0){
    return { score10: 0.0, label: '不可观测' };
  }

  // 更松底盘
  const ovBase = Number.isFinite(prob) ? clamp((prob/30)*10, 0, 10) : 0;

  let floor = 0;
  if(f?.btPlatform || f?.vOk) floor = 2.0;
  if((f?.btPlatform && f?.vOk) || (f?.nBack || f?.nRebounds)) floor = 3.0;
  if((f?.bzTouches ?? 0) >= 10) floor = Math.max(floor, 3.6);

  let base = Math.max(ovBase, floor);

  let trigger = 0;
  if(f?.bzMinutes >= 8 && (f?.now?.bz ?? 0) <= -2) trigger += 2.2;
  else if((f?.bzTouches ?? 0) >= 8) trigger += 1.4;
  else if((f?.bzTouches ?? 0) >= 4) trigger += 0.8;

  if(f?.bzSaw) trigger -= 0.6;

  // 时间衰减
  const decay = Math.exp(-minutesAhead / 55);
  let s = base + trigger * decay;

  // 暮光区（0 到 -12）：强制降权（但不否决）
  if(sunEl > -12){
    s *= 0.45; // 很难看见，但给“还有一点点可能”以免全0
  }

  s = clamp(s, 0, 10);
  const label = scoreTo5(s, sunEl);
  return { score10: Number(s.toFixed(1)), label };
}

// ---------- 72h summarize ----------
function parseKpForecast(kpJson){
  if(!Array.isArray(kpJson) || kpJson.length < 2) return [];
  const header = kpJson[0];
  const rows = kpJson.slice(1).map(r => Object.fromEntries(header.map((k,i)=>[k,r[i]])));
  return rows.map(r => ({
    time: new Date((r.time_tag || r.time || r.timestamp) + 'Z'),
    kp: Number(r.kp ?? r.Kp ?? r['Kp Index'] ?? NaN)
  })).filter(x => x.time instanceof Date && !isNaN(x.time) && Number.isFinite(x.kp));
}

function dayKey(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

function cloudWindowOK(hour){
  // 低云一票否决（<=10 才算窗口）
  return Number.isFinite(hour.low) && hour.low <= 10;
}

function bestWindowForDay(dayClouds, lat, lon){
  // 只在“夜窗（<=-12）”里选最佳云量小时
  let best = null;
  for(const h of dayClouds){
    const el = solarElevationDeg(h.timeLocal, lat, lon);
    if(el > -12) continue; // 夜窗门槛
    if(!cloudWindowOK(h)) continue;

    // 更偏好 mid/high 更低（但不苛刻）
    const mid = Number.isFinite(h.mid) ? h.mid : 100;
    const high = Number.isFinite(h.high) ? h.high : 100;
    const score = (100 - mid)*0.6 + (100 - high)*0.4; // 越大越好

    if(!best || score > best.score){
      best = { h, el, score };
    }
  }
  return best;
}

function hasNightWindow(dayClouds, lat, lon){
  // 是否存在连续>=2小时 太阳高度<=-12（按小时数据粗判）
  const nightFlags = dayClouds.map(h => solarElevationDeg(h.timeLocal, lat, lon) <= -12);
  let run = 0;
  for(const f of nightFlags){
    run = f ? run+1 : 0;
    if(run >= 2) return true;
  }
  return false;
}

function chanceFromKp(kpVal){
  if(!Number.isFinite(kpVal)) return '低可能';
  if(kpVal >= 6) return '可能性高';
  if(kpVal >= 5) return '有窗口';
  if(kpVal >= 4) return '小概率';
  return '低可能';
}

function deliverText(deliverCount){
  // deliverCount 0..3
  if(deliverCount >= 3) return '送达能力偏强（更容易把能量背景兑现到可观测事件）';
  if(deliverCount === 2) return '送达能力中等（需要等待触发条件配合）';
  if(deliverCount === 1) return '送达能力偏弱（就算有背景也可能“雷声大雨点小”）';
  return '送达能力很弱（更像静默）';
}

function summarize72h(kpSeries, clouds, lat, lon, f){
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0);

  const deliverCount = f?.deliverCount ?? 0;

  const days = [];
  for(let i=0;i<DAYS;i++){
    const d0 = addHour(start, i*24);
    const key = dayKey(d0);

    const kpMax = Math.max(...kpSeries.filter(x => dayKey(x.time)===key).map(x=>x.kp), -Infinity);
    const kpVal = Number.isFinite(kpMax) ? kpMax : NaN;

    const dayClouds = (clouds||[]).filter(x => dayKey(x.timeLocal)===key);
    const nightOK = hasNightWindow(dayClouds, lat, lon);
    const best = bestWindowForDay(dayClouds, lat, lon);

    // 72h 结论：能量背景（代理）+ 夜窗 + 云窗
    let chance = chanceFromKp(kpVal);
    if(!nightOK) {
      // 没夜窗就算kp高也很难“观测/拍摄”
      chance = '不可观测';
    } else if(!best) {
      // 有夜窗但云窗差：降一级（但不直接否决）
      if(chance === '可能性高') chance = '有窗口';
      else if(chance === '有窗口') chance = '小概率';
      else if(chance === '小概率') chance = '低可能';
    }

    const explain = [];

    // 模型名要求：写“日冕洞与日冕物质抛射模型 / 太阳风送达能力综合模型”
    if(Number.isFinite(kpVal)){
      explain.push(`日冕洞与日冕物质抛射模型：以三日Kp预报峰值≈${kpVal.toFixed(1)} 作为“能量背景代理”（越高越有戏）`);
    }else{
      explain.push('日冕洞与日冕物质抛射模型：Kp预报缺失（能量背景不明，按保守处理）');
    }

    explain.push(`太阳风送达能力综合模型：当前为 ${deliverCount}/3 → ${deliverText(deliverCount)}`);

    // 夜窗与太阳门槛
    explain.push(nightOK ? '太阳高度：存在夜窗（<= -12°）' : '太阳高度：无夜窗（<= -12°），当日观测基本不可行');

    // 云窗
    if(best){
      const h = best.h;
      const el = best.el;
      explain.push(`云量窗口：${fmtHM(h.timeLocal)} 更好（Low=${h.low} Mid=${h.mid} High=${h.high}；太阳高度≈${el.toFixed(1)}°）`);
    } else {
      explain.push('云量窗口：夜窗内未找到 Low<=10 的小时（更像“拍不到”）');
    }

    days.push({ date:key, chance, explain });
  }
  return days;
}

// ---------- render ----------
function renderLegends(){
  $('legend1h').innerHTML = `
    <h3>1小时结论分级说明（5档）</h3>
    <ul>
      <li><b>不可观测</b>：太阳高度 > 0°（白天），直接否决。</li>
      <li><b>强烈推荐</b>：夜窗内，综合条件很强，值得立即行动。</li>
      <li><b>值得出门</b>：夜窗内，中高概率；建议出门或提前到位。</li>
      <li><b>可蹲守</b>：夜窗内，条件有但不稳；建议架好设备、盯触发变化。</li>
      <li><b>低概率</b>：夜窗内，小概率；只建议低成本尝试。</li>
      <li><b>不建议</b>：夜窗内但整体偏弱；不值得投入成本。</li>
      <li>注：若处于 <b>暮光（0° 到 -12°）</b>，会自动大幅降权（仍可能保留“低概率/可蹲守”的提示）。</li>
    </ul>
  `;

  $('legend3h').innerHTML = `
    <h3>3小时状态分级说明（4态）</h3>
    <ul>
      <li><b>爆发进行中</b>：触发条件已成立，短时内最值得盯。</li>
      <li><b>爆发概率上升</b>：系统更容易发生，但还没到“持续触发”。</li>
      <li><b>爆发后衰落期</b>：刚过爆发，余温在掉；更像“还能撑一会儿”。</li>
      <li><b>静默</b>：背景不足或触发很弱；更像等下一波。</li>
      <li>注：若当前太阳高度 > 0°，虽然系统状态仍会计算，但<b>观测/摄影不可行</b>。</li>
    </ul>
  `;

  $('legend72h').innerHTML = `
    <h3>72小时结论分级说明（按天）</h3>
    <ul>
      <li><b>不可观测</b>：当日无夜窗（太阳高度<=-12°的连续窗口不足），基本拍不了。</li>
      <li><b>可能性高 / 有窗口 / 小概率 / 低可能</b>：综合“能量背景代理 + 送达能力参考 + 夜窗 + 云窗”的范围判断。</li>
      <li>注：72小时是“范围预测”，不输出具体时间点；时间点由 1小时/3小时模块决定。</li>
    </ul>
  `;
}

function render1h(lat, lon, ovation, f){
  const box = $('out1h');
  const now = new Date();
  const prob = ovationValueAt(ovation, lat, lon);

  const rows = [];
  for(let m=0;m<=H1_MINUTES;m+=H1_STEP){
    const t = addMin(now, m);
    const el = solarElevationDeg(t, lat, lon);
    const r = score1h(prob, f, m, el);
    rows.push({ t, el, light: lightGateLabel(el), ...r });
  }

  const head = rows[0] || { score10:0.0, label:'不建议', el:0 };
  const elNow = solarElevationDeg(now, lat, lon);

  box.innerHTML = `
    <div class="row">
      <div class="kpi">
        <div class="t">当前建议（1小时内，10分钟粒度）</div>
        <div class="v">${head.label}</div>
        <div class="s">
          本地时间：${fmtLocal(now)} ｜ 太阳高度≈${elNow.toFixed(1)}°（${lightGateLabel(elNow)}）
          ｜ OVATION 近似概率：${Number.isFinite(prob)?`${prob}%`:'—'}
        </div>
      </div>

      <div class="kpi">
        <div class="t">实时太阳风（近实时）</div>
        <div class="v">
          ${f?.now ? `V ${Number.isFinite(f.now.v)?f.now.v:'—'} ｜ Bt ${Number.isFinite(f.now.bt)?f.now.bt:'—'} ｜ Bz ${Number.isFinite(f.now.bz)?f.now.bz:'—'} ｜ N ${Number.isFinite(f.now.n)?f.now.n:'—'}` : '—'}
        </div>
        <div class="s">${f ? `Bz连续南向≈${f.bzMinutes}min ｜ 触及≈${f.bzTouches} ｜ 锯齿:${f.bzSaw?'是':'否'}` : '缺少太阳风数据'}</div>
      </div>
    </div>

    <table class="table" style="margin-top:10px">
      <thead>
        <tr>
          <th>时间（本地）</th>
          <th>太阳</th>
          <th>结论</th>
          <th>参考分(0-10)</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(x=>`
          <tr>
            <td class="time">${fmtLocal(x.t)}</td>
            <td class="pill">${x.light}</td>
            <td class="judge">
              <span class="badge"><span class="dot" style="background:${dotColorByLabel(x.label)}"></span>${x.label}</span>
            </td>
            <td><span class="pill">${x.score10}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function render3h(stateObj, f, lat, lon){
  const box = $('out3h');
  const now = new Date();
  const elNow = solarElevationDeg(now, lat, lon);
  const light = lightGateLabel(elNow);

  const color =
    stateObj.state.includes('进行中') ? getCSS('--g3') :
    stateObj.state.includes('上升') ? getCSS('--g2') :
    stateObj.state.includes('衰落') ? getCSS('--y1') :
    stateObj.state.includes('静默') ? getCSS('--r2') : getCSS('--g0');

  const p2Count = f?.deliverCount ?? 0;

  // 太阳>0°：观测否决，但状态仍显示（给用户解释）
  const obsLabel = (elNow > 0) ? '不可观测' : '可观测窗口内';
  const obsColor = (elNow > 0) ? getCSS('--g0') : getCSS('--g2');

  box.innerHTML = `
    <div class="row">
      <div class="kpi">
        <div class="t">观测门槛（太阳）</div>
        <div class="v"><span class="badge"><span class="dot" style="background:${obsColor}"></span>${obsLabel}</span></div>
        <div class="s">太阳高度≈${elNow.toFixed(1)}°（${light}）｜门槛：>0° 否决；夜窗：<= -12°</div>
      </div>

      <div class="kpi">
        <div class="t">系统状态（未来3小时不分分钟）</div>
        <div class="v"><span class="badge"><span class="dot" style="background:${color}"></span>${stateObj.state}</span></div>
        <div class="s">${stateObj.reason.map(x=>`• ${x}`).join('<br/>')}</div>
      </div>

      <div class="kpi">
        <div class="t">太阳风送达能力综合模型</div>
        <div class="v">${f ? `${p2Count}/3 成立` : '—'}</div>
        <div class="s">
          ${f ? `Bt平台:${f.btPlatform?'✅':'⚠️'}（均值≈${Number.isFinite(f.btMean)?f.btMean.toFixed(1):'—'}）
          ｜ 速度:${f.vOk?'✅':'⚠️'}（≈${Number.isFinite(f.vMean)?f.vMean.toFixed(0):'—'}）
          ｜ 密度:${(f.nBack||f.nRebounds)?'✅':'⚠️'}（≈${Number.isFinite(f.nMean)?f.nMean.toFixed(1):'—'}）`
          : '缺少太阳风数据'}
        </div>
      </div>
    </div>
  `;
}

function render72h(days){
  const box = $('out72h');
  box.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>日期（本地）</th>
          <th>结论</th>
          <th>依据（人话）</th>
        </tr>
      </thead>
      <tbody>
        ${days.map(d=>`
          <tr>
            <td class="time">${d.date}</td>
            <td class="judge">
              <span class="badge"><span class="dot" style="background:${
                d.chance === '不可观测' ? getCSS('--g0') :
                d.chance.includes('高')?getCSS('--g3'):
                d.chance.includes('窗口')?getCSS('--g2'):
                d.chance.includes('小')?getCSS('--y1'):getCSS('--r2')
              }"></span>${d.chance}</span>
            </td>
            <td style="text-align:left">${d.explain.map(x=>`• ${x}`).join('<br/>')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ---------- Tabs ----------
function switchTab(id){
  document.querySelectorAll('.tab').forEach(b=>{
    b.classList.toggle('active', b.dataset.tab === id);
  });
  document.querySelectorAll('.panel').forEach(p=>{
    p.classList.toggle('active', p.id === id);
  });
}

// ---------- main ----------
async function run(){
  const lat = Number($('lat').value);
  const lon = Number($('lon').value);
  if(!Number.isFinite(lat) || lat < -90 || lat > 90){ setStatus('纬度应在 -90 到 90'); return; }
  if(!Number.isFinite(lon) || lon < -180 || lon > 180){ setStatus('经度应在 -180 到 180'); return; }

  $('run').disabled = true;
  setStatus('拉取数据中…');
  setNote('');

  try{
    const notes = [];
    const [ovation, swpc, kpJ, clouds] = await Promise.all([
      fetchOvation(notes),
      fetchSWPC2h(notes),
      fetchKpForecast(notes),
      fetchClouds3Days(lat, lon, notes),
    ]);

    setNote(notes.join('｜'));

    const f = swpc?.series ? computeFeatures(swpc.series) : null;

    // 1h
    if(ovation){
      render1h(lat, lon, ovation, f);
    }else{
      $('out1h').innerHTML = 'OVATION 数据不可用（无缓存则无法生成 1 小时精准预测）。';
    }

    // 3h
    const st = classifyState(f);
    render3h(st, f, lat, lon);

    // 72h
    const kpSeries = kpJ ? parseKpForecast(kpJ) : [];
    const days = summarize72h(kpSeries, clouds, lat, lon, f);
    render72h(days);

    renderLegends();

    setStatus(`完成｜本地时间：${fmtLocal(new Date())}`);
  }catch(e){
    setStatus(`异常：${String(e?.message || e)}`);
  }finally{
    $('run').disabled = false;
  }
}

function swapLatLon(){
  const a = $('lat').value;
  $('lat').value = $('lon').value;
  $('lon').value = a;
}

window.addEventListener('DOMContentLoaded', ()=>{
  document.querySelectorAll('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=>switchTab(btn.dataset.tab));
  });

  $('run').addEventListener('click', run);
  $('swap').addEventListener('click', swapLatLon);

  // 默认测试点（你可改）
  $('lat').value = '53.47';
  $('lon').value = '122.35';

  renderLegends();
});
