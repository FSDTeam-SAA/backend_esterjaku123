import httpStatus from "http-status";
import { Journal } from "../model/journal.model.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import {
  MOOD_SCORES,
  WIN_CATEGORIES,
  getMoodEmoji,
} from "../utils/wellnessThresholds.js";

const RECENT_PROMPTS = [
  "What made you feel most grateful today?",
  "What's on your mind lately?",
  "What would make tomorrow great?",
  "What's one thing you're proud of today?",
  "What drained your energy today?",
  "What's a small win you almost overlooked?",
];

const WIN_CATEGORY_ICONS = {
  "Kind to myself": "heart",
  "Got things done": "check-circle",
  "Spent time with someone": "people",
  "Took care of my health": "clover",
  "Learned something": "book",
  "Something else": "star",
};

// Date-seeded so the 3 prompts shown stay stable for the whole day instead of
// reshuffling on every refresh, while still rotating day to day.
const getDailyPrompts = (count = 3) => {
  const startOfYear = new Date(new Date().getFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.now() - startOfYear) / 86400000);
  return Array.from(
    { length: count },
    (_, i) => RECENT_PROMPTS[(dayOfYear + i) % RECENT_PROMPTS.length],
  );
};

export const createJournalEntry = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const {
    type = "freewrite",
    title,
    description,
    moodScore,
    tags,
    winCategory,
    promptUsed,
  } = req.body;

  if (!["freewrite", "win"].includes(type)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid entry type");
  }
  if (!title || !title.toString().trim()) {
    throw new AppError(httpStatus.BAD_REQUEST, "Title is required");
  }
  if (!description || !description.toString().trim()) {
    throw new AppError(httpStatus.BAD_REQUEST, "Description is required");
  }
  if (moodScore !== undefined && !MOOD_SCORES.includes(Number(moodScore))) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid moodScore");
  }
  if (type === "win" && !WIN_CATEGORIES.includes(winCategory)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "winCategory is required for win entries",
    );
  }

  const entry = await Journal.create({
    userId,
    type,
    title: title.toString().trim(),
    description: description.toString().trim(),
    moodScore: moodScore !== undefined ? Number(moodScore) : undefined,
    tags: type === "freewrite" && Array.isArray(tags) ? tags : [],
    winCategory: type === "win" ? winCategory : undefined,
    promptUsed,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Journal entry created successfully",
    data: entry,
  });
});

export const getJournalList = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { type, page = 1, limit = 20 } = req.query;

  const filter = { userId };
  if (type) filter.type = type;

  const skip = (Number(page) - 1) * Number(limit);

  const [entries, total] = await Promise.all([
    Journal.find(filter).sort({ date: -1 }).skip(skip).limit(Number(limit)),
    Journal.countDocuments(filter),
  ]);

  const formattedEntries = entries.map((entry) => ({
    _id: entry._id,
    type: entry.type,
    title: entry.title,
    snippet: entry.description.slice(0, 140),
    moodScore: entry.moodScore,
    emoji: getMoodEmoji(entry.moodScore),
    date: entry.date,
    tags: entry.tags,
    winCategory: entry.winCategory,
  }));

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Journal entries fetched successfully",
    data: {
      entries: formattedEntries,
      pagination: { page: Number(page), limit: Number(limit), total },
      recentPrompts: getDailyPrompts(3),
    },
  });
});

export const getJournalEntry = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { id } = req.params;

  const entry = await Journal.findOne({ _id: id, userId });
  if (!entry) {
    throw new AppError(httpStatus.NOT_FOUND, "Journal entry not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Journal entry fetched successfully",
    data: { ...entry.toObject(), emoji: getMoodEmoji(entry.moodScore) },
  });
});

export const updateJournalEntry = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { id } = req.params;
  const { title, description, moodScore, tags, winCategory, promptUsed } = req.body;

  const entry = await Journal.findOne({ _id: id, userId });
  if (!entry) {
    throw new AppError(httpStatus.NOT_FOUND, "Journal entry not found");
  }

  if (title !== undefined) entry.title = title.toString().trim();
  if (description !== undefined) entry.description = description.toString().trim();
  if (moodScore !== undefined) {
    if (!MOOD_SCORES.includes(Number(moodScore))) {
      throw new AppError(httpStatus.BAD_REQUEST, "Invalid moodScore");
    }
    entry.moodScore = Number(moodScore);
  }
  if (entry.type === "freewrite" && Array.isArray(tags)) {
    entry.tags = tags;
  }
  if (entry.type === "win" && winCategory !== undefined) {
    if (!WIN_CATEGORIES.includes(winCategory)) {
      throw new AppError(httpStatus.BAD_REQUEST, "Invalid winCategory");
    }
    entry.winCategory = winCategory;
  }
  if (promptUsed !== undefined) entry.promptUsed = promptUsed;

  await entry.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Journal entry updated successfully",
    data: entry,
  });
});

export const deleteJournalEntry = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { id } = req.params;

  const entry = await Journal.findOneAndDelete({ _id: id, userId });
  if (!entry) {
    throw new AppError(httpStatus.NOT_FOUND, "Journal entry not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Journal entry deleted successfully",
    data: null,
  });
});

// Lets the frontend render the "Today's Win" category chips without hardcoding them.
export const getWinCategories = catchAsync(async (req, res) => {
  const categories = WIN_CATEGORIES.map((label) => ({
    label,
    icon: WIN_CATEGORY_ICONS[label],
  }));

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Win categories fetched successfully",
    data: categories,
  });
});
