import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { SUPPORT_EMAIL } from "./pagesShared";

const signupSchema = z.object({
    name: z.string().trim().min(3, "Name must be at least 3 characters.").refine((value) => /[A-Za-z]/.test(value), {
        message: "Name must include letters.",
    }),
    email: z.string().trim().email("Enter a valid email."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Confirm your password."),
    agree: z.boolean().refine((value) => value, { message: "Please accept the terms to continue." }),
}).superRefine((value, ctx) => {
    if (value.password !== value.confirmPassword) {
        ctx.addIssue({
            code: "custom",
            path: ["confirmPassword"],
            message: "Passwords do not match.",
        });
    }
});

type SignupFormValues = z.infer<typeof signupSchema>;

export default function SignupPage() {
    const { signup } = useAuth();
    const nav = useNavigate();
    const [showPass, setShowPass] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    // credit: react-hook-form + zod form setup pattern adapted from official docs
    const form = useForm<SignupFormValues>({
        resolver: zodResolver(signupSchema),
        defaultValues: {
            name: "",
            email: "",
            password: "",
            confirmPassword: "",
            agree: false,
        },
    });

    const password = useWatch({ control: form.control, name: "password", defaultValue: "" });
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

    const onSubmit = form.handleSubmit(async (values) => {
        setMsg(null);
        try {
            await signup(values.email, values.name, values.password);
            nav("/");
        } catch (error: unknown) {
            setMsg(error instanceof Error ? error.message : "Signup failed");
        }
    });

    return (
        <div className="container authPage">
            <div className="pageHeader authPageHeader">
                <div className="heroKicker">GET STARTED</div>
                <div className="heroTitle">Create your ParkingBuddies account</div>
                <div className="heroSub muted">
                    Set up your profile, list spaces, and start booking in minutes.
                </div>
            </div>

            <div className="authGrid authGrid--single">
                <div className="card authCard">
                    <div className="h2">Sign up</div>
                    <div className="muted tiny">We'll use this info to personalize your dashboard.</div>

                    {msg && <div className="card formSection" style={{ color: "crimson" }}>{msg}</div>}

                    <form onSubmit={onSubmit} className="authForm">
                        <label>
                            <span>Name</span>
                            <input
                                className="input"
                                autoComplete="name"
                                placeholder="Jamie Parker"
                                {...form.register("name")}
                            />
                        </label>
                        {form.formState.errors.name && <div className="spotAlert">{form.formState.errors.name.message}</div>}

                        <label>
                            <span>Email</span>
                            <input
                                className="input"
                                type="email"
                                autoComplete="email"
                                placeholder="you@example.com"
                                {...form.register("email")}
                            />
                        </label>
                        {form.formState.errors.email && <div className="spotAlert">{form.formState.errors.email.message}</div>}

                        <label>
                            <span>Password</span>
                            <div className="authInputRow">
                                <input
                                    className="input"
                                    type={showPass ? "text" : "password"}
                                    autoComplete="new-password"
                                    placeholder="Create a password"
                                    {...form.register("password")}
                                />
                                <button type="button" className="btn" onClick={() => setShowPass((value) => !value)}>
                                    {showPass ? "Hide" : "Show"}
                                </button>
                            </div>
                            <div className="authNote">Minimum 8 characters. Mix letters and numbers for best results.</div>
                            <div className="strengthBar" aria-hidden>
                                <div className="strengthFill" style={{ width: strengthWidth, background: strengthColor }} />
                            </div>
                            <div className="tiny muted">Strength: {strengthLabel}</div>
                        </label>
                        {form.formState.errors.password && (
                            <div className="spotAlert">{form.formState.errors.password.message}</div>
                        )}

                        <label>
                            <span>Confirm password</span>
                            <input
                                className="input"
                                type={showPass ? "text" : "password"}
                                autoComplete="new-password"
                                placeholder="Repeat password"
                                {...form.register("confirmPassword")}
                            />
                        </label>
                        {form.formState.errors.confirmPassword && (
                            <div className="spotAlert">{form.formState.errors.confirmPassword.message}</div>
                        )}

                        <label className="chip">
                            <input type="checkbox" {...form.register("agree")} />
                            I agree to the ParkingBuddies terms
                        </label>
                        {form.formState.errors.agree && <div className="spotAlert">{form.formState.errors.agree.message}</div>}

                        <button type="submit" className="btn btn-primary" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? "Creating account..." : "Create account"}
                        </button>
                    </form>

                    <div className="authDivider" />
                    <div className="tiny muted">
                        Already have an account? <Link to="/login">Log in</Link>
                    </div>
                    <div className="tiny muted" style={{ marginTop: 8 }}>
                        Need help? Please contact <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
                    </div>
                </div>
            </div>
        </div>
    );
}
