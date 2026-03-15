import type { Response } from "express";

export function serverError(res: Response, error: unknown, message = "Internal server error") {
    console.error(error);
    return res.status(500).json({ ok: false, error: message });
}
