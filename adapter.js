// ===============================
// Data Adapter (frozen protocol v1)
// ===============================
const BASE_PATH = window.location.pathname.includes("/aurora-capture/")
  ? "/aurora-capture"
  : "";

const DATA_ENDPOINTS = {
  plasma: `${BASE_PATH}/noaa/plasma.json`,
  mag: `${BASE_PATH}/noaa/mag.json`,
};

function nowIsoUtc() {
  return new Date().toISOString();
}

function ageMinutesFromFetchedAt(fetchedAtIso) {
  const t = Date.parse(fetchedAtIso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 60000;
}

function statusFromAgeMin(ageMin) {
  if (ageMin <= 30) return "OK";
  if (ageMin <= 180) return "DEGRADED";
  return "INVALID";
}

function toIsoUtcFromNoaaTimeTag(timeTag) {
  // NOAA mag/plasma arrays usually use "YYYY-MM-DD HH:MM:SS.mmm"
  // We convert to ISO UTC: "YYYY-MM-DDTHH:MM:SS.sssZ"
  if (!timeTag || typeof timeTag !== "string") return null;
  const s = timeTag.trim().replace(" ", "T");
  // If it already has Z or timezone, leave it
  if (s.endsWith("Z") || s.includes("+") || s.includes("-") && s.includes("T") && s.lastIndexOf("-") > s.indexOf("T")) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s + "Z"); // assume UTC
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function pickLatestRowFromNoaaTable(noaaTable) {
  // Expect: [ [header...], [row...], [row...] ... ]
  if (!Array.isArray(noaaTable) || noaaTable.length < 2) return null;
  const header = noaaTable[0];
  const last = noaaTable[noaaTable.length - 1];
  if (!Array.isArray(header) || !Array.isArray(last)) return null;

  const map = {};
  for (let i = 0; i < header.length; i++) {
    map[String(header[i])] = last[i];
  }
  return map;
}

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url) {
  const r = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error(`fetch failed ${r.status} ${url}`);
  return r.json();
}

// The ONLY realtime input for model/UI after refactor:
async function getRealtimeState() {
  const [plasmaWrap, magWrap] = await Promise.all([
    fetchJson(DATA_ENDPOINTS.plasma),
    fetchJson(DATA_ENDPOINTS.mag),
  ]);

  const fetchedAtPlasma = plasmaWrap?.fetchedAt || null;
  const fetchedAtMag = magWrap?.fetchedAt || null;

  const agePlasma = fetchedAtPlasma ? ageMinutesFromFetchedAt(fetchedAtPlasma) : Infinity;
  const ageMag = fetchedAtMag ? ageMinutesFromFetchedAt(fetchedAtMag) : Infinity;

  const solarWindRow = pickLatestRowFromNoaaTable(plasmaWrap?.noaa);
  const imfRow = pickLatestRowFromNoaaTable(magWrap?.noaa);

  // Plasma (common columns in plasma-2-hour.json)
  const speed = toNumberOrNull(solarWindRow?.speed);
  const densityRaw = toNumberOrNull(solarWindRow?.density);
  // density 可能是 0.x，绝不能用 truthy 判断
  const density = Number.isFinite(densityRaw) ? densityRaw : null;
  const temperature = toNumberOrNull(solarWindRow?.temperature);
  const plasmaTs = toIsoUtcFromNoaaTimeTag(solarWindRow?.time_tag);

  // Mag (common columns in mag-2-hour.json)
  const bz = toNumberOrNull(imfRow?.bz_gsm);
  const by = toNumberOrNull(imfRow?.by_gsm);
  const bx = toNumberOrNull(imfRow?.bx_gsm);
  const bt = toNumberOrNull(imfRow?.bt);
  const magTs = toIsoUtcFromNoaaTimeTag(imfRow?.time_tag);

  const solarWind = {
    fetchedAt: fetchedAtPlasma,
    ageMin: agePlasma,
    status: statusFromAgeMin(agePlasma),
    speed_km_s: speed,
    density_cm3: density,
    temperature_K: temperature,
    ts: plasmaTs,
    source: "NOAA_PLASMA",
    raw: null,
  };

  const imf = {
    fetchedAt: fetchedAtMag,
    ageMin: ageMag,
    status: statusFromAgeMin(ageMag),
    bz_gsm_nT: bz,
    by_gsm_nT: by,
    bx_gsm_nT: bx,
    bt_nT: bt,
    ts: magTs,
    source: "NOAA_MAG",
    raw: null,
  };

  // combined status: INVALID > DEGRADED > OK
  const order = { OK: 0, DEGRADED: 1, INVALID: 2 };
  const combinedStatus = order[solarWind.status] >= order[imf.status] ? solarWind.status : imf.status;

  return {
    now: nowIsoUtc(),
    solarWind,
    imf,
    status: combinedStatus,
  };
}

window.getRealtimeState = getRealtimeState;
