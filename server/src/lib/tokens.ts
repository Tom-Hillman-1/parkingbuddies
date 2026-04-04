import jwt from "jsonwebtoken";

const DEFAULT_TOKEN_TTL = "7d";
const REMEMBERED_TOKEN_TTL = "30d";

export function issueAuthToken(userId: string, tokenVersion: number, remember = false) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET not configured");

    return jwt.sign({ userId, tokenVersion }, secret, {
        expiresIn: remember ? REMEMBERED_TOKEN_TTL : DEFAULT_TOKEN_TTL,
    });
}
