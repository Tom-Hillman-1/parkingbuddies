import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DayButton as DayPickerDayButton, type DayButtonProps } from "react-day-picker";
import { AppCalendar } from "../components/ui/AppCalendar";
import { AppDialog } from "../components/ui/AppDialog";
import { AppButton } from "../components/ui/AppForm";
import { InfoTooltip } from "../components/ui/InfoTooltip";
import {
    formatDateDisplay,
    formatCalendarWindowLabelForDay,
    isTimeHHMM as isTime,
    mergeCalendarDayLabels,
    parseYmd,
    timeToMinutes as minutes,
    toLocalDateInput,
} from "./pagesShared";
import { derivedPointsCostFromMoney, MIN_POINTS_COST, type PriceUnit } from "../../../shared/domain/pricing";

export { MIN_POINTS_COST };
export type { PriceUnit };

export type Mode = "free" | "rent" | "auction";
export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;
export type FlowStep = Exclude<WizardStep, 1>;
export type SpaceChoice = "1" | "2" | "3" | "4plus";
export type Tone = "blue" | "lilac" | "mint" | "cream" | "sky";
export type WizardSheetName = "spaces" | "custom" | "confirm" | "delete";
export type ListingFeature =
    | "protected_lot"
    | "private_outdoor"
    | "private_indoor"
    | "gated_access"
    | "locked_area"
    | "ev_friendly"
    | "cctv"
    | "covered"
    | "well_lit"
    | "wide_bay"
    | "accessible"
    | "residential"
    | "near_station"
    | "near_airport";

export type GeocodeSuggestion = { display_name: string; lat: string; lon: string; kind?: "manual" };
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
    features: ListingFeature[];
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
export const DEFAULT_CENTER: [number, number] = [51.5074, -0.1278];
export const LONDON_VIEWBOX = "-0.5103,51.6919,0.3340,51.2868";
export const MIN_AUCTION_START_PRICE_GBP = 0.1;
export const DEFAULT_AUCTION_START_PRICE = String(MIN_AUCTION_START_PRICE_GBP);
export const DEFAULT_POINTS_COST = String(MIN_POINTS_COST);
export const DEFAULT_AVAILABILITY_START = "00:00";
export const DEFAULT_AVAILABILITY_END = "23:59";
export const DEFAULT_SLOT_START = "09:00";
export const DEFAULT_SLOT_END = "17:00";

export const SPACE_CHOICES: Array<{ id: SpaceChoice; label: string; value: number }> = [
    { id: "1", label: "1 space", value: 1 },
    { id: "2", label: "2 spaces", value: 2 },
    { id: "3", label: "3 spaces", value: 3 },
    { id: "4plus", label: "4+ spaces", value: 4 },
];

export const LISTING_MODEL_OPTIONS: Array<{ mode: Mode; title: string; copy: string; tone: Tone; help: string }> = [
    { mode: "rent", title: "Rent", copy: "Fixed pricing for instant bookings.", tone: "blue", help: "Drivers can book instantly at the rate you set." },
    { mode: "auction", title: "Auction", copy: "Drivers submit offers. You get to approve.", tone: "lilac", help: "Drivers send offers and you decide which bid to accept." },
    { mode: "free", title: "Free", copy: "No payment required for this listing.", tone: "mint", help: "Bookings are free to drivers and no payment is collected." },
];

export const CREATE_FLOW_COPY: Record<FlowStep, { panelTitle: string; panelCopy: string; panelTone: Tone; title: string; subtitle: string }> = {
    2: { panelTitle: "Basics", panelCopy: "Set the core details so drivers quickly understand your space.", panelTone: "blue", title: "Listing information", subtitle: "Keep this short, clear, and practical." },
    3: { panelTitle: "Pricing", panelCopy: "Choose how each booking is charged, then decide whether drivers can pay in money, points, or both.", panelTone: "mint", title: "Pricing", subtitle: "Pick a charging method that matches how long drivers usually stay." },
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

export const LISTING_FEATURE_OPTIONS: Array<{
    id: ListingFeature;
    label: string;
    tone: "cool" | "green" | "warm" | "rose";
}> = [
    { id: "protected_lot", label: "Protected lot", tone: "cool" },
    { id: "private_outdoor", label: "Private outdoor", tone: "green" },
    { id: "private_indoor", label: "Private indoor", tone: "cool" },
    { id: "gated_access", label: "Gate protected", tone: "warm" },
    { id: "locked_area", label: "Locked area", tone: "rose" },
    { id: "ev_friendly", label: "EV friendly", tone: "green" },
    { id: "cctv", label: "CCTV", tone: "cool" },
    { id: "covered", label: "Covered", tone: "warm" },
    { id: "well_lit", label: "Well lit", tone: "warm" },
    { id: "wide_bay", label: "Wide bay", tone: "cool" },
    { id: "accessible", label: "Accessible", tone: "green" },
    { id: "residential", label: "Residential", tone: "rose" },
    { id: "near_station", label: "Near station", tone: "cool" },
    { id: "near_airport", label: "Near airport", tone: "warm" },
];

const LISTING_FEATURE_LOOKUP = new Map(LISTING_FEATURE_OPTIONS.map((feature) => [feature.id, feature]));

export function isListingFeature(value: unknown): value is ListingFeature {
    return typeof value === "string" && LISTING_FEATURE_LOOKUP.has(value as ListingFeature);
}

export function listingFeatureLabel(feature: string) {
    return LISTING_FEATURE_LOOKUP.get(feature as ListingFeature)?.label ?? feature;
}

export function listingFeatureTone(feature: string) {
    return LISTING_FEATURE_LOOKUP.get(feature as ListingFeature)?.tone ?? "cool";
}

export function derivePointsCostFromGbp(value: unknown) {
    return derivedPointsCostFromMoney(value);
}

export function parseCoordinates(lat: string, lng: string) {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
    if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) return null;
    return { lat: latNum, lng: lngNum };
}

export function formatYmdLabel(ymd: string) {
    const parsed = parseYmd(ymd);
    if (!parsed) return ymd;
    return formatDateDisplay(parsed);
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

export function toAvailabilityPayload(windows: AvailabilityWindowInput[], features: ListingFeature[] = []) {
    return {
        type: "window_slots",
        windows: windows.map((window) => ({
            mode: "continuous",
            date_from: window.from,
            date_to: window.to,
            start: window.start,
            end: window.end,
        })),
        ...(features.length ? { features } : {}),
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
    return <InfoTooltip label={label} text={text} />;
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
    return (
        <AppDialog
            open={open}
            onClose={onClose}
            title={title}
            subtitle={subtitle}
            width={wide ? "wide" : "default"}
            className="createSheet"
        >
            {children}
        </AppDialog>
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
            <AppButton type="button" onPress={onSecondary} disabled={secondaryDisabled}>
                {secondaryLabel}
            </AppButton>
            <AppButton type="button" variant="primary" onPress={onPrimary} disabled={primaryDisabled}>
                {primaryLabel}
            </AppButton>
        </div>
    );
}

export function AvailabilityCalendarSection({
    dateFrom,
    dateTo,
    windows,
    issue,
    onSelectDate,
    onResetSelection,
    onRemoveWindow,
}: {
    dateFrom: string;
    dateTo: string;
    windows: AvailabilityWindow[];
    issue: string;
    onSelectDate: (ymd: string) => void;
    onResetSelection: () => void;
    onRemoveWindow: (windowId: string) => void;
}) {
    const anchorYmd = dateFrom || windows.at(-1)?.from || toLocalDateInput(new Date());
    const [visibleMonth, setVisibleMonth] = useState(() => calendarMonthFromYmd(anchorYmd));
    const today = useMemo(() => {
        const value = new Date();
        value.setHours(0, 0, 0, 0);
        return value;
    }, []);
    const selectedSingleDate = dateFrom && (!dateTo || dateFrom === dateTo) ? dateFrom : "";
    const dayLabels = useMemo(() => buildAvailabilityDayLabels(windows), [windows]);

    useEffect(() => {
        setVisibleMonth(calendarMonthFromYmd(anchorYmd));
    }, [anchorYmd]);

    return (
        <div className="wizardSection">
            <div className="wizardSectionHead">
                <div className="wizardSubTitle">Availability calendar</div>
                <Tooltip
                    label="Availability help"
                    text="Pick a start and end date, then set one listing schedule in the popup."
                />
            </div>

            <div className="wizardAvailabilityCal">
                <AppCalendar
                    month={visibleMonth}
                    onMonthChange={setVisibleMonth}
                    disabled={{ before: today }}
                    onDayClick={(day, modifiers) => {
                        if (modifiers.disabled) return;
                        onSelectDate(toLocalDateInput(day));
                    }}
                    modifiers={{
                        draftSingle: (day) => hasDraftAvailabilityDayState(dateFrom, dateTo, day, "single"),
                        draftStart: (day) => hasDraftAvailabilityDayState(dateFrom, dateTo, day, "start"),
                        draftMiddle: (day) => hasDraftAvailabilityDayState(dateFrom, dateTo, day, "middle"),
                        draftEnd: (day) => hasDraftAvailabilityDayState(dateFrom, dateTo, day, "end"),
                        savedSingle: (day) => hasAvailabilityDayState(windows, day, "single"),
                        savedStart: (day) => hasAvailabilityDayState(windows, day, "start"),
                        savedMiddle: (day) => hasAvailabilityDayState(windows, day, "middle"),
                        savedEnd: (day) => hasAvailabilityDayState(windows, day, "end"),
                        selectedSingle: (day) => !!selectedSingleDate && toLocalDateInput(day) === selectedSingleDate,
                    }}
                    modifiersClassNames={{
                        draftSingle: "appCalendarDay--draftSingle",
                        draftStart: "appCalendarDay--draftStart",
                        draftMiddle: "appCalendarDay--draftMiddle",
                        draftEnd: "appCalendarDay--draftEnd",
                        savedSingle: "appCalendarDay--savedSingle",
                        savedStart: "appCalendarDay--savedStart",
                        savedMiddle: "appCalendarDay--savedMiddle",
                        savedEnd: "appCalendarDay--savedEnd",
                        selectedSingle: "appCalendarDay--selectedSingle",
                    }}
                    components={{
                        DayButton: (props) => <AvailabilityDayButton {...props} dayLabels={dayLabels} />,
                    }}
                    className="appCalendar--availability appCalendar--slots"
                />
            </div>

            <div className="createFieldHint">Pick a start date, then an end date to add a slot.</div>

            {(dateFrom || dateTo) && (
                <div className="wizardAvailabilityActions">
                    <button type="button" className="btn btn-ghost" onClick={onResetSelection}>
                        Reset selection
                    </button>
                </div>
            )}

            {windows.length > 0 && (
                <div className="stack">
                    {windows.map((window) => (
                        <div key={window.id} className="wizardInlineRow wizardInlineRow--intro wizardAvailabilityRow">
                            <div className="wizardInlineValue wizardAvailabilityRowMain">
                                <div className="wizardAvailabilityRowDates">
                                    {formatYmdLabel(window.from)} {" -> "} {formatYmdLabel(window.to)}
                                </div>
                                <div className="tiny muted wizardAvailabilityRowTimes">
                                    {window.start}-{window.end}
                                </div>
                            </div>
                            <button
                                type="button"
                                className="btn btn-ghost wizardAvailabilityRemoveBtn"
                                onClick={() => onRemoveWindow(window.id)}
                            >
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

function calendarMonthFromYmd(ymd: string) {
    const parsed = parseYmd(ymd) ?? new Date();
    return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
}

type AvailabilityDayState = "single" | "start" | "middle" | "end";

function getDraftAvailabilityDayState(dateFrom: string, dateTo: string, dayKey: string): AvailabilityDayState | null {
    if (!dateFrom) return null;
    const rangeEnd = dateTo || dateFrom;
    if (dayKey < dateFrom || dayKey > rangeEnd) return null;
    if (dateFrom === rangeEnd) return "single";
    if (dayKey === dateFrom) return "start";
    if (dayKey === rangeEnd) return "end";
    return "middle";
}

function hasDraftAvailabilityDayState(dateFrom: string, dateTo: string, day: Date, state: AvailabilityDayState) {
    return getDraftAvailabilityDayState(dateFrom, dateTo, toLocalDateInput(day)) === state;
}

function getAvailabilityDayState(window: AvailabilityWindow, dayKey: string): AvailabilityDayState | null {
    if (dayKey < window.from || dayKey > window.to) return null;
    if (window.from === window.to) return "single";
    if (dayKey === window.from) return "start";
    if (dayKey === window.to) return "end";
    return "middle";
}

function hasAvailabilityDayState(windows: AvailabilityWindow[], day: Date, state: AvailabilityDayState) {
    const key = toLocalDateInput(day);
    return windows.some((window) => getAvailabilityDayState(window, key) === state);
}

function AvailabilityDayButton({
    day,
    modifiers,
    dayLabels,
    className,
    ...buttonProps
}: DayButtonProps & { dayLabels: Map<string, string> }) {
    const slotLabel = dayLabels.get(day.isoDate) ?? "";

    return (
        <DayPickerDayButton day={day} modifiers={modifiers} className={className} data-slot-time={slotLabel} {...buttonProps}>
            {day.date.getDate()}
        </DayPickerDayButton>
    );
}

function buildAvailabilityDayLabels(windows: AvailabilityWindow[]) {
    const labels = new Map<string, string>();

    for (const window of windows) {
        for (let dayKey = window.from; dayKey <= window.to; ) {
            const nextLabel = formatCalendarWindowLabelForDay(dayKey, window.from, window.to, window.start, window.end);
            if (nextLabel) {
                labels.set(dayKey, mergeCalendarDayLabels(labels.get(dayKey), nextLabel));
            }
            const nextDay = parseYmd(dayKey);
            if (!nextDay) break;
            nextDay.setDate(nextDay.getDate() + 1);
            dayKey = toLocalDateInput(nextDay);
        }
    }

    return labels;
}

