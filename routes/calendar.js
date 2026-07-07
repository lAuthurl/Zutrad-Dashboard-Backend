import express from "express";
import CalendarEvent from "../models/calendarevents.js";
import { verifyToken, requireAdmin, requireSuperAdmin } from "../middleware/auth.js";

const router = express.Router();

// ── small guard, same spirit as isPlainString in auth.js ─────────────
const isPlainString = (val) => typeof val === "string" && val.trim().length > 0;

// ── GET /calendar/events  -fetch all custom calendar events ────────────
// Any authenticated user can view the calendar (same pattern as
// GET /auth/users -read access isn't role-gated, only writes are).
router.get("/events", verifyToken, async (req, res) => {
  try {
    const events = await CalendarEvent.find();
    res.json(events.map((ev) => ev.toEventObject()));
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});

// ── POST /calendar/events  -create an event ─────────────────────────
// Administrator or superadmin only.
router.post("/events", verifyToken, requireAdmin, async (req, res) => {
  const { title, date, start, end, allDay, color } = req.body;

  if (!isPlainString(title)) {
    return res.status(400).json({ message: "Title is required." });
  }
  if (!isPlainString(date) && !isPlainString(start)) {
    return res.status(400).json({ message: "Date or start is required." });
  }

  try {
    const event = await CalendarEvent.create({
      title: title.trim(),
      date: isPlainString(date) ? date : undefined,
      start: isPlainString(start) ? start : undefined,
      end: isPlainString(end) ? end : undefined,
      allDay: typeof allDay === "boolean" ? allDay : true,
      color: isPlainString(color) ? color : undefined,
      createdBy: req.userId,
    });

    res.status(201).json(event.toEventObject());
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});

// ── PATCH /calendar/events/:id  -edit an event ───────────────────────
// Administrator or superadmin only. Only accepts fields a user can
// change from the edit dialog / drag-and-drop; ownership doesn't matter,
// role is what gates this (same as the permissions route in auth.js).
router.patch("/events/:id", verifyToken, requireAdmin, async (req, res) => {
  const { title, date, start, end, allDay, color } = req.body;
  const update = {};

  if (title !== undefined) {
    if (!isPlainString(title)) {
      return res.status(400).json({ message: "Invalid title." });
    }
    update.title = title.trim();
  }
  if (date !== undefined) update.date = isPlainString(date) ? date : undefined;
  if (start !== undefined) update.start = isPlainString(start) ? start : undefined;
  if (end !== undefined) update.end = isPlainString(end) ? end : undefined;
  if (allDay !== undefined) update.allDay = !!allDay;
  if (color !== undefined) update.color = isPlainString(color) ? color : undefined;

  try {
    const event = await CalendarEvent.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });
    if (!event) return res.status(404).json({ message: "Event not found." });

    res.json(event.toEventObject());
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});

// ── DELETE /calendar/events/:id  -delete an event ────────────────────
// Superadmin only.
router.delete("/events/:id", verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const event = await CalendarEvent.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ message: "Event not found." });

    res.json({ message: "Event deleted." });
  } catch {
    res.status(500).json({ message: "Server error." });
  }
});

export default router;