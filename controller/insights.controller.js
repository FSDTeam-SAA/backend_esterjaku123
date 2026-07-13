import httpStatus from "http-status";
import { OpenAI } from "openai";
import { Mood } from "../model/mood.model.js";
import { Goal } from "../model/goal.model.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import {
  getEnergyFormula,
  getCurrentSnapshotPatterns,
  getSleepVsEnergyChart,
  getWeeklyTrends,
  detectRiskPattern,
  getTomorrowPrediction,
  getWeekOutlook,
  simulateWhatIf,
  getRecommendedForTomorrow,
  getGoalForecast,
} from "../utils/insightEngine.js";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const insightsModel = process.env.OPENAI_INSIGHTS_MODEL || "gpt-5.4-mini";

const addAiOutlookInsight = async (outlook, docs) => {
  const fallback = {
    ...outlook,
    insightSource: "calculated",
    aiAvailable: Boolean(openai),
    aiStatus: openai ? "failed" : "not_configured",
  };
  if (!openai || !docs.length || !outlook) return fallback;

  const latest = docs[docs.length - 1];
  const metrics = {
    energy: latest.energyLevel ?? null,
    sleepHours: latest.sleepHours ?? null,
    movementMinutes: latest.walkMinutes ?? null,
    hydrationGlasses: latest.waterGlasses ?? null,
    calm: latest.calmLevel ?? null,
    focus: latest.focusLevel ?? null,
    outlookDays: outlook.days,
    outlookEnergy: outlook.series,
  };

  try {
    const response = await openai.responses.create({
      model: insightsModel,
      input: [
        {
          role: "system",
          content:
            "You write concise wellness insights from user-provided tracking data. Use only the supplied numbers. Do not diagnose, make medical claims, or invent trends. Return one supportive sentence under 28 words.",
        },
        {
          role: "user",
          content: `Create the insight from this JSON: ${JSON.stringify(metrics)}`,
        },
      ],
      max_output_tokens: 80,
    });
    const insight = response.output_text?.trim();
    if (!insight) return fallback;
    return {
      ...outlook,
      insight,
      insightSource: "openai",
      aiAvailable: true,
      aiStatus: "generated",
    };
  } catch (error) {
    console.error("OpenAI insights generation failed:", error?.message || error);
    return fallback;
  }
};

const addAiSleepEnergyInsight = async (chart, docs) => {
  if (!chart) return null;
  const fallback = {
    ...chart,
    insightSource: "calculated",
    aiAvailable: Boolean(openai),
    aiStatus: openai ? "failed" : "not_configured",
  };
  if (!openai || !docs.length || !chart.points?.length) return fallback;

  const latest = docs[docs.length - 1];
  const metrics = {
    sleepEnergyPoints: chart.points,
    latestSleepHours: latest.sleepHours ?? null,
    latestEnergy: latest.energyLevel ?? null,
    completedCheckins: docs.length,
  };

  try {
    const response = await openai.responses.create({
      model: insightsModel,
      input: [
        {
          role: "system",
          content:
            "You write concise sleep-and-energy wellness insights from tracking data. Use only supplied numbers. With one point, describe it without claiming a trend. Do not diagnose or make medical claims. Return one sentence under 28 words.",
        },
        {
          role: "user",
          content: `Create the sleep-and-energy insight from this JSON: ${JSON.stringify(metrics)}`,
        },
      ],
      max_output_tokens: 80,
    });
    const insight = response.output_text?.trim();
    if (!insight) return fallback;
    return {
      ...chart,
      insight,
      insightSource: "openai",
      aiAvailable: true,
      aiStatus: "generated",
    };
  } catch (error) {
    console.error(
      "OpenAI sleep-energy insight generation failed:",
      error?.message || error,
    );
    return fallback;
  }
};

const getCompletedHistory = (userId) =>
  Mood.find({
    userId,
    $or: [{ completedAt: { $ne: null } }, { status: true }],
  }).sort({ date: 1 });

const getLatestDoc = (docs) => (docs.length ? docs[docs.length - 1] : null);

// Screen 7 — Discover tab: Energy Formula + tomorrow's prediction.
export const getDiscover = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const docs = await getCompletedHistory(userId);

  const correlations = getEnergyFormula(docs);
  const energyFormula = correlations.length
    ? correlations
    : getCurrentSnapshotPatterns(docs);
  const prediction = getTomorrowPrediction(docs);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Discover insights fetched successfully",
    data: { energyFormula, prediction },
  });
});

// Screen 8 — Patterns tab: same Energy Formula (with observed counts) + chart +
// weekly trends + risk pattern alert.
export const getPatterns = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const docs = await getCompletedHistory(userId);

  const correlations = getEnergyFormula(docs);
  const patterns = correlations.length
    ? correlations
    : getCurrentSnapshotPatterns(docs);
  const calculatedSleepVsEnergyChart = getSleepVsEnergyChart(docs);
  const sleepVsEnergyChart = await addAiSleepEnergyInsight(
    calculatedSleepVsEnergyChart,
    docs,
  );
  const weeklyTrends = getWeeklyTrends(docs);
  const riskPattern = detectRiskPattern(docs);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Pattern insights fetched successfully",
    data: { patterns, sleepVsEnergyChart, weeklyTrends, riskPattern },
  });
});

// Screen 9 — Prediction tab: tomorrow prediction, week outlook, what-if,
// goal forecast, and recommended actions.
export const getPrediction = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const docs = await getCompletedHistory(userId);

  const tomorrow = getTomorrowPrediction(docs);
  const calculatedWeekOutlook = getWeekOutlook(docs);
  const weekOutlook = await addAiOutlookInsight(calculatedWeekOutlook, docs);
  const whatIf = simulateWhatIf(docs, getLatestDoc(docs));
  const energyFormula = getEnergyFormula(docs);
  const recommended = getRecommendedForTomorrow(
    energyFormula,
    getLatestDoc(docs),
  );

  const activeGoal = await Goal.findOne({ userId, isActive: true });
  const goalForecast = getGoalForecast(docs, activeGoal);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Prediction insights fetched successfully",
    data: { tomorrow, weekOutlook, whatIf, goalForecast, recommended },
  });
});

// Standalone "What if you..." slice, reused by the Check step (Screen 3) and
// also bundled inside getPrediction for the Prediction tab (Screen 9).
export const getWhatIf = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const docs = await getCompletedHistory(userId);

  const whatIf = simulateWhatIf(docs, getLatestDoc(docs));

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "What-if predictions fetched successfully",
    data: whatIf,
  });
});
