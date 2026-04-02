import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { EMPTY_NOTIFICATION_SUMMARY, useNotificationSummary, useSeenNotificationSummary } from "../lib/notifications";
import logoMark from "../assets/logo_logo_blue.png";

const linkClassName = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? " active" : ""}`;

export default function NavBar() {
    const { user, token, isLoading, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [open, setOpen] = useState(false);
    const shellRef = useRef<HTMLDivElement | null>(null);
    const isSignedIn = Boolean(user || token);
    const notificationQuery = useNotificationSummary(token);
    const notificationSummary = useSeenNotificationSummary(notificationQuery.data ?? EMPTY_NOTIFICATION_SUMMARY);
    const accountName = user?.name ?? "Account";
    const closeMenu = () => setOpen(false);
    const handleLogout = () => {
        closeMenu();
        logout();
        navigate("/", { replace: true });
    };

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

                {notificationSummary.total > 0 && isSignedIn && (
                    <span className="nav-shell-alertBadge">+{notificationSummary.total}</span>
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
                            <NavLink to="/dashboard" className={linkClassName} onClick={closeMenu}>Dashboard</NavLink>
                            <NavLink to="/about" className={linkClassName} onClick={closeMenu}>About</NavLink>
                            <NavLink to="/settings" className={linkClassName} onClick={closeMenu}>Settings</NavLink>

                            <Link to="/dashboard" className="nav-user" title={accountName} onClick={closeMenu}>
                                <span className="nav-user-main">
                                    <span className="nav-user-name">{accountName}</span>
                                </span>
                                <span className="nav-user-points">{user?.points_balance ?? 0} pts</span>
                            </Link>

                            <button type="button" className="btn btn-ghost" onClick={handleLogout}>
                                Log out
                            </button>
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

