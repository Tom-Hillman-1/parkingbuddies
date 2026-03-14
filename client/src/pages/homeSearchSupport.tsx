import { useMemo } from "react";
import { AppCalendar } from "../components/ui/AppCalendar";
import { AppDialog } from "../components/ui/AppDialog";
import { AppButton } from "../components/ui/AppForm";
import { formatDateDisplay, parseYmd, toLocalDateInput } from "./pagesShared";

export function HomeDatePickerDialog({
    open,
    selectedDate,
    startTime,
    durationMinutes,
    durationOptions,
    onSelectDate,
    onStartTimeChange,
    onDurationChange,
    onApply,
    onClear,
    onClose,
}: {
    open: boolean;
    selectedDate: string;
    startTime: string;
    durationMinutes: number;
    durationOptions: Array<{ value: number; label: string }>;
    onSelectDate: (value: string) => void;
    onStartTimeChange: (value: string) => void;
    onDurationChange: (value: number) => void;
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

                <aside className="homeDateDialogSide">
                    <div className="homeDateDialogSummary">
                        <span className="homeDateDialogLabel">Selected date</span>
                        <strong>{selectedDate ? formatDateDisplay(selectedDate) : "Any date"}</strong>
                    </div>

                    <label className="homeDateField">
                        <span className="homeDateDialogLabel">Start time</span>
                        <input
                            className="homeFilterInput"
                            type="time"
                            step={900}
                            value={startTime}
                            onChange={(event) => onStartTimeChange(event.target.value)}
                            disabled={!selectedDate}
                        />
                    </label>

                    <label className="homeDateField">
                        <span className="homeDateDialogLabel">Duration</span>
                        <select
                            className="homeFilterInput"
                            value={durationMinutes}
                            onChange={(event) => onDurationChange(Number(event.target.value))}
                            disabled={!selectedDate}
                        >
                            {durationOptions.map((option) => (
                                <option key={`dialog-duration-${option.value}`} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                </aside>
            </div>

            <div className="rowInline" style={{ justifyContent: "space-between" }}>
                <AppButton type="button" variant="ghost" onClick={onClear}>
                    Clear date
                </AppButton>
                <div className="rowInline">
                    <AppButton type="button" onClick={onClose}>
                        Cancel
                    </AppButton>
                    <AppButton type="button" variant="primary" onClick={onApply}>
                        Apply date
                    </AppButton>
                </div>
            </div>
        </AppDialog>
    );
}
