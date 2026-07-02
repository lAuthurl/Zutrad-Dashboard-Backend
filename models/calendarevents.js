import mongoose from "mongoose";

// ── CalendarEvent ─────────────────────────────────────────────────────────
// Stores custom calendar entries created from the Calendar page. Maintenance
// events are NOT stored here — they're derived on the frontend from
// mockDataMaintenance (see calendar.logic.js: buildInitialEvents), same as
// today. This collection only backs the "custom" events a user adds, edits,
// or deletes directly on the calendar.
const calendarEventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },

    // FullCalendar-style fields. `date` is used for all-day/no-range events
    // (mirrors the shape buildInitialEvents already produces for maintenance
    // entries); start/end are used for anything with a real range.
    date: { type: String },
    start: { type: String },
    end: { type: String },
    allDay: { type: Boolean, default: true },

    color: { type: String },

    // Who created it — useful for auditing who added what, though edit/delete
    // permissions are role-based (see routes/calendar.js), not ownership-based.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Shape the doc the same way the frontend already expects events to look
// (id, title, date/start/end, color, extendedProps), so the client doesn't
// need a translation layer between mock events and real ones.
calendarEventSchema.methods.toEventObject = function () {
  return {
    id: `custom-${this._id}`,
    title: this.title,
    date: this.date || undefined,
    start: this.start || undefined,
    end: this.end || undefined,
    allDay: this.allDay,
    color: this.color,
    extendedProps: { source: "custom", status: "custom" },
  };
};

export default mongoose.model("CalendarEvent", calendarEventSchema);