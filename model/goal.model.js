import mongoose from "mongoose";

const goalSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    metric: {
      type: String,
      enum: ["energyLevel", "calmLevel", "focusLevel"],
      required: true,
      default: "energyLevel",
    },
    targetValue: { type: Number, min: 0, max: 100, required: true },
    label: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

goalSchema.index({ userId: 1, isActive: 1 });

export const Goal = mongoose.model("Goal", goalSchema);
