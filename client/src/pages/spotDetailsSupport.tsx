import { useEffect, useMemo, useState } from "react";
import { DayButton as DayPickerDayButton, type DayButtonProps } from "react-day-picker";
import { AppCalendar } from "../components/ui/AppCalendar";
import { AppDialog } from "../components/ui/AppDialog";
import { AppButton } from "../components/ui/AppForm";
import { AppTimePicker } from "../components/ui/AppTimePicker";
import {
    formatDateDisplay,
    formatDateTimeCompact,
    pad2,
    parseYmd,
    timeToMinutes,
    toFiniteNumber,
    toLocalDateInput,
} from "./pagesShared";

type WindowSlot = {
    mode: "continuous";
    date_from: string;
    date_to: string;
    start: string;
    end: string;
};
type RawWindowSlot = {
    mode?: unknown;
    date_from?: unknown;
    date_to?: unknown;
    start?: unknown;
    end?: unknown;
};

export type AvailabilityJson = {
    type: "window_slots";
    windows?: Array<{
        mode?: "continuous";
        date_from: string;
        date_to: string;
        start: string;
        end: string;
    }>;
    features?: string[];
};

export type AvailabilitySpot = {
    availability_json?: AvailabilityJson | null;
};

export type AuctionBidLike = {
    pay_method?: "money" | "points";
    amount_gbp?: number | string;
    amount_points?: number | null;
};

const MAX_DURATION_MINUTES = 30 * 24 * 60;
export const DURATION_OPTIONS = buildDurationOptions();

export type SlotCalendarProps<TSpot extends AvailabilitySpot> = {
    spot: TSpot;
    startDate: string;
    endDate?: string | null;
    onPickDate: (date: string) => void;
    disabled?: boolean;
};

export function SlotCalendar<TSpot extends AvailabilitySpot>({
    spot,
    startDate,
    endDate,
    onPickDate,
    disabled,
}: SlotCalendarProps<TSpot>) {
    const [visibleMonth, setVisibleMonth] = useState(() => calendarMonthFromYmd(startDate));
    const dayLabels = useMemo(() => buildSlotDayLabels(spot), [spot]);

    useEffect(() => {
        if (!startDate) return;
        setVisibleMonth(calendarMonthFromYmd(startDate));
    }, [startDate]);

    return (
        <div className={`slotCal${disabled ? " is-disabled" : ""}`}>
            <AppCalendar
                mode="single"
                month={visibleMonth}
                onMonthChange={setVisibleMonth}
                disabled={(day) => disabled || !isDaySelectable(spot, day)}
                modifiers={{
                    draftSingle: (day) => hasDraftSlotDayState(startDate, endDate, day, "single"),
                    draftStart: (day) => hasDraftSlotDayState(startDate, endDate, day, "start"),
                    draftMiddle: (day) => hasDraftSlotDayState(startDate, endDate, day, "middle"),
                    draftEnd: (day) => hasDraftSlotDayState(startDate, endDate, day, "end"),
                    availableSingle: (day) => hasWindowDayState(spot, day, "single"),
                    availableStart: (day) => hasWindowDayState(spot, day, "start"),
                    availableMiddle: (day) => hasWindowDayState(spot, day, "middle"),
                    availableEnd: (day) => hasWindowDayState(spot, day, "end"),
                }}
                modifiersClassNames={{
                    draftSingle: "appCalendarDay--draftSingle",
                    draftStart: "appCalendarDay--draftStart",
                    draftMiddle: "appCalendarDay--draftMiddle",
                    draftEnd: "appCalendarDay--draftEnd",
                    availableSingle: "appCalendarDay--availableSingle",
                    availableStart: "appCalendarDay--availableStart",
                    availableMiddle: "appCalendarDay--availableMiddle",
                    availableEnd: "appCalendarDay--availableEnd",
                }}
                components={{
                    DayButton: (props) => <SlotDayButton {...props} dayLabels={dayLabels} />,
                }}
                onDayClick={(day, modifiers) => {
                    if (disabled || modifiers.disabled) return;
                    onPickDate(toLocalDateInput(day));
                }}
                className="appCalendar--slots"
            />
        </div>
    );
}

export type SlotDialogProps = {
    open: boolean;
    spot: AvailabilitySpot;
    startDateLabel: string;
    endDateLabel: string;
    startTime: string;
    setStartTime: (value: string) => void;
    endTime: string;
    setEndTime: (value: string) => void;
    onApply: () => void;
    onClose: () => void;
};

export function SlotDialog({
    open,
    spot,
    startDateLabel,
    endDateLabel,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    onApply,
    onClose,
}: SlotDialogProps) {
    const formattedStartDate = formatDateDisplay(startDateLabel, startDateLabel);
    const formattedEndDate = formatDateDisplay(endDateLabel, endDateLabel);
    const parsedStartDate = parseYmd(startDateLabel);
    const parsedEndDate = parseYmd(endDateLabel);
    const slotStart = parsedStartDate ? setTime(parsedStartDate, normalizeTimeInput(startTime)) : null;
    const slotEnd = parsedEndDate ? setTime(parsedEndDate, normalizeTimeInput(endTime)) : null;
    const slotRangeValid = !!slotStart && !!slotEnd && slotStart < slotEnd;
    const slotAllowed = !!slotStart && !!slotEnd && isSlotAllowed(spot, slotStart, slotEnd);

    return (
        <AppDialog
            open={open}
            onClose={onClose}
            title="Pick slot timing"
            subtitle={`${formattedStartDate} -> ${formattedEndDate}`}
            width="compact"
            className="slotDialog"
        >
            <label className="field">
                <span>Start time on {formattedStartDate}</span>
                <AppTimePicker
                    className="input"
                    value={normalizeTimeInput(startTime)}
                    onChange={(value) => setStartTime(normalizeTimeInput(value))}
                />
            </label>

            <label className="field">
                <span>End time on {formattedEndDate}</span>
                <AppTimePicker
                    className="input"
                    value={normalizeTimeInput(endTime)}
                    onChange={(value) => setEndTime(normalizeTimeInput(value))}
                />
            </label>

            {slotStart && slotEnd && (
                <div className="slotDialogPreview">
                    {formatDateTimeCompact(slotStart.toISOString())} {" -> "} {formatDateTimeCompact(slotEnd.toISOString())}
                </div>
            )}
            {!slotRangeValid && <div className="slotDialogPreview">End time must be after the start time.</div>}
            {slotRangeValid && !slotAllowed && (
                <div className="slotDialogPreview">That range sits outside this listing&apos;s availability window.</div>
            )}

            <div className="rowInline slotDialogFooter">
                <AppButton type="button" onClick={onClose}>
                    Cancel
                </AppButton>
                <AppButton type="button" variant="primary" onClick={onApply} disabled={!slotRangeValid}>
                    Apply
                </AppButton>
            </div>
        </AppDialog>
    );
}

function calendarMonthFromYmd(ymd: string) {
    const parsed = parseYmd(ymd) ?? new Date();
    return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
}

function isTimeHHMM(value: string) {
    return /^\d{2}:\d{2}$/.test(value);
}

function toWindowSlot(raw: unknown): WindowSlot | null {
    if (!raw || typeof raw !== "object") return null;
    const source = raw as RawWindowSlot;

    if (source.mode && source.mode !== "continuous") return null;
    if (typeof source.date_from !== "string" || typeof source.date_to !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source.date_from) || !/^\d{4}-\d{2}-\d{2}$/.test(source.date_to)) return null;
    if (source.date_from > source.date_to) return null;

    if (typeof source.start !== "string" || typeof source.end !== "string") return null;
    if (!isTimeHHMM(source.start) || !isTimeHHMM(source.end)) return null;
    if (source.date_from === source.date_to && timeToMinutes(source.start) >= timeToMinutes(source.end)) return null;

    return {
        mode: "continuous",
        date_from: source.date_from,
        date_to: source.date_to,
        start: source.start,
        end: source.end,
    };
}

function readSavedSlots(spot: AvailabilitySpot) {
    const windows = spot.availability_json?.windows;
    if (!Array.isArray(windows)) return [] as WindowSlot[];
    return windows.map((window) => toWindowSlot(window)).filter((window): window is WindowSlot => Boolean(window));
}

function slotCoversDay(window: WindowSlot, day: Date) {
    const key = toLocalDateInput(startOfDay(day));
    return key >= window.date_from && key <= window.date_to;
}

type WindowDayState = "single" | "start" | "middle" | "end";

function getDraftSlotDayState(startDate: string, endDate: string | null | undefined, dayKey: string): WindowDayState | null {
    if (!startDate) return null;
    const rangeEnd = endDate || startDate;
    if (dayKey < startDate || dayKey > rangeEnd) return null;
    if (startDate === rangeEnd) return "single";
    if (dayKey === startDate) return "start";
    if (dayKey === rangeEnd) return "end";
    return "middle";
}

function hasDraftSlotDayState(startDate: string, endDate: string | null | undefined, day: Date, state: WindowDayState) {
    return getDraftSlotDayState(startDate, endDate, toLocalDateInput(day)) === state;
}

function getWindowDayState(window: WindowSlot, dayKey: string): WindowDayState | null {
    if (dayKey < window.date_from || dayKey > window.date_to) return null;
    if (window.date_from === window.date_to) return "single";
    if (dayKey === window.date_from) return "start";
    if (dayKey === window.date_to) return "end";
    return "middle";
}

function hasWindowDayState(spot: AvailabilitySpot, day: Date, state: WindowDayState) {
    const key = toLocalDateInput(startOfDay(day));
    return readSavedSlots(spot).some((window) => getWindowDayState(window, key) === state);
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

    const windows = readSavedSlots(spot);
    return windows.some((window) => slotCoversDay(window, dayStart));
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

    const windows = readSavedSlots(spot)
        .filter((slot) => slotCoversDay(slot, base))
        .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    if (windows.length > 0) {
        const start = setTime(base, windows[0].start);
        const now = nextWholeQuarterHour();
        if (isSameDay(start, now) && now > start) return now;
        return start;
    }
    return nextWholeQuarterHour();
}

export function formatAvailability(spot: AvailabilitySpot) {
    const windows = readSavedSlots(spot);
    if (windows.length > 0) {
        if (windows.length === 1) {
            const window = windows[0];
            return `${formatDateDisplay(window.date_from)} ${window.start} -> ${formatDateDisplay(window.date_to)} ${window.end}`;
        }
        return `${windows.length} custom slots`;
    }

    return "Not specified";
}

export function isSlotAllowed(spot: AvailabilitySpot, start: Date, end: Date) {
    if (!(start < end)) return false;

    const windows = readSavedSlots(spot);
    return windows.some((window) => isWindowRangeAllowed(window, start, end));
}

function SlotDayButton({
    day,
    modifiers,
    dayLabels,
    className,
    ...buttonProps
}: DayButtonProps & { dayLabels: Map<string, string> }) {
    const slotLabel = dayLabels.get(day.isoDate) ?? "";

    return (
        <DayPickerDayButton
            day={day}
            modifiers={modifiers}
            className={className}
            data-slot-time={slotLabel}
            {...buttonProps}
        >
            {day.date.getDate()}
        </DayPickerDayButton>
    );
}

function buildSlotDayLabels(spot: AvailabilitySpot) {
    const labels = new Map<string, string>();

    // The listing stores availability as date windows, so the picker expands
    // them here into day-level hints for the calendar grid.
    for (const window of readSavedSlots(spot)) {
        const start = parseYmd(window.date_from);
        const end = parseYmd(window.date_to);
        if (!start || !end) continue;

        for (let day = startOfDay(start); day <= end; day = addDays(day, 1)) {
            const key = toLocalDateInput(day);
            const nextLabel = formatWindowLabelForDay(window, key);
            if (!nextLabel) continue;

            const existingLabel = labels.get(key);
            if (existingLabel && existingLabel !== nextLabel) {
                labels.set(key, "Multiple slots");
                continue;
            }

            labels.set(key, nextLabel);
        }
    }

    return labels;
}

function formatWindowLabelForDay(window: WindowSlot, dayKey: string) {
    if (dayKey < window.date_from || dayKey > window.date_to) return "";
    if (window.date_from === window.date_to) return `${window.start}-${window.end}`;
    if (dayKey === window.date_from) return `From ${window.start}`;
    if (dayKey === window.date_to) return `Until ${window.end}`;
    return "All day";
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

function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
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
