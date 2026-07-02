import mongoose from "mongoose";

const MachineSchema = new mongoose.Schema({
  serialNumber: { type: String, required: true },
  machine: {
    type: String,
    enum: ["Macsa ID", "Savema", "Sojet", "BestCode"],
    required: true,
  },
  lineInstalled: { type: Number },
  installedDate: { type: Date },
  maintenanceCycle: { type: Number },
  lastMaintenanceDate: { type: Date },
  usageStatus: { type: String },
});

const ClientSchema = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true },
    address: { type: String, trim: true },
    machines: { type: [MachineSchema], default: [] },
  },
  { timestamps: true }
);

const Client = mongoose.models.Client || mongoose.model("Client", ClientSchema);
export default Client;