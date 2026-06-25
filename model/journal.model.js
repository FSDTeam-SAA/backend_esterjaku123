import mongoose from "mongoose";
import { MOOD_SCORES, WIN_CATEGORIES } from "../utils/wellnessThresholds.js";

const journalSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["freewrite", "win"],
      required: true,
      default: "freewrite",
    },
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, required: true },
    moodScore: { type: Number, enum: MOOD_SCORES },
    tags: { type: [String], default: [] },
    winCategory: { type: String, enum: WIN_CATEGORIES },
    promptUsed: { type: String },
    date: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

journalSchema.index({ userId: 1, date: -1 });

export const Journal = mongoose.model("Journal", journalSchema);
