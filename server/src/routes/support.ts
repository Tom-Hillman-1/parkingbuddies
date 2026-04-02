import { Router } from "express";
import { z } from "zod";
import { parseWithSchema } from "../lib/validation";
import { simpleRateLimit } from "../lib/rateLimit";
import { serverError } from "../lib/errors";

const router = Router();
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "parkingbuddiesproject@gmail.com";
const supportRateLimit = simpleRateLimit({
    windowMs: 60 * 60 * 1000,
    max: 6,
    message: "Too many support requests. Please wait a bit and try again.",
    keyPrefix: "support_contact",
});

const supportContactBodySchema = z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    topic: z.string().trim().min(3).max(80),
    message: z.string().trim().min(10).max(2000),
    company: z.string().trim().max(200).optional(),
});

router.post("/contact", supportRateLimit, async (req, res) => {
    const parsedBody = parseWithSchema(supportContactBodySchema, req.body ?? {}, res, "support_contact");
    if (!parsedBody.ok) return;

    const { name, email, topic, message, company } = parsedBody.data;
    if (company) {
        return res.json({ ok: true, sent: true });
    }

    try {
        const payload = new URLSearchParams();
        payload.set("name", name);
        payload.set("email", email);
        payload.set("topic", topic);
        payload.set("message", message);
        payload.set("_subject", `ParkingBuddies help request: ${topic}`);
        payload.set("_template", "table");

        const response = await fetch(`https://formsubmit.co/ajax/${SUPPORT_EMAIL}`, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: payload,
        });

        if (!response.ok) {
            throw new Error(`Support mail provider responded with ${response.status}`);
        }

        return res.json({ ok: true, sent: true });
    } catch (error) {
        return serverError(res, error, "Unable to send your message right now");
    }
});

export default router;
