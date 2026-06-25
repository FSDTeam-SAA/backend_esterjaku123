import express from "express";
import {
  getDiscover,
  getPatterns,
  getPrediction,
  getWhatIf,
} from "../controller/insights.controller.js";
import { updateActiveMiddleware } from "../middleware/updateActive.middleware.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect, updateActiveMiddleware);

router.get("/discover", getDiscover);
router.get("/patterns", getPatterns);
router.get("/prediction", getPrediction);
router.get("/what-if", getWhatIf);

export default router;
