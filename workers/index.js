const json = (body, init = {}) => {
  const headers = Object.assign({ "Content-Type": "application/json; charset=utf-8" }, init.headers || {});
  return new Response(JSON.stringify(body), Object.assign({}, init, { headers }));
};

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
});

const normalizeTarget = (lang) => {
  const raw = String(lang || "").trim();
  if(!raw) return "";
  return raw.replace(/_/g, "-").toUpperCase();
};

const targetLooksValid = (target) => /^[A-Z]{2,3}(-[A-Z0-9]{2,8})?$/.test(target);

let cachedTargets = { ts: 0, list: [] };
const TARGETS_TTL_MS = 24 * 60 * 60 * 1000;

const fetchTargets = async (env) => {
  if(cachedTargets.list.length && (Date.now() - cachedTargets.ts) < TARGETS_TTL_MS){
    return cachedTargets.list;
  }
  const apiBase = (env.DEEPL_API_URL || "https://api-free.deepl.com").replace(/\/+$/g, "");
  const apiKey = env.DEEPL_API_KEY || "";
  if(!apiKey) return null;
  try{
    const r = await fetch(`${apiBase}/v2/languages?type=target`, {
      headers: { "Authorization": `DeepL-Auth-Key ${apiKey}` },
    });
    if(!r.ok) return null;
    const j = await r.json();
    const targets = Array.isArray(j) ? j.map((x) => String(x?.language || "").trim()).filter(Boolean) : [];
    if(targets.length){
      cachedTargets = { ts: Date.now(), list: targets };
      return targets;
    }
    return null;
  }catch(_){
    return null;
  }
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOW_ORIGIN || "*";

    if(request.method === "OPTIONS"){
      return new Response("", { status: 204, headers: corsHeaders(origin) });
    }

    if(url.pathname === "/api/translate" && request.method === "POST"){
      let payload = null;
      try{ payload = await request.json(); }catch(_){ /* ignore */ }
      const target = normalizeTarget(payload?.target || "");
      const source = normalizeTarget(payload?.source || "zh");
      const texts = Array.isArray(payload?.texts)
        ? payload.texts.map((t) => String(t || "").trim()).filter(Boolean)
        : [String(payload?.text || "").trim()].filter(Boolean);
      if(!texts.length || !target){
        return json({ ok:false, error:"bad_request" }, { status: 400, headers: corsHeaders(origin) });
      }
      if(!targetLooksValid(target)){
        return json({ ok:false, error:"bad_request" }, { status: 400, headers: corsHeaders(origin) });
      }

      const apiBase = (env.DEEPL_API_URL || "https://api-free.deepl.com").replace(/\/+$/g, "");
      const apiKey = env.DEEPL_API_KEY || "";
      if(!apiKey){
        return json({ ok:false, error:"unauthorized" }, { status: 401, headers: corsHeaders(origin) });
      }

      const targetList = await fetchTargets(env);
      if(targetList && !targetList.includes(target)){
        return json({ ok:false, error:"bad_request" }, { status: 400, headers: corsHeaders(origin) });
      }

      const body = new URLSearchParams();
      texts.forEach((t) => body.append("text", t));
      body.set("target_lang", target);
      body.set("source_lang", source);

      try{
        const r = await fetch(`${apiBase}/v2/translate`, {
          method: "POST",
          headers: {
            "Authorization": `DeepL-Auth-Key ${apiKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        });
        if(!r.ok){
          const status = r.status === 429 ? 429 : 502;
          return json({ ok:false, error:"upstream_error" }, { status, headers: corsHeaders(origin) });
        }
        const j = await r.json();
        const list = Array.isArray(j?.translations) ? j.translations.map((t) => String(t?.text || "")) : [];
        const out = list[0] || "";
        return json({ ok:true, target, text: out, texts: list }, { status: 200, headers: corsHeaders(origin) });
      }catch(_){
        return json({ ok:false, error:"upstream_error" }, { status: 502, headers: corsHeaders(origin) });
      }
    }

    if(url.pathname === "/api/languages" && request.method === "GET"){
      const apiBase = (env.DEEPL_API_URL || "https://api-free.deepl.com").replace(/\/+$/g, "");
      const apiKey = env.DEEPL_API_KEY || "";
      if(!apiKey){
        return json({ ok:false, error:"unauthorized" }, { status: 401, headers: corsHeaders(origin) });
      }
      try{
        const r = await fetch(`${apiBase}/v2/languages?type=target`, {
          headers: { "Authorization": `DeepL-Auth-Key ${apiKey}` },
        });
        if(!r.ok){
          return json({ ok:false, error:"upstream_error" }, { status: 502, headers: corsHeaders(origin) });
        }
        const j = await r.json();
        const targets = Array.isArray(j) ? j.map((x) => String(x?.language || "").trim()).filter(Boolean) : [];
        if(targets.length){
          cachedTargets = { ts: Date.now(), list: targets };
        }
        return json({ ok:true, targets }, { status: 200, headers: corsHeaders(origin) });
      }catch(_){
        return json({ ok:false, error:"upstream_error" }, { status: 502, headers: corsHeaders(origin) });
      }
    }

    return json({ ok:false, error:"not_found" }, { status: 404, headers: corsHeaders(origin) });
  },
};
