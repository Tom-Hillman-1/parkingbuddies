const API_BASE = import.meta.env.VITE_API_URL as string;

type ApiOk<T> = { ok: true } & T;
type ApiRequestOptions = {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    token?: string;
    body?: unknown;
    init?: RequestInit;
};

async function parseJson(res: Response) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : {};
    } catch {
        return {};
    }
}

export function readErrorMessage(error: unknown, fallback: string) {
    return error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : fallback;
}

async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiOk<T>> {
    const { method = "GET", token, body, init } = options;
    const headers = new Headers(init?.headers);
    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }
    if (body !== undefined) {
        headers.set("Content-Type", "application/json");
    }

    let res: Response;
    try {
        res = await fetch(`${API_BASE}${path}`, {
            ...init,
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : init?.body,
        });
    } catch {
        throw new Error(`Network error: API unavailable at ${API_BASE}`);
    }

    const data = await parseJson(res);

    if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
    }

    return data as ApiOk<T>;
}

export async function apiGet<T>(path: string, token?: string, init?: RequestInit): Promise<ApiOk<T>> {
    return apiRequest<T>(path, { token, init });
}

export async function apiPost<T>(
    path: string,
    body: unknown,
    token?: string
): Promise<ApiOk<T>> {
    return apiRequest<T>(path, { method: "POST", body, token });
}

export async function apiPatch<T>(
    path: string,
    body?: unknown,
    token?: string
): Promise<ApiOk<T>> {
    return apiRequest<T>(path, { method: "PATCH", body, token });
}

export async function apiDelete<T>(
    path: string,
    token?: string
): Promise<ApiOk<T>> {
    return apiRequest<T>(path, { method: "DELETE", token });
}
