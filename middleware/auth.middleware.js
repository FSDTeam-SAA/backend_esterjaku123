import jwt from "jsonwebtoken";
import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import { User } from "./../model/user.model.js";

export const protect = async (req, res, next) => {
  // console.log("Protect middleware invoked");
  // console.log(req.body);
  // console.log(req.headers);
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) throw new AppError(httpStatus.UNAUTHORIZED, "Token not found");

  try {
    const decoded = await jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    const user = await User.findById(decoded._id);
    if (!user || !(await User.isOTPVerified(user._id))) {
      throw new AppError(httpStatus.UNAUTHORIZED, "Invalid token");
    }

    req.user = user;
    next();
  } catch (err) {
    throw new AppError(401, "Invalid token");
  }
};

export const isAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    throw new AppError(403, "Access denied. You are not an admin.");
  }
  next();
};

export const isDriver = (req, res, next) => {
  if (req.user?.role !== "driver") {
    throw new AppError(403, "Access denied. You are not an driver.");
  }
  next();
};
