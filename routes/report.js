import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import Report from "../models/Report.js";
import Client from "../models/Client.js";
import { verifyToken, requireAdmin, requirePermission, requireSuperAdmin } from "../middleware/auth.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, "../../uploads/reports");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const BLOCKED = /\.(exe|sh|bat|cmd|ps1|msi|dll|so)$/i;
    if (BLOCKED.test(file.originalname)) {
      return cb(new Error(`File type not allowed: ${file.originalname}`));
    }
    cb(null, true);
  },
});

const populateReport = (query) =>
  query
    .populate("user", "firstName surname")
    .populate("client", "companyName");

const normalizeReportIdCandidate = (candidate) => {
  if (candidate === undefined || candidate === null) return null;

  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (!trimmed) return null;
    if (["undefined", "null", "nan", "none"].includes(trimmed.toLowerCase())) return null;
    return trimmed;
  }

  if (typeof candidate === "number") return String(candidate);

  if (typeof candidate === "object") {
    const nested = candidate.id ?? candidate._id ?? candidate.reportId;
    return normalizeReportIdCandidate(nested);
  }

  return null;
};

const getReportId = (req) => {
  const candidates = [
    req.params?.id,
    req.body?.reportId,
    req.body?.id,
    req.body?.report?.id,
    req.body?.report?._id,
    req.body?.reportIdValue,
    req.query?.id,
    req.query?.reportId,
    req.query?.report_id,
    req.query?.reportIdValue,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeReportIdCandidate(candidate);
    if (normalized) return normalized;
  }

  return null;
};

// Matches a real 24-char hex Mongo ObjectId exactly. Deliberately NOT
// mongoose.Types.ObjectId.isValid() — that function returns true for plain
// numbers too (e.g. 1), since bson can pad a number into an ObjectId-shaped
// buffer. That quirk was sending Client.findById(1) straight into a
// "Cast to ObjectId failed" error instead of falling through to the
// numeric-index branch below, whenever the frontend sent a mock/index id.
const isRealObjectId = (val) => typeof val === "string" && /^[0-9a-fA-F]{24}$/.test(val);

const resolveClientReference = async (clientId) => {
  if (clientId === undefined || clientId === null || clientId === "") {
    throw new Error("Client is required.");
  }

  if (isRealObjectId(clientId)) {
    const client = await Client.findById(clientId);
    if (client) return client._id;
  }

  if (typeof clientId === "number" || /^\d+$/.test(String(clientId))) {
    const index = Number(clientId);
    if (Number.isInteger(index) && index > 0) {
      const clients = await Client.find().sort({ createdAt: 1 }).select("_id");
      const matchedClient = clients[index - 1];
      if (matchedClient) return matchedClient._id;
    }
  }

  const client = await Client.findOne({
    $or: [
      { companyName: new RegExp(`^${String(clientId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      { companyName: String(clientId) },
    ],
  });

  if (client) return client._id;

  throw new Error("Client not found.");
};

// ── GET /reports — list all reports, newest first ────────────────────────
// Requires login (no longer publicly readable).
router.get("/", verifyToken, async (req, res) => {
  try {
    const reports = await populateReport(Report.find().sort({ createdAt: -1 }));
    res.json(reports);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /reports — file a new report ─────────────────────────────────────
// Requires "reports" permission (or superadmin).
// Accepts either JSON or multipart/form-data so the frontend can upload files.
router.post(
  "/",
  verifyToken,
  requirePermission("reports"),
  upload.array("files", 20),
  async (req, res) => {
    try {
      const { reportDetails, lineNumber, clientId, client, imagePaths } = req.body;
      const resolvedClientId = clientId ?? client;

      if (!reportDetails || !lineNumber || !resolvedClientId) {
        (req.files || []).forEach((f) => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: "Report details, line number and client are required." });
      }

      const clientReference = await resolveClientReference(resolvedClientId);
      const storedFiles = (req.files || []).map((f) => ({
        name: f.originalname,
        storedName: f.filename,
        mimetype: f.mimetype,
        size: f.size,
      }));

      const report = await Report.create({
        reportDetails,
        lineNumber: Number(lineNumber),
        imagePaths: imagePaths || storedFiles.map((f) => f.storedName),
        client: clientReference,
        user: req.userId,
      });
      const populated = await populateReport(Report.findById(report._id));
      res.status(201).json(populated);
    } catch (err) {
      (req.files || []).forEach((f) => fs.unlink(f.path, () => {}));
      res.status(400).json({ message: err.message });
    }
  }
);

// ── PATCH /reports/:id/approve — administrator or superadmin approves ─────
router.patch("/:id/approve", verifyToken, requireAdmin, async (req, res) => {
  try {
    const reportId = getReportId(req);
    if (!reportId || !mongoose.Types.ObjectId.isValid(reportId)) {
      return res.status(400).json({ message: "Invalid report id." });
    }

    const report = await populateReport(
      Report.findByIdAndUpdate(reportId, { status: "approved" }, { new: true })
    );
    if (!report) return res.status(404).json({ message: "Report not found." });
    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH /reports/:id/reject — administrator or superadmin rejects ───────
router.patch("/:id/reject", verifyToken, requireAdmin, async (req, res) => {
  try {
    const reportId = getReportId(req);
    if (!reportId || !mongoose.Types.ObjectId.isValid(reportId)) {
      return res.status(400).json({ message: "Invalid report id." });
    }

    const { reason } = req.body;
    const report = await populateReport(
      Report.findByIdAndUpdate(
        reportId,
        { status: "rejected", rejectionReason: reason || "" },
        { new: true }
      )
    );
    if (!report) return res.status(404).json({ message: "Report not found." });
    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── DELETE /reports/:id — superadmin-only ─────────────────────────────────
router.delete("/:id", verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const reportId = getReportId(req);
    if (!reportId || !mongoose.Types.ObjectId.isValid(reportId)) {
      return res.status(400).json({ message: "Invalid report id." });
    }

    const report = await Report.findByIdAndDelete(reportId);
    if (!report) return res.status(404).json({ message: "Report not found." });
    res.json({ message: "Report deleted." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;