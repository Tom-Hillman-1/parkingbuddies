const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

type AvailabilityRule = { dow: number; start: string; end: string };
type AvailabilityWindow = { start: Date; end: Date };
type Queryable = {
    query: (text: string, params?: any[]) => Promise<{ rows: Array<{ count?: number | string }> }>;
};

function parseTimeToMinutes(hhmm: string) {
    const [rawH, rawM] = hhmm.split(":");
    const h = Number(rawH ?? 0);
    const m = Number(rawM ?? 0);
    return h * 60 + m;
}

export function setTime(d: Date, hhmm: string) {
    const [rawH, rawM] = hhmm.split(":");
    const h = Number(rawH ?? 0);
    const m = Number(rawM ?? 0);
    const out = new Date(d);
    out.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return out;
}

export function isWindowSlot(raw: any) {
    if (!raw || typeof raw !== "object") return false;
    if (raw.mode !== "continuous" && raw.mode !== "split") return false;
    if (typeof raw.date_from !== "string" || typeof raw.date_to !== "string") return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date_from) || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date_to)) return false;
    if (raw.date_from > raw.date_to) return false;
    if (typeof raw.start !== "string" || typeof raw.end !== "string") return false;
    if (!/^\d{2}:\d{2}$/.test(raw.start) || !/^\d{2}:\d{2}$/.test(raw.end)) return false;

    const startMin = parseTimeToMinutes(raw.start);
    const endMin = parseTimeToMinutes(raw.end);
    if (raw.mode === "split" && startMin >= endMin) return false;
    if (raw.mode === "continuous" && raw.date_from === raw.date_to && startMin >= endMin) return false;
    return true;
}

export function normalizeExcludeDows(raw: any): number[] {
    if (!Array.isArray(raw)) return [];
    return Array.from(
        new Set(raw.map((value) => Number(value)).filter((dow) => Number.isInteger(dow) && dow >= 0 && dow <= 6))
    );
}

export function extractAvailabilityRules(spot: any): AvailabilityRule[] {
    const rules: AvailabilityRule[] = [];
    const a = spot?.availability_json;

    if (a?.type === "24_7") {
        return ALL_DAYS.map((dow) => ({ dow, start: "00:00", end: "23:59" }));
    }
    if (a?.type === "same_everyday" && a.start && a.end) {
        return ALL_DAYS.map((dow) => ({ dow, start: a.start, end: a.end }));
    }
    if (a?.type === "custom_weekly" && Array.isArray(a.rules)) {
        return a.rules.slice();
    }
    if (a?.type === "window_slots" && Array.isArray(a.windows)) {
        for (const window of a.windows) {
            if (!isWindowSlot(window) || window.mode !== "split") continue;
            const blocked = new Set(normalizeExcludeDows(window.exclude_dows));
            for (const dow of ALL_DAYS) {
                if (!blocked.has(dow)) rules.push({ dow, start: window.start, end: window.end });
            }
        }
        if (rules.length) return rules;
    }

    if (spot?.availability_type === "24_7") {
        return ALL_DAYS.map((dow) => ({ dow, start: "00:00", end: "23:59" }));
    }
    if (spot?.availability_type === "weekly" && Array.isArray(spot?.available_days)) {
        const ds = spot?.daily_start?.slice(0, 5) ?? "00:00";
        const de = spot?.daily_end?.slice(0, 5) ?? "23:59";
        return spot.available_days.map((dow: number) => ({ dow, start: ds, end: de }));
    }
    return rules;
}

export function buildAvailabilityWindows(spot: any, maxDaysForward = 30): AvailabilityWindow[] {
    const a: any = spot?.availability_json;
    const now = new Date();
    const maxEnd = new Date(now.getTime() + maxDaysForward * 24 * 60 * 60 * 1000);

    if (a?.type === "window_slots" && Array.isArray(a.windows)) {
        const windows: AvailabilityWindow[] = [];
        for (const window of a.windows) {
            if (!isWindowSlot(window)) continue;

            if (window.mode === "continuous") {
                const start = new Date(`${window.date_from}T${window.start}:00`);
                const end = new Date(`${window.date_to}T${window.end}:00`);
                if (!(start < end)) continue;
                if (end <= now || start >= maxEnd) continue;
                windows.push({
                    start: start < now ? new Date(now) : start,
                    end: end > maxEnd ? new Date(maxEnd) : end,
                });
                continue;
            }

            const blocked = new Set(normalizeExcludeDows(window.exclude_dows));
            const rangeStart = new Date(`${window.date_from}T00:00:00`);
            const rangeEnd = new Date(`${window.date_to}T23:59:59`);
            const firstDay = rangeStart > now ? new Date(rangeStart) : new Date(now);
            firstDay.setHours(0, 0, 0, 0);
            const lastDay = rangeEnd < maxEnd ? new Date(rangeEnd) : new Date(maxEnd);
            lastDay.setHours(23, 59, 59, 999);

            for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
                const day = new Date(d);
                if (blocked.has(day.getDay())) continue;
                const start = setTime(day, window.start);
                const end = setTime(day, window.end);
                if (end <= now) continue;
                windows.push({ start, end });
            }
        }
        return windows;
    }

    const rules = extractAvailabilityRules(spot);
    if (!rules.length) return [];

    const dateFrom = a?.date_from ? new Date(`${a.date_from}T00:00:00`) : null;
    const dateTo = a?.date_to ? new Date(`${a.date_to}T23:59:59`) : null;
    const startDay = dateFrom && dateFrom > now ? new Date(dateFrom) : new Date(now);
    startDay.setHours(0, 0, 0, 0);

    const hardEnd = dateTo && dateTo < maxEnd ? new Date(dateTo) : maxEnd;
    hardEnd.setHours(23, 59, 59, 999);

    const windows: AvailabilityWindow[] = [];
    for (let d = new Date(startDay); d <= hardEnd; d.setDate(d.getDate() + 1)) {
        const day = new Date(d);
        const dow = day.getDay();
        const dayRules = rules.filter((r) => r.dow === dow);
        for (const r of dayRules) {
            const start = setTime(day, r.start);
            const end = setTime(day, r.end);
            if (end <= now) continue;
            windows.push({ start, end });
        }
    }
    return windows;
}

export function subtractBookings(
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
    if (a?.type === "window_slots" && Array.isArray(a.windows)) {
        for (const window of a.windows) {
            if (!isWindowSlot(window)) continue;
            const slotStart = new Date(`${window.date_from}T${window.start}:00`);
            const slotEnd = new Date(`${window.date_to}T${window.end}:00`);
            if (!(slotStart < slotEnd)) continue;
            if (start < slotStart || end > slotEnd) continue;

            if (window.mode === "continuous") return true;

            if (start.toDateString() !== end.toDateString()) continue;
            const blocked = new Set(normalizeExcludeDows(window.exclude_dows));
            if (blocked.has(start.getDay())) continue;
            const ruleStart = setTime(start, window.start);
            const ruleEnd = setTime(start, window.end);
            if (start >= ruleStart && end <= ruleEnd) return true;
        }
        return false;
    }

    const rules = extractAvailabilityRules(spot);
    if (!rules.length) return false;

    const isTwentyFourSeven = a?.type === "24_7" || (!a && (spot?.availability_type ?? "24_7") === "24_7");
    const dateFrom = a?.date_from ? new Date(`${a.date_from}T00:00:00`) : null;
    const dateTo = a?.date_to ? new Date(`${a.date_to}T23:59:59`) : null;
    if (dateFrom && start < dateFrom) return false;
    if (dateTo && end > dateTo) return false;

    if (isTwentyFourSeven) return true;

    if (start.toDateString() !== end.toDateString()) return false;
    const dow = start.getDay();
    const dayRules = rules.filter((r) => r.dow === dow);
    if (!dayRules.length) return false;

    for (const r of dayRules) {
        const ruleStart = setTime(start, r.start);
        const ruleEnd = setTime(start, r.end);
        if (start >= ruleStart && end <= ruleEnd) return true;
    }
    return false;
}

export function availabilityDateRange(availability: any) {
    const dateFrom =
        typeof availability?.date_from === "string"
            ? availability.date_from
            : Array.isArray(availability?.windows)
                ? availability.windows
                      .map((window: any) => (typeof window?.date_from === "string" ? window.date_from : null))
                      .filter((value: string | null): value is string => Boolean(value))
                      .sort()[0] ?? null
                : null;

    const dateTo =
        typeof availability?.date_to === "string"
            ? availability.date_to
            : Array.isArray(availability?.windows)
                ? availability.windows
                      .map((window: any) => (typeof window?.date_to === "string" ? window.date_to : null))
                      .filter((value: string | null): value is string => Boolean(value))
                      .sort()
                      .at(-1) ?? null
                : null;

    return { dateFrom, dateTo };
}

export async function countOverlappingBookings(
    db: Queryable,
    parkingSpotId: string | string[] | undefined,
    startIso: string,
    endIso: string
) {
    const spotId = Array.isArray(parkingSpotId) ? parkingSpotId[0] : parkingSpotId;
    if (!spotId) return 0;
    const overlapR = await db.query(
        `SELECT COUNT(*)::int AS count
         FROM bookings
         WHERE parking_spot_id = $1
           AND status IN ('confirmed', 'pending')
           AND NOT (end_time <= $2 OR start_time >= $3)`,
        [spotId, startIso, endIso]
    );
    return Number(overlapR.rows[0]?.count ?? 0);
}
