import mongoose from "mongoose";

const coachMessageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sender: { type: String, enum: ["user", "coach"], required: true },
    text: { type: String, required: true, maxlength: 1000 },
    quickReplies: { type: [String], default: [] },
    nudgeType: { type: String, enum: ["idle_break", "none"], default: "none" },
  },
  { timestamps: true },
);

coachMessageSchema.index({ userId: 1, createdAt: 1 });

export const CoachMessage = mongoose.model("CoachMessage", coachMessageSchema);
