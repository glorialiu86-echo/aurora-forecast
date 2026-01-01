function deg2rad(d){ return d * Math.PI / 180; }
function rad2deg(r){ return r * 180 / Math.PI; }

// 粗略磁纬计算（用于决策下限，不追求高精度）
function approxMagLat(lat, lon){
  // 近似磁北极位置（够用）
  const poleLat = 80.6;
  const poleLon = -72.7;

  const latR = deg2rad(lat), lonR = deg2rad(lon);
  const pLatR = deg2rad(poleLat), pLonR = deg2rad(poleLon);

  const r = [
    Math.cos(latR) * Math.cos(lonR),
    Math.cos(latR) * Math.sin(lonR),
    Math.sin(latR)
  ];
  const m = [
    Math.cos(pLatR) * Math.cos(pLonR),
    Math.cos(pLatR) * Math.sin(pLonR),
    Math.sin(pLatR)
  ];

  const dot = r[0]*m[0] + r[1]*m[1] + r[2]*m[2];
  return rad2deg(Math.asin(Math.max(-1, Math.min(1, dot))));
}
const LEVELS = ['强烈推荐','可以拍','观望','不建议','放弃'];
const COLOR = {
  '强烈推荐': '#1f8f4a',
  '可以拍':   '#45b36b',
  '观望':     '#f3c969',
  '不建议':   '#8a8f99',
  '放弃':     '#5b5f66'
};

const $ = (id) => document.getElementById(id);

function setStatus(msg){ $('status').textContent = msg || ''; }

function parseUTCOffset(tzStr){
  // tzStr like "UTC+8" / "UTC-5" / "UTC+0"
  const m = tzStr.match(/^UTC([+-])(\d{1,2})$/);
  if (!m) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  const h = Number(m[2]);
  return sign * h * 60; // minutes
}

function parseLocalTimeToUTC(localStr, tzStr){
  // localStr: "YYYY-MM-DD HH:mm"
  const m = localStr.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) throw new Error('时间格式应为 YYYY-MM-DD HH:mm');
  const [_, Y, Mo, D, H, Mi] = m;
  const offsetMin = parseUTCOffset(tzStr);
  // UTC = local - offset
  const utcMs = Date.UTC(+Y, +Mo-1, +D, +H, +Mi) - offsetMin*60*1000;
  return new Date(utcMs);
}

function fmtLocalHour(dUTC, tzStr){
  const offsetMin = parseUTCOffset(tzStr);
  const ms = dUTC.getTime() + offsetMin*60*1000;
  const d = new Date(ms);
  const pad = (n)=>String(n).padStart(2,'0');
  return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:00`;
}

function addHours(d, h){ return new Date(d.getTime() + h*3600*1000); }

/**
 * NOAA SWPC solar-wind JSON
 * 2-hour products are arrays with header row at index 0.
 */
async function fetchSWPC2h(){
  const magUrl = 'https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json';
  const plasmaUrl = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json';

  const [mag, plasma] = await Promise.all([
    fetch(magUrl, { cache: 'no-store' }).then(r=>r.json()),
    fetch(plasmaUrl, { cache: 'no-store' }).then(r=>r.json())
  ]);

  const magHeader = mag[0];
  const plasmaHeader = plasma[0];

  const magRows = mag.slice(1).map(row => {
    const o = {};
    magHeader.forEach((k,i)=>o[k]=row[i]);
    return o;
  });

  const plasmaRows = plasma.slice(1).map(row => {
    const o = {};
    plasmaHeader.forEach((k,i)=>o[k]=row[i]);
    return o;
  });

  // merge by time_tag
  const map = new Map();
  for (const r of magRows){
    const t = r.time_tag || r.time || r.timestamp;
    if (!t) continue;
    const bt = Number(r.bt);
    const bz = Number(r.bz_gsm ?? r.bz);
    if (!map.has(t)) map.set(t, { time: new Date(t + 'Z') });
    Object.assign(map.get(t), { bt, bz });
  }
  for (const r of plasmaRows){
    const t = r.time_tag || r.time || r.timestamp;
    if (!t) continue;
    const v = Number(r.speed);
    const n = Number(r.density);
    if (!map.has(t)) map.set(t, { time: new Date(t + 'Z') });
    Object.assign(map.get(t), { v, n });
  }

  const series = Array.from(map.values())
    .filter(x => x.time instanceof Date && !isNaN(x.time))
    .sort((a,b)=>a.time - b.time);

  return series;
}

function mean(arr){
  const v = arr.filter(x=>Number.isFinite(x));
  if (!v.length) return NaN;
  return v.reduce((a,b)=>a+b,0)/v.length;
}
function std(arr){
  const v = arr.filter(x=>Number.isFinite(x));
  if (v.length < 2) return NaN;
  const m = mean(v);
  const s2 = v.reduce((a,b)=>a+(b-m)*(b-m),0)/(v.length-1);
  return Math.sqrt(s2);
}

function computeSolarFeatures(series){
  // use last 120 minutes for plateau/trigger signals
  if (!series.length) throw new Error('SWPC 数据为空');

  const last = series[series.length-1];
  const lastTime = last.time;

  const window = series.filter(x => (lastTime - x.time) <= 120*60*1000);

  const btArr = window.map(x=>x.bt);
  const bzArr = window.map(x=>x.bz);
  const vArr  = window.map(x=>x.v);
  const nArr  = window.map(x=>x.n);

  // Bt plateau proxy: std small + mean above threshold
  const btMean = mean(btArr);
  const btStd  = std(btArr);

  // consecutive minutes bz <= -2 near end
  let bzMinutes = 0;
  for (let i=window.length-1;i>=0;i--){
    const bz = window[i].bz;
    if (!Number.isFinite(bz)) break;
    if (bz <= -2) bzMinutes++;
    else break;
  }

  // sawtooth proxy: too many sign flips in last 60 minutes
  const w60 = window.filter(x => (lastTime - x.time) <= 60*60*1000);
  let flips = 0;
  let prev = null;
  for (const x of w60){
    if (!Number.isFinite(x.bz)) continue;
    const s = x.bz >= 0 ? 1 : -1;
    if (prev !== null && s !== prev) flips++;
    prev = s;
  }
  const bzSaw = flips >= 6; // heuristic

  return {
    now: {
      time: lastTime,
      bt: last.bt, bz: last.bz, v: last.v, n: last.n
    },
    btMean, btStd,
    vMean: mean(vArr),
    nMean: mean(nArr),
    bzMinutes,
    bzSaw
  };
}

/**
 * Open-Meteo cloud cover (low/mid/high), hourly.
 * We request a date range covering 72h.
 */
async function fetchClouds(lat, lon, startUTC, hours, tzStr){
  const offsetH = parseUTCOffset(tzStr)/60;
  const tzParam = `GMT${offsetH>=0?'+':''}${offsetH}`;

  const startDate = startUTC.toISOString().slice(0,10);
  const endDate = addHours(startUTC, hours).toISOString().slice(0,10);

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('hourly', 'cloud_cover_low,cloud_cover_mid,cloud_cover_high');
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  url.searchParams.set('timezone', tzParam);

  const json = await fetch(url.toString(), { cache: 'no-store' }).then(r=>r.json());
  const h = json.hourly;
  if (!h || !h.time) throw new Error('云量数据返回异常');

  const out = h.time.map((t, i) => ({
    // time here is LOCAL time string under timezone=tzParam
    timeLocalStr: t,
    low: Number(h.cloud_cover_low?.[i] ?? NaN),
    mid: Number(h.cloud_cover_mid?.[i] ?? NaN),
    high: Number(h.cloud_cover_high?.[i] ?? NaN),
  }));

  return out;
}

/** ---- 模型（v0.1）：P1占位 + P2/P3可用 ----
 * 注意：静态站无法真正“预测未来太阳风”，所以 v0.1 使用“当前上游条件”作为 72h 背景，
 * 真正变化来自：云量（未来72h）+ 触发条件（当前是否打开/平台化等）
 */
function evalP1_placeholder(){
  return '⚠️'; // 先不给整段否决，后续你接 CH/CME 再升级
}

function evalP2(features){
  const speedOK = Number.isFinite(features.vMean) && features.vMean >= 420;
  const btPlateau = Number.isFinite(features.btMean) && features.btMean >= 6 && Number.isFinite(features.btStd) && features.btStd <= 1.5;
  const densityOK = Number.isFinite(features.nMean) && features.nMean >= 2;

  if (speedOK && btPlateau && densityOK) return '✅';
  if (speedOK || btPlateau) return '⚠️';
  return '❌';
}

function evalP3(features, cloud){
  const v = features.now.v;
  const bt = features.now.bt;
  const n = features.now.n;

  const visible = (v >= 450) && (bt >= 7) && (n >= 3);
  const bzOpen = (features.bzMinutes >= 10) && (!features.bzSaw); // bz<=-2连续由bzMinutes代表
  const skyOK = (cloud.low <= 10) && (cloud.mid <= 50) && (cloud.high <= 80);

  const can = visible && bzOpen && skyOK;

  const reason = [];
  reason.push(visible ? `能量满足 (V/Bt/N)` : `能量不足 (V/Bt/N)`);
  reason.push(bzOpen ? `Bz 打开 (连续≥10min)` : `Bz 未稳定 (连续<10min 或锯齿)`);
  reason.push(skyOK ? `天空可用 (low/mid/high)` : `云量不佳 (low/mid/high)`);

  return { can, visible, bzOpen, skyOK, reason };
}
function combineLevel(p1, p2, p3){
  // 硬否决：P1不允许或你前面的纬度门槛已拦截
  if (p1 === '❌') return '放弃';

  // 以P3为主：这一小时到底值不值得折腾
  // 1) 云不行：直接不建议
  if (!p3.skyOK) return '不建议';

  // 2) 能量不足：直接不建议（不再因为 P2⚠️ 就给观望）
  if (!p3.visible) return '不建议';

  // 3) Bz 没开：观望（等开机）
  if (!p3.bzOpen) return '观望';

  // 走到这：P3三关都过 = 可以拍
  // P2只负责“升档”，不负责“把你困在观望”
  if (p2 === '✅' && p1 === '✅') return '强烈推荐';

  return '可以拍';
}

function renderTable(hoursUTC, tzStr, levels, reasons){
  const out = $('out');
  out.innerHTML = '';

  const legend = document.createElement('div');
  legend.className = 'legend';
  LEVELS.forEach(l=>{
    const b = document.createElement('div');
    b.className = 'badge';
    b.innerHTML = `<span class="dot" style="background:${COLOR[l]}"></span>${l}`;
    legend.appendChild(b);
  });
  out.appendChild(legend);

  const wrap = document.createElement('div');
  wrap.className = 'tableWrap';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  const th0 = document.createElement('th');
  th0.textContent = '';
  trh.appendChild(th0);

  hoursUTC.forEach(d=>{
    const th = document.createElement('th');
    th.textContent = fmtLocalHour(d, tzStr);
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  LEVELS.forEach((rowLevel)=>{
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.textContent = rowLevel;
    tr.appendChild(tdLabel);

    for (let i=0;i<levels.length;i++){
      const td = document.createElement('td');
      td.className = 'cell';
      const isHit = levels[i] === rowLevel;
      td.style.background = isHit ? COLOR[rowLevel] : '#0f1420';
      td.title = reasons[i]?.join(' / ') || '';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  out.appendChild(wrap);

  const note = document.createElement('small');
  note.innerHTML = `注：v0.1 太阳风部分为“近实时 nowcast 延伸”，未来将接入 CH/CME（P1）与更完整的 P2 时间演化。`;
  out.appendChild(note);
}

async function run(){
  const lat = Number($('lat').value);
  const lon = Number($('lon').value);
  const tz = $('tz').value;
  const localTime = $('localTime').value.trim();
  // —— 摄影经验纬度下限（地理纬度）——
const alat = Math.abs(lat);
if (alat < 50) {
  alert(`地理纬度 ${alat.toFixed(1)}°，低于摄影可行下限（50°）。\n该纬度仅在极端太阳风暴下才可能可见，默认判「放弃」。`);
  setStatus(`放弃：地理纬度 ${alat.toFixed(1)}° < 50°`);
  return;
}
  
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    alert('纬度应在 -90 到 90'); return;
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    alert('经度应在 -180 到 180'); return;
  }
  if (!localTime) { alert('请填写当地时间'); return; }

  $('run').disabled = true;
  setStatus('拉取 NOAA / 云量数据中…');

  try{
    const T0 = parseLocalTimeToUTC(localTime, tz);

    const [swpcSeries, clouds] = await Promise.all([
      fetchSWPC2h(),
      fetchClouds(lat, lon, T0, 72, tz)
    ]);

    const features = computeSolarFeatures(swpcSeries);

    const p1 = evalP1_placeholder();
    const p2 = evalP2(features);

    const hoursUTC = Array.from({length:72}, (_,i)=> addHours(T0, i));
    const levels = [];
    const reasons = [];

    for (let i=0;i<72;i++){
      const cloud = clouds[i] || { low: 100, mid: 100, high: 100 };
      const p3 = evalP3(features, cloud);
      const level = combineLevel(p1, p2, p3);
      levels.push(level);
      reasons.push(p3.reason);
    }

    setStatus(`完成：P1=${p1} P2=${p2} | NOAA时间=${features.now.time.toISOString().slice(0,16)}Z`);
    renderTable(hoursUTC, tz, levels, reasons);

  }catch(e){
    console.error(e);
    alert(String(e?.message || e));
    setStatus('失败：请看控制台 Console');
  }finally{
    $('run').disabled = false;
  }
}

window.addEventListener('DOMContentLoaded', ()=>{
  $('run').addEventListener('click', run);

  // 给你个默认示例，方便第一次就看到结果
  $('lat').value = '65.01';
  $('lon').value = '-18.75';
  $('tz').value = 'UTC+0';

  const now = new Date();
  const pad = (n)=>String(n).padStart(2,'0');
  // 默认用你当前电脑时间填一个格式（不含时区语义，只是占位）
  $('localTime').value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} 22:00`;
});
