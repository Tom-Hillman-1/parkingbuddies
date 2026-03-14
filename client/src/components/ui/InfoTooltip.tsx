import type { ReactNode } from "react";
import { Button, OverlayArrow, Tooltip, TooltipTrigger } from "react-aria-components";

type InfoTooltipProps = {
    label: string;
    text: ReactNode;
    align?: "start" | "center" | "end";
    side?: "top" | "right" | "bottom" | "left";
    triggerClassName?: string;
    contentClassName?: string;
    icon?: ReactNode;
};

const ALIGN_OFFSET: Record<NonNullable<InfoTooltipProps["align"]>, number> = {
    start: -22,
    center: 0,
    end: 22,
};

export function InfoTooltip({
    label,
    text,
    align = "center",
    side = "bottom",
    triggerClassName = "",
    contentClassName = "",
    icon,
}: InfoTooltipProps) {
    return (
        <TooltipTrigger delay={120} closeDelay={60}>
            <Button
                type="button"
                className={`uiTooltipTrigger ${triggerClassName}`.trim()}
                aria-label={label}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {icon ?? <span className="uiTooltipMark" aria-hidden="true">?</span>}
            </Button>
            <Tooltip
                placement={side}
                offset={8}
                crossOffset={ALIGN_OFFSET[align]}
                className={`uiTooltipContent ${contentClassName}`.trim()}
            >
                {text}
                <OverlayArrow className="uiTooltipArrow">
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                        <path d="M0 0 L5 5 L10 0" />
                    </svg>
                </OverlayArrow>
            </Tooltip>
        </TooltipTrigger>
    );
}
