import mongoose from "mongoose";

const reportSchema = new mongoose.Schema(
  {
    reportDetails: { type: String, required: true, trim: true },
    lineNumber: { type: Number, required: true },
    imagePaths: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionReason: { type: String, default: "" },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

export default mongoose.model("Report", reportSchema);