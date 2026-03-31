import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { AppButton, AppField, AppInput } from "../components/ui/AppForm";
import { useAuth } from "../lib/auth";
import { SUPPORT_EMAIL } from "./pagesShared";
import {
    getPasswordStrength,
    isValidPassword,
    PASSWORD_REQUIREMENTS_TEXT,
    PASSWORD_REQUIREMENT_LABELS,
} from "../../../shared/domain/password";

const signupSchema = z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters.").refine((value) => /[A-Za-z]/.test(value), {
        message: "Name must include letters.",
    }),
    email: z.string().trim().email("Enter a valid email."),
    password: z
        .string()
        .min(8, PASSWORD_REQUIREMENTS_TEXT)
        .refine((value) => isValidPassword(value), {
            message: PASSWORD_REQUIREMENTS_TEXT,
        }),
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
    const strength = useMemo(() => getPasswordStrength(password), [password]);
    const hasTriedSubmit = form.formState.submitCount > 0;
    const showFieldError = (fieldName: keyof SignupFormValues) => {
        const fieldState = form.getFieldState(fieldName, form.formState);
        return hasTriedSubmit || fieldState.isTouched;
    };
    const requirementChecks = [
        { met: strength.checks.minLength, label: PASSWORD_REQUIREMENT_LABELS.minLength },
        { met: strength.checks.hasUppercase, label: PASSWORD_REQUIREMENT_LABELS.hasUppercase },
        { met: strength.checks.hasLowercase, label: PASSWORD_REQUIREMENT_LABELS.hasLowercase },
        { met: strength.checks.hasNumber, label: PASSWORD_REQUIREMENT_LABELS.hasNumber },
    ];

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
            <div className="authGrid authGrid--single">
                <div className="card authCard">
                    <div className="authCardHero">
                        <div className="heroKicker">GET STARTED</div>
                        <div className="heroTitle">Sign up to ParkingBuddies</div>
                        <div className="heroSub muted">
                            Set up your profile, list spaces, and start booking in minutes.
                        </div>
                    </div>

                    {msg && <div className="card formSection" style={{ color: "crimson" }}>{msg}</div>}

                    <form onSubmit={onSubmit} className="authForm">
                        <AppField label="Name" error={showFieldError("name") ? form.formState.errors.name?.message : undefined}>
                            <AppInput
                                autoComplete="name"
                                placeholder="Jamie Parker"
                                {...form.register("name")}
                            />
                        </AppField>

                        <AppField label="Email" error={showFieldError("email") ? form.formState.errors.email?.message : undefined}>
                            <AppInput
                                type="email"
                                autoComplete="email"
                                placeholder="you@example.com"
                                {...form.register("email")}
                            />
                        </AppField>

                        <AppField
                            label="Password"
                            description={
                                <>
                                    <div className="tiny muted" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                                        {requirementChecks.map((item) => (
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
                                        <div className="strengthFill" style={{ width: strength.width, background: strength.color }} />
                                    </div>
                                    <div className="tiny muted" style={{ marginTop: 6 }}>
                                        Strength: {strength.label}
                                    </div>
                                </>
                            }
                            error={showFieldError("password") ? form.formState.errors.password?.message : undefined}
                        >
                            <div className="authInputRow">
                                <AppInput
                                    type={showPass ? "text" : "password"}
                                    autoComplete="new-password"
                                    placeholder="Create a password"
                                    {...form.register("password")}
                                />
                                <AppButton type="button" onClick={() => setShowPass((value) => !value)}>
                                    {showPass ? "Hide" : "Show"}
                                </AppButton>
                            </div>
                        </AppField>

                        <AppField
                            label="Confirm password"
                            error={showFieldError("confirmPassword") ? form.formState.errors.confirmPassword?.message : undefined}
                        >
                            <AppInput
                                type={showPass ? "text" : "password"}
                                autoComplete="new-password"
                                placeholder="Repeat password"
                                {...form.register("confirmPassword")}
                            />
                        </AppField>

                        <label className="chip">
                            <input type="checkbox" {...form.register("agree")} />
                            I agree to the ParkingBuddies terms
                        </label>
                        {showFieldError("agree") && form.formState.errors.agree && (
                            <div className="spotAlert">{form.formState.errors.agree.message}</div>
                        )}

                        <AppButton type="submit" variant="primary" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? "Creating account..." : "Create account"}
                        </AppButton>
                    </form>

                    <div className="authDivider" />
                    <div className="tiny muted">
                        Already have an account? <Link to="/login">Log in</Link>
                    </div>
                    <div className="tiny muted" style={{ marginTop: 8 }}>
                        Need help? Please contact <Link to="/about#contact-us">{SUPPORT_EMAIL}</Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
