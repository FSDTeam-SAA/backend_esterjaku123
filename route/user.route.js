import express from "express";
import {
  getProfile,
  updateProfile,
  submitFeedback,
  changePassword,
  deleteAccount,
} from "../controller/user.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();

router.get("/profile", protect, getProfile);
router.patch(
  "/update-profile",
  protect,
  upload.single("avatar"),
  updateProfile
);
router.post("/feedback", protect, upload.single("attachment"), submitFeedback);
router.post("/change-password", protect, changePassword);
router.delete("/delete-account", protect, deleteAccount);

export default router;
