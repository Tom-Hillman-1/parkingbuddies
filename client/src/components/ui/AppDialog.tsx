import type { ReactNode } from "react";
import { Cross2Icon } from "@radix-ui/react-icons";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";

type AppDialogProps = {
    open: boolean;
    onClose: () => void;
    title: string;
    subtitle?: ReactNode;
    children: ReactNode;
    width?: "default" | "wide" | "compact";
    className?: string;
};

export function AppDialog({
    open,
    onClose,
    title,
    subtitle,
    children,
    width = "default",
    className = "",
}: AppDialogProps) {
    if (!open) return null;

    return (
        <ModalOverlay
            isOpen={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) onClose();
            }}
            className="appDialogOverlay"
        >
            <Modal isDismissable className={`appDialogModal appDialogModal--${width}`}>
                <Dialog aria-label={title} className={`card appDialogSurface ${className}`.trim()}>
                    <div className="appDialogHead">
                        <div className="appDialogMeta">
                            <div className="appDialogTitle">{title}</div>
                            {subtitle ? <div className="tiny muted">{subtitle}</div> : null}
                        </div>
                        <button type="button" className="appDialogCloseBtn" aria-label="Close dialog" onClick={onClose}>
                            <Cross2Icon />
                        </button>
                    </div>
                    {children}
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
