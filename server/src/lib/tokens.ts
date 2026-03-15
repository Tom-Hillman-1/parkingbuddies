import jwt from "jsonwebtoken";

export function issueAuthToken(userId: string, tokenVersion: number) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET not configured");

    return jwt.sign({ userId, tokenVersion }, secret, { expiresIn: "7d" });
}
