import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import { DayPicker, type DayPickerProps } from "react-day-picker";

type AppCalendarProps = DayPickerProps & {
    className?: string;
};

export function AppCalendar({
    className = "",
    components,
    fixedWeeks = false,
    navLayout = "around",
    showOutsideDays = false,
    ...props
}: AppCalendarProps) {
    return (
        <DayPicker
            timeZone="UTC"
            fixedWeeks={fixedWeeks}
            navLayout={navLayout}
            showOutsideDays={showOutsideDays}
            className={`appCalendar ${className}`.trim()}
            components={{
                Chevron: ({ orientation, ...iconProps }) =>
                    orientation === "left" ? (
                        <ChevronLeftIcon {...iconProps} className="appCalendarChevron" />
                    ) : (
                        <ChevronRightIcon {...iconProps} className="appCalendarChevron" />
                    ),
                ...components,
            }}
            {...props}
        />
    );
}
