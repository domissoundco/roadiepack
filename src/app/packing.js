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
  "Polo shirts": 240,
  "Work t-shirts (rig)": 220, "Rig shorts": 300, "Rig trousers": 440,
  "Work shorts": 300, "Work shorts (optional)": 300,
  "Work trousers / combats": 440, "Work trousers / combats (1 pair)": 440,
  "Work hoodie / zip": 520,
  "Black shirt": 260, "Black trousers": 480, "Black shoes": 880,
  "Trainers": 750, "Waterproof jacket": 420, "Packable waterproof": 420,
  "Summer jumper / light knit": 280,
  "Lightweight jumper": 340, "Mid-weight jumper": 420,
  "Jumper / knitwear": 480, "Heavy knit jumper": 600,
  "Casual jacket / mid-layer": 580,
  "Warm mid-layer": 580, "Heavy coat": 1200, "Base layer top": 180,
  "Casual shorts": 300,
  "Evening chinos / smart trousers": 400,
  "Chinos / smart casual trousers": 400,
  "Jeans / smart trousers": 600,
  "Jeans / insulated trousers": 700,
  "Thermal set (top + bottoms)": 380,
  "Swimwear": 160, "Flip flops": 200,
  "Underwear": 40, "Socks": 55, "Toiletries": 750,
};

const wFmt = (g) => g >= 1000 ? `${(g/1000).toFixed(1)}kg` : `${g}g`;

function buildAdvisory({ totalDays, workDays, mode, band, weather }) {
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
    // ── WORKWEAR SECTION HEADER ────────────────
    cards.push({
      category: "__section_workwear",
      sectionLabel: "Workwear",
      isSection: true,
    });

    // Corporate schedule logic:
    // Rig days (heavy work) → rig t-shirt
    // Rehearsal days → polo
    // Show days → show blacks (handled separately)
    // Load-out → rig t-shirt + shorts
    // Rock & Roll: all rig t-shirts

    if (mode === "corporate") {
      // Estimate day types from workDays
      // Show days: typically last 1–2 work days (1 if ≤3 work days, 2 if more)
      const showDays      = workDays >= 4 ? 2 : workDays >= 2 ? 1 : 0;
      const rehearsalDays = workDays >= 3 ? 1 : 0;
      const rigDays       = Math.max(0, workDays - showDays - rehearsalDays);
      // Load-out: if there are rig days, last rig day is also load-out (already counted)
      // Rig tees: rig days + 1 for load-out day if trip is long enough
      const hasLoadOut    = workDays >= 4;
      const rigTeeDays    = rigDays + (hasLoadOut ? 1 : 0);
      const rigTeeQty     = Math.max(0, Math.ceil(rigTeeDays / 2));
      const poloQty       = rehearsalDays > 0 ? 1 : 0;

      if (rigTeeQty > 0) {
        cards.push({
          category: "Rig t-shirts", qty: rigTeeQty, emoji: "👕",
          reason: hasLoadOut
            ? `Rig days + load-out. ${rigDays} rig day${rigDays !== 1 ? "s" : ""} plus load-out day = ${rigTeeDays} wearing occasions, 2 wears per tee. These are workhorses — wear them hard.`
            : `${rigDays} rig day${rigDays !== 1 ? "s" : ""}, 2 wears per tee.`,
          weight: WEIGHTS["Work t-shirts (rig)"] * rigTeeQty,
        });
      }

      if (poloQty > 0) {
        cards.push({
          category: "Polo shirts", qty: poloQty, emoji: "👔",
          reason: `Rehearsal day${rehearsalDays > 1 ? "s" : ""}. Smarter than a rig tee, cooler than the show blacks. ${poloQty === 1 ? "One is enough." : `${poloQty} covers you.`}`,
          weight: 240 * poloQty,
        });
      }

      if (rigTeeQty === 0 && poloQty === 0) {
        // Very short trip — just a polo
        cards.push({
          category: "Polo shirts", qty: 1, emoji: "👔",
          reason: "Short trip — one polo covers work days.",
          weight: 240,
        });
      }

    } else {
      // Rock & Roll — all rig t-shirts
      const rigTops = Math.ceil(workDays / 2);
      cards.push({
        category: "Rig t-shirts", qty: rigTops, emoji: "👕",
        reason: `${workDays} work day${workDays > 1 ? "s" : ""}, 2 wears per top. ${isHot ? "It's hot — keep it simple." : "Workhorses. Wear them hard."}`,
        weight: WEIGHTS["Work t-shirts (rig)"] * rigTops,
      });
    }

    // BOTTOMS — weather-driven
    const workShortsQty   = Math.max(1, Math.ceil(workDays / 3));
    const workTrousersQty = Math.max(1, Math.ceil(workDays / 2));

    if (isCold) {
      cards.push({
        category: "Work trousers / combats", qty: workTrousersQty, emoji: "👖",
        reason: `It's cold — work shorts stay at home. ${workTrousersQty} pair${workTrousersQty > 1 ? "s" : ""} of combats or work trousers, 2 wears each.`,
        weight: WEIGHTS["Rig trousers"] * workTrousersQty,
      });
    } else if (isCool) {
      cards.push({
        category: "Work trousers / combats", qty: workTrousersQty, emoji: "👖",
        reason: `Cool forecast — trousers over shorts for work. ${workTrousersQty} pair${workTrousersQty > 1 ? "s" : ""}, 2 wears each. Pack shorts too if the rig is heated indoors.`,
        weight: WEIGHTS["Rig trousers"] * workTrousersQty,
      });
      cards.push({
        category: "Work shorts (optional)", qty: 1, emoji: "🩳",
        reason: "One pair if the work environment is warm indoors. Drop them if you don't need both.",
        weight: WEIGHTS["Rig shorts"],
      });
    } else if (isMild || isWarm) {
      cards.push({
        category: "Work shorts", qty: workShortsQty, emoji: "🩳",
        reason: `${workDays} work days, 3 wears per pair. Mild/warm — shorts are the call.`,
        weight: WEIGHTS["Rig shorts"] * workShortsQty,
      });
      cards.push({
        category: "Work trousers / combats", qty: 1, emoji: "👖",
        reason: "One pair of combats in the bag. Colder days, smarter moments, or just a change. Worth the space.",
        weight: WEIGHTS["Rig trousers"],
      });
    } else {
      // Hot
      cards.push({
        category: "Work shorts", qty: workShortsQty, emoji: "🩳",
        reason: `Hot — shorts all the way. 3 wears per pair, ${workShortsQty} pair${workShortsQty > 1 ? "s" : ""} for ${workDays} work days. Leave the trousers at home.`,
        weight: WEIGHTS["Rig shorts"] * workShortsQty,
      });
    }
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

  // ── OFF-DUTY / TRAVEL SHIRTS ─────────────────────────────
  // Rule: target 3 wears per tee (can stretch to 2 if needed).
  // Travel tops (2) are already in the bag and count as shirts.
  // Total pool = ceil(totalDays ÷ 3). Extra shirts = pool − 2 travel tops.
  // No hard cap — 30-day trip needs what it needs.

  const shirtPool        = Math.ceil(totalDays / 3);
  const travelTopCredit  = 2;
  const casualQty        = Math.max(0, shirtPool - travelTopCredit);
  const totalShirts      = casualQty + travelTopCredit;

  const casualReason = casualQty === 0
    ? `${totalDays} days — your 2 travel tops cover it at 3 wears each. No extra shirts needed.`
    : `${totalDays} days needs ${totalShirts} shirts total at 3 wears each. Travel tops are 2 of those — pack ${casualQty} more.${isHot ? " Hot out, so aim for 2 wears max rather than 3." : ""}`;

  cards.push({
    category: "Casual shirts", qty: casualQty, emoji: "👔",
    reason: casualReason,
    weight: WEIGHTS["Casual shirts"] * casualQty,
  });

  cards.push({
    category: "Travel tops", qty: 2, emoji: "✈️",
    reason: `These count as ${travelTopCredit} of your ${totalShirts} total shirts. Outbound top reused on arrival, return top stays fresh.`,
    weight: WEIGHTS["Casual shirts"] * 2,
  });

  // ── CASUAL BOTTOMS — day/evening specific ─────────────────
  const casualBottomDays = mode === "holiday" ? totalDays : casualDays + travelDays;
  const casualBottomQty  = Math.max(1, Math.ceil(casualBottomDays / 3));

  // Shorts for hot/warm, chinos/smart trousers for mild, jeans/warmer for cool/cold
  if (isHot || isWarm) {
    cards.push({
      category: "Casual shorts", qty: casualBottomQty, emoji: "🩳",
      reason: `Shorts for off-hours and travel. 3 wears per pair, ${casualBottomQty} pair${casualBottomQty > 1 ? "s" : ""} covers ${casualBottomDays} casual days.`,
      weight: WEIGHTS["Casual bottoms"] * casualBottomQty,
    });
    // Suggest one pair of evening trousers for smarter dinners
    if (totalDays >= 4) {
      cards.push({
        category: "Evening chinos / smart trousers", qty: 1, emoji: "👖",
        reason: "One pair of smarter trousers for a nicer dinner or a cooler evening. Shorts every night gets old fast.",
        weight: 400,
      });
    }
  } else if (isMild) {
    cards.push({
      category: "Chinos / smart casual trousers", qty: casualBottomQty, emoji: "👖",
      reason: `Mild evenings — chinos or smart casual trousers. 3 wears per pair, ${casualBottomQty} pair${casualBottomQty > 1 ? "s" : ""}. Covers travel and days off smartly.`,
      weight: 400 * casualBottomQty,
    });
  } else if (isCool) {
    cards.push({
      category: "Jeans / smart trousers", qty: casualBottomQty, emoji: "👖",
      reason: `Cool evenings — jeans or smart trousers, ${casualBottomQty} pair${casualBottomQty > 1 ? "s" : ""}. Jeans go 3 wears without question. Warmer and smarter than chinos in the cold.`,
      weight: 600 * casualBottomQty,
    });
  } else if (isCold) {
    cards.push({
      category: "Jeans / insulated trousers", qty: casualBottomQty, emoji: "👖",
      reason: `Cold — heavyweight jeans or lined trousers. ${casualBottomQty} pair${casualBottomQty > 1 ? "s" : ""}. Wear your warmest pair on the plane.`,
      weight: 700 * casualBottomQty,
    });
  }

  // ── JUMPERS — 4 wears per jumper off-duty ────────────────
  // (handled per band in the outerwear section below, but quantity calculated here)

  cards.push({
    category: "Trainers", qty: 1, emoji: "👟",
    reason: (isCold || isCool)
      ? "One pair. Wear your heaviest on the plane — saves bag space."
      : "One pair, full stop. Clean trainers carry evenings and travel.",
    weight: WEIGHTS["Trainers"],
  });

  // ── WORK HOODIE / ZIP — site layer ────────
  if (mode !== "holiday" && workDays > 0 && !isHot) {
    cards.push({
      category: "Work hoodie / zip", qty: 1, emoji: "🤐",
      reason: isWarm
        ? "A lightweight zip for site. Mornings and evenings on the rig can be cooler than you expect. One does the whole trip."
        : isMild
          ? "Site layer — zip or pull-over hoodie over the rig tee or polo. Keeps you warm without getting in the way."
          : "Essential on site. Wear over the rig tee or polo all day if needed.",
      weight: 520,
    });
  }

  // ── WATERPROOF ────────────────────────────
  if (isRain) {
    cards.push({
      category: "Packable waterproof", qty: 1, emoji: "🌧️",
      reason: isHot
        ? "Rain in the heat — a packable shell folds to nothing and saves a soaking."
        : (isMild || isWarm)
          ? "Rain expected — waterproof handles rain and wind. One layer, two jobs."
          : "Wet and cold is the worst combination. Shell on top, everything warm underneath.",
      weight: WEIGHTS["Waterproof jacket"],
    });
  }

  // ── CASUAL EVENING LAYERS — jumpers at 4 wears each ──────
  // Jumper occasions = same as casual shirt off-duty pool
  const jumperOccasions  = mode === "holiday" ? totalDays : (workDays + casualDays + travelDays);
  const jumperQty        = Math.max(1, Math.ceil(jumperOccasions / 4));

  if (isHot) {
    cards.push({
      category: "Summer jumper / light knit", qty: 1, emoji: "🌙",
      reason: "Even in the heat, evenings drop off. A thin cotton or linen knit — looks sharp, weighs nothing. One is all you need.",
      weight: 280,
    });
  }

  if (isWarm) {
    cards.push({
      category: "Lightweight jumper", qty: jumperQty, emoji: "🧥",
      reason: `Warm days, cooler evenings. A merino or fine-knit lightweight jumper. 4 wears each — ${jumperQty} cover${jumperQty === 1 ? "s" : ""} the trip.`,
      weight: 340 * jumperQty,
    });
  }

  if (isMild) {
    cards.push({
      category: "Mid-weight jumper", qty: jumperQty, emoji: "🧶",
      reason: `Mild — a proper mid-weight knit for evenings. 4 wears per jumper, ${jumperQty} for ${jumperOccasions} occasions. Merino if you have it.`,
      weight: 420 * jumperQty,
    });
  }

  if (isCool) {
    cards.push({
      category: "Jumper / knitwear", qty: jumperQty, emoji: "🧶",
      reason: `Cool evenings — a proper knit, ${jumperQty} at 4 wears each. Under a jacket, over a shirt, looks put together.`,
      weight: 480 * jumperQty,
    });
    cards.push({
      category: "Casual jacket / mid-layer", qty: 1, emoji: "🫙",
      reason: "Fleece, light down, or smart bomber over the jumper. Wear on the plane if it's bulky.",
      weight: 580,
    });
  }

  if (isCold) {
    cards.push({
      category: "Heavy knit jumper", qty: jumperQty, emoji: "🧶",
      reason: `A thick knit — wool or heavy merino. Under the coat, over a shirt. ${jumperQty} at 4 wears each covers ${jumperOccasions} off-duty occasions.`,
      weight: 600 * jumperQty,
    });
    cards.push({
      category: "Heavy coat", qty: 1, emoji: "🧥",
      reason: "Wear it on the plane — heaviest single item, costs nothing in bag space if it's on your back.",
      weight: WEIGHTS["Heavy coat"],
    });
    cards.push({
      category: "Base layer top", qty: 1, emoji: "🧤",
      reason: "Thin merino thermal under everything. One is enough — merino handles 3+ wears without issue.",
      weight: WEIGHTS["Base layer top"],
    });
  }

  // ── THERMALS — avg temp at or below 0°C ──────────────────
  if (weather && weather.avgTemp <= 0) {
    cards.push({
      category: "Thermal set (top + bottoms)", qty: 1, emoji: "🌡️",
      reason: `Average temperature is ${weather.avgTemp}°C — proper thermals under everything, not just a base layer top. A thermal top and long-john bottoms. Merino or synthetic, worn every day under your clothes.`,
      weight: 380,
    });
  }

  // ── SWIM / HOT WEATHER SECTION ────────────────────────────
  if (isHot || isWarm) {
    cards.push({
      category: "__section_swim",
      sectionLabel: "Sun & Water",
      isSection: true,
    });
    cards.push({
      category: "Swimwear", qty: 1, emoji: "🩱",
      reason: isHot
        ? "It's hot. Pool, beach, rooftop — you'll want it. Weighs nothing."
        : "Warm enough that a pool or beach is on the cards. One pair, takes up no space.",
      weight: WEIGHTS["Swimwear"],
    });
    cards.push({
      category: "Flip flops", qty: 1, emoji: "🩴",
      reason: "Pool, beach, hotel room, hosing down after a hot day. A pair of Havaianas weighs 200g and earns its place every time.",
      weight: 200,
    });
  }

  const TOILETRY_OPTIONS = {
    mini:    { label: "Mini bag",      desc: "Day bag / personal item. Basics only — deodorant, toothbrush, cleanser. No liquids over 30ml.", weight: 280, emoji: "🧴" },
    carryon: { label: "Carry-on bag",  desc: "100ml liquids rule. Pre-packed with refillable bottles, solid deodorant, mini toothpaste. Never repack from scratch — keep it ready to go.", weight: 650, emoji: "🪥" },
    full:    { label: "Full wash bag", desc: "Checked luggage — no restrictions. Full-size everything. Only worth it if you're checking in anyway.", weight: 1400, emoji: "🛁" },
  };

  cards.push({
    category: "Toiletry bag",
    isToletryCta: true,
    emoji: "🪥",
    options: TOILETRY_OPTIONS,
    weight: 0,
    qty: 1,
    reason: "",
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
  const [toiletryBag, setToiletryBag] = useState("carryon");

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
  const { cards } = buildAdvisory({ totalDays, workDays: mode === "holiday" ? 0 : workDays, mode, band, weather });

  const TOILETRY_WEIGHTS = { mini: 280, carryon: 650, full: 1400 };

  const displayCards = cards.map(c => {
    if (c.isToletryCta) return { ...c, weight: TOILETRY_WEIGHTS[toiletryBag] };
    return {
      ...c,
      qty:    c.isSection ? 0 : (overrides[c.category] ?? c.qty),
      weight: c.isSection ? 0 : ((WEIGHTS[c.category] || 200) * (overrides[c.category] ?? c.qty)),
    };
  });

  const packableCards = displayCards.filter(c => !c.isSection);
  const totalKg       = (packableCards.reduce((s,c) => s + c.weight, 0) / 1000).toFixed(1);
  const checkedCount  = packableCards.filter(c => checked[c.category]).length;
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
          {packMode ? `${checkedCount} / ${packableCards.length}` : ""}
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
            {packMode ? `Packing — ${checkedCount} of ${packableCards.length}` : "What I'd pack"}
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
            <div style={{ height: "100%", width: `${(checkedCount / packableCards.length) * 100}%`, background: t.accent, transition: "width 0.3s" }} />
          </div>
        )}

        {/* Cards */}
        <div style={{ display: "grid", gap: 1, borderTop: `1px solid ${t.border}` }}>
          {displayCards.map((card) => {
            // Section divider
            if (card.isSection) {
              return (
                <div key={card.category} style={{ padding: "28px 0 10px" }}>
                  <span style={{
                    fontFamily: "system-ui, sans-serif", fontSize: 10,
                    color: t.accent, letterSpacing: "2px", textTransform: "uppercase",
                    fontWeight: 600,
                  }}>{card.sectionLabel}</span>
                </div>
              );
            }

            // Toiletry bag picker
            if (card.isToletryCta) {
              const opts = card.options;
              return (
                <div key="toiletry" style={{ borderBottom: `1px solid ${t.border}`, padding: "20px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
                    <span style={{ fontSize: 20 }}>🪥</span>
                    <span style={{ fontSize: 18, fontWeight: 400 }}>Toiletry bag</span>
                    <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 11, color: t.muted, marginLeft: "auto" }}>
                      ~{wFmt(TOILETRY_WEIGHTS[toiletryBag])}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {Object.entries(opts).map(([key, opt]) => (
                      <button key={key} onClick={() => setToiletryBag(key)} style={{
                        padding: "8px 16px", borderRadius: 6, cursor: "pointer",
                        fontFamily: "system-ui, sans-serif", fontSize: 12, letterSpacing: "0.3px",
                        border: `1px solid ${toiletryBag === key ? t.accent : t.border}`,
                        background: toiletryBag === key ? t.accentLight : "transparent",
                        color: toiletryBag === key ? t.accent : t.muted,
                        transition: "all 0.15s",
                      }}>
                        {opt.emoji} {opt.label}
                      </button>
                    ))}
                  </div>
                  {!packMode && (
                    <p style={{ margin: "8px 0 0", fontSize: 13, color: t.muted, lineHeight: 1.6, fontStyle: "italic", fontWeight: 300 }}>
                      {opts[toiletryBag].desc}
                    </p>
                  )}
                </div>
              );
            }

            const isDone = !!checked[card.category];
            const isOverrideWarnLow  = card.category === "Casual shirts" && card.qty < 3 && card.qty > 0;

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

                    {/* Casual shirt low warning */}
                    {!packMode && isOverrideWarnLow && (
                      <p style={{ margin: "6px 0 0", fontSize: 13, color: "#92400E", lineHeight: 1.55, fontStyle: "italic", fontWeight: 300 }}>
                        Under 3 is pushing it. Laundry mid-trip or repeating in mixed company. Your call.
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
