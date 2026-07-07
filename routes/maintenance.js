import express from "express";
import MaintenanceLog from "../models/MaintenanceLog.js";
import Client from "../models/Client.js";
import { verifyToken, requireAdmin, requireSuperAdmin } from "../middleware/auth.js";
const router = express.Router();
// GET /maintenance -list all logs, newest first, with client/user details
// Any authenticated user can view the maintenance log list.
router.get("/", verifyToken, async (req, res) => {
  try {
    const logs = await MaintenanceLog.find()
      .sort({ createdAt: -1 })
      .populate("user", "firstName surname")
      .populate("client", "companyName");
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// POST /maintenance -log a new maintenance task
//
// `user` is taken from the verified JWT (req.userId), never from the
// request body -this matches what the frontend already sends (it
// deliberately omits userId, see maintenance.logic.js) and stops a
// caller from logging a task as someone else.
router.post("/", verifyToken, async (req, res) => {
  try {
    const { message, machine, maintenanceDay, clientId, machineSerialNumber, machineId } = req.body;
    if (!message || !machine || !maintenanceDay || !clientId) {
      return res.status(400).json({ message: "All fields are required." });
    }
    const log = await MaintenanceLog.create({
      message,
      machine,
      machineSerialNumber: machineSerialNumber?.trim() || undefined,
      machineId: machineId?.toString?.() || undefined,
      maintenanceDay,
      client: clientId,
      user: req.userId,
    });
    const populated = await MaintenanceLog.findById(log._id)
      .populate("user", "firstName surname")
      .populate("client", "companyName");
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});
// PATCH /maintenance/:id/done -mark a log as completed
//
// Admin/superadmin only, matching userCanMarkDone on the frontend
// (maintenance.logic.js). The frontend hides/disables this action for
// other roles, but that's a UI convenience only -requireAdmin is what
// actually enforces it, so the endpoint can't be called directly by an
// unauthorized user to bypass the UI.
router.patch("/:id/done", verifyToken, requireAdmin, async (req, res) => {
  try {
    const log = await MaintenanceLog.findById(req.params.id);
    if (!log) return res.status(404).json({ message: "Log not found" });

    const completedAt = new Date();
    log.isDone = true;
    await log.save();

    if (log.client) {
      const client = await Client.findById(log.client);
      if (client) {
        const machine = log.machineId
          ? client.machines.id(log.machineId)
          : log.machineSerialNumber
            ? client.machines.find((m) => String(m.serialNumber || "").trim().toLowerCase() === String(log.machineSerialNumber).trim().toLowerCase())
            : client.machines.find((m) => m.machine === log.machine);

        if (machine) {
          machine.lastMaintenanceDate = completedAt;
          await client.save();
        }
      }
    }

    const updated = await MaintenanceLog.findById(log._id)
      .populate("user", "firstName surname")
      .populate("client", "companyName");

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// DELETE /maintenance/:id -permanently delete a maintenance log
//
// Superadmin only, matching userCanDelete on the frontend
// (maintenance.logic.js), same restriction level as machine deletion
// in clientMachine.logic.js. requireSuperAdmin is what actually
// enforces this -the frontend hiding the button is a UI convenience
// only, not the security boundary.
router.delete("/:id", verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const log = await MaintenanceLog.findByIdAndDelete(req.params.id);
    if (!log) return res.status(404).json({ message: "Log not found" });
    res.json({ message: "Maintenance log deleted." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
export default router;