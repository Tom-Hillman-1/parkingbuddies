import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { apiGet, apiPatch, readErrorMessage } from "../lib/api";
import { useAuth, useStripeConnect } from "../lib/auth";
import type { User } from "../types";

const profileSchema = z.object({
    name: z.string().trim(),
    email: z.string().trim(),
    homeAddress: z.string().trim(),
}).superRefine((value, ctx) => {
    if (value.email && !z.string().email().safeParse(value.email).success) {
        ctx.addIssue({ code: "custom", path: ["email"], message: "Enter a valid email." });
    }
});

const passwordSchema = z.object({
    currentPassword: z.string().trim().min(1, "Enter your current password."),
    newPassword: z.string().trim().min(8, "New password must be at least 8 characters."),
    confirmPassword: z.string().trim().min(1, "Confirm your new password."),
}).superRefine((value, ctx) => {
    if (!/[A-Za-z]/.test(value.newPassword) || !/[0-9]/.test(value.newPassword)) {
        ctx.addIssue({
            code: "custom",
            path: ["newPassword"],
            message: "New password must include at least one letter and one number.",
        });
    }
    if (value.newPassword === value.currentPassword) {
        ctx.addIssue({
            code: "custom",
            path: ["newPassword"],
            message: "New password must be different from your current password.",
        });
    }
    if (value.newPassword !== value.confirmPassword) {
        ctx.addIssue({
            code: "custom",
            path: ["confirmPassword"],
            message: "New password and confirmation do not match.",
        });
    }
});

type ProfileFormValues = z.infer<typeof profileSchema>;
type PasswordFormValues = z.infer<typeof passwordSchema>;
type SettingsResponse = { name: string; email: string; home_address: string | null };
type SettingsQueryData = { name: string; email: string; homeAddress: string };

export default function SettingsPage() {
    const { token, logout } = useAuth();
    const navigate = useNavigate();

    const [msg, setMsg] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
    const [passwordErr, setPasswordErr] = useState<string | null>(null);
    const {
        connect,
        connectBusy,
        refreshConnectStatus,
        beginConnectOnboarding,
        openConnectDashboard,
    } = useStripeConnect(token);

    // credit: form validation setup pattern adapted from react-hook-form + zod docs
    const profileForm = useForm<ProfileFormValues>({
        resolver: zodResolver(profileSchema),
        defaultValues: { name: "", email: "", homeAddress: "" },
    });
    const passwordForm = useForm<PasswordFormValues>({
        resolver: zodResolver(passwordSchema),
        defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
    });

    // credit: query loading pattern adapted from TanStack Query docs
    const settingsQuery = useQuery<SettingsQueryData>({
        queryKey: ["settings-page", token],
        enabled: Boolean(token),
        queryFn: async () => {
            if (!token) throw new Error("Missing auth token");
            const meRes = await apiGet<{ user: User }>("/me", token);

            let settings: SettingsResponse = {
                name: meRes.user.name ?? "",
                email: meRes.user.email ?? "",
                home_address: null,
            };

            try {
                const settingsRes = await apiGet<{ settings: SettingsResponse }>("/settings", token);
                settings = settingsRes.settings;
            } catch {
                settings = {
                    name: meRes.user.name ?? "",
                    email: meRes.user.email ?? "",
                    home_address: null,
                };
            }

            await refreshConnectStatus(true);
            return {
                name: settings.name ?? "",
                email: settings.email ?? "",
                homeAddress: settings.home_address ?? "",
            };
        },
    });

    useEffect(() => {
        if (!settingsQuery.data) return;
        profileForm.reset({
            name: settingsQuery.data.name,
            email: settingsQuery.data.email,
            homeAddress: settingsQuery.data.homeAddress,
        });
    }, [settingsQuery.data, profileForm]);

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
    const loadErr = settingsQuery.error
        ? readErrorMessage(settingsQuery.error, "Failed to load settings")
        : null;

    async function handleBeginConnectOnboarding(mode: "stripe" | "demo" = "stripe") {
        setErr(null);
        setMsg(null);
        const result = await beginConnectOnboarding(mode);
        if (!result.ok && result.error) {
            setErr(result.error);
            return;
        }
        if (result.ok && result.message) {
            setMsg(result.message);
        }
    }

    async function handleOpenStripeDashboard() {
        setErr(null);
        const result = await openConnectDashboard();
        if (!result.ok) {
            setErr(result.error);
        }
    }

    const saveProfile = profileForm.handleSubmit(async (values) => {
        setErr(null);
        setMsg(null);

        try {
            await apiPatch<{ user: User }>(
                "/settings/profile",
                {
                    name: values.name.trim() || undefined,
                    email: values.email.trim() || undefined,
                    home_address: values.homeAddress.trim() || undefined,
                },
                token
            );
            setMsg("Saved");
        } catch (error: unknown) {
            setErr(readErrorMessage(error, "Save failed"));
        }
    });

    const updatePassword = passwordForm.handleSubmit(async (values) => {
        setPasswordErr(null);
        setPasswordMsg(null);

        try {
            await apiPatch(
                "/settings/password",
                { currentPassword: values.currentPassword, newPassword: values.newPassword },
                token
            );
            setPasswordMsg("Password changed successfully.");
            passwordForm.reset({ currentPassword: "", newPassword: "", confirmPassword: "" });
        } catch (error: unknown) {
            const raw = readErrorMessage(error, "Password update failed");
            if (/current password is incorrect/i.test(raw)) {
                setPasswordErr("Current password is incorrect.");
                return;
            }
            if (/must be at least 8 characters/i.test(raw)) {
                setPasswordErr("New password must be at least 8 characters and include at least one letter and one number.");
                return;
            }
            if (/different from/i.test(raw)) {
                setPasswordErr("New password must be different from your current password.");
                return;
            }
            if (/required/i.test(raw)) {
                setPasswordErr("Current password and new password are required.");
                return;
            }
            setPasswordErr(raw);
        }
    });

    return (
        <div className="container settingsPage">
            <div className="pageHeader">
                <div className="heroKicker">SETTINGS</div>
                <div className="heroTitle">Account settings</div>
                <div className="heroSub muted">Update your profile and preferences.</div>
            </div>

            {(err ?? loadErr) && <div className="card formSection" style={{ color: "crimson" }}>{err ?? loadErr}</div>}
            {msg && <div className="card formSection settingsSavedNotice">{msg}</div>}

            {!settingsQuery.isLoading && (
                <div className="settingsGrid">
                    <div className="settingsStack">
                        <div className="card formSection settingsPanel settingsPanel--profile">
                            <div className="sectionHeader sectionHeader--driver">
                                <div className="sectionHeaderTitle">
                                    <span className="sectionDot" />
                                    <div className="h3">Profile details</div>
                                </div>
                                <span className="badge badge--cool">Visible to hosts</span>
                            </div>

                            <label>
                                <span>Name</span>
                                <input className="input" placeholder="Your name" {...profileForm.register("name")} />
                            </label>

                            <label>
                                <span>Email</span>
                                <input className="input" placeholder="you@example.com" {...profileForm.register("email")} />
                            </label>
                            {profileForm.formState.errors.email && (
                                <div className="spotAlert">{profileForm.formState.errors.email.message}</div>
                            )}

                            <label>
                                <span>Home base (optional)</span>
                                <input
                                    className="input"
                                    placeholder="e.g. 12 Example Road, London"
                                    {...profileForm.register("homeAddress")}
                                />
                            </label>

                            <div className="rowInline">
                                <button onClick={saveProfile} disabled={profileForm.formState.isSubmitting} className="btn btn-primary">
                                    {profileForm.formState.isSubmitting ? "Saving..." : "Save changes"}
                                </button>
                                <Link to="/dashboard" className="btn">Back to dashboard</Link>
                            </div>
                        </div>

                        <div className="card formSection settingsPanel settingsPanel--security">
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
                                    {...passwordForm.register("currentPassword", {
                                        onChange: () => {
                                            setPasswordErr(null);
                                            setPasswordMsg(null);
                                        },
                                    })}
                                />
                            </label>
                            {passwordForm.formState.errors.currentPassword && (
                                <div className="spotAlert">{passwordForm.formState.errors.currentPassword.message}</div>
                            )}
                            <label>
                                <span>New password</span>
                                <input
                                    className="input"
                                    type="password"
                                    placeholder="Create a new password"
                                    {...passwordForm.register("newPassword", {
                                        onChange: () => {
                                            setPasswordErr(null);
                                            setPasswordMsg(null);
                                        },
                                    })}
                                />
                            </label>
                            <div className="tiny muted">
                                Minimum 8 characters with at least one letter and one number.
                            </div>
                            {passwordForm.formState.errors.newPassword && (
                                <div className="spotAlert">{passwordForm.formState.errors.newPassword.message}</div>
                            )}
                            <label>
                                <span>Confirm new password</span>
                                <input
                                    className="input"
                                    type="password"
                                    placeholder="Repeat new password"
                                    {...passwordForm.register("confirmPassword", {
                                        onChange: () => {
                                            setPasswordErr(null);
                                            setPasswordMsg(null);
                                        },
                                    })}
                                />
                            </label>
                            {passwordForm.formState.errors.confirmPassword && (
                                <div className="spotAlert">{passwordForm.formState.errors.confirmPassword.message}</div>
                            )}
                            {passwordErr && <div className="spotAlert">{passwordErr}</div>}
                            {passwordMsg && <div className="badge badge--green">{passwordMsg}</div>}
                            <div className="rowInline">
                                <button onClick={updatePassword} className="btn btn-primary" disabled={passwordForm.formState.isSubmitting}>
                                    {passwordForm.formState.isSubmitting ? "Updating..." : "Update password"}
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
                        <div className="card formSection settingsPanel settingsPanel--payouts">
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
                                    {connect?.charges_enabled ? "Enabled" : "Charges pending"}
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
                                    onClick={() => handleBeginConnectOnboarding("stripe")}
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
                                        onClick={() => handleBeginConnectOnboarding("demo")}
                                        disabled={connectBusy}
                                    >
                                        Use demo payouts
                                    </button>
                                )}
                                <button
                                    className="btn"
                                    onClick={handleOpenStripeDashboard}
                                    disabled={connectBusy || !connect?.onboarding_complete || !!connect?.demo_bypass}
                                >
                                    Open Stripe dashboard
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
