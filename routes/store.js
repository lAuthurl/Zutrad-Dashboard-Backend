import express from "express";
import StoreItem from "../models/StoreItem.js";
import { verifyToken, requirePermission, requireSuperAdmin } from "../middleware/auth.js";

const router = express.Router();

// ── GET /store — list all inventory items, newest first ────────────────
// Requires login (no longer publicly readable).
router.get("/", verifyToken, async (req, res) => {
  try {
    const items = await StoreItem.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST /store — add a new part to inventory ───────────────────────────
// Requires "store" permission (or superadmin).
router.post("/", verifyToken, requirePermission("store"), async (req, res) => {
  try {
    const { serialNumber, partNumber, machinePart, machine, quantity } = req.body;
    if (!serialNumber || !partNumber || !machinePart || !machine || quantity === undefined) {
      return res.status(400).json({ message: "All fields are required." });
    }
    const duplicate = await StoreItem.findOne({
      serialNumber: new RegExp(`^${serialNumber}$`, "i"),
    });
    if (duplicate) {
      return res.status(409).json({ message: "A part with this serial number already exists." });
    }
    const item = await StoreItem.create({
      serialNumber,
      partNumber,
      machinePart,
      machine,
      quantity: Number(quantity),
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── PATCH /store/:id/quantity — adjust quantity up/down ─────────────────
// Body: { delta: number }. Quantity is clamped at 0.
// Requires "store" permission (or superadmin).
router.patch("/:id/quantity", verifyToken, requirePermission("store"), async (req, res) => {
  try {
    const { delta } = req.body;
    if (typeof delta !== "number") {
      return res.status(400).json({ message: "delta must be a number." });
    }
    const item = await StoreItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found." });
    item.quantity = Math.max(0, item.quantity + delta);
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /store/:id — update a part's fields directly ─────────────────────
// Requires "store" permission (or superadmin).
router.put("/:id", verifyToken, requirePermission("store"), async (req, res) => {
  try {
    const item = await StoreItem.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!item) return res.status(404).json({ message: "Item not found." });
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── DELETE /store/:id — remove a part from inventory ──────────────────────
// Superadmin-only.
router.delete("/:id", verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const item = await StoreItem.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found." });
    res.json({ message: "Item deleted." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;