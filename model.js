// model.js
(() => {
  const { clamp, abs } = window.UI || {};

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

    // 「不可观测解释模块」阈值（可调）
    block_cloud_max_ge: 65,     // 云量遮挡：三层云中“最大值”≥此阈值
    block_moon_alt_ge: 15,      // 月光干扰：月亮高度 ≥ 15°
    block_moon_frac_ge: 0.50,   // 月相亮度（0~1）≥ 0.50（半月以上）
    block_twilight_sun_alt_gt: -18, // 天光干扰：太阳高度 > -18°（未进入天文暗夜）
  };

  // 你旧的“近似磁纬”保留（目前已用 AACGM 查表替代，但我不删的）
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

  // -----------------------------
  // 「不可观测」状态解释模块（PRD）
  // -----------------------------
  const ObservationBlocker = {
    CLOUD_COVER: "CLOUD_COVER",
    MOONLIGHT: "MOONLIGHT",
    TWILIGHT: "TWILIGHT",
    LOW_AURORA_CONTRAST: "LOW_AURORA_CONTRAST",
  };

  const BlockerText = {
    [ObservationBlocker.CLOUD_COVER]: "天空被云层遮挡，不利于观测",
    [ObservationBlocker.MOONLIGHT]: "月光过强，微弱极光难以分辨",
    [ObservationBlocker.TWILIGHT]: "天色偏亮，背景亮度过高",
    [ObservationBlocker.LOW_AURORA_CONTRAST]: "极光亮度不足以被当前环境清晰分辨",
  };

  // 优先级：云 > 月 > 天光 > 对比度不足
  const BlockerPriority = [
    ObservationBlocker.CLOUD_COVER,
    ObservationBlocker.MOONLIGHT,
    ObservationBlocker.TWILIGHT,
    ObservationBlocker.LOW_AURORA_CONTRAST,
  ];

  /**
   * @param {{
   *  cloudMax?: number|null,  // 0~100（三层云取最大值）
   *  moonAltDeg?: number|null,
   *  moonFrac?: number|null,  // 0~1
   *  sunAltDeg?: number|null
   * }} p
   */
  function explainUnobservable(p){
    const cloudMax   = (p?.cloudMax   == null) ? null : Number(p.cloudMax);
    const moonAltDeg = (p?.moonAltDeg == null) ? null : Number(p.moonAltDeg);
    const moonFrac   = (p?.moonFrac   == null) ? null : Number(p.moonFrac);
    const sunAltDeg  = (p?.sunAltDeg  == null) ? null : Number(p.sunAltDeg);

    const hit = new Set();

    // ① 云量遮挡
    if(cloudMax != null && cloudMax >= W.block_cloud_max_ge){
      hit.add(ObservationBlocker.CLOUD_COVER);
    }

    // ② 月光干扰（需要月亮高度 + 月相亮度）
    if(moonAltDeg != null && moonFrac != null){
      if(moonAltDeg >= W.block_moon_alt_ge && moonFrac >= W.block_moon_frac_ge){
        hit.add(ObservationBlocker.MOONLIGHT);
      }
    }

    // ③ 天光干扰（太阳高度未低于天文暗夜阈值）
    if(sunAltDeg != null){
      if(sunAltDeg > W.block_twilight_sun_alt_gt){
        hit.add(ObservationBlocker.TWILIGHT);
      }
    }

    // ④ 兜底：极光对比度不足（只在前 3 项都不成立时）
    const anyTop3 = hit.has(ObservationBlocker.CLOUD_COVER)
      || hit.has(ObservationBlocker.MOONLIGHT)
      || hit.has(ObservationBlocker.TWILIGHT);

    if(!anyTop3){
      hit.add(ObservationBlocker.LOW_AURORA_CONTRAST);
    }

    const ordered = BlockerPriority.filter(k => hit.has(k));
    const primary = ordered[0] || ObservationBlocker.LOW_AURORA_CONTRAST;
    const secondary = ordered[1] || null;

    return {
      primary,
      secondary,
      primaryText: BlockerText[primary],
      secondaryText: secondary ? BlockerText[secondary] : null,
    };
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

    ObservationBlocker,
    explainUnobservable,
  };
})();