import httpStatus from "http-status";
import { User } from "../model/user.model.js";
import { Mood } from "../model/mood.model.js";
import { Notification } from "../model/notification.model.js";
import { Journal } from "../model/journal.model.js";
import { CoachMessage } from "../model/coachMessage.model.js";
import { Goal } from "../model/goal.model.js";
import { uploadOnCloudinary } from "../utils/commonMethod.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import { sendEmail, sendFeedbackTemplate } from "../utils/sendEmail.js";

// Get user profile
export const getProfile = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    "-password -refreshToken -refreshTokens -verificationInfo -password_reset_token"
  );
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile fetched successfully",
    data: user,
  });
});

// Update profile
export const updateProfile = catchAsync(async (req, res) => {
  const { name, dob } = req.body;

  // Find user
  const user = await User.findById(req.user._id).select(
    "-password -refreshToken -refreshTokens -verificationInfo -password_reset_token"
  );
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  // Update only provided fields
  if (name) user.name = name;
  if (dob) user.dob = dob;

  console.log(req.file);

  if (req.file) {
    const result = await uploadOnCloudinary(req.file.buffer);
    user.avatar.public_id = result.public_id;
    user.avatar.url = result.secure_url;
  }

  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile updated successfully",
    data: user,
  });
});

export const submitFeedback = catchAsync(async (req, res) => {
  const { subject, message } = req.body;

  if (!subject || !subject.toString().trim()) {
    throw new AppError(httpStatus.BAD_REQUEST, "Subject is required");
  }

  if (!message || !message.toString().trim()) {
    throw new AppError(httpStatus.BAD_REQUEST, "Message is required");
  }

  const user = await User.findById(req.user._id).select("name email");
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const ownerEmail =
    process.env.FEEDBACK_EMAIL ||
    process.env.FEEDBACK_TO_EMAIL ||
    process.env.OWNER_EMAIL ||
    process.env.SMTP_USER ||
    process.env.EMAIL_USER;

  if (!ownerEmail) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Feedback recipient email is not configured",
    );
  }

  const trimmedSubject = subject.toString().trim();
  const trimmedMessage = message.toString().trim();
  const attachments = req.file
    ? [
        {
          filename: req.file.originalname || "feedback-image.jpg",
          content: req.file.buffer,
          contentType: req.file.mimetype,
        },
      ]
    : [];

  const feedbackHtml = sendFeedbackTemplate({
    email: user.email,
    name: user.name,
    subject: trimmedSubject,
    message: trimmedMessage,
  });

  const emailTasks = [
    sendEmail(ownerEmail, `App Feedback: ${trimmedSubject}`, feedbackHtml, {
      attachments,
    }),
  ];

  // For local/testing flows, also send a copy back to the user so the
  // same inbox used for OTP verification can confirm feedback delivery.
  if (user.email && user.email !== ownerEmail) {
    emailTasks.push(
      sendEmail(user.email, `Feedback Copy: ${trimmedSubject}`, feedbackHtml, {
        attachments,
      }),
    );
  }

  await Promise.all(emailTasks);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Feedback sent successfully",
    data: null,
  });
});

// Change user password
export const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const user = await User.findById(req.user._id).select("+password");
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (newPassword !== confirmPassword) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "New password and confirm password do not match"
    );
  }

  if (!(await User.isPasswordMatched(currentPassword, user.password))) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "Current password is incorrect"
    );
  }

  user.password = newPassword;
  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password changed successfully",
    data: user,
  });
});

// Delete account permanently
export const deleteAccount = catchAsync(async (req, res) => {
  const { password } = req.body;

  if (!password) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Password is required to delete your account"
    );
  }

  // Fetch user with password field
  const user = await User.findById(req.user._id).select("+password");
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  // Verify password before deletion
  const isPasswordValid = await User.isPasswordMatched(password, user.password);
  if (!isPasswordValid) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "Incorrect password. Account deletion cancelled."
    );
  }

  // Delete all related data
  await Mood.deleteMany({ userId: user._id });
  await Notification.deleteMany({ userId: user._id });
  await Journal.deleteMany({ userId: user._id });
  await CoachMessage.deleteMany({ userId: user._id });
  await Goal.deleteMany({ userId: user._id });

  // Hard delete the user
  await User.findByIdAndDelete(user._id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Account deleted successfully. We're sorry to see you go.",
    data: null,
  });
});
