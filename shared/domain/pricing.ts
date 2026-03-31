export type PriceUnit = "hour" | "day" | "week";

export const POINTS_PER_GBP = 10;
export const MIN_POINTS_COST = 1;
export const STRIPE_MIN_GBP_PAYMENT = 0.3;

export function toFiniteNumber(value: unknown, fallback = 0) {
    const numeric = Number(value ?? fallback);
    return Number.isFinite(numeric) ? numeric : fallback;
}

export function toMoney(value: unknown) {
    return toFiniteNumber(value, 0);
}

function roundHourlyUnits(minutes: number, mode: "booking" | "auction") {
    if (mode === "booking") {
        const roundedMinutes = Math.max(5, Math.ceil(minutes / 5) * 5);
        return roundedMinutes / 60;
    }

    const roundedMinutes = Math.max(60, Math.ceil(minutes / 60) * 60);
    return roundedMinutes / 60;
}

export function calcUnitsForMinutes(
    minutes: number,
    unit: PriceUnit,
    hourlyMode: "booking" | "auction" = "booking"
) {
    if (!Number.isFinite(minutes) || minutes <= 0) return 0;
    if (unit === "hour") return roundHourlyUnits(minutes, hourlyMode);
    if (unit === "day") return Math.max(1, Math.ceil(minutes / (24 * 60)));
    return Math.max(1, Math.ceil(minutes / (7 * 24 * 60)));
}

export function calcRangeMinutes(start?: Date | string | null, end?: Date | string | null) {
    if (!start || !end) return 0;
    const startDate = start instanceof Date ? start : new Date(start);
    const endDate = end instanceof Date ? end : new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) return 0;
    return Math.round((endDate.getTime() - startDate.getTime()) / 60000);
}

export function calcBookingUnits(start: Date, end: Date, unit: PriceUnit) {
    return calcUnitsForMinutes(calcRangeMinutes(start, end), unit, "booking");
}

export function calcAuctionUnits(minutes: number, unit: PriceUnit) {
    return calcUnitsForMinutes(minutes, unit, "auction");
}

export function calcAuctionUnitsForRange(start?: Date | string | null, end?: Date | string | null, unit: PriceUnit = "hour") {
    return calcUnitsForMinutes(calcRangeMinutes(start, end), unit, "auction");
}

export function calcAuctionMoneyTotal(amountPerUnit: unknown, units: number) {
    const amount = toFiniteNumber(amountPerUnit);
    if (amount <= 0 || !Number.isFinite(units) || units <= 0) return 0;
    return Math.round(amount * units * 100) / 100;
}

export function calcAuctionPointsTotal(amountPerUnit: unknown, units: number) {
    const amount = toFiniteNumber(amountPerUnit);
    if (amount <= 0 || !Number.isFinite(units) || units <= 0) return 0;
    return Math.ceil(amount * units);
}

export function gbpToPoints(totalGbp: unknown) {
    return Math.max(0, Math.round(toMoney(totalGbp) * POINTS_PER_GBP));
}

function minimumPositivePoints(totalGbp: unknown, rate: number) {
    const cashValue = toMoney(totalGbp);
    if (cashValue <= 0) return 0;
    return Math.max(1, gbpToPoints(cashValue * rate));
}

export function derivedPointsCostFromMoney(totalGbp: unknown) {
    const cashValue = toMoney(totalGbp);
    if (cashValue <= 0) return 0;
    return Math.max(1, gbpToPoints(cashValue));
}

export function moneyBookingRewardPoints(totalPriceGbp: unknown) {
    return minimumPositivePoints(totalPriceGbp, 0.1);
}

export function moneyHostingRewardPoints(totalPriceGbp: unknown) {
    return minimumPositivePoints(totalPriceGbp, 0.05);
}
