import { useId, useMemo, useState } from "react";
import { Timepicker } from "timepicker-ui-react";
import type { TimepickerOptions, UpdateEventData } from "timepicker-ui";
import { AppDialog } from "./AppDialog";
import { AppButton } from "./AppForm";

const TIME_VALUE_PATTERN = /^\d{2}:\d{2}$/;

type TimePickerDialogProps = {
    open: boolean;
    initialValue: string;
    onCommit: (value: string) => void;
    onClose: () => void;
    title?: string;
    subtitle?: string;
    width?: "default" | "wide" | "compact";
    className?: string;
    summaryLabel?: string;
    applyLabel?: string;
    incrementMinutes?: number;
};

type AppTimePickerProps = {
    value: string;
    onChange: (value: string) => void;
    className?: string;
    dialogClassName?: string;
    disabled?: boolean;
    id?: string;
    name?: string;
    placeholder?: string;
};

function toTwentyFourHourValue(data?: Pick<UpdateEventData, "hour" | "minutes"> | null) {
    const hour = String(data?.hour ?? "").trim().padStart(2, "0");
    const minutes = String(data?.minutes ?? "").trim().padStart(2, "0");
    const value = `${hour}:${minutes}`;
    return TIME_VALUE_PATTERN.test(value) ? value : "";
}

export function AppTimePickerDialog({
    open,
    initialValue,
    onCommit,
    onClose,
    title = "Choose time",
    subtitle = "Pick the time for this field.",
    width = "compact",
    className = "",
    summaryLabel = "Selected time",
    applyLabel = "Apply time",
    incrementMinutes = 5,
}: TimePickerDialogProps) {
    const [draftValue, setDraftValue] = useState(initialValue);
    const containerId = useId().replace(/:/g, "");

    const pickerOptions = useMemo<TimepickerOptions>(
        () => ({
            clock: {
                type: "24h",
                autoSwitchToMinutes: true,
                incrementMinutes,
            },
            ui: {
                theme: "m2",
                inline: {
                    enabled: true,
                    containerId,
                    showButtons: false,
                    autoUpdate: true,
                },
            },
            labels: {
                ok: applyLabel,
                cancel: "Cancel",
                time: "Time",
                mobileTime: "Time",
                mobileHour: "Hour",
                mobileMinute: "Minute",
            },
        }),
        [applyLabel, containerId, incrementMinutes]
    );

    return (
        <AppDialog
            open={open}
            onClose={onClose}
            title={title}
            subtitle={subtitle}
            width={width}
            className={`appTimePickerDialog ${className}`.trim()}
        >
            <div>
                <div className="appTimePickerInline">
                    <div id={containerId} className="appTimePickerInlineMount" />
                    <Timepicker
                        className="appTimePickerHiddenInput"
                        defaultValue={draftValue}
                        readOnly
                        options={pickerOptions}
                        onUpdate={(data) => {
                            const next = toTwentyFourHourValue(data);
                            if (next) setDraftValue(next);
                        }}
                    />
                </div>
            </div>

            <div className="rowInline appTimePickerDialogFooter">
                <div className="appTimePickerSummary">
                    <span className="appTimePickerSummaryLabel">{summaryLabel}</span>
                    <strong>{TIME_VALUE_PATTERN.test(draftValue) ? draftValue : "Time"}</strong>
                </div>
                <div className="rowInline">
                    <AppButton type="button" onPress={onClose}>
                        Cancel
                    </AppButton>
                    <AppButton
                        type="button"
                        variant="primary"
                        onPress={() => {
                            if (TIME_VALUE_PATTERN.test(draftValue)) onCommit(draftValue);
                            onClose();
                        }}
                        disabled={!TIME_VALUE_PATTERN.test(draftValue)}
                    >
                        {applyLabel}
                    </AppButton>
                </div>
            </div>
        </AppDialog>
    );
}

export function AppTimePicker({
    value,
    onChange,
    className = "",
    dialogClassName = "",
    disabled,
    id,
    name,
    placeholder = "Time",
}: AppTimePickerProps) {
    const [open, setOpen] = useState(false);
    const [dialogVersion, setDialogVersion] = useState(0);

    const displayValue = value || placeholder;
    const hasValue = TIME_VALUE_PATTERN.test(value);

    return (
        <>
            <button
                type="button"
                id={id}
                name={name}
                className={`input appInput appTimePickerTrigger ${className} ${hasValue ? "" : "appTimePickerTrigger--placeholder"}`.trim()}
                onClick={() => {
                    setDialogVersion((current) => current + 1);
                    setOpen(true);
                }}
                disabled={disabled}
                aria-expanded={open}
                aria-haspopup="dialog"
            >
                <span>{displayValue}</span>
            </button>

            {open ? (
                <AppTimePickerDialog
                    key={dialogVersion}
                    open={open}
                    initialValue={value}
                    onCommit={onChange}
                    onClose={() => setOpen(false)}
                    title="Choose time"
                    subtitle="Pick the time for this field."
                    className={dialogClassName}
                />
            ) : null}
        </>
    );
}
