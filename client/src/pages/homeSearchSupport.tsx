import { useEffect, useMemo } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { parseYmd, toLocalDateInput } from "./pagesShared";

export function HomeDatePickerDialog({
    open,
    selectedDate,
    onSelectDate,
    onApply,
    onClear,
    onClose,
}: {
    open: boolean;
    selectedDate: string;
    onSelectDate: (value: string) => void;
    onApply: () => void;
    onClear: () => void;
    onClose: () => void;
}) {
    const selected = useMemo(() => parseYmd(selectedDate) ?? undefined, [selectedDate]);
    const today = useMemo(() => {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        return now;
    }, []);

    useEffect(() => {
        if (!open) return undefined;

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") onClose();
        }

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            className="homeDateDialogBackdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Choose search date"
            onClick={onClose}
        >
            <div className="card homeDateDialog" onClick={(event) => event.stopPropagation()}>
                <div className="homeDateDialogTop">
                    <div>
                        <div className="h3">Choose date</div>
                        <div className="tiny muted">Pick a parking day, or leave it open to search all times.</div>
                    </div>
                    <button type="button" className="btn btn-ghost" onClick={onClose}>
                        Close
                    </button>
                </div>

                <div className="homeDatePickerShell">
                    <DayPicker
                        mode="single"
                        selected={selected}
                        onSelect={(day) => onSelectDate(day ? toLocalDateInput(day) : "")}
                        disabled={{ before: today }}
                        defaultMonth={selected ?? today}
                        showOutsideDays
                        className="homeDayPicker"
                    />
                </div>

                <div className="homeDateDialogSummary">
                    <span className="homeDateDialogLabel">Selected date</span>
                    <strong>{selectedDate || "Any date"}</strong>
                </div>

                <div className="rowInline" style={{ justifyContent: "space-between" }}>
                    <button type="button" className="btn" onClick={onClear}>
                        Clear date
                    </button>
                    <div className="rowInline">
                        <button type="button" className="btn" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="button" className="btn btn-primary" onClick={onApply}>
                            Apply date
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
