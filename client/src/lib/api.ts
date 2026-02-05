const API_BASE = import.meta.env.VITE_API_URL as string;

type ApiOk<T> = { ok: true } & T;
async function parseJson(res: Response) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : {};
    } catch {
        return {};
    }
}

export async function apiGet<T>(path: string, token?: string): Promise<ApiOk<T>> {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    const data = await parseJson(res);

    if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
    }

    return data as ApiOk<T>;
}

export async function apiPost<T>(
    path: string,
    body: unknown,
    token?: string
): Promise<ApiOk<T>> {
    const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
    });

    const data = await parseJson(res);

    if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
    }

    return data as ApiOk<T>;
}

export async function apiPatch<T>(
    path: string,
    body?: unknown,
    token?: string
): Promise<ApiOk<T>> {
    const res = await fetch(`${API_BASE}${path}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = await parseJson(res);

    if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
    }

    return data as ApiOk<T>;
}
