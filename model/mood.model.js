import mongoose from "mongoose";
import { MOOD_SCORES } from "../utils/wellnessThresholds.js";

const moodSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: { type: Date, required: true, default: Date.now },

    // Step 1 — Mind
    moodScore: { type: Number, enum: MOOD_SCORES },
    moodLabel: {
      type: String,
      enum: ["Terrible", "Poor", "Okay", "Good", "Amazing"],
    },
    energyLevel: { type: Number, min: 0, max: 100 },
    calmLevel: { type: Number, min: 0, max: 100 },
    focusLevel: { type: Number, min: 0, max: 100 },
    contextTags: { type: [String], default: [] },
    aiSuggestedTags: { type: [String], default: [] },

    // Step 2 — Body
    waterGlasses: { type: Number, min: 0, max: 20, default: 0 },
    sleepHours: { type: Number, min: 0, max: 14, default: 0 },
    walkMinutes: { type: Number, min: 0, max: 240, default: 0 },
    thoughts: { type: String, maxlength: 2000 },

    // Step 3 — Check (derived snapshot, computed when Body step is submitted)
    stressLevel: { type: Number, min: 0, max: 100 },
    sleepQuality: { type: String, enum: ["Good", "Average", "Not Good"] },
    stressQuality: { type: String, enum: ["Good", "Average", "Not Good"] },
    energyQuality: { type: String, enum: ["Good", "Average", "Not Good"] },

    // Flow state
    mindCompletedAt: { type: Date },
    bodyCompletedAt: { type: Date },
    completedAt: { type: Date },
    status: { type: Boolean, default: false },
  },
  { timestamps: true },
);

moodSchema.index({ userId: 1, date: 1 }, { unique: true });

export const Mood = mongoose.model("Mood", moodSchema);
