import express from "express";

import {
  createNotification,
  getNotifications,
  markNotificationAsRead,
} from "../controller/notification.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.post("/", createNotification);
router.get("/", getNotifications);
router.patch("/:notificationId", markNotificationAsRead);

export default router;
