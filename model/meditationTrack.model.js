import mongoose from "mongoose";

const meditationTrackSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    category: {
      type: String,
      enum: ["sleep", "focus", "calm", "breathing", "nature"],
      default: "calm",
    },
    durationSeconds: { type: Number, required: true },
    audioUrl: { type: String, required: true }, // Cloudinary or S3 hosted mp3 URL
    thumbnailUrl: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const MeditationTrack = mongoose.model(
  "MeditationTrack",
  meditationTrackSchema
);
