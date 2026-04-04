import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, readErrorMessage } from "./api";
import type { User } from "../types";

type AuthContextValue = {
    token: string | null;
    user: User | null;
    isLoading: boolean;
    login: (email: string, password: string, remember?: boolean) => Promise<void>;
    signup: (email: string, name: string, password: string) => Promise<void>;
    logout: () => void;
    refreshMe: () => Promise<void>;
    replaceToken: (token: string) => void;
};

export type ConnectStatus = {
    account_id: string | null;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    details_submitted: boolean;
    onboarding_complete: boolean;
    dashboard_enabled: boolean;
    demo_bypass: boolean;
    demo_available: boolean;
};

type ConnectActionResult =
    | { ok: true; message?: string }
    | { ok: false; error: string };

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "pb_token";
const REMEMBER_KEY = "pb_remember";
const TOKEN_ERROR_MESSAGES = new Set(["Invalid or expired token", "Missing Bearer token"]);

function readStoredAuth() {
    try {
        const sessionToken = window.sessionStorage.getItem(TOKEN_KEY);
        if (sessionToken) {
            return { token: sessionToken, remember: false };
        }

        const localToken = window.localStorage.getItem(TOKEN_KEY);
        return {
            token: localToken,
            remember: Boolean(localToken),
        };
    } catch {
        return { token: null, remember: false };
    }
}

function writeStoredToken(token: string, remember = false) {
    try {
        if (remember) {
            window.localStorage.setItem(TOKEN_KEY, token);
            window.localStorage.setItem(REMEMBER_KEY, "true");
            window.sessionStorage.removeItem(TOKEN_KEY);
            return;
        }

        window.sessionStorage.setItem(TOKEN_KEY, token);
        window.localStorage.removeItem(TOKEN_KEY);
        window.localStorage.removeItem(REMEMBER_KEY);
    } catch {
        // Ignore storage failures and keep the in-memory session alive.
    }
}

function clearStoredToken() {
    try {
        window.sessionStorage.removeItem(TOKEN_KEY);
        window.localStorage.removeItem(TOKEN_KEY);
    } catch {
        // Ignore storage failures and keep the in-memory logout flow working.
    }
}

function shouldClearAuthState(error: unknown) {
    return TOKEN_ERROR_MESSAGES.has(readErrorMessage(error, ""));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [storedAuth] = useState(() => readStoredAuth());
    const [token, setToken] = useState<string | null>(storedAuth.token);
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [rememberSession, setRememberSession] = useState(storedAuth.remember);

    const clearAuthState = useCallback(() => {
        clearStoredToken();
        setToken(null);
        setUser(null);
        setRememberSession(false);
    }, []);

    const refreshMe = useCallback(async () => {
        if (!token) {
            setUser(null);
            return;
        }
        const r = await apiGet<{ user: User }>("/me", token);
        setUser(r.user);
    }, [token]);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                await refreshMe();
            } catch (error: unknown) {
                if (!active) return;
                if (shouldClearAuthState(error)) {
                    clearAuthState();
                }
            } finally {
                if (active) setIsLoading(false);
            }
        })();
        return () => {
            active = false;
        };
    }, [refreshMe, clearAuthState]);

    useEffect(() => {
        if (!token) return;
        const onFocus = () => {
            refreshMe().catch((error: unknown) => {
                if (shouldClearAuthState(error)) {
                    clearAuthState();
                }
            });
        };
        const onVisibility = () => {
            if (document.visibilityState === "visible") {
                refreshMe().catch((error: unknown) => {
                    if (shouldClearAuthState(error)) {
                        clearAuthState();
                    }
                });
            }
        };

        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [token, refreshMe, clearAuthState]);

    const login = useCallback(async (email: string, password: string, remember = false) => {
        const r = await apiPost<{ token: string }>("/auth/login", { email, password, remember });
        writeStoredToken(r.token, remember);
        setRememberSession(remember);
        setToken(r.token);
        const me = await apiGet<{ user: User }>("/me", r.token);
        setUser(me.user);
    }, []);

    const signup = useCallback(async (email: string, name: string, password: string) => {
        const r = await apiPost<{ token: string }>("/auth/signup", { email, name, password });
        writeStoredToken(r.token, false);
        setRememberSession(false);
        setToken(r.token);
        const me = await apiGet<{ user: User }>("/me", r.token);
        setUser(me.user);
    }, []);

    const logout = useCallback(() => {
        clearAuthState();
    }, [clearAuthState]);

    const replaceToken = useCallback((nextToken: string) => {
        writeStoredToken(nextToken, rememberSession);
        setToken(nextToken);
    }, [rememberSession]);

    const value = useMemo<AuthContextValue>(
        () => ({ token, user, isLoading, login, signup, logout, refreshMe, replaceToken }),
        [token, user, isLoading, login, signup, logout, refreshMe, replaceToken]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
    return ctx;
}

export function useStripeConnect(token: string | null) {
    const [connect, setConnect] = useState<ConnectStatus | null>(null);
    const [connectBusy, setConnectBusy] = useState(false);

    const refreshConnectStatus = useCallback(
        async (silent = false): Promise<ConnectActionResult> => {
            if (!token) {
                setConnect(null);
                return { ok: false, error: "Not authenticated" };
            }
            try {
                const response = await apiGet<{ connect: ConnectStatus }>("/payments/connect/status", token);
                setConnect(response.connect ?? null);
                return { ok: true };
            } catch (error: unknown) {
                setConnect(null);
                return silent
                    ? { ok: false, error: "" }
                    : { ok: false, error: readErrorMessage(error, "Failed to load Stripe connect status") };
            }
        },
        [token]
    );

    const beginConnectOnboarding = useCallback(
        async (mode: "stripe" | "demo" = "stripe"): Promise<ConnectActionResult> => {
            if (!token) return { ok: false, error: "Not authenticated" };
            setConnectBusy(true);
            try {
                const response = await apiPost<{ url?: string; connect: ConnectStatus }>(
                    "/payments/connect/onboard",
                    { mode },
                    token
                );
                setConnect(response.connect ?? null);
                if (response.connect?.demo_bypass) {
                    return { ok: true, message: "Demo payout mode is enabled. Stripe onboarding is skipped." };
                }
                if (!response.url) {
                    return { ok: false, error: "Stripe onboarding link was missing." };
                }
                window.location.href = response.url;
                return { ok: true };
            } catch (error: unknown) {
                return { ok: false, error: readErrorMessage(error, "Unable to start Stripe onboarding") };
            } finally {
                setConnectBusy(false);
            }
        },
        [token]
    );

    const openConnectDashboard = useCallback(async (): Promise<ConnectActionResult> => {
        if (!token) return { ok: false, error: "Not authenticated" };
        setConnectBusy(true);
        try {
            const response = await apiPost<{ url: string; connect: ConnectStatus }>(
                "/payments/connect/dashboard-link",
                {},
                token
            );
            setConnect(response.connect ?? null);
            window.open(response.url, "_blank", "noopener,noreferrer");
            return { ok: true };
        } catch (error: unknown) {
            return { ok: false, error: readErrorMessage(error, "Unable to open Stripe dashboard") };
        } finally {
            setConnectBusy(false);
        }
    }, [token]);

    return {
        connect,
        connectBusy,
        refreshConnectStatus,
        beginConnectOnboarding,
        openConnectDashboard,
    };
}
