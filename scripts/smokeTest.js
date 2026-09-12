import "dotenv/config";
import mongoose from "mongoose";
import { createToken } from "../utils/authToken.js";
import { User } from "../model/user.model.js";
import { Feedback } from "../model/feedback.model.js";
import { MeditationTrack } from "../model/meditationTrack.model.js";

const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;
const baseUrl = process.env.SMOKE_API_URL || `http://127.0.0.1:${process.env.PORT || 5000}/api/v1`;

if (!adminEmail || !adminPassword || !process.env.MONGO_DB_URL) {
  throw new Error("SMOKE_ADMIN_EMAIL, SMOKE_ADMIN_PASSWORD, and MONGO_DB_URL are required.");
}

let testUser;
let testFeedback;
let testTrackId;

const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, options);
  const raw = await response.text();
  let body = raw;
  try { body = JSON.parse(raw); } catch {}
  return { status: response.status, body };
};

const jsonOptions = (method, body, token) => ({
  method,
  headers: {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});

try {
  await mongoose.connect(process.env.MONGO_DB_URL);
  const stamp = Date.now();
  const testEmail = `smoke-${stamp}@example.com`;
  const originalPassword = "SmokeBefore123!";
  const newPassword = "SmokeAfter123!";
  const otp = "482731";

  testUser = await User.create({
    name: "Smoke Test User",
    email: testEmail,
    password: originalPassword,
    role: "user",
    verificationInfo: { verified: true, token: "" },
  });

  testUser.password_reset_token = createToken(
    { otp },
    process.env.OTP_SECRET,
    process.env.OTP_EXPIRE,
  );
  await testUser.save();

  const adminLogin = await request("/auth/login", jsonOptions("POST", {
    email: adminEmail,
    password: adminPassword,
  }));
  const adminToken = adminLogin.body?.data?.accessToken || adminLogin.body?.accessToken;

  const userLogin = await request("/auth/login", jsonOptions("POST", {
    email: testEmail,
    password: originalPassword,
  }));
  const userToken = userLogin.body?.data?.accessToken || userLogin.body?.accessToken;

  testFeedback = await Feedback.create({
    userId: testUser._id,
    subject: "Smoke test feedback",
    message: "Temporary integration-test record",
  });
  const reviewed = await request(
    `/feedback/${testFeedback._id}/status`,
    jsonOptions("PATCH", { status: "reviewed" }, adminToken),
  );
  const resolved = await request(
    `/feedback/${testFeedback._id}/status`,
    jsonOptions("PATCH", { status: "resolved" }, adminToken),
  );

  const createdTrack = await request("/meditation", jsonOptions("POST", {
    title: "Temporary smoke track",
    category: "calm",
    durationSeconds: 60,
    audioUrl: "https://example.com/smoke.mp3",
    isActive: true,
  }, adminToken));
  testTrackId = createdTrack.body?.data?._id;
  const disabledTrack = await request(
    `/meditation/${testTrackId}`,
    jsonOptions("PATCH", { isActive: false }, adminToken),
  );
  const adminTracks = await request("/meditation", jsonOptions("GET", undefined, adminToken));
  const userTracks = await request("/meditation", jsonOptions("GET", undefined, userToken));

  const verifiedOtp = await request("/auth/verify-otp", jsonOptions("POST", { email: testEmail, otp }));
  const reset = await request("/auth/reset-password", jsonOptions("POST", {
    email: testEmail,
    otp,
    password: newPassword,
  }));
  const loginAfterReset = await request("/auth/login", jsonOptions("POST", {
    email: testEmail,
    password: newPassword,
  }));
  const refreshedUser = await User.findById(testUser._id);

  const checks = {
    adminLogin: adminLogin.status === 200 && Boolean(adminToken),
    userLogin: userLogin.status === 200 && Boolean(userToken),
    feedbackReviewed: reviewed.status === 200 && reviewed.body?.data?.status === "reviewed",
    feedbackResolved: resolved.status === 200 && resolved.body?.data?.status === "resolved",
    meditationCreated: createdTrack.status === 201 && Boolean(testTrackId),
    meditationDisabled: disabledTrack.status === 200 && disabledTrack.body?.data?.isActive === false,
    adminCanSeeDisabledTrack: adminTracks.body?.data?.some((track) => track._id === testTrackId),
    userCannotSeeDisabledTrack: !userTracks.body?.data?.some((track) => track._id === testTrackId),
    otpVerified: verifiedOtp.status === 200,
    passwordReset: reset.status === 200 && loginAfterReset.status === 200,
    resetTokenCleared: refreshedUser?.password_reset_token === "",
  };

  console.log(JSON.stringify(checks, null, 2));
  if (Object.values(checks).some((passed) => !passed)) process.exitCode = 1;
} finally {
  if (testFeedback?._id) await Feedback.deleteOne({ _id: testFeedback._id });
  if (testTrackId) await MeditationTrack.deleteOne({ _id: testTrackId });
  if (testUser?._id) await User.deleteOne({ _id: testUser._id });
  await mongoose.disconnect();
}
