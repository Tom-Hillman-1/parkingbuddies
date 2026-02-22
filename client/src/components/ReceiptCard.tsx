import type { ReactNode } from "react";

type ReceiptCardProps = {
    kicker: string;
    title: string;
    subtitle?: string;
    className?: string;
    actions?: ReactNode;
    children: ReactNode;
};

type ReceiptRowProps = {
    label: string;
    value: ReactNode;
};

export function ReceiptCard({
    kicker,
    title,
    subtitle,
    className,
    actions,
    children,
}: ReceiptCardProps) {
    return (
        <div className={`card receiptCard ${className ?? ""}`.trim()}>
            <div className="receiptHeader">
                <div className="heroKicker">{kicker}</div>
                <div className="h2">{title}</div>
                {subtitle ? <div className="tiny muted">{subtitle}</div> : null}
            </div>
            <div className="receiptBody">{children}</div>
            {actions ? <div className="receiptActions">{actions}</div> : null}
        </div>
    );
}

export function ReceiptRow({ label, value }: ReceiptRowProps) {
    return (
        <div className="receiptRow">
            <span className="tiny muted">{label}</span>
            <span className="spotInfoValue">{value}</span>
        </div>
    );
}

export function ReceiptDivider() {
    return <div style={{ borderTop: "1px dashed rgba(255,255,255,0.25)", margin: "6px 0" }} />;
}
