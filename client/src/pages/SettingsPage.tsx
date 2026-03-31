import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Link, Navigate, useNavigate } from "react-router-dom";
import AppPageState from "../components/AppPageState";
import { AppButton, AppField, AppInput } from "../components/ui/AppForm";
import { apiGet, apiPatch, readErrorMessage } from "../lib/api";
import { useAuth, useStripeConnect } from "../lib/auth";
import type { User } from "../types";
import {
    getPasswordStrength,
    isValidPassword,
    PASSWORD_REQUIREMENTS_TEXT,
    PASSWORD_REQUIREMENT_LABELS,
} from "../../../shared/domain/password";

const profileSchema = z.object({
    name: z.string().trim(),
    email: z.string().trim(),
}).superRefine((value, ctx) => {
    if (value.email && !z.string().email().safeParse(value.email).success) {
        ctx.addIssue({ code: "custom", path: ["email"], message: "Enter a valid email." });
    }
});

const passwordSchema = z.object({
    currentPassword: z.string().trim().min(1, "Enter your current password."),
    newPassword: z.string().trim().min(8, `New ${PASSWORD_REQUIREMENTS_TEXT.charAt(0).toLowerCase()}${PASSWORD_REQUIREMENTS_TEXT.slice(1)}`),
}).superRefine((value, ctx) => {
    if (!isValidPassword(value.newPassword)) {
        ctx.addIssue({
            code: "custom",
            path: ["newPassword"],
            message: `New ${PASSWORD_REQUIREMENTS_TEXT.charAt(0).toLowerCase()}${PASSWORD_REQUIREMENTS_TEXT.slice(1)}`,
        });
    }
    if (value.newPassword === value.currentPassword) {
        ctx.addIssue({
            code: "custom",
            path: ["newPassword"],
            message: "New password must be different from your current password.",
        });
    }
});

type ProfileFormValues = z.infer<typeof profileSchema>;
type PasswordFormValues = z.infer<typeof passwordSchema>;
type SettingsResponse = { name: string; email: string };
type SettingsQueryData = { name: string; email: string; pointsBalance: number; createdAt: string };

export default function SettingsPage() {
    const { token, logout, user, refreshMe, replaceToken } = useAuth();
    const navigate = useNavigate();

    const [profileMsg, setProfileMsg] = useState<string | null>(null);
    const [profileErr, setProfileErr] = useState<string | null>(null);
    const [payoutMsg, setPayoutMsg] = useState<string | null>(null);
    const [payoutErr, setPayoutErr] = useState<string | null>(null);
    const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
    const [passwordErr, setPasswordErr] = useState<string | null>(null);
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const {
        connect,
        connectBusy,
        refreshConnectStatus,
        beginConnectOnboarding,
    } = useStripeConnect(token);

    const profileForm = useForm<ProfileFormValues>({
        resolver: zodResolver(profileSchema),
        defaultValues: { name: "", email: "" },
    });
    const passwordForm = useForm<PasswordFormValues>({
        resolver: zodResolver(passwordSchema),
        defaultValues: { currentPassword: "", newPassword: "" },
    });
    const newPasswordValue = useWatch({ control: passwordForm.control, name: "newPassword", defaultValue: "" });
    const passwordStrength = useMemo(() => getPasswordStrength(newPasswordValue), [newPasswordValue]);
    const passwordRequirementChecks = [
        { met: passwordStrength.checks.minLength, label: PASSWORD_REQUIREMENT_LABELS.minLength },
        { met: passwordStrength.checks.hasUppercase, label: PASSWORD_REQUIREMENT_LABELS.hasUppercase },
        { met: passwordStrength.checks.hasLowercase, label: PASSWORD_REQUIREMENT_LABELS.hasLowercase },
        { met: passwordStrength.checks.hasNumber, label: PASSWORD_REQUIREMENT_LABELS.hasNumber },
    ];

    const settingsQuery = useQuery<SettingsQueryData>({
        queryKey: ["settings-page", token],
        enabled: Boolean(token),
        queryFn: async () => {
            if (!token) throw new Error("Missing auth token");
            const meRes = await apiGet<{ user: User }>("/me", token);

            let settings: SettingsResponse = {
                name: meRes.user.name ?? "",
                email: meRes.user.email ?? "",
            };

            try {
                const settingsRes = await apiGet<{ settings: SettingsResponse }>("/settings", token);
                settings = settingsRes.settings;
            } catch {
                settings = {
                    name: meRes.user.name ?? "",
                    email: meRes.user.email ?? "",
                };
            }
            return {
                name: settings.name ?? "",
                email: settings.email ?? "",
                pointsBalance: Number(meRes.user.points_balance ?? 0),
                createdAt: meRes.user.created_at ?? "",
            };
        },
    });

    useEffect(() => {
        if (!token) return;
        void refreshConnectStatus(true);
    }, [token, refreshConnectStatus]);

    useEffect(() => {
        if (!settingsQuery.data) return;
        profileForm.reset({
            name: settingsQuery.data.name,
            email: settingsQuery.data.email,
        });
    }, [settingsQuery.data, profileForm]);

    if (!token) {
        return <Navigate to="/" replace />;
    }

    const connectLabel = connect?.demo_bypass
        ? "Demo mode"
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
    const memberSince = settingsQuery.data?.createdAt
        ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(
              new Date(settingsQuery.data.createdAt)
          )
        : "Recently joined";

    async function handleBeginConnectOnboarding(mode: "stripe" | "demo" = "stripe") {
        setPayoutErr(null);
        setPayoutMsg(null);
        const result = await beginConnectOnboarding(mode);
        if (!result.ok && result.error) {
            setPayoutErr(result.error);
            return;
        }
        if (result.ok && result.message) {
            setPayoutMsg(result.message);
        }
    }

    async function handleRefreshConnectStatus() {
        setPayoutErr(null);
        const result = await refreshConnectStatus();
        if (!result.ok && result.error) {
            setPayoutErr(result.error);
        }
    }

    const saveProfile = profileForm.handleSubmit(async (values) => {
        setProfileErr(null);
        setProfileMsg(null);

        try {
            const response = await apiPatch<{ user: User }>(
                "/settings/profile",
                {
                    name: values.name.trim() || undefined,
                    email: values.email.trim() || undefined,
                },
                token
            );
            profileForm.reset({
                name: response.user.name ?? "",
                email: response.user.email ?? "",
            });
            await Promise.all([refreshMe(), settingsQuery.refetch()]);
            setProfileMsg("Profile updated successfully.");
        } catch (error: unknown) {
            setProfileErr(readErrorMessage(error, "Save failed"));
        }
    });

    const updatePassword = passwordForm.handleSubmit(async (values) => {
        setPasswordErr(null);
        setPasswordMsg(null);

        try {
            const response = await apiPatch<{ token: string }>(
                "/settings/password",
                { currentPassword: values.currentPassword, newPassword: values.newPassword },
                token
            );
            replaceToken(response.token);
            setPasswordMsg("Password changed successfully.");
            passwordForm.reset({ currentPassword: "", newPassword: "" });
        } catch (error: unknown) {
            const raw = readErrorMessage(error, "Password update failed");
            if (/current password is incorrect/i.test(raw)) {
                setPasswordErr("Current password is incorrect.");
                return;
            }
            if (/must be at least 8 characters/i.test(raw)) {
                setPasswordErr(`New ${PASSWORD_REQUIREMENTS_TEXT.charAt(0).toLowerCase()}${PASSWORD_REQUIREMENTS_TEXT.slice(1)}`);
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

            {loadErr && (
                <AppPageState
                    card
                    title="Settings are still parking."
                    copy="Your account details did not load properly. Head back home and try again in a moment."
                />
            )}
            {payoutErr && <div className="card formSection" style={{ color: "crimson" }}>{payoutErr}</div>}
            {payoutMsg && <div className="card formSection settingsSavedNotice">{payoutMsg}</div>}

            {!settingsQuery.isLoading && (
                <div className="settingsGrid">
                        <div className="card formSection settingsPanel settingsPanel--security">
                            <div className="sectionHeader sectionHeader--payments">
                                <div className="sectionHeaderTitle">
                                    <span className="sectionDot" />
                                    <div className="h3">Security</div>
                                </div>
                                <span className="badge badge--rose">Password</span>
                            </div>
                            <AppField label="Current password" error={passwordForm.formState.errors.currentPassword?.message}>
                                <div className="authInputRow settingsPasswordFieldRow">
                                    <AppInput
                                        type={showCurrentPassword ? "text" : "password"}
                                        placeholder="Enter current password"
                                        {...passwordForm.register("currentPassword", {
                                            onChange: () => {
                                                setPasswordErr(null);
                                                setPasswordMsg(null);
                                            },
                                        })}
                                    />
                                    <AppButton
                                        onClick={() => setShowCurrentPassword((value) => !value)}
                                        className="settingsPasswordToggle"
                                    >
                                        {showCurrentPassword ? "Hide" : "Show"}
                                    </AppButton>
                                </div>
                            </AppField>
                            <AppField
                                label="New password"
                                description={
                                    <>
                                        <div className="tiny muted" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                                            {passwordRequirementChecks.map((item) => (
                                                <span
                                                    key={item.label}
                                                    style={{
                                                        color: item.met ? "rgba(59,186,156,0.95)" : "rgba(122,138,164,0.95)",
                                                    }}
                                                >
                                                    {item.met ? "✓" : "○"} {item.label}
                                                </span>
                                            ))}
                                        </div>
                                        <div className="strengthBar" aria-hidden>
                                            <div
                                                className="strengthFill"
                                                style={{ width: passwordStrength.width, background: passwordStrength.color }}
                                            />
                                        </div>
                                        <div className="tiny muted" style={{ marginTop: 6 }}>
                                            Strength: {passwordStrength.label}
                                        </div>
                                    </>
                                }
                                error={passwordForm.formState.errors.newPassword?.message}
                            >
                                <div className="authInputRow settingsPasswordFieldRow">
                                    <AppInput
                                        type={showNewPassword ? "text" : "password"}
                                        placeholder="Create a new password"
                                        {...passwordForm.register("newPassword", {
                                            onChange: () => {
                                                setPasswordErr(null);
                                                setPasswordMsg(null);
                                            },
                                        })}
                                    />
                                    <AppButton
                                        onClick={() => setShowNewPassword((value) => !value)}
                                        className="settingsPasswordToggle"
                                    >
                                        {showNewPassword ? "Hide" : "Show"}
                                    </AppButton>
                                </div>
                            </AppField>
                            {passwordErr && <div className="spotAlert">{passwordErr}</div>}
                            {passwordMsg && <div className="badge badge--green">{passwordMsg}</div>}
                            <div className="rowInline settingsPanelActions">
                                <AppButton onClick={updatePassword} variant="primary" disabled={passwordForm.formState.isSubmitting}>
                                    {passwordForm.formState.isSubmitting ? "Updating..." : "Update password"}
                                </AppButton>
                                <AppButton
                                    onClick={() => {
                                        logout();
                                        navigate("/", { replace: true });
                                    }}
                                >
                                    Log out
                                </AppButton>
                            </div>
                        </div>
                        <div className="card formSection settingsPanel settingsPanel--profile">
                            <div className="sectionHeader sectionHeader--driver">
                                <div className="sectionHeaderTitle">
                                    <span className="sectionDot" />
                                    <div className="h3">Profile details</div>
                                </div>
                                <span className="badge badge--cool">Visible to hosts</span>
                            </div>

                            <AppField label="Name">
                                <AppInput
                                    placeholder="Your name"
                                    {...profileForm.register("name", {
                                        onChange: () => {
                                            setProfileErr(null);
                                            setProfileMsg(null);
                                        },
                                    })}
                                />
                            </AppField>

                            <AppField
                                label="Email"
                                description="Please enter a valid new email."
                                error={profileForm.formState.errors.email?.message}
                            >
                                <AppInput
                                    placeholder="you@example.com"
                                    {...profileForm.register("email", {
                                        onChange: () => {
                                            setProfileErr(null);
                                            setProfileMsg(null);
                                        },
                                    })}
                                />
                            </AppField>
                            {profileErr && <div className="spotAlert">{profileErr}</div>}
                            {profileMsg && <div className="badge badge--green">{profileMsg}</div>}

                            <div className="rowInline settingsPanelActions">
                                <AppButton onClick={saveProfile} disabled={profileForm.formState.isSubmitting} variant="primary">
                                    {profileForm.formState.isSubmitting ? "Saving..." : "Save changes"}
                                </AppButton>
                                <Link to="/dashboard" className="btn settingsPanelLinkBtn">Back to dashboard</Link>
                            </div>
                        </div>
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
                                    ? "Demo payouts only. No Stripe setup needed."
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
                            <div className="rowInline settingsPanelActions">
                                <AppButton
                                    variant="primary"
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
                                </AppButton>
                                <AppButton
                                    onClick={handleRefreshConnectStatus}
                                    disabled={connectBusy}
                                >
                                    Refresh status
                                </AppButton>
                            </div>
                        </div>
                        <div className="card formSection settingsPanel settingsPanel--overview">
                            <div className="sectionHeader sectionHeader--overview">
                                <div className="sectionHeaderTitle">
                                    <span className="sectionDot" />
                                    <div className="h3">Profile overview</div>
                                </div>
                                <span className="badge badge--cool">Live account</span>
                            </div>

                            <div className="tiny muted">Quick summary of the account currently signed in.</div>

                            <div className="settingRow">
                                <div className="settingRowTitle">
                                    <div className="tiny muted">Account holder</div>
                                    <div className="spotInfoValue">{settingsQuery.data?.name || user?.name || "Not set"}</div>
                                </div>
                                <span className="badge badge--cool">{settingsQuery.data?.pointsBalance ?? 0} pts</span>
                            </div>
                            <div className="settingRow">
                                <div className="settingRowTitle">
                                    <div className="tiny muted">Email on account</div>
                                    <div className="spotInfoValue">{settingsQuery.data?.email || user?.email || "Not set"}</div>
                                </div>
                            </div>
                            <div className="settingRow">
                                <div className="settingRowTitle">
                                    <div className="tiny muted">Member since</div>
                                    <div className="spotInfoValue">{memberSince}</div>
                                </div>
                                <span className={connect?.account_id ? "badge badge--green" : "badge badge--warm"}>
                                    {connect?.account_id ? "Payouts ready" : "Payouts not connected"}
                                </span>
                            </div>
                        </div>
                </div>
            )}
        </div>
    );
}
