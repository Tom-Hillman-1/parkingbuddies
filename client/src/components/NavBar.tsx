import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import logoMark from "../assets/logo_logo_blue.png";

const navLinkClass = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? " active" : ""}`;

export default function NavBar() {
    const { user, token, isLoading, logout } = useAuth();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const isSignedIn = Boolean(user || token);

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
                    <NavLink to="/" className={navLinkClass} onClick={() => setOpen(false)}>Home</NavLink>
                    <NavLink to="/about" className={navLinkClass} onClick={() => setOpen(false)}>About</NavLink>

                    {isLoading ? (
                        <span className="badge">Loading...</span>
                    ) : isSignedIn ? (
                        <>
                            <NavLink to="/dashboard" className={navLinkClass} onClick={() => setOpen(false)}>Dashboard</NavLink>
                            <NavLink to="/create-listing" className={navLinkClass} onClick={() => setOpen(false)}>Create listing</NavLink>
                            <NavLink to="/settings" className={navLinkClass} onClick={() => setOpen(false)}>Settings</NavLink>

                            <Link to="/dashboard?tab=rewards" className="nav-user" title="Open rewards" onClick={() => setOpen(false)}>
                                <span className="nav-user-name">{user?.name ?? "Account"}</span>
                                <span className="nav-user-points">{user?.points_balance ?? 0} pts</span>
                            </Link>

                            <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => {
                                    setOpen(false);
                                    logout();
                                    navigate("/", { replace: true });
                                }}
                            >
                                Log out
                            </button>
                        </>
                    ) : (
                        <>
                            <NavLink to="/login" className={navLinkClass} onClick={() => setOpen(false)}>Log in</NavLink>
                            <NavLink to="/signup" className={navLinkClass} onClick={() => setOpen(false)}>Sign up</NavLink>
                        </>
                    )}
                </nav>
            </div>
        </header>
    );
}
