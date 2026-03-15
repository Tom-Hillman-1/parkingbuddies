import { useMemo } from "react";
import { AppCalendar } from "../components/ui/AppCalendar";
import { AppDialog } from "../components/ui/AppDialog";
import { AppButton } from "../components/ui/AppForm";
import { AppTimePickerDialog } from "../components/ui/AppTimePicker";
import { formatDateDisplay, parseYmd, toLocalDateInput } from "./pagesShared";

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

    return (
        <AppDialog
            open={open}
            onClose={onClose}
            title="Choose date"
            subtitle="Pick a parking day, or leave it open to search all times."
            className="homeDateDialog"
            width="wide"
        >
            <div className="homeDateDialogBody">
                <div className="homeDatePickerShell">
                    <AppCalendar
                        mode="single"
                        selected={selected}
                        onSelect={(day) => onSelectDate(day ? toLocalDateInput(day) : "")}
                        disabled={{ before: today }}
                        month={selected ?? today}
                        fixedWeeks={false}
                        showOutsideDays={false}
                        className="appCalendar--home"
                    />
                </div>
            </div>

            <div className="rowInline homeDateDialogFooter">
                <div className="homeDateDialogSummary">
                    <span className="homeDateDialogLabel">Selected date</span>
                    <strong>{selectedDate ? formatDateDisplay(selectedDate) : "Any date"}</strong>
                </div>
                <div className="rowInline">
                    <AppButton type="button" variant="ghost" onClick={onClear}>
                        Reset date
                    </AppButton>
                    <AppButton type="button" variant="primary" onClick={onApply}>
                        Apply date
                    </AppButton>
                </div>
            </div>
        </AppDialog>
    );
}

export function HomeTimePickerDialog({
    open,
    value,
    onChange,
    onClose,
}: {
    open: boolean;
    value: string;
    onChange: (value: string) => void;
    onClose: () => void;
}) {
    if (!open) return null;

    return (
        <AppTimePickerDialog
            open={open}
            initialValue={value}
            onCommit={onChange}
            onClose={onClose}
            title="Choose time"
            subtitle="Pick the start time for the parking search."
            className="homeTimeDialog"
            width="compact"
            summaryLabel="Selected time"
            applyLabel="Apply time"
            incrementMinutes={5}
        />
    );
}
