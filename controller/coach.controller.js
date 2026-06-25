import httpStatus from "http-status";
import { OpenAI } from "openai";
import { CoachMessage } from "../model/coachMessage.model.js";
import { Mood } from "../model/mood.model.js";
import { Journal } from "../model/journal.model.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const HISTORY_WINDOW = 10;
const NUDGE_THROTTLE_MS = 2 * 60 * 60 * 1000; // 2 hours — guards against a misfiring client idle-timer spamming nudges

// Single entry today (matches the one proactive-nudge example in the design), kept as an
// array so more variants can be added later without changing the API shape.
const NUDGE_MESSAGES = [
  {
    text: "Hey, you've been working for quite some time. Take a little break!",
    quickReplies: [
      "Grab a snack and recharge your energy.",
      "Take a short walk and come back refreshed.",
    ],
  },
];

const average = (nums) => {
  const valid = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (!valid.length) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
};

const buildContextSummary = async (userId) => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const recentMoods = await Mood.find({
    userId,
    completedAt: { $ne: null },
    date: { $gte: sevenDaysAgo },
  }).sort({ date: -1 });

  const recentJournals = await Journal.find({ userId }).sort({ date: -1 }).limit(3);

  let moodSummary = "No recent mood logs.";
  if (recentMoods.length) {
    const avgEnergy = average(recentMoods.map((m) => m.energyLevel));
    const avgCalm = average(recentMoods.map((m) => m.calmLevel));
    const avgFocus = average(recentMoods.map((m) => m.focusLevel));
    const avgSleep = average(recentMoods.map((m) => m.sleepHours));
    const avgWater = average(recentMoods.map((m) => m.waterGlasses));
    const avgWalk = average(recentMoods.map((m) => m.walkMinutes));
    const dominantMood = recentMoods[0]?.moodLabel || "Okay";

    moodSummary = `Dominant recent mood: ${dominantMood}. Avg energy ${avgEnergy ?? "n/a"}/100, calm ${avgCalm ?? "n/a"}/100, focus ${avgFocus ?? "n/a"}/100. Avg sleep ${avgSleep ?? "n/a"}hrs, water ${avgWater ?? "n/a"} glasses, walk ${avgWalk ?? "n/a"} min/day.`;
  }

  let journalSummary = "No recent journal entries.";
  if (recentJournals.length) {
    journalSummary = recentJournals
      .map((j) => `"${j.title}" — ${j.description.slice(0, 100)}`)
      .join(" | ");
  }

  return { moodSummary, journalSummary };
};

const buildSystemPrompt = ({ moodSummary, journalSummary }) =>
  `You are Ester's supportive wellness coach inside a mood-tracking app. Be warm, brief (under 60 words), practical, and never give medical advice. Use the context below to personalize your reply when relevant, but do not recite raw numbers back robotically.

Recent mood summary (last 7 days): ${moodSummary}
Recent journal themes: ${journalSummary}

If it would naturally help to offer the user a quick follow-up action, end your reply on its own new line formatted exactly as: SUGGESTIONS: reply one|reply two (at most 2, pipe-delimited). Omit that line entirely otherwise.`;

const parseQuickReplies = (rawText) => {
  const lines = rawText.split("\n");
  const suggestionLineIndex = lines.findIndex((line) =>
    line.trim().toUpperCase().startsWith("SUGGESTIONS:"),
  );

  if (suggestionLineIndex === -1) {
    return { text: rawText.trim(), quickReplies: [] };
  }

  const suggestionLine = lines[suggestionLineIndex];
  const quickReplies = suggestionLine
    .split(":")
    .slice(1)
    .join(":")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2);

  const text = lines
    .filter((_, i) => i !== suggestionLineIndex)
    .join("\n")
    .trim();

  return { text, quickReplies };
};

export const getCoachHistory = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { limit = 50, before } = req.query;

  const filter = { userId };
  if (before) filter.createdAt = { $lt: new Date(before) };

  const messages = await CoachMessage.find(filter)
    .sort({ createdAt: -1 })
    .limit(Number(limit));

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Coach chat history fetched successfully",
    data: messages.reverse(),
  });
});

export const sendCoachMessage = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { text } = req.body;

  if (!text || !text.toString().trim()) {
    throw new AppError(httpStatus.BAD_REQUEST, "Message text is required");
  }
  if (text.toString().length > 1000) {
    throw new AppError(httpStatus.BAD_REQUEST, "Message is too long");
  }

  const userMessage = await CoachMessage.create({
    userId,
    sender: "user",
    text: text.toString().trim(),
  });

  const recentHistory = await CoachMessage.find({ userId })
    .sort({ createdAt: -1 })
    .limit(HISTORY_WINDOW);
  const orderedHistory = recentHistory.reverse();

  const context = await buildContextSummary(userId);
  const systemPrompt = buildSystemPrompt(context);

  const messages = [
    { role: "system", content: systemPrompt },
    ...orderedHistory.map((m) => ({
      role: m.sender === "coach" ? "assistant" : "user",
      content: m.text,
    })),
  ];

  let replyText = "I'm here for you — tell me more about how you're feeling.";
  let quickReplies = [];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages,
    });
    const raw = response.choices[0]?.message?.content || replyText;
    const parsed = parseQuickReplies(raw);
    replyText = parsed.text || replyText;
    quickReplies = parsed.quickReplies;
  } catch (error) {
    // Fall back to the default supportive reply above instead of failing the request.
  }

  const coachMessage = await CoachMessage.create({
    userId,
    sender: "coach",
    text: replyText,
    quickReplies,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Coach reply generated successfully",
    data: { userMessage, coachMessage },
  });
});

// Frontend-initiated proactive nudge (idle timer), not cron — see plan rationale:
// only the client knows whether the user is actively mid-session right now.
export const triggerNudge = catchAsync(async (req, res) => {
  const userId = req.user._id;

  const lastNudge = await CoachMessage.findOne({
    userId,
    nudgeType: "idle_break",
  }).sort({ createdAt: -1 });

  if (lastNudge && Date.now() - lastNudge.createdAt.getTime() < NUDGE_THROTTLE_MS) {
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Nudge skipped — throttled",
      data: { skipped: true },
    });
  }

  const template = NUDGE_MESSAGES[Math.floor(Math.random() * NUDGE_MESSAGES.length)];

  const coachMessage = await CoachMessage.create({
    userId,
    sender: "coach",
    text: template.text,
    quickReplies: template.quickReplies,
    nudgeType: "idle_break",
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Nudge sent successfully",
    data: { skipped: false, coachMessage },
  });
});
