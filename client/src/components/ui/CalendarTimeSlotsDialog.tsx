import { AppDialog } from "./AppDialog";

export function CalendarTimeSlotsDialog({
    open,
    dayLabel,
    labels,
    onClose,
}: {
    open: boolean;
    dayLabel: string;
    labels: string[];
    onClose: () => void;
}) {
    return (
        <AppDialog
            open={open}
            onClose={onClose}
            title="Time slots"
            subtitle={dayLabel}
            width="compact"
            className="calendarSlotsDialog"
        >
            <div className="calendarSlotsDialogList" role="list" aria-label={`Time slots for ${dayLabel}`}>
                {labels.map((label) => (
                    <div key={label} className="calendarSlotsDialogItem" role="listitem">
                        {label}
                    </div>
                ))}
            </div>
        </AppDialog>
    );
}
