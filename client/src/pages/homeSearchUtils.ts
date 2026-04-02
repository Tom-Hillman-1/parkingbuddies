import { formatDateDisplay, formatTimeDisplay, parseYmd } from "./pagesShared";
import {
    addMinutes,
    formatDurationLabel,
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
    // Search uses the same time nrmalising helpers as the booking screen so
    // time basical-y 0" means the same thing in both places
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
