import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  firstName:    { type: String, required: true, trim: true },
  surname:      { type: String, required: true, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: {
    type: String,
    enum: ["superadmin", "administrator", "engineer", "receptionist"],
    default: "engineer",
  },
  permissions:   { type: [String], default: [] },
  isFirstLogin:  { type: Boolean, default: true },
  isApproved:    { type: Boolean, default: false }, // ← ties into your pending signups flow

  // ── per-user settings ──────────────────────────────────────────────
  // Mirrors the fields owned by useSettingsPage on the frontend.
  // Kept as a nested object (rather than top-level fields) so it can be
  // returned/replaced as a single unit and doesn't crowd the main
  // user document.
  settings: {
    notifMaintenance: { type: Boolean, default: true },
    notifReports:     { type: Boolean, default: true },
    notifSupply:      { type: Boolean, default: false },
    notifLowStock:    { type: Boolean, default: true },
    sessionTimeout:   { type: String, default: "30" },
    dateFormat:       { type: String, default: "DD/MM/YYYY" },
  },
}, { timestamps: true });

// Never return the hash over the wire
UserSchema.methods.toSafeObject = function () {
  const { passwordHash, __v, ...safe } = this.toObject();
  return safe; // includes isApproved, isFirstLogin, role, permissions, settings, etc.
};

export default mongoose.model("User", UserSchema);