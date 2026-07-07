import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import Supply from "../models/Supply.js";
import StoreItem from "../models/StoreItem.js";
import Client from "../models/Client.js";
import { verifyToken, requirePermission, requireAdmin, requireSuperAdmin, requireAnyPermission } from "../middleware/auth.js";

const router = express.Router();

// ── resolve __dirname in ES modules ──────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── upload directory — created at startup if missing ─────────────────────────
const UPLOAD_DIR = path.join(__dirname, "../../uploads/supply");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── multer — disk storage with unique filenames to avoid collisions ───────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req,  file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB per file
  fileFilter: (_req, file, cb) => {
    const BLOCKED = /\.(exe|sh|bat|cmd|ps1|msi|dll|so)$/i;
    if (BLOCKED.test(file.originalname)) {
      return cb(new Error(`File type not allowed: ${file.originalname}`));
    }
    cb(null, true);
  },
});

// ── handleUpload ───────────────────────────────────────────────────────────────
// Wraps multer so that ANY upload error (MulterError, blocked file type, file
// too large, etc.) is returned as a proper JSON 400 response instead of
// triggering Express's default HTML error page — which would cause the frontend
// to receive non-JSON and show "Server returned an unexpected response".
const handleUpload = (req, res, next) => {
  upload.array("files", 20)(req, res, (err) => {
    if (!err) return next();

    // Log the real error server-side so it's easy to diagnose in the console.
    console.error("[supply upload error]", err.message);

    if (err instanceof multer.MulterError) {
      // e.g. LIMIT_FILE_SIZE, LIMIT_FILE_COUNT, LIMIT_UNEXPECTED_FILE
      const messages = {
        LIMIT_FILE_SIZE:   "One or more files exceed the 10 MB size limit.",
        LIMIT_FILE_COUNT:  "You can attach a maximum of 20 files per entry.",
        LIMIT_UNEXPECTED_FILE: "Unexpected file field. Use the field name \"files\".",
      };
      return res.status(400).json({
        message: messages[err.code] || `Upload error: ${err.message}`,
      });
    }

    // Custom fileFilter error or any other upload problem
    return res.status(400).json({ message: err.message || "File upload failed." });
  });
};

// ── populate helper ───────────────────────────────────────────────────────────
const populateSupply = (query) =>
  query
    .populate("user",   "firstName surname")
    .populate("client", "companyName")
    .populate("storeItem", "machinePart partNumber serialNumber quantity");

const resolveClientReference = async (clientId) => {
  if (clientId === undefined || clientId === null || clientId === "") {
    throw new Error("Client is required.");
  }

  if (mongoose.Types.ObjectId.isValid(clientId)) {
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
    companyName: { $regex: new RegExp(`^${String(clientId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
  });

  if (client) return client._id;

  throw new Error("Client not found.");
};

// ── GET /supply — list all supply log entries, newest first ──────────────────
router.get("/", verifyToken, async (req, res) => {
  try {
    const rows = await populateSupply(Supply.find().sort({ createdAt: -1 }));
    res.json(rows);
  } catch (err) {
    console.error("[supply GET /]", err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /supply/files/:filename — download an attachment ─────────────────────
// MUST be registered before /:id routes so Express doesn't treat "files" as
// an id parameter.
// Users with store or supply permissions, plus admins/superadmins, can download.
router.get("/files/:filename", verifyToken, requireAnyPermission(["store", "supply"]), async (req, res) => {
  try {
    const safeFilename = path.basename(req.params.filename); // strip traversal
    const filePath     = path.join(UPLOAD_DIR, safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found on disk." });
    }

    // Look up the original display name from the DB
    const entry = await Supply.findOne({ "attachments.storedName": safeFilename })
      .select("attachments");
    const att         = entry?.attachments?.find((a) => a.storedName === safeFilename);
    const displayName = att?.name ?? safeFilename;

    // Encode to handle spaces / special characters in filenames
    const encoded = encodeURIComponent(displayName);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${displayName}"; filename*=UTF-8''${encoded}`
    );
    res.sendFile(filePath);
  } catch (err) {
    console.error("[supply GET /files/:filename]", err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /supply — log a new supply entry with optional file attachments ──────
// Requires "supply" permission (or superadmin).
// Uses handleUpload (wraps multer) so any upload error returns JSON, not HTML.
router.post(
  "/",
  verifyToken,
  requirePermission("supply"),
  handleUpload,
  async (req, res) => {
    try {
      const { goodsSupplied, serialNumber, partNumber, quantity, supplyDate, clientId, storeItemId } = req.body;
      const qty = Number(quantity);
      const normalizedSerial = String(serialNumber || "").trim();

      if (!goodsSupplied || !normalizedSerial || !partNumber || !quantity || !supplyDate || !clientId) {
        (req.files || []).forEach((f) => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: "All fields are required." });
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        (req.files || []).forEach((f) => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: "Enter a valid quantity." });
      }

      const attachments = (req.files || []).map((f) => ({
        name:       f.originalname,
        storedName: f.filename,
        mimetype:   f.mimetype,
        size:       f.size,
      }));

      const clientReference = await resolveClientReference(clientId);

      const storeItem = storeItemId
        ? await StoreItem.findById(storeItemId)
        : await StoreItem.findOne({
            serialNumber: new RegExp(`^${normalizedSerial}$`, "i"),
          });

      if (!storeItem) {
        throw new Error("No matching part was found in store for this serial number.");
      }

      const updatedItem = await StoreItem.findOneAndUpdate(
        { _id: storeItem._id, quantity: { $gte: qty } },
        { $inc: { quantity: -qty } },
        { new: true }
      );

      if (!updatedItem) {
        throw new Error(`Insufficient stock. Available quantity: ${storeItem.quantity}`);
      }

      let entry;
      try {
        entry = await Supply.create({
          goodsSupplied,
          serialNumber: normalizedSerial,
          partNumber,
          quantity: qty,
          supplyDate,
          client: clientReference,
          storeItem: storeItem._id,
          user: req.userId,
          attachments,
        });
      } catch (err) {
        await StoreItem.findByIdAndUpdate(storeItem._id, { $inc: { quantity: qty } });
        throw err;
      }

      const populated = await populateSupply(Supply.findById(entry._id));
      res.status(201).json(populated);
    } catch (err) {
      // Clean up uploaded files if DB write fails
      (req.files || []).forEach((f) => fs.unlink(f.path, () => {}));
      console.error("[supply POST /]", err);
      res.status(400).json({ message: err.message });
    }
  }
);

// ── DELETE /supply/:id — remove a single entry and its files ─────────────────
// Superadmin-only.
router.delete("/:id", verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const entry = await Supply.findByIdAndDelete(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found." });

    (entry.attachments || []).forEach(({ storedName }) => {
      if (!storedName) return;
      fs.unlink(path.join(UPLOAD_DIR, path.basename(storedName)), () => {});
    });

    res.json({ message: "Entry deleted." });
  } catch (err) {
    console.error("[supply DELETE /:id]", err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /supply/bulk-delete — remove multiple entries and their files ────────
// Superadmin-only.
router.post("/bulk-delete", verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "ids must be a non-empty array." });
    }

    const entries = await Supply.find({ _id: { $in: ids } }).select("attachments");
    entries.forEach((entry) =>
      (entry.attachments || []).forEach(({ storedName }) => {
        if (!storedName) return;
        fs.unlink(path.join(UPLOAD_DIR, path.basename(storedName)), () => {});
      })
    );

    const result = await Supply.deleteMany({ _id: { $in: ids } });
    res.json({ message: `${result.deletedCount} entries deleted.` });
  } catch (err) {
    console.error("[supply POST /bulk-delete]", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;