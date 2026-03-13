import { parseYmd } from "./pagesShared";
import {
    addMinutes,
    formatDurationLabel,
    normalizeTimeInput,
    setTime,
} from "./spotDetailsSupport";

export type HomeSearchState = {
    query: string;
    maxPrice: string;
    date: string;
    startTime: string;
    durationMinutes: number;
};

export function buildSearchWindow(search: HomeSearchState) {
    if (!search.date) return null;
    const day = parseYmd(search.date);
    if (!day) return null;
    const start = setTime(day, normalizeTimeInput(search.startTime));
    const end = addMinutes(start, search.durationMinutes);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) return null;
    return { start, end };
}

export function formatSearchWindowSummary(search: HomeSearchState) {
    if (!search.date) return "Any time";
    return `${search.date} | ${normalizeTimeInput(search.startTime)} | ${formatDurationLabel(search.durationMinutes)}`;
}
