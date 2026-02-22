import { useMemo, useState } from "react";
import { formatDateTimeCompact, pad2, parseYmd, timeToMinutes, toFiniteNumber, toLocalDateInput } from "./pagesShared";

type WindowSlot = {
    mode: "continuous" | "split";
    date_from: string;
    date_to: string;
    start: string;
    end: string;
};

export type AvailabilityJson = {
    type: "24_7" | "same_everyday" | "custom_weekly" | "window_slots";
    start?: string;
    end?: string;
    rules?: Array<{ dow: number; start: string; end: string }>;
    date_from?: string;
    date_to?: string;
    windows?: Array<{
        mode?: "continuous" | "split";
        date_from: string;
        date_to: string;
        start: string;
        end: string;
        exclude_dows?: number[];
    }>;
};

export type AvailabilitySpot = {
    availability_json?: AvailabilityJson | null;
    availability_type?: "24_7" | "weekly";
    available_days?: number[];
    daily_start?: string | null;
    daily_end?: string | null;
};

export type AuctionBidLike = {
    pay_method?: "money" | "points";
    amount_gbp?: number | string;
    amount_points?: number | null;
};

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_DURATION_MINUTES = 30 * 24 * 60;
export const DURATION_OPTIONS = buildDurationOptions();

export type SlotCalendarProps<TSpot extends AvailabilitySpot> = {
    spot: TSpot;
    selectedDate: string;
    startAt: Date;
    endAt: Date;
    onPickDate: (date: string) => void;
    disabled?: boolean;
};

export function SlotCalendar<TSpot extends AvailabilitySpot>({
    spot,
    selectedDate,
    startAt,
    endAt,
    onPickDate,
    disabled,
}: SlotCalendarProps<TSpot>) {
    const [visibleMonth, setVisibleMonth] = useState(() => monthAnchorFromYmd(selectedDate));
    const cells = useMemo(() => buildCalendarMonthCells(visibleMonth), [visibleMonth]);
    const monthLabel = useMemo(
        () => visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        [visibleMonth]
    );

    return (
        <div className="slotCal">
            <div className="wizardCalNav">
                <button
                    type="button"
                    className="btn"
                    onClick={() => setVisibleMonth((prev) => addMonths(startOfMonth(prev), -1))}
                >
                    Prev
                </button>
                <strong className="wizardCalMonth">{monthLabel}</strong>
                <button
                    type="button"
                    className="btn"
                    onClick={() => setVisibleMonth((prev) => addMonths(startOfMonth(prev), 1))}
                >
                    Next
                </button>
            </div>

            <div className="slotCalHead">
                {WEEKDAYS.map((day) => (
                    <span key={day}>{day}</span>
                ))}
            </div>

            <div className="slotCalGrid">
                {cells.map((day, idx) => {
                    if (!day) return <div key={`blank-${idx}`} className="slotCalBlank" />;

                    const key = toLocalDateInput(day);
                    const available = isDaySelectable(spot, day);
                    const inRange = isDayInSelectedRange(day, startAt, endAt);
                    const selected = selectedDate === key;

                    return (
                        <button
                            key={key}
                            type="button"
                            className={`slotCalDay ${available ? "slotCalDay--available" : "slotCalDay--off"} ${selected ? "slotCalDay--selected" : ""} ${inRange ? "slotCalDay--range" : ""}`}
                            onClick={() => onPickDate(key)}
                            disabled={disabled || !available}
                        >
                            <span className="slotCalHint">{available ? getDayAvailabilityLabel(spot, day) : "Unavailable"}</span>
                            <span className="slotCalNum">{day.getDate()}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export type SlotDialogProps = {
    open: boolean;
    dateLabel: string;
    startTime: string;
    setStartTime: (value: string) => void;
    durationMinutes: number;
    setDurationMinutes: (value: number) => void;
    onApply: () => void;
    onClose: () => void;
};

export function SlotDialog({
    open,
    dateLabel,
    startTime,
    setStartTime,
    durationMinutes,
    setDurationMinutes,
    onApply,
    onClose,
}: SlotDialogProps) {
    if (!open) return null;

    const parsedDate = parseYmd(dateLabel);
    const slotStart = parsedDate ? setTime(parsedDate, normalizeTimeInput(startTime)) : null;
    const slotEnd = slotStart ? addMinutes(slotStart, durationMinutes) : null;

    return (
        <div className="slotDialogBackdrop" role="dialog" aria-modal="true">
            <div className="card slotDialog">
                <div className="h3">Pick slot timing</div>
                <div className="tiny muted">{dateLabel}</div>

                <label className="field">
                    <span>Start time</span>
                    <input
                        className="input"
                        type="time"
                        step={900}
                        value={normalizeTimeInput(startTime)}
                        onChange={(e) => setStartTime(normalizeTimeInput(e.target.value))}
                    />
                </label>

                <label className="field">
                    <span>Duration</span>
                    <select
                        className="input"
                        value={durationMinutes}
                        onChange={(e) => setDurationMinutes(clampDurationMinutes(Number(e.target.value)))}
                    >
                        {DURATION_OPTIONS.map((option) => (
                            <option key={`duration-option-${option.value}`} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>

                <div className="slotDialogPreview">Slot length: {formatDurationLabel(durationMinutes)}.</div>

                {slotStart && slotEnd && (
                    <div className="slotDialogPreview">
                        {formatDateTimeCompact(slotStart.toISOString())} {" -> "} {formatDateTimeCompact(slotEnd.toISOString())}
                    </div>
                )}

                <div className="rowInline" style={{ justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="button" className="btn btn-primary" onClick={onApply}>
                        Apply
                    </button>
                </div>
            </div>
        </div>
    );
}

function buildCalendarMonthCells(monthDate: Date) {
    const start = startOfMonth(monthDate);
    const cells: Array<Date | null> = [];
    const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();

    for (let i = 0; i < start.getDay(); i += 1) cells.push(null);

    for (let day = 1; day <= daysInMonth; day += 1) {
        cells.push(new Date(start.getFullYear(), start.getMonth(), day));
    }

    while (cells.length % 7 !== 0) cells.push(null);

    return cells;
}

function monthAnchorFromYmd(ymd: string) {
    const parsed = parseYmd(ymd);
    return startOfMonth(parsed ?? new Date());
}

function startOfMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
    return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function isDayInSelectedRange(day: Date, startAt: Date, endAt: Date) {
    const dayStart = startOfDay(day);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    return dayEnd.getTime() > startAt.getTime() && dayStart.getTime() < endAt.getTime();
}

function isTimeHHMM(value: string) {
    return /^\d{2}:\d{2}$/.test(value);
}

function toWindowSlot(raw: any): WindowSlot | null {
    if (!raw || typeof raw !== "object") return null;

    if (raw.mode && raw.mode !== "continuous" && raw.mode !== "split") return null;
    if (typeof raw.date_from !== "string" || typeof raw.date_to !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date_from) || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date_to)) return null;
    if (raw.date_from > raw.date_to) return null;

    if (typeof raw.start !== "string" || typeof raw.end !== "string") return null;
    if (!isTimeHHMM(raw.start) || !isTimeHHMM(raw.end)) return null;
    if (raw.date_from === raw.date_to && timeToMinutes(raw.start) >= timeToMinutes(raw.end)) return null;

    return {
        mode: raw.mode === "split" ? "split" : "continuous",
        date_from: raw.date_from,
        date_to: raw.date_to,
        start: raw.start,
        end: raw.end,
    };
}

function getWindowSlots(spot: AvailabilitySpot) {
    const windows = spot.availability_json?.type === "window_slots" ? spot.availability_json.windows : [];
    if (!Array.isArray(windows)) return [] as WindowSlot[];
    return windows.map((window) => toWindowSlot(window)).filter((window): window is WindowSlot => Boolean(window));
}

function windowMatchesDay(window: WindowSlot, day: Date) {
    const key = toLocalDateInput(startOfDay(day));
    return key >= window.date_from && key <= window.date_to;
}

function isWindowRangeAllowed(window: WindowSlot, start: Date, end: Date) {
    if (!(start < end)) return false;

    const slotStart = new Date(`${window.date_from}T${window.start}:00`);
    const slotEnd = new Date(`${window.date_to}T${window.end}:00`);

    if (Number.isNaN(slotStart.getTime()) || Number.isNaN(slotEnd.getTime())) return false;
    if (!(slotStart < slotEnd)) return false;

    return start >= slotStart && end <= slotEnd;
}

function isDaySelectable(spot: AvailabilitySpot, day: Date) {
    const dayStart = startOfDay(day);
    if (dayStart < startOfDay(new Date())) return false;

    const windows = getWindowSlots(spot);
    if (windows.length > 0) {
        return windows.some((window) => windowMatchesDay(window, dayStart));
    }

    const availability = spot.availability_json;
    const key = toLocalDateInput(dayStart);
    if (availability?.date_from && key < availability.date_from) return false;
    if (availability?.date_to && key > availability.date_to) return false;

    const isTwentyFourSeven =
        availability?.type === "24_7" || (!availability && (spot.availability_type ?? "24_7") === "24_7");
    if (isTwentyFourSeven) return true;

    const rules = extractAvailabilityRules(spot);
    return rules.some((rule) => rule.dow === dayStart.getDay());
}

export function getAutoStartForDate(spot: AvailabilitySpot | null, ymd: string) {
    const day = parseYmd(ymd);
    if (!day) return nextWholeQuarterHour();

    const base = startOfDay(day);
    if (!spot) {
        const fallback = new Date(base);
        if (isSameDay(fallback, new Date())) return nextWholeQuarterHour();
        return fallback;
    }

    const windows = getWindowSlots(spot)
        .filter((slot) => windowMatchesDay(slot, base))
        .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    if (windows.length > 0) {
        const start = setTime(base, windows[0].start);
        const now = nextWholeQuarterHour();
        if (isSameDay(start, now) && now > start) return now;
        return start;
    }

    const availability = spot.availability_json;
    const isTwentyFourSeven =
        availability?.type === "24_7" || (!availability && (spot.availability_type ?? "24_7") === "24_7");

    let start = new Date(base);
    if (!isTwentyFourSeven) {
        const todayRules = extractAvailabilityRules(spot)
            .filter((rule) => rule.dow === base.getDay())
            .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

        if (todayRules.length > 0) {
            start = setTime(base, todayRules[0].start);
        }
    }

    const now = nextWholeQuarterHour();
    if (isSameDay(start, now) && now > start) return now;
    return start;
}

function getDayAvailabilityLabel(spot: AvailabilitySpot, day: Date) {
    const labels = getWindowSlots(spot)
        .filter((slot) => windowMatchesDay(slot, day))
        .map((slot) => formatWindowLabelForDay(slot, day));
    if (labels.length) {
        const joined = Array.from(new Set(labels)).join(", ");
        return joined.length > 22 ? `${joined.slice(0, 22)}...` : joined;
    }

    const rules = extractAvailabilityRules(spot).filter((rule) => rule.dow === day.getDay());
    if (!rules.length) return "Unavailable";

    const joined = rules.map((rule) => `${rule.start}-${rule.end}`).join(", ");
    return joined.length > 22 ? `${joined.slice(0, 22)}...` : joined;
}

function formatWindowLabelForDay(slot: WindowSlot, day: Date) {
    const dayKey = toLocalDateInput(startOfDay(day));
    if (slot.mode !== "continuous" || slot.date_from === slot.date_to) {
        return `${slot.start}-${slot.end}`;
    }
    if (dayKey === slot.date_from) return `${slot.start}-00:00`;
    if (dayKey === slot.date_to) return `00:00-${slot.end}`;
    return "00:00-00:00";
}

export function formatAvailability(spot: AvailabilitySpot) {
    const availability = spot.availability_json;

    if (availability?.type === "24_7") return "24/7";
    if (availability?.type === "same_everyday" && availability.start && availability.end) {
        return `Daily ${availability.start}-${availability.end}`;
    }

    const windows = getWindowSlots(spot);
    if (windows.length > 0) {
        if (windows.length === 1) {
            const window = windows[0];
            return `${window.date_from} ${window.start} -> ${window.date_to} ${window.end}`;
        }
        return `${windows.length} custom slots`;
    }

    if (availability?.type === "custom_weekly" && Array.isArray(availability.rules)) {
        return availability.rules.map((rule) => `${dayShort(rule.dow)} ${rule.start}-${rule.end}`).join(", ");
    }

    if (spot.availability_type === "24_7") return "24/7";
    if (spot.availability_type === "weekly" && Array.isArray(spot.available_days)) {
        const days = spot.available_days.map(dayShort).join(", ");
        const start = spot.daily_start?.slice(0, 5);
        const end = spot.daily_end?.slice(0, 5);
        return start && end ? `${days} ${start}-${end}` : `${days} (weekly)`;
    }

    return "Not specified";
}

export function isSlotAllowed(spot: AvailabilitySpot, start: Date, end: Date) {
    if (!(start < end)) return false;

    const windows = getWindowSlots(spot);
    if (windows.length > 0) {
        return windows.some((window) => isWindowRangeAllowed(window, start, end));
    }

    const availability = spot.availability_json;
    const rules = extractAvailabilityRules(spot);
    if (!rules.length) return true;

    const from = availability?.date_from ? new Date(`${availability.date_from}T00:00:00`) : null;
    const to = availability?.date_to ? new Date(`${availability.date_to}T23:59:59`) : null;

    if (from && start < from) return false;
    if (to && end > to) return false;

    const isTwentyFourSeven =
        availability?.type === "24_7" || (!availability && (spot.availability_type ?? "24_7") === "24_7");
    if (isTwentyFourSeven) return true;

    if (!isSameDay(start, end)) return false;

    const dayRules = rules.filter((rule) => rule.dow === start.getDay());
    if (!dayRules.length) return false;

    for (const rule of dayRules) {
        const ruleStart = setTime(start, rule.start);
        const ruleEnd = setTime(start, rule.end);
        if (start >= ruleStart && end <= ruleEnd) return true;
    }

    return false;
}

function extractAvailabilityRules(spot: AvailabilitySpot): Array<{ dow: number; start: string; end: string }> {
    const availability = spot.availability_json;

    if (availability?.type === "24_7") {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: "00:00", end: "23:59" }));
    }

    if (availability?.type === "same_everyday" && availability.start && availability.end) {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: availability.start!, end: availability.end! }));
    }

    if (availability?.type === "custom_weekly" && Array.isArray(availability.rules)) {
        return availability.rules.filter(
            (rule): rule is { dow: number; start: string; end: string } =>
                typeof rule?.dow === "number" && typeof rule?.start === "string" && typeof rule?.end === "string"
        );
    }

    if (spot.availability_type === "24_7") {
        return Array.from({ length: 7 }).map((_, dow) => ({ dow, start: "00:00", end: "23:59" }));
    }

    if (spot.availability_type === "weekly" && Array.isArray(spot.available_days)) {
        const start = spot.daily_start?.slice(0, 5) ?? "00:00";
        const end = spot.daily_end?.slice(0, 5) ?? "23:59";
        return spot.available_days.map((dow) => ({ dow, start, end }));
    }

    return [];
}

export function parseDurationQuery(raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return clampDurationMinutes(n * 60);
}

export function clampDurationMinutes(value: number) {
    if (!Number.isFinite(value)) return 60;

    const bounded = Math.max(15, Math.min(MAX_DURATION_MINUTES, Math.round(value)));
    let closest = DURATION_OPTIONS[0]?.value ?? 60;

    for (const option of DURATION_OPTIONS) {
        if (Math.abs(option.value - bounded) < Math.abs(closest - bounded)) {
            closest = option.value;
        }
    }

    return closest;
}

function buildDurationOptions() {
    const options: Array<{ value: number; label: string }> = [];

    for (let minutes = 15; minutes <= 12 * 60; minutes += 15) {
        options.push({ value: minutes, label: formatDurationLabel(minutes) });
    }

    for (let hours = 13; hours <= 72; hours += 1) {
        const minutes = hours * 60;
        options.push({ value: minutes, label: formatDurationLabel(minutes) });
    }

    for (let days = 4; days <= 30; days += 1) {
        const minutes = days * 24 * 60;
        options.push({ value: minutes, label: formatDurationLabel(minutes) });
    }

    return options;
}

export function formatDurationLabel(minutes: number) {
    if (minutes < 60) return `${minutes} min`;

    if (minutes % (24 * 60) === 0) {
        const days = minutes / (24 * 60);
        return days === 1 ? "1 day" : `${days} days`;
    }

    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (remainder === 0) return hours === 1 ? "1 hour" : `${hours} hours`;
    return `${hours}h ${remainder}m`;
}

export function formatBidAmount(bid: AuctionBidLike) {
    if (bid.pay_method === "points" || bid.amount_points != null) return `${toFiniteNumber(bid.amount_points)} pts`;
    return `GBP ${toFiniteNumber(bid.amount_gbp).toFixed(2)}`;
}

export function nextWholeQuarterHour() {
    const now = new Date();
    const d = new Date(now);
    d.setSeconds(0, 0);

    const roundedMinutes = Math.ceil(d.getMinutes() / 15) * 15;
    if (roundedMinutes === 60) {
        d.setHours(d.getHours() + 1, 0, 0, 0);
    } else {
        d.setMinutes(roundedMinutes, 0, 0);
    }

    if (d <= now) d.setMinutes(d.getMinutes() + 15, 0, 0);
    return d;
}

export function toTimeInput(date: Date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function normalizeTimeInput(value: string) {
    if (!/^\d{2}:\d{2}$/.test(value)) return "00:00";

    const [hRaw, mRaw] = value.split(":");
    const h = Number(hRaw);
    const m = Number(mRaw);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return "00:00";
    if (h < 0 || h > 23 || m < 0 || m > 59) return "00:00";

    return `${pad2(h)}:${pad2(m)}`;
}

export function addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60000);
}

export function setTime(date: Date, hhmm: string) {
    const [h, m] = hhmm.split(":").map((v) => Number(v));
    const out = new Date(date);
    out.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return out;
}

export function startOfDay(date: Date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function isSameDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function roundMoney(value: number) {
    return Math.round(value * 100) / 100;
}

function dayShort(dow: number) {
    return WEEKDAYS[dow] ?? "Day";
}
