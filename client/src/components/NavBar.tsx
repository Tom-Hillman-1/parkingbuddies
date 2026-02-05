import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function NavBar() {
    const { user, token, isLoading, logout } = useAuth();
    const navigate = useNavigate();

    return (
        <div className="nav">
            <div className="nav-inner">
                <Link to="/" className="nav-left">
                    <span className="brand">ParkingBuddies</span>
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
