export const PASSWORD_REQUIREMENTS_TEXT =
    "Password must be at least 8 characters and include at least 1 uppercase letter, 1 lowercase letter, and 1 number.";

export const PASSWORD_REQUIREMENTS_HINT =
    "Use 8+ characters with at least 1 uppercase letter, 1 lowercase letter, and 1 number.";

export const PASSWORD_REQUIREMENT_LABELS = {
    minLength: "8+ characters",
    hasUppercase: "uppercase letter",
    hasLowercase: "lowercase letter",
    hasNumber: "number",
} as const;

export type PasswordChecks = {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSpecial: boolean;
};

export type PasswordStrength = {
    checks: PasswordChecks;
    meetsMinimum: boolean;
    label: "Weak" | "Almost there" | "Good" | "Strong";
    width: string;
    color: string;
};

export function getPasswordChecks(password: string): PasswordChecks {
    return {
        minLength: password.length >= 8,
        hasUppercase: /[A-Z]/.test(password),
        hasLowercase: /[a-z]/.test(password),
        hasNumber: /[0-9]/.test(password),
        hasSpecial: /[^A-Za-z0-9]/.test(password),
    };
}

export function isValidPassword(password: string) {
    const checks = getPasswordChecks(password);
    return checks.minLength && checks.hasUppercase && checks.hasLowercase && checks.hasNumber;
}

export function getPasswordStrength(password: string): PasswordStrength {
    const checks = getPasswordChecks(password);
    const requiredChecks = [checks.minLength, checks.hasUppercase, checks.hasLowercase, checks.hasNumber];
    const metRequiredCount = requiredChecks.filter(Boolean).length;
    const meetsMinimum = requiredChecks.every(Boolean);
    const bonusCount = checks.hasSpecial ? 1 : 0;

    if (!password) {
        return {
            checks,
            meetsMinimum,
            label: "Weak",
            width: "0%",
            color: "rgba(243,107,127,0.9)",
        };
    }

    if (!meetsMinimum) {
        return {
            checks,
            meetsMinimum,
            label: metRequiredCount >= 3 ? "Almost there" : "Weak",
            width: `${Math.max(25, metRequiredCount * 20)}%`,
            color: metRequiredCount >= 3 ? "rgba(255,200,87,0.9)" : "rgba(243,107,127,0.9)",
        };
    }

    return {
        checks,
        meetsMinimum,
        label: bonusCount > 0 || password.length >= 12 ? "Strong" : "Good",
        width: bonusCount > 0 || password.length >= 12 ? "100%" : "80%",
        color: "rgba(59,186,156,0.9)",
    };
}
