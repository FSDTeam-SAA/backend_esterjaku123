import httpStatus from "http-status";
import { OpenAI } from "openai";
import { CoachMessage } from "../model/coachMessage.model.js";
import { Mood } from "../model/mood.model.js";
import { Journal } from "../model/journal.model.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const COACH_MODEL = process.env.OPENAI_COACH_MODEL || "gpt-4o-mini";

const HISTORY_WINDOW = 10;
const NUDGE_THROTTLE_MS = 2 * 60 * 60 * 1000; // 2 hours — guards against a misfiring client idle-timer spamming nudges
const STREAM_HEARTBEAT_MS = 15 * 1000;
const DEFAULT_REPLY =
  "I'm here for you — tell me more about how you're feeling.";

const FALLBACK_REPLIES = {
  unwell: [
    "I'm sorry you're feeling unwell. Rest, sip fluids, and consider checking your temperature. If symptoms are severe or getting worse, contact a healthcare professional.",
    "Feeling ill can drain you. Keep things gentle, hydrate, and seek medical advice if the fever is high, persistent, or comes with worrying symptoms.",
  ],
  tired: [
    "That sounds exhausting. If you can, take a short screen break, drink some water, and choose one small task for the rest of today.",
    "Your body may be asking for a slower pace. Would a ten-minute rest or an earlier bedtime feel more realistic today?",
  ],
  stress: [
    "That sounds like a lot to carry. Try one slow breath out longer than in, then name the single thing creating the most pressure.",
    "Let's make this smaller together. What is one part you can pause, delegate, or finish in ten minutes?",
  ],
  lowMood: [
    "I'm glad you said it out loud. You don't need to fix everything now—would connection, quiet, or one tiny completed task help most?",
    "That sounds painful. Be gentle with yourself today, and consider reaching out to someone you trust so you don't have to hold it alone.",
  ],
  positive: [
    "That's good to hear. What helped create that feeling today, and how could you make a little room for it again tomorrow?",
    "Let's protect that momentum. Name one choice from today that you would genuinely like to repeat.",
  ],
  general: [
    "I'm listening. What happened just before you started feeling this way?",
    "Thank you for checking in. Would you like to unpack the feeling, make a small plan, or simply have a calm moment?",
    "We can take this one step at a time. What would feel most supportive right now?",
  ],
};

const getFallbackCategory = (text) => {
  const value = text.toLowerCase();
  if (/fever|unwell|sick|ill|pain|temperature/.test(value)) return "unwell";
  if (/tired|sleep|exhaust|fatigue|drained|break/.test(value)) return "tired";
  if (/stress|anxious|anxiety|overwhelm|pressure|panic/.test(value)) return "stress";
  if (/sad|down|lonely|hopeless|cry|upset/.test(value)) return "lowMood";
  if (/happy|good|great|better|excited|proud/.test(value)) return "positive";
  return "general";
};

export const buildContextualFallback = (text, recentCoachTexts = []) => {
  const replies = FALLBACK_REPLIES[getFallbackCategory(text)] || FALLBACK_REPLIES.general;
  const normalizedRecent = new Set(
    recentCoachTexts.map((item) => item?.toString().trim()).filter(Boolean),
  );
  return replies.find((reply) => !normalizedRecent.has(reply)) || replies[0] || DEFAULT_REPLY;
};

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
  `You are Unfiltered's supportive wellness coach inside a mood-tracking app. Be warm, brief (under 60 words), practical, and never give medical advice. Use the context below to personalize your reply when relevant, but do not recite raw numbers back robotically.

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

  const fallbackReply = buildContextualFallback(
    text.toString(),
    orderedHistory
      .filter((message) => message.sender === "coach")
      .map((message) => message.text),
  );
  let replyText = fallbackReply;
  let quickReplies = [];

  try {
    const response = await openai.chat.completions.create({
      model: COACH_MODEL,
      messages,
    });
    const raw = response.choices[0]?.message?.content || replyText;
    const parsed = parseQuickReplies(raw);
    replyText = parsed.text || replyText;
    quickReplies = parsed.quickReplies;
  } catch (error) {
    console.error(
      "OpenAI coach generation failed; using contextual fallback:",
      error?.status || error?.code || error?.message || "unknown error",
    );
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

const writeStreamEvent = (res, payload) => {
  if (res.destroyed || res.writableEnded) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

// Streams the assistant response token-by-token using Server-Sent Events.
// The completed user/coach pair is persisted with the same shape as the
// buffered endpoint so chat history remains the source of truth.
export const streamCoachMessage = async (req, res, next) => {
  const userId = req.user._id;
  const text = req.body?.text?.toString().trim();

  if (!text) {
    return next(
      new AppError(httpStatus.BAD_REQUEST, "Message text is required"),
    );
  }
  if (text.length > 1000) {
    return next(new AppError(httpStatus.BAD_REQUEST, "Message is too long"));
  }

  res.status(httpStatus.OK);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // Confirm the SSE connection before database/OpenAI work starts. Once this
  // is sent the app will not retry the buffered route and duplicate a message.
  writeStreamEvent(res, { type: "ready" });

  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": heartbeat\n\n");
  }, STREAM_HEARTBEAT_MS);

  const abortController = new AbortController();
  res.on("close", () => abortController.abort());

  let rawReply = "";
  let emittedReplyLength = 0;
  let userMessage;

  const emitAvailableReply = ({ final = false } = {}) => {
    const marker = "\nSUGGESTIONS:";
    const markerIndex = rawReply.toUpperCase().indexOf(marker);
    const safeEnd =
      markerIndex >= 0
        ? markerIndex
        : final
          ? rawReply.length
          : Math.max(0, rawReply.length - marker.length);

    if (safeEnd <= emittedReplyLength) return;
    writeStreamEvent(res, {
      type: "delta",
      delta: rawReply.slice(emittedReplyLength, safeEnd),
    });
    emittedReplyLength = safeEnd;
  };

  try {
    userMessage = await CoachMessage.create({
      userId,
      sender: "user",
      text,
    });

    const recentHistory = await CoachMessage.find({ userId })
      .sort({ createdAt: -1 })
      .limit(HISTORY_WINDOW);
    const orderedHistory = recentHistory.reverse();
    const fallbackReply = buildContextualFallback(
      text,
      orderedHistory
        .filter((message) => message.sender === "coach")
        .map((message) => message.text),
    );
    const context = await buildContextSummary(userId);
    const messages = [
      { role: "system", content: buildSystemPrompt(context) },
      ...orderedHistory.map((message) => ({
        role: message.sender === "coach" ? "assistant" : "user",
        content: message.text,
      })),
    ];

    try {
      const stream = await openai.chat.completions.create(
        {
          model: COACH_MODEL,
          messages,
          stream: true,
        },
        { signal: abortController.signal },
      );

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || "";
        if (!delta) continue;
        rawReply += delta;
        // Hold a short tail so the private SUGGESTIONS control line never
        // flashes inside the visible message bubble.
        emitAvailableReply();
      }
    } catch (error) {
      // If OpenAI fails before producing content, keep the chat usable with a
      // supportive fallback. A partial answer is retained when already sent.
      if (!rawReply.trim()) {
        rawReply = fallbackReply;
      }
      console.error(
        "OpenAI coach stream failed; using contextual fallback:",
        error?.status || error?.code || error?.message || "unknown error",
      );
    }

    emitAvailableReply({ final: true });
    const parsed = parseQuickReplies(rawReply);
    const coachMessage = await CoachMessage.create({
      userId,
      sender: "coach",
      text: parsed.text || fallbackReply,
      quickReplies: parsed.quickReplies,
    });

    writeStreamEvent(res, {
      type: "done",
      userMessage,
      coachMessage,
    });
  } catch (error) {
    writeStreamEvent(res, {
      type: "error",
      message: "The coach could not respond right now. Please try again.",
    });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
};

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
