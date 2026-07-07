import mongoose from "mongoose";
import express from "express";
import Client from "../models/Client.js";
import { verifyToken, requireSuperAdmin } from "../middleware/auth.js";

const router = express.Router();

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const canEditMachine = (req) => {
  return req.userRole === "superadmin" || req.userRole === "administrator" || req.userPermissions?.includes("maintenance");
};

const requireMachineEditor = (req, res, next) => {
  if (!canEditMachine(req)) {
    return res.status(403).json({ message: "Access denied." });
  }
  next();
};

const findDuplicateMachineSerial = async (serialNumber, { excludeClientId, excludeMachineId } = {}) => {
  const normalizedSerial = String(serialNumber || "").trim();
  if (!normalizedSerial) return null;

  const matchingClients = await Client.find({
    "machines.serialNumber": { $regex: new RegExp(`^${escapeRegExp(normalizedSerial)}$`, "i") },
  }).select("_id machines");

  return matchingClients.find((client) =>
    client._id.toString() !== excludeClientId &&
    client.machines.some((machine) => {
      const sameSerial = machine.serialNumber && machine.serialNumber.toLowerCase() === normalizedSerial.toLowerCase();
      const sameMachine = excludeMachineId && machine._id && machine._id.toString() === excludeMachineId;
      return sameSerial && !sameMachine;
    })
  );
};

const resolveClientDocument = async (input) => {
  if (input === undefined || input === null || input === "") return null;

  if (mongoose.Types.ObjectId.isValid(input)) {
    return Client.findById(input);
  }

  const normalizedInput = String(input).trim();
  if (!normalizedInput) return null;

  if (/^\d+$/.test(normalizedInput)) {
    const index = Number(normalizedInput);
    if (Number.isInteger(index) && index > 0) {
      const clients = await Client.find().sort({ createdAt: 1 }).select("_id");
      const client = clients[index - 1];
      if (client) return Client.findById(client._id);
    }
    return null;
  }

  return Client.findOne({
    companyName: { $regex: new RegExp(`^${escapeRegExp(normalizedInput)}$`, "i") },
  });
};

// GET /clients -list all clients
router.get("/", async (req, res) => {
  try {
    const clients = await Client.find().sort({ createdAt: -1 });
    res.json(clients);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /clients/:id -fetch one client by id, numeric index or company name
router.get("/:id", async (req, res) => {
  try {
    const client = await resolveClientDocument(req.params.id);
    if (!client) return res.status(404).json({ message: "Client not found" });
    res.json(client);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// POST /clients -create a client
router.post("/", async (req, res) => {
  try {
    const client = await Client.create(req.body);
    res.status(201).json(client);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /clients/:id -update a client's top-level fields
router.put("/:id", async (req, res) => {
  try {
    const existingClient = await resolveClientDocument(req.params.id);
    if (!existingClient) return res.status(404).json({ message: "Client not found" });

    const client = await Client.findByIdAndUpdate(existingClient._id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!client) return res.status(404).json({ message: "Client not found" });
    res.json(client);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /clients/:id -delete a client and all its machines (superadmin only)
router.delete("/:id", verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const existingClient = await resolveClientDocument(req.params.id);
    if (!existingClient) return res.status(404).json({ message: "Client not found" });

    const client = await Client.findByIdAndDelete(existingClient._id);
    if (!client) return res.status(404).json({ message: "Client not found" });
    res.json({ message: "Client deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /clients/:id/machines -add a machine to a client
router.post("/:id/machines", async (req, res) => {
  try {
    const client = await resolveClientDocument(req.params.id);
    if (!client) return res.status(404).json({ message: "Client not found" });

    const duplicate = await findDuplicateMachineSerial(req.body?.serialNumber);
    if (duplicate) {
      return res.status(409).json({ message: "A machine with this serial number already exists." });
    }

    client.machines.push(req.body);
    await client.save();
    res.status(201).json(client);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /clients/:id/machines/:machineId -update one machine's fields
router.put("/:id/machines/:machineId", verifyToken, requireMachineEditor, async (req, res) => {
  try {
    const client = await resolveClientDocument(req.params.id);
    if (!client) return res.status(404).json({ message: "Client not found" });
    const machine = client.machines.id(req.params.machineId);
    if (!machine) return res.status(404).json({ message: "Machine not found" });

    if (req.body?.serialNumber !== undefined) {
      const duplicate = await findDuplicateMachineSerial(req.body.serialNumber, {
        excludeClientId: client._id.toString(),
        excludeMachineId: req.params.machineId,
      });
      if (duplicate) {
        return res.status(409).json({ message: "A machine with this serial number already exists." });
      }
    }

    Object.assign(machine, req.body);
    await client.save();
    res.json(client);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /clients/:id/machines/:machineId -remove one machine (superadmin only)
router.delete("/:id/machines/:machineId", verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const client = await resolveClientDocument(req.params.id);
    if (!client) return res.status(404).json({ message: "Client not found" });
    const beforeCount = client.machines.length;
    client.machines = client.machines.filter((m) => m._id.toString() !== req.params.machineId);
    const afterCount = client.machines.length;
    console.log(`Deleting machine ${req.params.machineId} from client ${client._id}. removed=${beforeCount - afterCount}`);
    await client.save();
    res.json(client);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;