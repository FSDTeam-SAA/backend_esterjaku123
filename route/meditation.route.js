import express from "express";

import {
  getMeditationTracks,
  createMeditationTrack,
  updateMeditationTrack,
} from "../controller/meditation.controller.js";
import { protect, isAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getMeditationTracks);
router.post("/", isAdmin, createMeditationTrack);
router.patch("/:trackId", isAdmin, updateMeditationTrack);

export default router;
