import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import { User } from "./../model/user.model.js";
import { Notification } from "./../model/notification.model.js";

// Create or update notification for user (replaces device token)
export const createNotification = catchAsync(async (req, res) => {
  const { title, body } = req.body;
  const userId = req.user._id;

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const notification = await Notification.create({
    userId,
    title,
    body,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification created successfully",
    data: notification,
  });
});

// Fetch unread notifications for the user
export const getNotifications = catchAsync(async (req, res) => {
  const userId = req.user._id;

  const notifications = await Notification.find({ userId, isRead: false }).sort(
    {
      createdAt: -1,
    }
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notifications fetched successfully",
    data: notifications,
  });
});

// Mark notification as read
export const markNotificationAsRead = catchAsync(async (req, res) => {
  const { notificationId } = req.params;
  const userId = req.user._id;

  const notification = await Notification.findOne({
    _id: notificationId,
    userId,
  });
  if (!notification) {
    throw new AppError(httpStatus.NOT_FOUND, "Notification not found");
  }

  notification.isRead = true;
  await notification.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification marked as read",
    data: null,
  });
});

// Send notification reminders (automated via cron)
export const sendReminders = async () => {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

  const inactiveUsers = await User.find({
    lastActive: { $lt: sixHoursAgo },
  });

  for (const user of inactiveUsers) {
    try {
      await Notification.create({
        userId: user._id,
        title: "Mood Tracker Reminder",
        body: "Hey, open the app and log your mood today!",
      });
    } catch (error) {
      console.error(`Error creating notification for user ${user._id}:`, error);
    }
  }
};
