import { describe, expect, it } from "vitest";
import {
    normalizeWindow,
    validateAvailabilityWindows,
    hasAvailabilityOverlap,
    createAvailabilityWindow,
} from "./createListingSupport";

describe("create listing availability helpers", () => {
    it("normalizes valid window slot payload", () => {
        const normalized = normalizeWindow({
            mode: "continuous",
            date_from: "2026-03-10",
            date_to: "2026-03-10",
            start: "09:00",
            end: "10:00",
        });

        expect(normalized).not.toBeNull();
        expect(normalized?.from).toBe("2026-03-10");
        expect(normalized?.to).toBe("2026-03-10");
    });

    it("flags overlapping windows", () => {
        const base = createAvailabilityWindow({
            from: "2026-03-10",
            to: "2026-03-10",
            start: "09:00",
            end: "11:00",
        });
        const candidate = createAvailabilityWindow({
            from: "2026-03-10",
            to: "2026-03-10",
            start: "10:00",
            end: "12:00",
        });

        expect(hasAvailabilityOverlap([base], candidate)).toBe(true);
    });

    it("requires at least one valid window", () => {
        expect(validateAvailabilityWindows([])).toContain("at least one slot");
    });
});

