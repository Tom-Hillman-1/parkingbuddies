import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "./api";
import type { User } from "../types";

type AuthContextValue = {
    token: string | null;
    user: User | null;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, name: string, password: string) => Promise<void>;
    logout: () => void;
    refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "pb_token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    async function refreshMe() {
        if (!token) {
            setUser(null);
            return;
        }
        const r = await apiGet<{ user: User }>("/me", token);
        setUser(r.user);
    }

    useEffect(() => {
        (async () => {
            try {
                await refreshMe();
            } catch {
                // if token invalid, wipe it
                localStorage.removeItem(TOKEN_KEY);
                setToken(null);
                setUser(null);
            } finally {
                setIsLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!token) return;
        refreshMe().catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    useEffect(() => {
        if (!token) return;
        const onFocus = () => {
            refreshMe().catch(() => {});
        };
        const onVisibility = () => {
            if (document.visibilityState === "visible") {
                refreshMe().catch(() => {});
            }
        };
        const interval = window.setInterval(() => {
            refreshMe().catch(() => {});
        }, 30000);

        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            window.clearInterval(interval);
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibility);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    async function login(email: string, password: string) {
        const r = await apiPost<{ token: string }>("/auth/login", { email, password });
        localStorage.setItem(TOKEN_KEY, r.token);
        setToken(r.token);
        await refreshMe();
    }

    async function signup(email: string, name: string, password: string) {
        const r = await apiPost<{ token: string }>("/auth/signup", { email, name, password });
        localStorage.setItem(TOKEN_KEY, r.token);
        setToken(r.token);
        await refreshMe();
    }

    function logout() {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
    }

    const value = useMemo<AuthContextValue>(
        () => ({ token, user, isLoading, login, signup, logout, refreshMe }),
        [token, user, isLoading]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
    return ctx;
}
