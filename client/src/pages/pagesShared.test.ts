import { describe, expect, it } from "vitest";
import { calcUnitsForMinutes } from "./pagesShared";

describe("calcUnitsForMinutes", () => {
    it("rounds booking hourly units in 5-minute increments", () => {
        expect(calcUnitsForMinutes(1, "hour", "booking")).toBeCloseTo(5 / 60);
        expect(calcUnitsForMinutes(62, "hour", "booking")).toBeCloseTo(65 / 60);
    });

    it("rounds auction hourly units in 60-minute increments", () => {
        expect(calcUnitsForMinutes(10, "hour", "auction")).toBe(1);
        expect(calcUnitsForMinutes(62, "hour", "auction")).toBe(2);
    });

    it("keeps day and week rounding behavior", () => {
        expect(calcUnitsForMinutes(61, "day", "booking")).toBe(1);
        expect(calcUnitsForMinutes(24 * 60 + 1, "day", "booking")).toBe(2);
        expect(calcUnitsForMinutes(7 * 24 * 60 + 1, "week", "auction")).toBe(2);
    });
});

