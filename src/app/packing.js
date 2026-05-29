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
  if (!weather) return "mild"; // sensible default
  const { avgTemp, maxTemp, rainChance } = weather;
  const rain = rainChance >= 40;
  // Band driven by avgTemp — pack for what you'll actually feel, not just the peak.
  // maxTemp is used separately to trigger hot-weather extras (swimwear etc).
  if (avgTemp >= 22) return rain ? "hot_wet"  : "hot";
  if (avgTemp >= 15) return rain ? "warm_wet" : "warm";
  if (avgTemp >= 10) return rain ? "mild_wet" : "mild";
  if (avgTemp >= 4)  return rain ? "cool_wet" : "cool";
  return rain ? "cold_wet" : "cold";
}

const WEIGHTS = {
  // Calibrated from real packs (XL sizing):
  // Workwear: 5 rig tees+3 shorts+cargo+hoodie+padded jacket+10 socks = 4700g
  // Casual: 2 tees+2 polos+2 shorts+windbreaker+merino = 2900g
  // UW: 20 boxers+swim shorts = 1750g. Shoes: sambas+flip flops = 1000g
  "Underwear & socks":              135,  // 75g boxer + 60g socks per day
  "Underwear":                       75,
  "Socks":                           60,

  "Rig t-shirts":                   260,
  "Work t-shirts (rig)":            260,
  "Polo shirts":                    280,
  "Work shorts":                    320,
  "Work shorts (optional)":         320,
  "Rig shorts":                     320,
  "Work trousers / combats":        500,
  "Work trousers / combats (1 pair)": 500,
  "Rig trousers":                   500,
  "Work hoodie / zip":              580,

  "Black shirt":                    260,
  "Black trousers":                 480,
  "Black shoes":                    880,

  "Casual shirts":                  240,
  "Travel tops":                    240,
  "Casual bottoms":                 300,
  "Casual shorts":                  300,
  "Chinos / smart casual trousers": 400,
  "Evening chinos / smart trousers": 400,
  "Jeans / smart trousers":         620,
  "Jeans / insulated trousers":     700,

  "Trainers":                       800,
  "Flip flops":                     200,

  "Packable waterproof":            380,
  "Waterproof jacket":              380,
  "Casual jacket / mid-layer":      480,
  "Warm mid-layer":                 480,
  "Heavy coat":                     1200,

  "Light knit / summer jumper":     240,
  "Summer jumper / light knit":     240,
  "Lightweight jumper":             320,
  "Mid-weight jumper":              420,
  "Thick knit / chunky jumper":     480,
  "Jumper / knitwear":              480,
  "Heavy knit jumper":              580,

  "Base layer top":                 160,
  "Thermal set (top + bottoms)":    360,

  "Swimwear":                       250,
  "Toiletries":                     750,
};

const wFmt = (g) => g >= 1000 ? `${(g/1000).toFixed(1)}kg` : `${g}g`;

function buildAdvisory({ totalDays, workDays, mode, band, weather }) {
  const travelDays  = totalDays >= 2 ? 2 : 1;
  const casualDays  = Math.max(0, totalDays - workDays - travelDays);
  const offDutyDays = casualDays + travelDays; // days not in work mode

  const isRain = band.includes("wet");
  const isHot  = band.startsWith("hot");
  const isWarm = band.startsWith("warm");
  const isMild = band.startsWith("mild");
  const isCool = band.startsWith("cool");
  const isCold = band.startsWith("cold");

  const cards = [];

  // ── UNDERWEAR & SOCKS ─────────────────────────────────────
  // 1 per day, always. Non-negotiable.
  cards.push({
    category: "Underwear & socks", qty: totalDays, emoji: "🩲",
    reason: "One per day. Non-negotiable — no frequency traveller trick gets around this one.",
    weight: (WEIGHTS["Underwear"] + WEIGHTS["Socks"]) * totalDays,
  });

  // ── WORKWEAR ──────────────────────────────────────────────
  if (mode !== "holiday" && workDays > 0) {
    cards.push({ category: "__section_workwear", sectionLabel: "Workwear", isSection: true });

    // TOPS
    // Rig t-shirts: ALL modes with work days. Rule: ceil(workDays ÷ 2)
    const rigTeeQty = Math.ceil(workDays / 2);
    cards.push({
      category: "Rig t-shirts", qty: rigTeeQty, emoji: "👕",
      reason: `${workDays} work day${workDays > 1 ? "s" : ""} ÷ 2 wears = ${rigTeeQty} tee${rigTeeQty > 1 ? "s" : ""}. ${isHot ? "Hot — a rig tee is all you need all day." : "Workhorses. Wear them hard, wash when you can."}`,
      weight: WEIGHTS["Work t-shirts (rig)"] * rigTeeQty,
    });

    // Polo shirts: Corporate only, for rehearsal days
    // Rehearsal days = 1 if workDays ≥ 3, else 0
    if (mode === "corporate" && workDays >= 3) {
      const rehearsalDays = 1;
      const poloQty = Math.ceil(rehearsalDays / 2);
      cards.push({
        category: "Polo shirts", qty: poloQty, emoji: "👔",
        reason: "Rehearsal day — smarter than a rig tee, cooler than the show blacks. One polo covers it. 2 wears if needed.",
        weight: 240 * poloQty,
      });
    }

    // BOTTOMS — weather drives shorts vs trousers, wear rules confirmed:
    // Shorts: max 3 wears. Trousers/smarts: max 2 wears.
    const shortsDays    = Math.ceil(workDays / 3);
    const trousersDays  = Math.ceil(workDays / 2);

    if (isHot) {
      // Hot: shorts only, no trousers
      cards.push({
        category: "Work shorts", qty: shortsDays, emoji: "🩳",
        reason: `${workDays} work days, 3 wears per pair = ${shortsDays} pair${shortsDays > 1 ? "s" : ""}. Hot — shorts all the way, leave trousers at home.`,
        weight: WEIGHTS["Rig shorts"] * shortsDays,
      });
    } else if (isWarm || isMild) {
      // Warm/mild: shorts main, one pair of combats in case
      cards.push({
        category: "Work shorts", qty: shortsDays, emoji: "🩳",
        reason: `${workDays} work days, 3 wears per pair = ${shortsDays} pair${shortsDays > 1 ? "s" : ""}. ${isWarm ? "Warm" : "Mild"} — shorts are the call on site.`,
        weight: WEIGHTS["Rig shorts"] * shortsDays,
      });
      cards.push({
        category: "Work trousers / combats", qty: 1, emoji: "👖",
        reason: "One pair of combats. Colder days, smarter moments, load-in with kit. Worth the space every time.",
        weight: WEIGHTS["Rig trousers"],
      });
    } else if (isCool) {
      // Cool: trousers main, shorts optional if rig is heated
      cards.push({
        category: "Work trousers / combats", qty: trousersDays, emoji: "👖",
        reason: `${workDays} work days, 2 wears per pair = ${trousersDays} pair${trousersDays > 1 ? "s" : ""}. Cool forecast — trousers over shorts on site.`,
        weight: WEIGHTS["Rig trousers"] * trousersDays,
      });
      cards.push({
        category: "Work shorts (optional)", qty: 1, emoji: "🩳",
        reason: "One pair in the bag if the venue is warm indoors. Drop them if the forecast doesn't warm up.",
        weight: WEIGHTS["Rig shorts"],
      });
    } else {
      // Cold: trousers only
      cards.push({
        category: "Work trousers / combats", qty: trousersDays, emoji: "👖",
        reason: `${workDays} work days, 2 wears per pair = ${trousersDays} pair${trousersDays > 1 ? "s" : ""}. ${isCold ? "Cold — shorts stay at home." : "Go with trousers as the safe bet."}`,
        weight: WEIGHTS["Rig trousers"] * trousersDays,
      });
    }

    // Work hoodie / zip — site layer, not an evening layer
    if (!isHot) {
      cards.push({
        category: "Work hoodie / zip", qty: 1, emoji: "🤐",
        reason: isWarm
          ? "A lightweight zip for site. Mornings on the rig can catch you out. One does the whole trip."
          : isMild
            ? "Site layer over the rig tee or polo. Keeps you warm without getting in the way."
            : "Essential on site. Wear all day if needed — heavy enough for the work environment, light enough to ditch.",
        weight: 520,
      });
    }

    // Show blacks — corporate only, 2 wears per set
    if (mode === "corporate") {
      const showQty = workDays > 4 ? 2 : 1;
      cards.push({
        category: "Show blacks", qty: showQty, emoji: "🖤",
        reason: showQty === 1
          ? "One set — black shirt, black trousers, black shoes. Two wears across the trip. No one will know."
          : "Two sets for the longer run. Still 2 wears from each.",
        weight: (WEIGHTS["Black shirt"] + WEIGHTS["Black trousers"] + WEIGHTS["Black shoes"]) * showQty,
        items: showQty === 1
          ? ["Black shirt ×1", "Black trousers ×1", "Black shoes ×1"]
          : ["Black shirt ×2", "Black trousers ×2", "Black shoes ×1"],
      });
    }
  }

  // ── CASUAL / OFF-DUTY ────────────────────────────────────
  // Corporate: evenings count as casual — pool = totalDays ÷ 3
  // Rock & Roll: binary — work days = rig tees only, days off = casual shirts only
  //   pool = (totalDays - workDays) ÷ 3
  // Holiday: every day is casual — totalDays ÷ 3
  // Travel tops (2) always count in the pool. No cap.

  const casualDaysPool = mode === "rockroll"
    ? Math.max(0, totalDays - workDays)
    : totalDays;

  const shirtPool    = Math.ceil(casualDaysPool / 3);
  const casualQty    = Math.max(0, shirtPool - 2);
  const totalShirts  = casualQty + 2;

  const shirtNote = isHot ? ` Hot — aim for 2 wears not 3 if you're sweating.` : "";
  const poolLabel = mode === "rockroll"
    ? `${totalDays - workDays} days off`
    : `${totalDays} days`;

  // ── CASUAL WEAR SECTION ───────────────────────────────────
  cards.push({ category: "__section_casual", sectionLabel: "Casual Wear", isSection: true });

  cards.push({
    category: "Casual shirts", qty: casualQty, emoji: "👔",
    reason: casualQty === 0
      ? `${poolLabel} — your 2 travel tops cover it at 3 wears each. No extra shirts needed.${shirtNote}`
      : `${poolLabel} ÷ 3 wears = ${shirtPool} shirts total. Travel tops are 2 of those — pack ${casualQty} more.${shirtNote}`,
    weight: WEIGHTS["Casual shirts"] * casualQty,
  });

  cards.push({
    category: "Travel tops", qty: 2, emoji: "✈️",
    reason: `These are 2 of your ${totalShirts} total casual tops — pick whatever works: t-shirt, polo, or smart top. Outbound reused once after arrival. Return stays fresh for the journey home.`,
    weight: WEIGHTS["Travel tops"] * 2,
  });

  // CASUAL BOTTOMS — 3 wears per pair. Weather drives type.
  const bottomQty = Math.max(1, Math.ceil(offDutyDays / 3));

  if (isHot || isWarm) {
    cards.push({
      category: "Casual shorts", qty: bottomQty, emoji: "🩳",
      reason: `${offDutyDays} off-duty days, 3 wears per pair = ${bottomQty} pair${bottomQty > 1 ? "s" : ""}.`,
      weight: WEIGHTS["Rig shorts"] * bottomQty,
    });
    if (totalDays >= 4) {
      cards.push({
        category: "Evening chinos / smart trousers", qty: 1, emoji: "👖",
        reason: "One smarter pair for nicer dinners or cooler evenings. Shorts every night gets old fast.",
        weight: 400,
      });
    }
  } else if (isMild) {
    cards.push({
      category: "Chinos / smart casual trousers", qty: bottomQty, emoji: "👖",
      reason: `${offDutyDays} off-duty days, 3 wears per pair = ${bottomQty} pair${bottomQty > 1 ? "s" : ""}. Chinos are the move — casual enough for travel, smart enough for dinner.`,
      weight: 400 * bottomQty,
    });
  } else if (isCool) {
    cards.push({
      category: "Jeans / smart trousers", qty: bottomQty, emoji: "👖",
      reason: `${offDutyDays} off-duty days, 3 wears per pair = ${bottomQty} pair${bottomQty > 1 ? "s" : ""}. Jeans go 3 wears without question. Warmer and smarter than chinos in the cool.`,
      weight: 600 * bottomQty,
    });
  } else if (isCold) {
    cards.push({
      category: "Jeans / insulated trousers", qty: bottomQty, emoji: "👖",
      reason: `${offDutyDays} off-duty days, 3 wears per pair = ${bottomQty} pair${bottomQty > 1 ? "s" : ""}. Heavyweight jeans or lined trousers. Wear your warmest pair on the plane.`,
      weight: 700 * bottomQty,
    });
  } else {
    // Unknown / mild default
    cards.push({
      category: "Casual bottoms", qty: bottomQty, emoji: "👖",
      reason: `${offDutyDays} off-duty days, 3 wears per pair = ${bottomQty} pair${bottomQty > 1 ? "s" : ""}.`,
      weight: WEIGHTS["Casual bottoms"] * bottomQty,
    });
  }

  // TRAINERS — one pair, always
  cards.push({
    category: "Trainers", qty: 1, emoji: "👟",
    reason: isCold || isCool
      ? "One pair. Wear your heaviest on the plane — saves bag space."
      : "One pair. Clean trainers do evenings, travel, and casual days without a second pair.",
    weight: WEIGHTS["Trainers"],
  });

  // ── LAYERS & OUTERWEAR ────────────────────────────────────
  cards.push({ category: "__section_layers", sectionLabel: "Layers & Outerwear", isSection: true });

  // Waterproof — rain flag
  if (isRain) {
    cards.push({
      category: "Packable waterproof", qty: 1, emoji: "🌧️",
      reason: isHot
        ? "Rain in the heat — a packable shell folds to nothing and saves a soaking."
        : (isMild || isWarm)
          ? "Rain expected — handles both rain and wind. One layer, two jobs."
          : "Wet and cold is the worst combination. Shell on top, warm layers underneath.",
      weight: WEIGHTS["Packable waterproof"],
    });
  }

  // JUMPERS — same pool as casual shirts but ÷ 4 wears each.
  // Corporate: totalDays (wear evenings on work days too)
  // R&R: days off only (same as casualDaysPool)
  // Holiday: totalDays
  const jumperQty = Math.max(1, Math.ceil(casualDaysPool / 4));

  if (isHot) {
    cards.push({
      category: "Light knit / summer jumper", qty: 1, emoji: "🌙",
      reason: "Thin cotton or linen knit — 200–300g. Evenings drop off even in the heat. Looks sharp over a shirt, weighs nothing in the bag.",
      weight: 280,
    });
  } else if (isWarm) {
    cards.push({
      category: "Lightweight jumper", qty: jumperQty, emoji: "🧶",
      reason: `${totalDays} days ÷ 4 wears = ${jumperQty} jumper${jumperQty > 1 ? "s" : ""}. Fine-knit merino or cotton, ~300–400g. Warm days but evenings cool off — this handles it without bulk.`,
      weight: 340 * jumperQty,
    });
  } else if (isMild) {
    cards.push({
      category: "Mid-weight jumper", qty: jumperQty, emoji: "🧶",
      reason: `${totalDays} days ÷ 4 wears = ${jumperQty} jumper${jumperQty > 1 ? "s" : ""}. Mid-weight merino or wool blend, ~400–500g. Proper warmth for mild evenings, smart enough for dinner.`,
      weight: 420 * jumperQty,
    });
  } else if (isCool) {
    cards.push({
      category: "Thick knit / chunky jumper", qty: jumperQty, emoji: "🧶",
      reason: `${totalDays} days ÷ 4 wears = ${jumperQty} jumper${jumperQty > 1 ? "s" : ""}. Chunky wool or heavy merino, ~500–600g. Goes under a jacket on the coldest evenings, stands alone on milder ones.`,
      weight: 480 * jumperQty,
    });
    cards.push({
      category: "Casual jacket / mid-layer", qty: 1, emoji: "🫙",
      reason: "Fleece, light down, or smart bomber over the jumper. Wear on the plane — costs nothing in bag space.",
      weight: 580,
    });
  } else if (isCold) {
    cards.push({
      category: "Heavy knit jumper", qty: jumperQty, emoji: "🧶",
      reason: `${totalDays} days ÷ 4 wears = ${jumperQty} jumper${jumperQty > 1 ? "s" : ""}. Heavy wool or thick merino, 600g+. Under the coat, over a shirt — good for an evening indoors without needing the coat on.`,
      weight: 600 * jumperQty,
    });
    cards.push({
      category: "Heavy coat", qty: 1, emoji: "🧥",
      reason: "Wear it on the plane — heaviest single item, costs nothing in bag space if it's on your back.",
      weight: WEIGHTS["Heavy coat"],
    });
    cards.push({
      category: "Base layer top", qty: 1, emoji: "🧤",
      reason: "Thin merino thermal under everything. Merino handles 3+ wears without smelling.",
      weight: WEIGHTS["Base layer top"],
    });
  }

  // Thermals — when avg temp ≤ 0°C
  if (weather && weather.avgTemp <= 0) {
    cards.push({
      category: "Thermal set (top + bottoms)", qty: 1, emoji: "🌡️",
      reason: `Average temperature is ${weather.avgTemp}°C. Proper thermals — a top and long-john bottoms — worn every day under your clothes. Merino or synthetic, non-negotiable at these temperatures.`,
      weight: 380,
    });
  }

  // ── SUN & WATER ── triggered by maxTemp not band ──────────
  const hotDays = weather && weather.maxTemp >= 24;
  if (hotDays) {
    cards.push({ category: "__section_swim", sectionLabel: "Sun & Water", isSection: true });
    cards.push({
      category: "Swimwear", qty: 1, emoji: "🩱",
      reason: `Max ${weather.maxTemp}°C — pool, beach, or rooftop is on the cards. Takes up no space.`,
      weight: WEIGHTS["Swimwear"],
    });
    cards.push({
      category: "Flip flops", qty: 1, emoji: "🩴",
      reason: "Pool, beach, hotel room. A pair of Havaianas weighs 200g and earns its place every time.",
      weight: 200,
    });
  }

  // ── TOILETRY BAG ──────────────────────────────────────────
  const TOILETRY_OPTIONS = {
    carryon: { label: "Carry-on wash bag",  desc: "100ml liquids rule. Pre-packed refillable bottles, solid deodorant, mini toothpaste. Keep it ready to go — never repack from scratch.", weight: 650, emoji: "🪥" },
    full:    { label: "Full wash bag", desc: "Checked luggage — no restrictions. Full-size everything. Only worth it if you're checking in anyway.", weight: 1400, emoji: "🛁" },
  };
  cards.push({
    category: "Toiletry bag", isToletryCta: true, emoji: "🪥",
    options: TOILETRY_OPTIONS, weight: 0, qty: 1, reason: "",
  });

  return { cards };
}

// ─────────────────────────────────────────────
// THEMES — elevated, editorial
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// TRAVEL DAY OUTFIT ADVISORY
// What to wear to the airport — counts toward
// the packing list but doesn't go in the bag.
// ─────────────────────────────────────────────
function getTravelDayOutfit({ band, mode, weather }) {
  const isHot  = band.startsWith("hot");
  const isWarm = band.startsWith("warm");
  const isMild = band.startsWith("mild");
  const isCool = band.startsWith("cool");
  const isCold = band.startsWith("cold");
  const isRain = band.includes("wet");

  const outfit = [];
  const notes  = [];

  // TOP — wears maps to packing list category
  if (isHot || isWarm) {
    outfit.push({ item: "Travel top (t-shirt or polo)", emoji: "👕", wears: "Travel tops" });
    notes.push("Light, breathable — airports are warm and you'll be moving.");
  } else if (isMild) {
    outfit.push({ item: "Travel top (t-shirt or smart top)", emoji: "👕", wears: "Travel tops" });
    outfit.push({ item: "Mid-weight jumper over the top", emoji: "🧶", wears: "Mid-weight jumper" });
    notes.push("Jumper on for the journey, easy to ditch if the airport is hot.");
  } else if (isCool) {
    outfit.push({ item: "Travel top", emoji: "👕", wears: "Travel tops" });
    outfit.push({ item: "Thick knit jumper", emoji: "🧶", wears: "Thick knit / chunky jumper" });
    notes.push("Layer up — you can always remove it through security.");
  } else if (isCold) {
    outfit.push({ item: "Base layer top", emoji: "🧤", wears: "Base layer top" });
    outfit.push({ item: "Heavy knit jumper", emoji: "🧶", wears: "Heavy knit jumper" });
    outfit.push({ item: "Heavy coat", emoji: "🧥", wears: "Heavy coat" });
    notes.push("Wear the coat — heaviest item, costs nothing on your back.");
  }

  // BOTTOM
  if (isHot || isWarm) {
    outfit.push({ item: "Casual shorts or chinos", emoji: "🩳", wears: "Casual shorts" });
  } else if (isMild || isCool) {
    outfit.push({ item: "Chinos or jeans", emoji: "👖", wears: "Chinos / smart casual trousers" });
    notes.push("Jeans are heavy — wear them, don't pack them.");
  } else if (isCold) {
    outfit.push({ item: "Jeans or insulated trousers", emoji: "👖", wears: "Jeans / insulated trousers" });
    notes.push("Wear your heaviest trousers — saves 600–700g in the bag.");
  }

  // SHOES — always worn
  if (isHot || isWarm) {
    outfit.push({ item: "Trainers (Sambas etc)", emoji: "👟", wears: "Trainers" });
  } else {
    outfit.push({ item: "Trainers — your heaviest pair", emoji: "👟", wears: "Trainers" });
    notes.push("Always wear the heaviest shoes. 800g saved in the bag.");
  }

  // RAIN
  if (isRain) {
    outfit.push({ item: "Packable waterproof in your day bag", emoji: "🌧️", wears: "Packable waterproof" });
    notes.push("Keep the waterproof accessible — not buried.");
  }

  const wornWeight = isCold
    ? "~2.5kg worn rather than packed (coat, jumper, jeans, trainers)"
    : isCool ? "~1.8kg worn rather than packed (jumper, jeans, trainers)"
    : isMild ? "~1.4kg worn rather than packed (jumper, chinos, trainers)"
    : "~1kg worn rather than packed (trainers + bottoms)";

  // Build worn map: category → count worn on travel day
  const wornMap = {};
  outfit.forEach(o => {
    if (o.wears) wornMap[o.wears] = (wornMap[o.wears] || 0) + 1;
  });

  return { outfit, notes, wornWeight, wornMap };
}

// ─────────────────────────────────────────────
// PACKING CUBES
// ─────────────────────────────────────────────
const CUBE_ASSIGNMENTS = {
  // Cube 1 — Workwear (grab the whole cube for site days)
  "Rig t-shirts":              { cube: 1, label: "Workwear", emoji: "🧱", note: "Site days" },
  "Polo shirts":               { cube: 1, label: "Workwear", emoji: "🧱", note: "Site days" },
  "Work shorts":               { cube: 1, label: "Workwear", emoji: "🧱", note: "Site days" },
  "Work shorts (optional)":    { cube: 1, label: "Workwear", emoji: "🧱", note: "Site days" },
  "Work trousers / combats":   { cube: 1, label: "Workwear", emoji: "🧱", note: "Site days" },
  "Work hoodie / zip":         { cube: 1, label: "Workwear", emoji: "🧱", note: "Site days" },

  // Cube 2 — Casual / Off-duty
  "Casual shirts":             { cube: 2, label: "Casual", emoji: "👜", note: "Evenings & days off" },
  "Travel tops":               { cube: 2, label: "Casual", emoji: "👜", note: "Evenings & days off" },
  "Casual shorts":             { cube: 2, label: "Casual", emoji: "👜", note: "Evenings & days off" },
  "Casual bottoms":            { cube: 2, label: "Casual", emoji: "👜", note: "Evenings & days off" },
  "Chinos / smart casual trousers": { cube: 2, label: "Casual", emoji: "👜", note: "Evenings & days off" },
  "Evening chinos / smart trousers": { cube: 2, label: "Casual", emoji: "👜", note: "Evenings & days off" },
  "Jeans / smart trousers":    { cube: 2, label: "Casual", emoji: "👜", note: "Evenings & days off" },
  "Jeans / insulated trousers":{ cube: 2, label: "Casual", emoji: "👜", note: "Evenings & days off" },

  // Cube 3 — Underwear & Socks (one-use items, easy to track)
  "Underwear & socks":         { cube: 3, label: "Underwear & Socks", emoji: "🩲", note: "One use — repack dirty separately" },

  // Cube 4 — Layers (compressible cube, squash when not needed)
  "Light knit / summer jumper":{ cube: 4, label: "Layers", emoji: "🗜️", note: "Compressible cube" },
  "Lightweight jumper":        { cube: 4, label: "Layers", emoji: "🗜️", note: "Compressible cube" },
  "Mid-weight jumper":         { cube: 4, label: "Layers", emoji: "🗜️", note: "Compressible cube" },
  "Thick knit / chunky jumper":{ cube: 4, label: "Layers", emoji: "🗜️", note: "Compressible cube" },
  "Heavy knit jumper":         { cube: 4, label: "Layers", emoji: "🗜️", note: "Compressible cube" },
  "Casual jacket / mid-layer": { cube: 4, label: "Layers", emoji: "🗜️", note: "Compressible cube" },
  "Packable waterproof":       { cube: 4, label: "Layers", emoji: "🗜️", note: "Compressible cube" },
  "Base layer top":            { cube: 4, label: "Layers", emoji: "🗜️", note: "Compressible cube" },
  "Thermal set (top + bottoms)":{ cube: 4, label: "Layers", emoji: "🗜️", note: "Compressible cube" },

  // Outside cubes — specific handling
  "Show blacks":               { cube: 0, label: "Hang or fold flat", emoji: "🖤", note: "Outside cubes — avoid creasing" },
  "Heavy coat":                { cube: 0, label: "Wear on plane", emoji: "🧥", note: "On your back — free bag weight" },
  "Trainers":                  { cube: 0, label: "Shoe bag — base of bag", emoji: "👟", note: "Sole to sole in a shoe bag" },
  "Flip flops":                { cube: 0, label: "Shoe bag — base of bag", emoji: "🩴", note: "With trainers at the bottom" },
  "Swimwear":                  { cube: 0, label: "Top pocket / outer zip", emoji: "🩱", note: "Quick access" },
  "Toiletry bag":              { cube: 0, label: "Top pocket / outer zip", emoji: "🪥", note: "Quick access at security" },
};

function buildCubes(packableCards, confirmedWornMap = {}) {
  const cubes = { 1: [], 2: [], 3: [], 4: [], 0: [] };
  packableCards.forEach(card => {
    if (card.isToletryCta) return;
    // packedQty is already baked into displayCards — just use it
    const packedQty = card.packedQty ?? card.qty;
    if (packedQty === 0) return; // fully worn or zero — skip
    const assignment = CUBE_ASSIGNMENTS[card.category];
    const cubeId = assignment ? assignment.cube : 2;
    const label  = assignment ? assignment.label : "Casual";
    const emoji  = assignment ? assignment.emoji : "👜";
    const note   = assignment ? assignment.note : "";
    cubes[cubeId].push({ ...card, qty: packedQty, cubeLabel: label, cubeEmoji: emoji, cubeNote: note });
  });
  cubes[0].push({
    category: "Toiletry bag", qty: 1, emoji: "🪥",
    cubeLabel: "Top pocket / outer zip", cubeNote: "Quick access at security",
  });
  return cubes;
}

const CUBE_META = {
  1: { label: "Cube 1 — Workwear",         colour: "#1A3A1A", desc: "Grab the whole cube on site days. Leave it in the bag on days off." },
  2: { label: "Cube 2 — Casual",           colour: "#2C3E6B", desc: "Evenings and days off. Swap with the workwear cube when the rig's done." },
  3: { label: "Cube 3 — Underwear & Socks",colour: "#5C3A1A", desc: "One use each. When empty you're nearly home. Repack dirty in a separate bag." },
  4: { label: "Cube 4 — Layers",           colour: "#3A1A5C", desc: "Use a compressible cube. Squash it flat in warm weather, expand when it gets cold." },
  0: { label: "Outside the cubes",          colour: "#4A4A4A", desc: "Specific placement — read the notes." },
};

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
  const [view, setView]             = useState("list");
  const [cubeChecked, setCubeChecked] = useState({});
  const [kitWeight, setKitWeight]   = useState(0);
  const [travelWorn, setTravelWorn] = useState({});
  const [bagChoice, setBagChoice]   = useState("tumi");
  const [dayBagChecked, setDayBagChecked] = useState({});
  const [dayBagOptional, setDayBagOptional] = useState({ ipad: false, pencil: false, kindle: false, eyemask: false, snacks: false });
  const [saveModal, setSaveModal]   = useState(false);
  const [saveName, setSaveName]     = useState("");
  const [saveEmail, setSaveEmail]   = useState("");
  const [saveStatus, setSaveStatus] = useState(""); // "" | "saving" | "sent" | "error"
  const [loadedName, setLoadedName] = useState(""); // "backpack" | "tumi" | "checked" // category → true if confirmed worn

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!destination.trim()) return;
      setWxStatus("Looking up weather…");
      // Don't reset weather/cityRows here — keep showing previous data while refetching
      // so the packing list doesn't flicker or collapse
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

  // ── SAVE / RESTORE ───────────────────────────────────────
  // Serialise current settings to a plain object
  const getState = () => ({
    totalDays, workDays, mode, destination, kitWeight, bagChoice,
    overrides, toiletryBag, dayBagOptional,
  });

  const applyState = (s) => {
    if (s.totalDays)    setTotalDays(s.totalDays);
    if (s.workDays !== undefined) setWorkDays(s.workDays);
    if (s.mode)         setMode(s.mode);
    if (s.destination)  setDest(s.destination);
    if (s.kitWeight !== undefined) setKitWeight(s.kitWeight);
    if (s.bagChoice)    setBagChoice(s.bagChoice);
    if (s.overrides)    setOverrides(s.overrides);
    if (s.toiletryBag)  setToiletryBag(s.toiletryBag);
    if (s.dayBagOptional) setDayBagOptional(s.dayBagOptional);
  };

  // Load from token on mount, then fall back to localStorage
  useEffect(() => {
    async function load() {
      try {
        // Check URL for token
        const params = new URLSearchParams(window.location.search);
        const token = params.get("token");
        if (token) {
          const res = await fetch(`/api/load?token=${token}`);
          if (res.ok) {
            const data = await res.json();
            applyState(data.state);
            setLoadedName(data.name);
            // Save to localStorage too
            localStorage.setItem("roadiepack_state", JSON.stringify({ ...data.state, name: data.name }));
            return;
          }
        }
        // Fall back to localStorage
        const saved = localStorage.getItem("roadiepack_state");
        if (saved) {
          const parsed = JSON.parse(saved);
          applyState(parsed);
          if (parsed.name) setLoadedName(parsed.name);
        }
      } catch (e) {
        console.log("Load error:", e);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save to localStorage whenever key state changes
  useEffect(() => {
    try {
      const s = { ...getState(), name: loadedName };
      localStorage.setItem("roadiepack_state", JSON.stringify(s));
    } catch (e) {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalDays, workDays, mode, destination, kitWeight, bagChoice, overrides, toiletryBag, dayBagOptional]);

  const handleSave = async () => {
    if (!saveName.trim() || !saveEmail.trim()) return;
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName.trim(), email: saveEmail.trim(), state: getState() }),
      });
      if (res.ok) {
        setSaveStatus("sent");
        setLoadedName(saveName.trim());
        localStorage.setItem("roadiepack_state", JSON.stringify({ ...getState(), name: saveName.trim() }));
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
  };

  // ── DAY BAG ITEMS ────────────────────────────────────────
  const DAY_BAG_ITEMS = [
    // Always packed
    { id: "passport",   label: "Passport / ID",           emoji: "🛂", note: "Check expiry before every trip", always: true },
    { id: "laptop",     label: "Laptop",                   emoji: "💻", note: "", always: true },
    { id: "powerbank",  label: "Power bank",               emoji: "🔋", note: "Check airline limits — 100Wh max carry-on", always: true },
    { id: "cables",     label: "Charging cables",          emoji: "🔌", note: "USB-C + whatever else you need", always: true },
    { id: "ethernet",   label: "Ethernet adapter",         emoji: "🌐", note: "Venues rarely have reliable WiFi", always: true },
    { id: "wipes",      label: "Cleaning wipes",           emoji: "🧻", note: "", always: true },
    { id: "headphones", label: "Headphones / AirPods",     emoji: "🎧", note: "", always: true },
    { id: "sunglasses", label: "Sunglasses",               emoji: "🕶️", note: "", always: true },
    { id: "pen",        label: "Pen",                      emoji: "🖊️", note: "Customs forms, sign things. Always need one.", always: true },
    { id: "meds",       label: "Painkillers / basic meds", emoji: "💊", note: "Ibuprofen, antihistamine, anything regular", always: true },
    { id: "sanitiser",  label: "Hand sanitiser",           emoji: "🧴", note: "Small one, fits in pocket", always: true },
    { id: "wallet",     label: "Wallet + cards",           emoji: "💳", note: "Notify your bank before travelling", always: true },
    { id: "phone",      label: "Phone + charger",          emoji: "📱", note: "", always: true },
    // Optional
    { id: "ipad",       label: "iPad",                     emoji: "📱", note: "", optional: "ipad" },
    { id: "pencil",     label: "Apple Pencil",             emoji: "✏️", note: "Only if iPad is coming", optional: "pencil" },
    { id: "kindle",     label: "Kindle / reading",         emoji: "📖", note: "", optional: "kindle" },
    { id: "eyemask",    label: "Eye mask + ear plugs",     emoji: "😴", note: "Long haul essential", optional: "eyemask" },
    { id: "snacks",     label: "Snacks for travel day",    emoji: "🍫", note: "Airport food is expensive and bad", optional: "snacks" },
  ];

  const visibleDayBagItems = DAY_BAG_ITEMS.filter(i => i.always || dayBagOptional[i.optional]);
  const dayBagDoneCount = visibleDayBagItems.filter(i => dayBagChecked[i.id]).length;

  const band = getWeatherBand(weather);
  const { cards } = buildAdvisory({ totalDays, workDays: mode === "holiday" ? 0 : workDays, mode, band, weather });

  const TOILETRY_WEIGHTS = { carryon: 650, full: 1400 };

  // Build travel outfit and confirmed worn map FIRST — needed for qty calc below
  const travelOutfit = getTravelDayOutfit({ band, mode, weather });
  const { wornMap } = travelOutfit;

  const confirmedWornMap = {};
  travelOutfit.outfit.forEach(o => {
    if (o.wears && travelWorn[o.wears]) {
      confirmedWornMap[o.wears] = (confirmedWornMap[o.wears] || 0) + 1;
    }
  });

  // displayCards — qty and weight account for confirmed worn items
  const displayCards = cards.map(c => {
    if (c.isToletryCta) return { ...c, weight: TOILETRY_WEIGHTS[toiletryBag] };
    if (c.isSection) return { ...c, qty: 0, weight: 0 };
    const baseQty    = overrides[c.category] ?? c.qty;
    const wornQty    = confirmedWornMap[c.category] || 0;
    const packedQty  = Math.max(0, baseQty - wornQty);
    const unitWeight = WEIGHTS[c.category] || Math.round(c.weight / (c.qty || 1));
    return { ...c, qty: baseQty, packedQty, wornQty, weight: unitWeight * packedQty };
  });

  const packableCards = displayCards.filter(c => !c.isSection);
  const clothingKg    = parseFloat((packableCards.reduce((s,c) => s + c.weight, 0) / 1000).toFixed(1));
  const checkedCount  = packableCards.filter(c => checked[c.category]).length;
  const t = THEMES[mode];

  // wornWeightG is now implicit in displayCards weights but keep for display
  const wornWeightG   = Object.entries(confirmedWornMap).reduce((sum, [cat, qty]) => {
    return sum + (WEIGHTS[cat] || 200) * qty;
  }, 0);

  const bagClothingKg = clothingKg; // already has worn items subtracted via packedQty
  const totalKg       = parseFloat((bagClothingKg + kitWeight).toFixed(1));

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

  // Bag recommendation — real empty bag weights baked in:
  // Backpack ~1.5kg empty · Tumi 19" carry-on 5kg empty · Checked case 4kg empty
  // Thresholds on CLOTHING weight only — bag weight added for display
  const BAG_LIMITS = {
    backpack: { clothing: 8.5,  empty: 1.5, total: 10,  label: "Backpack",         over: "Over backpack limit — switch to Tumi or cut something" },
    tumi:     { clothing: 10.0, empty: 5,   total: 15,  label: "Tumi 19\" carry-on", over: "Over carry-on limit — switch to checked or cut something" },
    checked:  { clothing: 19.0, empty: 4,   total: 23,  label: "Checked case",      over: "Over checked limit — cut something" },
  };
  const bag = BAG_LIMITS[bagChoice];
  const totalWithBag = parseFloat((bagClothingKg + bag.empty + kitWeight).toFixed(1));
  const isOverLimit  = bagClothingKg > bag.clothing;
  const bagNote      = isOverLimit
    ? bag.over
    : `${bag.label} — ${totalWithBag}kg total (${bag.empty}kg bag + ${bagClothingKg}kg clothing${kitWeight > 0 ? ` + ${kitWeight}kg kit` : ""})`;

  // Backpack-specific: flag heavy items
  const backpackBulkyItems = bagChoice === "backpack"
    ? packableCards.filter(c => {
        const unitW = WEIGHTS[c.category] || 200;
        return unitW >= 600 && (c.packedQty ?? c.qty) > 0;
      })
    : [];

  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text, fontFamily: "'Cormorant Garamond', Georgia, 'Times New Roman', serif" }}>

      {/* Top bar */}
      <div style={{ borderBottom: `1px solid ${t.border}`, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, background: t.card }}>
        <div>
          <span style={{ fontSize: 18, fontWeight: 400, letterSpacing: "0.5px" }}>Roadie Pack</span>
          {loadedName && (
            <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 11, color: t.muted, marginLeft: 10 }}>
              {loadedName}'s list
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase", fontFamily: "system-ui, sans-serif" }}>
            {packMode ? `${checkedCount} / ${packableCards.length}` : ""}
          </span>
          <button onClick={() => { setSaveModal(true); setSaveStatus(""); }}
            style={{
              fontFamily: "system-ui, sans-serif", fontSize: 11, letterSpacing: "1px", textTransform: "uppercase",
              padding: "6px 14px", borderRadius: 6, border: `1px solid ${t.border}`,
              background: "transparent", color: t.muted, cursor: "pointer",
            }}>Save</button>
        </div>
      </div>

      {/* Save modal */}
      {saveModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        }} onClick={(e) => { if (e.target === e.currentTarget) setSaveModal(false); }}>
          <div style={{ background: t.card, borderRadius: 16, padding: 32, width: "100%", maxWidth: 400, border: `1px solid ${t.border}` }}>
            {saveStatus === "sent" ? (
              <>
                <h2 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 28, fontWeight: 300, margin: "0 0 12px" }}>Check your inbox</h2>
                <p style={{ fontSize: 14, color: t.muted, margin: "0 0 24px", lineHeight: 1.6 }}>
                  Magic link sent to <strong>{saveEmail}</strong>. Click it anytime to restore your exact list.
                </p>
                <p style={{ fontSize: 13, color: t.muted, fontStyle: "italic" }}>Your list is also saved on this device automatically.</p>
                <button onClick={() => setSaveModal(false)} style={{
                  marginTop: 24, width: "100%", padding: "12px", background: t.accent, color: "#fff",
                  border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "system-ui, sans-serif", fontSize: 13,
                }}>Done</button>
              </>
            ) : (
              <>
                <h2 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 28, fontWeight: 300, margin: "0 0 8px" }}>Save your list</h2>
                <p style={{ fontSize: 13, color: t.muted, margin: "0 0 24px" }}>We'll email you a magic link. Click it on any device to restore your exact setup.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 6 }}>Your name</label>
                    <input type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
                      placeholder="Dave" style={{ ...inp, width: "100%", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 6 }}>Email</label>
                    <input type="email" value={saveEmail} onChange={e => setSaveEmail(e.target.value)}
                      placeholder="dave@example.com" style={{ ...inp, width: "100%", boxSizing: "border-box" }} />
                  </div>
                </div>
                {saveStatus === "error" && (
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: "#B91C1C" }}>Something went wrong — try again</p>
                )}
                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  <button onClick={() => setSaveModal(false)} style={{
                    flex: 1, padding: "12px", background: "transparent", color: t.muted,
                    border: `1px solid ${t.border}`, borderRadius: 8, cursor: "pointer",
                    fontFamily: "system-ui, sans-serif", fontSize: 13,
                  }}>Cancel</button>
                  <button onClick={handleSave} disabled={saveStatus === "saving" || !saveName || !saveEmail}
                    style={{
                      flex: 2, padding: "12px", background: t.accent, color: "#fff",
                      border: "none", borderRadius: 8, cursor: "pointer",
                      fontFamily: "system-ui, sans-serif", fontSize: 13,
                      opacity: (!saveName || !saveEmail) ? 0.5 : 1,
                    }}>
                    {saveStatus === "saving" ? "Sending…" : "Send magic link"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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

        {/* Travel Day One box — always visible */}
        {(() => {
          return (
            <div style={{
              marginBottom: 36, padding: "20px 24px",
              background: t.card, border: `1px solid ${t.border}`,
              borderRadius: 14, borderLeft: `3px solid ${t.accent}`,
            }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: t.accent }}>
                  Travel Day — What You're Wearing
                </span>
                <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 11, color: t.muted, fontStyle: "italic" }}>
                  {cityRows.length > 0 && !cityRows[0].error
                    ? `${wxEmoji(cityRows[0])} ${cityRows[0].minTemp}–${cityRows[0].maxTemp}°C`
                    : weather ? `${wxEmoji(weather)} forecast loaded` : "Add a destination"}
                </span>
              </div>
              <p style={{ margin: "0 0 12px", fontFamily: "system-ui, sans-serif", fontSize: 11, color: t.muted }}>
                Tap to confirm what you're wearing — these won't go in the bag.
              </p>

              {/* Outfit items — tap to confirm */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                {travelOutfit.outfit.map((item, i) => {
                  const isWorn = item.wears && travelWorn[item.wears];
                  return (
                    <div key={i}
                      onClick={() => item.wears && setTravelWorn(p => ({ ...p, [item.wears]: !p[item.wears] }))}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 12px", borderRadius: 8,
                        background: isWorn ? t.accentLight : t.chip,
                        border: `1px solid ${isWorn ? t.accent : "transparent"}`,
                        cursor: item.wears ? "pointer" : "default",
                        transition: "all 0.15s", userSelect: "none",
                      }}>
                      {item.wears && (
                        <div style={{
                          width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                          border: `1.5px solid ${isWorn ? t.accent : t.border}`,
                          background: isWorn ? t.accent : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "all 0.15s",
                        }}>
                          {isWorn && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
                        </div>
                      )}
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{item.emoji}</span>
                      <span style={{ fontSize: 14, color: t.text, flex: 1 }}>{item.item}</span>
                      {isWorn
                        ? <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.accent }}>not in bag</span>
                        : <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted }}>tap to confirm</span>
                      }
                    </div>
                  );
                })}

                {/* Manual override — trousers on plane for hot/warm destinations */}
                {(band.startsWith("hot") || band.startsWith("warm")) && (
                  <div
                    onClick={() => setTravelWorn(p => ({ ...p, "__trousers_override": !p["__trousers_override"] }))}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 12px", borderRadius: 8,
                      background: travelWorn["__trousers_override"] ? t.accentLight : "transparent",
                      border: `1px dashed ${travelWorn["__trousers_override"] ? t.accent : t.border}`,
                      cursor: "pointer", transition: "all 0.15s", userSelect: "none",
                    }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                      border: `1.5px solid ${travelWorn["__trousers_override"] ? t.accent : t.border}`,
                      background: travelWorn["__trousers_override"] ? t.accent : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {travelWorn["__trousers_override"] && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 16 }}>👖</span>
                    <span style={{ fontSize: 14, color: t.muted, flex: 1, fontStyle: "italic" }}>
                      Trousers instead (long haul / cold hub airport)
                    </span>
                  </div>
                )}
              </div>

              {/* Notes */}
              {travelOutfit.notes.length > 0 && (
                <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                  {travelOutfit.notes.map((note, i) => (
                    <p key={i} style={{ margin: 0, fontSize: 12, color: t.muted, fontStyle: "italic", lineHeight: 1.5, fontFamily: "inherit" }}>
                      {note}
                    </p>
                  ))}
                </div>
              )}

              {/* Weight saved */}
              <p style={{ margin: "10px 0 0", fontFamily: "system-ui, sans-serif", fontSize: 11, color: t.accent, letterSpacing: "0.3px" }}>
                {wornWeightG > 0
                  ? `✓ ${(wornWeightG/1000).toFixed(1)}kg confirmed on your body — not in the bag`
                  : `↑ ${travelOutfit.wornWeight}`}
              </p>
            </div>
          );
        })()}

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

            {/* Bag selector */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>Bag</label>
              <div style={{ display: "flex", gap: 8 }}>
                {[
                  { id: "backpack", label: "🎒 Backpack", sub: "~10kg total" },
                  { id: "tumi",     label: "🧳 Tumi 19\"", sub: "~15kg total" },
                  { id: "checked",  label: "✈️ Checked",  sub: "~23kg total" },
                ].map(b => (
                  <button key={b.id} onClick={() => setBagChoice(b.id)} style={{
                    flex: 1, padding: "10px 8px", borderRadius: 8, border: `1px solid ${bagChoice === b.id ? t.accent : t.border}`,
                    background: bagChoice === b.id ? t.accentLight : "transparent",
                    cursor: "pointer", fontFamily: "system-ui, sans-serif", transition: "all 0.15s",
                  }}>
                    <div style={{ fontSize: 13, color: bagChoice === b.id ? t.accent : t.text, fontWeight: bagChoice === b.id ? 600 : 400 }}>{b.label}</div>
                    <div style={{ fontSize: 10, color: t.muted, marginTop: 2 }}>{b.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: mode !== "holiday" ? "1fr 1fr" : "1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>Days away</label>
                <input type="text" inputMode="numeric" value={totalDays} style={inp}
                  onFocus={e => e.target.select()}
                  onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) { setTotalDays(v); setOverrides({}); } else if (e.target.value === "" || e.target.value === "0") setTotalDays(e.target.value); }}
                  onBlur={e => { const v = parseInt(e.target.value); setTotalDays(isNaN(v) || v < 1 ? 1 : v); }} />
              </div>
              {mode !== "holiday" && (
                <div>
                  <label style={{ display: "block", fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>Work days</label>
                  <input type="text" inputMode="numeric" value={workDays} style={inp}
                    onFocus={e => e.target.select()}
                    onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) { setWorkDays(v); setOverrides({}); } else if (e.target.value === "") setWorkDays(e.target.value); }}
                    onBlur={e => { const v = parseInt(e.target.value); setWorkDays(isNaN(v) || v < 0 ? 0 : v); }} />
                </div>
              )}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>Destinations</label>
              <input type="text" value={destination} placeholder="London, Barcelona, Paris" style={inp}
                onChange={e => { setDest(e.target.value); setOverrides({}); }} />
            </div>
            <div>
              <label style={{ display: "block", fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>Extra kit weight (kg)</label>
              <input type="text" inputMode="decimal" value={kitWeight || ""} style={inp}
                onFocus={e => e.target.select()}
                onChange={e => { const v = parseFloat(e.target.value); setKitWeight(isNaN(v) ? 0 : v); }}
                onBlur={e => { const v = parseFloat(e.target.value); setKitWeight(isNaN(v) ? 0 : v); }}
                placeholder="e.g. 2.5 for interface + cables + plugs" />
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

        {/* View tabs + pack toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${t.border}` }}>
            {[{ id: "list", label: "List" }, { id: "cubes", label: "Cubes" }, { id: "daybag", label: "Day Bag" }].map(v => (
              <button key={v.id} onClick={() => { setView(v.id); setPackMode(false); }}
                style={{
                  padding: "8px 16px 7px", background: "none", border: "none", cursor: "pointer",
                  fontFamily: "system-ui, sans-serif", fontSize: 11, letterSpacing: "1px", textTransform: "uppercase",
                  color: view === v.id ? t.text : t.muted,
                  borderBottom: view === v.id ? `2px solid ${t.accent}` : "2px solid transparent",
                  marginBottom: -1, transition: "all 0.15s",
                }}>{v.label}</button>
            ))}
          </div>
          {view === "list" && (
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
          )}
        </div>

        {/* Progress bar */}
        {packMode && view === "list" && (
          <div style={{ height: 1, background: t.border, marginBottom: 24, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(checkedCount / packableCards.length) * 100}%`, background: t.accent, transition: "width 0.3s" }} />
          </div>
        )}

        {/* Cubes view */}
        {view === "cubes" && (() => {
          const cubes = buildCubes(packableCards, confirmedWornMap);
          return (
            <div style={{ display: "grid", gap: 20 }}>
              {[1, 2, 3, 4, 0].map(cubeId => {
                const items = cubes[cubeId];
                if (!items || items.length === 0) return null;
                const meta = CUBE_META[cubeId];
                return (
                  <div key={cubeId} style={{ border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
                    {/* Cube header */}
                    {(() => {
                      const cubeItems = items;
                      const cubeDone = cubeItems.filter(item => cubeChecked[`${cubeId}-${item.category}`]).length;
                      const allDone = cubeDone === cubeItems.length;
                      return (
                      <div style={{ padding: "12px 18px", borderBottom: `1px solid ${t.border}`, background: allDone ? meta.colour + "10" : "transparent" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div>
                            <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: meta.colour }}>
                              {meta.label} {allDone ? "✓" : ""}
                            </span>
                            <p style={{ margin: "3px 0 0", fontSize: 12, color: t.muted, fontStyle: "italic", fontFamily: "inherit" }}>
                              {meta.desc}
                            </p>
                          </div>
                          <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 11, color: cubeDone > 0 ? meta.colour : t.muted, fontWeight: cubeDone > 0 ? 600 : 400 }}>
                            {cubeDone}/{cubeItems.length}
                          </span>
                        </div>
                        {/* Mini progress bar */}
                        {cubeDone > 0 && (
                          <div style={{ height: 2, background: t.border, borderRadius: 1, marginTop: 8, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${(cubeDone/cubeItems.length)*100}%`, background: meta.colour, transition: "width 0.3s" }} />
                          </div>
                        )}
                      </div>
                      );
                    })()}
                    {/* Items */}
                    {items.map((item, i) => {
                      const key = `${cubeId}-${item.category}`;
                      const done = !!cubeChecked[key];
                      return (
                      <div key={item.category} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "12px 18px",
                        borderBottom: i < items.length - 1 ? `1px solid ${t.border}` : "none",
                        gap: 12, opacity: done ? 0.3 : 1, transition: "opacity 0.2s",
                        cursor: "pointer",
                      }}
                        onClick={() => setCubeChecked(p => ({ ...p, [key]: !p[key] }))}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {/* Check circle */}
                          <div style={{
                            width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                            border: `1.5px solid ${done ? meta.colour : t.border}`,
                            background: done ? meta.colour : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            transition: "all 0.15s",
                          }}>
                            {done && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                          </div>
                          <span style={{ fontSize: 16 }}>{item.emoji}</span>
                          <div>
                            <span style={{ fontSize: 15, color: t.text, textDecoration: done ? "line-through" : "none" }}>{item.category}</span>
                            {item.cubeNote && (
                              <p style={{ margin: "1px 0 0", fontSize: 11, color: t.muted, fontFamily: "system-ui, sans-serif" }}>
                                {item.cubeNote}
                              </p>
                            )}
                          </div>
                        </div>
                        <span style={{ fontFamily: "system-ui, sans-serif", fontWeight: 700, fontSize: 15, color: meta.colour, flexShrink: 0 }}>
                          ×{item.qty}
                        </span>
                      </div>
                    );})}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Day Bag view */}
        {view === "daybag" && (
          <div>
            {/* Optional items toggles */}
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase", margin: "0 0 10px" }}>Optional items</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  { id: "ipad",    label: "iPad" },
                  { id: "pencil",  label: "Apple Pencil" },
                  { id: "kindle",  label: "Kindle" },
                  { id: "eyemask", label: "Eye mask" },
                  { id: "snacks",  label: "Snacks" },
                ].map(opt => (
                  <button key={opt.id}
                    onClick={() => setDayBagOptional(p => ({ ...p, [opt.id]: !p[opt.id] }))}
                    style={{
                      padding: "7px 14px", borderRadius: 20, cursor: "pointer",
                      fontFamily: "system-ui, sans-serif", fontSize: 12,
                      border: `1px solid ${dayBagOptional[opt.id] ? t.accent : t.border}`,
                      background: dayBagOptional[opt.id] ? t.accentLight : "transparent",
                      color: dayBagOptional[opt.id] ? t.accent : t.muted,
                      transition: "all 0.15s",
                    }}>{dayBagOptional[opt.id] ? "✓ " : "+ "}{opt.label}</button>
                ))}
              </div>
            </div>

            {/* Progress */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <p style={{ fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase", margin: 0 }}>
                {dayBagDoneCount}/{visibleDayBagItems.length} packed
              </p>
              {dayBagDoneCount > 0 && (
                <button onClick={() => setDayBagChecked({})} style={{
                  fontFamily: "system-ui, sans-serif", fontSize: 11, color: t.muted,
                  background: "none", border: "none", cursor: "pointer", textDecoration: "underline",
                }}>Reset</button>
              )}
            </div>
            {dayBagDoneCount > 0 && (
              <div style={{ height: 2, background: t.border, borderRadius: 1, marginBottom: 16, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(dayBagDoneCount/visibleDayBagItems.length)*100}%`, background: t.accent, transition: "width 0.3s" }} />
              </div>
            )}

            {/* Items */}
            <div style={{ borderTop: `1px solid ${t.border}` }}>
              {visibleDayBagItems.map((item, i) => {
                const done = !!dayBagChecked[item.id];
                return (
                  <div key={item.id}
                    onClick={() => setDayBagChecked(p => ({ ...p, [item.id]: !p[item.id] }))}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "14px 0", borderBottom: `1px solid ${t.border}`,
                      cursor: "pointer", opacity: done ? 0.3 : 1, transition: "opacity 0.2s",
                      userSelect: "none",
                    }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                      border: `1.5px solid ${done ? t.accent : t.border}`,
                      background: done ? t.accent : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.15s",
                    }}>
                      {done && <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 18 }}>{item.emoji}</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 16, color: t.text, textDecoration: done ? "line-through" : "none" }}>{item.label}</span>
                      {item.note && !done && (
                        <p style={{ margin: "2px 0 0", fontSize: 12, color: t.muted, fontStyle: "italic", fontFamily: "inherit" }}>{item.note}</p>
                      )}
                    </div>
                    {!item.always && (
                      <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, padding: "2px 8px", background: t.chip, borderRadius: 10 }}>optional</span>
                    )}
                  </div>
                );
              })}
            </div>

            <p style={{ margin: "20px 0 0", fontFamily: "system-ui, sans-serif", fontSize: 11, color: t.muted, fontStyle: "italic" }}>
              Pack the checked case first, then the day bag last — so everything you need on the plane is on top.
            </p>
          </div>
        )}

        {view === "list" && (
        <div style={{ borderTop: `1px solid ${t.border}` }}>
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

                      {/* Worn / packed split tag — updates when travel day items confirmed */}
                      {wornMap[card.category] && !packMode && (() => {
                        const totalWorn = wornMap[card.category];
                        const confirmed = confirmedWornMap[card.category] || 0;
                        const packed = Math.max(0, card.qty - confirmed);
                        return (
                          <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                            {packed > 0 && (
                              <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 10, padding: "2px 8px", borderRadius: 4, background: t.accentLight, color: t.accent, letterSpacing: "0.3px" }}>
                                {packed} packed
                              </span>
                            )}
                            {confirmed > 0 ? (
                              <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 10, padding: "2px 8px", borderRadius: 4, background: t.chip, color: t.accent, fontWeight: 600, letterSpacing: "0.3px" }}>
                                ✓ {confirmed} worn — not in bag
                              </span>
                            ) : (
                              <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 10, padding: "2px 8px", borderRadius: 4, background: t.chip, color: t.muted, letterSpacing: "0.3px" }}>
                                {totalWorn} worn travel day
                              </span>
                            )}
                          </div>
                        );
                      })()}

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
                            <div style={{ textAlign: "center" }}>
                              <span style={{ fontFamily: "system-ui, sans-serif", fontWeight: 600, fontSize: 16, color: t.accent, minWidth: 20, display: "block" }}>
                                {card.packedQty ?? card.qty}
                              </span>
                              {card.wornQty > 0 && (
                                <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 9, color: t.muted, display: "block", lineHeight: 1 }}>
                                  +{card.wornQty} worn
                                </span>
                              )}
                            </div>
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
                          <div style={{ textAlign: "center" }}>
                            <span style={{ fontFamily: "system-ui, sans-serif", fontWeight: 600, fontSize: 16, color: t.accent, display: "block" }}>
                              {card.packedQty ?? card.qty}
                            </span>
                            {card.wornQty > 0 && (
                              <span style={{ fontFamily: "system-ui, sans-serif", fontSize: 9, color: t.muted, display: "block", lineHeight: 1 }}>
                                +{card.wornQty} worn
                              </span>
                            )}
                          </div>
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
        )} {/* end list view */}

        {/* Weight + bag note — always visible */}
        <div style={{ marginTop: 40, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <p style={{ margin: "0 0 4px", fontFamily: "system-ui, sans-serif", fontSize: 10, color: t.muted, letterSpacing: "1.5px", textTransform: "uppercase" }}>In the bag</p>
            <span style={{ fontSize: 48, fontWeight: 300, color: isOverLimit ? "#B91C1C" : t.text, lineHeight: 1, letterSpacing: "-1px" }}>
              {bagClothingKg}<span style={{ fontSize: 20, color: t.muted }}> kg</span>
            </span>
            {wornWeightG > 0 && (
              <p style={{ margin: "4px 0 0", fontFamily: "system-ui, sans-serif", fontSize: 12, color: t.muted }}>
                + {(wornWeightG/1000).toFixed(1)}kg on your body · {clothingKg}kg total clothing
              </p>
            )}
            {kitWeight > 0 && (
              <p style={{ margin: "4px 0 0", fontFamily: "system-ui, sans-serif", fontSize: 13, color: t.muted }}>
                + {kitWeight}kg kit = <strong style={{ color: t.text }}>{totalKg}kg</strong> total before bag
              </p>
            )}
            <p style={{ margin: "6px 0 0", fontFamily: "system-ui, sans-serif", fontSize: 12, color: isOverLimit ? "#B91C1C" : t.accent, letterSpacing: "0.3px" }}>
              {isOverLimit ? "⚠️ " : ""}{bagNote}
            </p>
            {/* Backpack bulky item checker */}
            {backpackBulkyItems.length > 0 && (
              <div style={{ marginTop: 12, padding: "10px 12px", background: "#FEF3C7", borderRadius: 8, border: "1px solid #F59E0B" }}>
                <p style={{ margin: "0 0 6px", fontFamily: "system-ui, sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#92400E" }}>
                  Heavy items for a backpack
                </p>
                {backpackBulkyItems.map(item => (
                  <p key={item.category} style={{ margin: "2px 0", fontFamily: "system-ui, sans-serif", fontSize: 12, color: "#92400E" }}>
                    {item.category} — ~{wFmt(WEIGHTS[item.category] * (item.packedQty ?? item.qty))} · consider wearing or leaving behind
                  </p>
                ))}
              </div>
            )}
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