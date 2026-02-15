import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";

const remembered = localStorage.getItem("pb_remember") === "true";

export default function LoginPage() {
    const { login } = useAuth();
    const nav = useNavigate();
    const [searchParams] = useSearchParams();

    const [email, setEmail] = useState(() => (remembered ? localStorage.getItem("pb_email") ?? "" : ""));
    const [password, setPassword] = useState(() => (remembered ? localStorage.getItem("pb_password") ?? "" : ""));
    const [msg, setMsg] = useState<string | null>(null);
    const [showPass, setShowPass] = useState(false);
    const [remember, setRemember] = useState(remembered);
    const next = searchParams.get("next");
    const redirectTarget = next && next.startsWith("/") ? next : "/";

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setMsg(null);

        try {
            await login(email, password);
            if (remember) {
                localStorage.setItem("pb_remember", "true");
                localStorage.setItem("pb_email", email);
                localStorage.setItem("pb_password", password);
            } else {
                localStorage.removeItem("pb_remember");
                localStorage.removeItem("pb_email");
                localStorage.removeItem("pb_password");
            }
            nav(redirectTarget);
        } catch (err) {
            setMsg(err instanceof Error ? err.message : "Login failed");
        }
    }

    const statusTone = useMemo(() => (msg ? (msg.toLowerCase().includes("fail") ? "crimson" : "inherit") : "inherit"), [msg]);

    return (
        <div className="container authPage">
            <div className="pageHeader authPageHeader">
                <div className="heroKicker">WELCOME BACK</div>
                <div className="heroTitle">Log in to ParkingBuddies</div>
                <div className="heroSub muted">
                    Jump back into your bookings, listings, and rewards.
                </div>
            </div>

            <div className="authGrid authGrid--single">
                <div className="card authCard">
                    <div className="h2">Sign in</div>
                    <div className="muted tiny">Use the email you signed up with.</div>

                    {msg && <div className="card formSection" style={{ color: statusTone }}>{msg}</div>}

                    <form onSubmit={onSubmit} className="authForm">
                        <label>
                            <span>Email</span>
                            <input
                                className="input"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                type="email"
                                autoComplete="username"
                                placeholder="you@example.com"
                                required
                            />
                        </label>

                        <label>
                            <span>Password</span>
                            <div className="authInputRow">
                                <input
                                    className="input"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    type={showPass ? "text" : "password"}
                                    autoComplete="current-password"
                                    placeholder="Enter your password"
                                    required
                                />
                                <button type="button" className="btn" onClick={() => setShowPass((v) => !v)}>
                                    {showPass ? "Hide" : "Show"}
                                </button>
                            </div>
                        </label>

                        <div className="rowInline" style={{ justifyContent: "space-between" }}>
                            <label className="chip">
                                <input
                                    type="checkbox"
                                    checked={remember}
                                    onChange={(e) => setRemember(e.target.checked)}
                                />
                                Keep me signed in
                            </label>
                            <span className="tiny muted">Forgot password? Ask support.</span>
                        </div>

                        <button type="submit" className="btn btn-primary">
                            Log in
                        </button>
                    </form>

                    <div className="authDivider" />
                    <div className="tiny muted">
                        No account yet? <Link to="/signup">Create one</Link>
                    </div>
                    <div className="tiny muted" style={{ marginTop: 8 }}>
                        Need help? Please contact <a href="mailto:parkingbuddiesproject@gmail.com">parkingbuddiesproject@gmail.com</a>
                    </div>
                </div>
            </div>
        </div>
    );
}
