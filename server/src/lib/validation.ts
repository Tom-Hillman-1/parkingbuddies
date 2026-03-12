import type { Response } from "express";
import { z } from "zod";
import type { ZodError, ZodTypeAny } from "zod";

type ParseOk<T> = { ok: true; data: T };
type ParseErr = { ok: false };

function formatValidationMessage(error: ZodError) {
    const first = error.issues[0];
    if (!first) return "Invalid request payload";
    const path = first.path.length ? first.path.map((segment) => String(segment)).join(".") : "request";
    return `${path}: ${first.message}`;
}

export function parseWithSchema<TSchema extends ZodTypeAny>(
    schema: TSchema,
    payload: unknown,
    res: Response,
    label = "request"
): ParseOk<z.infer<TSchema>> | ParseErr {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
        const message = formatValidationMessage(parsed.error);
        res.status(400).json({ ok: false, error: `${label}: ${message}` });
        return { ok: false };
    }

    return { ok: true, data: parsed.data };
}
