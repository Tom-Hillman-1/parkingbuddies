import { Link } from "react-router-dom";
import logoMark from "../assets/logo_logo_blue.png";

type AppPageStateProps = {
    card?: boolean;
    title?: string;
    copy?: string;
    actionLabel?: string | null;
    actionTo?: string;
};

export default function AppPageState({
    card = false,
    title,
    copy,
    actionLabel = "Back home",
    actionTo = "/",
}: AppPageStateProps) {
    const shellClassName = `appPageState${card ? " appPageState--card" : ""}`;

    return (
        <section
            className={shellClassName}
            role="alert"
            aria-live="polite"
            aria-label="Page unavailable"
        >
            <div className="appPageStateMark">
                <img src={logoMark} alt="" />
            </div>
            {title ? <div className="appPageStateTitle">{title}</div> : null}
            {copy ? <div className="appPageStateCopy">{copy}</div> : null}
            {actionLabel ? (
                <div className="appPageStateActions">
                    <Link to={actionTo} className="btn btn-primary">{actionLabel}</Link>
                </div>
            ) : null}
        </section>
    );
}
