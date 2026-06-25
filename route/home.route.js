import express from "express";
import { getTodayDashboard } from "../controller/home.controller.js";
import { updateActiveMiddleware } from "../middleware/updateActive.middleware.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect, updateActiveMiddleware);

router.get("/today", getTodayDashboard);

export default router;
