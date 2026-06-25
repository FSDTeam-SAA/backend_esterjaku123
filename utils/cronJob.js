import cron from "node-cron";
import { Mood } from "../model/mood.model.js";
import { User } from "../model/user.model.js"; // jodi sob user ke iterate korte hoy

// Run every day at 11:59 PM
cron.schedule("59 23 * * *", async () => {
  console.log("Running daily mood submission check...");

  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const users = await User.find({}, "_id");

    for (const user of users) {
      const moodLog = await Mood.findOne({
        userId: user._id,
        date: { $gte: startOfDay, $lte: endOfDay },
      })
        .sort({ createdAt: -1 })
        .select("_id completedAt status");

      if (moodLog) {
        const status = Boolean(moodLog.completedAt);
        await Mood.updateOne({ _id: moodLog._id }, { $set: { status } });
      }
    }
  } catch (err) {
    console.error("Error running mood check cron:", err);
  }
});
