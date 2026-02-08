import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db";
import authRoutes from "./routes/auth";
import meRoutes from "./routes/me";
import parkingSpotRoutes from "./routes/ParkingSpots";
import bookingRoutes from "./routes/bookings";
import settingsRoutes from "./routes/settings";
import dashboardRoutes from "./routes/dashboard";
import paymentsRoutes, { stripeWebhookHandler } from "./routes/payments";
import auctionsRoutes from "./routes/auctions";
dotenv.config();

const app = express();
app.use(cors());
app.post("/payments/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
app.use(express.json({ limit: "5mb" }));

app.use("/auth", authRoutes);
app.use("/me", meRoutes);
app.use("/parking-spots", parkingSpotRoutes);
app.use("/bookings", bookingRoutes);
app.use("/settings", settingsRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/payments", paymentsRoutes);
app.use("/auctions", auctionsRoutes);

app.get("/health", (_req, res) => {
    res.json({ ok: true, message: "ParkingBuddies API is running" });
});
app.get("/db-health", async (_req, res) => {
    try {
        const r = await pool.query("SELECT 1 AS ok");
        res.json({ ok: r.rows[0].ok === 1 });
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e) });
    }
});
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
});
