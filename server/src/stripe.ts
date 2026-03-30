import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY environment variable.");
}

export const stripe = new Stripe(key, {
    apiVersion: "2026-01-28.clover",
});
