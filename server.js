import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import authRoutes from "./routes/auth.js";
import clientRoutes from "./routes/client.js";
import maintenanceRoutes from "./routes/maintenance.js";
import storeRoutes from "./routes/store.js";
import reportRoutes from "./routes/report.js";
import supplyRoutes from "./routes/supply.js";
import calendarRoutes from "./routes/calendar.js";
dotenv.config();
connectDB();
const app = express();
app.use(cors());
app.use(express.json());
app.use("/auth", authRoutes);
app.use("/clients", clientRoutes);
app.use("/maintenance", maintenanceRoutes);
app.use("/store", storeRoutes);
app.use("/reports", reportRoutes);
app.use("/supply", supplyRoutes);
app.use("/calendar", calendarRoutes);
app.listen(process.env.PORT || 5000, () =>
  console.log(`Server running on port ${process.env.PORT || 5000}`)
);