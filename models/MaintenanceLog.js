import mongoose from "mongoose";

const maintenanceLogSchema = new mongoose.Schema(
  {
    message: { type: String, required: true },
    machine: {
      type: String,
      required: true,
      enum: ["Macsa ID", "Savema", "Sojet", "BestCode"],
    },
    maintenanceDay: { type: Date, required: true },
    isDone: { type: Boolean, default: false },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
  },
  { timestamps: true }
);

const MaintenanceLog = mongoose.models.MaintenanceLog || mongoose.model("MaintenanceLog", maintenanceLogSchema);

export default MaintenanceLog;