// trans.js: minimal translation toggle + DeepL proxy
(() => {
  const TRANS_KEY = "ac_trans";
  const LANGS_KEY = "ac_deepl_langs";
  const CACHE_KEY = "ac_trans_cache";
  const LANGS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  const getConfig = () => {
    const cfg = window.TRANS_CONFIG || {};
    const base = String(cfg.apiBase || "").trim().replace(/\/+$/g, "");
    return {
      apiBase: base,
      translateUrl: base ? `${base}/api/translate` : "/api/translate",
      languagesUrl: base ? `${base}/api/languages` : "/api/languages",
    };
  };

  const normalizeTag = (lang) => {
    const raw = String(lang || "").trim().toLowerCase();
    if(!raw) return "";
    return raw.replace(/_/g, "-");
  };

  const getPreferredLang = () => {
    const list = Array.isArray(navigator.languages) ? navigator.languages : [];
    const raw = list.length ? list[0] : (navigator.language || "en");
    return normalizeTag(raw);
  };

  const getStoredState = () => {
    try{
      const v = localStorage.getItem(TRANS_KEY);
      if(v === "on" || v === "off") return v;
    }catch(_){ /* ignore */ }
    return null;
  };

  const getDefaultState = () => {
    const pref = getPreferredLang();
    return pref.startsWith("zh") ? "off" : "on";
  };

  const setStoredState = (state) => {
    try{ localStorage.setItem(TRANS_KEY, state); }catch(_){ /* ignore */ }
  };

  const getLangCache = () => {
    try{
      const raw = localStorage.getItem(LANGS_KEY);
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      if(!parsed || !Array.isArray(parsed.targets)) return null;
      if(!parsed.ts || (Date.now() - parsed.ts) > LANGS_TTL_MS) return null;
      return parsed.targets;
    }catch(_){
      return null;
    }
  };

  const setLangCache = (targets) => {
    try{
      localStorage.setItem(LANGS_KEY, JSON.stringify({ ts: Date.now(), targets }));
    }catch(_){ /* ignore */ }
  };

  const fetchSupportedTargets = async () => {
    const cached = getLangCache();
    if(cached) return cached;
    const cfg = getConfig();
    if(!cfg.apiBase || !cfg.languagesUrl){
      return null;
    }
    try{
      const r = await fetch(cfg.languagesUrl, { cache: "no-store" });
      if(!r.ok) throw new Error("languages_fetch_failed");
      const j = await r.json();
      const targets = Array.isArray(j?.targets) ? j.targets.map((t) => String(t || "").trim()).filter(Boolean) : [];
      if(!targets.length) throw new Error("languages_empty");
      setLangCache(targets);
      return targets;
    }catch(_){
      return null;
    }
  };

  const resolveTarget = async () => {
    const preferred = getPreferredLang();
    const supported = await fetchSupportedTargets();
    if(!supported || !supported.length) return "en";
    const supportedNorm = supported.map(normalizeTag);

    const pickByCandidate = (cand) => {
      const c = normalizeTag(cand);
      if(!c) return null;
      const exactIndex = supportedNorm.indexOf(c);
      if(exactIndex >= 0) return supported[exactIndex];
      const primary = c.split("-")[0];
      if(!primary) return null;
      const primaryExactIndex = supportedNorm.indexOf(primary);
      if(primaryExactIndex >= 0) return supported[primaryExactIndex];
      const variantIndex = supportedNorm.findIndex((s) => s.startsWith(primary + "-"));
      if(variantIndex >= 0) return supported[variantIndex];
      return null;
    };

    return pickByCandidate(preferred) || pickByCandidate("en") || "en";
  };

  const getCacheMap = () => {
    try{
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    }catch(_){
      return {};
    }
  };

  const setCacheMap = (map) => {
    try{ localStorage.setItem(CACHE_KEY, JSON.stringify(map)); }catch(_){ /* ignore */ }
  };

  const translateBatch = async (texts, target) => {
    const items = Array.isArray(texts) ? texts : [];
    if(!items.length) return [];
    if(String(target || "").toLowerCase().startsWith("zh")){
      return items.slice();
    }
    const cfg = getConfig();
    if(!cfg.apiBase || !cfg.translateUrl){
      return [];
    }
    try{
      const r = await fetch(cfg.translateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: items, target, source: "zh" }),
      });
      if(!r.ok) throw new Error("translate_failed");
      const j = await r.json();
      const list = Array.isArray(j?.texts) ? j.texts : [];
      if(list.length === items.length) return list;
      if(j?.text) return items.map((_, i) => (i === 0 ? String(j.text) : ""));
      return [];
    }catch(_){
      return [];
    }
  };

  let currentState = "off";
  let jobId = 0;

  const restoreOriginal = (elements) => {
    elements.forEach((el) => {
      const original = el.getAttribute("data-i18n");
      if(original != null) el.textContent = original;
    });
  };

  const applyTranslation = async () => {
    const myJob = ++jobId;
    const elements = Array.from(document.querySelectorAll("[data-i18n]"));

    if(currentState !== "on"){
      restoreOriginal(elements);
      return;
    }

    const cfg = getConfig();
    if(!cfg.apiBase){
      showNoServiceHint();
      restoreOriginal(elements);
      return;
    }

    const target = await resolveTarget();
    if(myJob !== jobId || currentState !== "on") return;

    const cache = getCacheMap();
    const pending = [];

    for(const el of elements){
      const source = String(el.getAttribute("data-i18n") || "").trim();
      if(!source){
        continue;
      }
      const key = `${target}::${source}`;
      if(cache[key]){
        el.textContent = cache[key];
        continue;
      }
      pending.push({ el, source, key });
    }

    if(!pending.length){
      return;
    }

    const translatedList = await translateBatch(pending.map((p) => p.source), target);
    if(myJob !== jobId || currentState !== "on") return;

    for(let i = 0; i < pending.length; i++){
      const item = pending[i];
      const translated = translatedList[i] || "";
      if(translated){
        cache[item.key] = translated;
        item.el.textContent = translated;
      }
    }
    setCacheMap(cache);
  };

  const updateToggleText = (btn) => {
    if(!btn) return;
    btn.textContent = currentState === "on" ? "Trans ON" : "Trans OFF";
  };

  let hintShown = false;
  const showNoServiceHint = () => {
    if(hintShown) return;
    hintShown = true;
    const btn = document.getElementById("btnTrans");
    if(btn){
      btn.title = "未配置翻译服务";
    }
    try{ console.warn("[AuroraCapture] Trans service not configured."); }catch(_){ /* ignore */ }
  };

  const init = () => {
    const btn = document.getElementById("btnTrans");
    const stored = getStoredState();
    currentState = stored || getDefaultState();
    updateToggleText(btn);
    applyTranslation();

    btn?.addEventListener("click", () => {
      currentState = (currentState === "on") ? "off" : "on";
      setStoredState(currentState);
      updateToggleText(btn);
      applyTranslation();
    });
  };

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  }else{
    init();
  }
})();
