import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Tooltip, TooltipTrigger } from "react-aria-components";

type InfoTooltipProps = {
    label: string;
    text: ReactNode;
    align?: "start" | "center" | "end";
    side?: "top" | "right" | "bottom" | "left";
    triggerClassName?: string;
    contentClassName?: string;
};

const ALIGN_OFFSET: Record<NonNullable<InfoTooltipProps["align"]>, number> = {
    start: -18,
    center: 0,
    end: 18,
};

export function InfoTooltip({
    label,
    text,
    align = "center",
    side = "bottom",
    triggerClassName = "",
    contentClassName = "",
}: InfoTooltipProps) {
    const [isTouchMode, setIsTouchMode] = useState(false);
    const [isTouchOpen, setIsTouchOpen] = useState(false);
    const rootRef = useRef<HTMLSpanElement | null>(null);

    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;

        const mediaQuery = window.matchMedia("(hover: none), (pointer: coarse)");
        const update = () => setIsTouchMode(mediaQuery.matches);
        update();

        if (typeof mediaQuery.addEventListener === "function") {
            mediaQuery.addEventListener("change", update);
            return () => mediaQuery.removeEventListener("change", update);
        }

        mediaQuery.addListener(update);
        return () => mediaQuery.removeListener(update);
    }, []);

    useEffect(() => {
        if (!isTouchMode) {
            setIsTouchOpen(false);
        }
    }, [isTouchMode]);

    useEffect(() => {
        if (!isTouchMode || !isTouchOpen) return undefined;

        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setIsTouchOpen(false);
            }
        };

        document.addEventListener("pointerdown", handlePointerDown);
        return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, [isTouchMode, isTouchOpen]);

    return (
        <span ref={rootRef} className="uiTooltipRoot">
            <TooltipTrigger
                delay={isTouchMode ? 0 : 120}
                closeDelay={isTouchMode ? 0 : 60}
                isOpen={isTouchMode ? isTouchOpen : undefined}
                onOpenChange={isTouchMode ? setIsTouchOpen : undefined}
                shouldCloseOnPress={!isTouchMode}
            >
                <Button
                    type="button"
                    className={`uiTooltipTrigger ${triggerClassName}`.trim()}
                    aria-label={label}
                    onPress={() => {
                        if (isTouchMode) setIsTouchOpen((open) => !open);
                    }}
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onTouchStart={(event) => event.stopPropagation()}
                >
                    <span className="uiTooltipMark" aria-hidden="true">?</span>
                </Button>
                <Tooltip
                    placement={side}
                    offset={8}
                    crossOffset={ALIGN_OFFSET[align]}
                    className={`uiTooltipContent ${contentClassName}`.trim()}
                >
                    {text}
                </Tooltip>
            </TooltipTrigger>
        </span>
    );
}
