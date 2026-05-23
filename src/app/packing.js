"use client";
import { useState, useEffect } from "react";

// ─────────────────────────────────────────────
// ITEM WEIGHTS (grams) — rough XL sizing
// ─────────────────────────────────────────────
const ITEM_WEIGHTS = {
  "Underwear": 40,
  "Socks": 60,
  "Rig t-shirts": 220,
  "Rig shorts": 320,
  "Rig trousers": 450,
  "Black shirt": 260,
  "Black trousers": 480,
  "Black shoes": 900,
  "Casual tops": 220,
  "Casual bottoms": 380,
  "Travel tops": 220,
  "Smart shirt": 260,
  "Trainers/casual shoes": 800,
  "Waterproof jacket": 450,
  "Swimwear": 180,
  "Warm layer / hoodie": 600,
  "Toiletries kit": 800,
};

// ─────────────────────────────────────────────
// PACKING LOGIC
// ─────────────────────────────────────────────
const TOP_WEARS = 2;
const BOTTOM_WEARS = 3;
const CASUAL_TOP_HOT = 2;
const CASUAL_TOP_COOL = 3;
const TRAVEL_TOP_BONUS = 1;

const ceil = (n, d) => Math.ceil(n / d);
const casualTopWears = (w) => (w && w.maxTemp >= 22 ? CASUAL_TOP_HOT : CASUAL_TOP_COOL);
const calcCasualTops = (days, w) =>
  Math.max(0, ceil(Math.max(0, days - TRAVEL_TOP_BONUS), casualTopWears(w)));

function calculatePacking({ totalDays, workDays, mode, weather, overrides }) {
  const travelDays = totalDays >= 2 ? 2 : 1;
  const casualDays = Math.max(0, totalDays - workDays - travelDays);
  const list = {};

  list["Underwear"] = totalDays;
  list["Socks"] = totalDays;

  if (mode === "corporate") {
    list["Rig t-shirts"] = ceil(workDays, TOP_WEARS);
    list["Rig shorts"] = ceil(workDays, BOTTOM_WEARS);
    list["Black shirt"] = 1;
    list["Black trousers"] = 1;
    list["Black shoes"] = 1;
    const eveningDays = workDays + casualDays;
    list["Casual tops"] = calcCasualTops(eveningDays, weather);
    list["Casual bottoms"] = ceil(eveningDays + travelDays, BOTTOM_WEARS);
    list["Travel tops"] = 2;
    list["Trainers/casual shoes"] = 1;
  }

  if (mode === "rockroll") {
    list["Rig t-shirts"] = ceil(workDays, TOP_WEARS);
    list["Rig shorts"] = ceil(workDays, BOTTOM_WEARS);
    list["Casual tops"] = calcCasualTops(casualDays, weather);
    list["Casual bottoms"] = Math.max(1, ceil(casualDays + travelDays, BOTTOM_WEARS));
    list["Travel tops"] = 2;
    list["Trainers/casual shoes"] = 1;
  }

  if (mode === "holiday") {
    const nonTravelDays = Math.max(0, totalDays - travelDays);
    list["Casual tops"] = calcCasualTops(nonTravelDays, weather);
    list["Casual bottoms"] = ceil(totalDays, BOTTOM_WEARS);
    list["Travel tops"] = 2;
    list["Trainers/casual shoes"] = 1;
    if (totalDays >= 3) list["Smart shirt"] = 1;
  }

  const swaps = [];
  if (weather) {
    const { maxTemp, minTemp, rainChance } = weather;
    if (rainChance >= 40) { list["Waterproof jacket"] = 1; swaps.push(`Rain likely (${rainChance}%) — waterproof added`); }
    if (maxTemp >= 25) { list["Swimwear"] = 1; swaps.push(`Hot (${maxTemp}°C) — swimwear added`); }
    if (minTemp <= 12) { list["Warm layer / hoodie"] = 1; swaps.push(`Cool evenings (${minTemp}°C) — warm layer added`); }
    if (maxTemp <= 15 && mode !== "corporate" && list["Rig shorts"]) {
      list["Rig trousers"] = list["Rig shorts"];
      delete list["Rig shorts"];
      swaps.push("Cold — rig shorts swapped for trousers");
    }
  }

  list["Toiletries kit"] = 1;

  Object.keys(overrides || {}).forEach((k) => {
    if (overrides[k] === 0) delete list[k];
    else list[k] = overrides[k];
  });

  return { list, swaps, breakdown: { totalDays, workDays, casualDays, travelDays } };
}

function estimateWeight(list) {
  return Object.entries(list).reduce((sum, [item, qty]) => sum + (ITEM_WEIGHTS[item] || 200) * qty, 0);
}

// ─────────────────────────────────────────────
// WEATHER
// ─────────────────────────────────────────────
async function geocode(city) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
  const d = await r.json();
  if (!d.results?.length) throw new Error(`Can't find "${city}"`);
  return d.results[0];
}

async function fetchForecast(lat, lon, start, end) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&start_date=${start}&end_date=${end}&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Weather ${r.status}`);
  return (await r.json()).daily;
}

function summarise(daily) {
  if (!daily?.temperature_2m_max) return null;
  return {
    maxTemp: Math.max(...daily.temperature_2m_max),
    minTemp: Math.min(...daily.temperature_2m_min),
    rainChance: Math.max(...(daily.precipitation_probability_max || [0])),
  };
}

function wxEmoji({ maxTemp, minTemp, rainChance }) {
  if (rainChance >= 60) return "🌧️";
  if (rainChance >= 40) return "🌦️";
  if (maxTemp >= 28) return "☀️";
  if (maxTemp >= 22) return "🌤️";
  if (maxTemp >= 15) return "⛅";
  if (minTemp <= 5) return "🥶";
  return "☁️";
}

function todayPlus(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────
// THEMES
// ─────────────────────────────────────────────
const THEMES = {
  corporate: { bg: "#F7F5F2", card: "#FFFFFF", text: "#1a1a1a", muted: "#8a8680", accent: "#2D5016", border: "#E0DDD8", pill: "#EAE7E2" },
  rockroll:  { bg: "#F5F4F0", card: "#FFFFFF", text: "#1a1a1a", muted: "#8a8680", accent: "#8B1A1A", border: "#E0DDD8", pill: "#EAE7E2" },
  holiday:   { bg: "#F2F6F5", card: "#FFFFFF", text: "#1a1a1a", muted: "#8a8680", accent: "#1A5C5C", border: "#D8E5E4", pill: "#E2EDEC" },
};

// ─────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────
export default function PackingApp() {
  const [totalDays, setTotalDays] = useState(5);
  const [workDays, setWorkDays]   = useState(3);
  const [mode, setMode]           = useState("corporate");
  const [destinations, setDests]  = useState("London");
  const [weather, setWeather]     = useState(null);
  const [wxStatus, setWxStatus]   = useState("");
  const [destDetails, setDestDetails] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [packMode, setPackMode]   = useState(false);
  const [packed, setPacked]       = useState({});

  useEffect(() => {
    let cancelled = false;
    async function go() {
      setWxStatus("Fetching…");
      setDestDetails([]);
      setWeather(null);
      try {
        const cities = destinations.split(",").map(s => s.trim()).filter(Boolean);
        if (!cities.length) { setWxStatus(""); return; }
        const start = todayPlus(0), end = todayPlus(6);
        const all = [], details = [];
        for (const city of cities) {
          try {
            const g = await geocode(city);
            const daily = await fetchForecast(g.latitude, g.longitude, start, end);
            const s = summarise(daily);
            if (s) { all.push(s); details.push({ name: `${g.name}, ${g.country_code}`, ...s }); }
          } catch (e) { details.push({ name: city, error: e.message }); }
        }
        if (cancelled) return;
        if (all.length) {
          setWeather({ maxTemp: Math.max(...all.map(a => a.maxTemp)), minTemp: Math.min(...all.map(a => a.minTemp)), rainChance: Math.max(...all.map(a => a.rainChance)) });
        }
        setDestDetails(details);
        setWxStatus("");
      } catch (e) {
        if (!cancelled) setWxStatus(`Error: ${e.message}`);
      }
    }
    const timer = setTimeout(go, 600); // debounce typing
    return () => { cancelled = true; clearTimeout(timer); };
  }, [destinations]);

  const { list, swaps, breakdown } = calculatePacking({
    totalDays,
    workDays: mode === "holiday" ? 0 : workDays,
    mode, weather, overrides,
  });

  const adjust = (item, delta) => setOverrides(o => {
    const cur = o[item] ?? list[item] ?? 0;
    return { ...o, [item]: Math.max(0, cur + delta) };
  });

  const togglePacked = (item) => setPacked(p => ({ ...p, [item]: !p[item] }));
  const enterPackMode = () => { setPackMode(true); setPacked({}); };
  const exitPackMode  = () => { setPackMode(false); setPacked({}); };

  const totalItems  = Object.keys(list).length;
  const packedCount = Object.values(packed).filter(Boolean).length;
  const weightKg    = (estimateWeight(list) / 1000).toFixed(1);
  const t = THEMES[mode];

  const inputSty = {
    width: "100%", padding: "10px 14px", background: t.card,
    border: `1.5px solid ${t.border}`, borderRadius: 8, color: t.text,
    fontSize: 15, fontFamily: "Georgia, serif", boxSizing: "border-box", outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text, fontFamily: "Georgia, 'Times New Roman', serif", padding: "32px 20px" }}>
      <div style={{ maxWidth: 580, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 52, fontWeight: 300, letterSpacing: "-1px", margin: 0, color: t.text }}>
            Tally
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: t.muted, letterSpacing: "0.5px", fontStyle: "italic" }}>
            Less in the bag. More on the road.
          </p>
        </div>

        {/* Mode pills */}
        {!packMode && (
          <div style={{ display: "flex", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
            {[{ id: "corporate", label: "Corporate" }, { id: "rockroll", label: "Rock & Roll" }, { id: "holiday", label: "Holiday" }].map(m => (
              <button key={m.id}
                onClick={() => { setMode(m.id); setOverrides({}); }}
                style={{
                  padding: "8px 18px", borderRadius: 20, border: "none", cursor: "pointer",
                  fontSize: 13, letterSpacing: "0.5px", fontFamily: "Georgia, serif",
                  background: mode === m.id ? t.accent : t.pill,
                  color: mode === m.id ? "#fff" : t.muted,
                  fontWeight: mode === m.id ? 600 : 400,
                  transition: "all 0.2s",
                }}
              >{m.label}</button>
            ))}
          </div>
        )}

        {/* Inputs */}
        {!packMode && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: mode !== "holiday" ? "1fr 1fr" : "1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, letterSpacing: "1px", textTransform: "uppercase", color: t.muted, marginBottom: 6 }}>Days away</label>
                <input type="number" value={totalDays} min={1} max={60}
                  onChange={e => setTotalDays(parseInt(e.target.value) || 1)} style={inputSty} />
              </div>
              {mode !== "holiday" && (
                <div>
                  <label style={{ display: "block", fontSize: 11, letterSpacing: "1px", textTransform: "uppercase", color: t.muted, marginBottom: 6 }}>Work days</label>
                  <input type="number" value={workDays} min={0} max={totalDays}
                    onChange={e => setWorkDays(parseInt(e.target.value) || 0)} style={inputSty} />
                </div>
              )}
            </div>

            <div style={{ marginBottom: 0 }}>
              <label style={{ display: "block", fontSize: 11, letterSpacing: "1px", textTransform: "uppercase", color: t.muted, marginBottom: 6 }}>Where you're going</label>
              <input type="text" value={destinations} placeholder="London, Oslo, Helsinki"
                onChange={e => setDests(e.target.value)} style={inputSty} />
            </div>

            {/* Trip breakdown */}
            <div style={{ marginTop: 14, padding: "10px 14px", background: t.pill, borderRadius: 8, fontSize: 13, color: t.muted, display: "flex", gap: 16 }}>
              <span>✈️ {breakdown.travelDays} travel</span>
              {breakdown.workDays > 0 && <span>💼 {breakdown.workDays} work</span>}
              {breakdown.casualDays > 0 && <span>🌅 {breakdown.casualDays} off</span>}
            </div>

            {/* Weather */}
            <div style={{ marginTop: 24 }}>
              <p style={{ fontSize: 11, letterSpacing: "1px", textTransform: "uppercase", color: t.muted, margin: "0 0 8px" }}>Weather · next 7 days</p>
              {wxStatus && <p style={{ fontSize: 13, color: t.muted, margin: "0 0 6px", fontStyle: "italic" }}>{wxStatus}</p>}
              {destDetails.map((d, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${t.border}`, fontSize: 14 }}>
                  <span>{d.name}</span>
                  <span style={{ color: t.muted }}>
                    {d.error ? `⚠️ ${d.error}` : `${wxEmoji(d)} ${Math.round(d.minTemp)}–${Math.round(d.maxTemp)}°C · ${d.rainChance}% rain`}
                  </span>
                </div>
              ))}
              {swaps.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 12, color: t.muted, fontStyle: "italic", lineHeight: 1.8 }}>
                  {swaps.map((s, i) => <div key={i}>↳ {s}</div>)}
                </div>
              )}
            </div>
          </>
        )}

        {/* List header + pack mode toggle */}
        <div style={{ marginTop: 28, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <p style={{ fontSize: 11, letterSpacing: "1px", textTransform: "uppercase", color: t.muted, margin: 0 }}>
            {packMode ? `Packing — ${packedCount} of ${totalItems}` : "The list"}
          </p>
          <button
            onClick={packMode ? exitPackMode : enterPackMode}
            style={{
              padding: "7px 18px", borderRadius: 20,
              border: `1.5px solid ${t.accent}`,
              background: packMode ? t.accent : "transparent",
              color: packMode ? "#fff" : t.accent,
              fontSize: 12, cursor: "pointer", fontFamily: "Georgia, serif",
              letterSpacing: "0.5px",
            }}
          >
            {packMode ? "✓  Done" : "Pack mode"}
          </button>
        </div>

        {/* Progress bar */}
        {packMode && (
          <div style={{ height: 3, background: t.border, borderRadius: 2, marginBottom: 18, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(packedCount / totalItems) * 100}%`, background: t.accent, borderRadius: 2, transition: "width 0.3s" }} />
          </div>
        )}

        {/* Items */}
        <div>
          {Object.entries(list).map(([item, qty]) => {
            const isDone = !!packed[item];
            const wg = (ITEM_WEIGHTS[item] || 200) * qty;
            const wLabel = wg >= 1000 ? `~${(wg / 1000).toFixed(1)}kg` : `~${wg}g`;
            return (
              <div key={item}
                style={{
                  display: "flex", alignItems: "center", padding: "13px 0",
                  borderBottom: `1px solid ${t.border}`, gap: 12,
                  opacity: isDone ? 0.3 : 1, transition: "opacity 0.25s",
                }}
              >
                {/* Check circle — pack mode */}
                {packMode && (
                  <div
                    onClick={() => togglePacked(item)}
                    style={{
                      width: 24, height: 24, borderRadius: "50%",
                      border: `1.5px solid ${isDone ? t.accent : t.border}`,
                      background: isDone ? t.accent : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", flexShrink: 0, transition: "all 0.2s",
                      userSelect: "none",
                    }}
                  >
                    {isDone && <span style={{ color: "#fff", fontSize: 13, lineHeight: 1, fontWeight: 700 }}>✓</span>}
                  </div>
                )}

                {/* Name */}
                <span style={{
                  flex: 1, fontSize: 16, color: t.text,
                  textDecoration: isDone ? "line-through" : "none",
                }}>{item}</span>

                {/* Weight */}
                <span style={{ fontSize: 11, color: t.muted, minWidth: 46, textAlign: "right" }}>{wLabel}</span>

                {/* Qty controls — plan mode */}
                {!packMode && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => adjust(item, -1)} style={{
                      width: 26, height: 26, borderRadius: "50%",
                      border: `1.5px solid ${t.border}`, background: "transparent",
                      cursor: "pointer", fontSize: 15, color: t.muted,
                      display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                    }}>−</button>
                    <span style={{ minWidth: 20, textAlign: "center", fontSize: 16, fontWeight: 600, color: t.accent }}>{qty}</span>
                    <button onClick={() => adjust(item, 1)} style={{
                      width: 26, height: 26, borderRadius: "50%",
                      border: `1.5px solid ${t.border}`, background: "transparent",
                      cursor: "pointer", fontSize: 15, color: t.muted,
                      display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                    }}>+</button>
                  </div>
                )}

                {/* Qty static — pack mode */}
                {packMode && (
                  <span style={{ fontSize: 15, fontWeight: 600, color: t.accent, minWidth: 20, textAlign: "center" }}>{qty}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Weight + reset */}
        <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <p style={{ fontSize: 12, color: t.muted, margin: "0 0 2px", letterSpacing: "0.5px" }}>Estimated bag weight</p>
            <span style={{ fontSize: 28, fontWeight: 300, color: t.text, fontFamily: "'Cormorant Garamond', Georgia, serif", lineHeight: 1 }}>
              ~{weightKg} kg
            </span>
          </div>
          {!packMode && Object.keys(overrides).length > 0 && (
            <button onClick={() => setOverrides({})} style={{
              fontSize: 12, color: t.muted, background: "none", border: "none",
              cursor: "pointer", textDecoration: "underline", fontFamily: "Georgia, serif",
            }}>Reset</button>
          )}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 40, paddingTop: 20, borderTop: `1px solid ${t.border}`, fontSize: 11, color: t.muted, lineHeight: 1.9 }}>
          Work tops · 2 wears &nbsp;·&nbsp; Casual tops · 2 hot / 3 cool &nbsp;·&nbsp; Bottoms · 3 wears &nbsp;·&nbsp; Travel top reused once &nbsp;·&nbsp; Socks/UW · 1 use
        </div>
      </div>
    </div>
  );
}
