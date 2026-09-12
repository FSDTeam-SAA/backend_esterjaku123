import express from "express";

import authRoute from "../route/auth.route.js";
import userRoute from "../route/user.route.js";
import moodRoute from "../route/mood.route.js";
import notificationRoute from "../route/notification.route.js";
import journalRoute from "../route/journal.route.js";
import coachRoute from "../route/coach.route.js";
import goalRoute from "../route/goal.route.js";
import homeRoute from "../route/home.route.js";
import insightsRoute from "../route/insights.route.js";
import feedbackRoute from "../route/feedback.route.js";
import meditationRoute from "../route/meditation.route.js";

const router = express.Router();

// Mounting the routes
router.use("/auth", authRoute);
router.use("/user", userRoute);
router.use("/mood", moodRoute);
router.use("/notifications", notificationRoute);
router.use("/journal", journalRoute);
router.use("/coach", coachRoute);
router.use("/goals", goalRoute);
router.use("/home", homeRoute);
router.use("/insights", insightsRoute);
router.use("/feedback", feedbackRoute);
router.use("/meditation", meditationRoute);


export default router;
