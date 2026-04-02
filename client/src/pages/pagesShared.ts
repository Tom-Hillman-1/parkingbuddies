export const SUPPORT_EMAIL = "parkingbuddiesproject@gmail.com";
const DISPLAY_LOCALE = "en-GB";
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const dateStamp = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
});
const timeStamp = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
});
const moneyStamp = new Intl.NumberFormat(DISPLAY_LOCALE, {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});
const monthTitleStamp = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    month: "long",
    year: "numeric",
});
const monthChipStamp = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    month: "short",
});

export {
    calcAuctionMoneyTotal,
    calcAuctionPointsTotal,
    calcAuctionUnitsForRange,
    calcRangeMinutes,
    calcUnitsForMinutes,
    derivedPointsCostFromMoney,
    expandRangeToBillableEnd,
    MIN_POINTS_COST,
    POINTS_PER_GBP,
    STRIPE_MIN_GBP_PAYMENT,
    toFiniteNumber,
    type PriceUnit,
} from "../../../shared/domain/pricing";
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
    // Treat YYYY-MM-DD values as local dates. Using new Date("2026-03-30")
    // shifts the day in some time zones, which gets messy fast in booking UIs.
    if (!YMD_PATTERN.test(value)) return null;
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

export function formatGbp(value: unknown, fallback = moneyStamp.format(0)) {
    const amount = Number(value);
    return Number.isFinite(amount) ? moneyStamp.format(amount) : fallback;
}

export function formatDateTimeCompact(value?: string | null, fallback = "-") {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${dateStamp.format(date)} ${timeStamp.format(date)}`;
}

export function formatDateDisplay(value?: Date | string | null, fallback = "-") {
    if (!value) return fallback;
    const date =
        value instanceof Date
            ? value
            : YMD_PATTERN.test(value)
                ? parseYmd(value)
                : new Date(value);
    if (!date || Number.isNaN(date.getTime())) return typeof value === "string" ? value : fallback;
    return dateStamp.format(date);
}

export function formatTimeDisplay(value?: Date | string | null, fallback = "-") {
    if (!value) return fallback;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : fallback;
    return timeStamp.format(date);
}

export function formatMonthYearLabel(value: Date) {
    return monthTitleStamp.format(value);
}

export function formatMonthShortLabel(value: Date) {
    return monthChipStamp.format(value);
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

export function formatCalendarWindowLabelForDay(dayKey: string, rangeStart: string, rangeEnd: string, startTime: string, endTime: string) {
    if (dayKey < rangeStart || dayKey > rangeEnd) return "";
    if (rangeStart === rangeEnd) return `${startTime}-${endTime}`;
    if (dayKey === rangeStart) return `${startTime}-00:00`;
    if (dayKey === rangeEnd) return `00:00-${endTime}`;
    return "All day";
}

export function mergeCalendarDayLabels(existingLabel: string | undefined, nextLabel: string) {
    if (!existingLabel || existingLabel === nextLabel) return nextLabel;
    if (existingLabel === "Full" || nextLabel === "Full") return existingLabel === "Full" ? existingLabel : nextLabel;
    if (existingLabel === "All day" || nextLabel === "All day") return "All day";

    const current = parseCalendarDayLabel(existingLabel);
    const next = parseCalendarDayLabel(nextLabel);
    if (!current || !next) return "Multiple slots";
    if (current.end < next.start || next.end < current.start) return "Multiple slots";

    const mergedStart = Math.min(current.start, next.start);
    const mergedEnd = Math.max(current.end, next.end);
    if (mergedStart === 0 && mergedEnd >= 24 * 60) return "All day";

    return `${formatCalendarMinutes(mergedStart)}-${formatCalendarMinutes(mergedEnd)}`;
}

function parseCalendarDayLabel(label: string) {
    if (label === "All day") return { start: 0, end: 24 * 60 };
    const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(label);
    if (!match) return null;

    const start = timeToMinutes(match[1]);
    let end = timeToMinutes(match[2]);
    if (match[2] === "00:00" && match[1] !== "00:00") {
        end = 24 * 60;
    }

    return { start, end };
}

function formatCalendarMinutes(totalMinutes: number) {
    const normalized = totalMinutes >= 24 * 60 ? 0 : totalMinutes;
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${pad2(hours)}:${pad2(minutes)}`;
}
