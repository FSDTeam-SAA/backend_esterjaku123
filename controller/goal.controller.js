import httpStatus from "http-status";
import { Goal } from "../model/goal.model.js";
import { Mood } from "../model/mood.model.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import { getGoalForecast } from "../utils/insightEngine.js";

const METRIC_DISPLAY_NAMES = {
  energyLevel: "energy",
  calmLevel: "calm",
  focusLevel: "focus",
};

export const createGoal = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { metric = "energyLevel", targetValue } = req.body;

  if (!METRIC_DISPLAY_NAMES[metric]) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid metric");
  }

  const target = Number(targetValue);
  if (Number.isNaN(target) || target < 0 || target > 100) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "targetValue must be a number between 0 and 100",
    );
  }

  // Only one active goal per user — deactivate any prior one rather than enforcing
  // a DB constraint, so past goals remain in history.
  await Goal.updateMany({ userId, isActive: true }, { isActive: false });

  const goal = await Goal.create({
    userId,
    metric,
    targetValue: target,
    label: `Reach ${target} ${METRIC_DISPLAY_NAMES[metric]} score`,
    isActive: true,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Goal created successfully",
    data: goal,
  });
});

export const getActiveGoal = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const goal = await Goal.findOne({ userId, isActive: true });

  if (!goal) {
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "No active goal set",
      data: { goal: null },
    });
  }

  const docs = await Mood.find({ userId, completedAt: { $ne: null } }).sort({
    date: 1,
  });
  const forecast = getGoalForecast(docs, goal);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Active goal forecast fetched successfully",
    data: forecast,
  });
});

export const getGoalHistory = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const goals = await Goal.find({ userId }).sort({ createdAt: -1 });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Goal history fetched successfully",
    data: goals,
  });
});
