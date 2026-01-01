const HORIZON_HOURS = 48;

// ====== 工具：DOM ======
const $ = (id) => document.getElementById(id);
function setStatus(msg){ $('status').textContent = msg || ''; }
function setDataNote(msg){ $('dataNote').textContent = msg || ''; }

// ====== 工具：时间/时区 ======
function parseUTCOffset(tzStr){
  const m = tzStr.match(/^UTC([+-])(\d{1,2})$/);
  if (!m) return 0;
  const sign = m[1] === '+' ? 1 : -1;
  return sign * Number(m[2]) * 60; // minutes
}
function parseLocalTimeToUTC(localStr, tzStr){
  const m = localStr.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) throw new Error('时间格式应为 YYYY-MM-DD HH:mm');
  const [_, Y, Mo, D, H, Mi] = m;
  const offsetMin = parseUTCOffset(tzStr);
  const utcMs = Date.UTC(+Y, +Mo-1, +D, +H, +Mi) - offsetMin*60*1000;
  return new Date(utcMs);
}
function addHours(d, h){ return new Date(d.getTime() + h*3600*1000); }
function fmtLocalHour(dUTC, tzStr){
  const offsetMin = parseUTCOffset(tzStr);
  const ms = dUTC.getTime() + offsetMin*60*1000;
  const d = new Date(ms);
  const pad = (n)=>String(n).padStart(2,'0');
  return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:00`;
}
function fmtAge(ms){
  const m = Math.round(ms/60000);
  if (m < 60) return `${m} 分钟前`;
  const h = m/60;
  return `${h.toFixed(h < 10 ? 1 : 0)} 小时前`;
}

// ====== 工具：缓存（localStorage） ======
function cacheSet(key, obj){
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch {}
}
function cacheGet(key){
  try {
    const t = localStorage.getItem(key);
    return t ? JSON.parse(t) : null;
  } catch { return null; }
}

// 拉取JSON：成功写缓存；失败用缓存；都没有返回 null。不会弹窗。
async function fetchJSONWithFallback(url, label, cacheKey, notes){
  const now = Date.now();
  try{
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    if (!text) throw new Error('empty');
    const data = JSON.parse(text);

    cacheSet(cacheKey, { ts: now, data });
    notes.push(`✅ ${label} 已更新`);
    return { data, ts: now, stale: false };
  }catch(e){
    const cached = cacheGet(cacheKey);
    if (cached?.data){
      const age = fmtAge(now - cached.ts);
      notes.push(`⚠️ ${label}接口暂时无法拉取目前数据，将使用此前最新数据做解析（${age}）`);
      return { data: cached.data, ts: cached.ts, stale: true };
    }
    notes.push(`❌ ${label}接口暂时无法拉取目前数据，且本地暂无可用历史数据`);
    return { data: null, ts: null, stale: true };
  }
}

// ====== 评分配色（0-10） ======
function scoreColor(s){
  // 0..10 -> red -> yellow -> green
  // 手写一条“自然渐变”（不依赖库）
  if (s <= 0) return '#2a2f3a';
  if (s <= 2) return '#5b3b3b';
  if (s <= 4) return '#7b4e42';
  if (s <= 6) return '#8b7a44';
  if (s <= 7) return '#7aa04e';
  if (s <= 8) return '#4ea56a';
  if (s <= 9) return '#2f9a64';
  return '#1f8f4a';
}
function scoreLabel(s){
  // 普通人行动建议（不再出现“观望”）
  if (s >= 10) return '强烈推荐：立刻出门/架机';
  if (s >= 9) return '很值得拍：赶紧到位';
  if (s >= 8) return '可以拍：已解锁可见';
  if (s >= 7) return '建议准备：到位等待触发';
  if (s >= 6) return '可以蹲点：不建议远行';
  if (s >= 5) return '看窗口：顺路可试';
  if (s >= 4) return '低概率：别专程';
  if (s >= 3) return '基本没戏：不出门';
  if (s >= 1) return '不建议：不出门';
  return '0分否决：放弃';
}

// ====== 纬度分段（你现在采用地理纬度经验法） ======
function latBand(absLat){
  if (absLat >= 67) return '极高纬';
  if (absLat >= 62) return '中高纬';
  if (absLat >= 55) return '边缘纬';
  if (absLat >= 50) return '极端边缘';
  return '低纬';
}
function cloudThresholds(band){
  // 来自你 v1.4（并对 50-55 更苛刻）
  if (band === '极高纬') return { lowMax: 5,  midMax: 20, midIdeal: 10, highMax: 40, highIdeal: 25, keywords:'星点锐利 / 银河可见 / 对比强' };
  if (band === '中高纬') return { lowMax: 10, midMax: 30, midIdeal: 20, highMax: 60, highIdeal: 45, keywords:'北向暗区仍在 / 星点未完全消失' };
  if (band === '边缘纬') return { lowMax: 10, midMax: 50, midIdeal: 35, highMax: 80, highIdeal: 65, keywords:'不厚到吃星就行 / 薄幕OK' };
  if (band === '极端边缘') return { lowMax: 8,  midMax: 30, midIdeal: 20, highMax: 50, highIdeal: 35, keywords:'只谈极端事件 / 要求更苛刻' };
  return { lowMax: 0,  midMax: 0,  midIdeal: 0,  highMax: 0,  highIdeal: 0,  keywords:'' };
}

// ====== NOAA SWPC 近实时（2小时） ======
async function fetchSWPC2h(notes){
  const magUrl = 'https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json';
  const plasmaUrl = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json';

  const magR = await fetchJSONWithFallback(magUrl, 'NOAA磁场', 'cache_noaa_mag2h', notes);
  const plasmaR = await fetchJSONWithFallback(plasmaUrl, 'NOAA等离子体', 'cache_noaa_plasma2h', notes);

  if (!magR.data || !plasmaR.data) return null;

  const mag = magR.data;
  const plasma = plasmaR.data;

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

  return { series, ts: Math.min(magR.ts ?? Date.now(), plasmaR.ts ?? Date.now()) };
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

// 从近2小时里提取“当前状态 + Bz连续 + 锯齿”
function computeSolarFeatures(series){
  if (!series?.length) return null;

  const last = series[series.length-1];
  const lastTime = last.time;

  const w120 = series.filter(x => (lastTime - x.time) <= 120*60*1000);
  const w60  = series.filter(x => (lastTime - x.time) <= 60*60*1000);

  const btArr = w120.map(x=>x.bt);
  const bzArr = w120.map(x=>x.bz);
  const vArr  = w120.map(x=>x.v);
  const nArr  = w120.map(x=>x.n);

  // bz 连续分钟（每行基本是 1 分钟）
  let bzMinutes = 0;
  for (let i=w120.length-1;i>=0;i--){
    const bz = w120[i].bz;
    if (!Number.isFinite(bz)) break;
    if (bz <= -2) bzMinutes++;
    else break;
  }

  // 锯齿：60分钟内翻转过多
  let flips = 0;
  let prev = null;
  for (const x of w60){
    if (!Number.isFinite(x.bz)) continue;
    const s = x.bz >= 0 ? 1 : -1;
    if (prev !== null && s !== prev) flips++;
    prev = s;
  }
  const bzSaw = flips >= 6;

  return {
    now: { time:lastTime, bt:last.bt, bz:last.bz, v:last.v, n:last.n },
    btMean: mean(btArr),
    btStd: std(btArr),
    vMean: mean(vArr),
    nMean: mean(nArr),
    bzMinutes,
    bzSaw
  };
}

// ====== 云量（Open-Meteo） ======
async function fetchClouds(lat, lon, startUTC, hours, tzStr, notes){
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

  const cloudR = await fetchJSONWithFallback(url.toString(), '云量', 'cache_cloud_om', notes);
  const json = cloudR.data;
  if (!json?.hourly?.time) return null;

  const h = json.hourly;
  return h.time.map((t, i) => ({
    timeLocalStr: t,
    low: Number(h.cloud_cover_low?.[i] ?? NaN),
    mid: Number(h.cloud_cover_mid?.[i] ?? NaN),
    high: Number(h.cloud_cover_high?.[i] ?? NaN),
  }));
}

// ====== 评分模型 v1.5（P3主导，10档） ======
function scoreSky(cloud, band){
  const th = cloudThresholds(band);

  const low = cloud?.low;
  const mid = cloud?.mid;
  const high = cloud?.high;

  // 低云一票否决
  if (Number.isFinite(low) && low > th.lowMax){
    return {
      veto: true,
      score: 0,
      tips: [
        `低云 Low=${low}% > ${th.lowMax}%（一票否决）`,
        `判读关键词：${th.keywords || '—'}`,
      ],
      better: [
        `更适合：Low ≤ ${th.lowMax}%（硬门槛）`,
        `Mid 更好 ≤ ${th.midIdeal}%，High 更好 ≤ ${th.highIdeal}%`
      ]
    };
  }

  // 非否决情况下，天空最高 3 分
  let s = 0;
  const tips = [];
  const better = [];

  // Mid
  if (Number.isFinite(mid)){
    if (mid <= th.midIdeal){ s += 1; tips.push(`中云 Mid=${mid}%（很好）`); }
    else if (mid <= th.midMax){ s += 0.5; tips.push(`中云 Mid=${mid}%（可用）`); }
    else { tips.push(`中云 Mid=${mid}%（偏厚）`); }
    better.push(`Mid 更好 ≤ ${th.midIdeal}%（上限 ${th.midMax}%）`);
  }else{
    tips.push('中云 Mid=—');
  }

  // High
  if (Number.isFinite(high)){
    if (high <= th.highIdeal){ s += 1; tips.push(`高云 High=${high}%（很好）`); }
    else if (high <= th.highMax){ s += 0.5; tips.push(`高云 High=${high}%（可用）`); }
    else { tips.push(`高云 High=${high}%（偏厚）`); }
    better.push(`High 更好 ≤ ${th.highIdeal}%（上限 ${th.highMax}%）`);
  }else{
    tips.push('高云 High=—');
  }

  // Low（没否决也要提示）
  if (Number.isFinite(low)){
    tips.unshift(`低云 Low=${low}%（≤${th.lowMax}% 通过）`);
    better.unshift(`Low 必须 ≤ ${th.lowMax}%（硬门槛）`);
  }else{
    tips.unshift(`低云 Low=—（门槛 ≤${th.lowMax}%）`);
  }

  // 两者都在“理想”给额外 +1
  const midGood = Number.isFinite(mid) && mid <= th.midIdeal;
  const highGood = Number.isFinite(high) && high <= th.highIdeal;
  if (midGood && highGood) s += 1;

  s = Math.min(3, s);

  tips.push(`判读关键词：${th.keywords || '—'}`);

  return { veto:false, score:s, tips, better };
}

function scoreEnergy(features){
  // 能量（0..6） + 解锁(+2)，并实现“未解锁封顶<8”
  if (!features?.now) {
    return {
      score: 0,
      unlocked: false,
      tips: ['NOAA 数据缺失：能量项将保守处理（无法解锁可见）'],
      better: ['需要：V≥450、Bt≥7、N≥3 才能解锁 ≥8 分区间']
    };
  }

  const v = features.now.v;
  const bt = features.now.bt;
  const n = features.now.n;

  let sv = 0, sbt = 0, sn = 0;

  // V
  if (v < 400) sv = 0;
  else if (v < 450) sv = 0.5;
  else if (v < 500) sv = 1;
  else if (v < 600) sv = 1.5;
  else sv = 2;

  // Bt
  if (bt < 5) sbt = 0;
  else if (bt < 7) sbt = 0.5;
  else if (bt < 9) sbt = 1;
  else if (bt < 12) sbt = 1.5;
  else sbt = 2;

  // N
  if (n < 1) sn = 0;
  else if (n < 3) sn = 0.5;
  else if (n < 5) sn = 1;
  else if (n < 8) sn = 1.5;
  else sn = 2;

  let s = sv + sbt + sn; // 0..6

  const needV = 450, needBt = 7, needN = 3;
  const dv = Number.isFinite(v) ? Math.max(0, needV - v) : NaN;
  const dbt = Number.isFinite(bt) ? Math.max(0, needBt - bt) : NaN;
  const dn = Number.isFinite(n) ? Math.max(0, needN - n) : NaN;

  const unlocked = (v >= needV) && (bt >= needBt) && (n >= needN);
  if (unlocked) s += 2; // 解锁

  const tips = [
    `速度 V=${Number.isFinite(v)?v:'—'} km/s（阈值≥${needV}，差 ${Number.isFinite(dv)?dv.toFixed(0):'—'}）`,
    `Bt=${Number.isFinite(bt)?bt:'—'} nT（阈值≥${needBt}，差 ${Number.isFinite(dbt)?dbt.toFixed(1):'—'}）`,
    `密度 N=${Number.isFinite(n)?n:'—'} p/cm³（阈值≥${needN}，差 ${Number.isFinite(dn)?dn.toFixed(1):'—'}）`,
    unlocked ? '可见解锁：✅（允许进入 8+ 分）' : '可见解锁：❌（最高不会到 8+）'
  ];

  const better = [
    '更理想：V≥500、Bt≥9、N≥5（摄影更稳）'
  ];

  // 未解锁：后面总分强制封顶 < 8（我们在总分阶段做）
  return { score: s, unlocked, tips, better };
}

function scoreBz(features){
  // 0..1 轻权重，并给明确提示
  if (!features?.now) {
    return { score: 0, tips:['Bz=—（NOAA缺失）'], better:['更理想：Bz≤-2 连续≥10分钟'] };
  }

  const mins = features.bzMinutes ?? 0;
  const saw = !!features.bzSaw;

  let s = 0;
  if (mins >= 10) s = 1;
  else if (mins >= 5) s = 0.6;
  else if (mins >= 2) s = 0.3;

  if (saw) s *= 0.5;

  const tips = [
    `Bz 当前=${Number.isFinite(features.now.bz)?features.now.bz:'—'} nT`,
    `南向持续≈${mins} 分钟（更理想≥10）`,
    `锯齿：${saw ? '是（降权）' : '否'}`
  ];
  const better = ['更理想：Bz≤-2 且稳定（不反复翻转）'];

  return { score: s, tips, better };
}

function scoreMoonPlaceholder(){
  // 你还没接月角数据：先中性 0.5（不影响结构）
  return {
    score: 0.5,
    tips: ['月角：未接入（当前以中性处理）'],
    better: ['更理想：月角≤30°；30–45°只接受更强的极光']
  };
}

function computeHourlyScore({ band, cloud, features }){
  // 低云否决
  const sky = scoreSky(cloud, band);
  if (sky.veto){
    return {
      score: 0,
      label: scoreLabel(0),
      detail: [
        '【天空】' + sky.tips.join('；'),
        '【建议】' + sky.better.join('；')
      ]
    };
  }

  const energy = scoreEnergy(features);
  const bz = scoreBz(features);
  const moon = scoreMoonPlaceholder();

  let s = 0;
  // 天空 0..3，能量 0..8（含解锁），Bz 0..1，月角 0..1（目前0.5）
  s += sky.score;
  s += energy.score;
  s += bz.score;
  s += moon.score;

  // 未解锁：强制封顶 < 8（你要的“必须三条同时满足才 8+”）
  if (!energy.unlocked){
    s = Math.min(s, 7.9);
  }

  // 再按纬度段做一个轻微“现实主义修正”
  // 极端边缘(50-55)：整体再压 0.6（避免误导普通人）
  if (band === '极端边缘'){
    s = Math.max(0, s - 0.6);
  }

  // 0..10
  s = Math.max(0, Math.min(10, s));
  const sInt = Math.round(s); // 表格用整数档

  const detail = [
    `【纬度段】${band}`,
    `【分数】${s.toFixed(1)} / 10（显示档：${sInt}）`,
    `【行动】${scoreLabel(s)}`,
    '【天空】' + sky.tips.join('；'),
    '【天空更理想】' + sky.better.join('；'),
    '【能量】' + energy.tips.join('；'),
    '【能量更理想】' + energy.better.join('；'),
    '【触发(Bz)】' + bz.tips.join('；'),
    '【触发更理想】' + bz.better.join('；'),
    '【成像(月角)】' + moon.tips.join('；'),
    '【成像更理想】' + moon.better.join('；')
  ];

  return { score: sInt, label: scoreLabel(s), detail };
}

// ====== UI渲染：0-10 纵轴表格 ======
function renderLegend(){
  const el = $('legend');
  el.innerHTML = '';
  for (let s=10;s>=0;s--){
    const b = document.createElement('div');
    b.className = 'badge';
    b.innerHTML = `<span class="dot" style="background:${scoreColor(s)}"></span>${s} 分`;
    el.appendChild(b);
  }
}

function renderTable(hoursUTC, tzStr, scores, details){
  const out = $('out');
  renderDetails(hoursUTC, tz, scores, details);
  out.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'tableWrap';

  const table = document.createElement('table');

  // head
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

  // body: 10..0
  const tbody = document.createElement('tbody');
  for (let row=10; row>=0; row--){
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = `${row} 分`;
    tr.appendChild(th);

    for (let i=0;i<scores.length;i++){
      const td = document.createElement('td');
      td.className = 'cell';
      const hit = scores[i] === row;
      td.style.background = hit ? scoreColor(row) : '#0f1420';
      td.innerHTML = hit ? `<small>${row}</small>` : '';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  out.appendChild(wrap);
}

// ====== 主流程 ======
async function run(){
  const lat = Number($('lat').value);
  const lon = Number($('lon').value);
  const tz = $('tz').value;
  const localTime = $('localTime').value.trim();

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) { setStatus('纬度应在 -90 到 90'); return; }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) { setStatus('经度应在 -180 到 180'); return; }
  if (!localTime) { setStatus('请填写当地时间'); return; }

  $('run').disabled = true;
  setStatus('拉取数据中…');
  setDataNote('');

  try{
    const T0 = parseLocalTimeToUTC(localTime, tz);
    const absLat = Math.abs(lat);

    // 低纬默认放弃（你现在门槛 50）
    if (absLat < 50){
      setStatus(`低纬（地理纬度 ${absLat.toFixed(1)}° < 50°）：默认放弃`);
      const hoursUTC = Array.from({length:HORIZON_HOURS}, (_,i)=> addHours(T0, i));
const scores = Array(HORIZON_HOURS).fill(0);
const details = Array(HORIZON_HOURS).fill([ ... ]);
      renderLegend();
      renderTable(hoursUTC, tz, scores, details);
      return;
    }

    const notes = [];
    const [swpc, clouds] = await Promise.all([
      fetchSWPC2h(notes),
      fetchClouds(lat, lon, T0, HORIZON_HOURS, tz, notes)
    ]);

    // 页面数据健康提示（不弹窗）
    setDataNote(notes.join('｜'));

    const features = swpc?.series ? computeSolarFeatures(swpc.series) : null;

    const band = latBand(absLat);
    const hoursUTC = Array.from({length:HORIZON_HOURS}, (_,i)=> addHours(T0, i));

    // 云量缺失：仍可画表，但天空项会保守（当作偏差，容易低分）
    const scores = [];
    const details = [];

    for (let i=0;i<HORIZON_HOURS;i++){
      const cloud = clouds?.[i] ?? { low: NaN, mid: NaN, high: NaN };
      const r = computeHourlyScore({ band, cloud, features });
      scores.push(r.score);
      details.push(r.detail);
    }

    renderLegend();
    renderTable(hoursUTC, tz, scores, details);

    const noaaTime = features?.now?.time ? features.now.time.toISOString().slice(0,16)+'Z' : '—';
    setStatus(`完成｜纬度段：${band}｜NOAA时间：${noaaTime}`);

  }catch(e){
    // 不弹窗：只写状态，尽量继续保持可用
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

// ====== 初始化 ======
window.addEventListener('DOMContentLoaded', ()=>{
  $('run').addEventListener('click', run);
  $('swap').addEventListener('click', swapLatLon);

  // 默认示例：漠河附近（你自己也可以改）
  $('lat').value = '53.47';
  $('lon').value = '122.35';
  $('tz').value = 'UTC+8';

  const now = new Date();
  const pad = (n)=>String(n).padStart(2,'0');
  $('localTime').value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} 22:00`;

  renderLegend();
});
function renderDetails(hoursUTC, tzStr, scores, details){
  const box = $('detailsPanel');
  if (!box) return;

  box.innerHTML = `<h3>每小时判读说明（按当地时间）</h3>`;

  for (let i=0;i<scores.length;i++){
    const timeStr = fmtLocalHour(hoursUTC[i], tzStr);
    const score = scores[i];

    // 你 detail 里是多行文字，我们挑最关键的前 6 条展示，避免太长
    const lines = (details[i] || []).slice(0, 6);

    const row = document.createElement('div');
    row.className = 'hintRow';
    row.innerHTML = `
      <div class="hintTime">${timeStr}
        <span class="hintScore">${score} 分</span>
      </div>
      <ul>
        ${lines.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}
      </ul>
    `;
    box.appendChild(row);
  }
}

function escapeHtml(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
}
