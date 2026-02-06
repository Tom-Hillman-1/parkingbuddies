import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import logoMark from "../assets/logo_logo.png";

export default function NavBar() {
    const { user, token, isLoading, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const isHome = location.pathname === "/";
    const isCreateListing = location.pathname.startsWith("/create-listing");
    const isAuth = location.pathname === "/login" || location.pathname === "/signup";

    return (
        <div className="nav">
            <div
                className={`nav-inner${isHome ? " nav-inner--home" : ""}${isCreateListing ? " nav-inner--narrow" : ""}${isAuth ? " nav-inner--auth" : ""}`}
            >
                <Link to="/" className="nav-left">
                    <span className="brand">
                        <img className="brand-logo brand-logo--mark" src={logoMark} alt="ParkingBuddies logo" />
                        <span>ParkingBuddies</span>
                    </span>
                </Link>

                <div className="nav-links">
                    <NavLink
                        to="/"
                        className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                    >
                        Home
                    </NavLink>

                    <NavLink
                        to="/about"
                        className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
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
                            >
                                Dashboard
                            </NavLink>
                            <NavLink
                                to="/settings"
                                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                            >
                                Settings
                            </NavLink>
                            <NavLink
                                to="/create-listing"
                                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                            >
                                Create listing
                            </NavLink>

                            <span className="badge">
                {user?.name ?? "Account"} • <strong>{user?.points_balance ?? 0}</strong> pts
              </span>

                            <button
                                onClick={() => {
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
                            >
                                Login
                            </NavLink>

                            <NavLink
                                to="/signup"
                                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
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
