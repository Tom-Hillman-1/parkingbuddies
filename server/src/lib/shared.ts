export const SIGNUP_REWARD_POINTS = 25;
export const PROFILE_COMPLETION_REWARD_POINTS = 10;
export const LISTING_PUBLISH_REWARD_POINTS = 15;
export const MAX_LISTING_PUBLISH_REWARDS = 3;

export {
    calcAuctionMoneyTotal,
    calcAuctionPointsTotal,
    calcAuctionUnits,
    calcAuctionUnitsForRange,
    calcBookingUnits,
    calcRangeMinutes,
    calcUnitsForMinutes,
    derivedPointsCostFromMoney,
    gbpToPoints,
    MIN_POINTS_COST,
    STRIPE_MIN_GBP_PAYMENT,
    moneyBookingRewardPoints,
    moneyHostingRewardPoints,
    POINTS_PER_GBP,
    toFiniteNumber,
    toMoney,
    type PriceUnit,
} from "../../../shared/domain/pricing";
export { isValidPassword, PASSWORD_REQUIREMENTS_TEXT } from "../../../shared/domain/password";

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
