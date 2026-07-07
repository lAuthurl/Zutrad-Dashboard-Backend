import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { verifyToken, requireAdmin, requireSuperAdmin } from "../middleware/auth.js";

const router = express.Router();

// ── allowed roles a user can request for themselves at signup ───────
// superadmin is deliberately excluded -that role can only be granted
// by an existing superadmin through a separate, protected action.
const ALLOWED_SIGNUP_ROLES = ["engineer", "management", "administrator"];

// All grantable pages. Used to give a freshly promoted administrator full
// access by default. Must stay in sync with AVAILABLE_PAGES on the frontend
// (userManagement.logic.js) -if a page is added there, add it here too.
const ALL_PAGES = ["store", "supply", "maintenance", "reports"];

const getDefaultPermissions = (role) => {
  if (role === "engineer") return ["reports", "maintenance"];
  if (role === "management") return ["reports", "supply"];
  if (role === "administrator") return [...ALL_PAGES];
  if (role === "superadmin") return [];
  return ["reports"];
};

// ── small guard used by both /signup and /login ──────────────────────
// Stops NoSQL operator injection, e.g. { "email": { "$gt": "" } },
// which would otherwise be passed straight into a Mongoose query.
const isPlainString = (val) => typeof val === "string" && val.trim().length > 0;

// ── settings whitelist ────────────────────────────────────────────────
// Only these keys can ever be written via PATCH /auth/settings. Mirrors
// the `settings` sub-schema on the User model and the fields owned by
// useSettingsPage on the frontend. Whitelisting (rather than trusting
// req.body wholesale) stops arbitrary keys -or accidentally overwriting
// role/permissions/passwordHash via a naive $set -from slipping through.
const SETTINGS_KEYS = [
  "notifMaintenance",
  "notifReports",
  "notifSupply",
  "notifLowStock",
  "sessionTimeout",
  "dateFormat",
];

const BOOLEAN_SETTINGS = ["notifMaintenance", "notifReports", "notifSupply", "notifLowStock"];
const STRING_SETTINGS  = ["sessionTimeout", "dateFormat"];

const pickValidSettings = (body) => {
  const out = {};
  for (const key of SETTINGS_KEYS) {
    if (!(key in body)) continue;
    const val = body[key];
    if (BOOLEAN_SETTINGS.includes(key) && typeof val === "boolean") out[key] = val;
    if (STRING_SETTINGS.includes(key) && isPlainString(val)) out[key] = val;
  }
  return out;
};

// ── in-memory rate limit for change-password ──────────────────────────
// Same idea as the client-side lockout in useLogin.js, but enforced
// server-side since the client-side one is trivially bypassed (e.g. by
// clearing localStorage or calling the API directly). Keyed by user id
// rather than IP, since the route is already behind verifyToken.
//
// NOTE: this is per-process state. Fine for a single server instance;
// swap for a shared store (Redis, etc.) if you ever run more than one.
const PW_MAX_ATTEMPTS    = 5;
const PW_LOCKOUT_MS      = 60 * 1000;
const PW_ATTEMPT_WINDOW  = 15 * 60 * 1000;
const pwAttempts = new Map(); // userId -> { count, firstAt, lockedUntil }

const getPwAttemptState = (userId) => {
  const now = Date.now();
  const state = pwAttempts.get(userId) || { count: 0, firstAt: now, lockedUntil: 0 };
  if (now - state.firstAt > PW_ATTEMPT_WINDOW && now > state.lockedUntil) {
    return { count: 0, firstAt: now, lockedUntil: 0 };
  }
  return state;
};

const recordPwFailure = (userId) => {
  const state = getPwAttemptState(userId);
  const next = {
    count: state.count + 1,
    firstAt: state.count === 0 ? Date.now() : state.firstAt,
    lockedUntil: state.lockedUntil,
  };
  if (next.count >= PW_MAX_ATTEMPTS) {
    next.lockedUntil = Date.now() + PW_LOCKOUT_MS;
  }
  pwAttempts.set(userId, next);
  return next;
};

const clearPwAttempts = (userId) => pwAttempts.delete(userId);


// ── POST /auth/signup ──────────────────────────────────────────────
// Creates user with isApproved: false -admin approves from AdminPage
router.post("/signup", async (req, res) => {
  const { firstName, surname, email, role, password } = req.body;

  if (!firstName || !surname || !email || !role || !password)
    return res.status(400).json({ message: "All fields are required." });

  if (
    !isPlainString(firstName) ||
    !isPlainString(surname) ||
    !isPlainString(email) ||
    !isPlainString(role) ||
    !isPlainString(password)
  ) {
    return res.status(400).json({ message: "Invalid input." });
  }

  if (password.length < 8)
    return res.status(400).json({ message: "Password must be at least 8 characters." });

  if (!ALLOWED_SIGNUP_ROLES.includes(role)) {
    return res.status(400).json({ message: "Invalid role selected." });
  }

  const normalisedEmail = email.toLowerCase().trim();

  try {
    const existing = await User.findOne({ email: normalisedEmail });
    if (existing)
      return res.status(409).json({ message: "Email already registered." });

    const passwordHash = await bcrypt.hash(password, 12);
    await User.create({
      firstName,
      surname,
      email: normalisedEmail,
      role,
      passwordHash,
      permissions: getDefaultPermissions(role),
    });

    res.status(201).json({ message: "Request submitted. Await admin approval." });
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});


// ── POST /auth/login ───────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!isPlainString(email) || !isPlainString(password)) {
    return res.status(400).json({ message: "Invalid email or password." });
  }

  const normalisedEmail = email.toLowerCase().trim();

  try {
    const user = await User.findOne({ email: normalisedEmail });
    if (!user)
      return res.status(401).json({ message: "Invalid email or password." });

    if (!user.isApproved)
      return res.status(403).json({ message: "Account pending admin approval." });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match)
      return res.status(401).json({ message: "Invalid email or password." });

    // Flip isFirstLogin on first successful login so profile shows "Active"
    if (user.isFirstLogin) {
      user.isFirstLogin = false;
      await user.save();
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, permissions: user.permissions || [] },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({ token, user: user.toSafeObject() });
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});


// ── GET /auth/me ───────────────────────────────────────────────────────────────
// Returns fresh user data for the currently logged-in user.
// Called by profile.logic.js on mount to sync latest state from DB.
router.get("/me", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user)
      return res.status(404).json({ message: "User not found." });

    res.json(user.toSafeObject());
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});


// ── GET /auth/settings  -fetch the current user's own settings ──────
// Any authenticated user. Falls back to schema defaults automatically
// since `settings` is a defined sub-document -a user created before
// this field existed will still get sane defaults back, not undefined.
router.get("/settings", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("settings");
    if (!user) return res.status(404).json({ message: "User not found." });

    res.json(user.settings);
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});


// ── PATCH /auth/settings  -update the current user's own settings ───
// Any authenticated user, own account only -there's no :id here on
// purpose, this route can never touch anyone else's settings. Only
// whitelisted keys from SETTINGS_KEYS are ever written.
router.patch("/settings", verifyToken, async (req, res) => {
  const updates = pickValidSettings(req.body || {});

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ message: "No valid settings fields provided." });
  }

  try {
    const setFields = {};
    for (const [key, value] of Object.entries(updates)) {
      setFields[`settings.${key}`] = value;
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: setFields },
      { new: true }
    ).select("settings");

    if (!user) return res.status(404).json({ message: "User not found." });

    res.json({ message: "Settings updated.", settings: user.settings });
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});


// ── POST /auth/change-password  -change the current user's password ─
// Any authenticated user, own account only. Requires the correct
// current password before allowing a change. Rate-limited per user to
// slow down anyone trying to brute-force a stolen/guessed session's
// current password.
router.post("/change-password", verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!isPlainString(currentPassword) || !isPlainString(newPassword)) {
    return res.status(400).json({ message: "All fields are required." });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ message: "New password must be at least 8 characters." });
  }

  const state = getPwAttemptState(req.userId);
  if (state.lockedUntil > Date.now()) {
    const remaining = Math.ceil((state.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ message: `Too many attempts. Try again in ${remaining}s.` });
  }

  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found." });

    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) {
      const next = recordPwFailure(req.userId);
      const remainingAttempts = PW_MAX_ATTEMPTS - next.count;
      return res.status(401).json({
        message:
          remainingAttempts > 0
            ? `Current password is incorrect. ${remainingAttempts} attempt${remainingAttempts === 1 ? "" : "s"} remaining.`
            : "Too many attempts. Try again in 60s.",
      });
    }

    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      return res.status(400).json({ message: "New password must be different from the current password." });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();
    clearPwAttempts(req.userId);

    res.json({ message: "Password changed successfully." });
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});


// ── GET /auth/pending  -fetch all unapproved users ──────────────────
// Admin-only (administrator or superadmin).
router.get("/pending", verifyToken, requireAdmin, async (req, res) => {
  try {
    const pending = await User.find({ isApproved: false }).select("-passwordHash");
    res.json(pending);
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});


// ── GET /auth/users  -fetch all approved users ───────────────────────
// Any authenticated user can load the approved users list.
// Excludes pending signups (those come from /auth/pending) and never
// returns the password hash.
router.get("/users", verifyToken, async (req, res) => {
  try {
    const users = await User.find({ isApproved: true }).select("-passwordHash");
    res.json(users);
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});


// ── PATCH /auth/approve/:id  -approve a user ─────────────────────────
// Admin-only (administrator or superadmin).
router.patch("/approve/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    const target = await User.findById(req.params.id).select("role");
    if (!target) return res.status(404).json({ message: "User not found." });

    const update = {
      isApproved: true,
      permissions: getDefaultPermissions(target.role),
    };
    if (target.role === "administrator") update.permissions = ALL_PAGES;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true }
    ).select("-passwordHash");

    res.json({ message: "User approved.", user });
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});


// ── DELETE /auth/reject/:id  -reject and delete a signup request ────
// Admin-only (administrator or superadmin).
router.delete("/reject/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Request rejected." });
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});


// ── PATCH /auth/users/:id/permissions  -set a user's page permissions ──
// Admin-only (administrator or superadmin). Used by "Special Page Access"
// on both the Admin and Super Admin pages. Replaces the full permissions
// array rather than diffing add/remove -the frontend always sends the
// complete desired list, which keeps this route simple and avoids drift.
//
// Administrators DO carry an editable permissions list -they start with
// every page on promotion (see /users/:id/role below) but a superadmin can
// revoke individual pages from them without a full demotion. Superadmins
// themselves have no permissions list at all and are never a valid target
// here -there's no role above them to manage that exception.
router.patch("/users/:id/permissions", verifyToken, requireAdmin, async (req, res) => {
  const { permissions } = req.body;

  if (!Array.isArray(permissions) || !permissions.every((p) => typeof p === "string")) {
    return res.status(400).json({ message: "Permissions must be an array of strings." });
  }

  try {
    const target = await User.findById(req.params.id).select("role");
    if (!target) return res.status(404).json({ message: "User not found." });

    if (target.role === "superadmin") {
      return res.status(403).json({
        message: "Super administrators have full access by default and cannot have page permissions changed.",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { permissions },
      { new: true }
    ).select("-passwordHash");

    res.json({ message: "Permissions updated.", user });
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});


// ── PATCH /auth/users/:id/role  -promote or demote a user's role ───────
// Superadmin-only. Used by "Administrator Role Control" on the Super Admin
// page, and by the promote-via-permission-picker shortcut there.
//
// Promoting to administrator grants every page in ALL_PAGES by default —
// a superadmin can later trim individual pages via /users/:id/permissions
// without a full demotion. Promoting to superadmin grants no permissions
// list at all -superadmins get full access implicitly (see requireAdmin /
// requirePermission in middleware/auth.js), not through a stored list, so
// there is nothing to populate. Demoting OUT of administrator (or between
// engineer/receptionist) clears permissions to a clean empty slate, which
// an admin or superadmin then re-grants explicitly.
//
// NOTE: promoting someone to "superadmin" here is currently a one-way
// door through this UI/route -the "target is already superadmin" guard
// below blocks changing an existing superadmin's role at all, including
// by another superadmin. If that should ever be reversible, this route
// (and the matching guard in /users/:id/permissions) needs a deliberate
// second look, since removing it changes who can ultimately control the
// system.
router.patch("/users/:id/role", verifyToken, requireSuperAdmin, async (req, res) => {
  const { role } = req.body;
  const ALLOWED_ROLES = ["engineer", "management", "administrator", "superadmin"];

  if (!isPlainString(role) || !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ message: "Invalid role." });
  }

  if (req.params.id === req.userId) {
    return res.status(403).json({ message: "You cannot change your own role from here." });
  }

  try {
    const target = await User.findById(req.params.id).select("role");
    if (!target) return res.status(404).json({ message: "User not found." });

    if (target.role === "superadmin") {
      return res.status(403).json({ message: "Super administrator roles cannot be changed from here." });
    }

    const nextPermissions = role === "administrator"
      ? ALL_PAGES
      : role === "superadmin"
        ? []
        : getDefaultPermissions(role);

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role, permissions: nextPermissions },
      { new: true }
    ).select("-passwordHash");

    res.json({ message: "Role updated.", user });
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});


// ── DELETE /auth/users/:id  -superadmin deletes any approved user ───
// Superadmin-only. Used by the All Users page. A superadmin can delete
// anyone -including administrators -but never themselves through
// this route (use account settings / a dedicated flow for that, since
// self-deleting your only superadmin account would be unrecoverable).
router.delete("/users/:id", verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    if (req.params.id === req.userId) {
      return res.status(403).json({ message: "You cannot delete your own account from here." });
    }

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found." });

    res.json({ message: "User deleted." });
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});


// ── DELETE /auth/delete-account  ─────────────────────
// Requires the JWT middleware to verify the token and attach req.userId.
router.delete("/delete-account", verifyToken, async (req, res) => {
  try {
    // Prevent superadmins from accidentally self-deleting
    if (req.userRole === "superadmin")
      return res.status(403).json({ message: "Superadmin accounts cannot be self-deleted." });

    await User.findByIdAndDelete(req.userId);
    res.json({ message: "Account deleted." });
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});

export default router;