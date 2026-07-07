import mongoose from "mongoose";

// ── attachment sub-schema ─────────────────────────────────────────────────────
// name:       original filename shown to the user (e.g. "invoice.pdf")
// storedName: unique filename on disk (e.g. "1714000000000-123456789.pdf")
//             present only on entries logged after file-upload was enabled.
//             Legacy entries have name only — the download route checks for
//             storedName and returns a clear error if it's missing.
// mimetype:   MIME type reported by the browser (e.g. "application/pdf")
// size:       file size in bytes
const AttachmentSchema = new mongoose.Schema(
  {
    name:       { type: String, required: true },
    storedName: { type: String, default: null },
    mimetype:   { type: String, default: null },
    size:       { type: Number, default: null },
  },
  { _id: false }
);

const SupplySchema = new mongoose.Schema(
  {
    goodsSupplied: { type: String, required: true, trim: true },
    serialNumber:  { type: String, required: true, trim: true },
    partNumber:    { type: String, required: true, trim: true },
    quantity:      { type: Number, required: true, min: 1 },
    supplyDate:    { type: Date,   required: true },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "Client",
      required: true,
    },
    storeItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "StoreItem",
      default: null,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "User",
      required: true,
    },
    attachments: { type: [AttachmentSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("Supply", SupplySchema);