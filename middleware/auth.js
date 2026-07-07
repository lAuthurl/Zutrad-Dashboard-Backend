import jwt from "jsonwebtoken";

const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string") {
    const trimmed = authHeader.trim();
    if (trimmed.startsWith("Bearer ")) return trimmed.slice(7).trim();
    if (trimmed) return trimmed;
  }

  const altHeaders = [req.headers["x-access-token"], req.headers["x-auth-token"], req.headers.token];
  for (const value of altHeaders) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  if (typeof req.query?.token === "string" && req.query.token.trim()) {
    return req.query.token.trim();
  }

  return null;
};

// ── verifyToken ─────────────────────────────────────────────────────
// Confirms the request carries a valid JWT and attaches the decoded
// user id + role onto req for downstream handlers to use.
export const verifyToken = (req, res, next) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: "No token provided." });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.id;
    req.userRole = payload.role;
    req.userPermissions = Array.isArray(payload.permissions) ? payload.permissions : [];
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
};

// ── requirePermission ───────────────────────────────────────────────
// Run AFTER verifyToken. Allows superadmins by default and checks a
// user's explicit permissions list for other roles.
export const requirePermission = (permission) => (req, res, next) => {
  if (req.userRole === "superadmin") return next();

  if (req.userRole === "administrator") {
    const hasPermission = req.userPermissions?.includes(permission);
    if (!hasPermission) {
      return res.status(403).json({ message: "Access denied." });
    }
    return next();
  }

  const hasPermission = req.userPermissions?.includes(permission);
  if (!hasPermission) {
    return res.status(403).json({ message: "Access denied." });
  }

  next();
};

// ── requireAnyPermission ─────────────────────────────────────────────
// Allows access when the authenticated user has any of the listed
// permissions, or is a superadmin.
export const requireAnyPermission = (permissions) => (req, res, next) => {
  if (req.userRole === "superadmin") return next();

  const list = Array.isArray(permissions) ? permissions : [permissions];
  const hasAny = list.some((permission) => req.userPermissions?.includes(permission));
  if (!hasAny) {
    return res.status(403).json({ message: "Access denied." });
  }

  next();
};

// ── requireAdmin ────────────────────────────────────────────────────
// Run AFTER verifyToken. Blocks anyone who isn't "administrator" or
// "superadmin" — these are the actual role strings used across the
// app (see ROLES in useSignup.js and the role checks in the admin
// page hooks). Use this on routes that manage other users (approving
// signups, rejecting requests, viewing pending lists, etc).
export const requireAdmin = (req, res, next) => {
  if (req.userRole !== "administrator" && req.userRole !== "superadmin") {
    return res.status(403).json({ message: "Admin access required." });
  }
  next();
};

// ── requireSuperAdmin ───────────────────────────────────────────────
// Run AFTER verifyToken. Stricter than requireAdmin — only lets
// superadmin through. Useful for actions like changing roles or
// deleting other admins.
export const requireSuperAdmin = (req, res, next) => {
  if (req.userRole !== "superadmin") {
    return res.status(403).json({ message: "Superadmin access required." });
  }
  next();
};