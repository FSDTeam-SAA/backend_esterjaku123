import mongoose from "mongoose";

const recommendationCardAssetSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    metric: { type: String, required: true },
    label: { type: String, required: true },
    imageUrl: { type: String },
    publicId: { type: String },
    prompt: { type: String, required: true },
    imageModel: { type: String },
    status: {
      type: String,
      enum: ["ready", "failed"],
      default: "ready",
    },
    lastError: { type: String },
  },
  { timestamps: true },
);

export const RecommendationCardAsset = mongoose.model(
  "RecommendationCardAsset",
  recommendationCardAssetSchema,
);
