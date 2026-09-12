import cron from "node-cron";
import { Mood } from "../model/mood.model.js";
import { User } from "../model/user.model.js"; // jodi sob user ke iterate korte hoy
import { Notification } from "../model/notification.model.js";
import { sendEmail } from "./sendEmail.js";

const scheduleOptions = { timezone: process.env.APP_TIMEZONE || "Asia/Dhaka" };

const MOTIVATIONAL_MESSAGES = [
  "This week, try to be 1% better than last week. Small steps count.",
  "Progress isn't always visible day to day — trust the process and keep going.",
  "You don't have to be perfect, you just have to show up. Keep logging your moods!",
  "Take a moment this week to celebrate something small you did well.",
  "Rest is productive too. Give yourself permission to slow down when you need it.",
];

const buildWeeklyEmailHtml = (name, message) => `
  <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; padding: 24px; border-radius: 12px; background:#ffffff; border:1px solid #e5e7eb;">
    <h2 style="color:#111827;">Hey ${name || "there"} 👋</h2>
    <p style="color:#374151; font-size:15px; line-height:1.6;">${message}</p>
    <p style="color:#9ca3af; font-size:13px; margin-top:24px;">— Your weekly nudge from Unfiltered</p>
  </div>
`;

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
}, scheduleOptions);

// Weekly motivational email — every Monday at 9:00 AM
cron.schedule("0 9 * * 1", async () => {
  console.log("Running weekly motivational email job...");

  try {
    const users = await User.find({}, "_id name email");
    const message =
      MOTIVATIONAL_MESSAGES[
        Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)
      ];

    for (const user of users) {
      if (!user.email) continue;
      try {
        await sendEmail(
          user.email,
          "Your weekly check-in 🌿",
          buildWeeklyEmailHtml(user.name, message)
        );
      } catch (err) {
        console.error(`Failed to email user ${user._id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("Error running weekly motivational email cron:", err);
  }
}, scheduleOptions);

// Daily afternoon login reminder — every day at 3:00 PM
cron.schedule("0 15 * * *", async () => {
  console.log("Running daily afternoon login reminder...");

  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // Only remind users who haven't logged their mood yet today
    const users = await User.find({}, "_id");

    for (const user of users) {
      const todaysMood = await Mood.findOne({
        userId: user._id,
        date: { $gte: startOfDay, $lte: endOfDay },
        completedAt: { $ne: null },
      });

      if (!todaysMood) {
        try {
          await Notification.create({
            userId: user._id,
            title: "Don't forget to check in 🌤️",
            body: "You haven't logged your mood today — take a minute for yourself.",
          });
        } catch (err) {
          console.error(
            `Failed to create reminder notification for user ${user._id}:`,
            err.message
          );
        }
      }
    }
  } catch (err) {
    console.error("Error running afternoon login reminder cron:", err);
  }
}, scheduleOptions);
