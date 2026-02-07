import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";

type Me = {
    id: string;
    email: string;
    name: string;
    points_balance: number;
    stripe_account_id?: string | null;
    stripe_charges_enabled?: boolean;
    stripe_payouts_enabled?: boolean;
    stripe_details_submitted?: boolean;
};

type ConnectStatus = {
    account_id: string | null;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    details_submitted: boolean;
    onboarding_complete: boolean;
    dashboard_enabled: boolean;
    demo_bypass: boolean;
    demo_available: boolean;
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
    const [connect, setConnect] = useState<ConnectStatus | null>(null);
    const [connectBusy, setConnectBusy] = useState(false);

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

                try {
                    const connectR = await apiGet<{ connect: ConnectStatus }>("/payments/connect/status", token);
                    setConnect(connectR.connect);
                } catch {
                    setConnect(null);
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

    const connectLabel = connect?.demo_bypass
        ? "Demo mode active"
        : !connect?.account_id
            ? "Not connected"
            : connect.onboarding_complete
                ? "Ready to receive payouts"
                : "Onboarding incomplete";
    const connectBadgeClass = connect?.demo_bypass
        ? "badge badge--cool"
        : !connect?.account_id
            ? "badge badge--rose"
            : connect.onboarding_complete
                ? "badge badge--green"
                : "badge badge--warm";

    async function refreshConnectStatus() {
        if (!token) return;
        try {
            const r = await apiGet<{ connect: ConnectStatus }>("/payments/connect/status", token);
            setConnect(r.connect);
        } catch (e: any) {
            setErr(e?.message || "Failed to load Stripe Connect status");
        }
    }

    async function beginConnectOnboarding(mode: "stripe" | "demo" = "stripe") {
        if (!token) return;
        setConnectBusy(true);
        setErr(null);
        try {
            const r = await apiPost<{ url?: string; connect: ConnectStatus }>(
                "/payments/connect/onboard",
                { mode },
                token
            );
            setConnect(r.connect);
            if (r.connect?.demo_bypass) {
                setMsg("Demo payout mode is enabled. Stripe onboarding is skipped.");
                return;
            }
            if (r.url) {
                window.location.href = r.url;
            } else {
                setErr("Stripe onboarding link was missing.");
            }
        } catch (e: any) {
            setErr(e?.message || "Unable to start Stripe onboarding");
        } finally {
            setConnectBusy(false);
        }
    }

    async function openStripeDashboard() {
        if (!token) return;
        setConnectBusy(true);
        setErr(null);
        try {
            const r = await apiPost<{ url: string; connect: ConnectStatus }>("/payments/connect/dashboard-link", {}, token);
            setConnect(r.connect);
            window.open(r.url, "_blank", "noopener,noreferrer");
        } catch (e: any) {
            setErr(e?.message || "Unable to open Stripe dashboard");
        } finally {
            setConnectBusy(false);
        }
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

            await apiPatch<{ user: any }>("/settings/profile", body, token ?? undefined);

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
            {msg && <div className="card formSection settingsSavedNotice">{msg}</div>}

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
                            <div className="sectionHeader sectionHeader--payments">
                                <div className="sectionHeaderTitle">
                                    <span className="sectionDot" />
                                    <div className="h3">Stripe payouts</div>
                                </div>
                                <span className={connectBadgeClass}>{connectLabel}</span>
                            </div>
                            <div className="tiny muted">
                                {connect?.demo_bypass
                                    ? "Demo bypass mode is active. Owner payouts are simulated and no Stripe onboarding is required."
                                    : "Connect Stripe to receive booking money as an owner. In test mode, payouts are simulated."}
                            </div>
                            <div className="settingRow">
                                <div className="settingRowTitle">
                                    <div className="tiny muted">Connected account</div>
                                    <div className="spotInfoValue">
                                        {connect?.demo_bypass
                                            ? "Demo simulation (no connected Stripe account)"
                                            : connect?.account_id ?? "Not connected"}
                                    </div>
                                </div>
                                <span className={connect?.charges_enabled ? "badge badge--green" : "badge badge--warm"}>
                                    {connect?.charges_enabled ? "Charges enabled" : "Charges pending"}
                                </span>
                            </div>
                            <div className="settingRow">
                                <div className="settingRowTitle">
                                    <div className="tiny muted">Payout capability</div>
                                    <div className="spotInfoValue">
                                        {connect?.payouts_enabled ? "Enabled" : "Pending"}
                                    </div>
                                </div>
                                <span className={connect?.details_submitted ? "badge badge--cool" : "badge badge--warm"}>
                                    {connect?.details_submitted ? "Details submitted" : "Details required"}
                                </span>
                            </div>
                            <div className="rowInline">
                                <button
                                    className="btn btn-primary"
                                    onClick={() => beginConnectOnboarding("stripe")}
                                    disabled={connectBusy}
                                >
                                    {connectBusy
                                        ? "Opening..."
                                        : connect?.demo_bypass
                                            ? "Connect Stripe instead"
                                        : !connect?.account_id
                                            ? "Connect Stripe"
                                            : connect.onboarding_complete
                                                ? "Update Stripe details"
                                                : "Continue onboarding"}
                                </button>
                                {connect?.demo_available && !connect?.demo_bypass && !connect?.account_id && (
                                    <button
                                        className="btn"
                                        onClick={() => beginConnectOnboarding("demo")}
                                        disabled={connectBusy}
                                    >
                                        Use demo payouts
                                    </button>
                                )}
                                <button className="btn" onClick={refreshConnectStatus} disabled={connectBusy}>
                                    Refresh status
                                </button>
                                <button
                                    className="btn"
                                    onClick={openStripeDashboard}
                                    disabled={connectBusy || !connect?.onboarding_complete || !!connect?.demo_bypass}
                                >
                                    Open Stripe dashboard
                                </button>
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
