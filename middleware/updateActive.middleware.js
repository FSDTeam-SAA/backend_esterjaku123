import { User } from "../model/user.model.js";

export const updateActiveMiddleware = async (req, res, next) => {
  if (req.user && req.user._id) {
    try {
      await User.findByIdAndUpdate(
        req.user._id,
        { lastActive: new Date() },
        { new: true }
      );
    } catch (error) {
      console.error("Error updating lastActive:", error);
    }
  }
  next();
};
