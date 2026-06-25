import express from "express";
import {
  getCoachHistory,
  sendCoachMessage,
  triggerNudge,
} from "../controller/coach.controller.js";
import { updateActiveMiddleware } from "../middleware/updateActive.middleware.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect, updateActiveMiddleware);

router.get("/messages", getCoachHistory);
router.post("/messages", sendCoachMessage);
router.post("/nudge", triggerNudge);

export default router;
