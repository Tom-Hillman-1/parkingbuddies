export const SUPPORT_EMAIL = "parkingbuddiesproject@gmail.com";
const DISPLAY_LOCALE = "en-GB";
const DISPLAY_TIME_ZONE = "UTC";
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const dateStamp = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: DISPLAY_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
});
const timeStamp = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: DISPLAY_TIME_ZONE,
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
    timeZone: DISPLAY_TIME_ZONE,
    month: "long",
    year: "numeric",
});
const monthChipStamp = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: DISPLAY_TIME_ZONE,
    month: "short",
});

export {
    calcAuctionMoneyTotal,
    calcMinimumAuctionMoneyPerUnit,
    calcMinimumAuctionMoneyTotal,
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
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function parseYmd(value: string) {
    if (!YMD_PATTERN.test(value)) return null;
    const [yearRaw, monthRaw, dayRaw] = value.split("-");
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(parsed.getTime())) return null;
    parsed.setUTCHours(0, 0, 0, 0);
    return parsed;
}

export function parseUtcDateTime(ymd: string, hhmm: string) {
    const date = parseYmd(ymd);
    if (!date || !isTimeHHMM(hhmm)) return null;
    const [hoursRaw, minutesRaw] = hhmm.split(":");
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    const next = new Date(date);
    next.setUTCHours(hours, minutes, 0, 0);
    return next;
}

export function formatUtcClock(date: Date) {
    return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
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

export function pushCalendarDayLabel(dayLabels: Map<string, string[]>, dayKey: string, nextLabel: string) {
    const current = dayLabels.get(dayKey) ?? [];
    if (current.includes("All day") || current.includes("Full")) return;
    if (nextLabel === "All day" || nextLabel === "Full") {
        dayLabels.set(dayKey, [nextLabel]);
        return;
    }
    if (!current.includes(nextLabel)) {
        dayLabels.set(dayKey, [...current, nextLabel].sort(compareCalendarDayLabels));
    }
}

export function sortCalendarDayLabelsByStartTime(labels: string[]) {
    return [...labels].sort((left, right) => {
        const leftRange = parseCalendarDayLabel(left);
        const rightRange = parseCalendarDayLabel(right);
        if (!leftRange || !rightRange) return left.localeCompare(right);
        if (leftRange.start !== rightRange.start) {
            return leftRange.start - rightRange.start;
        }
        return leftRange.end - rightRange.end;
    });
}

function compareCalendarDayLabels(left: string, right: string) {
    const leftRange = parseCalendarDayLabel(left);
    const rightRange = parseCalendarDayLabel(right);
    if (!leftRange || !rightRange) return left.localeCompare(right);

    const leftDuration = leftRange.end - leftRange.start;
    const rightDuration = rightRange.end - rightRange.start;
    if (leftDuration !== rightDuration) {
        return rightDuration - leftDuration;
    }

    return leftRange.start - rightRange.start;
}

function parseCalendarDayLabel(label: string) {
    const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(label);
    if (!match) return null;

    const start = timeToMinutes(match[1]);
    let end = timeToMinutes(match[2]);
    if (match[2] === "00:00" && match[1] !== "00:00") {
        end = 24 * 60;
    }

    return { start, end };
}
