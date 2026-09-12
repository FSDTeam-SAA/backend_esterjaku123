import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import { Feedback } from "../model/feedback.model.js";
import { sendEmail, sendFeedbackTemplate } from "../utils/sendEmail.js";

// User submits a feature request / improvement suggestion
export const createFeedback = catchAsync(async (req, res) => {
  const { subject, message } = req.body;
  const user = req.user;

  if (!message) {
    throw new AppError(httpStatus.BAD_REQUEST, "Message is required");
  }

  const feedback = await Feedback.create({
    userId: user._id,
    subject: subject || "General feedback",
    message,
  });

  // Notify admin — don't fail the request if email sending fails
  try {
    const recipient =
      process.env.FEEDBACK_EMAIL ||
      process.env.FEEDBACK_TO_EMAIL ||
      process.env.SMTP_FROM;
    await sendEmail(
      recipient,
      "New Feedback Received",
      sendFeedbackTemplate({
        email: user.email,
        name: user.name || user.username,
        subject: subject || "General feedback",
        message,
      })
    );
  } catch (err) {
    console.error("Failed to send feedback notification email:", err.message);
  }

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Feedback submitted successfully",
    data: feedback,
  });
});

// Admin: list all feedback
export const getAllFeedback = catchAsync(async (req, res) => {
  const feedbackList = await Feedback.find()
    .populate("userId", "name email")
    .sort({ createdAt: -1 });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Feedback fetched successfully",
    data: feedbackList,
  });
});

export const updateFeedbackStatus = catchAsync(async (req, res) => {
  const { status } = req.body;
  if (!["new", "reviewed", "resolved"].includes(status)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid feedback status");
  }
  const feedback = await Feedback.findByIdAndUpdate(
    req.params.feedbackId,
    { status },
    { new: true, runValidators: true },
  );
  if (!feedback) throw new AppError(httpStatus.NOT_FOUND, "Feedback not found");
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Feedback status updated successfully", data: feedback });
});
