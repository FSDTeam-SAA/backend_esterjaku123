import httpStatus from "http-status";
import { OpenAI } from "openai";
import { Mood } from "../model/mood.model.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import { getTodayFlowState } from "./mood.controller.js";
import {
  getEnergyFormula,
  getTopCorrelation,
  COLD_START_FALLBACK,
} from "../utils/insightEngine.js";
import { getWordValue, formatSleep, getMoodEmoji } from "../utils/wellnessThresholds.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const QUOTES = [
  { text: "Take care of your body. It's the only place you have to live.", author: "Jim Rohn" },
  { text: "Almost everything will work again if you unplug it for a few minutes, including you.", author: "Anne Lamott" },
  { text: "You don't have to see the whole staircase, just take the first step.", author: "Martin Luther King Jr." },
  { text: "Self-care is not self-indulgence, it is self-preservation.", author: "Audre Lorde" },
  { text: "What lies behind us and what lies before us are tiny matters compared to what lies within us.", author: "Ralph Waldo Emerson" },
  { text: "The greatest wealth is health.", author: "Virgil" },
  { text: "Rest when you're weary. Refresh and renew yourself.", author: "Ralph Marston" },
  { text: "Small steps every day add up to big change.", author: "Unknown" },
];

const SUGGESTED_ACTIONS = [
  "Try a 10 minutes walk today!",
  "Drink a glass of water right now.",
  "Take 5 deep breaths before you start your day.",
  "Step outside for a minute of sunlight.",
  "Write down one thing you're grateful for.",
];

const MOOD_ENCOURAGEMENT = {
  Terrible: "It's okay to have a hard day — be gentle with yourself.",
  Poor: "Small steps count. You're doing better than you think.",
  Okay: "You're doing okay — small steps count today.",
  Good: "You're doing well. Keep going!",
  Amazing: "You're glowing today — keep that energy up!",
};

const getDayOfYear = () => {
  const startOfYear = new Date(new Date().getFullYear(), 0, 0);
  return Math.floor((Date.now() - startOfYear) / 86400000);
};

// Fed the already-computed deterministic top correlation; OpenAI only wordsmiths
// the sentence, it never invents the percentage itself.
const generateInsightSentence = async (topCorrelation) => {
  if (!topCorrelation) {
    return COLD_START_FALLBACK.insightSentence;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: `Write one short encouraging sentence (under 20 words) stating that the user's ${topCorrelation.metric} improves by ${topCorrelation.liftPercent}% on days with more ${topCorrelation.label.toLowerCase()}. Be specific and factual, do not invent numbers.`,
        },
      ],
    });
    return (
      response.choices[0]?.message?.content?.trim() ||
      COLD_START_FALLBACK.insightSentence
    );
  } catch (error) {
    return `Your ${topCorrelation.metric} improves by ${topCorrelation.liftPercent}% on days with more ${topCorrelation.label.toLowerCase()}.`;
  }
};

export const getTodayDashboard = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const user = req.user;

  const { doc, showGoodMorningModal } = await getTodayFlowState(userId);

  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const displayName = user.name || "there";
  const greeting = `Good ${timeOfDay}, ${displayName}`;

  let moodToday = null;
  let summary = null;
  if (doc?.completedAt) {
    moodToday = {
      label: doc.moodLabel,
      emoji: getMoodEmoji(doc.moodScore),
      encouragement:
        MOOD_ENCOURAGEMENT[doc.moodLabel] || "Keep checking in with yourself today.",
    };
    summary = {
      sleep: { value: formatSleep(doc.sleepHours), quality: doc.sleepQuality },
      stress: {
        value: getWordValue("stress", doc.stressLevel),
        quality: doc.stressQuality,
      },
      energy: {
        value: getWordValue("energy", doc.energyLevel),
        quality: doc.energyQuality,
      },
    };
  }

  const dayOfYear = getDayOfYear();
  const quote = QUOTES[dayOfYear % QUOTES.length];
  const suggestedAction = SUGGESTED_ACTIONS[(dayOfYear + 3) % SUGGESTED_ACTIONS.length];

  const movement = {
    minutes: doc?.walkMinutes || 0,
    label: `${doc?.walkMinutes || 0}m`,
  };
  const hydration = {
    glasses: doc?.waterGlasses || 0,
    label: `${doc?.waterGlasses || 0} glasses`,
  };

  const history = await Mood.find({ userId, completedAt: { $ne: null } }).sort({
    date: 1,
  });
  const energyFormula = getEnergyFormula(history);
  const topCorrelation = getTopCorrelation(energyFormula);
  const aiInsightSentence = await generateInsightSentence(topCorrelation);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Today's dashboard fetched successfully",
    data: {
      greeting,
      goodMorningModal: showGoodMorningModal
        ? {
            greeting: `Hey, ${displayName}!`,
            title: "Good Morning.",
            cta: "Share Thoughts",
          }
        : null,
      moodToday,
      summary,
      quote: { ...quote, suggestedAction },
      movement,
      hydration,
      aiInsight: {
        sentence: aiInsightSentence,
        viewFullAnalysisPath: "/insights/discover",
      },
    },
  });
});
