// Pure, deterministic heuristics that turn a user's own historical Mood
// documents into the predictions/patterns shown across the Insights screens
// and the "What if you..." cards. No DB calls live here — controllers fetch
// docs and pass plain arrays in. No randomness, no LLM calls: every number
// produced here is reproducible from the input docs.

import { moodScoreToPercent } from "./wellnessThresholds.js";

export const MIN_ENTRIES_FOR_INSIGHTS = 5;

export const COLD_START_FALLBACK = {
  energyFormula: [],
  prediction: {
    predictedEnergy: 0,
    confidence: "0%",
    reasons: [],
    coldStart: true,
  },
  weekOutlook: {
    series: [],
    days: [],
    insight: "",
    coldStart: true,
  },
  riskPattern: null,
  recommended: [],
  whatIf: [],
  insightSentence: "",
};

const FIELD_ACCESSORS = {
  moodPercent: (d) => moodScoreToPercent(d.moodScore),
};

const getValue = (doc, field) =>
  FIELD_ACCESSORS[field] ? FIELD_ACCESSORS[field](doc) : doc[field];

const average = (nums) => {
  const valid = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
};

export const hasEnoughHistory = (docs) =>
  Array.isArray(docs) && docs.length >= MIN_ENTRIES_FOR_INSIGHTS;

// direction "gte" -> the favorable bucket is values >= threshold (e.g. more sleep is better)
// direction "lte" -> the favorable bucket is values <= threshold (e.g. less stress is better)
export const bucketByThreshold = (
  docs,
  inputField,
  outputField,
  threshold,
  direction = "gte",
) => {
  const favorable = [];
  const other = [];

  docs.forEach((d) => {
    const inputVal = getValue(d, inputField);
    const outputVal = getValue(d, outputField);
    if (typeof inputVal !== "number" || typeof outputVal !== "number") return;

    const isFavorable =
      direction === "lte" ? inputVal <= threshold : inputVal >= threshold;
    if (isFavorable) favorable.push(outputVal);
    else other.push(outputVal);
  });

  return {
    favorableAvg: average(favorable),
    otherAvg: average(other),
    favorableCount: favorable.length,
    otherCount: other.length,
  };
};

// Returns null when there isn't enough data on both sides of the split to trust the comparison.
export const correlate = (
  docs,
  inputField,
  outputField,
  threshold,
  direction = "gte",
) => {
  const { favorableAvg, otherAvg, favorableCount, otherCount } =
    bucketByThreshold(docs, inputField, outputField, threshold, direction);

  if (
    favorableCount < 2 ||
    otherCount < 2 ||
    favorableAvg === null ||
    otherAvg === null
  ) {
    return null;
  }

  const liftPercent = Math.round(
    ((favorableAvg - otherAvg) / Math.max(otherAvg, 1)) * 100,
  );

  return { liftPercent, favorableAvg, otherAvg, observedCount: favorableCount };
};

export const trendDirection = (recentAvg, priorAvg) => {
  if (recentAvg === null || priorAvg === null) return "Stable";
  if (priorAvg === 0) return recentAvg > 0 ? "Improving" : "Stable";
  const delta = ((recentAvg - priorAvg) / priorAvg) * 100;
  if (delta > 5) return "Improving";
  if (delta < -5) return "Declining";
  return "Stable";
};

// Simple least-squares slope over an evenly spaced series; projects one step beyond the series.
export const linearProjection = (series) => {
  const points = series.filter((v) => typeof v === "number" && !Number.isNaN(v));
  const n = points.length;
  if (n < 2) return { slope: 0, nextValue: points[0] ?? null };

  const xs = points.map((_, i) => i);
  const xMean = average(xs);
  const yMean = average(points);

  let num = 0;
  let den = 0;
  points.forEach((y, i) => {
    num += (xs[i] - xMean) * (y - yMean);
    den += (xs[i] - xMean) ** 2;
  });

  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  const nextValue = intercept + slope * n;

  return { slope, nextValue };
};

export const ENERGY_FORMULA_RULES = [
  {
    key: "sleep_energy",
    label: "Sleep 7h+",
    metric: "energy",
    input: "sleepHours",
    output: "energyLevel",
    threshold: 7,
    direction: "gte",
  },
  {
    key: "walk_mood",
    label: "Morning walk",
    metric: "mood",
    input: "walkMinutes",
    output: "moodPercent",
    threshold: 15,
    direction: "gte",
  },
  {
    key: "hydration_focus",
    label: "Hydration before noon",
    metric: "focus",
    input: "waterGlasses",
    output: "focusLevel",
    threshold: 6,
    direction: "gte",
  },
  {
    key: "low_stress_energy",
    label: "Low stress",
    metric: "energy",
    input: "stressLevel",
    output: "energyLevel",
    threshold: 35,
    direction: "lte",
  },
  {
    key: "walk_calm",
    label: "Walking",
    metric: "calm",
    input: "walkMinutes",
    output: "calmLevel",
    threshold: 15,
    direction: "gte",
  },
];

export const getEnergyFormula = (docs) => {
  if (!hasEnoughHistory(docs)) return COLD_START_FALLBACK.energyFormula;

  const results = [];
  ENERGY_FORMULA_RULES.forEach((rule) => {
    const result = correlate(
      docs,
      rule.input,
      rule.output,
      rule.threshold,
      rule.direction,
    );
    if (!result) return;

    const series = docs
      .slice(-14)
      .map((d) => Math.round(getValue(d, rule.output) ?? 0));

    results.push({
      key: rule.key,
      label: rule.label,
      metric: rule.metric,
      liftPercent: result.liftPercent,
      observedCount: result.observedCount,
      observedLabel: `Observed ${result.observedCount} times`,
      series,
      source: "history",
    });
  });

  return results;
};

export const getCurrentSnapshotPatterns = (docs) => {
  if (!Array.isArray(docs) || !docs.length) return [];
  const sorted = [...docs].sort(
    (a, b) => new Date(a.date) - new Date(b.date),
  );
  const latest = sorted[sorted.length - 1];
  const snapshot = [];
  const energySeries = sorted
    .slice(-14)
    .map((doc) => doc.energyLevel)
    .filter((value) => typeof value === "number")
    .map(Math.round);
  const moodSeries = sorted
    .slice(-14)
    .map((doc) => moodScoreToPercent(doc.moodScore))
    .filter((value) => typeof value === "number")
    .map(Math.round);
  const focusSeries = sorted
    .slice(-14)
    .map((doc) => doc.focusLevel)
    .filter((value) => typeof value === "number")
    .map(Math.round);

  if (typeof latest.sleepHours === "number") {
    const energy = Math.round(latest.energyLevel ?? 0);
    snapshot.push({
      key: "current_sleep",
      label: `Sleep ${formatSelectedNumber(latest.sleepHours)} hr`,
      metric: "energy",
      liftPercent: 0,
      observedCount: 1,
      observedLabel: "Today's check-in",
      impactText: `Energy ${energy}%`,
      series: energySeries,
      source: "current_checkin",
    });
  }

  if (typeof latest.walkMinutes === "number") {
    const mood = Math.round(moodScoreToPercent(latest.moodScore) ?? 0);
    snapshot.push({
      key: "current_movement",
      label: `Movement ${latest.walkMinutes} min`,
      metric: "mood",
      liftPercent: 0,
      observedCount: 1,
      observedLabel: "Today's check-in",
      impactText: `Mood ${mood}%`,
      series: moodSeries,
      source: "current_checkin",
    });
  }

  if (typeof latest.waterGlasses === "number") {
    const focus = Math.round(latest.focusLevel ?? 0);
    snapshot.push({
      key: "current_hydration",
      label: `Hydration ${latest.waterGlasses} glasses`,
      metric: "focus",
      liftPercent: 0,
      observedCount: 1,
      observedLabel: "Today's check-in",
      impactText: `Focus ${focus}%`,
      series: focusSeries,
      source: "current_checkin",
    });
  }

  return snapshot;
};

export const getTopCorrelation = (energyFormula) => {
  if (!energyFormula || !energyFormula.length) return null;
  return [...energyFormula].sort((a, b) => b.liftPercent - a.liftPercent)[0];
};

export const getSleepVsEnergyChart = (docs) => {
  if (!Array.isArray(docs) || !docs.length) return null;

  const buckets = {};
  docs.forEach((d) => {
    if (typeof d.sleepHours !== "number" || typeof d.energyLevel !== "number")
      return;
    const bucket = Math.min(9, Math.max(3, Math.floor(d.sleepHours)));
    if (!buckets[bucket]) buckets[bucket] = [];
    buckets[bucket].push(d.energyLevel);
  });

  const chartPoints = Object.keys(buckets)
    .map(Number)
    .sort((a, b) => a - b)
    .map((hr) => ({ hour: hr, avgEnergy: Math.round(average(buckets[hr])) }));

  if (!chartPoints.length) return null;

  if (chartPoints.length === 1) {
    const point = chartPoints[0];
    return {
      points: chartPoints,
      insight: `Latest check-in: ${point.hour} hr sleep with ${point.avgEnergy}% energy.`,
    };
  }

  const highest = chartPoints.reduce((a, b) => (b.avgEnergy > a.avgEnergy ? b : a));
  const lowest = chartPoints.reduce((a, b) => (b.avgEnergy < a.avgEnergy ? b : a));
  const diff = highest.avgEnergy - lowest.avgEnergy;

  const insight =
    diff > 0
      ? `You tend to have ${diff}% more energy on ${highest.hour}hr+ sleep nights compared to ${lowest.hour}hr nights.`
      : "Your energy levels look steady across different amounts of sleep so far.";

  return { points: chartPoints, insight };
};

const TREND_FIELDS = [
  { key: "sleep", field: "sleepHours" },
  { key: "hydration", field: "waterGlasses" },
  { key: "movement", field: "walkMinutes" },
];

export const getWeeklyTrends = (docs) => {
  if (!Array.isArray(docs) || !docs.length) return null;

  if (docs.length < 8) {
    const sorted = [...docs].sort(
      (a, b) => new Date(a.date) - new Date(b.date),
    );
    const latest = sorted[sorted.length - 1];
    return {
      sleep: {
        direction: "Current",
        percentChange: null,
        valueText: `${formatSelectedNumber(latest.sleepHours ?? 0)} hr`,
        source: "current_checkin",
      },
      hydration: {
        direction: "Current",
        percentChange: null,
        valueText: `${latest.waterGlasses ?? 0} glasses`,
        source: "current_checkin",
      },
      movement: {
        direction: "Current",
        percentChange: null,
        valueText: `${latest.walkMinutes ?? 0} min`,
        source: "current_checkin",
      },
    };
  }

  const sorted = [...docs].sort((a, b) => new Date(a.date) - new Date(b.date));
  const lastDocs = sorted.slice(-14);
  const thisWeek = lastDocs.slice(-7);
  const lastWeek = lastDocs.slice(0, Math.max(0, lastDocs.length - 7));

  if (!lastWeek.length) return null;

  const trends = {};
  TREND_FIELDS.forEach(({ key, field }) => {
    const thisWeekAvg = average(thisWeek.map((d) => d[field]));
    const lastWeekAvg = average(lastWeek.map((d) => d[field]));
    if (thisWeekAvg === null || lastWeekAvg === null) return;

    trends[key] = {
      direction: trendDirection(thisWeekAvg, lastWeekAvg),
      percentChange: Math.round(
        ((thisWeekAvg - lastWeekAvg) / Math.max(lastWeekAvg, 1)) * 100,
      ),
      valueText: "",
      source: "history",
    };
  });

  return Object.keys(trends).length ? trends : null;
};

const formatSelectedNumber = (value) =>
  Number.isInteger(value) ? value.toString() : value.toFixed(1);

const getCurrentCheckinScenarios = (currentDoc) => {
  if (!currentDoc) return [];

  const scenarios = [];
  if (typeof currentDoc.sleepHours === "number") {
    const selected = currentDoc.sleepHours;
    const target = 7;
    const remaining = Math.max(0, target - selected);
    scenarios.push({
      label: `Sleep ${target}hr`,
      metric: "sleep",
      predictedText:
        remaining > 0
          ? `You selected ${formatSelectedNumber(selected)} hr — ${formatSelectedNumber(remaining)} more hr reaches ${target} hr.`
          : `You selected ${formatSelectedNumber(selected)} hr — the ${target} hr target is met.`,
      source: "current_checkin",
    });
  }

  if (typeof currentDoc.walkMinutes === "number") {
    const selected = currentDoc.walkMinutes;
    const target = 20;
    const remaining = Math.max(0, target - selected);
    scenarios.push({
      label: `Walk ${target} minutes`,
      metric: "movement",
      predictedText:
        remaining > 0
          ? `You selected ${selected} min — ${remaining} more min reaches ${target} min.`
          : `You selected ${selected} min — the ${target} min target is met.`,
      source: "current_checkin",
    });
  }

  if (typeof currentDoc.waterGlasses === "number") {
    const selected = currentDoc.waterGlasses;
    const scenario = Math.min(20, selected + 2);
    scenarios.push({
      label: "Drink 2 more glasses",
      metric: "hydration",
      predictedText: `You selected ${selected} glasses — this scenario totals ${scenario} glasses.`,
      source: "current_checkin",
    });
  }

  return scenarios;
};

export const simulateWhatIf = (docs, currentDoc) => {
  if (!hasEnoughHistory(docs)) return getCurrentCheckinScenarios(currentDoc);

  const suggestions = [];

  const sleepResult = correlate(docs, "sleepHours", "energyLevel", 7, "gte");
  if (sleepResult) {
    const low = Math.max(0, Math.round(sleepResult.favorableAvg - 8));
    const high = Math.min(100, Math.round(sleepResult.favorableAvg + 8));
    suggestions.push({
      label: "Sleep 8hr tonight",
      metric: "energy",
      predictedText: `${low}%-${high}%`,
      source: "history",
    });
  }

  const walkResult = correlate(docs, "walkMinutes", "moodPercent", 20, "gte");
  if (walkResult) {
    const sign = walkResult.liftPercent >= 0 ? "+" : "";
    suggestions.push({
      label: "Walk for 20 minutes",
      metric: "mood",
      predictedText: `${sign}${walkResult.liftPercent}%`,
      source: "history",
    });
  }

  const currentWater =
    typeof currentDoc?.waterGlasses === "number" ? currentDoc.waterGlasses : 0;
  const waterResult = correlate(
    docs,
    "waterGlasses",
    "focusLevel",
    currentWater + 2,
    "gte",
  );
  if (waterResult) {
    const sign = waterResult.liftPercent >= 0 ? "+" : "";
    suggestions.push({
      label: "Drink 2 more glasses",
      metric: "focus",
      predictedText: `${sign}${waterResult.liftPercent}%`,
      source: "history",
    });
  }

  return suggestions.length
    ? suggestions
    : getCurrentCheckinScenarios(currentDoc);
};

export const detectRiskPattern = (docs) => {
  if (docs.length < 8) return null;

  const sorted = [...docs].sort((a, b) => new Date(a.date) - new Date(b.date));

  let streaks = 0;
  let hits = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const dayA = sorted[i];
    const dayB = sorted[i + 1];
    if (typeof dayA.sleepHours !== "number" || typeof dayB.sleepHours !== "number")
      continue;

    if (dayA.sleepHours < 6 && dayB.sleepHours < 6) {
      streaks += 1;
      const dayC = sorted[i + 2];
      if (dayC && typeof dayC.moodScore === "number" && dayC.moodScore <= 2) {
        hits += 1;
      }
    }
  }

  if (streaks < 2) return null;

  const moodScores = sorted.filter((d) => typeof d.moodScore === "number");
  const baseRate = moodScores.length
    ? moodScores.filter((d) => d.moodScore <= 2).length / moodScores.length
    : 0;

  const hitRate = hits / streaks;
  if (hitRate <= baseRate * 1.3) return null;

  return {
    title: "Sleep & Mood Risk",
    message:
      "When sleep falls below 6 hours for 2 days in a row, your mood usually drops the next day.",
    learnMoreKey: "sleep_mood_risk",
  };
};

export const getTomorrowPrediction = (docs) => {
  if (!Array.isArray(docs) || !docs.length) {
    return COLD_START_FALLBACK.prediction;
  }

  if (!hasEnoughHistory(docs)) {
    const sorted = [...docs].sort(
      (a, b) => new Date(a.date) - new Date(b.date),
    );
    const latest = sorted[sorted.length - 1];
    const reasons = [];
    if (typeof latest.sleepHours === "number") {
      reasons.push(`${formatSelectedNumber(latest.sleepHours)} hr sleep`);
    }
    if (typeof latest.walkMinutes === "number") {
      reasons.push(`${latest.walkMinutes} min movement`);
    }
    if (typeof latest.waterGlasses === "number") {
      reasons.push(`${latest.waterGlasses} glasses hydration`);
    }
    return {
      predictedEnergy: Math.round(latest.energyLevel ?? 0),
      confidence: "Current check-in",
      reasons,
      coldStart: true,
    };
  }

  const sorted = [...docs].sort((a, b) => new Date(a.date) - new Date(b.date));
  const last14 = sorted.slice(-14);
  const energySeries = last14
    .map((d) => d.energyLevel)
    .filter((v) => typeof v === "number");

  const { nextValue } = linearProjection(energySeries);
  const predictedEnergy = Math.max(
    0,
    Math.min(100, Math.round(nextValue ?? average(energySeries) ?? 65)),
  );

  const totalDocs = docs.length;
  const confidence = totalDocs >= 14 ? "High" : totalDocs >= 8 ? "Medium" : "Low";

  const latest = sorted[sorted.length - 1];
  const avgSleep = average(last14.map((d) => d.sleepHours));
  const avgStress = average(last14.map((d) => d.stressLevel));
  const avgWalk = average(last14.map((d) => d.walkMinutes));

  const reasons = [];
  if (avgSleep !== null && latest.sleepHours < avgSleep * 0.9) reasons.push("Less sleep");
  if (avgStress !== null && latest.stressLevel > avgStress * 1.1)
    reasons.push("Higher stress");
  if (avgWalk !== null && latest.walkMinutes < avgWalk * 0.9)
    reasons.push("Less movement");

  return {
    predictedEnergy,
    confidence,
    reasons: reasons.length ? reasons : ["Steady habits — keep it up"],
  };
};

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_FULL = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

// The full Mon–Sun outlook curve draws as soon as there are at least this many
// completed check-ins. Below this we show the single cold-start dot, since a
// 7-point line built from one entry would be a meaningless flat line.
export const MIN_ENTRIES_FOR_WEEK_OUTLOOK = 2;

export const getWeekOutlook = (docs) => {
  if (!Array.isArray(docs) || !docs.length) {
    return COLD_START_FALLBACK.weekOutlook;
  }

  if (docs.length < MIN_ENTRIES_FOR_WEEK_OUTLOOK) {
    const sorted = [...docs].sort(
      (a, b) => new Date(a.date) - new Date(b.date),
    );
    const latest = sorted[sorted.length - 1];
    const day = WEEKDAY_NAMES[new Date(latest.date).getDay()];
    const energy = Math.round(latest.energyLevel ?? 0);
    return {
      series: [energy],
      days: [day],
      insight: `Current check-in: ${energy}% energy on ${WEEKDAY_FULL[day]}.`,
      coldStart: true,
    };
  }

  const byWeekday = {};
  docs.forEach((d) => {
    if (typeof d.energyLevel !== "number") return;
    const dayName = WEEKDAY_NAMES[new Date(d.date).getDay()];
    if (!byWeekday[dayName]) byWeekday[dayName] = [];
    byWeekday[dayName].push(d.energyLevel);
  });

  const overallAvg = average(docs.slice(-14).map((d) => d.energyLevel)) ?? 65;

  // A single logged day is enough to show that weekday's real value; only days
  // with no entries at all fall back to the overall average (a soft estimate).
  const series = WEEK_ORDER.map((day) => {
    const values = byWeekday[day];
    if (values && values.length >= 1) return Math.round(average(values));
    return Math.round(overallAvg);
  });

  const maxIndex = series.reduce(
    (bestIdx, val, idx, arr) => (val > arr[bestIdx] ? idx : bestIdx),
    0,
  );
  const insight = `${WEEKDAY_FULL[WEEK_ORDER[maxIndex]]} is expected to be your highest energy day.`;

  return { series, days: WEEK_ORDER, insight };
};

const RECOMMENDATION_COPY = {
  sleep_energy: "Sleep 7+ hours tonight",
  walk_mood: "Take a walk before noon",
  hydration_focus: "Drink water before breakfast",
  low_stress_energy: "Take a few minutes to unwind",
  walk_calm: "Take a short walk to stay calm",
};

const getCurrentRecommendations = (currentDoc) => {
  if (!currentDoc) return [];
  const actions = [];

  if (typeof currentDoc.sleepHours === "number") {
    const sleep = currentDoc.sleepHours;
    actions.push({
      label: sleep < 7
        ? `Add ${formatSelectedNumber(7 - sleep)} hr sleep`
        : `Keep sleep near ${formatSelectedNumber(sleep)} hr`,
      predictedImpact: `Today: ${formatSelectedNumber(sleep)} hr`,
      source: "current_checkin",
    });
  }

  if (typeof currentDoc.walkMinutes === "number") {
    const walk = currentDoc.walkMinutes;
    actions.push({
      label: walk < 20
        ? `Add ${20 - walk} min movement`
        : `Keep at least ${walk} min movement`,
      predictedImpact: `Today: ${walk} min`,
      source: "current_checkin",
    });
  }

  if (typeof currentDoc.waterGlasses === "number") {
    const water = currentDoc.waterGlasses;
    actions.push({
      label: `Keep hydration near ${water} glasses`,
      predictedImpact: `Today: ${water} glasses`,
      source: "current_checkin",
    });
  }

  return actions.slice(0, 2);
};

export const getRecommendedForTomorrow = (energyFormula, currentDoc = null) => {
  if (!energyFormula || !energyFormula.length) {
    return getCurrentRecommendations(currentDoc);
  }

  const positive = energyFormula
    .filter((rule) => rule.liftPercent > 0)
    .sort((a, b) => b.liftPercent - a.liftPercent)
    .slice(0, 2)
    .map((rule) => ({
      label: RECOMMENDATION_COPY[rule.key] || rule.label,
      predictedImpact: `+${rule.liftPercent}% ${rule.metric}`,
    }));

  if (positive.length >= 2) return positive;
  return positive.length ? positive : getCurrentRecommendations(currentDoc);
};

export const getGoalForecast = (docs, goal) => {
  if (!goal) return null;

  const metric = goal.metric || "energyLevel";
  const sorted = [...docs].sort((a, b) => new Date(a.date) - new Date(b.date));
  const last7 = sorted.slice(-7).map((d) => d[metric]).filter((v) => typeof v === "number");
  const last14 = sorted.slice(-14).map((d) => d[metric]).filter((v) => typeof v === "number");

  const currentValue = average(last7);
  if (currentValue === null) {
    return {
      goal,
      progressPercent: 0,
      etaDays: null,
      capped: false,
      message: "Log a few entries to see your goal forecast.",
    };
  }

  const progressPercent = Math.max(
    0,
    Math.min(100, Math.round((currentValue / goal.targetValue) * 100)),
  );
  const { slope } = linearProjection(last14);

  if (slope <= 0) {
    return {
      goal,
      progressPercent,
      etaDays: null,
      capped: false,
      message: "Keep up consistent habits to start trending toward your goal",
    };
  }

  const rawEtaDays = Math.ceil((goal.targetValue - currentValue) / slope);

  if (rawEtaDays <= 0) {
    return {
      goal,
      progressPercent: 100,
      etaDays: 0,
      capped: false,
      message: "You've reached your goal!",
    };
  }

  if (rawEtaDays > 90) {
    return {
      goal,
      progressPercent,
      etaDays: 90,
      capped: true,
      message: "More than 90 days at current pace",
    };
  }

  return {
    goal,
    progressPercent,
    etaDays: rawEtaDays,
    capped: false,
    message: `At your current pace, you'll reach your goal in ${rawEtaDays} days.`,
  };
};
