import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { apiGet } from "../lib/api";
import { useAuth } from "../lib/auth";
import logoMark from "../assets/logo_logo.png";

export default function NavBar() {
    const { user, token, isLoading, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const isHome = location.pathname === "/";
    const isCreateListing = location.pathname.startsWith("/create-listing");
    const isAuth = location.pathname === "/login" || location.pathname === "/signup";
    const [menuOpen, setMenuOpen] = useState(false);
    const [pendingOwnerActionCount, setPendingOwnerActionCount] = useState(0);
    const hasOwnerAction = pendingOwnerActionCount > 0;

    useEffect(() => {
        setMenuOpen(false);
    }, [location.pathname, location.search]);

    useEffect(() => {
        let active = true;

        async function refreshOwnerActionCount() {
            if (!token) {
                if (active) setPendingOwnerActionCount(0);
                return;
            }
            try {
                const r = await apiGet<{ bids: Array<{ status?: string }> }>("/auctions/owner/bids", token);
                const count = (r.bids ?? []).filter((b) => String(b.status ?? "").toLowerCase() === "pending").length;
                if (active) setPendingOwnerActionCount(count);
            } catch {
                if (active) setPendingOwnerActionCount(0);
            }
        }

        refreshOwnerActionCount();
        if (!token) {
            return () => {
                active = false;
            };
        }

        const pollId = window.setInterval(refreshOwnerActionCount, 30000);
        const onFocus = () => {
            refreshOwnerActionCount();
        };
        window.addEventListener("focus", onFocus);

        return () => {
            active = false;
            window.clearInterval(pollId);
            window.removeEventListener("focus", onFocus);
        };
    }, [token]);

    return (
        <div className="nav">
            <div
                className={`nav-inner${isHome ? " nav-inner--home" : ""}${isCreateListing ? " nav-inner--narrow" : ""}${isAuth ? " nav-inner--auth" : ""}`}
            >
                <div className="nav-head">
                    <Link to="/" className="nav-left">
                        <span className="brand">
                            <img className="brand-logo brand-logo--mark" src={logoMark} alt="ParkingBuddies logo" />
                            <span>ParkingBuddies</span>
                        </span>
                    </Link>
                    <button
                        type="button"
                        className={`nav-toggle${menuOpen ? " is-open" : ""}`}
                        aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpen((v) => !v)}
                    >
                        <span />
                        <span />
                        <span />
                    </button>
                </div>

                <div className={`nav-links${menuOpen ? " nav-links--open" : ""}`}>
                    <NavLink
                        to="/"
                        className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                        onClick={() => setMenuOpen(false)}
                    >
                        Home
                    </NavLink>

                    <NavLink
                        to="/about"
                        className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                        onClick={() => setMenuOpen(false)}
                    >
                        About
                    </NavLink>

                    {isLoading ? (
                        <span className="badge">Loading…</span>
                    ) : user || token ? (
                        <>
                            <NavLink
                                to="/dashboard"
                                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                                onClick={() => setMenuOpen(false)}
                            >
                                Dashboard
                            </NavLink>
                            <NavLink
                                to="/settings"
                                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                                onClick={() => setMenuOpen(false)}
                            >
                                Settings
                            </NavLink>
                            <NavLink
                                to="/create-listing"
                                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                                onClick={() => setMenuOpen(false)}
                            >
                                Create listing
                            </NavLink>

                            <Link
                                to="/dashboard?tab=rewards"
                                className="badge navPointsLink"
                                title={hasOwnerAction ? "You have owner bids that require action" : "Open rewards in dashboard"}
                                onClick={() => setMenuOpen(false)}
                            >
                                <span className="navPointsMain">
                                    <span className="navAccountName">{user?.name ?? "Account"}</span>
                                    <span className="navPointsSeparator" aria-hidden="true">•</span>
                                    <strong>{user?.points_balance ?? 0}</strong> pts
                                </span>
                                {hasOwnerAction && (
                                    <span className="navOwnerAlert" aria-label={`${pendingOwnerActionCount} owner bids need your approval`}>
                                        <span className="navOwnerAlertDot" aria-hidden="true" />
                                        <span className="navOwnerAlertCount">+{pendingOwnerActionCount}</span>
                                    </span>
                                )}
                            </Link>

                            <button
                                onClick={() => {
                                    setMenuOpen(false);
                                    logout();
                                    navigate("/", { replace: true });
                                }}
                                className="btn"
                            >
                                Log out
                            </button>
                        </>
                    ) : (
                        <>
                            <NavLink
                                to="/login"
                                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                                onClick={() => setMenuOpen(false)}
                            >
                                Login
                            </NavLink>

                            <NavLink
                                to="/signup"
                                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                                onClick={() => setMenuOpen(false)}
                            >
                                Sign up
                            </NavLink>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
