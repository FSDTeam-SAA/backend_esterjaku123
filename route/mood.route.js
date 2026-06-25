import express from "express";
import {
  submitMind,
  suggestContextTags,
  submitBody,
  getCheck,
  completeReflection,
  getTodayMood,
  getWeeklyLogs,
  getAllMoods,
  getMoodDetails,
} from "../controller/mood.controller.js";
import { updateActiveMiddleware } from "../middleware/updateActive.middleware.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

// Apply auth and auto-update lastActive to all routes
router.use(protect, updateActiveMiddleware);

// Step 1 — Mind
router.post("/mind", submitMind);
router.post("/mind/suggest-tags", suggestContextTags);

// Step 2 — Body
router.post("/body", submitBody);

// Step 3 — Check (read-only recap + What if you...)
router.get("/check", getCheck);

// Finalize today's reflection
router.post("/complete", completeReflection);

// Today's state (flow + doc)
router.get("/today", getTodayMood);

// History
router.get("/weekly", getWeeklyLogs);
router.get("/all", getAllMoods);
router.get("/details/:moodId", getMoodDetails);

export default router;
