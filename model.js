// model.js
(() => {
  const { clamp, abs, round0, fmtYMD, fmtHM } = window.UI || {};

  // --- 权重入口（以后只改这块）---
  const W = {
    // baseScoreFromSW 内部权重（先按你原来的）
    sv: 0.28,
    sbt: 0.26,
    sbz: 0.32,
    sn: 0.14,

    // 缺字段保守压制（先按你原来的）
    miss_bz: 0.78,
    miss_bt: 0.85,
    miss_v: 0.85,
  };

  function approxMagLat(lat, lon){
    const poleLat = 80.65;
    const poleLon = -72.68;
    const toRad = (d)=>d*Math.PI/180;
    const deg = (rad)=> rad * 180 / Math.PI;

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

  // 太阳风 → 0~10 内部基准
  function baseScoreFromSW(sw, missingKeys){
    const v  = sw.v  ?? 0;
    const bt = sw.bt ?? 0;
    const bz = sw.bz ?? 0;
    const n  = sw.n  ?? 0;

    const sv  = clamp((v - 380) / (650 - 380), 0, 1);
    const sbt = clamp((bt - 4) / (12 - 4), 0, 1);

    const bzMissing = missingKeys?.includes("bz");
    const sbz = bzMissing ? 0 : clamp(((-bz) - 1) / (10 - 1), 0, 1);

    const sn  = clamp((n - 1) / (8 - 1), 0, 1);

    let raw = (sv*W.sv + sbt*W.sbt + sbz*W.sbz + sn*W.sn) * 10;

    if(bzMissing) raw *= W.miss_bz;
    if(missingKeys?.includes("bt")) raw *= W.miss_bt;
    if(missingKeys?.includes("v"))  raw *= W.miss_v;

    return clamp(raw, 0, 10);
  }

  function score5FromC10(c10){
    if(c10 >= 8.2) return 5;
    if(c10 >= 6.8) return 4;
    if(c10 >= 5.0) return 3;
    if(c10 >= 2.8) return 2;
    return 1;
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
    const bz = (sw.bz == null) ? 999 : sw.bz;
    const n  = sw.n  ?? 0;

    const trig  = (bz <= -3.0);
    const bg    = (v >= 420 && bt >= 6.0);
    const dense = (n >= 2.0);

    if(trig && bg) return { state:"爆发进行中", hint:"触发更明确，短时内值得马上看。", score:8.0 };
    if(bg && (dense || trig)) return { state:"爆发概率上升", hint:"系统更容易发生，但未到持续触发。", score:6.4 };
    if(bg) return { state:"爆发后衰落期", hint:"刚有过波动，仍可能余震一会儿。", score:5.4 };
    return { state:"静默", hint:"背景不足或触发不清晰，先别投入。", score:3.0 };
  }

  // 72h 代理规则（你 app.js 里那两个）
  function p1a_fastWind(sw){
    const v = Number(sw?.v ?? 0);
    return v >= 480;
  }
  function p1b_energyInput(sw){
    const bt = Number(sw?.bt ?? 0);
    const bz = Number(sw?.bz ?? 999);
    return (bt >= 6.5) && (bz <= -2.0);
  }

  // 暴露给 app.js
  window.Model = {
    W,
    approxMagLat,
    labelByScore5,
    baseScoreFromSW,
    score5FromC10,
    deliverModel,
    state3h,
    p1a_fastWind,
    p1b_energyInput,
  };
})();
