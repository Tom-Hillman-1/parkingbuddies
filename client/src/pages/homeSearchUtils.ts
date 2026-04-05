import type { ParkingSpot } from "../types";
import { formatDateDisplay, formatTimeDisplay, parseYmd } from "./pagesShared";
import {
    addMinutes,
    formatDurationLabel,
    hasContinuousAvailabilityForRange,
    isSlotAllowed,
    normalizeTimeInput,
    setTime,
} from "./spotDetailsSupport";

export type HomeSearchState = {
    query: string;
    minPrice: string;
    maxPrice: string;
    date: string;
    startTime: string;
    durationMinutes: number;
};

function getChosenDay(search: HomeSearchState) {
    if (!search.date) return null;
    return parseYmd(search.date);
}

function getSearchStart(day: Date, search: HomeSearchState) {
    return setTime(day, normalizeTimeInput(search.startTime));
}

export function buildSearchWindow(search: HomeSearchState) {
    const day = getChosenDay(search);
    if (!day) return null;
    const start = getSearchStart(day, search);
    const end = addMinutes(start, search.durationMinutes);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) return null;
    return { start, end };
}

export function formatSearchWindowSummary(search: HomeSearchState) {
    if (!search.date) return "Any time";
    const day = getChosenDay(search);
    const start = getSearchStart(day ?? new Date(), search);
    const dayLabel = day ? formatDateDisplay(day) : search.date;
    const timeLabel = formatTimeDisplay(start);

    return `${dayLabel} \u00b7 ${timeLabel} \u00b7 ${formatDurationLabel(search.durationMinutes)}`;
}

export function isSpotAvailableForSearchWindow(
    spot: ParkingSpot,
    searchWindow: { start: Date; end: Date } | null
) {
    if (!searchWindow) return true;
    if (!isSlotAllowed(spot, searchWindow.start, searchWindow.end)) return false;

    const capacity = Math.max(1, Number(spot.capacity_total ?? 1));
    const occupied = Array.isArray(spot.occupied_slots) ? spot.occupied_slots : [];
    return hasContinuousAvailabilityForRange(spot, occupied, capacity, searchWindow.start, searchWindow.end);
}
