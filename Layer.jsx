import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Sun, Cloud, CloudRain, CloudSnow, CloudDrizzle, CloudFog, CloudSun,
  Wind, Zap, Snowflake, Droplets, Check, Flame, MapPin, RefreshCw,
  Umbrella, ChevronDown, Footprints, Timer, Car, TrendingUp, X, ArrowRight,
  Bike, Shirt, Plus, Trash2, Clock3, AlertTriangle,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════
   LAYER v4 — weather you can wear.

   Campus-focused personal comfort engine:
   · Plans for an outing window, not a single current reading
   · Learns only from feedback the user actually followed
   · Treats cycling as temporary exposure, not a permanent preference
   · Matches recommendations to a manually built closet
   · Keeps scanning out of the critical path until matching works well
   ═══════════════════════════════════════════════════════════════════ */

const CAMPUS = {
  name: "Cornell University",
  subtitle: "Ithaca campus",
  lat: 42.4534,
  lon: -76.4735,
};

const MODEL_KEY = "layer:model:v4";
const LEGACY_MODEL_KEY = "layer:model:v3";
const WEATHER_CACHE_KEY = "layer:wx-cache:v2";
const CLOSET_KEY = "layer:closet:v1";
const CACHE_TTL = 15 * 60 * 1000;

const CENTERS = { cold: 33, mild: 60, warm: 82 };
const KERNEL = 15;
const STEP_MAX = 4.5;
const PRIOR_N = 3;
const CLAMP = 15;
const FACTOR_CLAMP = 7;

const EMPTY_MODEL = {
  v: 4,
  seeded: false,
  regime: {
    cold: { off: 0, n: 0 },
    mild: { off: 0, n: 0 },
    warm: { off: 0, n: 0 },
  },
  factors: { wind: 0, wet: 0, sun: 0 },
  history: [],
};

const START_OFFSETS = [0, 1, 3, 6];
const DURATIONS = [
  { minutes: 20, label: "20 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
];

const ACTIVITIES = {
  waiting: { label: "Standing", Icon: Timer, adj: -5, hint: "Stop, platform, queue" },
  walking: { label: "Walking", Icon: Footprints, adj: 2, hint: "Across campus" },
  dashing: { label: "Quick dash", Icon: Car, adj: 6, hint: "Building to building" },
};

const CATEGORY_OPTIONS = [
  { key: "top", label: "Top" },
  { key: "mid", label: "Mid-layer" },
  { key: "outer", label: "Outerwear" },
  { key: "bottom", label: "Bottom" },
  { key: "shoes", label: "Shoes" },
  { key: "accessory", label: "Accessory" },
];

const EMPTY_ITEM = {
  name: "",
  category: "outer",
  warmth: 3,
  waterproof: false,
  windproof: false,
};

const BANDS = [
  { key: "hot", min: 84, accent: "#E2703A", sky: ["#FFD9A8", "#FFB27A"],
    verdict: "Hot out there", sub: "Keep it breathable and protect yourself from the sun.",
    layers: [
      { label: "Lightest breathable top", note: "Linen or loose cotton." },
      { label: "Shorts or a thin skirt" },
      { label: "Cap and sunglasses" },
    ] },
  { key: "warm", min: 74, accent: "#E0A32E", sky: ["#FFE9B8", "#FFC98A"],
    verdict: "Warm and easy", sub: "One light layer works; indoor A/C may not.",
    layers: [
      { label: "T-shirt" },
      { label: "Light bottoms" },
      { label: "Thin layer for indoors", note: "Optional." },
    ] },
  { key: "mild", min: 65, accent: "#6FB558", sky: ["#DDF0C6", "#B6DEA0"],
    verdict: "Comfortable", sub: "No bundling needed for this outing.",
    layers: [
      { label: "T-shirt or long sleeve" },
      { label: "Light sweater for shade or A/C", note: "Optional." },
    ] },
  { key: "cool", min: 56, accent: "#3FAE84", sky: ["#CFEEDF", "#A5DCC6"],
    verdict: "A little cool", sub: "Bring a removable layer, especially between buildings.",
    layers: [
      { label: "Long sleeve or light sweater" },
      { label: "A light jacket", note: "Easy to carry later." },
    ] },
  { key: "chilly", min: 47, accent: "#35A79B", sky: ["#CCEBEA", "#9FD8D6"],
    verdict: "Crisp — layer up", sub: "The deceptive zone: it looks mild but does not feel mild.",
    layers: [
      { label: "Long sleeve or sweater" },
      { label: "A real jacket", note: "A thin hoodie alone may not hold." },
    ] },
  { key: "cold", min: 38, accent: "#4FA3C7", sky: ["#D2E8F4", "#A9D2E8"],
    verdict: "Properly cold", sub: "Use insulation, not only another thin shirt.",
    layers: [
      { label: "Long-sleeve shirt" },
      { label: "Sweater or fleece" },
      { label: "A warm coat" },
      { label: "Hat and gloves if exposure is long" },
    ] },
  { key: "veryCold", min: 29, accent: "#5A9AD9", sky: ["#DCE8F7", "#B4CCEC"],
    verdict: "Bundle up", sub: "Close the gaps around your neck, hands, and ears.",
    layers: [
      { label: "Thermal or long-sleeve base" },
      { label: "Sweater or fleece" },
      { label: "Insulated winter coat" },
      { label: "Beanie and gloves" },
    ] },
  { key: "frigid", min: -200, accent: "#4C8FD4", sky: ["#E2EAF8", "#BCCBEE"],
    verdict: "Serious cold", sub: "Use full winter protection and limit exposed skin.",
    layers: [
      { label: "Thermal base layer" },
      { label: "Warm sweater or fleece" },
      { label: "Heavy insulated parka" },
      { label: "Hat, gloves, and scarf" },
      { label: "Thick socks and winter boots" },
    ] },
];

const LEVELS = ["None", "Low", "Mod", "High"];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deepCopy = (value) => JSON.parse(JSON.stringify(value));

async function storageGet(key) {
  try {
    if (window.storage?.get) return await window.storage.get(key);
    const value = window.localStorage?.getItem(key);
    return value == null ? null : { value };
  } catch (_) {
    return null;
  }
}

async function storageSet(key, value) {
  try {
    if (window.storage?.set) return await window.storage.set(key, value);
    window.localStorage?.setItem(key, value);
  } catch (_) {
    // Session-only mode is an acceptable fallback.
  }
}

function normalizeModel(raw) {
  if (!raw || typeof raw !== "object") return deepCopy(EMPTY_MODEL);
  const next = deepCopy(EMPTY_MODEL);
  next.seeded = Boolean(raw.seeded);
  for (const key of Object.keys(next.regime)) {
    next.regime[key].off = Number(raw.regime?.[key]?.off) || 0;
    next.regime[key].n = Number(raw.regime?.[key]?.n) || 0;
  }
  for (const key of Object.keys(next.factors)) {
    next.factors[key] = Number(raw.factors?.[key]) || 0;
  }
  next.history = Array.isArray(raw.history) ? raw.history.slice(-80) : [];
  return next;
}

function kernelWeights(t) {
  const raw = {};
  let sum = 0;
  for (const key in CENTERS) {
    const w = Math.exp(-Math.pow((t - CENTERS[key]) / KERNEL, 2));
    raw[key] = w;
    sum += w;
  }
  for (const key in raw) raw[key] /= sum || 1;
  return raw;
}

function pooledOffset(model, t) {
  const weights = kernelWeights(t);
  return Object.keys(weights).reduce((sum, key) => sum + weights[key] * model.regime[key].off, 0);
}

const totalObservations = (model) =>
  model.regime.cold.n + model.regime.mild.n + model.regime.warm.n;

function confidence(model) {
  const n = totalObservations(model);
  return Math.round((n / (n + 4)) * 100);
}

const bandFor = (t) => BANDS.find((band) => t >= band.min) || BANDS[BANDS.length - 1];

function thermalRegime(t) {
  if (t < 47) return "cold";
  if (t < 74) return "mild";
  return "warm";
}

function decodeWeather(code) {
  const make = (label, Icon, extra = {}) => ({
    label, Icon, wet: false, snow: false, clear: false, ...extra,
  });
  if (code === 0) return make("Clear", Sun, { clear: true });
  if (code <= 2) return make("Partly cloudy", CloudSun, { clear: true });
  if (code === 3) return make("Overcast", Cloud);
  if (code === 45 || code === 48) return make("Fog", CloudFog);
  if (code >= 51 && code <= 57) return make("Drizzle", CloudDrizzle, { wet: true });
  if (code >= 61 && code <= 67) return make("Rain", CloudRain, { wet: true });
  if (code >= 71 && code <= 77) return make("Snow", CloudSnow, { snow: true });
  if (code >= 80 && code <= 82) return make("Showers", CloudRain, { wet: true });
  if (code >= 85 && code <= 86) return make("Snow showers", CloudSnow, { snow: true });
  if (code >= 95) return make("Thunderstorm", Zap, { wet: true });
  return make("Cloudy", Cloud);
}

function threatsFor({ effective, wind, cond, precip }) {
  const cold = effective < 25 ? 3 : effective < 38 ? 2 : effective < 50 ? 1 : 0;
  const windLevel = wind >= 24 ? 3 : wind >= 15 ? 2 : wind >= 8 ? 1 : 0;
  const wet = cond.snow || precip >= 60 ? 3 : precip >= 30 || cond.wet ? 2 : precip >= 15 ? 1 : 0;
  const sun = cond.clear && effective >= 82 ? 3 : cond.clear && effective >= 72 ? 2 : cond.clear ? 1 : 0;
  return [
    { key: "cold", label: "Cold", Icon: Snowflake, level: cold, blame: "The cold itself got me" },
    { key: "wind", label: "Wind", Icon: Wind, level: windLevel, blame: "The wind cut through" },
    { key: "wet", label: "Wet", Icon: Droplets, level: wet, blame: "I got wet" },
    { key: "sun", label: "Sun", Icon: Sun, level: sun, blame: "The sun was punishing" },
  ];
}

function extrasFor(threats, cond) {
  const result = [];
  const level = (key) => threats.find((item) => item.key === key)?.level || 0;
  if (cond.snow) result.push({ Icon: Snowflake, text: "Use waterproof footwear; snow and slush soak through quickly." });
  else if (level("wet") >= 2) result.push({ Icon: Umbrella, text: "Take a waterproof shell or umbrella." });
  if (level("wind") >= 2) result.push({ Icon: Wind, text: "Make the outer layer wind-resistant, not only warm." });
  if (level("sun") >= 2) result.push({ Icon: Sun, text: "Bring sunglasses and sun protection for longer exposure." });
  return result;
}

const CLIMATES = [
  { key: "tropical", label: "Somewhere hot", note: "Tropical or desert", seed: { cold: -7, mild: -4, warm: 1 } },
  { key: "temperate", label: "Four seasons", note: "Mild winters", seed: { cold: -1, mild: 0, warm: 0 } },
  { key: "cold", label: "Somewhere cold", note: "Real winters", seed: { cold: 4, mild: 2, warm: -2 } },
];

const TOLERANCE = [
  { key: "colder", label: "The cold one", adj: -3 },
  { key: "same", label: "About the same", adj: 0 },
  { key: "warmer", label: "The warm one", adj: 3 },
];

function toHourlyRows(payload) {
  const hourly = payload?.hourly;
  if (!hourly?.time?.length) return [];
  return hourly.time.map((time, index) => ({
    time,
    at: new Date(time).getTime(),
    actual: Math.round(hourly.temperature_2m?.[index] ?? 0),
    apparent: Math.round(hourly.apparent_temperature?.[index] ?? hourly.temperature_2m?.[index] ?? 0),
    code: hourly.weather_code?.[index] ?? 3,
    wind: Math.round(hourly.wind_speed_10m?.[index] ?? 0),
    precip: Math.round(hourly.precipitation_probability?.[index] ?? 0),
  })).filter((row) => Number.isFinite(row.at));
}

function parseWeather(payload) {
  const hourly = toHourlyRows(payload);
  const now = Date.now();
  const nearest = hourly.reduce((best, row) =>
    !best || Math.abs(row.at - now) < Math.abs(best.at - now) ? row : best, null);
  const current = payload?.current || {};
  return {
    fetchedAt: Date.now(),
    current: {
      time: current.time || nearest?.time,
      at: current.time ? new Date(current.time).getTime() : now,
      actual: Math.round(current.temperature_2m ?? nearest?.actual ?? 71),
      apparent: Math.round(current.apparent_temperature ?? nearest?.apparent ?? 72),
      code: current.weather_code ?? nearest?.code ?? 2,
      wind: Math.round(current.wind_speed_10m ?? nearest?.wind ?? 9),
      precip: Math.round(current.precipitation_probability ?? nearest?.precip ?? 0),
    },
    hourly,
  };
}

function demoWeather(temp, condition, windy) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const codes = { clear: 0, cloudy: 3, rain: 63, snow: 73 };
  const hourly = Array.from({ length: 18 }, (_, index) => {
    const at = new Date(now.getTime() + index * 60 * 60 * 1000);
    const curve = index < 5 ? index * 1.5 : 7.5 - (index - 5) * 0.7;
    return {
      time: at.toISOString(),
      at: at.getTime(),
      actual: Math.round(temp + curve),
      apparent: Math.round(temp + curve),
      code: codes[condition],
      wind: windy ? 22 : 6,
      precip: condition === "rain" ? 80 : condition === "snow" ? 70 : 5,
    };
  });
  return { fetchedAt: Date.now(), current: hourly[0], hourly };
}

function sampleEffective(sample, model, activity, cycling, durationMinutes) {
  const cond = decodeWeather(sample.code);
  const base = sample.apparent;
  let effective = base + pooledOffset(model, base);
  const windIntensity = clamp((sample.wind - 6) / 14, 0, 1.4);
  effective -= windIntensity * model.factors.wind;
  if (cond.wet || cond.snow) effective -= model.factors.wet;
  if (cond.clear && base > 66) effective += model.factors.sun;
  effective += ACTIVITIES[activity].adj;

  // Cycling is a temporary outing modifier. It never retrains the user's
  // baseline comfort because the extra airflow belongs to this trip only.
  if (cycling) {
    effective += base < 60 ? -4 : base < 75 ? -2 : 1;
  }

  // Long cold exposure matters even when the hourly apparent temperature is stable.
  if (durationMinutes >= 120 && base < 55) effective -= 3;
  else if (durationMinutes >= 60 && base < 45) effective -= 1;

  return Math.round(effective);
}

function selectWindow(weather, startOffset, durationMinutes) {
  if (!weather) return [];
  const startAt = Date.now() + startOffset * 60 * 60 * 1000;
  const endAt = startAt + durationMinutes * 60 * 1000;
  const rows = weather.hourly.filter((row) => row.at >= startAt - 30 * 60 * 1000 && row.at <= endAt + 30 * 60 * 1000);
  if (rows.length) return rows;
  return weather.current ? [weather.current] : [];
}

function chooseCondition(rows) {
  return rows.reduce((best, row) => {
    const cond = decodeWeather(row.code);
    const score = (cond.snow ? 5 : cond.wet ? 3 : cond.clear ? 0 : 1) + row.precip / 100;
    return !best || score > best.score ? { row, score } : best;
  }, null)?.row || rows[0];
}

function buildOutingResult(weather, model, activity, cycling, startOffset, durationMinutes) {
  const windowStartAt = Date.now() + startOffset * 60 * 60 * 1000;
  const windowEndAt = windowStartAt + durationMinutes * 60 * 1000;
  const rows = selectWindow(weather, startOffset, durationMinutes);
  if (!rows.length) return null;
  const scored = rows.map((row) => ({ ...row, effective: sampleEffective(row, model, activity, cycling, durationMinutes) }));
  const effectiveValues = scored.map((row) => row.effective);
  const apparentValues = scored.map((row) => row.apparent);
  const low = Math.min(...effectiveValues);
  const high = Math.max(...effectiveValues);
  const average = Math.round(effectiveValues.reduce((sum, value) => sum + value, 0) / effectiveValues.length);

  // Dress for the coldest point on cool outings and the hottest point on hot outings.
  // In the comfortable middle, use the average to avoid needless over-layering.
  const recommendationEffective = average < 65 ? low : average > 78 ? high : average;
  const conditionRow = chooseCondition(scored);
  const cond = decodeWeather(conditionRow.code);
  const wind = Math.max(...scored.map((row) => row.wind));
  const precip = Math.max(...scored.map((row) => row.precip));
  const band = bandFor(recommendationEffective);
  const threats = threatsFor({ effective: recommendationEffective, wind, cond, precip });
  const warnings = [];
  const spread = high - low;
  const first = scored[0];
  const last = scored[scored.length - 1];

  if (spread >= 8) {
    warnings.push({ Icon: TrendingUp, text: `Conditions shift about ${spread}° during your outing. Wear removable layers.` });
  }
  if (last.effective >= first.effective + 7) {
    warnings.push({ Icon: Sun, text: "It gets noticeably warmer before you return. Avoid a layer you cannot carry." });
  } else if (last.effective <= first.effective - 6) {
    warnings.push({ Icon: Snowflake, text: "It gets colder before you return. Dress for the later part of the outing." });
  }
  if (precip >= 40 && first.precip < 30) {
    warnings.push({ Icon: Umbrella, text: "Rain or snow becomes more likely while you are out, not necessarily when you leave." });
  }
  if (cycling) {
    warnings.push({ Icon: Bike, text: wind >= 12
      ? "Cycling will add noticeable airflow today. Prioritize a wind-resistant outer layer."
      : "Cycling mode is on, so the recommendation includes extra airflow and exertion." });
  }
  if (durationMinutes >= 120 && recommendationEffective < 50) {
    warnings.push({ Icon: Clock3, text: "This is a long cold exposure window; hands and ears may matter more than the headline temperature." });
  }

  return {
    rows: scored,
    start: first,
    end: last,
    windowStartAt,
    windowEndAt,
    effective: recommendationEffective,
    low,
    high,
    apparentLow: Math.min(...apparentValues),
    apparentHigh: Math.max(...apparentValues),
    band,
    cond,
    wind,
    precip,
    threats,
    warnings: warnings.slice(0, 3),
    extras: extrasFor(threats, cond),
    personalShift: recommendationEffective - Math.round(apparentValues.reduce((sum, value) => sum + value, 0) / apparentValues.length),
  };
}

function closetNeeds(bandKey, threats) {
  const wet = threats.find((item) => item.key === "wet")?.level >= 2;
  const windy = threats.find((item) => item.key === "wind")?.level >= 2;
  const map = {
    hot: [
      { category: "top", warmth: 1 }, { category: "bottom", warmth: 1 },
      { category: "shoes", warmth: 1 }, { category: "accessory", warmth: 1, optional: true },
    ],
    warm: [
      { category: "top", warmth: 1 }, { category: "bottom", warmth: 1 },
      { category: "shoes", warmth: 1 }, { category: "mid", warmth: 1, optional: true },
    ],
    mild: [
      { category: "top", warmth: 2 }, { category: "bottom", warmth: 2 },
      { category: "shoes", warmth: 1 }, { category: "mid", warmth: 1, optional: true },
    ],
    cool: [
      { category: "top", warmth: 2 }, { category: "outer", warmth: 2 },
      { category: "bottom", warmth: 2 }, { category: "shoes", warmth: 2 },
    ],
    chilly: [
      { category: "top", warmth: 2 }, { category: "mid", warmth: 3 },
      { category: "outer", warmth: 3 }, { category: "bottom", warmth: 2 },
      { category: "shoes", warmth: 2 },
    ],
    cold: [
      { category: "top", warmth: 3 }, { category: "mid", warmth: 3 },
      { category: "outer", warmth: 4 }, { category: "bottom", warmth: 3 },
      { category: "shoes", warmth: 3 }, { category: "accessory", warmth: 3 },
    ],
    veryCold: [
      { category: "top", warmth: 4 }, { category: "mid", warmth: 4 },
      { category: "outer", warmth: 5 }, { category: "bottom", warmth: 4 },
      { category: "shoes", warmth: 4 }, { category: "accessory", warmth: 4 },
    ],
    frigid: [
      { category: "top", warmth: 5 }, { category: "mid", warmth: 5 },
      { category: "outer", warmth: 5 }, { category: "bottom", warmth: 5 },
      { category: "shoes", warmth: 5 }, { category: "accessory", warmth: 5 },
    ],
  };
  return (map[bandKey] || map.mild).map((need) => ({
    ...need,
    waterproof: wet && ["outer", "shoes"].includes(need.category),
    windproof: windy && need.category === "outer",
  }));
}

function recommendFromCloset(closet, bandKey, threats) {
  if (!closet.length) return [];
  const used = new Set();
  const selected = [];
  for (const need of closetNeeds(bandKey, threats)) {
    const candidates = closet.filter((item) => item.category === need.category && !used.has(item.id));
    if (!candidates.length) continue;
    const ranked = [...candidates].sort((a, b) => {
      const score = (item) =>
        Math.abs(Number(item.warmth) - need.warmth) * 3 +
        (need.waterproof && !item.waterproof ? 7 : 0) +
        (need.windproof && !item.windproof ? 7 : 0);
      return score(a) - score(b);
    });
    const winner = ranked[0];
    if (need.optional && Math.abs(Number(winner.warmth) - need.warmth) > 2) continue;
    used.add(winner.id);
    selected.push(winner);
  }
  return selected;
}

function formatTime(value) {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatStartChoice(offset) {
  if (offset === 0) return "Now";
  const at = Date.now() + offset * 60 * 60 * 1000;
  return formatTime(at);
}

function categoryLabel(key) {
  return CATEGORY_OPTIONS.find((item) => item.key === key)?.label || key;
}

export default function Layer() {
  const [model, setModel] = useState(EMPTY_MODEL);
  const [closet, setCloset] = useState([]);
  const [ready, setReady] = useState(false);
  const [weather, setWeather] = useState(null);
  const [wxState, setWxState] = useState("loading");
  const [activity, setActivity] = useState("walking");
  const [cycling, setCycling] = useState(false);
  const [startOffset, setStartOffset] = useState(0);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [feedback, setFeedback] = useState(null);
  const [toast, setToast] = useState(null);
  const [showModel, setShowModel] = useState(false);
  const [showCloset, setShowCloset] = useState(false);
  const [newItem, setNewItem] = useState(EMPTY_ITEM);
  const [demo, setDemo] = useState(false);
  const [demoTemp, setDemoTemp] = useState(42);
  const [demoCond, setDemoCond] = useState("clear");
  const [demoWind, setDemoWind] = useState(false);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    (async () => {
      const saved = await storageGet(MODEL_KEY) || await storageGet(LEGACY_MODEL_KEY);
      if (saved?.value) {
        try { setModel(normalizeModel(JSON.parse(saved.value))); } catch (_) {}
      }
      const savedCloset = await storageGet(CLOSET_KEY);
      if (savedCloset?.value) {
        try {
          const parsed = JSON.parse(savedCloset.value);
          if (Array.isArray(parsed)) setCloset(parsed);
        } catch (_) {}
      }
      if (mounted.current) setReady(true);
    })();
  }, []);

  const commitModel = useCallback((next) => {
    setModel(next);
    storageSet(MODEL_KEY, JSON.stringify(next));
  }, []);

  const commitCloset = useCallback((next) => {
    setCloset(next);
    storageSet(CLOSET_KEY, JSON.stringify(next));
  }, []);

  const loadWeather = useCallback(async (force = false) => {
    setWxState("loading");
    if (!force) {
      const cached = await storageGet(WEATHER_CACHE_KEY);
      if (cached?.value) {
        try {
          const parsed = JSON.parse(cached.value);
          if (Date.now() - parsed.at < CACHE_TTL) {
            setWeather(parsed.data);
            setWxState("cached");
            return;
          }
        } catch (_) {}
      }
    }

    const variables = "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation_probability";
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${CAMPUS.lat}&longitude=${CAMPUS.lon}` +
      `&current=${variables}&hourly=${variables}&forecast_days=2` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
      const data = parseWeather(await response.json());
      if (!mounted.current) return;
      setWeather(data);
      setWxState("live");
      await storageSet(WEATHER_CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
    } catch (_) {
      if (!mounted.current) return;
      setWeather(demoWeather(72, "cloudy", false));
      setWxState("offline");
    }
  }, []);

  useEffect(() => { loadWeather(); }, [loadWeather]);

  const activeWeather = useMemo(
    () => demo ? demoWeather(demoTemp, demoCond, demoWind) : weather,
    [demo, demoTemp, demoCond, demoWind, weather],
  );

  const result = useMemo(
    () => buildOutingResult(activeWeather, model, activity, cycling, startOffset, durationMinutes),
    [activeWeather, model, activity, cycling, startOffset, durationMinutes],
  );

  const closetRecommendation = useMemo(
    () => result ? recommendFromCloset(closet, result.band.key, result.threats) : [],
    [closet, result],
  );

  const addClosetItem = () => {
    const name = newItem.name.trim();
    if (!name) return;
    const item = {
      ...newItem,
      name,
      warmth: Number(newItem.warmth),
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
    commitCloset([...closet, item]);
    setNewItem(EMPTY_ITEM);
    setToast(`${name} added to your closet.`);
  };

  const removeClosetItem = (id) => {
    commitCloset(closet.filter((item) => item.id !== id));
  };

  const beginFeedback = (kind) => setFeedback({ kind, stage: "adherence" });

  const applyFeedback = useCallback((kind, blameKey, adherence) => {
    if (!result) return;
    const direction = kind === "cold" ? -1 : kind === "warm" ? 1 : 0;
    const trainingWeight = adherence === "yes" ? 1 : adherence === "mostly" ? 0.45 : 0;
    const t = result.start.apparent;
    const weights = kernelWeights(t);
    const next = deepCopy(model);
    const alpha = PRIOR_N / (PRIOR_N + totalObservations(model));
    const delta = direction * STEP_MAX * alpha * trainingWeight;
    const toFactor = ["wind", "wet", "sun"].includes(blameKey) ? 0.7 : 0;
    const toTemperature = 1 - toFactor;

    for (const key in weights) {
      next.regime[key].off = clamp(
        next.regime[key].off + delta * weights[key] * toTemperature,
        -CLAMP,
        CLAMP,
      );
      next.regime[key].n += weights[key] * trainingWeight;
    }

    if (trainingWeight > 0 && toFactor > 0) {
      const sign = blameKey === "sun" ? 1 : -1;
      next.factors[blameKey] = clamp(
        (next.factors[blameKey] || 0) + sign * direction * STEP_MAX * alpha * toFactor * trainingWeight,
        -FACTOR_CLAMP,
        FACTOR_CLAMP,
      );
    }

    next.history = [...next.history, {
      at: Date.now(),
      apparent: t,
      effective: result.effective,
      regime: thermalRegime(t),
      band: result.band.key,
      activity,
      cycling,
      durationMinutes,
      startOffset,
      outcome: kind === "right" ? "right" : kind,
      blame: blameKey || null,
      adherence,
      trained: trainingWeight > 0,
      closetItems: closetRecommendation.map((item) => ({ id: item.id, name: item.name })),
    }].slice(-80);

    commitModel(next);
    setFeedback(null);
    if (adherence === "no") {
      setToast("Saved, but it did not retrain Layer because the recommendation was not followed.");
    } else if (kind === "right") {
      setToast("Good call. Layer counted this as reliable calibration evidence.");
    } else if (adherence === "mostly") {
      setToast("Noted with reduced weight because the recommendation was only partly followed.");
    } else if (blameKey && blameKey !== "cold") {
      setToast(`Noted — Layer will weight ${blameKey === "wet" ? "rain" : blameKey} more carefully for you.`);
    } else {
      setToast(kind === "cold" ? "Got it. Layer will call similar outings colder." : "Got it. Layer will lighten similar outings.");
    }
  }, [result, model, activity, cycling, durationMinutes, startOffset, closetRecommendation, commitModel]);

  const chooseAdherence = (adherence) => {
    if (!feedback) return;
    if (feedback.kind === "right" || adherence === "no") {
      applyFeedback(feedback.kind, null, adherence);
    } else {
      setFeedback({ ...feedback, adherence, stage: "cause" });
    }
  };

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  const seed = (climateKey, toleranceKey) => {
    const climate = CLIMATES.find((item) => item.key === climateKey);
    const tolerance = TOLERANCE.find((item) => item.key === toleranceKey);
    const next = deepCopy(EMPTY_MODEL);
    next.seeded = true;
    for (const key of ["cold", "mild", "warm"]) {
      next.regime[key].off = clamp(climate.seed[key] + tolerance.adj, -CLAMP, CLAMP);
      next.regime[key].n = 0.6;
    }
    commitModel(next);
  };

  const resetAll = () => {
    commitModel(deepCopy(EMPTY_MODEL));
    setToast("Personal model reset. Your closet was kept.");
  };

  const metric = useMemo(() => {
    const reliable = model.history.filter((entry) => entry.adherence !== "no");
    if (reliable.length < 3) return null;
    const rate = (rows) => rows.length
      ? Math.round(rows.filter((entry) => entry.outcome === "right").length / rows.length * 100)
      : null;
    const byRegime = {};
    for (const key of ["cold", "mild", "warm"]) {
      const rows = reliable.filter((entry) => (entry.regime || thermalRegime(entry.apparent)) === key);
      byRegime[key] = { rate: rate(rows), n: rows.length };
    }
    return {
      now: rate(reliable.slice(-10)),
      then: rate(reliable.slice(0, Math.min(5, Math.max(1, reliable.length - 5)))),
      n: reliable.length,
      spark: reliable.slice(-12),
      byRegime,
    };
  }, [model.history]);

  const accent = result?.band.accent || "#4FA3C7";
  const sky = result?.band.sky || ["#D2E8F4", "#A9D2E8"];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const conf = confidence(model);

  if (!ready) {
    return (
      <div className="lyr" style={{ "--accent": "#35A79B", "--sky1": "#CCEBEA", "--sky2": "#9FD8D6" }}>
        <style>{css}</style><div className="app"><div className="loading">Loading your calibration…</div></div>
      </div>
    );
  }
  if (!model.seeded) return <Onboarding onDone={seed} />;

  return (
    <div className="lyr" style={{ "--accent": accent, "--sky1": sky[0], "--sky2": sky[1] }}>
      <style>{css}</style>
      <div className="app">
        <header className="top">
          <div className="loc">
            <MapPin size={13} strokeWidth={2.4} />
            <span>{CAMPUS.name}</span>
            <span className="campus-sub">{CAMPUS.subtitle}</span>
          </div>
          <div className="top-r">
            {wxState === "offline" && <span className="pill">sample data</span>}
            {wxState === "cached" && <span className="pill">cached</span>}
            {demo && <span className="pill pill-demo">demo</span>}
            <button className="icon-btn" onClick={() => loadWeather(true)} aria-label="Refresh weather">
              <RefreshCw size={15} strokeWidth={2.4} className={wxState === "loading" ? "spin" : ""} />
            </button>
          </div>
        </header>

        {!result ? (
          <div className="loading">Reading the campus forecast…</div>
        ) : (
          <>
            <section className="card">
              <h2 className="card-h">Plan this campus outing</h2>
              <div className="outing-grid">
                <div>
                  <span className="field-label">Leaving</span>
                  <div className="choice-row">
                    {START_OFFSETS.map((offset) => (
                      <button key={offset} className={`choice ${startOffset === offset ? "on" : ""}`}
                        onClick={() => setStartOffset(offset)}>
                        {formatStartChoice(offset)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="field-label">Outside for</span>
                  <div className="choice-row">
                    {DURATIONS.map((duration) => (
                      <button key={duration.minutes} className={`choice ${durationMinutes === duration.minutes ? "on" : ""}`}
                        onClick={() => setDurationMinutes(duration.minutes)}>
                        {duration.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button className={`ride-toggle ${cycling ? "on" : ""}`} onClick={() => {
                  setCycling((value) => !value);
                  setToast(!cycling ? "Cycling mode on. Layer will account for extra airflow." : "Cycling mode off.");
                }}>
                  <span className="ride-left">
                    <Bike size={17} strokeWidth={2.2} />
                    <span className="ride-copy">
                      <span className="ride-title">Cycling or scootering</span>
                      <span className="ride-hint">Temporary trip modifier</span>
                    </span>
                  </span>
                  <span className="switch" aria-hidden="true" />
                </button>
              </div>
              <div className="outing-summary">
                <span><strong>{formatTime(result.windowStartAt)}–{formatTime(result.windowEndAt)}</strong> · {durationMinutes} min outside</span>
                <span className="range-pill">Feels {result.low}°–{result.high}°</span>
              </div>
            </section>

            <section className="hero">
              <div className="hero-meta">
                <span>{today}</span><span className="dot" />
                <span className="cond">
                  {(() => { const Icon = result.cond.Icon; return <Icon size={14} strokeWidth={2.2} />; })()}
                  {result.cond.label}
                </span>
              </div>
              <h1 className="verdict">{result.band.verdict}</h1>
              <p className="sub">{result.band.sub}</p>
              <div className="reads">
                <div className="read">
                  <span className="read-k">At departure</span>
                  <span className="read-v">{result.start.apparent}°</span>
                </div>
                <ArrowRight size={15} strokeWidth={2.4} className="read-arrow" />
                <div className="read read-you">
                  <span className="read-k">Dress for</span>
                  <span className="read-v">{result.effective}°</span>
                </div>
                {result.personalShift !== 0 && (
                  <span className="shift">{result.personalShift > 0 ? "+" : ""}{result.personalShift}° outing shift</span>
                )}
                <div className="read-note">The recommendation uses the full outing window, your calibration, activity, and temporary trip conditions.</div>
              </div>
            </section>

            {result.warnings.length > 0 && (
              <div className="alerts">
                {result.warnings.map((warning, index) => {
                  const Icon = warning.Icon;
                  return <div className="alert" key={`${warning.text}-${index}`}><Icon size={15} strokeWidth={2.3} /><span>{warning.text}</span></div>;
                })}
              </div>
            )}

            <section className="card">
              <h2 className="card-h">Wear this</h2>
              <ul className="layers">
                {result.band.layers.map((layer, index) => (
                  <li key={layer.label} className="lyr-row">
                    <span className="lyr-n">{index + 1}</span>
                    <span className="lyr-txt">
                      <span className="lyr-name">{layer.label}</span>
                      {layer.note && <span className="lyr-note">{layer.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {result.extras.length > 0 && (
                <div className="extras">
                  {result.extras.map((extra) => {
                    const Icon = extra.Icon;
                    return <div key={extra.text} className="extra"><Icon size={15} strokeWidth={2.2} /><span>{extra.text}</span></div>;
                  })}
                </div>
              )}
            </section>

            <section className="card">
              <div className="closet-head">
                <h2 className="card-h">From your closet</h2>
                <span className="beta">matching beta</span>
              </div>
              {closetRecommendation.length ? (
                <div className="closet-rec">
                  {closetRecommendation.map((item) => (
                    <div className="closet-rec-row" key={item.id}>
                      <span className="closet-rec-main">
                        <Shirt size={15} strokeWidth={2.2} />
                        <span>
                          <span className="closet-rec-name">{item.name}</span>
                          <span className="closet-rec-cat">{categoryLabel(item.category)} · warmth {item.warmth}/5</span>
                        </span>
                      </span>
                      <span className="trait-row">
                        {item.windproof && <span className="trait">wind</span>}
                        {item.waterproof && <span className="trait">water</span>}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="closet-empty">Add a few real items first. Layer will then choose from what you actually own instead of giving only generic clothing categories.</p>
              )}
              <button className="manage-btn" onClick={() => setShowCloset((value) => !value)}>
                <ChevronDown size={14} strokeWidth={2.6} className={showCloset ? "open" : ""} />
                {showCloset ? "Close closet" : closet.length ? "Manage closet" : "Build my closet"}
              </button>
              {showCloset && (
                <div className="closet-panel">
                  {closet.length > 0 && (
                    <div className="closet-list">
                      {closet.map((item) => (
                        <div className="closet-item" key={item.id}>
                          <div className="closet-item-copy">
                            <div className="closet-item-name">{item.name}</div>
                            <div className="closet-item-meta">{categoryLabel(item.category)} · warmth {item.warmth}/5{item.windproof ? " · windproof" : ""}{item.waterproof ? " · waterproof" : ""}</div>
                          </div>
                          <button className="delete-btn" onClick={() => removeClosetItem(item.id)} aria-label={`Remove ${item.name}`}>
                            <Trash2 size={14} strokeWidth={2.2} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="add-grid">
                    <input className="text-input" value={newItem.name} placeholder="e.g. black puffer jacket"
                      onChange={(event) => setNewItem({ ...newItem, name: event.target.value })} />
                    <select className="select-input" value={newItem.category}
                      onChange={(event) => setNewItem({ ...newItem, category: event.target.value })}>
                      {CATEGORY_OPTIONS.map((category) => <option value={category.key} key={category.key}>{category.label}</option>)}
                    </select>
                    <div className="warmth-wrap">
                      <span className="field-label" style={{ margin: 0 }}>Warmth</span>
                      <input type="range" min="1" max="5" value={newItem.warmth}
                        onChange={(event) => setNewItem({ ...newItem, warmth: Number(event.target.value) })} />
                      <span className="warmth-value">{newItem.warmth}/5</span>
                    </div>
                    <div className="check-row">
                      <button className={`check-chip ${newItem.windproof ? "on" : ""}`}
                        onClick={() => setNewItem({ ...newItem, windproof: !newItem.windproof })}>Windproof</button>
                      <button className={`check-chip ${newItem.waterproof ? "on" : ""}`}
                        onClick={() => setNewItem({ ...newItem, waterproof: !newItem.waterproof })}>Waterproof</button>
                    </div>
                    <button className="add-btn" disabled={!newItem.name.trim()} onClick={addClosetItem}>
                      <Plus size={14} strokeWidth={2.5} /> Add item
                    </button>
                  </div>
                  <p className="closet-note">Scanning should eventually automate this catalog step. Keeping entry manual for now lets you test whether the outfit-matching logic is useful before adding computer vision.</p>
                </div>
              )}
            </section>

            <section className="card">
              <h2 className="card-h">What is the plan?</h2>
              <div className="acts">
                {Object.entries(ACTIVITIES).map(([key, item]) => {
                  const Icon = item.Icon;
                  return (
                    <button key={key} className={`act ${activity === key ? "on" : ""}`} onClick={() => setActivity(key)}>
                      <Icon size={17} strokeWidth={2.2} />
                      <span className="act-l">{item.label}</span>
                      <span className="act-h">{item.hint}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <h2 className="card-h">Comfort threats</h2>
                <div className="scale">{LEVELS.map((level) => <span key={level}>{level}</span>)}</div>
              </div>
              <div className="threats">
                {result.threats.map((threat) => {
                  const Icon = threat.Icon;
                  return (
                    <div key={threat.key} className={`threat lv-${threat.level}`}>
                      <span className="th-l"><Icon size={14} strokeWidth={2.2} />{threat.label}</span>
                      <span className="meter">
                        {[1, 2, 3, 4].map((index) => <span key={index} className={`seg ${index <= Math.max(threat.level, 1) ? "fill" : ""}`} />)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="card">
              <h2 className="card-h">How did it feel out there?</h2>
              {!feedback ? (
                <div className="fb-row">
                  <button className="fb" onClick={() => beginFeedback("cold")}><Snowflake size={18} strokeWidth={2.2} />Too cold</button>
                  <button className="fb fb-ok" onClick={() => beginFeedback("right")}><Check size={18} strokeWidth={2.6} />Just right</button>
                  <button className="fb" onClick={() => beginFeedback("warm")}><Flame size={18} strokeWidth={2.2} />Too warm</button>
                </div>
              ) : feedback.stage === "adherence" ? (
                <div className="fb-step">
                  <p className="fb-question">Did you follow Layer's recommendation?</p>
                  <p className="fb-sub">This prevents a skipped coat from being learned as a bad forecast.</p>
                  <div className="fb-actions">
                    <button className="fb-choice" onClick={() => chooseAdherence("yes")}>Yes</button>
                    <button className="fb-choice" onClick={() => chooseAdherence("mostly")}>Mostly</button>
                    <button className="fb-choice" onClick={() => chooseAdherence("no")}>No</button>
                  </div>
                  <button className="fb-back" onClick={() => setFeedback(null)}>Cancel</button>
                </div>
              ) : (
                <div className="blame">
                  <div className="blame-h">
                    <span>What caused it?</span>
                    <button className="icon-btn" onClick={() => setFeedback(null)} aria-label="Cancel feedback"><X size={15} strokeWidth={2.4} /></button>
                  </div>
                  <div className="blame-list">
                    <button className="blame-b"
                      onClick={() => applyFeedback(feedback.kind, "temperature", feedback.adherence)}>
                      {feedback.kind === "cold" ? <Snowflake size={15} strokeWidth={2.2} /> : <Flame size={15} strokeWidth={2.2} />}
                      {feedback.kind === "cold" ? "The temperature itself felt colder" : "The temperature itself felt warmer"}
                    </button>
                    {feedback.kind === "cold" && result.threats
                      .filter((threat) => ["wind", "wet"].includes(threat.key))
                      .map((threat) => {
                        const Icon = threat.Icon;
                        return (
                          <button key={threat.key} className="blame-b"
                            onClick={() => applyFeedback(feedback.kind, threat.key, feedback.adherence)}>
                            <Icon size={15} strokeWidth={2.2} />{threat.blame}
                          </button>
                        );
                      })}
                    {feedback.kind === "warm" && (
                      <button className="blame-b" onClick={() => applyFeedback(feedback.kind, "sun", feedback.adherence)}>
                        <Sun size={15} strokeWidth={2.2} />The direct sun made it worse
                      </button>
                    )}
                    <button className="blame-b blame-skip"
                      onClick={() => applyFeedback(feedback.kind, null, feedback.adherence)}>
                      Not sure — it was just off overall
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2 className="card-h">Your calibration</h2>
                <span className="conf">{conf}% confident</span>
              </div>
              {metric ? (
                <div className="metric">
                  <div className="metric-main">
                    <span className="metric-v">{metric.now}%</span>
                    <span className="metric-k">reliable outings rated “just right”<br />over your last {Math.min(10, metric.n)}</span>
                  </div>
                  {metric.then !== null && metric.now !== metric.then && (
                    <div className={`delta ${metric.now > metric.then ? "up" : ""}`}>
                      <TrendingUp size={13} strokeWidth={2.6} />
                      {metric.now > metric.then ? "+" : ""}{metric.now - metric.then} points since you started
                    </div>
                  )}
                  <div className="spark">{metric.spark.map((entry, index) => <span key={`${entry.at}-${index}`} className={`sp ${entry.outcome}`} />)}</div>
                  <div className="metric-breakdown">
                    {["cold", "mild", "warm"].map((key) => (
                      <div className="metric-chip" key={key}>
                        <strong>{metric.byRegime[key].rate == null ? "—" : `${metric.byRegime[key].rate}%`}</strong>
                        <span>{key} · {metric.byRegime[key].n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="empty">Complete and rate a few outings. Feedback only trains the model when you followed the recommendation.</p>
              )}

              <div className="regimes">
                {[["cold", "Cold days"], ["mild", "Mild days"], ["warm", "Warm days"]].map(([key, label]) => {
                  const offset = model.regime[key].off;
                  const pct = ((clamp(offset, -CLAMP, CLAMP) + CLAMP) / (CLAMP * 2)) * 100;
                  return (
                    <div key={key} className="reg">
                      <span className="reg-l">{label}</span>
                      <span className="reg-track"><span className="reg-mid" /><span className="reg-dot" style={{ left: `${pct}%` }} /></span>
                      <span className="reg-v">{offset > 0 ? "+" : ""}{offset.toFixed(1)}°</span>
                    </div>
                  );
                })}
              </div>

              <button className="link" onClick={() => setShowModel((value) => !value)}>
                <ChevronDown size={14} strokeWidth={2.6} className={showModel ? "open" : ""} /> How this learns
              </button>
              {showModel && (
                <div className="explain">
                  <p>Layer starts with Open-Meteo's apparent temperature, then applies your learned cold, mild, and warm offsets. It examines every forecast hour in the selected outing and dresses for the most relevant part of that window.</p>
                  <p>Feedback is weighted by whether you followed the recommendation: full weight for yes, reduced weight for mostly, and no model update for no. Cycling and outing length are temporary modifiers and do not become permanent body preferences.</p>
                  <p>When you identify wind, wetness, or sun as the cause, most of the correction trains that sensitivity rather than incorrectly blaming temperature.</p>
                  <button className="reset" onClick={resetAll}>Reset personal model</button>
                </div>
              )}
            </section>

            <section className="demo-wrap">
              <button className="link" onClick={() => setDemo((value) => !value)}>
                <ChevronDown size={14} strokeWidth={2.6} className={demo ? "open" : ""} />
                {demo ? "Demo conditions on" : "Try other conditions"}
              </button>
              {demo && (
                <div className="demo">
                  <div className="demo-top"><span className="demo-k">Starting feels like</span><span className="demo-v">{demoTemp}°F</span></div>
                  <input className="slider" type="range" min="0" max="100" value={demoTemp}
                    onChange={(event) => setDemoTemp(Number(event.target.value))} aria-label="Demo temperature" />
                  <div className="chips">
                    {["clear", "cloudy", "rain", "snow"].map((condition) => (
                      <button key={condition} className={`chip ${demoCond === condition ? "on" : ""}`}
                        onClick={() => setDemoCond(condition)}>{condition}</button>
                    ))}
                    <button className={`chip ${demoWind ? "on" : ""}`} onClick={() => setDemoWind((value) => !value)}>windy</button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {toast && <div className="global-toast" role="status">{toast}</div>}
        <footer className="foot">Layer · weather you can wear</footer>
      </div>
    </div>
  );
}

function Onboarding({ onDone }) {
  const [climate, setClimate] = useState(null);
  const [tol, setTol] = useState(null);
  return (
    <div className="lyr" style={{ "--accent": "#35A79B", "--sky1": "#CCEBEA", "--sky2": "#9FD8D6" }}>
      <style>{css}</style>
      <div className="app ob">
        <div className="ob-mark">Layer</div>
        <h1 className="ob-h">Weather is personal.</h1>
        <p className="ob-p">
          The same Cornell forecast does not feel the same to everyone. Two quick questions help the first campus recommendation land close — then your feedback takes over.
        </p>

        <div className="ob-q">
          <span className="ob-l">Where did you spend most of your life?</span>
          <div className="ob-opts">
            {CLIMATES.map((c) => (
              <button key={c.key} className={`ob-opt ${climate === c.key ? "on" : ""}`}
                onClick={() => setClimate(c.key)}>
                <span className="ob-opt-l">{c.label}</span>
                <span className="ob-opt-n">{c.note}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ob-q">
          <span className="ob-l">In a room where everyone's comfortable, you're…</span>
          <div className="ob-opts ob-opts-row">
            {TOLERANCE.map((t) => (
              <button key={t.key} className={`ob-opt ${tol === t.key ? "on" : ""}`}
                onClick={() => setTol(t.key)}>
                <span className="ob-opt-l">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        <button className="ob-go" disabled={!climate || !tol} onClick={() => onDone(climate, tol)}>
          Start <ArrowRight size={17} strokeWidth={2.6} />
        </button>
        <p className="ob-foot">You can retrain or reset this any time.</p>
      </div>
    </div>
  );
}

/* ═══ STYLES ═══ */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&family=Instrument+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');

.lyr{
  --paper:#F4F6F9; --card:#FFFFFF; --ink:#141C28; --muted:#67748A;
  --line:rgba(20,28,40,.09); --line-2:rgba(20,28,40,.05);
  min-height:100%; width:100%; padding:20px 14px 36px;
  display:flex; justify-content:center;
  background:radial-gradient(130% 55% at 50% 0%, var(--sky1) 0%, transparent 62%), var(--paper);
  font-family:'Instrument Sans',system-ui,sans-serif; color:var(--ink);
  -webkit-font-smoothing:antialiased; transition:background .7s ease;
}
.app{width:100%; max-width:420px;}

.top{display:flex; align-items:center; justify-content:space-between; margin-bottom:26px;}
.loc{display:flex; align-items:center; gap:6px; font-size:13.5px; font-weight:600;}
.loc svg{color:var(--accent);}
.top-r{display:flex; align-items:center; gap:7px;}
.pill{font-family:'DM Mono',monospace; font-size:9.5px; letter-spacing:.05em; text-transform:uppercase;
  padding:3px 7px; border-radius:6px; background:rgba(20,28,40,.06); color:var(--muted);}
.pill-demo{background:color-mix(in srgb,var(--accent) 16%,transparent); color:var(--accent);}
.icon-btn{background:none; border:none; cursor:pointer; color:var(--muted); padding:5px; display:flex; border-radius:8px;}
.icon-btn:hover{color:var(--ink); background:rgba(20,28,40,.05);}
.spin{animation:sp 1s linear infinite;} @keyframes sp{to{transform:rotate(360deg);}}
.loading{padding:60px 0; color:var(--muted); font-size:15px;}

.hero{margin-bottom:22px;}
.hero-meta{display:flex; align-items:center; gap:9px; font-size:12.5px; color:var(--muted); margin-bottom:12px;}
.hero-meta .dot{width:3px; height:3px; border-radius:50%; background:currentColor; opacity:.5;}
.cond{display:inline-flex; align-items:center; gap:5px;}
.cond svg{color:var(--accent);}
.verdict{font-family:'Outfit',sans-serif; font-weight:700; font-size:40px; line-height:1.02;
  letter-spacing:-.03em; margin:0;}
.sub{margin:10px 0 0; font-size:15px; line-height:1.45; color:var(--muted); max-width:32ch;}
.reads{display:flex; align-items:center; gap:10px; margin-top:18px; flex-wrap:wrap;}
.read{display:flex; flex-direction:column; gap:1px;}
.read-k{font-family:'DM Mono',monospace; font-size:9.5px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--muted);}
.read-v{font-family:'Outfit',sans-serif; font-weight:600; font-size:24px; letter-spacing:-.02em;}
.read-you .read-v{color:var(--accent);}
.read-arrow{color:var(--muted); opacity:.55; margin-top:8px;}
.shift{font-family:'DM Mono',monospace; font-size:10.5px; color:var(--accent); margin-top:10px;
  background:color-mix(in srgb,var(--accent) 12%,transparent); padding:4px 8px; border-radius:7px;}

.card{background:var(--card); border:1px solid var(--line); border-radius:20px;
  padding:17px 17px 18px; margin-bottom:12px;
  box-shadow:0 1px 2px rgba(20,28,40,.04), 0 8px 24px -18px rgba(20,28,40,.3);}
.card-h{font-family:'Outfit',sans-serif; font-size:12.5px; font-weight:600; letter-spacing:.02em;
  margin:0 0 13px; color:var(--ink);}
.card-head{display:flex; align-items:center; justify-content:space-between; margin-bottom:13px;}
.card-head .card-h{margin:0;}

.layers{list-style:none; margin:0; padding:0;}
.lyr-row{display:flex; gap:12px; align-items:flex-start; padding:10px 0; border-top:1px solid var(--line-2);}
.lyr-row:first-child{border-top:none; padding-top:0;}
.lyr-n{font-family:'DM Mono',monospace; font-size:11px; color:var(--accent); min-width:14px; padding-top:3px;}
.lyr-txt{display:flex; flex-direction:column; gap:2px;}
.lyr-name{font-size:15.5px; font-weight:500; line-height:1.3;}
.lyr-note{font-size:12.5px; color:var(--muted); line-height:1.35;}
.extras{margin:12px -17px -18px; padding:13px 17px 15px; border-top:1px solid var(--line);
  background:color-mix(in srgb,var(--accent) 6%,transparent); border-radius:0 0 19px 19px;}
.extra{display:flex; gap:9px; align-items:flex-start; font-size:13px; line-height:1.4; padding:3px 0;}
.extra svg{color:var(--accent); flex-shrink:0; margin-top:1px;}

.acts{display:flex; gap:7px;}
.act{flex:1; display:flex; flex-direction:column; align-items:flex-start; gap:3px;
  padding:11px 10px; border-radius:13px; cursor:pointer; text-align:left;
  background:var(--paper); border:1px solid transparent; color:var(--ink);
  font-family:'Instrument Sans',sans-serif; transition:all .16s ease;}
.act svg{color:var(--muted); margin-bottom:3px;}
.act:hover{background:rgba(20,28,40,.05);}
.act.on{background:color-mix(in srgb,var(--accent) 11%,transparent);
  border-color:color-mix(in srgb,var(--accent) 42%,transparent);}
.act.on svg{color:var(--accent);}
.act-l{font-size:12.5px; font-weight:600; line-height:1.2;}
.act-h{font-size:10.5px; color:var(--muted); line-height:1.25;}

.scale{display:flex; font-family:'DM Mono',monospace; font-size:8.5px;
  letter-spacing:.04em; text-transform:uppercase; color:var(--muted); width:152px;}
.scale span{width:38px; text-align:center;}
.threats{display:flex; flex-direction:column; gap:9px;}
.threat{display:flex; align-items:center; justify-content:space-between; gap:12px;}
.th-l{display:flex; align-items:center; gap:7px; font-size:13.5px; font-weight:500;}
.th-l svg{color:var(--muted);}
.meter{display:flex; gap:3px; width:152px;}
.seg{flex:1; height:9px; border-radius:3px; background:rgba(20,28,40,.07);}
.lv-0 .seg.fill{background:rgba(20,28,40,.15);}
.lv-1 .seg.fill{background:#8FCF6F;}
.lv-2 .seg.fill{background:#E9B93F;}
.lv-3 .seg.fill{background:#E0703C;}
.lv-0 .th-l svg{opacity:.45;}
.lv-0 .th-l{color:var(--muted);}

.fb-row{display:flex; gap:8px;}
.fb{flex:1; display:flex; flex-direction:column; align-items:center; gap:7px; padding:14px 6px;
  border-radius:14px; cursor:pointer; background:var(--paper); border:1px solid transparent;
  color:var(--ink); font-family:'Instrument Sans',sans-serif; font-size:12.5px; font-weight:600;
  transition:all .16s ease;}
.fb svg{color:var(--muted);}
.fb:hover{background:rgba(20,28,40,.055);}
.fb-ok:hover{background:color-mix(in srgb,var(--accent) 12%,transparent);}
.fb-ok:hover svg{color:var(--accent);}

.blame{animation:fade .22s ease;}
.blame-h{display:flex; align-items:center; justify-content:space-between; font-size:13px;
  font-weight:600; margin-bottom:9px;}
.blame-list{display:flex; flex-direction:column; gap:6px;}
.blame-b{display:flex; align-items:center; gap:9px; padding:11px 12px; border-radius:12px;
  cursor:pointer; background:var(--paper); border:1px solid transparent; text-align:left;
  color:var(--ink); font-family:'Instrument Sans',sans-serif; font-size:13.5px; font-weight:500;}
.blame-b svg{color:var(--accent);}
.blame-b:hover{background:color-mix(in srgb,var(--accent) 10%,transparent);}
.blame-skip{color:var(--muted); font-size:12.5px;}
@keyframes fade{from{opacity:0; transform:translateY(4px);} to{opacity:1; transform:none;}}

.toast{margin-top:11px; font-size:13px; color:var(--accent); line-height:1.4;
  background:color-mix(in srgb,var(--accent) 10%,transparent);
  padding:10px 12px; border-radius:11px; animation:fade .25s ease;}

.conf{font-family:'DM Mono',monospace; font-size:10.5px; color:var(--muted);}
.metric{padding-bottom:16px; margin-bottom:15px; border-bottom:1px solid var(--line-2);}
.metric-main{display:flex; align-items:center; gap:12px;}
.metric-v{font-family:'Outfit',sans-serif; font-weight:700; font-size:38px;
  letter-spacing:-.03em; color:var(--accent);}
.metric-k{font-size:12.5px; color:var(--muted); line-height:1.35;}
.delta{display:inline-flex; align-items:center; gap:5px; margin-top:9px; font-size:11.5px;
  font-weight:600; color:var(--muted);}
.delta.up{color:#3F9E6A;}
.spark{display:flex; gap:3px; margin-top:12px;}
.sp{width:100%; max-width:16px; height:16px; border-radius:4px; background:rgba(20,28,40,.1);}
.sp.right{background:#6FB558;} .sp.cold{background:#7FB6DD;} .sp.warm{background:#E9B93F;}
.empty{font-size:13px; color:var(--muted); margin:0 0 15px; padding-bottom:15px;
  border-bottom:1px solid var(--line-2); line-height:1.45;}

.regimes{display:flex; flex-direction:column; gap:11px;}
.reg{display:flex; align-items:center; gap:11px;}
.reg-l{font-size:12.5px; color:var(--muted); width:74px;}
.reg-track{position:relative; flex:1; height:3px; border-radius:3px; background:rgba(20,28,40,.09);}
.reg-mid{position:absolute; left:50%; top:-3px; width:1px; height:9px; background:rgba(20,28,40,.16);}
.reg-dot{position:absolute; top:50%; width:11px; height:11px; border-radius:50%; background:var(--accent);
  transform:translate(-50%,-50%); transition:left .45s cubic-bezier(.4,1.2,.5,1);}
.reg-v{font-family:'DM Mono',monospace; font-size:11px; width:40px; text-align:right; color:var(--ink);}

.link{display:flex; align-items:center; gap:6px; background:none; border:none; cursor:pointer;
  color:var(--muted); font-family:'Instrument Sans',sans-serif; font-size:12.5px;
  padding:12px 0 0; font-weight:500;}
.link:hover{color:var(--ink);}
.link svg{transition:transform .2s ease;} .link .open{transform:rotate(180deg);}
.explain{margin-top:10px; padding:13px; border-radius:13px; background:var(--paper);}
.explain p{margin:0 0 9px; font-size:12.5px; line-height:1.5; color:var(--muted);}
.reset{background:none; border:none; padding:0; cursor:pointer; color:#C2553C;
  font-family:'DM Mono',monospace; font-size:11px; text-decoration:underline; text-underline-offset:2px;}

.demo-wrap{margin-top:4px;}
.demo{margin-top:10px; padding:15px; border-radius:16px; background:var(--card); border:1px dashed var(--line);}
.demo-top{display:flex; align-items:baseline; justify-content:space-between; margin-bottom:10px;}
.demo-k{font-family:'DM Mono',monospace; font-size:10px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--muted);}
.demo-v{font-family:'Outfit',sans-serif; font-weight:600; font-size:21px; color:var(--accent);}
.slider{width:100%; -webkit-appearance:none; appearance:none; height:4px; border-radius:4px; outline:none;
  background:linear-gradient(90deg,#4C8FD4,#4FA3C7,#3FAE84,#6FB558,#E0A32E,#E2703A);}
.slider::-webkit-slider-thumb{-webkit-appearance:none; width:18px; height:18px; border-radius:50%;
  background:#fff; border:1px solid var(--line); cursor:pointer; box-shadow:0 2px 6px rgba(20,28,40,.18);}
.slider::-moz-range-thumb{width:18px; height:18px; border:1px solid var(--line); border-radius:50%;
  background:#fff; cursor:pointer;}
.chips{display:flex; flex-wrap:wrap; gap:6px; margin-top:13px;}
.chip{padding:6px 11px; border-radius:9px; cursor:pointer; text-transform:capitalize;
  background:var(--paper); border:1px solid transparent; color:var(--muted);
  font-family:'DM Mono',monospace; font-size:11px;}
.chip.on{color:var(--accent); background:color-mix(in srgb,var(--accent) 12%,transparent);
  border-color:color-mix(in srgb,var(--accent) 35%,transparent);}

.foot{margin-top:22px; text-align:center; font-family:'DM Mono',monospace; font-size:9.5px;
  letter-spacing:.12em; text-transform:uppercase; color:var(--muted); opacity:.55;}

/* onboarding */
.ob{padding-top:14px;}
.ob-mark{font-family:'Outfit',sans-serif; font-weight:700; font-size:14px;
  letter-spacing:-.01em; color:var(--accent); margin-bottom:34px;}
.ob-h{font-family:'Outfit',sans-serif; font-weight:700; font-size:38px; line-height:1.02;
  letter-spacing:-.03em; margin:0;}
.ob-p{margin:12px 0 30px; font-size:14.5px; line-height:1.5; color:var(--muted); max-width:34ch;}
.ob-q{margin-bottom:22px;}
.ob-l{display:block; font-size:13px; font-weight:600; margin-bottom:10px;}
.ob-opts{display:flex; flex-direction:column; gap:7px;}
.ob-opts-row{flex-direction:row;}
.ob-opts-row .ob-opt{flex:1; align-items:center; text-align:center;}
.ob-opt{display:flex; flex-direction:column; gap:2px; padding:13px 14px; border-radius:14px;
  cursor:pointer; text-align:left; background:var(--card); border:1px solid var(--line);
  color:var(--ink); font-family:'Instrument Sans',sans-serif; transition:all .16s ease;}
.ob-opt:hover{border-color:rgba(20,28,40,.2);}
.ob-opt.on{border-color:var(--accent); background:color-mix(in srgb,var(--accent) 10%,transparent);}
.ob-opt-l{font-size:14px; font-weight:600; line-height:1.25;}
.ob-opt-n{font-size:12px; color:var(--muted);}
.ob-go{display:flex; align-items:center; justify-content:center; gap:8px; width:100%;
  padding:15px; border-radius:14px; border:none; cursor:pointer; margin-top:8px;
  background:var(--ink); color:var(--paper);
  font-family:'Outfit',sans-serif; font-size:15px; font-weight:600;}
.ob-go:disabled{opacity:.3; cursor:not-allowed;}
.ob-foot{text-align:center; font-size:11.5px; color:var(--muted); margin-top:14px;}

button:focus-visible, .slider:focus-visible{outline:2px solid var(--accent); outline-offset:2px;}
@media (max-width:380px){
  .verdict,.ob-h{font-size:33px;}
  .acts{flex-direction:column;}
  .act{flex-direction:row; align-items:center; gap:9px;}
  .act svg{margin-bottom:0;}
  .meter,.scale{width:118px;} .scale span{width:29px;}
}
@media (prefers-reduced-motion:reduce){
  .spin{animation:none;} .reg-dot{transition:none;} .toast,.blame{animation:none;}
}

/* v4: outing planner, wardrobe, validated feedback */
.campus-sub{font-size:10px;color:var(--muted);font-weight:500;margin-left:2px;}
.outing-grid{display:grid;grid-template-columns:1fr;gap:14px;}
.field-label{display:block;font-family:'DM Mono',monospace;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:7px;}
.choice-row{display:flex;gap:6px;flex-wrap:wrap;}
.choice{border:1px solid transparent;background:var(--paper);color:var(--muted);border-radius:10px;padding:8px 10px;cursor:pointer;font-family:'Instrument Sans',sans-serif;font-size:12px;font-weight:600;}
.choice:hover{color:var(--ink);background:rgba(20,28,40,.055);}
.choice.on{color:var(--accent);background:color-mix(in srgb,var(--accent) 11%,transparent);border-color:color-mix(in srgb,var(--accent) 38%,transparent);}
.ride-toggle{width:100%;margin-top:2px;border:1px solid var(--line);background:var(--card);border-radius:13px;padding:11px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;color:var(--ink);font-family:'Instrument Sans',sans-serif;text-align:left;}
.ride-left{display:flex;align-items:center;gap:9px;}.ride-left svg{color:var(--muted);}.ride-toggle.on{border-color:color-mix(in srgb,var(--accent) 45%,transparent);background:color-mix(in srgb,var(--accent) 7%,transparent);}.ride-toggle.on svg{color:var(--accent);}
.ride-copy{display:flex;flex-direction:column;gap:1px;}.ride-title{font-size:13px;font-weight:600;}.ride-hint{font-size:11px;color:var(--muted);}.switch{width:33px;height:19px;border-radius:99px;background:rgba(20,28,40,.13);padding:2px;display:flex;transition:.18s;}.switch:after{content:'';width:15px;height:15px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(20,28,40,.2);transition:.18s;}.ride-toggle.on .switch{background:var(--accent);}.ride-toggle.on .switch:after{transform:translateX(14px);}
.outing-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:13px;padding-top:12px;border-top:1px solid var(--line-2);font-size:12.5px;color:var(--muted);}.outing-summary strong{color:var(--ink);font-weight:600;}
.range-pill{font-family:'DM Mono',monospace;font-size:10px;padding:5px 8px;border-radius:8px;background:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent);white-space:nowrap;}
.alerts{display:flex;flex-direction:column;gap:7px;margin:0 0 12px;}.alert{display:flex;gap:8px;align-items:flex-start;padding:10px 11px;border-radius:12px;background:color-mix(in srgb,var(--accent) 8%,transparent);font-size:12.5px;line-height:1.4;color:var(--ink);}.alert svg{color:var(--accent);flex-shrink:0;margin-top:1px;}
.global-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:20;width:min(390px,calc(100vw - 28px));box-sizing:border-box;background:var(--ink);color:var(--paper);padding:12px 14px;border-radius:13px;font-size:12.5px;line-height:1.4;box-shadow:0 12px 34px rgba(20,28,40,.24);animation:fade .22s ease;}
.read-note{width:100%;font-size:11.5px;color:var(--muted);line-height:1.35;margin-top:1px;}
.fb-step{animation:fade .22s ease;}.fb-question{font-size:13px;font-weight:600;margin:0 0 9px;}.fb-sub{font-size:11.5px;color:var(--muted);margin:-4px 0 10px;line-height:1.4;}.fb-actions{display:flex;gap:7px;}.fb-choice{flex:1;border:1px solid transparent;background:var(--paper);border-radius:12px;padding:10px 7px;cursor:pointer;font-family:'Instrument Sans',sans-serif;font-size:12px;font-weight:600;color:var(--ink);}.fb-choice:hover{background:color-mix(in srgb,var(--accent) 10%,transparent);}.fb-back{margin-top:9px;background:none;border:none;padding:0;color:var(--muted);font-size:11.5px;cursor:pointer;text-decoration:underline;text-underline-offset:2px;}
.metric-breakdown{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:12px;}.metric-chip{padding:8px;border-radius:10px;background:var(--paper);display:flex;flex-direction:column;gap:2px;}.metric-chip strong{font-family:'Outfit',sans-serif;font-size:16px;}.metric-chip span{font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;}
.closet-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:13px;}.closet-head .card-h{margin:0;}.beta{font-family:'DM Mono',monospace;font-size:8.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent);padding:4px 7px;border-radius:7px;}
.closet-rec{display:flex;flex-direction:column;gap:7px;}.closet-rec-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 11px;border-radius:12px;background:var(--paper);}.closet-rec-main{display:flex;align-items:center;gap:9px;min-width:0;}.closet-rec-main svg{color:var(--accent);flex-shrink:0;}.closet-rec-name{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.closet-rec-cat{font-size:10.5px;color:var(--muted);text-transform:capitalize;}.trait-row{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;}.trait{font-family:'DM Mono',monospace;font-size:8.5px;padding:3px 5px;border-radius:5px;background:rgba(20,28,40,.06);color:var(--muted);}
.closet-empty{font-size:13px;color:var(--muted);line-height:1.5;margin:0 0 12px;}.closet-note{font-size:11px;color:var(--muted);line-height:1.45;margin:10px 0 0;}
.manage-btn{display:flex;align-items:center;gap:6px;margin-top:12px;background:none;border:none;padding:0;color:var(--accent);font-family:'Instrument Sans',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;}
.closet-panel{margin-top:14px;padding-top:14px;border-top:1px solid var(--line-2);animation:fade .22s ease;}.closet-list{display:flex;flex-direction:column;gap:6px;margin-bottom:13px;}.closet-item{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:9px 10px;border-radius:11px;background:var(--paper);}.closet-item-copy{min-width:0;}.closet-item-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.closet-item-meta{font-size:10.5px;color:var(--muted);text-transform:capitalize;}.delete-btn{border:none;background:none;color:#B65B47;cursor:pointer;padding:5px;display:flex;border-radius:7px;}.delete-btn:hover{background:rgba(182,91,71,.08);}
.add-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:7px;}.text-input,.select-input{width:100%;box-sizing:border-box;border:1px solid var(--line);background:var(--card);border-radius:10px;padding:10px 11px;color:var(--ink);font-family:'Instrument Sans',sans-serif;font-size:12.5px;outline:none;}.text-input:focus,.select-input:focus{border-color:var(--accent);}.warmth-wrap{grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:7px 1px 2px;}.warmth-wrap input{flex:1;}.warmth-value{font-family:'DM Mono',monospace;font-size:10.5px;color:var(--accent);min-width:54px;text-align:right;}.check-row{grid-column:1/-1;display:flex;gap:7px;}.check-chip{flex:1;border:1px solid var(--line);background:var(--card);border-radius:10px;padding:9px;cursor:pointer;font-family:'Instrument Sans',sans-serif;font-size:11.5px;color:var(--muted);}.check-chip.on{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 38%,transparent);background:color-mix(in srgb,var(--accent) 8%,transparent);}.add-btn{grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:6px;border:none;border-radius:11px;padding:11px;background:var(--ink);color:var(--paper);font-family:'Instrument Sans',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;}.add-btn:disabled{opacity:.35;cursor:not-allowed;}
@media (max-width:380px){.add-grid{grid-template-columns:1fr;}.add-grid>*{grid-column:1!important;}.metric-breakdown{grid-template-columns:1fr;}.outing-summary{align-items:flex-start;flex-direction:column;}}

`;

/* ═══════════════════════════════════════════════════════════════════
   NOTES FOR THE README

   Why kernel-weighted local offsets instead of one global number?
   Thermal tolerance isn't linear. Plenty of people handle 30°F fine and
   wilt at 85°F; a single offset can't express that. Three regime offsets
   can, and the Gaussian kernel stops them becoming three disconnected
   models — feedback at 45° trains the cold regime hard and the mild one
   softly. That's partial pooling, and it matters when data is scarce.

   Why not a regression or a neural net?
   Sample size. A real user produces maybe 30 labels a month, on a 3-way
   ordinal scale, biased toward complaints — people report discomfort far
   more than they report "fine." Anything high-variance overfits that
   immediately. Decaying-step stochastic approximation is the honest
   choice at this data volume, and it degrades gracefully.

   Known limits, stated rather than hidden:
   · One label covers a whole outing; if conditions shifted midway, the
     label is noisy. Per-outing timestamps would tighten this.
   · Attribution is self-reported, and people misattribute — someone cold
     from 90 minutes of exposure may well blame the wind.
   · "Just right" is under-reported, so the accuracy metric is probably
     conservative. Scheduled prompts rather than on-demand ones would
     reduce that skew.
   ═══════════════════════════════════════════════════════════════════ */
