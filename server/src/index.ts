import express, { type Request, type Response } from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import { pool } from "./db";
import authRoutes from "./routes/auth";
import meRoutes from "./routes/me";
import parkingSpotRoutes from "./routes/ParkingSpots";
import bookingRoutes from "./routes/bookings";
import settingsRoutes from "./routes/settings";
import dashboardRoutes from "./routes/dashboard";
import paymentsRoutes, { stripeWebhookHandler } from "./routes/payments";
import auctionsRoutes from "./routes/auctions";
import supportRoutes from "./routes/support";
import { serverError } from "./lib/errors";
dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const demoBypassEnabled = ["1", "true", "yes", "on"].includes(
    String(process.env.DEMO_BYPASS_CONNECT ?? "").toLowerCase()
);

if (!process.env.JWT_SECRET) {
    throw new Error("Missing JWT_SECRET environment variable.");
}
if (isProduction && demoBypassEnabled) {
    throw new Error("DEMO_BYPASS_CONNECT must stay disabled in production.");
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const localFallbackOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
];
const configuredOrigins = [
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
    ...(process.env.CORS_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
]
    .filter((origin): origin is string => Boolean(origin));
const allowedOrigins = new Set(configuredOrigins.length ? configuredOrigins : localFallbackOrigins);

if (isProduction && configuredOrigins.length === 0) {
    throw new Error("Set FRONTEND_URL, CLIENT_URL, or CORS_ORIGINS before starting the API in production.");
}

app.use(
    cors({
        origin(origin, callback) {
            // Allow non-browser tools (curl/postman) that send no Origin.
            if (!origin) return callback(null, true);
            if (allowedOrigins.has(origin)) return callback(null, true);
            return callback(new Error("CORS origin is not allowed"));
        },
    })
);
app.post("/payments/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
app.use(express.json({ limit: "1mb" }));

app.use("/auth", authRoutes);
app.use("/me", meRoutes);
app.use("/parking-spots", parkingSpotRoutes);
app.use("/bookings", bookingRoutes);
app.use("/settings", settingsRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/payments", paymentsRoutes);
app.use("/auctions", auctionsRoutes);
app.use("/support", supportRoutes);

app.use((err: any, _req: Request, res: Response, next: any) => {
    if (err?.type === "entity.too.large") {
        return res.status(413).json({ ok: false, error: "Request payload is too large" });
    }
    if (err?.type === "entity.parse.failed") {
        return res.status(400).json({ ok: false, error: "Malformed JSON request body" });
    }
    return next(err);
});

app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, message: "ParkingBuddies API is running" });
});
app.get("/db-health", async (_req: Request, res: Response) => {
    try {
        const r = await pool.query("SELECT 1 AS ok");
        res.json({ ok: r.rows[0].ok === 1 });
    } catch (e) {
        serverError(res, e);
    }
});
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
});
