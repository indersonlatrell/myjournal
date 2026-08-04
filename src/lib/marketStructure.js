// ─── HTF orderflow / hourly structure engine ───────────────────────────────
// Fractal swing detection over 1H candles, classified into bullish (HH/HL),
// bearish (LH/LL), or ranging structure — then checked against the trader's
// discretionary HTF scenario (strengthening / weakening) to flag whether the
// hourly tape is validating or invalidating that bias.

export function findSwings(candles, strength = 2) {
  const highs = [];
  const lows = [];
  for (let i = strength; i < candles.length - strength; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= strength; k++) {
      if (candles[i - k].high >= c.high || candles[i + k].high >= c.high) isHigh = false;
      if (candles[i - k].low <= c.low || candles[i + k].low <= c.low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, time: c.time, price: c.high });
    if (isLow) lows.push({ index: i, time: c.time, price: c.low });
  }
  return { highs, lows };
}

// Raw trend for any candle set/timeframe — used by the multi-timeframe
// structure ladder, where we only need bullish/bearish/ranging, not a
// bias validation verdict.
export function trendOf(candles) {
  if (!candles || candles.length < 12) return "insufficient";
  return classifyStructure(findSwings(candles));
}

export function classifyStructure(swings) {
  const { highs, lows } = swings;
  if (highs.length < 2 || lows.length < 2) return "insufficient";
  const [prevHigh, lastHigh] = highs.slice(-2);
  const [prevLow, lastLow] = lows.slice(-2);
  const higherHigh = lastHigh.price > prevHigh.price;
  const higherLow = lastLow.price > prevLow.price;
  const lowerHigh = lastHigh.price < prevHigh.price;
  const lowerLow = lastLow.price < prevLow.price;
  if (higherHigh && higherLow) return "bullish";
  if (lowerHigh && lowerLow) return "bearish";
  return "ranging";
}

// scenario: "strengthening" | "weakening" | "neutral"
export function evaluateScenario(scenario, candles) {
  if (!candles || candles.length < 12) {
    return { status: "loading", trend: "insufficient", detail: "Fetching hourly candles…" };
  }

  const swings = findSwings(candles);
  const trend = classifyStructure(swings);
  const lastClose = candles[candles.length - 1].close;
  const lastSwingLow = swings.lows[swings.lows.length - 1];
  const lastSwingHigh = swings.highs[swings.highs.length - 1];

  if (!scenario || scenario === "neutral") {
    return { status: "neutral", trend, detail: "No HTF scenario set for this instrument" };
  }

  if (scenario === "strengthening") {
    if (lastSwingLow && lastClose < lastSwingLow.price) {
      return {
        status: "invalidated",
        trend,
        detail: `1H closed below swing low @ ${lastSwingLow.price} — bullish structure broken`,
      };
    }
    if (trend === "bullish") {
      return { status: "validated", trend, detail: "1H printing higher highs & higher lows — confirms strengthening bias" };
    }
    return { status: "pending", trend, detail: "1H structure not yet confirming strengthening bias" };
  }

  if (scenario === "weakening") {
    if (lastSwingHigh && lastClose > lastSwingHigh.price) {
      return {
        status: "invalidated",
        trend,
        detail: `1H closed above swing high @ ${lastSwingHigh.price} — bearish structure broken`,
      };
    }
    if (trend === "bearish") {
      return { status: "validated", trend, detail: "1H printing lower highs & lower lows — confirms weakening bias" };
    }
    return { status: "pending", trend, detail: "1H structure not yet confirming weakening bias" };
  }

  return { status: "neutral", trend, detail: "" };
}
