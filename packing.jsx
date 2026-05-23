import React, { useState, useEffect } from "react";

// ───────────────────────────────────────────────────────────────
// PACKING LOGIC — wear-ratios baked in
// Tops: 2 wears each. Bottoms: 3 wears each. Socks/underwear: 1 use.
// ───────────────────────────────────────────────────────────────

const TOP_WEARS = 2;              // work/rig tops
const BOTTOM_WEARS = 3;
const CASUAL_TOP_HOT = 2;          // ≥22°C max
const CASUAL_TOP_COOL = 3;         // <22°C max
const TRAVEL_TOP_BONUS_WEARS = 1;  // outbound travel top → 1 extra casual wear after arrival

// Round up division
const ceil = (n, d) => Math.ceil(n / d);

// Casual top wears flex with weather
const casualTopWears = (weather) => {
  if (weather && weather.maxTemp >= 22) return CASUAL_TOP_HOT;
  return CASUAL_TOP_COOL;
};

// Calculate casual tops accounting for travel-top reuse
// Outbound travel top absorbs 1 casual wear after arrival.
// Return travel top stays clean for the journey home.
const calcCasualTops = (casualWearDays, weather) => {
  const wears = casualTopWears(weather);
  const credited = Math.max(0, casualWearDays - TRAVEL_TOP_BONUS_WEARS);
  return Math.max(0, ceil(credited, wears));
};

function calculatePacking({ totalDays, workDays, mode, weather, overrides }) {
  // Travel days = first and last day (assumed). Casual days = total − work − 2 travel.
  const travelDays = totalDays >= 2 ? 2 : 1;
  const casualDays = Math.max(0, totalDays - workDays - travelDays);

  const list = {};

  // Socks & underwear — one per day, always
  list["Underwear"] = totalDays;
  list["Socks"] = totalDays;

  // Sleep
  list["Sleepwear"] = totalDays >= 4 ? 2 : 1;

  if (mode === "corporate") {
    // Work: rig clothes OR black blacks — assume rig by default, black blacks for evening/meetings
    // Day = rig shorts + rig t-shirt. Evening = full change into casual.
    list["Rig t-shirts"] = ceil(workDays, TOP_WEARS);
    list["Rig shorts"] = ceil(workDays, BOTTOM_WEARS);
    // Black blacks — one set, worn for any formal moment
    list["Black shirt"] = 1;
    list["Black trousers"] = 1;
    list["Black shoes"] = 1;
    // Evening casual — one outfit per work day evening + casual day
    const eveningDays = workDays + casualDays;
    list["Casual tops"] = calcCasualTops(eveningDays, weather);
    list["Casual bottoms"] = ceil(eveningDays + travelDays, BOTTOM_WEARS);
    list["Travel tops"] = 2;
    list["Trainers/casual shoes"] = 1;
  }

  if (mode === "rockroll") {
    // Long work days, no evening out — fewer casual clothes
    list["Rig t-shirts"] = ceil(workDays, TOP_WEARS);
    list["Rig shorts"] = ceil(workDays, BOTTOM_WEARS);
    // Casual only for days off (travel days covered by travel tops)
    list["Casual tops"] = calcCasualTops(casualDays, weather);
    list["Casual bottoms"] = Math.max(1, ceil(casualDays + travelDays, BOTTOM_WEARS));
    list["Travel tops"] = 2;
    list["Trainers/casual shoes"] = 1;
  }

  if (mode === "holiday") {
    // Pure leisure — bottoms 3 wears, tops weather-dependent
    // Travel tops cover travel days + 1 bonus, casual tops cover the rest
    const nonTravelDays = Math.max(0, totalDays - travelDays);
    list["Casual tops"] = calcCasualTops(nonTravelDays, weather);
    list["Casual bottoms"] = ceil(totalDays, BOTTOM_WEARS);
    list["Travel tops"] = 2;
    list["Trainers/casual shoes"] = 1;
    // One "smart" option for a nicer meal
    if (totalDays >= 3) {
      list["Smart shirt"] = 1;
    }
  }

  // Weather-driven swaps & additions
  const swaps = [];
  if (weather) {
    const { maxTemp, minTemp, rainChance } = weather;

    if (rainChance >= 40) {
      list["Waterproof jacket"] = 1;
      swaps.push(`Rain likely (${rainChance}%) — waterproof added`);
    }
    if (maxTemp >= 25) {
      list["Swimwear"] = 1;
      swaps.push(`Hot (${maxTemp}°C max) — swimwear added`);
    }
    if (minTemp <= 12) {
      list["Warm layer / hoodie"] = 1;
      swaps.push(`Cool evenings (${minTemp}°C min) — warm layer added`);
    }
    if (maxTemp <= 15 && mode !== "corporate") {
      // Swap shorts for trousers if cold and not corporate (corporate already has both)
      if (list["Rig shorts"]) {
        list["Rig trousers"] = list["Rig shorts"];
        delete list["Rig shorts"];
        swaps.push("Cold — rig shorts swapped for trousers");
      }
    }
  }

  // Toiletries — always
  list["Toiletries kit"] = 1;

  // Apply overrides
  Object.keys(overrides || {}).forEach((key) => {
    if (overrides[key] === 0) {
      delete list[key];
    } else {
      list[key] = overrides[key];
    }
  });

  return { list, swaps, breakdown: { totalDays, workDays, casualDays, travelDays } };
}

// ───────────────────────────────────────────────────────────────
// WEATHER — Open-Meteo (no API key)
// ───────────────────────────────────────────────────────────────

async function geocode(city) {
  const r = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
  );
  const d = await r.json();
  if (!d.results || !d.results.length) throw new Error(`Can't find ${city}`);
  return d.results[0];
}

async function fetchForecast(lat, lon, startDate, endDate) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&start_date=${startDate}&end_date=${endDate}&timezone=auto`;
  const r = await fetch(url);
  const d = await r.json();
  return d.daily;
}

function summariseWeather(daily) {
  if (!daily || !daily.temperature_2m_max) return null;
  const maxTemp = Math.max(...daily.temperature_2m_max);
  const minTemp = Math.min(...daily.temperature_2m_min);
  const rainChance = Math.max(...(daily.precipitation_probability_max || [0]));
  return { maxTemp, minTemp, rainChance, daily };
}

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ───────────────────────────────────────────────────────────────
// UI
// ───────────────────────────────────────────────────────────────

export default function PackingApp() {
  const [totalDays, setTotalDays] = useState(5);
  const [workDays, setWorkDays] = useState(3);
  const [mode, setMode] = useState("corporate");
  const [destinations, setDestinations] = useState("London");
  const [startOffset, setStartOffset] = useState(0); // days from today
  const [weather, setWeather] = useState(null);
  const [weatherStatus, setWeatherStatus] = useState("");
  const [overrides, setOverrides] = useState({});
  const [destDetails, setDestDetails] = useState([]);

  // Pull weather whenever destinations or dates change
  useEffect(() => {
    let cancelled = false;
    async function go() {
      setWeatherStatus("Fetching weather…");
      try {
        const cities = destinations
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const startDate = todayPlus(startOffset);
        const endDate = todayPlus(startOffset + totalDays - 1);
        const all = [];
        const details = [];
        for (const city of cities) {
          try {
            const g = await geocode(city);
            const daily = await fetchForecast(g.latitude, g.longitude, startDate, endDate);
            const summary = summariseWeather(daily);
            if (summary) {
              all.push(summary);
              details.push({
                name: `${g.name}, ${g.country_code}`,
                maxTemp: summary.maxTemp,
                minTemp: summary.minTemp,
                rainChance: summary.rainChance,
              });
            }
          } catch (e) {
            details.push({ name: city, error: e.message });
          }
        }
        if (cancelled) return;
        if (all.length) {
          // Combine: worst-case across all destinations
          const combined = {
            maxTemp: Math.max(...all.map((a) => a.maxTemp)),
            minTemp: Math.min(...all.map((a) => a.minTemp)),
            rainChance: Math.max(...all.map((a) => a.rainChance)),
          };
          setWeather(combined);
          setDestDetails(details);
          setWeatherStatus("");
        } else {
          setWeather(null);
          setDestDetails(details);
          setWeatherStatus("No weather data");
        }
      } catch (e) {
        if (!cancelled) setWeatherStatus(`Error: ${e.message}`);
      }
    }
    if (destinations.trim()) go();
    return () => {
      cancelled = true;
    };
  }, [destinations, totalDays, startOffset]);

  const { list, swaps, breakdown } = calculatePacking({
    totalDays,
    workDays: mode === "holiday" ? 0 : workDays,
    mode,
    weather,
    overrides,
  });

  const adjust = (item, delta) => {
    setOverrides((o) => {
      const current = o[item] ?? list[item] ?? 0;
      const next = Math.max(0, current + delta);
      return { ...o, [item]: next };
    });
  };

  const reset = () => setOverrides({});

  const modeStyles = {
    corporate: { bg: "#1a1a2e", accent: "#e94560" },
    rockroll: { bg: "#0f0f0f", accent: "#ff6b35" },
    holiday: { bg: "#1e4d4d", accent: "#ffd166" },
  };
  const theme = modeStyles[mode];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: theme.bg,
        color: "#f5f5f5",
        fontFamily: "Georgia, 'Times New Roman', serif",
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ borderBottom: `3px solid ${theme.accent}`, paddingBottom: 16, marginBottom: 24 }}>
          <h1 style={{ fontSize: 36, margin: 0, letterSpacing: "-1px", fontWeight: 900 }}>
            PACK<span style={{ color: theme.accent }}>.</span>
          </h1>
          <p style={{ margin: "4px 0 0", opacity: 0.7, fontSize: 14, fontStyle: "italic" }}>
            Less in the bag. More on the road.
          </p>
        </div>

        {/* Mode selector */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {[
            { id: "corporate", label: "Corporate" },
            { id: "rockroll", label: "Rock & Roll" },
            { id: "holiday", label: "Holiday" },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setMode(m.id);
                setOverrides({});
              }}
              style={{
                flex: 1,
                padding: "12px",
                background: mode === m.id ? theme.accent : "transparent",
                color: mode === m.id ? "#000" : "#f5f5f5",
                border: `1px solid ${mode === m.id ? theme.accent : "#444"}`,
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "inherit",
                letterSpacing: "1px",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Inputs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <Field label="Total days (inc. travel)">
            <NumInput value={totalDays} onChange={setTotalDays} min={1} max={60} />
          </Field>
          {mode !== "holiday" && (
            <Field label="Work days">
              <NumInput value={workDays} onChange={setWorkDays} min={0} max={totalDays} />
            </Field>
          )}
          <Field label="Days from today (start)">
            <NumInput value={startOffset} onChange={setStartOffset} min={0} max={14} />
          </Field>
        </div>

        <Field label="Destinations (comma-separated)">
          <input
            type="text"
            value={destinations}
            onChange={(e) => setDestinations(e.target.value)}
            placeholder="London, Berlin, Paris"
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid #444",
              color: "#fff",
              fontSize: 15,
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
        </Field>

        {/* Breakdown */}
        <div
          style={{
            marginTop: 20,
            padding: "12px 16px",
            background: "rgba(255,255,255,0.04)",
            borderLeft: `3px solid ${theme.accent}`,
            fontSize: 13,
            opacity: 0.85,
          }}
        >
          <strong>{breakdown.totalDays} days total</strong> · {breakdown.travelDays} travel ·{" "}
          {breakdown.workDays} work · {breakdown.casualDays} casual
        </div>

        {/* Weather */}
        <div style={{ marginTop: 20 }}>
          <SectionHeader theme={theme}>Weather</SectionHeader>
          {weatherStatus && <p style={{ fontSize: 13, opacity: 0.7 }}>{weatherStatus}</p>}
          {destDetails.length > 0 && (
            <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
              {destDetails.map((d, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <span>{d.name}</span>
                  <span style={{ opacity: 0.8 }}>
                    {d.error
                      ? d.error
                      : `${Math.round(d.minTemp)}–${Math.round(d.maxTemp)}°C · ${d.rainChance}% rain`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Swaps */}
        {swaps.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <SectionHeader theme={theme}>Weather adjustments</SectionHeader>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, opacity: 0.85 }}>
              {swaps.map((s, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Packing list */}
        <div style={{ marginTop: 24 }}>
          <SectionHeader theme={theme}>The list</SectionHeader>
          <div style={{ display: "grid", gap: 4 }}>
            {Object.entries(list).map(([item, qty]) => (
              <div
                key={item}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "10px 12px",
                  background: "rgba(255,255,255,0.04)",
                  borderLeft: `2px solid ${theme.accent}`,
                }}
              >
                <span style={{ flex: 1, fontSize: 15 }}>{item}</span>
                <button
                  onClick={() => adjust(item, -1)}
                  style={btnStyle(theme)}
                  aria-label={`reduce ${item}`}
                >
                  −
                </button>
                <span
                  style={{
                    minWidth: 32,
                    textAlign: "center",
                    fontSize: 18,
                    fontWeight: 700,
                    color: theme.accent,
                  }}
                >
                  {qty}
                </span>
                <button
                  onClick={() => adjust(item, 1)}
                  style={btnStyle(theme)}
                  aria-label={`add ${item}`}
                >
                  +
                </button>
              </div>
            ))}
          </div>
          {Object.keys(overrides).length > 0 && (
            <button
              onClick={reset}
              style={{
                marginTop: 12,
                padding: "8px 16px",
                background: "transparent",
                border: `1px solid ${theme.accent}`,
                color: theme.accent,
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "inherit",
                letterSpacing: "1px",
                textTransform: "uppercase",
              }}
            >
              Reset to calculated
            </button>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: 32,
            paddingTop: 16,
            borderTop: "1px solid #333",
            fontSize: 11,
            opacity: 0.5,
            textAlign: "center",
          }}
        >
          Work tops: 2 wears · Casual: 2 hot / 3 cool · Bottoms: 3 wears · Travel top reused once · Socks/UW: 1 use
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 11,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          opacity: 0.6,
          marginBottom: 4,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, min, max }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(parseInt(e.target.value) || 0)}
      style={{
        width: "100%",
        padding: "10px 12px",
        background: "rgba(255,255,255,0.05)",
        border: "1px solid #444",
        color: "#fff",
        fontSize: 15,
        fontFamily: "inherit",
        boxSizing: "border-box",
      }}
    />
  );
}

function SectionHeader({ children, theme }) {
  return (
    <h2
      style={{
        fontSize: 12,
        letterSpacing: "2px",
        textTransform: "uppercase",
        color: theme.accent,
        margin: "0 0 10px",
        fontWeight: 700,
      }}
    >
      {children}
    </h2>
  );
}

function btnStyle(theme) {
  return {
    width: 28,
    height: 28,
    background: "transparent",
    border: `1px solid ${theme.accent}`,
    color: theme.accent,
    cursor: "pointer",
    fontSize: 16,
    fontFamily: "inherit",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}
