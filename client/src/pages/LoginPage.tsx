import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AppButton, AppField, AppInput } from "../components/ui/AppForm";
import { useAuth } from "../lib/auth";
import { SUPPORT_EMAIL } from "./pagesShared";

const remembered = localStorage.getItem("pb_remember") === "true";

const loginSchema = z.object({
    email: z.string().trim().email("Enter a valid email."),
    password: z.string().min(1, "Password is required."),
    remember: z.boolean(),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
    const { login } = useAuth();
    const nav = useNavigate();
    const [searchParams] = useSearchParams();
    const [msg, setMsg] = useState<string | null>(null);
    const [showPass, setShowPass] = useState(false);

    const form = useForm<LoginFormValues>({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            email: remembered ? localStorage.getItem("pb_email") ?? "" : "",
            password: "",
            remember: remembered,
        },
    });

    const next = searchParams.get("next");
    const redirectTarget = next && next.startsWith("/") ? next : "/";

    const onSubmit = form.handleSubmit(async (values) => {
        setMsg(null);
        try {
            await login(values.email, values.password);
            if (values.remember) {
                localStorage.setItem("pb_remember", "true");
                localStorage.setItem("pb_email", values.email);
            } else {
                localStorage.removeItem("pb_remember");
                localStorage.removeItem("pb_email");
            }
            nav(redirectTarget);
        } catch (error: unknown) {
            setMsg(error instanceof Error ? error.message : "Login failed");
        }
    });

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
                        <AppField label="Email" error={form.formState.errors.email?.message}>
                            <AppInput
                                type="email"
                                autoComplete="username"
                                placeholder="you@example.com"
                                {...form.register("email")}
                            />
                        </AppField>

                        <AppField label="Password" error={form.formState.errors.password?.message}>
                            <div className="authInputRow">
                                <AppInput
                                    type={showPass ? "text" : "password"}
                                    autoComplete="current-password"
                                    placeholder="Enter your password"
                                    {...form.register("password")}
                                />
                                <AppButton type="button" onClick={() => setShowPass((value) => !value)}>
                                    {showPass ? "Hide" : "Show"}
                                </AppButton>
                            </div>
                        </AppField>

                        <div className="rowInline" style={{ justifyContent: "space-between" }}>
                            <label className="chip">
                                <input type="checkbox" {...form.register("remember")} />
                                Keep me signed in
                            </label>
                            <span className="tiny muted">Forgot password? Ask support.</span>
                        </div>

                        <AppButton type="submit" variant="primary" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? "Logging in..." : "Log in"}
                        </AppButton>
                    </form>

                    <div className="authDivider" />
                    <div className="tiny muted">
                        No account yet? <Link to="/signup">Create one</Link>
                    </div>
                    <div className="tiny muted" style={{ marginTop: 8 }}>
                        Need help? Please contact <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
                    </div>
                </div>
            </div>
        </div>
    );
}
