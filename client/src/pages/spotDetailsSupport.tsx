import { useEffect, useMemo, useState } from "react";
import { DayButton as DayPickerDayButton, type DayButtonProps, type DayProps } from "react-day-picker";
import { AppCalendar } from "../components/ui/AppCalendar";
import { AppDialog } from "../components/ui/AppDialog";
import { AppButton } from "../components/ui/AppForm";
import { CalendarTimeSlotsDialog } from "../components/ui/CalendarTimeSlotsDialog";
import { AppTimePicker } from "../components/ui/AppTimePicker";
import {
    formatDateDisplay,
    formatDateTimeCompact,
    formatUtcClock,
    pad2,
    parseUtcDateTime,
    parseYmd,
    pushCalendarDayLabel,
    sortCalendarDayLabelsByStartTime,
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

type SlotBookingLike = {
    start_time?: string | null;
    end_time?: string | null;
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
    bookings?: SlotBookingLike[];
    capacity?: number;
    startDate: string;
    endDate?: string | null;
    onPickDate: (date: string) => void;
    disabled?: boolean;
};

export function getRangeCapacityState(bookings: SlotBookingLike[], start: Date, end: Date, capacity: number) {
    const safeCapacity = Math.max(1, capacity);
    if (!(start < end)) {
        return { maxBooked: 0, spacesLeft: safeCapacity, isFull: false };
    }

    const events: Array<{ at: number; delta: number }> = [];
    for (const booking of bookings) {
        if (!booking.start_time || !booking.end_time) continue;
        const bookingStart = new Date(booking.start_time);
        const bookingEnd = new Date(booking.end_time);
        if (Number.isNaN(bookingStart.getTime()) || Number.isNaN(bookingEnd.getTime()) || !(bookingStart < bookingEnd)) continue;
        const overlapStart = Math.max(start.getTime(), bookingStart.getTime());
        const overlapEnd = Math.min(end.getTime(), bookingEnd.getTime());
        if (overlapEnd <= overlapStart) continue;
        events.push({ at: overlapStart, delta: 1 });
        events.push({ at: overlapEnd, delta: -1 });
    }

    events.sort((a, b) => (a.at === b.at ? a.delta - b.delta : a.at - b.at));
    let active = 0;
    let maxBooked = 0;
    for (const event of events) {
        active += event.delta;
        if (active > maxBooked) {
            maxBooked = active;
        }
    }

    const spacesLeft = Math.max(0, safeCapacity - Math.min(safeCapacity, maxBooked));
    return { maxBooked, spacesLeft, isFull: maxBooked >= safeCapacity };
}

export function SlotCalendar<TSpot extends AvailabilitySpot>({
    spot,
    bookings = [],
    capacity = 1,
    startDate,
    endDate,
    onPickDate,
    disabled,
}: SlotCalendarProps<TSpot>) {
    const [visibleMonth, setVisibleMonth] = useState(() => calendarMonthFromYmd(startDate));
    const [slotInfo, setSlotInfo] = useState<{ dayKey: string; labels: string[] } | null>(null);
    const dayAvailability = useMemo(
        () => buildDayAvailabilityState(spot, bookings, Math.max(1, capacity)),
        [spot, bookings, capacity]
    );
    const fullyBookedDays = dayAvailability.fullyBookedDays;
    const dayLabels = dayAvailability.dayLabels;
    const selectedDays = useMemo(() => buildSelectedSlotDays(startDate, endDate), [startDate, endDate]);

    useEffect(() => {
        if (!startDate) return;
        setVisibleMonth(calendarMonthFromYmd(startDate));
    }, [startDate]);

    return (
        <div className={`slotCal${disabled ? " is-disabled" : ""}`}>
            <AppCalendar
                mode="multiple"
                selected={selectedDays}
                month={visibleMonth}
                onMonthChange={setVisibleMonth}
                disabled={(day) => disabled || !isDaySelectable(spot, day) || fullyBookedDays.has(getDayKey(day))}
                modifiers={{
                    fullyBooked: (day) => fullyBookedDays.has(getDayKey(day)),
                    availableSingle: (day) => !fullyBookedDays.has(getDayKey(day)) && hasWindowDayState(spot, day, "single"),
                    availableStart: (day) => !fullyBookedDays.has(getDayKey(day)) && hasWindowDayState(spot, day, "start"),
                    availableMiddle: (day) => !fullyBookedDays.has(getDayKey(day)) && hasWindowDayState(spot, day, "middle"),
                    availableEnd: (day) => !fullyBookedDays.has(getDayKey(day)) && hasWindowDayState(spot, day, "end"),
                }}
                modifiersClassNames={{
                    fullyBooked: "appCalendarDay--fullyBooked",
                    availableSingle: "appCalendarDay--availableSingle",
                    availableStart: "appCalendarDay--availableStart",
                    availableMiddle: "appCalendarDay--availableMiddle",
                    availableEnd: "appCalendarDay--availableEnd",
                }}
                components={{
                    Day: (props) => (
                        <SlotDayCell
                            {...props}
                            dayLabels={dayLabels}
                            onViewSlots={(dayKey, labels) => setSlotInfo({ dayKey, labels })}
                        />
                    ),
                    DayButton: (props) => <SlotDayButton {...props} dayLabels={dayLabels} />,
                }}
                onDayClick={(day, modifiers) => {
                    if (disabled || modifiers.disabled) return;
                    onPickDate(toLocalDateInput(day));
                }}
                className="appCalendar--slots"
            />

            <CalendarTimeSlotsDialog
                open={!!slotInfo}
                dayLabel={slotInfo ? formatDateDisplay(slotInfo.dayKey, slotInfo.dayKey) : ""}
                labels={slotInfo ? sortCalendarDayLabelsByStartTime(slotInfo.labels) : []}
                onClose={() => setSlotInfo(null)}
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
                    dialogClassName="slotTimeDialog"
                    value={normalizeTimeInput(startTime)}
                    onChange={(value) => setStartTime(normalizeTimeInput(value))}
                />
            </label>

            <label className="field">
                <span>End time on {formattedEndDate}</span>
                <AppTimePicker
                    className="input"
                    dialogClassName="slotTimeDialog"
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
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
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

function buildSelectedSlotDays(startDate: string, endDate: string | null | undefined) {
    const start = parseYmd(startDate);
    const end = parseYmd(endDate || startDate);
    if (!start || !end) return [] as Date[];

    const startDay = startOfDay(start);
    const endDay = startOfDay(end);
    if (endDay < startDay) return [startDay];

    const days: Date[] = [];
    for (let day = startDay; day <= endDay; day = addDays(day, 1)) {
        days.push(new Date(day));
    }

    return days;
}

function getWindowDayState(window: WindowSlot, dayKey: string): WindowDayState | null {
    if (dayKey < window.date_from || dayKey > window.date_to) return null;
    if (window.date_from === window.date_to) return "single";
    if (dayKey === window.date_from) return "start";
    if (dayKey === window.date_to) return "end";
    return "middle";
}

function hasWindowDayState(spot: AvailabilitySpot, day: Date, state: WindowDayState) {
    const key = getDayKey(day);
    return readSavedSlots(spot).some((window) => getWindowDayState(window, key) === state);
}

function isWindowRangeAllowed(window: WindowSlot, start: Date, end: Date) {
    if (!(start < end)) return false;

    const slotStart = parseUtcDateTime(window.date_from, window.start);
    const slotEnd = parseUtcDateTime(window.date_to, window.end);

    if (!slotStart || !slotEnd || Number.isNaN(slotStart.getTime()) || Number.isNaN(slotEnd.getTime())) return false;
    if (!(slotStart < slotEnd)) return false;

    return start >= slotStart && end <= slotEnd;
}

function isDaySelectable(spot: AvailabilitySpot, day: Date) {
    const dayStart = startOfDay(day);
    if (dayStart < startOfDay(new Date())) return false;

    const windows = readSavedSlots(spot);
    return windows.some((window) => slotCoversDay(window, dayStart));
}

function getDayKey(day: Date) {
    return toLocalDateInput(startOfDay(day));
}

function buildDayAvailabilityState(spot: AvailabilitySpot, bookings: SlotBookingLike[], capacity: number) {
    const dayWindows = new Map<string, Array<{ start: Date; end: Date }>>();
    const bookedRanges = bookings
        .map((booking) => {
            if (!booking.start_time || !booking.end_time) return null;
            const start = new Date(booking.start_time);
            const end = new Date(booking.end_time);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) return null;
            return { start, end };
        })
        .filter((range): range is { start: Date; end: Date } => Boolean(range));
    const safeCapacity = Math.max(1, capacity);

    for (const window of readSavedSlots(spot)) {
        const start = parseYmd(window.date_from);
        const end = parseYmd(window.date_to);
        if (!start || !end) continue;

        for (let day = startOfDay(start); day <= end; day = addDays(day, 1)) {
            const key = getDayKey(day);
            const nextDay = addDays(day, 1);
            const segmentStart = key === window.date_from ? setTime(day, window.start) : day;
            const segmentEnd = key === window.date_to ? setTime(day, window.end) : nextDay;
            if (!(segmentStart < segmentEnd)) continue;

            const segments = dayWindows.get(key) ?? [];
            segments.push({ start: segmentStart, end: segmentEnd });
            dayWindows.set(key, segments);
        }
    }

    const fullDays = new Set<string>();
    const dayLabels = new Map<string, string[]>();

    for (const [key, segments] of dayWindows.entries()) {
        let hasAvailability = false;

        for (const segment of segments) {
            const availableSegments = subtractBlockedRanges(segment.start, segment.end, bookedRanges, safeCapacity);

            for (const available of availableSegments) {
                const nextLabel = formatDaySegmentLabel(available.start, available.end);
                if (!nextLabel) continue;
                hasAvailability = true;
                pushCalendarDayLabel(dayLabels, key, nextLabel);
            }
        }

        if (!hasAvailability) {
            fullDays.add(key);
            dayLabels.set(key, ["Full"]);
        }
    }

    return {
        fullyBookedDays: fullDays,
        dayLabels: new Map(Array.from(dayLabels.entries()).map(([key, labels]) => [key, labels.slice(0, 3)])),
    };
}

function subtractBlockedRanges(
    rangeStart: Date,
    rangeEnd: Date,
    bookings: Array<{ start: Date; end: Date }>,
    capacity: number
) {
    if (!(rangeStart < rangeEnd)) return [] as Array<{ start: Date; end: Date }>;

    const safeCapacity = Math.max(1, capacity);
    const blocked: Array<{ start: Date; end: Date }> = [];
    const events: Array<{ at: number; delta: number }> = [];

    for (const booking of bookings) {
        if (booking.end <= rangeStart || booking.start >= rangeEnd) continue;
        const overlapStart = Math.max(rangeStart.getTime(), booking.start.getTime());
        const overlapEnd = Math.min(rangeEnd.getTime(), booking.end.getTime());
        if (overlapEnd <= overlapStart) continue;
        events.push({ at: overlapStart, delta: 1 });
        events.push({ at: overlapEnd, delta: -1 });
    }

    if (events.length > 0) {
        events.sort((a, b) => (a.at === b.at ? a.delta - b.delta : a.at - b.at));
        let active = 0;
        let blockedStart: number | null = null;

        for (const event of events) {
            const before = active;
            active += event.delta;
            if (before < safeCapacity && active >= safeCapacity) {
                blockedStart = event.at;
            }
            if (before >= safeCapacity && active < safeCapacity && blockedStart != null && event.at > blockedStart) {
                blocked.push({ start: new Date(blockedStart), end: new Date(event.at) });
                blockedStart = null;
            }
        }

        if (blockedStart != null) {
            blocked.push({ start: new Date(blockedStart), end: new Date(rangeEnd) });
        }
    }

    if (!blocked.length) return [{ start: rangeStart, end: rangeEnd }];

    let segments = [{ start: rangeStart, end: rangeEnd }];
    for (const block of blocked) {
        const next: Array<{ start: Date; end: Date }> = [];
        for (const segment of segments) {
            if (block.end <= segment.start || block.start >= segment.end) {
                next.push(segment);
                continue;
            }
            if (block.start > segment.start) next.push({ start: segment.start, end: block.start });
            if (block.end < segment.end) next.push({ start: block.end, end: segment.end });
        }
        segments = next;
    }

    return segments.filter((segment) => segment.start < segment.end);
}

function formatDaySegmentLabel(start: Date, end: Date) {
    if (!(start < end)) return "";

    const dayStart = startOfDay(start);
    const nextDay = addDays(dayStart, 1);
    const startMinutes = Math.max(0, Math.round((start.getTime() - dayStart.getTime()) / 60000));
    if (startMinutes <= 0 && end >= nextDay) return "All day";

    const startText = startMinutes <= 0 ? "00:00" : formatUtcClock(start);
    const endText = end >= nextDay ? "00:00" : formatUtcClock(end);

    if (startText === "00:00" && endText === "00:00") return "All day";
    return `${startText}-${endText}`;
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
}: DayButtonProps & { dayLabels: Map<string, string[]> }) {
    const labels = dayLabels.get(day.isoDate) ?? [];
    const slotLabel = labels.length <= 1 ? (labels[0] ?? "") : "";

    return (
        <DayPickerDayButton
            day={day}
            modifiers={modifiers}
            className={className}
            data-slot-time={slotLabel}
            {...buttonProps}
        >
            {Number(day.isoDate.slice(8, 10))}
        </DayPickerDayButton>
    );
}

function SlotDayCell({
    day,
    modifiers,
    dayLabels,
    onViewSlots,
    children,
    ...cellProps
}: DayProps & {
    dayLabels: Map<string, string[]>;
    onViewSlots: (dayKey: string, labels: string[]) => void;
}) {
    const labels = dayLabels.get(day.isoDate) ?? [];
    const showViewButton = labels.length > 1 && !modifiers.disabled;

    return (
        <td {...cellProps}>
            <div className="appCalendarDayStack">
                {children}
                {showViewButton ? (
                    <button
                        type="button"
                        className="appCalendarSlotMore"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onViewSlots(day.isoDate, labels);
                        }}
                    >
                        View slots
                    </button>
                ) : null}
            </div>
        </td>
    );
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
    d.setUTCSeconds(0, 0);

    const roundedMinutes = Math.ceil(d.getUTCMinutes() / 15) * 15;
    if (roundedMinutes === 60) {
        d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
    } else {
        d.setUTCMinutes(roundedMinutes, 0, 0);
    }

    if (d <= now) d.setUTCMinutes(d.getUTCMinutes() + 15, 0, 0);
    return d;
}

export function toTimeInput(date: Date) {
    return formatUtcClock(date);
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
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

export function setTime(date: Date, hhmm: string) {
    const [h, m] = hhmm.split(":").map((v) => Number(v));
    const out = new Date(date);
    out.setUTCHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return out;
}

export function startOfDay(date: Date) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

function isSameDay(a: Date, b: Date) {
    return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

export function roundMoney(value: number) {
    return Math.round(value * 100) / 100;
}
