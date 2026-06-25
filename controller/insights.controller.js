import httpStatus from "http-status";
import { Mood } from "../model/mood.model.js";
import { Goal } from "../model/goal.model.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import {
  getEnergyFormula,
  getSleepVsEnergyChart,
  getWeeklyTrends,
  detectRiskPattern,
  getTomorrowPrediction,
  getWeekOutlook,
  simulateWhatIf,
  getRecommendedForTomorrow,
  getGoalForecast,
} from "../utils/insightEngine.js";

const getCompletedHistory = (userId) =>
  Mood.find({ userId, completedAt: { $ne: null } }).sort({ date: 1 });

const getLatestDoc = (docs) => (docs.length ? docs[docs.length - 1] : null);

// Screen 7 — Discover tab: Energy Formula + tomorrow's prediction.
export const getDiscover = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const docs = await getCompletedHistory(userId);

  const energyFormula = getEnergyFormula(docs);
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

  const patterns = getEnergyFormula(docs);
  const sleepVsEnergyChart = getSleepVsEnergyChart(docs);
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
  const weekOutlook = getWeekOutlook(docs);
  const whatIf = simulateWhatIf(docs, getLatestDoc(docs));
  const energyFormula = getEnergyFormula(docs);
  const recommended = getRecommendedForTomorrow(energyFormula);

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
