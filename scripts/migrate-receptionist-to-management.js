import connectDB from "../config/db.js";
import mongoose from "mongoose";
import User from "../models/User.js";

const main = async () => {
  try {
    await connectDB();
    const before = await User.countDocuments({ role: "receptionist" });
    console.log(`Users with role 'receptionist' before migration: ${before}`);
    if (before === 0) {
      console.log("No users to migrate.");
      process.exit(0);
    }

    const res = await User.updateMany({ role: "receptionist" }, { $set: { role: "management" } });
    console.log(`Matched: ${res.matchedCount}, Modified: ${res.modifiedCount}`);
    const after = await User.countDocuments({ role: "receptionist" });
    console.log(`Users with role 'receptionist' after migration: ${after}`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    try { await mongoose.disconnect(); } catch (e) {}
  }
};

main();
