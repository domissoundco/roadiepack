"use client";
import { useState, useEffect } from "react";

// ─────────────────────────────────────────────
// ITEM WEIGHTS (grams) — rough estimates, XL sizing
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
const calcCasualTops = (days, w) => Math.max(0, ceil(Math.max(0, days - TRAVEL_TOP_BONUS), casualTopWears(w)));

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
  let total = 0;
  Object.entries(list).forEach(([item, qty]) => {
    total += (ITEM_WEIGHTS[item] || 200) * qty;
  });
  return total;
}

// ─────────────────────────────────────────────
// WEATHER
// ─────────────────────────────────────────────
async function geocode(city) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
  const d = await r.json();
  if (!d.results?.length) throw new Error(`Can't find ${city}`);
  return d.results[0];
}

async function fetchForecast(lat, lon, start, end) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&start_date=${start}&end_date=${end}&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Weather API ${r.status}`);
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
// THEME
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

  // Weather fetch — always next 7 days
  useEffect(() => {
    let cancelled = false;
    async function go() {
      setWxStatus("fetching…");
      try {
        const cities = destinations.split(",").map(s => s.trim()).filter(Boolean);
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
          setDestDetails(details);
          setWxStatus("");
        } else { setWeather(null); setDestDetails(details); setWxStatus("No weather data"); }
      } catch (e) { if (!cancelled) setWxStatus(`Error: ${e.message}`); }
    }
    if (destinations.trim()) go();
    return () => { cancelled = true; };
  }, [destinations]);

  const { list, swaps, breakdown } = calculatePacking({ totalDays, workDays: mode === "holiday" ? 0 : workDays, mode, weather, overrides });

  const adjust = (item, delta) => setOverrides(o => {
    const cur = o[item] ?? list[item] ?? 0;
    return { ...o, [item]: Math.max(0, cur + delta) };
  });

  const togglePacked = (item) => setPacked(p => ({ ...p, [item]: !p[item] }));

  const enterPackMode = () => { setPackMode(true); setPacked({}); };
  const exitPackMode  = () => { setPackMode(false); setPacked({}); };

  const packedCount  = Object.values(packed).filter(Boolean).length;
  const totalItems   = Object.keys(list).length;
  const weightG      = estimateWeight(list);
  const weightKg     = (weightG / 1000).toFixed(1);

  const t = THEMES[mode];

  const inputStyle = {
    width: "100%", padding: "10px 14px", background: t.card,
    border: `1.5px solid ${t.border}`, borderRadius: 8, color: t.text,
    fontSize: 15, fontFamily: "inherit", boxSizing: "border-box", outline: "none",
    transition: "border-color 0.2s",
  };

  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text, fontFamily: "'Georgia', 'Times New Roman', serif", padding: "32px 20px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap');
        * { box-sizing: border-box; }
        .pack-item { transition: opacity 0.3s, transform 0.2s; }
        .pack-item.done { opacity: 0.32; }
        .check-circle { width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: background 0.2s, border-color 0.2s; }
        .mode-pill { padding: 8px 18px; border-radius: 20px; border: none; cursor: pointer; font-size: 13px; letter-spacing: 0.5px; font-family: inherit; transition: all 0.2s; }
        .num-btn { width: 26px; height: 26px; border-radius: 50%; border: 1.5px solid; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; line-height: 1; transition: all 0.15s; }
      `}</style>

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
              <button key={m.id} className="mode-pill"
                onClick={() => { setMode(m.id); setOverrides({}); }}
                style={{
                  background: mode === m.id ? t.accent : t.pill,
                  color: mode === m.id ? "#fff" : t.muted,
                  fontWeight: mode === m.id ? 600 : 400,
                }}
              >{m.label}</button>
            ))}
          </div>
        )}

        {/* Inputs */}
        {!packMode && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: mode !== "holiday" ? "1fr 1fr" : "1fr", gap: 12, marginBottom: 12 }}>
              <Field label="Days away" t={t}>
                <NumInput value={totalDays} onChange={v => setTotalDays(v)} min={1} max={60} style={inputStyle} />
              </Field>
              {mode !== "holiday" && (
                <Field label="Work days" t={t}>
                  <NumInput value={workDays} onChange={v => setWorkDays(v)} min={0} max={totalDays} style={inputStyle} />
                </Field>
              )}
            </div>
            <Field label="Where you're going" t={t}>
              <input type="text" value={destinations} onChange={e => setDests(e.target.value)}
                placeholder="London, Oslo, Helsinki" style={inputStyle} />
            </Field>

            {/* Trip breakdown */}
            <div style={{ marginTop: 16, padding: "10px 14px", background: t.pill, borderRadius: 8, fontSize: 13, color: t.muted, display: "flex", gap: 16 }}>
              <span>✈️ {breakdown.travelDays} travel</span>
              {breakdown.workDays > 0 && <span>💼 {breakdown.workDays} work</span>}
              {breakdown.casualDays > 0 && <span>🌅 {breakdown.casualDays} off</span>}
            </div>
          </>
        )}

        {/* Weather */}
        {!packMode && (
          <div style={{ marginTop: 24 }}>
            <Label t={t}>Weather · next 7 days</Label>
            {wxStatus && <p style={{ fontSize: 13, color: t.muted, margin: "6px 0 0", fontStyle: "italic" }}>{wxStatus}</p>}
            {destDetails.map((d, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${t.border}`, fontSize: 14 }}>
                <span style={{ color: t.text }}>{d.name}</span>
                <span style={{ color: t.muted }}>
                  {d.error ? d.error : `${wxEmoji(d)} ${Math.round(d.minTemp)}–${Math.round(d.maxTemp)}°C · ${d.rainChance}% rain`}
                </span>
              </div>
            ))}
            {swaps.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: t.muted, fontStyle: "italic", lineHeight: 1.7 }}>
                {swaps.map((s, i) => <div key={i}>↳ {s}</div>)}
              </div>
            )}
          </div>
        )}

        {/* Divider + controls */}
        <div style={{ marginTop: 28, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <Label t={t}>{packMode ? `Packing — ${packedCount} of ${totalItems} done` : "The list"}</Label>
          <button
            onClick={packMode ? exitPackMode : enterPackMode}
            style={{
              padding: "7px 18px", borderRadius: 20, border: `1.5px solid ${t.accent}`,
              background: packMode ? t.accent : "transparent",
              color: packMode ? "#fff" : t.accent,
              fontSize: 12, cursor: "pointer", fontFamily: "inherit",
              letterSpacing: "0.5px", transition: "all 0.2s",
            }}
          >
            {packMode ? "✓ Done" : "Pack mode"}
          </button>
        </div>

        {/* Pack progress bar */}
        {packMode && (
          <div style={{ height: 3, background: t.border, borderRadius: 2, marginBottom: 20, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(packedCount / totalItems) * 100}%`, background: t.accent, borderRadius: 2, transition: "width 0.3s" }} />
          </div>
        )}

        {/* Packing list */}
        <div style={{ display: "grid", gap: 2 }}>
          {Object.entries(list).map(([item, qty]) => {
            const isDone = packed[item];
            const wg = (ITEM_WEIGHTS[item] || 200) * qty;
            return (
              <div key={item} className={`pack-item${isDone ? " done" : ""}`}
                style={{ display: "flex", alignItems: "center", padding: "13px 0", borderBottom: `1px solid ${t.border}`, gap: 14 }}>

                {/* Check circle (pack mode only) */}
                {packMode && (
                  <div className="check-circle"
                    onClick={() => togglePacked(item)}
                    style={{ borderColor: isDone ? t.accent : t.border, background: isDone ? t.accent : "transparent" }}>
                    {isDone && <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>✓</span>}
                  </div>
                )}

                {/* Item name */}
                <span style={{ flex: 1, fontSize: 16, color: t.text, textDecoration: isDone ? "line-through" : "none" }}>{item}</span>

                {/* Weight hint */}
                <span style={{ fontSize: 11, color: t.muted, minWidth: 44, textAlign: "right" }}>~{wg >= 1000 ? `${(wg/1000).toFixed(1)}kg` : `${wg}g`}</span>

                {/* Qty controls (plan mode only) */}
                {!packMode && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button className="num-btn" onClick={() => adjust(item, -1)}
                      style={{ borderColor: t.border, color: t.muted }}>−</button>
                    <span style={{ minWidth: 20, textAlign: "center", fontSize: 16, fontWeight: 600, color: t.accent }}>{qty}</span>
                    <button className="num-btn" onClick={() => adjust(item, 1)}
                      style={{ borderColor: t.border, color: t.muted }}>+</button>
                  </div>
                )}

                {/* Qty (pack mode — static) */}
                {packMode && (
                  <span style={{ fontSize: 15, fontWeight: 600, color: t.accent, minWidth: 20, textAlign: "center" }}>{qty}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Weight total + reset */}
        <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, color: t.muted }}>
            Estimated bag weight
            <span style={{ fontSize: 22, fontWeight: 300, color: t.text, fontFamily: "'Cormorant Garamond', serif", display: "block", lineHeight: 1.2 }}>
              ~{weightKg} kg
            </span>
          </div>
          {!packMode && Object.keys(overrides).length > 0 && (
            <button onClick={() => setOverrides({})}
              style={{ fontSize: 12, color: t.muted, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>
              Reset to calculated
            </button>
          )}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 40, paddingTop: 20, borderTop: `1px solid ${t.border}`, fontSize: 11, color: t.muted, lineHeight: 1.8 }}>
          Work tops · 2 wears &nbsp;·&nbsp; Casual tops · 2 hot / 3 cool &nbsp;·&nbsp; Bottoms · 3 wears &nbsp;·&nbsp; Travel top reused once &nbsp;·&nbsp; Socks/UW · 1 use
        </div>

      </div>
    </div>
  );
}

function Field({ label, t, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11, letterSpacing: "1px", textTransform: "uppercase", color: t.muted, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function Label({ t, children }) {
  return <p style={{ fontSize: 11, letterSpacing: "1px", textTransform: "uppercase", color: t.muted, margin: "0 0 4px" }}>{children}</p>;
}

function NumInput({ value, onChange, min, max, style }) {
  return (
    <input type="number" value={value} min={min} max={max}
      onChange={e => onChange(parseInt(e.target.value) || 0)} style={style} />
  );
}
