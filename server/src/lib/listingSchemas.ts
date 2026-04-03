import { z } from "zod";

import { MIN_POINTS_COST } from "./shared";

export const modeSchema = z.enum(["free", "rent", "auction"]);
export type Mode = z.infer<typeof modeSchema>;

export const priceUnitSchema = z.enum(["hour", "day", "week"]);
export type PriceUnit = z.infer<typeof priceUnitSchema>;

export const parkingTypeSchema = z.enum(["private", "public"]);
export type ParkingType = z.infer<typeof parkingTypeSchema>;

export const parkingKindSchema = z.enum([
    "street",
    "parking_lot",
    "garage",
    "closed_parking",
    "driveway",
    "underground",
    "carport",
    "multi_storey",
    "ev_charging",
]);
export type ParkingKind = z.infer<typeof parkingKindSchema>;

export const listingFeatureSchema = z.enum([
    "protected_lot",
    "private_outdoor",
    "private_indoor",
    "gated_access",
    "locked_area",
    "ev_friendly",
    "cctv",
    "covered",
    "well_lit",
    "wide_bay",
    "accessible",
    "residential",
    "near_station",
    "near_airport",
]);
export type ListingFeature = z.infer<typeof listingFeatureSchema>;

const parkingKindInputSchema = z
    .union([parkingKindSchema, z.literal("covered_parking")])
    .transform((value): ParkingKind => (value === "covered_parking" ? "closed_parking" : value));

const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be in YYYY-MM-DD format");
const hhmmSchema = z.string().regex(/^\d{2}:\d{2}$/, "must be in HH:MM format");

function optionalTrimmedNullableString(maxLength: number) {
    return z
        .union([z.string(), z.null(), z.undefined()])
        .transform((value) => {
            if (typeof value !== "string") return null;
            const trimmed = value.trim();
            if (!trimmed) return null;
            return trimmed.slice(0, maxLength);
        });
}

function optionalImageUrlString(maxLength: number) {
    return optionalTrimmedNullableString(maxLength).superRefine((value, ctx) => {
        if (!value) return;

        if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(value)) {
            return;
        }

        try {
            const parsed = new URL(value);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                ctx.addIssue({
                    code: "custom",
                    message: "image_url must use http, https, or a supported image upload",
                });
            }
        } catch {
            ctx.addIssue({
                code: "custom",
                message: "image_url must be a valid image URL",
            });
        }
    });
}

export const listingAvailabilityWindowSchema = z
    .object({
        mode: z.literal("continuous").default("continuous"),
        date_from: ymdSchema,
        date_to: ymdSchema,
        start: hhmmSchema,
        end: hhmmSchema,
    })
    .superRefine((value, ctx) => {
        if (value.date_from > value.date_to) {
            ctx.addIssue({
                code: "custom",
                path: ["date_to"],
                message: "date_to must be on or after date_from",
            });
        }
        if (value.date_from === value.date_to && value.start >= value.end) {
            ctx.addIssue({
                code: "custom",
                path: ["end"],
                message: "end must be after start for same-day windows",
            });
        }
    });
export type ListingAvailabilityWindow = z.output<typeof listingAvailabilityWindowSchema>;

export const listingAvailabilitySchema = z.object({
    type: z.literal("window_slots"),
    windows: z.array(listingAvailabilityWindowSchema).min(1, "availability.windows must contain at least one slot"),
    parking_kind: parkingKindInputSchema.optional(),
    features: z.array(listingFeatureSchema).max(16, "availability.features can contain at most 16 items").optional().default([]),
});
export type ListingAvailability = z.output<typeof listingAvailabilitySchema>;

export const listingPayloadSchema = z.object({
    title: z.string().trim().min(3, "title must be at least 3 characters"),
    description: z.string().trim().min(5, "description must be at least 5 characters"),
    mode: modeSchema,
    address_text: z.string().trim().min(5, "address_text must be at least 5 characters"),
    lat: z.coerce.number().min(-90, "lat must be between -90 and 90").max(90, "lat must be between -90 and 90"),
    lng: z.coerce.number().min(-180, "lng must be between -180 and 180").max(180, "lng must be between -180 and 180"),
    parking_type: parkingTypeSchema.optional().default("private"),
    capacity_total: z.coerce.number().int().min(1, "capacity_total must be at least 1").optional().default(1),
    image_url: optionalImageUrlString(14_500_000),
    price_unit: priceUnitSchema.optional().default("hour"),
    price_gbp: z.coerce.number().min(0, "price_gbp must be zero or higher").optional().default(0),
    allow_points: z.boolean().optional().default(false),
    points_cost: z.coerce.number().int().min(0, "points_cost must be zero or higher").optional().default(0),
    auction_start_price_gbp: z.coerce.number().min(0, "auction_start_price_gbp must be zero or higher").optional().default(0),
    owner_contact_email: optionalTrimmedNullableString(160),
    owner_contact_phone: optionalTrimmedNullableString(60),
    owner_contact_info: optionalTrimmedNullableString(500),
    parking_kind: parkingKindInputSchema.optional(),
    availability: listingAvailabilitySchema,
}).superRefine((value, ctx) => {
    if (Math.abs(value.lat) <= 0.000001 && Math.abs(value.lng) <= 0.000001) {
        ctx.addIssue({
            code: "custom",
            path: ["lat"],
            message: "Select a real map location before publishing",
        });
    }
});
export type ListingPayload = z.output<typeof listingPayloadSchema>;

export function pointsPricingIssue(allowPoints: boolean, pointsCost: number) {
    if (allowPoints && pointsCost < MIN_POINTS_COST) {
        return `points_cost must be >= ${MIN_POINTS_COST} when allow_points is true`;
    }
    return "";
}
