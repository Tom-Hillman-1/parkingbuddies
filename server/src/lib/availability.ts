type AvailabilityWindow = { start: Date; end: Date };
type Queryable = {
    query: (text: string, params?: unknown[]) => Promise<{ rows: Array<{ count?: number | string }> }>;
};
const PENDING_BOOKING_HOLD_MINUTES = 30;
const LONDON_TIME_ZONE = "Europe/London";
const londonDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
});

function parseTimeToMinutes(hhmm: string) {
    const [rawH, rawM] = hhmm.split(":");
    const h = Number(rawH ?? 0);
    const m = Number(rawM ?? 0);
    return h * 60 + m;
}

function londonDateTimeParts(date: Date) {
    const parts = londonDateTimeFormatter.formatToParts(date);
    return {
        year: Number(parts.find((part) => part.type === "year")?.value ?? 0),
        month: Number(parts.find((part) => part.type === "month")?.value ?? 1),
        day: Number(parts.find((part) => part.type === "day")?.value ?? 1),
        hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
        minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0),
    };
}

export function parseLondonDateTime(ymd: string, hhmm: string) {
    const [rawYear, rawMonth, rawDay] = ymd.split("-").map(Number);
    const [rawHour, rawMinute] = hhmm.split(":").map(Number);
    const year = rawYear ?? 0;
    const month = rawMonth ?? 1;
    const day = rawDay ?? 1;
    const hour = rawHour ?? 0;
    const minute = rawMinute ?? 0;
    const desiredUtcMs = Date.UTC(year, month - 1, day, hour, minute);
    let guess = new Date(desiredUtcMs);

    for (let i = 0; i < 3; i += 1) {
        const parts = londonDateTimeParts(guess);
        const actualLocalMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
        const offsetMs = desiredUtcMs - actualLocalMs;
        if (offsetMs === 0) break;
        guess = new Date(guess.getTime() + offsetMs);
    }

    return guess;
}

function londonDateTimeKey(date: Date) {
    const parts = londonDateTimeParts(date);
    const year = String(parts.year).padStart(4, "0");
    const month = String(parts.month).padStart(2, "0");
    const day = String(parts.day).padStart(2, "0");
    const hour = String(parts.hour).padStart(2, "0");
    const minute = String(parts.minute).padStart(2, "0");
    return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function isWindowSlot(raw: any) {
    if (!raw || typeof raw !== "object") return false;
    if (raw.mode !== "continuous") return false;
    if (typeof raw.date_from !== "string" || typeof raw.date_to !== "string") return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date_from) || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date_to)) return false;
    if (raw.date_from > raw.date_to) return false;
    if (typeof raw.start !== "string" || typeof raw.end !== "string") return false;
    if (!/^\d{2}:\d{2}$/.test(raw.start) || !/^\d{2}:\d{2}$/.test(raw.end)) return false;

    const startMin = parseTimeToMinutes(raw.start);
    const endMin = parseTimeToMinutes(raw.end);
    if (raw.date_from === raw.date_to && startMin >= endMin) return false;
    return true;
}

function buildAvailabilityWindows(spot: any, maxDaysForward = 30): AvailabilityWindow[] {
    const a: any = spot?.availability_json;
    if (a?.type !== "window_slots" || !Array.isArray(a.windows)) return [];

    const now = new Date();
    const maxEnd = new Date(now.getTime() + maxDaysForward * 24 * 60 * 60 * 1000);
    const windows: AvailabilityWindow[] = [];
    for (const window of a.windows) {
        if (!isWindowSlot(window)) continue;
        const start = parseLondonDateTime(window.date_from, window.start);
        const end = parseLondonDateTime(window.date_to, window.end);
        if (!(start < end)) continue;
        if (end <= now || start >= maxEnd) continue;
        windows.push({
            start: start < now ? new Date(now) : start,
            end: end > maxEnd ? new Date(maxEnd) : end,
        });
    }
    return windows;
}

function subtractBookings(
    window: AvailabilityWindow,
    bookings: AvailabilityWindow[],
    capacity = 1
): AvailabilityWindow[] {
    const safeCapacity = Math.max(1, Number.isFinite(capacity) ? Math.floor(capacity) : 1);

    if (safeCapacity > 1) {
        const events: Array<{ at: number; delta: number }> = [];
        for (const b of bookings) {
            if (b.end <= window.start || b.start >= window.end) continue;
            const startMs = Math.max(window.start.getTime(), b.start.getTime());
            const endMs = Math.min(window.end.getTime(), b.end.getTime());
            if (endMs <= startMs) continue;
            events.push({ at: startMs, delta: 1 });
            events.push({ at: endMs, delta: -1 });
        }

        if (!events.length) return [{ ...window }];

        events.sort((a, b) => (a.at === b.at ? a.delta - b.delta : a.at - b.at));
        const blocked: AvailabilityWindow[] = [];
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

        let segments: AvailabilityWindow[] = [{ ...window }];
        for (const b of blocked) {
            const next: AvailabilityWindow[] = [];
            for (const seg of segments) {
                if (b.end <= seg.start || b.start >= seg.end) {
                    next.push(seg);
                } else {
                    if (b.start > seg.start) next.push({ start: seg.start, end: b.start });
                    if (b.end < seg.end) next.push({ start: b.end, end: seg.end });
                }
            }
            segments = next;
        }
        return segments;
    }

    let segments: AvailabilityWindow[] = [{ ...window }];
    for (const b of bookings) {
        if (b.end <= window.start || b.start >= window.end) continue;
        const next: AvailabilityWindow[] = [];
        for (const seg of segments) {
            if (b.end <= seg.start || b.start >= seg.end) {
                next.push(seg);
            } else {
                if (b.start > seg.start) next.push({ start: seg.start, end: b.start });
                if (b.end < seg.end) next.push({ start: b.end, end: seg.end });
            }
        }
        segments = next;
    }
    return segments;
}

export function remainingMinutes(spot: any, approved: AvailabilityWindow[]) {
    const windows = buildAvailabilityWindows(spot, 30);
    const capacity = Math.max(1, Number(spot?.capacity_total ?? 1));
    let total = 0;
    for (const w of windows) {
        const segments = subtractBookings(w, approved, capacity);
        for (const s of segments) {
            total += Math.max(0, (s.end.getTime() - s.start.getTime()) / 60000);
        }
    }
    return total;
}

export function isSlotAllowed(spot: any, start: Date, end: Date) {
    if (!(start < end)) return false;

    const a: any = spot?.availability_json;
    if (a?.type !== "window_slots" || !Array.isArray(a.windows)) return false;

    const startKey = londonDateTimeKey(start);
    const endKey = londonDateTimeKey(end);

    for (const window of a.windows) {
        if (!isWindowSlot(window)) continue;
        const slotStartKey = `${window.date_from}T${window.start}`;
        const slotEndKey = `${window.date_to}T${window.end}`;
        if (startKey >= slotStartKey && endKey <= slotEndKey) {
            return true;
        }
    }
    return false;
}

export function availabilityDateRange(availability: any) {
    if (!Array.isArray(availability?.windows)) {
        return { dateFrom: null, dateTo: null };
    }

    const dates = availability.windows
        .filter((window: any) => isWindowSlot(window))
        .map((window: any) => ({
            dateFrom: window.date_from as string,
            dateTo: window.date_to as string,
        }));

    const dateFrom = dates.map((entry: { dateFrom: string; dateTo: string }) => entry.dateFrom).sort()[0] ?? null;
    const dateTo = dates.map((entry: { dateFrom: string; dateTo: string }) => entry.dateTo).sort().at(-1) ?? null;

    return { dateFrom, dateTo };
}

export async function countOverlappingBookings(
    db: Queryable,
    parkingSpotId: unknown,
    startIso: string,
    endIso: string
) {
    const spotId = Array.isArray(parkingSpotId) ? parkingSpotId[0] : parkingSpotId;
    if (typeof spotId !== "string" || !spotId.trim()) return 0;
    const overlapR = await db.query(
        `SELECT COUNT(*)::int AS count
         FROM bookings
         WHERE parking_spot_id = $1
           AND (
               status = 'confirmed'
               OR (status = 'pending' AND created_at >= now() - ($4 * interval '1 minute'))
           )
           AND NOT (end_time <= $2 OR start_time >= $3)`,
        [spotId, startIso, endIso, PENDING_BOOKING_HOLD_MINUTES]
    );
    return Number(overlapR.rows[0]?.count ?? 0);
}

type SlotAvailabilityIssueOptions = {
    db: Queryable;
    parkingSpotId: unknown;
    spot: any;
    start: Date;
    end: Date;
    outsideMessage?: string;
    fullMessage?: string;
};

export async function findSlotAvailabilityIssue({
    db,
    parkingSpotId,
    spot,
    start,
    end,
    outsideMessage = "Requested slot is outside listing availability",
    fullMessage = "No spaces available for that time slot",
}: SlotAvailabilityIssueOptions) {
    if (!isSlotAllowed(spot, start, end)) {
        return outsideMessage;
    }

    const overlapCount = await countOverlappingBookings(db, parkingSpotId, start.toISOString(), end.toISOString());
    const capacity = Math.max(1, Number(spot?.capacity_total ?? 1));
    if (overlapCount >= capacity) {
        return fullMessage;
    }

    return null;
}
