"use client";
import { useState, useEffect } from "react";

// ─────────────────────────────────────────────
// WEATHER
// ─────────────────────────────────────────────
async function geocode(city) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
  const d = await r.json();
  if (!d.results?.length) throw new Error(`Can't find "${city}"`);
  return d.results[0];
}

async function fetchForecast(lat, lon) {
  const fmt = (d) => d.toISOString().slice(0, 10);
  const now = new Date();
  const end = new Date(); end.setDate(end.getDate() + 6);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&start_date=${fmt(now)}&end_date=${fmt(end)}&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Weather ${r.status}`);
  return (await r.json()).daily;
}

function summarise(daily) {
  if (!daily?.temperature_2m_max) return null;
  const maxTemp    = Math.round(Math.max(...daily.temperature_2m_max));
  const minTemp    = Math.round(Math.min(...daily.temperature_2m_min));
  const avgTemp    = Math.round((daily.temperature_2m_max.reduce((a,b)=>a+b,0)/daily.temperature_2m_max.length + daily.temperature_2m_min.reduce((a,b)=>a+b,0)/daily.temperature_2m_min.length) / 2);
  const rainChance = Math.max(...(daily.precipitation_probability_max || [0]));
  return { maxTemp, minTemp, avgTemp, rainChance };
}

function wxEmoji({ maxTemp, rainChance }) {
  if (rainChance >= 60) return "🌧️";
  if (rainChance >= 40) return "🌦️";
  if (maxTemp >= 28)    return "☀️";
  if (maxTemp >= 22)    return "🌤️";
  if (maxTemp >= 15)    return "⛅";
  if (maxTemp >= 7)     return "🧥";
  return "🥶";
}

// ─────────────────────────────────────────────
// ADVISORY ENGINE
// ─────────────────────────────────────────────
function getWeatherBand(weather) {
  if (!weather) return "unknown";
  const { maxTemp, rainChance } = weather;
  const rain = rainChance >= 40;
  if (maxTemp >= 25) return rain ? "hot_wet"  : "hot";
  if (maxTemp >= 18) return rain ? "warm_wet" : "warm";
  if (maxTemp >= 12) return rain ? "mild_wet" : "mild";
  if (maxTemp >= 7)  return rain ? "cool_wet" : "cool";
  return rain ? "cold_wet" : "cold";
}

const WEIGHTS = {
  "Casual shirts": 220, "Casual bottoms": 360,
  "Work t-shirts (rig)": 220, "Rig shorts": 300, "Rig trousers": 440,
  "Black shirt": 260, "Black trousers": 480, "Black shoes": 880,
  "Trainers": 750, "Waterproof jacket": 420, "Warm mid-layer": 580,
  "Heavy coat": 1200, "Base layer top": 180, "Swimwear": 160,
  "Underwear": 40, "Socks": 55, "Toiletries": 750,
};

const wFmt = (g) => g >= 1000 ? `${(g/1000).toFixed(1)}kg` : `${g}g`;

function buildAdvisory({ totalDays, workDays, mode, band }) {
  const travelDays = totalDays >= 2 ? 2 : 1;
  const casualDays = Math.max(0, totalDays - workDays - travelDays);
  const isRain = band.includes("wet");
  const isHot  = band.startsWith("hot");
  const isWarm = band.startsWith("warm");
  const isMild = band.startsWith("mild");
  const isCool = band.startsWith("cool");
  const isCold = band.startsWith("cold");

  const wearDays = (days, wears) => Math.max(1, Math.ceil(days / wears));
  const cards = [];

  cards.push({
    category: "Underwear & socks", qty: totalDays, emoji: "🩲",
    reason: "One use each — no exceptions.",
    weight: (WEIGHTS["Underwear"] + WEIGHTS["Socks"]) * totalDays,
  });

  if (mode !== "holiday" && workDays > 0) {
    const rigTops    = wearDays(workDays, 2);
    const rigBottoms = (isHot || isWarm) ? wearDays(workDays, 3) : wearDays(workDays, 2);
    const btmLabel   = (isCool || isCold) ? "Rig trousers" : "Rig shorts";
    cards.push({
      category: "Work t-shirts (rig)", qty: rigTops, emoji: "👕",
      reason: `${workDays} work day${workDays > 1 ? "s" : ""}, 2 wears per top. ${isHot ? "It's hot — a rig tee works all day." : "Workhorses. Wear them hard."}`,
      weight: WEIGHTS["Work t-shirts (rig)"] * rigTops,
    });
    cards.push({
      category: btmLabel, qty: rigBottoms, emoji: (isCool || isCold) ? "👖" : "🩳",
      reason: (isCool || isCold)
        ? `Cold — trousers over shorts. ${rigBottoms > 1 ? "2 wears each" : "1 pair will do"}.`
        : `3 wears per pair. ${isHot ? "Light and practical in the heat." : ""}`,
      weight: WEIGHTS[btmLabel] * rigBottoms,
    });
  }

  if (mode === "corporate" && workDays > 0) {
    const qty = workDays > 4 ? 2 : 1;
    cards.push({
      category: "Show blacks", qty, emoji: "🖤",
      reason: qty === 1
        ? "One set. Black shirt, black trousers, black shoes. Two wears across the trip — no one will know."
        : "Two sets for a longer run. Still get 2 wears from each.",
      weight: (WEIGHTS["Black shirt"] + WEIGHTS["Black trousers"] + WEIGHTS["Black shoes"]) * qty,
      items: qty === 1
        ? ["Black shirt ×1", "Black trousers ×1", "Black shoes ×1"]
        : ["Black shirt ×2", "Black trousers ×2", "Black shoes ×1"],
    });
  }

  const casualWearDays   = mode === "holiday" ? totalDays : workDays + casualDays;
  const wearsPerCasual   = isHot ? 2 : 3;
  const travelCredit     = 1;
  const casualQty        = Math.min(6, Math.max(1, wearDays(Math.max(0, casualWearDays - travelCredit), wearsPerCasual)));

  const casualReason = isHot
    ? `Hot — ${wearsPerCasual} wears per shirt. Travel top covers arrival. ${casualQty} is right. 6 is the ceiling.`
    : isWarm ? `Warm, ${wearsPerCasual} wears each. Travel top covers one slot. ${casualQty} shirt${casualQty > 1 ? "s" : ""} is plenty.`
    : isMild ? `Mild — 3 days per shirt without raising eyebrows. Travel top doubles up. ${casualQty} shirt${casualQty > 1 ? "s" : ""}.`
    : isCool ? `Cool means layers — shirts go under a mid-layer. ${casualQty} shirt${casualQty > 1 ? "s" : ""}, 3 wears each.`
    : isCold ? `Cold — shirts are base layers under coats. ${casualQty} shirt${casualQty > 1 ? "s" : ""}. Same one twice is fine.`
    : `${casualQty} casual shirt${casualQty > 1 ? "s" : ""}. Travel top earns one slot. 6 max.`;

  cards.push({
    category: "Casual shirts", qty: casualQty, emoji: "👔",
    reason: casualReason,
    weight: WEIGHTS["Casual shirts"] * casualQty,
  });

  cards.push({
    category: "Travel tops", qty: 2, emoji: "✈️",
    reason: "Worn on travel days. Outbound top reused once on arrival — that's the credit that saves you a shirt.",
    weight: WEIGHTS["Casual shirts"] * 2,
  });

  const casualBottomDays = mode === "holiday" ? totalDays : casualDays + travelDays;
  const casualBottomQty  = Math.max(1, wearDays(casualBottomDays, 3));
  const casualBottomLbl  = isHot ? "Casual shorts" : (isCool || isCold) ? "Casual trousers" : "Casual bottoms";

  cards.push({
    category: casualBottomLbl, qty: casualBottomQty, emoji: isHot ? "🩳" : "👖",
    reason: isHot
      ? `Shorts. 3 wears per pair. ${casualBottomQty} pair${casualBottomQty > 1 ? "s" : ""} covers it.`
      : (isCool || isCold) ? `Trousers for off-hours. ${casualBottomQty} pair${casualBottomQty > 1 ? "s" : ""}, 3 wears each.`
      : `${casualBottomQty} pair${casualBottomQty > 1 ? "s" : ""} for evenings, travel, days off. 3 wears per pair.`,
    weight: WEIGHTS["Casual bottoms"] * casualBottomQty,
  });

  cards.push({
    category: "Trainers", qty: 1, emoji: "👟",
    reason: (isCold || isCool)
      ? "One pair. Wear your heaviest on the plane — saves bag space."
      : "One pair, full stop. Clean trainers carry evenings and travel.",
    weight: WEIGHTS["Trainers"],
  });

  if (isRain) {
    cards.push({
      category: "Packable waterproof", qty: 1, emoji: "🌧️",
      reason: isHot
        ? "Rain in the heat — packable shell weighs nothing and saves a soaking."
        : (isMild || isWarm) ? "Rain expected — waterproof replaces the hoodie. One layer, two jobs."
        : "Wet and cold is the worst combination. Waterproof shell, warm layer underneath.",
      weight: WEIGHTS["Waterproof jacket"],
    });
  }

  if (isCool || isCold || (isMild && !isRain)) {
    const layerLbl = isCold ? "Heavy coat" : "Warm mid-layer";
    cards.push({
      category: layerLbl, qty: 1, emoji: isCold ? "🧥" : "🫙",
      reason: isCold
        ? "Wear the coat on the plane — heaviest item, zero bag cost if it's on your back."
        : isCool ? "Fleece or light jacket. Goes over any shirt, keeps evenings civilised."
        : "Light layer for evenings. One is enough.",
      weight: WEIGHTS[layerLbl],
    });
    if (isCool || isCold) {
      cards.push({
        category: "Jumper / knitwear", qty: 1, emoji: "🧶",
        reason: isCold
          ? "Merino or fine knit under the coat, over a shirt. Looks sharp for an evening. Merino handles 3+ wears."
          : "Smart knit for the evening. Over a casual shirt it reads well. 2–3 wears comfortably.",
        weight: 480,
      });
    }
  }

  if (isCold) {
    cards.push({
      category: "Base layer top", qty: 1, emoji: "🧤",
      reason: "Thin merino thermal. Under everything. One is enough — merino handles 3+ wears without issue.",
      weight: WEIGHTS["Base layer top"],
    });
  }

  if (isHot) {
    cards.push({
      category: "Swimwear", qty: 1, emoji: "🩱",
      reason: "It's hot. Pool, beach, rooftop — you'll want it. Weighs nothing.",
      weight: WEIGHTS["Swimwear"],
    });
  }

  cards.push({
    category: "Toiletries", qty: 1, emoji: "🪥",
    reason: "One pre-packed bag. Refillable 100ml bottles, solid deodorant. Never repack from scratch.",
    weight: WEIGHTS["Toiletries"],
  });

  return { cards };
}

// ─────────────────────────────────────────────
// THEMES — elevated, editorial
// ─────────────────────────────────────────────
const THEMES = {
  corporate: {
    bg: "#F5F3EF", text: "#18181B", muted: "#71717A", accent: "#1A3A1A",
    border: "#E4E2DE", chip: "#ECEAE6", card: "#FAFAF9",
    accentLight: "#EEF3EE",
  },
  rockroll: {
    bg: "#F4F3F1", text: "#18181B", muted: "#71717A", accent: "#6B1A1A",
    border: "#E4E2DE", chip: "#ECEAE6", card: "#FAFAF9",
    accentLight: "#F5EAEA",
  },
  holiday: {
    bg: "#F1F5F4", text: "#18181B", muted: "#71717A", accent: "#0F4343",
    border: "#D8E4E3", chip: "#E2EDEC", card: "#F8FBFB",
    accentLight: "#E6F0F0",
  },
};

const MODES = [
  { id: "corporate", label: "Corporate" },
  { id: "rockroll",  label: "Rock & Roll" },
  { id: "holiday",   label: "Holiday" },
];

// ─────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────
export default function PackingApp() {
  const [totalDays, setTotalDays]   = useState(5);
  const [workDays, setWorkDays]     = useState(3);
  const [mode, setMode]             = useState("corporate");
  const [destination, setDest]      = useState("London");
  const [weather, setWeather]       = useState(null);
  const [wxStatus, setWxStatus]     = useState("");
  const [cityRows, setCityRows]     = useState([]);
  const [packMode, setPackMode]     = useState(false);
  const [checked, setChecked]       = useState({});
  const [overrides, setOverrides]   = useState({});

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!destination.trim()) return;
      setWxStatus("Looking up weather…");
      setWeather(null);
      setCityRows([]);
      try {
        const cities = destination.split(",").map(s => s.trim()).filter(Boolean);
        const rows = [];
        const results = [];
        for (const city of cities) {
          try {
            const g = await geocode(city);
            const daily = await fetchForecast(g.latitude, g.longitude);
            const s = summarise(daily);
            if (s) {
              results.push(s);
              rows.push({ name: `${g.name}, ${g.country_code}`, ...s });
            } else {
              rows.push({ name: city, error: "No data" });
            }
          } catch (e) {
            rows.push({ name: city, error: "Not found" });
          }
        }
        if (cancelled) return;
        if (results.length) {
          setWeather({
            maxTemp:    Math.max(...results.map(r => r.maxTemp)),
            minTemp:    Math.min(...results.map(r => r.minTemp)),
            avgTemp:    Math.round(results.reduce((s,r) => s + r.avgTemp, 0) / results.length),
            rainChance: Math.max(...results.map(r => r.rainChance)),
          });
        }
        setCityRows(rows);
        setWxStatus("");
      } catch (e) {
        if (!cancelled) setWxStatus(e.message);
      }
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [destination]);

  const band = getWeatherBand(weather);
  const { cards } = buildAdvisory({ totalDays, workDays: mode === "holiday" ? 0 : workDays, mode, band });

  const displayCards = cards.map(c => ({
    ...c,
    qty:    overrides[c.category] ?? c.qty,
    weight: (WEIGHTS[c.category] || 200) * (overrides[c.category] ?? c.qty),
  }));

  const totalKg      = (displayCards.reduce((s,c) => s + c.weight, 0) / 1000).toFixed(1);
  const checkedCount = Object.values(checked).filter(Boolean).length;
  const t = THEMES[mode];

  const adjQty = (cat, delta) => setOverrides(o => ({
    ...o,
    [cat]: Math.max(0, (o[cat] ?? (cards.find(c => c.category === cat)?.qty || 1)) + delta),
  }));

  const inp = {
    width: "100%", padding: "11px 16px", fontFamily: "inherit",
    background: t.card, border: `1px solid ${t.border}`,
    borderRadius: 8, color: t.text, fontSize: 15,
    boxSizing: "border-box", outline: "none", letterSpacing: "0.1px",
  };

  const bagNote = parseFloat(totalKg) < 6   ? "Backpack — travelling light"
    : parseFloat(totalKg) < 10  ? "Tumi carry-on — no problem"
    : parseFloat(totalKg) < 14  ? "Carry-on at the limit"
    : "This wants a checked bag";

  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text, fontFamily: "'Cormorant Garamond', Georgia, 'Times New Roman', serif" }}>

      {/* Top bar */}
      <div style={{ borderBottom: `1px solid ${t.border}`, padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, background: t.card }}>
        <span style={{ fontSize: 18, fontWeight: 400, letterSpacing: "0.5px" }}>Roadie Pack</span>
        <span style={{ fontSize: 12, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase", fontFamily: "system-ui, sans-serif" }}>
          {packMode ? `${checkedCount} / ${displayCards.length}` : ""}
        </span>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px 80px" }}>

        {/* Hero heading */}
        <div style={{ marginBottom: 48 }}>
          <h1 style={{ fontSize: 72, fontWeight: 300, margin: 0, lineHeight: 0.9, letterSpacing: "-2px", color: t.text }}>
            What to<br />
            <span style={{ color: t.accent }}>pack.</span>
          </h1>
          <p style={{ margin: "16px 0 0", fontSize: 15, color: t.muted, fontStyle: "italic", letterSpacing: "0.2px" }}>
            Packing to do some roadie'ing.
          </p>
        </div>

        {/* Mode selector — elegant tab row */}
        {!packMode && (
          <div style={{ display: "flex", borderBottom: `1px solid ${t.border}`, marginBottom: 40 }}>
            {MODES.map(m => (
              <button key={m.id}
                onClick={() => { setMode(m.id); setOverrides({}); setChecked({}); }}
                style={{
                  padding: "12px 24px 11px", background: "none", border: "none", cursor: "pointer",
                  fontFamily: "inherit", fontSize: 15, letterSpacing: "0.2px",
                  color: mode === m.id ? t.text : t.muted,
                  fontWeight: mode === m.id ? 600 : 400,
                  borderBottom: mode === m.id ? `2px solid ${t.accent}` : "2px solid transparent",
                  marginBottom: -1, transition: "all 0.15s",
                }}
              >{m.label}</button>
            ))}
          </div>
        )}

        {/* Inputs */}
        {!packMode && (
          <div style={{ marginBottom: 40 }}>
            <div style={{ display: "grid", gridTemplateColumns: mode !== "holiday" ? "1fr 1fr" : "1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>Days away</label>
                <input type="number" value={totalDays} min={1} max={60} style={inp}
                  onChange={e => { setTotalDays(parseInt(e.target.value)||1); setOverrides({}); }} />
              </div>
              {mode !== "holiday" && (
                <div>
                  <label style={{ display: "block", fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>Work days</label>
                  <input type="number" value={workDays} min={0} max={totalDays} style={inp}
                    onChange={e => { setWorkDays(parseInt(e.target.value)||0); setOverrides({}); }} />
                </div>
              )}
            </div>
            <div>
              <label style={{ display: "block", fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>Destinations</label>
              <input type="text" value={destination} placeholder="London, Barcelona, Paris" style={inp}
                onChange={e => setDest(e.target.value)} />
            </div>
          </div>
        )}

        {/* Weather — per-city rows */}
        {!packMode && (
          <div style={{ marginBottom: 44 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase" }}>
                Weather · 7-day outlook
              </span>
              {wxStatus && (
                <span style={{ fontSize: 12, color: t.muted, fontStyle: "italic", fontFamily: "inherit" }}>{wxStatus}</span>
              )}
            </div>

            {cityRows.length > 0 && (
              <div style={{ borderTop: `1px solid ${t.border}` }}>
                {cityRows.map((row, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "14px 0", borderBottom: `1px solid ${t.border}`,
                  }}>
                    <span style={{ fontSize: 16, color: t.text, fontWeight: 400 }}>{row.name}</span>
                    <span style={{ fontSize: 14, color: t.muted, fontFamily: "system-ui, sans-serif" }}>
                      {row.error
                        ? `⚠️ ${row.error}`
                        : `${wxEmoji(row)}  ${row.minTemp}–${row.maxTemp}°C · ${row.rainChance}% rain`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Worst-case summary pill */}
            {weather && (
              <div style={{
                marginTop: 12, display: "inline-flex", alignItems: "center", gap: 8,
                padding: "7px 14px", background: t.accentLight, borderRadius: 6,
                fontSize: 12, color: t.accent, fontFamily: "system-ui, sans-serif",
                letterSpacing: "0.3px",
              }}>
                <span style={{ fontSize: 14 }}>{wxEmoji(weather)}</span>
                <span>Packing for worst-case across all stops · {weather.minTemp}–{weather.maxTemp}°C · {weather.rainChance}% rain</span>
              </div>
            )}
          </div>
        )}

        {/* Section header + pack toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase" }}>
            {packMode ? `Packing — ${checkedCount} of ${displayCards.length}` : "What I'd pack"}
          </span>
          <button
            onClick={() => { setPackMode(!packMode); setChecked({}); }}
            style={{
              padding: "8px 22px", borderRadius: 6, cursor: "pointer",
              fontFamily: "system-ui, sans-serif", fontSize: 11, letterSpacing: "1px", textTransform: "uppercase",
              border: `1px solid ${t.accent}`,
              background: packMode ? t.accent : "transparent",
              color: packMode ? "#fff" : t.accent,
              transition: "all 0.15s",
            }}
          >{packMode ? "Done" : "Pack mode"}</button>
        </div>

        {/* Progress bar */}
        {packMode && (
          <div style={{ height: 1, background: t.border, marginBottom: 24, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(checkedCount / displayCards.length) * 100}%`, background: t.accent, transition: "width 0.3s" }} />
          </div>
        )}

        {/* Cards */}
        <div style={{ display: "grid", gap: 1, borderTop: `1px solid ${t.border}` }}>
          {displayCards.map((card) => {
            const isDone = !!checked[card.category];
            const isOverrideWarnLow  = card.category === "Casual shirts" && card.qty < 3;
            const isOverrideWarnHigh = card.category === "Casual shirts" && card.qty > 6;

            return (
              <div key={card.category}
                style={{
                  borderBottom: `1px solid ${t.border}`,
                  padding: "20px 0",
                  opacity: isDone ? 0.28 : 1,
                  transition: "opacity 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>

                  {/* Check circle */}
                  {packMode && (
                    <div onClick={() => setChecked(p => ({...p, [card.category]: !p[card.category]}))}
                      style={{
                        width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 2,
                        border: `1.5px solid ${isDone ? t.accent : t.border}`,
                        background: isDone ? t.accent : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer", transition: "all 0.15s", userSelect: "none",
                      }}>
                      {isDone && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                    </div>
                  )}

                  {/* Emoji */}
                  <span style={{ fontSize: 20, lineHeight: "26px", flexShrink: 0 }}>{card.emoji}</span>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>

                      {/* Name */}
                      <span style={{
                        fontSize: 18, fontWeight: 400, letterSpacing: "-0.2px",
                        textDecoration: isDone ? "line-through" : "none", color: t.text,
                      }}>{card.category}</span>

                      {/* Right side: weight + controls */}
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                        <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 11, color: t.muted }}>
                          ~{wFmt(card.weight)}
                        </span>

                        {!packMode && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <button onClick={() => adjQty(card.category, -1)} style={{
                              width: 26, height: 26, borderRadius: "50%",
                              border: `1px solid ${t.border}`, background: "transparent",
                              cursor: "pointer", color: t.muted, fontSize: 16,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontFamily: "inherit",
                            }}>−</button>
                            <span style={{ fontFamily: "system-ui, sans-serif", fontWeight: 600, fontSize: 16, color: t.accent, minWidth: 20, textAlign: "center" }}>
                              {card.qty}
                            </span>
                            <button onClick={() => adjQty(card.category, 1)} style={{
                              width: 26, height: 26, borderRadius: "50%",
                              border: `1px solid ${t.border}`, background: "transparent",
                              cursor: "pointer", color: t.muted, fontSize: 16,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontFamily: "inherit",
                            }}>+</button>
                          </div>
                        )}

                        {packMode && (
                          <span style={{ fontFamily: "system-ui, sans-serif", fontWeight: 600, fontSize: 16, color: t.accent }}>{card.qty}</span>
                        )}
                      </div>
                    </div>

                    {/* Reason */}
                    {!packMode && (
                      <p style={{ margin: "5px 0 0", fontSize: 14, color: t.muted, lineHeight: 1.6, fontStyle: "italic", fontWeight: 300 }}>
                        {card.reason}
                      </p>
                    )}

                    {/* Casual shirt warnings */}
                    {!packMode && (isOverrideWarnLow || isOverrideWarnHigh) && (
                      <p style={{ margin: "6px 0 0", fontSize: 13, color: "#92400E", lineHeight: 1.55, fontStyle: "italic", fontWeight: 300 }}>
                        {isOverrideWarnLow
                          ? "Under 3 is pushing it. Laundry mid-trip or repeating in mixed company. Your call."
                          : "Over 6 is dead weight. Comfort packing. You won't wear them all."}
                      </p>
                    )}

                    {/* Sub-items */}
                    {card.items && !packMode && (
                      <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {card.items.map((it, i) => (
                          <span key={i} style={{
                            fontFamily: "system-ui, sans-serif", fontSize: 11, padding: "3px 10px",
                            background: t.chip, borderRadius: 4, color: t.muted, letterSpacing: "0.2px",
                          }}>{it}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Weight + bag note */}
        <div style={{ marginTop: 40, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <p style={{ margin: "0 0 4px", fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase" }}>Estimated weight</p>
            <span style={{ fontSize: 48, fontWeight: 300, color: t.text, lineHeight: 1, letterSpacing: "-1px" }}>
              {totalKg}<span style={{ fontSize: 20, color: t.muted }}> kg</span>
            </span>
            <p style={{ margin: "6px 0 0", fontFamily: "system-ui, sans-serif", fontSize: 12, color: t.accent, letterSpacing: "0.3px" }}>
              {bagNote}
            </p>
          </div>

          {Object.keys(overrides).length > 0 && !packMode && (
            <button onClick={() => setOverrides({})} style={{
              fontFamily: "system-ui, sans-serif", fontSize: 11, color: t.muted,
              background: "none", border: "none", cursor: "pointer",
              letterSpacing: "1px", textTransform: "uppercase",
            }}>Reset</button>
          )}
        </div>

        {/* Footer rule */}
        <div style={{ marginTop: 52, paddingTop: 20, borderTop: `1px solid ${t.border}`, fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, lineHeight: 2, letterSpacing: "0.5px" }}>
          RIG TOPS · 2 WEARS &nbsp;·&nbsp; CASUAL SHIRTS · 2 HOT / 3 COOL · MAX 6 &nbsp;·&nbsp; SHOW BLACKS · 2 WEARS &nbsp;·&nbsp; BOTTOMS · 3 WEARS &nbsp;·&nbsp; TRAVEL TOP REUSED ONCE &nbsp;·&nbsp; SOCKS / UW · 1 USE
        </div>

      </div>
    </div>
  );
}
