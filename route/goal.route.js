import express from "express";
import {
  createGoal,
  getActiveGoal,
  getGoalHistory,
} from "../controller/goal.controller.js";
import { updateActiveMiddleware } from "../middleware/updateActive.middleware.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect, updateActiveMiddleware);

router.post("/", createGoal);
router.get("/", getGoalHistory);
router.get("/active", getActiveGoal);

export default router;
