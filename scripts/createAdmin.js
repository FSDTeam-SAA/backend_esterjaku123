import "dotenv/config";
import mongoose from "mongoose";
import { User } from "../model/user.model.js";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || "Unfiltered Admin";

if (!process.env.MONGO_DB_URL || !email || !password) {
  console.error("MONGO_DB_URL, ADMIN_EMAIL, and ADMIN_PASSWORD are required.");
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGO_DB_URL);
  const existing = await User.findOne({ email }).select("+password");

  if (existing) {
    existing.name = name;
    existing.role = "admin";
    existing.verificationInfo = { token: "", verified: true };
    if (password) existing.password = password;
    await existing.save();
    console.log(`Admin account updated: ${email}`);
  } else {
    await User.create({
      name,
      email,
      password,
      role: "admin",
      verificationInfo: { token: "", verified: true },
    });
    console.log(`Admin account created: ${email}`);
  }
} finally {
  await mongoose.disconnect();
}
