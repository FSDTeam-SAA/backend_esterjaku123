import AppError from "../errors/AppError.js";
import { createToken, verifyToken } from "../utils/authToken.js";
import catchAsync from "../utils/catchAsync.js";
import { generateOTP } from "../utils/commonMethod.js";
import httpStatus from "http-status";
import sendResponse from "../utils/sendResponse.js";
import { sendEmail } from "../utils/sendEmail.js";
import { User } from "./../model/user.model.js";

const MAX_REFRESH_TOKENS = 5;

const getStoredRefreshTokens = (user) => {
  const legacyToken = user.refreshToken ? [user.refreshToken] : [];
  const tokens = Array.isArray(user.refreshTokens) ? user.refreshTokens : [];
  return [...new Set([...tokens, ...legacyToken].filter(Boolean))];
};

const persistRefreshToken = (user, refreshToken) => {
  const tokens = [...getStoredRefreshTokens(user), refreshToken];
  user.refreshTokens = [...new Set(tokens.filter(Boolean))].slice(
    -MAX_REFRESH_TOKENS,
  );
  user.refreshToken = refreshToken;
};

const hasRefreshToken = (user, refreshToken) => {
  return getStoredRefreshTokens(user).includes(refreshToken);
};

export const register = catchAsync(async (req, res) => {
  const { name, userName, email, password, confirmPassword } = req.body;
  const normalizedName = name || userName;

  if (!email || !password) {
    throw new AppError(httpStatus.FORBIDDEN, "Please fill in all fields");
  }

  if (password !== confirmPassword) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Password and confirm password do not match"
    );
  }
  const checkUser = await User.findOne({ email: email });
  if (checkUser)
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Email already exists, please try another email"
    );

  const user = await User.create({
    name: normalizedName,
    email,
    password,
    verificationInfo: { token: "", verified: true },
  });

  const jwtPayload = {
    _id: user._id,
    email: user.email,
    role: user.role,
  };
  const accessToken = createToken(
    jwtPayload,
    process.env.JWT_ACCESS_SECRET,
    process.env.JWT_ACCESS_EXPIRES_IN
  );

  const refreshToken = createToken(
    jwtPayload,
    process.env.JWT_REFRESH_SECRET,
    process.env.JWT_REFRESH_EXPIRES_IN
  );
  persistRefreshToken(user, refreshToken);
  await user.save();
  user.accessToken = accessToken;

  const userObj = user.toObject();
  userObj.accessToken = accessToken;

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "User registered successfully",
    data: userObj,
  });
});

export const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.isUserExistsByEmail(email);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }
  if (
    user?.password &&
    !(await User.isPasswordMatched(password, user.password))
  ) {
    throw new AppError(httpStatus.FORBIDDEN, "Password is not correct");
  }
  if (!(await User.isOTPVerified(user._id))) {
    const otp = generateOTP();
    const jwtPayloadOTP = {
      otp: otp,
    };

    const otptoken = createToken(
      jwtPayloadOTP,
      process.env.OTP_SECRET,
      process.env.OTP_EXPIRE
    );
    user.verificationInfo.token = otptoken;
    await user.save();
    await sendEmail(user.email, "Registerd Account", `Your OTP is ${otp}`);

    return sendResponse(res, {
      statusCode: httpStatus.FORBIDDEN,
      success: false,
      message: "OTP is not verified, please verify your OTP",
      data: { email: user.email },
    });
  }
  const jwtPayload = {
    _id: user._id,
    email: user.email,
    role: user.role,
  };
  const accessToken = createToken(
    jwtPayload,
    process.env.JWT_ACCESS_SECRET,
    process.env.JWT_ACCESS_EXPIRES_IN
  );

  const refreshToken = createToken(
    jwtPayload,
    process.env.JWT_REFRESH_SECRET,
    process.env.JWT_REFRESH_EXPIRES_IN
  );

  persistRefreshToken(user, refreshToken);
  let _user = await user.save();

  res.cookie("refreshToken", refreshToken, {
    secure: true,
    httpOnly: true,
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User Logged in successfully",
    data: {
      accessToken,
      refreshToken: refreshToken,
      role: user.role,
      _id: user._id,
      user: user,
    },
  });
});

export const forgetPassword = catchAsync(async (req, res) => {
  const { email } = req.body;
  const user = await User.isUserExistsByEmail(email);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }
  const otp = generateOTP();
  const jwtPayloadOTP = {
    otp: otp,
  };

  const otptoken = createToken(
    jwtPayloadOTP,
    process.env.OTP_SECRET,
    process.env.OTP_EXPIRE
  );
  user.password_reset_token = otptoken;
  await user.save();

  await sendEmail(user.email, "Reset Password", `Your OTP is ${otp}`);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP sent to your email",
    data: "",
  });
});

export const verifyOTPForReset = catchAsync(async (req, res) => {
  const { otp, email } = req.body;
  const user = await User.isUserExistsByEmail(email);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }
  if (!user.password_reset_token) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Password reset token is invalid"
    );
  }
  const verify = await verifyToken(
    user.password_reset_token,
    process.env.OTP_SECRET
  );
  if (verify.otp !== otp) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP");
  }
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP Matched successfully",
    data: {},
  });
});

export const resetPassword = catchAsync(async (req, res) => {
  const { password, otp, email } = req.body;
  const user = await User.isUserExistsByEmail(email);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }
  if (!user.password_reset_token) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Password reset token is invalid"
    );
  }
  const verify = await verifyToken(
    user.password_reset_token,
    process.env.OTP_SECRET
  );
  if (verify.otp !== otp) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP");
  }
  user.password = password;
  await user.save();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password reset successfully",
    data: {},
  });
});

export const verifyEmail = catchAsync(async (req, res) => {
  const { email, otp } = req.body;
  const user = await User.isUserExistsByEmail(email);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }
  if (otp) {
    const savedOTP = verifyToken(
      user.verificationInfo.token,
      process.env.OTP_SECRET
    );
    console.log(savedOTP);
    if (otp === savedOTP.otp) {
      user.verificationInfo.token = "";
      await user.save();

      sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "User verified",
        data: "",
      });
    } else {
      throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP");
    }
  } else {
    throw new AppError(httpStatus.BAD_REQUEST, "OTP is required");
  }
});

export const changePassword = catchAsync(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Old password and new password are required"
    );
  }
  if (oldPassword === newPassword) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Old password and new password cannot be same"
    );
  }
  const user = await User.findById({ _id: req.user?._id });

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }
  user.password = newPassword;
  await user.save();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password changed",
    data: "",
  });
});

export const refreshToken = catchAsync(async (req, res) => {
  const { refreshToken: providedRefreshToken } = req.body;

  if (!providedRefreshToken) {
    throw new AppError(400, "Refresh token is required");
  }

  let decoded;
  try {
    decoded = verifyToken(
      providedRefreshToken,
      process.env.JWT_REFRESH_SECRET,
    );
  } catch (error) {
    throw new AppError(401, "Invalid refresh token");
  }

  const user = await User.findById(decoded._id);
  if (!user || !hasRefreshToken(user, providedRefreshToken)) {
    throw new AppError(401, "Invalid refresh token");
  }

  if (!user.refreshTokens?.includes(providedRefreshToken)) {
    persistRefreshToken(user, providedRefreshToken);
    await user.save();
  }

  const jwtPayload = {
    _id: user._id,
    email: user.email,
    role: user.role,
  };

  const accessToken = createToken(
    jwtPayload,
    process.env.JWT_ACCESS_SECRET,
    process.env.JWT_ACCESS_EXPIRES_IN
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Token refreshed successfully",
    data: { accessToken: accessToken, refreshToken: providedRefreshToken },
  });
});

export const logout = catchAsync(async (req, res) => {
  const user = req.user?._id;
  const user1 = await User.findByIdAndUpdate(
    user,
    { refreshToken: "", refreshTokens: [] },
    { new: true }
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Logged out successfully",
    data: "",
  });
});
