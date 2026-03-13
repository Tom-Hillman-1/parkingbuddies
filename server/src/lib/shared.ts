export type PriceUnit = "hour" | "day" | "week";
export const POINTS_PER_GBP = 10;
export const SIGNUP_REWARD_POINTS = 25;
export const PROFILE_COMPLETION_REWARD_POINTS = 10;
export const LISTING_PUBLISH_REWARD_POINTS = 15;
export const MAX_LISTING_PUBLISH_REWARDS = 3;

export function toMoney(value: unknown) {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
}

function roundHourlyUnits(minutes: number, mode: "booking" | "auction") {
    if (mode === "booking") {
        const roundedMinutes = Math.max(5, Math.ceil(minutes / 5) * 5);
        return roundedMinutes / 60;
    }
    const roundedMinutes = Math.max(60, Math.ceil(minutes / 60) * 60);
    return roundedMinutes / 60;
}

function calcUnitsForMinutes(minutes: number, unit: PriceUnit, hourlyMode: "booking" | "auction") {
    if (!Number.isFinite(minutes) || minutes <= 0) return 0;
    if (unit === "hour") return roundHourlyUnits(minutes, hourlyMode);
    if (unit === "day") return Math.max(1, Math.ceil(minutes / (24 * 60)));
    return Math.max(1, Math.ceil(minutes / (7 * 24 * 60)));
}

export function calcBookingUnits(start: Date, end: Date, unit: PriceUnit) {
    const minutes = (end.getTime() - start.getTime()) / (1000 * 60);
    return calcUnitsForMinutes(minutes, unit, "booking");
}

export function calcAuctionUnits(minutes: number, unit: PriceUnit) {
    return calcUnitsForMinutes(minutes, unit, "auction");
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

export function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}

export function normalizeName(name: string) {
    return name.trim();
}

export function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidName(name: string, min = 2, max = 120) {
    return name.length >= min && name.length <= max;
}

export function isValidPassword(password: string) {
    if (password.length < 8) return false;
    const hasLetter = /[A-Za-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    return hasLetter && hasNumber;
}
