import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function SignupPage() {
    const { signup } = useAuth();
    const nav = useNavigate();

    const [email, setEmail] = useState("");
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPass, setShowPass] = useState(false);
    const [agree, setAgree] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setMsg(null);

        const trimmedName = name.trim();
        if (trimmedName.length < 3 || !/[A-Za-z]/.test(trimmedName)) {
            setMsg("Name must be at least 3 characters and include letters.");
            return;
        }

        // Minimal password requirements (PDD #9 style check)
        if (password.length < 8) {
            setMsg("Password must be at least 8 characters.");
            return;
        }
        if (password !== confirm) {
            setMsg("Passwords do not match.");
            return;
        }
        if (!agree) {
            setMsg("Please accept the terms to continue.");
            return;
        }

        try {
            await signup(email, name, password);
            nav("/");
        } catch (err) {
            setMsg(err instanceof Error ? err.message : "Signup failed");
        }
    }

    const strength = useMemo(() => {
        let score = 0;
        if (password.length >= 8) score += 1;
        if (/[A-Z]/.test(password)) score += 1;
        if (/[0-9]/.test(password)) score += 1;
        if (/[^A-Za-z0-9]/.test(password)) score += 1;
        return score;
    }, [password]);

    const strengthLabel = ["Weak", "Okay", "Good", "Strong", "Great"][strength] ?? "Weak";
    const strengthWidth = `${Math.min(100, (strength / 4) * 100)}%`;
    const strengthColor =
        strength <= 1 ? "rgba(243,107,127,0.9)" : strength === 2 ? "rgba(255,200,87,0.9)" : "rgba(59,186,156,0.9)";

    return (
        <div className="container authPage">
            <div className="pageHeader">
                <div className="heroKicker">GET STARTED</div>
                <div className="heroTitle">Create your ParkingBuddies account</div>
                <div className="heroSub muted">
                    Set up your profile, list spaces, and start booking in minutes.
                </div>
            </div>

            <div className="authGrid authGrid--single">
                <div className="card authCard">
                    <div className="h2">Sign up</div>
                    <div className="muted tiny">We’ll use this info to personalize your dashboard.</div>

                    {msg && <div className="card formSection" style={{ color: "crimson" }}>{msg}</div>}

                    <form onSubmit={onSubmit} className="authForm">
                        <label>
                            <span>Name</span>
                            <input
                                className="input"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                autoComplete="name"
                                placeholder="Jamie Parker"
                                required
                            />
                        </label>

                        <label>
                            <span>Email</span>
                            <input
                                className="input"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                type="email"
                                autoComplete="email"
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
                                    autoComplete="new-password"
                                    placeholder="Create a password"
                                    required
                                />
                                <button type="button" className="btn" onClick={() => setShowPass((v) => !v)}>
                                    {showPass ? "Hide" : "Show"}
                                </button>
                            </div>
                            <div className="authNote">Minimum 8 characters. Mix letters and numbers for best results.</div>
                            <div className="strengthBar" aria-hidden>
                                <div className="strengthFill" style={{ width: strengthWidth, background: strengthColor }} />
                            </div>
                            <div className="tiny muted">Strength: {strengthLabel}</div>
                        </label>

                        <label>
                            <span>Confirm password</span>
                            <input
                                className="input"
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                type={showPass ? "text" : "password"}
                                autoComplete="new-password"
                                placeholder="Repeat password"
                                required
                            />
                        </label>

                        <label className="chip">
                            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                            I agree to the ParkingBuddies terms
                        </label>

                        <button type="submit" className="btn btn-primary">
                            Create account
                        </button>
                    </form>

                    <div className="authDivider" />
                    <div className="tiny muted">
                        Already have an account? <Link to="/login">Log in</Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
