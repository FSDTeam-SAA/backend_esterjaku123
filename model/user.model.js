import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: { type: String },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/,
        "Please enter a valid email address",
      ],
    },
    password: { type: String, select: 0 },
    username: { type: String },
    phone: { type: String },

    avatar: {
      public_id: { type: String, default: "" },
      url: { type: String, default: "" },
    },

    address: {
      type: String,
    },
    verificationInfo: {
      verified: { type: Boolean, default: false },
      token: { type: String, default: "" },
    },
    password_reset_token: { type: String, default: "" },
    refreshToken: { type: String, default: "" },
    refreshTokens: { type: [String], default: [] },
    lastActive: { type: Date, default: Date.now },
    dob: { type: Date, default: Date.now },
    deviceToken: { type: String },
  },
  {
    timestamps: true,
  }
);

// Pre save middleware: Hash password
userSchema.pre("save", async function (next) {
  const user = this;

  if (user.isModified("password")) {
    const saltRounds = Number(process.env.bcrypt_salt_round) || 10;
    user.password = await bcrypt.hash(user.password, saltRounds);
  }

  next();
});

userSchema.statics.isUserExistsByEmail = async function (email) {
  return await User.findOne({ email }).select("+password");
};

userSchema.statics.isOTPVerified = async function (id) {
  const user = await User.findById(id).select("+verificationInfo");
  return user?.verificationInfo.verified;
};

userSchema.statics.isPasswordMatched = async function (
  plainTextPassword,
  hashPassword
) {
  return await bcrypt.compare(plainTextPassword, hashPassword);
};

export const User = mongoose.model("User", userSchema);
