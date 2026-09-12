import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import { MeditationTrack } from "../model/meditationTrack.model.js";

// List all active meditation tracks (optionally filter by category)
export const getMeditationTracks = catchAsync(async (req, res) => {
  const { category } = req.query;
  // Admins need disabled tracks in the management list so they can edit or
  // enable them again. Regular app users only receive playable tracks.
  const filter = req.user?.role === "admin" ? {} : { isActive: true };
  if (category) filter.category = category;

  const tracks = await MeditationTrack.find(filter).sort({ createdAt: -1 });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Meditation tracks fetched successfully",
    data: tracks,
  });
});

// Admin: add a new track
export const createMeditationTrack = catchAsync(async (req, res) => {
  const track = await MeditationTrack.create(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Meditation track added successfully",
    data: track,
  });
});

export const updateMeditationTrack = catchAsync(async (req, res) => {
  const allowedFields = ["title", "category", "durationSeconds", "audioUrl", "thumbnailUrl", "isActive"];
  const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowedFields.includes(key)));
  const track = await MeditationTrack.findByIdAndUpdate(req.params.trackId, update, { new: true, runValidators: true });
  if (!track) throw new AppError(httpStatus.NOT_FOUND, "Meditation track not found");
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Meditation track updated successfully", data: track });
});
