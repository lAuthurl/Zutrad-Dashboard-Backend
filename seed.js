import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import User from "./models/User.js";

dotenv.config();
const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/zutrad";
await mongoose.connect(uri);

const email = "taoheed1414@gmail.com";
const password = "Authur1!";

const existing = await User.findOne({ email });
if (existing) {
  console.log(`User ${email} already exists (role: ${existing.role}). No changes made.`);
  await mongoose.disconnect();
  process.exit(0);
}

const passwordHash = await bcrypt.hash(password, 12);

const user = await User.create({
  firstName: "Taoheed",
  surname: "Admin",
  email,
  passwordHash,
  role: "superadmin",
  isApproved: true,
  isFirstLogin: false,
});

console.log(`Superadmin created: ${user.email} (id: ${user._id})`);

await mongoose.disconnect();
console.log("Done.");