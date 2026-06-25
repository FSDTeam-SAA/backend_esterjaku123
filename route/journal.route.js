import express from "express";
import {
  createJournalEntry,
  getJournalList,
  getJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  getWinCategories,
} from "../controller/journal.controller.js";
import { updateActiveMiddleware } from "../middleware/updateActive.middleware.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect, updateActiveMiddleware);

router.get("/win-categories", getWinCategories);

router.post("/", createJournalEntry);
router.get("/", getJournalList);
router.get("/:id", getJournalEntry);
router.patch("/:id", updateJournalEntry);
router.delete("/:id", deleteJournalEntry);

export default router;
