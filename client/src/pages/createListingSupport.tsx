import { useMemo } from "react";
import type { ReactNode } from "react";
import { isTimeHHMM as isTime, parseYmd, timeToMinutes as minutes, toLocalDateInput } from "./pagesShared";

export type Mode = "free" | "rent" | "auction";
export type PriceUnit = "hour" | "day" | "week";
export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;
export type FlowStep = Exclude<WizardStep, 1>;
export type SpaceChoice = "1" | "2" | "3plus";
export type Tone = "blue" | "lilac" | "mint" | "cream" | "sky";
export type WizardSheetName = "spaces" | "custom" | "confirm";

export type GeocodeSuggestion = { display_name: string; lat: string; lon: string };
export type AvailabilityWindow = {
    id: string;
    from: string;
    to: string;
    start: string;
    end: string;
};
type AvailabilityWindowInput = Pick<AvailabilityWindow, "from" | "to" | "start" | "end">;
type RawAvailabilityWindow = {
    from?: unknown;
    to?: unknown;
    date_from?: unknown;
    date_to?: unknown;
    start?: unknown;
    end?: unknown;
};
export type DraftSnapshot = {
    mode: Mode;
    parkingType: "private" | "public";
    title: string;
    description: string;
    ownerContactEmail: string;
    ownerContactPhone: string;
    ownerContactInfo: string;
    capacityTotal: string;
    priceUnit: PriceUnit;
    price: string;
    auctionStartPrice: string;
    allowPoints: boolean;
    pointsCost: string;
    availabilityWindows: AvailabilityWindow[];
    addressText: string;
    lat: string;
    lng: string;
    imageUrl: string;
};

export const STEP_COUNT = 6;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DEFAULT_CENTER: [number, number] = [51.5074, -0.1278];
export const LONDON_VIEWBOX = "-0.5103,51.6919,0.3340,51.2868";
export const MIN_AUCTION_START_PRICE_GBP = 0.1;
export const MIN_POINTS_COST = 1;
export const DEFAULT_AUCTION_START_PRICE = String(MIN_AUCTION_START_PRICE_GBP);
export const DEFAULT_POINTS_COST = String(MIN_POINTS_COST);
export const DEFAULT_AVAILABILITY_START = "00:00";
export const DEFAULT_AVAILABILITY_END = "23:59";
export const DEFAULT_SLOT_START = "09:00";
export const DEFAULT_SLOT_END = "17:00";

export const SPACE_CHOICES: Array<{ id: SpaceChoice; label: string; value: number }> = [
    { id: "1", label: "1 space", value: 1 },
    { id: "2", label: "2 spaces", value: 2 },
    { id: "3plus", label: "3+ spaces", value: 4 },
];

export const MODEL_CHOICES: Array<{ mode: Mode; title: string; copy: string; tone: Tone; help: string }> = [
    { mode: "rent", title: "Rent", copy: "Fixed pricing for instant bookings.", tone: "blue", help: "Drivers can book instantly at the rate you set." },
    { mode: "auction", title: "Auction", copy: "Drivers submit offers. You get to approve.", tone: "lilac", help: "Drivers send offers and you decide which bid to accept." },
    { mode: "free", title: "Free", copy: "No payment required for this listing.", tone: "mint", help: "Bookings are free to drivers and no payment is collected." },
];

export const STEP_META: Record<FlowStep, { panelTitle: string; panelCopy: string; panelTone: Tone; title: string; subtitle: string }> = {
    2: { panelTitle: "Basics", panelCopy: "Set the core details so drivers quickly understand your space.", panelTone: "blue", title: "Listing basics", subtitle: "Keep this short, clear, and practical." },
    3: { panelTitle: "Pricing", panelCopy: "Choose a simple pricing setup that matches your listing model.", panelTone: "mint", title: "Pricing", subtitle: "Set how drivers pay for this listing." },
    4: { panelTitle: "Availability", panelCopy: "Add one or more date/time slots to describe when the listing is available.", panelTone: "lilac", title: "Availability", subtitle: "Pick two dates, then add a slot for that range." },
    5: { panelTitle: "Location", panelCopy: "Add a searchable address and confirm the exact map pin.", panelTone: "cream", title: "Location", subtitle: "Search once, then fine-tune by tapping on the map." },
    6: { panelTitle: "Images", panelCopy: "A clear image improves trust and click-through for drivers.", panelTone: "sky", title: "Images", subtitle: "Optional, but strongly recommended." },
};

export const PRICE_UNIT_CHOICES: Array<{ id: PriceUnit; label: string }> = [{ id: "hour", label: "Hourly" }, { id: "day", label: "Daily" }, { id: "week", label: "Weekly" }];
export const PRICE_UNIT_HELP: Record<PriceUnit, string> = {
    hour: "Charges by hour. Drivers can choose any start and end time within your availability.",
    day: "Charges by day. Shorter bookings are still billed as a full day.",
    week: "Charges by week. Longer stays are rounded up by full weeks.",
};

export function parseCoordinates(lat: string, lng: string) {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
    if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) return null;
    return { lat: latNum, lng: lngNum };
}

export function buildMonthCells(monthStart: Date) {
    const start = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
    const totalDays = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    const cells: Array<Date | null> = [];
    for (let i = 0; i < start.getDay(); i += 1) cells.push(null);
    for (let i = 0; i < totalDays; i += 1) {
        const day = new Date(start);
        day.setDate(start.getDate() + i);
        cells.push(day);
    }
    return cells;
}

export function isYmdInRange(day: string, from: string, to: string) {
    if (!from || !to) return false;
    return day >= from && day <= to;
}

export function formatYmdLabel(ymd: string) {
    const parsed = parseYmd(ymd);
    if (!parsed) return ymd;
    return parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function isYmdInWindow(day: string, window: AvailabilityWindow) {
    return day >= window.from && day <= window.to;
}

export function createAvailabilityWindow(partial?: Partial<Omit<AvailabilityWindow, "id">>): AvailabilityWindow {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        from: partial?.from ?? toLocalDateInput(new Date()),
        to: partial?.to ?? toLocalDateInput(new Date()),
        start: partial?.start ?? DEFAULT_SLOT_START,
        end: partial?.end ?? DEFAULT_SLOT_END,
    };
}

export function availabilityWindowBounds(window: Pick<AvailabilityWindow, "from" | "to" | "start" | "end">) {
    if (!isTime(window.start) || !isTime(window.end)) return null;
    const start = new Date(`${window.from}T${window.start}:00`);
    const end = new Date(`${window.to}T${window.end}:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return { start, end };
}

export function availabilityWindowIssue(window: AvailabilityWindowInput) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(window.from) || !/^\d{4}-\d{2}-\d{2}$/.test(window.to) || window.from > window.to) {
        return "Each slot needs a valid date range.";
    }
    if (!isTime(window.start) || !isTime(window.end)) {
        return "Each slot needs valid start and end times.";
    }
    const bounds = availabilityWindowBounds(window);
    if (!bounds || bounds.start >= bounds.end) {
        return "Each slot needs end time after start time.";
    }
    return "";
}

export function hasAvailabilityOverlap(windows: AvailabilityWindowInput[], candidate: AvailabilityWindowInput, skipIndex = -1) {
    const nextBounds = availabilityWindowBounds(candidate);
    if (!nextBounds) return false;

    for (let i = 0; i < windows.length; i += 1) {
        if (i === skipIndex) continue;
        const bounds = availabilityWindowBounds(windows[i]);
        if (!bounds) continue;
        if (bounds.start < nextBounds.end && bounds.end > nextBounds.start) {
            return true;
        }
    }
    return false;
}

export function validateAvailabilityWindows(windows: AvailabilityWindowInput[]) {
    if (!windows.length) return "Pick a date range and add at least one slot.";

    const ranges: Array<{ start: Date; end: Date }> = [];
    for (const window of windows) {
        const issue = availabilityWindowIssue(window);
        if (issue) return issue;
        const bounds = availabilityWindowBounds(window);
        if (bounds) ranges.push(bounds);
    }

    ranges.sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let i = 1; i < ranges.length; i += 1) {
        if (ranges[i].start < ranges[i - 1].end) {
            return "Availability slots cannot overlap.";
        }
    }
    return "";
}

export function toAvailabilityPayload(windows: AvailabilityWindowInput[]) {
    return {
        type: "window_slots",
        windows: windows.map((window) => ({
            mode: "continuous",
            date_from: window.from,
            date_to: window.to,
            start: window.start,
            end: window.end,
            exclude_dows: [],
        })),
    };
}

export function modeLabel(mode: Mode) {
    return mode === "rent" ? "Rent" : mode === "auction" ? "Auction" : "Free";
}

export function asString(value: unknown, fallback = "") {
    return typeof value === "string" ? value : fallback;
}

export function normalizeMode(value: unknown): Mode {
    return value === "auction" || value === "free" ? value : "rent";
}

export function normalizePriceUnit(value: unknown): PriceUnit {
    return value === "day" || value === "week" ? value : "hour";
}

export function normalizeWindow(raw: unknown): AvailabilityWindow | null {
    if (!raw || typeof raw !== "object") return null;
    const source = raw as RawAvailabilityWindow;
    const from = typeof source.from === "string" ? source.from : typeof source.date_from === "string" ? source.date_from : "";
    const to = typeof source.to === "string" ? source.to : typeof source.date_to === "string" ? source.date_to : "";
    const start = typeof source.start === "string" ? source.start : "";
    const end = typeof source.end === "string" ? source.end : "";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
    if (from > to) return null;
    if (!isTime(start) || !isTime(end)) return null;
    if (from === to && minutes(start) >= minutes(end)) return null;

    return createAvailabilityWindow({ from, to, start, end });
}

export function Tooltip({ label, text }: { label: string; text: string }) {
    return (
        <span className="wizardTooltip">
            <button
                type="button"
                className="wizardTooltipBtn"
                aria-label={label}
                title={text}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                ?
            </button>
            <span role="tooltip" className="wizardTooltipBubble">
                {text}
            </span>
        </span>
    );
}

export function SelectionTile({
    title,
    copy,
    help,
    tone,
    active,
    onClick,
    spacesLabel,
    onEditSpaces,
}: {
    title: string;
    copy: string;
    help: string;
    tone: Tone;
    active: boolean;
    onClick: () => void;
    spacesLabel?: string;
    onEditSpaces?: () => void;
}) {
    return (
        <article
            className={`wizardTile wizardTile--${tone}${active ? " is-active" : ""}`}
            role="button"
            tabIndex={0}
            aria-pressed={active}
            onClick={onClick}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onClick();
            }}
        >
            <div className="wizardTileSelect">
                <div className="wizardTileHead">
                    <Tooltip label={`${title} mode help`} text={help} />
                </div>
                <span className="wizardTileTitle">{title}</span>
                <span className="wizardTileCopy">{copy}</span>
            </div>

            {active && onEditSpaces && spacesLabel && (
                <div className="wizardTileSpotsRow">
                    <span className="wizardTileSpotsValue">{spacesLabel}</span>
                    <button
                        type="button"
                        className="btn wizardTileSpotsBtn"
                        onClick={(event) => {
                            event.stopPropagation();
                            onEditSpaces();
                        }}
                    >
                        Edit spots
                    </button>
                </div>
            )}
        </article>
    );
}

export function WizardSheet({
    open,
    title,
    subtitle,
    onClose,
    children,
    wide = false,
}: {
    open: boolean;
    title: string;
    subtitle: string;
    onClose: () => void;
    children: ReactNode;
    wide?: boolean;
}) {
    if (!open) return null;

    return (
        <div className="createSheetBackdrop" role="presentation" onClick={onClose}>
            <section
                className={`createSheet${wide ? " createSheet--wide" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="createSheetHead">
                    <div>
                        <div className="heroKicker">SETUP</div>
                        <div className="h3">{title}</div>
                        <div className="createFieldHint">{subtitle}</div>
                    </div>
                    <button type="button" className="btn" onClick={onClose}>
                        Close
                    </button>
                </div>

                {children}
            </section>
        </div>
    );
}

export function SheetActions({
    secondaryLabel,
    onSecondary,
    primaryLabel,
    onPrimary,
    secondaryDisabled = false,
    primaryDisabled = false,
}: {
    secondaryLabel: string;
    onSecondary: () => void;
    primaryLabel: string;
    onPrimary: () => void;
    secondaryDisabled?: boolean;
    primaryDisabled?: boolean;
}) {
    return (
        <div className="createSheetActions">
            <button type="button" className="btn" onClick={onSecondary} disabled={secondaryDisabled}>
                {secondaryLabel}
            </button>
            <button type="button" className="btn btn-primary" onClick={onPrimary} disabled={primaryDisabled}>
                {primaryLabel}
            </button>
        </div>
    );
}

export function AvailabilityCalendarSection({
    month,
    dateFrom,
    dateTo,
    windows,
    issue,
    onSelectDate,
    onShiftMonth,
    onRemoveWindow,
}: {
    month: Date;
    dateFrom: string;
    dateTo: string;
    windows: AvailabilityWindow[];
    issue: string;
    onSelectDate: (ymd: string) => void;
    onShiftMonth: (offset: number) => void;
    onRemoveWindow: (windowId: string) => void;
}) {
    const monthLabel = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const cells = useMemo(() => buildMonthCells(month), [month]);
    const todayKey = toLocalDateInput(new Date());

    return (
        <div className="wizardSection">
            <div className="wizardSectionHead">
                <div className="wizardSubTitle">Availability calendar</div>
                <Tooltip
                    label="Availability help"
                    text="Pick a start and end date, then set one listing schedule in the popup."
                />
            </div>

            <div className="slotCal wizardAvailabilityCal">
                <div className="wizardCalNav">
                    <button type="button" className="btn btn-ghost" onClick={() => onShiftMonth(-1)}>
                        Prev
                    </button>
                    <strong className="wizardCalMonth">{monthLabel}</strong>
                    <button type="button" className="btn btn-ghost" onClick={() => onShiftMonth(1)}>
                        Next
                    </button>
                </div>
                <div className="slotCalHead">
                    {WEEKDAY_SHORT.map((day) => (
                        <span key={day}>{day}</span>
                    ))}
                </div>
                <div className="slotCalGrid">
                    {cells.map((day, index) => {
                        if (!day) return <div key={`availability-blank-${index}`} className="slotCalBlank" />;
                        const key = toLocalDateInput(day);
                        const inPast = key < todayKey;
                        const selected = key === dateFrom || key === dateTo;
                        const inRange = !inPast && (isYmdInRange(key, dateFrom, dateTo) || windows.some((window) => isYmdInWindow(key, window)));

                        return (
                            <button
                                key={key}
                                type="button"
                                className={`slotCalDay ${inPast ? "slotCalDay--off" : "slotCalDay--available"} ${selected ? "slotCalDay--selected" : ""} ${inRange ? "slotCalDay--range" : ""}`}
                                onClick={() => onSelectDate(key)}
                                disabled={inPast}
                            >
                                <span className="slotCalNum">{day.getDate()}</span>
                                {day.getDate() === 1 && (
                                    <span className="slotCalMonth">
                                        {day.toLocaleDateString(undefined, { month: "short" })}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="createFieldHint">Pick a start date, then an end date to add a slot.</div>

            {windows.length > 0 && (
                <div className="stack">
                    {windows.map((window) => (
                        <div key={window.id} className="wizardInlineRow wizardInlineRow--intro">
                            <div className="wizardInlineValue">
                                {window.from} {" -> "} {window.to}
                                <div className="tiny muted">
                                    {window.start}-{window.end}
                                </div>
                            </div>
                            <button type="button" className="btn btn-ghost" onClick={() => onRemoveWindow(window.id)}>
                                Remove
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {issue && <div className="createInlineError">{issue}</div>}
        </div>
    );
}
