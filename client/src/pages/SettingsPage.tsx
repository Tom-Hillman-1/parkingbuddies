import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { apiGet, apiPatch } from "../lib/api";
import { useAuth } from "../lib/auth";

type Me = {
    id: string;
    email: string;
    name: string;
    points_balance: number;
};

type SettingsPayload = {
    name?: string;
    email?: string;
    home_address?: string;
};

export default function SettingsPage() {
    const { token, user, logout } = useAuth();
    const navigate = useNavigate();

    const [me, setMe] = useState<Me | null>(null);
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [homeAddress, setHomeAddress] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        if (!token) return;

        (async () => {
            setLoading(true);
            setErr(null);
            setMsg(null);

            try {
                // 1) Load base user info
                const r1 = await apiGet<{ user: Me }>("/me", token);
                setMe(r1.user);

                // 2) Load settings (if your backend returns extra fields like home_address)
                // If your backend doesn't have GET /settings, comment this out and just use /me.
                try {
                    const r2 = await apiGet<{ settings: { name: string; email: string; home_address: string | null } }>(
                        "/settings",
                        token
                    );
                    setName(r2.settings.name ?? r1.user.name ?? "");
                    setEmail(r2.settings.email ?? r1.user.email ?? "");
                    setHomeAddress(r2.settings.home_address ?? "");
                } catch {
                    // fallback if GET /settings isn't implemented
                    setName(r1.user.name ?? "");
                    setEmail(r1.user.email ?? "");
                    setHomeAddress("");
                }
            } catch (e: any) {
                setErr(e.message || "Failed to load settings");
            } finally {
                setLoading(false);
            }
        })();
    }, [token]);

    if (!token) {
        return <Navigate to="/" replace />;
    }

    async function save() {
        setSaving(true);
        setErr(null);
        setMsg(null);

        try {
            const body: SettingsPayload = {
                name: name.trim() || undefined,
                email: email.trim() || undefined,
                home_address: homeAddress.trim() || undefined,
            };

            await apiPatch<{ user: any }>("/settings/profile", body, token);

            setMsg("Saved ✅");
        } catch (e: any) {
            setErr(e.message || "Save failed");
        } finally {
            setSaving(false);
        }
    }


    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">SETTINGS</div>
                <div className="heroTitle">Account settings</div>
                <div className="heroSub muted">Update your profile and preferences.</div>
            </div>

            {loading && <div className="card formSection">Loading…</div>}
            {err && <div className="card formSection" style={{ color: "crimson" }}>{err}</div>}
            {msg && <div className="card formSection">{msg}</div>}

            {!loading && (
                <div className="settingsGrid">
                    <div className="settingsStack">
                        <div className="card formSection">
                            <div className="sectionHeader sectionHeader--driver">
                                <div className="sectionHeaderTitle">
                                    <span className="sectionDot" />
                                    <div className="h3">Profile details</div>
                                </div>
                                <span className="badge badge--cool">Visible to hosts</span>
                            </div>

                            <label>
                                <span>Name</span>
                                <input
                                    className="input"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Your name"
                                />
                            </label>

                            <label>
                                <span>Email</span>
                                <input
                                    className="input"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="you@example.com"
                                />
                            </label>

                            <label>
                                <span>Home base (optional)</span>
                                <input
                                    className="input"
                                    value={homeAddress}
                                    onChange={(e) => setHomeAddress(e.target.value)}
                                    placeholder="e.g. 12 Example Road, London"
                                />
                            </label>

                            <div className="rowInline">
                                <button onClick={save} disabled={saving} className="btn btn-primary">
                                    {saving ? "Saving..." : "Save changes"}
                                </button>
                                <Link to="/dashboard" className="btn">Back to dashboard</Link>
                            </div>
                        </div>

                        <div className="card formSection">
                            <div className="sectionHeader sectionHeader--payments">
                                <div className="sectionHeaderTitle">
                                    <span className="sectionDot" />
                                    <div className="h3">Security</div>
                                </div>
                                <span className="badge badge--rose">Password</span>
                            </div>
                            <label>
                                <span>Current password</span>
                                <input
                                    className="input"
                                    type="password"
                                    placeholder="Enter current password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                />
                            </label>
                            <label>
                                <span>New password</span>
                                <input
                                    className="input"
                                    type="password"
                                    placeholder="Create a new password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                />
                            </label>
                            <div className="tiny muted">
                                Minimum 8 characters with at least one letter and one number.
                            </div>
                            <label>
                                <span>Confirm new password</span>
                                <input
                                    className="input"
                                    type="password"
                                    placeholder="Repeat new password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                />
                            </label>
                            <div className="rowInline">
                                <button onClick={async () => {
                                    if (!currentPassword || !newPassword) {
                                        setErr("Please fill in your current and new password.");
                                        return;
                                    }
                                    if (newPassword !== confirmPassword) {
                                        setErr("New passwords do not match.");
                                        return;
                                    }
                                    setSaving(true);
                                    setErr(null);
                                    setMsg(null);
                                    try {
                                        await apiPatch("/settings/password", { currentPassword, newPassword }, token ?? undefined);
                                        setMsg("Password updated.");
                                        setCurrentPassword("");
                                        setNewPassword("");
                                        setConfirmPassword("");
                                    } catch (e: any) {
                                        setErr(e.message || "Password update failed");
                                    } finally {
                                        setSaving(false);
                                    }
                                }} className="btn btn-primary" disabled={saving}>
                                    {saving ? "Updating..." : "Update password"}
                                </button>
                                <button
                                    onClick={() => {
                                        logout();
                                        navigate("/", { replace: true });
                                    }}
                                    className="btn"
                                >
                                    Log out
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="settingsStack">
                        <div className="card formSection">
                            <div className="sectionHeader sectionHeader--owner">
                                <div className="sectionHeaderTitle">
                                    <span className="sectionDot" />
                                    <div className="h3">Account snapshot</div>
                                </div>
                                <span className="badge badge--warm">Active</span>
                            </div>
                            <div className="stack">
                                <div>
                                    <div className="tiny muted">Signed in as</div>
                                    <div className="spotInfoValue">{me?.email ?? user?.email ?? "Unknown"}</div>
                                </div>
                                <div>
                                    <div className="tiny muted">Display name</div>
                                    <div className="spotInfoValue">{me?.name ?? user?.name ?? "User"}</div>
                                </div>
                                <div className="authStat">
                                    <div>
                                        <div className="tiny muted">Reward points</div>
                                        <div>{me?.points_balance ?? 0} pts</div>
                                    </div>
                                    <span className="badge badge--accent">Rewards</span>
                                </div>
                            </div>
                        </div>

                        <div className="card formSection">
                            <div className="sectionHeader sectionHeader--driver">
                                <div className="sectionHeaderTitle">
                                    <span className="sectionDot" />
                                    <div className="h3">Quick actions</div>
                                </div>
                            </div>
                            <div className="stack">
                                <Link to="/" className="btn">Browse spots</Link>
                                <Link to="/create-listing" className="btn btn-primary">Create a listing</Link>
                                <Link to="/dashboard" className="btn">View dashboard</Link>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
