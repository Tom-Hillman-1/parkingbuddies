import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { EMPTY_NOTIFICATION_SUMMARY, useNotificationSummary } from "../lib/notifications";
import logoMark from "../assets/logo_logo_blue.png";

const linkClassName = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? " active" : ""}`;

export default function NavBar() {
    const { user, token, isLoading, logout } = useAuth();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const isSignedIn = Boolean(user || token);
    const notificationQuery = useNotificationSummary(token);
    const notificationSummary = notificationQuery.data ?? EMPTY_NOTIFICATION_SUMMARY;
    const accountName = user?.name ?? "Account";
    const closeMenu = () => setOpen(false);
    const handleLogout = () => {
        closeMenu();
        logout();
        navigate("/", { replace: true });
    };

    return (
        <header className="nav">
            <div className="nav-shell container">
                <Link to="/" className="brand" aria-label="ParkingBuddies home">
                    <img className="brand-logo" src={logoMark} alt="" />
                    <span className="brand-text">ParkingBuddies</span>
                </Link>

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
                    <NavLink to="/about" className={linkClassName} onClick={closeMenu}>About</NavLink>

                    {isLoading ? (
                        <span className="badge">Loading...</span>
                    ) : isSignedIn ? (
                        <>
                            <NavLink to="/dashboard" className={linkClassName} onClick={closeMenu}>Dashboard</NavLink>
                            <NavLink to="/create-listing" className={linkClassName} onClick={closeMenu}>Create listing</NavLink>
                            <NavLink to="/settings" className={linkClassName} onClick={closeMenu}>Settings</NavLink>

                            <Link to="/dashboard" className="nav-user" title="Open dashboard" onClick={closeMenu}>
                                <span className="nav-user-main">
                                    <span className="nav-user-name">{accountName}</span>
                                </span>
                                <span className="nav-user-points">{user?.points_balance ?? 0} pts</span>
                                {notificationSummary.total > 0 && (
                                    <span className="nav-user-alertBadge">+{notificationSummary.total}</span>
                                )}
                            </Link>

                            <button type="button" className="btn btn-ghost" onClick={handleLogout}>
                                Log out
                            </button>
                        </>
                    ) : (
                        <>
                            <NavLink to="/login" className={linkClassName} onClick={closeMenu}>Log in</NavLink>
                            <NavLink to="/signup" className={linkClassName} onClick={closeMenu}>Sign up</NavLink>
                        </>
                    )}
                </nav>
            </div>
        </header>
    );
}
