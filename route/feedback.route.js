import express from "express";

import {
  createFeedback,
  getAllFeedback,
  updateFeedbackStatus,
} from "../controller/feedback.controller.js";
import { protect, isAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.post("/", createFeedback);
router.get("/", isAdmin, getAllFeedback);
router.patch("/:feedbackId/status", isAdmin, updateFeedbackStatus);

export default router;
