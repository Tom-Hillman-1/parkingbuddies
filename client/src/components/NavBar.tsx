import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { EMPTY_NOTIFICATION_SUMMARY, useNotificationSummary, useSeenNotificationSummary } from "../lib/notifications";
import logoMark from "../assets/logo_logo_blue.png";

const linkClassName = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? " active" : ""}`;

export default function NavBar() {
    const { user, token, isLoading } = useAuth();
    const location = useLocation();
    const [open, setOpen] = useState(false);
    const shellRef = useRef<HTMLDivElement | null>(null);
    const isSignedIn = Boolean(user || token);
    const notificationQuery = useNotificationSummary(token);
    const notificationSummary = useSeenNotificationSummary(notificationQuery.data ?? EMPTY_NOTIFICATION_SUMMARY);
    const dashboardNotificationTotal = notificationSummary.total;
    const closeMenu = () => setOpen(false);

    useEffect(() => {
        closeMenu();
    }, [location.pathname, location.search]);

    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event: PointerEvent) => {
            const shell = shellRef.current;
            if (!shell) return;
            if (shell.contains(event.target as Node)) return;
            closeMenu();
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") closeMenu();
        };

        window.addEventListener("pointerdown", handlePointerDown);
        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("pointerdown", handlePointerDown);
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [open]);

    return (
        <header className="nav">
            <div ref={shellRef} className="nav-shell container">
                <Link to="/" className="brand" aria-label="ParkingBuddies home">
                    <img className="brand-logo" src={logoMark} alt="" />
                    <span className="brand-text">ParkingBuddies</span>
                </Link>

                {dashboardNotificationTotal > 0 && isSignedIn && (
                    <span className="appNotifyBadge appNotifyBadge--nav-shell">+{dashboardNotificationTotal}</span>
                )}

                <button
                    type="button"
                    className={`nav-toggle${open ? " is-open" : ""}`}
                    aria-expanded={open}
                    aria-controls="site-nav"
                    aria-label={open ? "Close menu" : "Open menu"}
                    onClick={() => setOpen((value) => !value)}
                >
                    <span />
                    <span />
                    <span />
                </button>

                <nav id="site-nav" className={`nav-links${open ? " nav-links--open" : ""}`} aria-label="Primary">
                    <NavLink to="/" className={linkClassName} onClick={closeMenu}>Home</NavLink>

                    {isLoading ? null : isSignedIn ? (
                        <>
                            <NavLink to="/create-listing" className={linkClassName} onClick={closeMenu}>Create listing</NavLink>
                            <NavLink
                                to="/dashboard"
                                className={({ isActive }) => `nav-link nav-link--notify nav-link--dashboard${isActive ? " active" : ""}`}
                                onClick={closeMenu}
                            >
                                <span className="nav-link-label">Dashboard</span>
                                <span className="nav-user-points">{user?.points_balance ?? 0} pts</span>
                                {dashboardNotificationTotal > 0 ? (
                                    <span className="appNotifyBadge appNotifyBadge--nav-link">+{dashboardNotificationTotal}</span>
                                ) : null}
                            </NavLink>
                            <NavLink to="/settings" className={linkClassName} onClick={closeMenu}>Settings</NavLink>
                            <NavLink to="/about" className={linkClassName} onClick={closeMenu}>About</NavLink>
                        </>
                    ) : (
                        <>
                            <NavLink to="/about" className={linkClassName} onClick={closeMenu}>About</NavLink>
                            <NavLink to="/login" className={linkClassName} onClick={closeMenu}>Log in</NavLink>
                            <NavLink to="/signup" className={linkClassName} onClick={closeMenu}>Sign up</NavLink>
                        </>
                    )}
                </nav>
            </div>
        </header>
    );
}
