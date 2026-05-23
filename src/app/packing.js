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
  const maxTemp   = Math.round(Math.max(...daily.temperature_2m_max));
  const minTemp   = Math.round(Math.min(...daily.temperature_2m_min));
  const avgTemp   = Math.round((daily.temperature_2m_max.reduce((a,b)=>a+b,0)/daily.temperature_2m_max.length + daily.temperature_2m_min.reduce((a,b)=>a+b,0)/daily.temperature_2m_min.length) / 2);
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
// Weather bands: hot ≥25, warm 18-24, mild 12-17, cool 7-11, cold ≤6
// Rain flag: ≥40%
// ─────────────────────────────────────────────

function getWeatherBand(weather) {
  if (!weather) return "unknown";
  const { maxTemp, rainChance } = weather;
  const rain = rainChance >= 40;
  if (maxTemp >= 25) return rain ? "hot_wet" : "hot";
  if (maxTemp >= 18) return rain ? "warm_wet" : "warm";
  if (maxTemp >= 12) return rain ? "mild_wet" : "mild";
  if (maxTemp >= 7)  return rain ? "cool_wet" : "cool";
  return rain ? "cold_wet" : "cold";
}

// Item weight estimates (grams, XL)
const WEIGHTS = {
  "Casual shirts": 220,
  "Casual bottoms": 360,
  "Work t-shirts (rig)": 220,
  "Rig shorts": 300,
  "Rig trousers": 440,
  "Black shirt": 260,
  "Black trousers": 480,
  "Black shoes": 880,
  "Trainers": 750,
  "Waterproof jacket": 420,
  "Warm mid-layer": 580,
  "Heavy coat": 1200,
  "Base layer top": 180,
  "Swimwear": 160,
  "Underwear": 40,
  "Socks": 55,
  "Toiletries": 750,
};

function wFmt(g) { return g >= 1000 ? `${(g/1000).toFixed(1)}kg` : `${g}g`; }

// Advisory: returns array of category cards
// Each card: { category, qty, reason, weight, items? }
function buildAdvisory({ totalDays, workDays, mode, band, bags }) {
  const travelDays = totalDays >= 2 ? 2 : 1;
  const casualDays = Math.max(0, totalDays - workDays - travelDays);
  const isRain  = band.includes("wet");
  const isHot   = band.startsWith("hot");
  const isWarm  = band.startsWith("warm");
  const isMild  = band.startsWith("mild");
  const isCool  = band.startsWith("cool");
  const isCold  = band.startsWith("cold");
  const unknown = band === "unknown";

  // Smart re-wear logic: travel top counts as +1 casual wear
  const wearDays = (days, wearsPerItem) => Math.max(1, Math.ceil(days / wearsPerItem));

  const cards = [];

  // ── UNDERWEAR & SOCKS ──────────────────────
  cards.push({
    category: "Underwear & socks",
    qty: totalDays,
    reason: "One use each — no exceptions. Non-negotiable.",
    weight: (WEIGHTS["Underwear"] + WEIGHTS["Socks"]) * totalDays,
    emoji: "🩲",
  });

  // ── RIG / WORK (corporate + rock&roll) ─────
  if (mode !== "holiday" && workDays > 0) {
    const rigTops = wearDays(workDays, 2);
    const rigBottoms = isHot || isWarm
      ? wearDays(workDays, 3)
      : wearDays(workDays, 2);
    const bottomLabel = (isCool || isCold) ? "Rig trousers" : "Rig shorts";
    cards.push({
      category: "Work t-shirts (rig)",
      qty: rigTops,
      reason: `${workDays} work day${workDays > 1 ? "s" : ""}, 2 wears per top. ${isHot ? "It's hot — a rig tee will work fine all day." : "These are workhorses, wear them hard."}`,
      weight: WEIGHTS["Work t-shirts (rig)"] * rigTops,
      emoji: "👕",
    });
    cards.push({
      category: bottomLabel,
      qty: rigBottoms,
      reason: (isCool || isCold)
        ? `Cold forecast — trousers over shorts. ${workDays} days, ${rigBottoms > 1 ? "2 wears each" : "1 pair will do"}.`
        : `${workDays} work days, 3 wears per pair of shorts. ${isHot ? "Light and practical in the heat." : ""}`,
      weight: WEIGHTS[bottomLabel] * rigBottoms,
      emoji: (isCool || isCold) ? "👖" : "🩳",
    });
  }

  // ── BLACK BLACKS (corporate only, 1 set) ───
  if (mode === "corporate" && workDays > 0) {
    const showBlacksQty = workDays > 4 ? 2 : 1;
    cards.push({
      category: "Show blacks",
      qty: showBlacksQty,
      reason: showBlacksQty === 1
        ? "One set — black shirt, black trousers, black shoes. You'll get two wears out of these. Smart enough for any evening, no one will notice."
        : "Two sets — enough formal evenings to warrant it. Still get 2 wears from each.",
      weight: (WEIGHTS["Black shirt"] + WEIGHTS["Black trousers"] + WEIGHTS["Black shoes"]) * showBlacksQty,
      items: showBlacksQty === 1
        ? ["Black shirt ×1", "Black trousers ×1", "Black shoes ×1"]
        : ["Black shirt ×2", "Black trousers ×2", "Black shoes ×1"],
      emoji: "🖤",
    });
  }

  // ── CASUAL SHIRTS ──────────────────────────
  const casualWearDays = mode === "holiday"
    ? totalDays
    : workDays + casualDays; // evenings count

  const wearsPerCasual = isHot ? 2 : 3; // hot = sweat, cool = stretch it
  // Travel top credit: outbound top does 1 extra casual wear
  const travelCredit = travelDays >= 1 ? 1 : 0;
  const casualQty = Math.min(6, Math.max(1, wearDays(Math.max(0, casualWearDays - travelCredit), wearsPerCasual)));

  let casualReason = "";
  if (isHot)        casualReason = `Hot out — ${wearsPerCasual} wears per shirt. Travel top covers arrival day so you only need ${casualQty} fresh ${casualQty === 1 ? "shirt" : "shirts"}. 6 is the ceiling — any more is just comfort blanket.`;
  else if (isWarm)  casualReason = `Warm weather, ${wearsPerCasual} wears each. Your travel top handles one casual slot — ${casualQty} shirt${casualQty > 1 ? "s" : ""} is plenty. 6 max, you don't need more.`;
  else if (isMild)  casualReason = `Mild temps mean a shirt can go 3 days without raising eyebrows. Travel top doubles up — ${casualQty} casual shirt${casualQty > 1 ? "s" : ""}. Cap at 6.`;
  else if (isCool)  casualReason = `Cool means layers — your shirts go under a mid-layer so they're barely seen. ${casualQty} shirt${casualQty > 1 ? "s" : ""}, 3 wears each. 6 is more than enough for any trip.`;
  else if (isCold)  casualReason = `Cold means shirts are base layers under coats. ${casualQty} shirt${casualQty > 1 ? "s" : ""} — you can wear the same one twice without issue. Don't pack more than 6.`;
  else              casualReason = `${casualQty} casual shirt${casualQty > 1 ? "s" : ""}. Travel top earns its keep for one casual slot. 6 is the max I'd ever take.`;

  cards.push({
    category: "Casual shirts",
    qty: casualQty,
    reason: casualReason,
    weight: WEIGHTS["Casual shirts"] * casualQty,
    emoji: "👔",
  });

  // Travel tops (always 2 — worn on travel days)
  cards.push({
    category: "Travel tops",
    qty: 2,
    reason: "Worn on travel days (in + out). Outbound top reused once on arrival or a casual day — that's the credit that saves you a shirt.",
    weight: WEIGHTS["Casual shirts"] * 2,
    emoji: "✈️",
  });

  // ── CASUAL BOTTOMS ─────────────────────────
  const casualBottomDays = mode === "holiday" ? totalDays : casualDays + travelDays;
  const bottomWears = (isHot || isWarm) ? 3 : 3; // always 3 for casual
  const casualBottomQty = Math.max(1, wearDays(casualBottomDays, bottomWears));
  const casualBottomLabel = isHot ? "Casual shorts / shorts" : (isCool || isCold) ? "Casual trousers" : "Casual bottoms";

  cards.push({
    category: casualBottomLabel,
    qty: casualBottomQty,
    reason: isHot
      ? `Hot — shorts are the move. 3 wears per pair, ${casualBottomQty} pair${casualBottomQty > 1 ? "s" : ""} covers casual and travel days.`
      : (isCool || isCold)
        ? `Too cold for shorts off the clock. ${casualBottomQty} pair${casualBottomQty > 1 ? "s" : ""} of casual trousers, 3 wears each.`
        : `${casualBottomQty} pair${casualBottomQty > 1 ? "s" : ""} for evenings, travel, and days off. 3 wears per pair.`,
    weight: WEIGHTS["Casual bottoms"] * casualBottomQty,
    emoji: isHot ? "🩳" : "👖",
  });

  // ── SHOES ──────────────────────────────────
  cards.push({
    category: "Trainers",
    qty: 1,
    reason: isCold || isCool
      ? "One pair of clean, versatile trainers. Wear your heaviest / warmest pair on the plane — saves bag space."
      : "One pair, full stop. Clean white-ish trainers do evenings, travel, and casual days without a second pair.",
    weight: WEIGHTS["Trainers"],
    emoji: "👟",
  });

  // ── OUTERWEAR ──────────────────────────────
  if (isRain) {
    cards.push({
      category: "Packable waterproof",
      qty: 1,
      reason: isHot
        ? "Rain chance is high even in the heat — a packable shell weighs almost nothing and saves you from a soaking. Doesn't need to be warm, just waterproof."
        : isMild || isWarm
          ? "Rain expected — a light waterproof replaces the need for a hoodie. One layer that does both jobs."
          : "Wet and cold is the worst combo. Waterproof on top, warm mid-layer underneath.",
      weight: WEIGHTS["Waterproof jacket"],
      emoji: "🌧️",
    });
  }

  if (isCool || isCold || (isMild && !isRain)) {
    const layerLabel = isCold ? "Heavy coat" : "Warm mid-layer";
    cards.push({
      category: layerLabel,
      qty: 1,
      reason: isCold
        ? "Wear the coat on the plane — this is the single heaviest item and it costs you nothing in bag weight if it's on your back. Pair with a base layer underneath for real cold."
        : isCool
          ? "A fleece or light jacket. Goes over any shirt, keeps evenings comfortable, doesn't look scruff."
          : "Mild enough that a light layer is all you need for evenings. One is enough.",
      weight: WEIGHTS[layerLabel],
      emoji: isCold ? "🧥" : "🫙",
    });
    // Add jumper for cool/cold — a proper knit over shirts for smarter occasions
    if (isCool || isCold) {
      cards.push({
        category: "Jumper / knitwear",
        qty: 1,
        reason: isCold
          ? "A merino or fine-knit jumper. Goes under your coat, over a shirt — looks put together for an evening without needing the show blacks. One is enough, merino handles multiple wears."
          : "A smart knit or hoodie for the evening. Works over a casual shirt, doesn't look like you've just come off the rig. 2–3 wears comfortably.",
        weight: 480,
        emoji: "🧶",
      });
    }
  }

  if (isCold) {
    cards.push({
      category: "Base layer top",
      qty: 1,
      reason: "Thin merino or thermal base layer. Worn under everything in real cold. 1 is enough — merino handles 3+ wears without smelling.",
      weight: WEIGHTS["Base layer top"],
      emoji: "🧤",
    });
  }

  if (isHot) {
    cards.push({
      category: "Swimwear",
      qty: 1,
      reason: "It's hot — if there's a pool, a beach, or a rooftop, you'll want it. Weighs nothing. Pack it.",
      weight: WEIGHTS["Swimwear"],
      emoji: "🩱",
    });
  }

  // ── TOILETRIES ─────────────────────────────
  cards.push({
    category: "Toiletries",
    qty: 1,
    reason: "One bag. Keep a pre-packed travel set — refillable 100ml bottles, solid deodorant, mini toothpaste. Never repack from scratch.",
    weight: WEIGHTS["Toiletries"],
    emoji: "🪥",
  });

  // ── BAG RECOMMENDATION ─────────────────────
  const totalWeight = cards.reduce((s, c) => s + c.weight, 0);

  return { cards, totalWeight };
}

// ─────────────────────────────────────────────
// THEMES
// ─────────────────────────────────────────────
const THEMES = {
  corporate: { bg: "#F8F6F3", text: "#1C1917", muted: "#78716C", accent: "#1C4A1C", border: "#E7E5E4", chip: "#EDECEA", card: "#FFFFFF" },
  rockroll:  { bg: "#F6F5F3", text: "#1C1917", muted: "#78716C", accent: "#7C1D1D", border: "#E7E5E4", chip: "#EDECEA", card: "#FFFFFF" },
  holiday:   { bg: "#F3F7F6", text: "#1C1917", muted: "#78716C", accent: "#134E4A", border: "#D5E4E3", chip: "#E3EDEC", card: "#FFFFFF" },
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
  const [totalDays, setTotalDays] = useState(5);
  const [workDays, setWorkDays]   = useState(3);
  const [mode, setMode]           = useState("corporate");
  const [destination, setDest]    = useState("London");
  const [weather, setWeather]     = useState(null);
  const [wxStatus, setWxStatus]   = useState("");
  const [destInfo, setDestInfo]   = useState(null);
  const [packMode, setPackMode]   = useState(false);
  const [checked, setChecked]     = useState({});
  const [overrides, setOverrides] = useState({});

  // Weather fetch with debounce — multi-city, worst-case across all
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!destination.trim()) return;
      setWxStatus("Looking up weather…");
      setWeather(null);
      setDestInfo(null);
      try {
        const cities = destination.split(",").map(s => s.trim()).filter(Boolean);
        const results = [];
        const labels = [];
        for (const city of cities) {
          try {
            const g = await geocode(city);
            const daily = await fetchForecast(g.latitude, g.longitude);
            const s = summarise(daily);
            if (s) { results.push(s); labels.push(`${g.name}, ${g.country_code}`); }
          } catch (e) {
            labels.push(`${city} (not found)`);
          }
        }
        if (cancelled) return;
        if (results.length) {
          // Worst-case across all destinations
          const combined = {
            maxTemp: Math.max(...results.map(r => r.maxTemp)),
            minTemp: Math.min(...results.map(r => r.minTemp)),
            avgTemp: Math.round(results.reduce((s, r) => s + r.avgTemp, 0) / results.length),
            rainChance: Math.max(...results.map(r => r.rainChance)),
          };
          setWeather(combined);
          setDestInfo({ name: labels.join(" · "), ...combined });
          setWxStatus("");
        } else {
          setWxStatus("Couldn't find any of those cities");
        }
      } catch (e) {
        if (!cancelled) setWxStatus(`${e.message}`);
      }
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [destination]);

  const band = getWeatherBand(weather);
  const { cards, totalWeight } = buildAdvisory({
    totalDays,
    workDays: mode === "holiday" ? 0 : workDays,
    mode, band,
  });

  // Apply qty overrides
  const displayCards = cards.map(c => ({
    ...c,
    qty: overrides[c.category] ?? c.qty,
    weight: (WEIGHTS[c.category] || 200) * (overrides[c.category] ?? c.qty),
  }));
  const totalW = displayCards.reduce((s, c) => s + c.weight, 0);
  const totalKg = (totalW / 1000).toFixed(1);

  const toggleCheck = (cat) => setChecked(p => ({ ...p, [cat]: !p[cat] }));
  const adjQty = (cat, delta) => setOverrides(o => ({
    ...o,
    [cat]: Math.max(0, (o[cat] ?? (cards.find(c => c.category === cat)?.qty || 1)) + delta),
  }));

  const checkedCount = Object.values(checked).filter(Boolean).length;
  const t = THEMES[mode];

  const pill = (active) => ({
    padding: "8px 20px", borderRadius: 20, border: "none", cursor: "pointer",
    fontFamily: "Georgia, serif", fontSize: 13, letterSpacing: "0.3px",
    background: active ? t.accent : t.chip,
    color: active ? "#fff" : t.muted,
    fontWeight: active ? 600 : 400,
    transition: "all 0.18s",
  });

  const inp = {
    width: "100%", padding: "10px 14px", fontFamily: "Georgia, serif",
    background: t.card, border: `1.5px solid ${t.border}`, borderRadius: 10,
    color: t.text, fontSize: 15, boxSizing: "border-box", outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text, fontFamily: "Georgia, 'Times New Roman', serif", padding: "36px 20px 60px" }}>
      <div style={{ maxWidth: 600, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 56, fontWeight: 300, margin: 0, letterSpacing: "-1.5px", lineHeight: 1 }}>
            Roadie Pack
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: t.muted, fontStyle: "italic", letterSpacing: "0.3px" }}>
            Packing to do some roadie'ing.
          </p>
        </div>

        {/* Mode */}
        {!packMode && (
          <div style={{ display: "flex", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
            {MODES.map(m => (
              <button key={m.id} style={pill(mode === m.id)}
                onClick={() => { setMode(m.id); setOverrides({}); setChecked({}); }}>
                {m.label}
              </button>
            ))}
          </div>
        )}

        {/* Inputs */}
        {!packMode && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: mode !== "holiday" ? "1fr 1fr" : "1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: t.muted, letterSpacing: "1.2px", textTransform: "uppercase", marginBottom: 6 }}>Days away</label>
                <input type="number" value={totalDays} min={1} max={60} style={inp}
                  onChange={e => { setTotalDays(parseInt(e.target.value)||1); setOverrides({}); }} />
              </div>
              {mode !== "holiday" && (
                <div>
                  <label style={{ display: "block", fontSize: 11, color: t.muted, letterSpacing: "1.2px", textTransform: "uppercase", marginBottom: 6 }}>Work days</label>
                  <input type="number" value={workDays} min={0} max={totalDays} style={inp}
                    onChange={e => { setWorkDays(parseInt(e.target.value)||0); setOverrides({}); }} />
                </div>
              )}
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 11, color: t.muted, letterSpacing: "1.2px", textTransform: "uppercase", marginBottom: 6 }}>Destination</label>
              <input type="text" value={destination} placeholder="London, Barcelona, Paris" style={inp}
                onChange={e => setDest(e.target.value)} />
            </div>

            {/* Weather strip */}
            <div style={{ marginBottom: 28, padding: "14px 16px", background: t.card, borderRadius: 12, border: `1px solid ${t.border}` }}>
              <p style={{ margin: "0 0 2px", fontSize: 11, color: t.muted, letterSpacing: "1.2px", textTransform: "uppercase" }}>Weather · next 7 days</p>
              {wxStatus && <p style={{ margin: "6px 0 0", fontSize: 14, color: t.muted, fontStyle: "italic" }}>{wxStatus}</p>}
              {destInfo && !wxStatus && (
                <div style={{ marginTop: 6 }}>
                  <p style={{ margin: 0, fontSize: 18, fontWeight: 400 }}>
                    {wxEmoji(destInfo)} {destInfo.minTemp}–{destInfo.maxTemp}°C · {destInfo.rainChance}% rain chance
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: t.muted }}>{destInfo.name}</p>
                </div>
              )}
            </div>

            {/* Trip breakdown chips */}
            <div style={{ display: "flex", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
              {[
                `✈️ ${totalDays >= 2 ? 2 : 1} travel`,
                ...(mode !== "holiday" && workDays > 0 ? [`💼 ${workDays} work`] : []),
                ...(Math.max(0, totalDays - (mode !== "holiday" ? workDays : 0) - (totalDays >= 2 ? 2 : 1)) > 0
                  ? [`🌅 ${Math.max(0, totalDays - (mode !== "holiday" ? workDays : 0) - (totalDays >= 2 ? 2 : 1))} off`] : []),
              ].map((label, i) => (
                <span key={i} style={{ padding: "6px 14px", background: t.chip, borderRadius: 20, fontSize: 13, color: t.muted }}>{label}</span>
              ))}
            </div>
          </>
        )}

        {/* List header + pack toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 11, color: t.muted, letterSpacing: "1.2px", textTransform: "uppercase" }}>
            {packMode ? `Packing — ${checkedCount} of ${displayCards.length} done` : "What I'd pack"}
          </p>
          <button
            onClick={() => { setPackMode(!packMode); setChecked({}); }}
            style={{
              padding: "7px 20px", borderRadius: 20, cursor: "pointer",
              fontFamily: "Georgia, serif", fontSize: 12, letterSpacing: "0.3px",
              border: `1.5px solid ${t.accent}`,
              background: packMode ? t.accent : "transparent",
              color: packMode ? "#fff" : t.accent,
            }}
          >{packMode ? "✓ Done" : "Pack mode"}</button>
        </div>

        {/* Progress bar */}
        {packMode && (
          <div style={{ height: 2, background: t.border, borderRadius: 2, marginBottom: 20, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(checkedCount / displayCards.length) * 100}%`, background: t.accent, transition: "width 0.3s" }} />
          </div>
        )}

        {/* Cards */}
        <div style={{ display: "grid", gap: 10 }}>
          {displayCards.map((card) => {
            const isDone = !!checked[card.category];
            return (
              <div key={card.category} style={{
                background: t.card, border: `1px solid ${t.border}`, borderRadius: 14,
                padding: "16px 18px", opacity: isDone ? 0.35 : 1, transition: "opacity 0.25s",
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>

                  {/* Check circle */}
                  {packMode && (
                    <div onClick={() => toggleCheck(card.category)} style={{
                      width: 26, height: 26, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                      border: `2px solid ${isDone ? t.accent : t.border}`,
                      background: isDone ? t.accent : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", transition: "all 0.2s", userSelect: "none",
                    }}>
                      {isDone && <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                    </div>
                  )}

                  {/* Emoji */}
                  <span style={{ fontSize: 22, lineHeight: 1.2, flexShrink: 0 }}>{card.emoji}</span>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 16, fontWeight: 500, color: t.text, textDecoration: isDone ? "line-through" : "none" }}>
                        {card.category}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 11, color: t.muted }}>~{wFmt(card.weight)}</span>

                        {/* Qty controls — plan mode */}
                        {!packMode && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <button onClick={() => adjQty(card.category, -1)} style={{
                              width: 24, height: 24, borderRadius: "50%", border: `1.5px solid ${t.border}`,
                              background: "transparent", cursor: "pointer", color: t.muted,
                              fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center",
                            }}>−</button>
                            <span style={{ fontWeight: 700, fontSize: 17, color: t.accent, minWidth: 18, textAlign: "center" }}>{card.qty}</span>
                            <button onClick={() => adjQty(card.category, 1)} style={{
                              width: 24, height: 24, borderRadius: "50%", border: `1.5px solid ${t.border}`,
                              background: "transparent", cursor: "pointer", color: t.muted,
                              fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center",
                            }}>+</button>
                          </div>
                        )}

                        {/* Qty static — pack mode */}
                        {packMode && (
                          <span style={{ fontWeight: 700, fontSize: 17, color: t.accent }}>{card.qty}</span>
                        )}
                      </div>
                    </div>

                    {/* Advisory reason */}
                    {!packMode && (
                      <p style={{ margin: "6px 0 0", fontSize: 13, color: t.muted, lineHeight: 1.55, fontStyle: "italic" }}>
                        {card.reason}
                      </p>
                    )}

                    {/* Override warnings for casual shirts */}
                    {!packMode && card.category === "Casual shirts" && (
                      <>
                        {card.qty < 3 && (
                          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#B45309", lineHeight: 1.5, fontStyle: "italic" }}>
                            ⚠️ Under 3 is pushing it. You'll either be doing laundry mid-trip or wearing something twice in a row in mixed company. Your call, but I wouldn't.
                          </p>
                        )}
                        {card.qty > 6 && (
                          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#B45309", lineHeight: 1.5, fontStyle: "italic" }}>
                            ⚠️ Over 6 is dead weight. That's what comfort packing looks like — you won't wear them all.
                          </p>
                        )}
                      </>
                    )}

                    {/* Sub-items */}
                    {card.items && !packMode && (
                      <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {card.items.map((it, i) => (
                          <span key={i} style={{ fontSize: 11, padding: "3px 10px", background: t.chip, borderRadius: 12, color: t.muted }}>{it}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Weight total */}
        <div style={{ marginTop: 28, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <p style={{ margin: "0 0 2px", fontSize: 11, color: t.muted, letterSpacing: "0.5px" }}>Estimated bag weight</p>
            <span style={{ fontSize: 32, fontWeight: 300, color: t.text, fontFamily: "'Cormorant Garamond', Georgia, serif", lineHeight: 1 }}>
              ~{totalKg} kg
            </span>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: t.muted, fontStyle: "italic" }}>
              {parseFloat(totalKg) < 6
                ? "✓ Backpack territory"
                : parseFloat(totalKg) < 10
                  ? "✓ Tumi carry-on, no problem"
                  : parseFloat(totalKg) < 14
                    ? "Carry-on at the limit — check your airline"
                    : "This wants a checked bag"}
            </p>
          </div>
          {Object.keys(overrides).length > 0 && !packMode && (
            <button onClick={() => setOverrides({})} style={{
              fontSize: 12, color: t.muted, background: "none", border: "none",
              cursor: "pointer", textDecoration: "underline", fontFamily: "Georgia, serif",
            }}>Reset</button>
          )}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 44, paddingTop: 20, borderTop: `1px solid ${t.border}`, fontSize: 11, color: t.muted, lineHeight: 2 }}>
          Rig tops · 2 wears &nbsp;·&nbsp; Casual shirts · 2 hot / 3 cool · max 6 &nbsp;·&nbsp; Show blacks · 2 wears &nbsp;·&nbsp; Bottoms · 3 wears &nbsp;·&nbsp; Travel top reused once &nbsp;·&nbsp; Socks/UW · 1 use
        </div>

      </div>
    </div>
  );
}
