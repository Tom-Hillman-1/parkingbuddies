export type PriceUnit = "hour" | "day" | "week";
export const SUPPORT_EMAIL = "parkingbuddiesproject@gmail.com";
const DISPLAY_LOCALE = "en-GB";
const DATE_FORMATTER = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
});
const TIME_FORMATTER = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
});
const GBP_FORMATTER = new Intl.NumberFormat(DISPLAY_LOCALE, {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});
const MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    month: "long",
    year: "numeric",
});
const MONTH_SHORT_FORMATTER = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    month: "short",
});

export function toFiniteNumber(value: unknown, fallback = 0) {
    const numeric = Number(value ?? fallback);
    return Number.isFinite(numeric) ? numeric : fallback;
}

export function isTimeHHMM(value: string) {
    return /^\d{2}:\d{2}$/.test(value);
}

export function timeToMinutes(value: string) {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
}

export function pad2(value: number) {
    return String(value).padStart(2, "0");
}

export function toLocalDateInput(date: Date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseYmd(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [yearRaw, monthRaw, dayRaw] = value.split("-");
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    const parsed = new Date(year, month - 1, day);
    if (Number.isNaN(parsed.getTime())) return null;
    parsed.setHours(0, 0, 0, 0);
    return parsed;
}

export function capitalizeLabel(value: string, fallback = "Unknown") {
    const normalized = String(value ?? "").trim();
    if (!normalized) return fallback;
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function calcUnitsForMinutes(
    minutes: number,
    unit: PriceUnit,
    hourlyMode: "booking" | "auction" = "booking"
) {
    if (!Number.isFinite(minutes) || minutes <= 0) return 0;
    if (unit === "hour") {
        const roundedMinutes =
            hourlyMode === "booking"
                ? Math.max(5, Math.ceil(minutes / 5) * 5)
                : Math.max(60, Math.ceil(minutes / 60) * 60);
        return roundedMinutes / 60;
    }
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

export function formatGbp(value: unknown, fallback = GBP_FORMATTER.format(0)) {
    const amount = Number(value);
    return Number.isFinite(amount) ? GBP_FORMATTER.format(amount) : fallback;
}

export function formatDateTimeCompact(value?: string | null, fallback = "-") {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${DATE_FORMATTER.format(date)} ${TIME_FORMATTER.format(date)}`;
}

export function formatDateDisplay(value?: Date | string | null, fallback = "-") {
    if (!value) return fallback;
    const date =
        value instanceof Date
            ? value
            : /^\d{4}-\d{2}-\d{2}$/.test(value)
                ? parseYmd(value)
                : new Date(value);
    if (!date || Number.isNaN(date.getTime())) return typeof value === "string" ? value : fallback;
    return DATE_FORMATTER.format(date);
}

export function formatTimeDisplay(value?: Date | string | null, fallback = "-") {
    if (!value) return fallback;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : fallback;
    return TIME_FORMATTER.format(date);
}

export function formatMonthYearLabel(value: Date) {
    return MONTH_YEAR_FORMATTER.format(value);
}

export function formatMonthShortLabel(value: Date) {
    return MONTH_SHORT_FORMATTER.format(value);
}

export function formatDateTimeLocal(value?: string | null, fallback = "Time on file") {
    if (!value) return fallback;
    try {
        return formatDateTimeCompact(value, fallback);
    } catch {
        return fallback;
    }
}

export function formatDateRangeLocal(start?: string | null, end?: string | null, fallback = "Time on file") {
    if (!start || !end) return fallback;
    return `${formatDateTimeLocal(start, fallback)} -> ${formatDateTimeLocal(end, fallback)}`;
}
