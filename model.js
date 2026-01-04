// model.js
(() => {
  // Local math helpers (do NOT depend on UI.js load order)
  const clamp = (x, a, b) => {
    const v = Number(x);
    if(!Number.isFinite(v)) return v;
    const lo = Number(a), hi = Number(b);
    if(!Number.isFinite(lo) || !Number.isFinite(hi)) return v;
    return Math.min(hi, Math.max(lo, v));
  };
  const abs = (x) => Math.abs(Number(x));

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
    block_twilight_sun_alt_gt: -10, // 天色偏亮：太阳高度 > -10°（更贴近观测/摄影体感）
  };

  // “近似磁纬”（离线）：目标是更贴近 AACGMv2 的观测语境（用于极光决策），而不是第一版那种与极光无关的“伪磁纬”。
  // 这里采用 **磁北极（dip pole）** 作为参考点来构造一个稳定的近似 MLAT：
  // - 磁北极（dip pole）比“地心偶极 geomagnetic pole”更接近实际磁力线垂直点，
  // - 在东亚（例如漠河）能显著减少你看到的那种 44° 误报。
  // 参考：WDC Kyoto / IGRF 给出的 dip pole（示例年份 2024：85.9N, 142.3E）。
  // 注意：这仍然不是严格 AACGMv2，但误差通常在可接受范围内，用于“是否值得出门”更稳。
  function approxMagLat(lat, lon){
    // 2024 North magnetic dip pole (IGRF/WMM-derived)
    const poleLat = 85.9;
    const poleLon = 142.3; // degrees East

    const toRad = (d)=>d*Math.PI/180;
    const deg = (rad)=> rad * 180 / Math.PI;

    const a1 = toRad(lat), b1 = toRad(lon);
    const a2 = toRad(poleLat), b2 = toRad(poleLon);

    // Great-circle distance to dip pole
    const cosc = Math.sin(a1)*Math.sin(a2) + Math.cos(a1)*Math.cos(a2)*Math.cos(b1-b2);
    const c = Math.acos(clamp(cosc, -1, 1));

    // Define MLAT as 90° minus the angular distance to the dip pole
    return 90 - deg(c);
  }

  // ------------------------------------------------------------
  // Magnetic Latitude (simplified)
  // ------------------------------------------------------------
  // 目前策略：只使用离线“近似磁纬”（偶极近似）方案。
  // 不再尝试远程 AACGMv2 换算服务，也不做 localStorage 缓存，避免旧版本/失败回退导致的误报。
  // 注意：该近似在部分区域会有偏差，但对当前“是否值得出门”的决策足够稳定。

  function magLat(lat, lon){
    return approxMagLat(lat, lon);
  }

  // 为了兼容旧的 app.js 调用（如果它仍然 await aacgmV2MagLat），这里保留同名函数。
  // 但它会直接返回近似磁纬，不再发起任何网络请求。
  async function aacgmV2MagLat(lat, lon, _date){
    return approxMagLat(lat, lon);
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

    if(trig && bg) return { state:"爆发进行中", hint:"离子触发更明确。", score:8.0 };
    if(bg && (dense || trig)) return { state:"爆发概率上升", hint:"系统更容易发生，但未到持续触发。", score:6.4 };
    if(bg) return { state:"爆发后衰落期", hint:"刚有过波动，仍可能余震一会儿。", score:5.4 };
    return { state:"静默", hint:"背景不足或触发不清晰。", score:3.0 };
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
    BRIGHT_SKY: "BRIGHT_SKY", // 月光/天光统一解释为“天色偏亮”
    LOW_AURORA_CONTRAST: "LOW_AURORA_CONTRAST",
  };

  const BlockerText = {
    [ObservationBlocker.CLOUD_COVER]: "天空被云层遮挡，不利于观测",
    [ObservationBlocker.BRIGHT_SKY]: "天色偏亮，微弱极光难以分辨",
    [ObservationBlocker.LOW_AURORA_CONTRAST]: "极光亮度不足以被当前环境清晰分辨",
  };

  // 优先级（最终只输出一个原因）：云 > 天色偏亮 > 对比度不足
  const BlockerPriority = [
    ObservationBlocker.CLOUD_COVER,
    ObservationBlocker.BRIGHT_SKY,
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

    // 命中集合（内部仍可分别命中，但最终只输出一个原因）
    const hit = new Set();

    // ① 云量遮挡
    if(cloudMax != null && cloudMax >= W.block_cloud_max_ge){
      hit.add(ObservationBlocker.CLOUD_COVER);
    }

    // ② 天色偏亮（统一解释：月光或天光导致背景亮）
    // ②-1 月光：需要月亮高度 + 月相亮度
    if(moonAltDeg != null && moonFrac != null){
      if(moonAltDeg >= W.block_moon_alt_ge && moonFrac >= W.block_moon_frac_ge){
        hit.add(ObservationBlocker.BRIGHT_SKY);
      }
    }

    // ②-2 天光：太阳高度超过阈值（现在用 -10°）
    if(sunAltDeg != null){
      if(sunAltDeg > W.block_twilight_sun_alt_gt){
        hit.add(ObservationBlocker.BRIGHT_SKY);
      }
    }

    // ③ 兜底：极光对比度不足（只在前两类都不成立时）
    const anyTop2 = hit.has(ObservationBlocker.CLOUD_COVER)
      || hit.has(ObservationBlocker.BRIGHT_SKY);

    if(!anyTop2){
      hit.add(ObservationBlocker.LOW_AURORA_CONTRAST);
    }

    // 最终只输出一个原因：云 > 天色偏亮 > 对比度不足
    let primary = ObservationBlocker.LOW_AURORA_CONTRAST;
    if(hit.has(ObservationBlocker.CLOUD_COVER)){
      primary = ObservationBlocker.CLOUD_COVER;
    } else if(hit.has(ObservationBlocker.BRIGHT_SKY)){
      primary = ObservationBlocker.BRIGHT_SKY;
    }

    return {
      primary,
      secondary: null,
      primaryText: BlockerText[primary],
      secondaryText: null,
    };
  }

  // 暴露给 app.js
  window.Model = {
    W,
    approxMagLat,
    magLat,
    aacgmV2MagLat,
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