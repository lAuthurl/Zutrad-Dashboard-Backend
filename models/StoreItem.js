import mongoose from "mongoose";

const storeItemSchema = new mongoose.Schema(
  {
    serialNumber: { type: String, required: true, unique: true, trim: true },
    partNumber: { type: String, required: true, trim: true },
    machinePart: { type: String, required: true, trim: true },
    machine: {
      type: String,
      required: true,
      enum: ["Macsa ID", "Savema", "Sojet", "BestCode"],
    },
    quantity: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("StoreItem", storeItemSchema);
