import httpStatus from "http-status";
import { OpenAI } from "openai";
import { Mood } from "../model/mood.model.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import { simulateWhatIf } from "../utils/insightEngine.js";
import {
  MOOD_SCORES,
  CONTEXT_TAGS,
  getMoodLabel,
  getMoodEmoji,
  getQualityLabel,
  getWordValue,
  formatSleep,
  deriveStressLevel,
} from "../utils/wellnessThresholds.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const getStartOfDay = (baseDate = new Date()) => {
  const start = new Date(baseDate);
  start.setHours(0, 0, 0, 0);
  return start;
};

const getEndOfDay = (baseDate = new Date()) => {
  const end = new Date(baseDate);
  end.setHours(23, 59, 59, 999);
  return end;
};

const findTodayDoc = (userId) =>
  Mood.findOne({
    userId,
    date: { $gte: getStartOfDay(), $lte: getEndOfDay() },
  });

const validatePercent = (value, fieldName) => {
  const num = Number(value);
  if (Number.isNaN(num) || num < 0 || num > 100) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `${fieldName} must be a number between 0 and 100`,
    );
  }
  return num;
};

// AI-generated motivation, reusing the same single-turn OpenAI pattern as before.
const generateMotivation = async (moodLabel) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: `Generate a unique motivational message for someone feeling ${moodLabel}. Make it positive and encouraging. Keep it under 20 words.`,
        },
      ],
    });
    return response.choices[0].message.content;
  } catch (error) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Failed to generate motivational message",
    );
  }
};

// Returns today's reflection state for any feature that needs to know "where is
// the user in the Mind/Body/Check flow" (e.g. the home dashboard's Good Morning modal).
export const getTodayFlowState = async (userId) => {
  const doc = await findTodayDoc(userId);

  const mindDone = Boolean(doc?.mindCompletedAt);
  const bodyDone = Boolean(doc?.bodyCompletedAt);
  const completed = Boolean(doc?.completedAt);

  return {
    doc,
    started: Boolean(doc),
    mindDone,
    bodyDone,
    completed,
    showGoodMorningModal: !mindDone,
  };
};

// Step 1 — Mind: mood scale + Energy/Calm/Focus sliders + context tags.
export const submitMind = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { moodScore, energyLevel, calmLevel, focusLevel, contextTags, aiSuggestedTags } =
    req.body;

  const score = Number(moodScore);
  if (!MOOD_SCORES.includes(score)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid or missing moodScore");
  }

  const fields = {
    moodScore: score,
    moodLabel: getMoodLabel(score),
    energyLevel: validatePercent(energyLevel, "energyLevel"),
    calmLevel: validatePercent(calmLevel, "calmLevel"),
    focusLevel: validatePercent(focusLevel, "focusLevel"),
    contextTags: Array.isArray(contextTags) ? contextTags : [],
    aiSuggestedTags: Array.isArray(aiSuggestedTags) ? aiSuggestedTags : [],
    mindCompletedAt: new Date(),
  };

  let doc = await findTodayDoc(userId);
  if (doc) {
    Object.assign(doc, fields);
    await doc.save();
  } else {
    doc = await Mood.create({ userId, date: getStartOfDay(), ...fields });
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Mind step saved successfully",
    data: { mood: doc, nextStep: "body" },
  });
});

// AI Suggestion chip on the Mind step — suggests context tags constrained to CONTEXT_TAGS.
export const suggestContextTags = catchAsync(async (req, res) => {
  const { moodScore, energyLevel, calmLevel, focusLevel } = req.body;
  const moodLabel = getMoodLabel(Number(moodScore)) || "Okay";

  let suggested = [];
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: `A user feels "${moodLabel}" with energy ${energyLevel ?? "unknown"}/100, calm ${calmLevel ?? "unknown"}/100, focus ${focusLevel ?? "unknown"}/100. Pick the 3-4 best matching words ONLY from this exact list: ${CONTEXT_TAGS.join(", ")}. Respond with ONLY a comma-separated list using words from that list, nothing else.`,
        },
      ],
    });
    const raw = response.choices[0]?.message?.content || "";
    suggested = raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => CONTEXT_TAGS.includes(t));
  } catch (error) {
    suggested = [];
  }

  if (!suggested.length) {
    suggested = Number(energyLevel) >= 60 ? ["Motivated", "Focused"] : ["Tired", "Calm"];
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Context tag suggestions generated successfully",
    data: { suggestedTags: [...new Set(suggested)].slice(0, 4) },
  });
});

// Step 2 — Body: water / sleep / walk + thoughts. Also computes the derived
// Stress/Sleep/Energy quality badges needed by the Check step and dashboard.
export const submitBody = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { waterGlasses, sleepHours, walkMinutes, thoughts } = req.body;

  const doc = await findTodayDoc(userId);
  if (!doc || !doc.mindCompletedAt) {
    throw new AppError(httpStatus.BAD_REQUEST, "Complete the Mind step first");
  }

  if (waterGlasses !== undefined) {
    doc.waterGlasses = Math.min(20, Math.max(0, Number(waterGlasses)));
  }
  if (sleepHours !== undefined) {
    doc.sleepHours = Math.min(14, Math.max(0, Number(sleepHours)));
  }
  if (walkMinutes !== undefined) {
    doc.walkMinutes = Math.min(240, Math.max(0, Number(walkMinutes)));
  }
  if (thoughts !== undefined) {
    doc.thoughts = thoughts;
  }

  doc.stressLevel = deriveStressLevel(doc.calmLevel);
  doc.sleepQuality = getQualityLabel("sleep", doc.sleepHours);
  doc.stressQuality = getQualityLabel("stress", doc.stressLevel);
  doc.energyQuality = getQualityLabel("energy", doc.energyLevel);
  doc.bodyCompletedAt = new Date();

  await doc.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Body step saved successfully",
    data: { mood: doc, nextStep: "check" },
  });
});

// Step 3 — Check: read-only recap + "What if you..." predictions, computed fresh.
export const getCheck = catchAsync(async (req, res) => {
  const userId = req.user._id;

  const doc = await findTodayDoc(userId);
  if (!doc || !doc.bodyCompletedAt) {
    throw new AppError(httpStatus.BAD_REQUEST, "Complete the Body step first");
  }

  const history = await Mood.find({
    userId,
    completedAt: { $ne: null },
    _id: { $ne: doc._id },
  }).sort({ date: 1 });

  const whatIf = simulateWhatIf(history, doc);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Check step fetched successfully",
    data: {
      mood: {
        moodScore: doc.moodScore,
        moodLabel: doc.moodLabel,
        emoji: getMoodEmoji(doc.moodScore),
      },
      sleep: { value: formatSleep(doc.sleepHours), quality: doc.sleepQuality },
      stress: {
        value: getWordValue("stress", doc.stressLevel),
        quality: doc.stressQuality,
      },
      energy: {
        value: getWordValue("energy", doc.energyLevel),
        quality: doc.energyQuality,
      },
      thoughts: doc.thoughts,
      whatIf,
      completed: Boolean(doc.completedAt),
    },
  });
});

// "Complete Reflection" — idempotent finalize of today's entry.
export const completeReflection = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { thoughts } = req.body;

  const doc = await findTodayDoc(userId);
  if (!doc || !doc.bodyCompletedAt) {
    throw new AppError(httpStatus.BAD_REQUEST, "Complete the Body step first");
  }

  if (thoughts !== undefined) {
    doc.thoughts = thoughts;
  }

  if (!doc.completedAt) {
    doc.completedAt = new Date();
    doc.status = true;
  }

  await doc.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reflection completed successfully",
    data: doc,
  });
});

export const getTodayMood = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { doc, started, mindDone, bodyDone, completed, showGoodMorningModal } =
    await getTodayFlowState(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Today's mood fetched successfully",
    data: {
      mood: doc,
      flow: { started, mindDone, bodyDone, completed, showGoodMorningModal },
    },
  });
});

// Get weekly logs (structured for 7 days: Today, Yesterday, etc.)
export const getWeeklyLogs = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const logs = await Mood.find({
    userId,
    date: { $gte: sevenDaysAgo },
  }).sort({ date: -1 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const structuredLogs = logs.map((log) => {
    const logDate = new Date(log.date);
    let dayLabel;
    if (logDate.toDateString() === today.toDateString()) {
      dayLabel = "Today";
    } else if (logDate.getDate() === today.getDate() - 1) {
      dayLabel = "Yesterday";
    } else {
      dayLabel = logDate.toLocaleDateString("en-US", { weekday: "long" });
    }
    return {
      day: dayLabel,
      date: log.date.toISOString().split("T")[0],
      moodScore: log.moodScore,
      moodLabel: log.moodLabel,
      emoji: getMoodEmoji(log.moodScore),
      completed: Boolean(log.completedAt),
    };
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Weekly logs fetched successfully",
    data: structuredLogs,
  });
});

// Get all moods for the current user
export const getAllMoods = catchAsync(async (req, res) => {
  const userId = req.user._id;

  const moods = await Mood.find({ userId }).sort({ date: -1 });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "All moods for current user fetched successfully",
    data: moods,
  });
});

export const getMoodDetails = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { moodId } = req.params;

  if (!moodId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Mood ID is required");
  }

  const log = await Mood.findOne({ _id: moodId, userId });

  if (!log) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "No mood log found with the specified ID",
    );
  }

  const motivation = log.moodLabel ? await generateMotivation(log.moodLabel) : null;

  const enhancedLog = {
    ...log.toObject(),
    emoji: getMoodEmoji(log.moodScore),
    motivation,
    sleep: { value: formatSleep(log.sleepHours), quality: log.sleepQuality },
    stress: {
      value: getWordValue("stress", log.stressLevel),
      quality: log.stressQuality,
    },
    energy: {
      value: getWordValue("energy", log.energyLevel),
      quality: log.energyQuality,
    },
  };

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Mood details fetched successfully by ID",
    data: enhancedLog,
  });
});
