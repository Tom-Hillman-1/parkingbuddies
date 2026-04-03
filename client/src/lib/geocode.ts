import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, readErrorMessage } from "./api";

export type GeocodeSuggestion = {
    display_name: string;
    lat: string;
    lon: string;
    kind?: "manual";
};

type ManualFallback = { lat: number; lng: number } | null;
type FetchAddressSuggestionsOptions = {
    query: string;
    token?: string | null;
    limit?: number;
    countrycodes?: string;
    viewbox?: string;
};
type UseAddressSuggestionsOptions = {
    query: string;
    token?: string | null;
    limit?: number;
    enabled?: boolean;
    countrycodes?: string;
    viewbox?: string;
    manualFallback?: ManualFallback;
    minLength?: number;
};

const DEFAULT_COUNTRYCODES = "gb";
const DEFAULT_VIEWBOX = "-0.5103,51.6919,0.3340,51.2868";

export function createManualGeocodeSuggestion(query: string, coords: { lat: number; lng: number }): GeocodeSuggestion {
    return {
        display_name: query,
        lat: coords.lat.toFixed(6),
        lon: coords.lng.toFixed(6),
        kind: "manual",
    };
}

export function parseGeocodeCoordinates(suggestion: GeocodeSuggestion) {
    const lat = Number(suggestion.lat);
    const lng = Number(suggestion.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
}

export async function fetchAddressSuggestions({
    query,
    token,
    limit = 8,
    countrycodes = DEFAULT_COUNTRYCODES,
    viewbox = DEFAULT_VIEWBOX,
}: FetchAddressSuggestionsOptions) {
    const params = new URLSearchParams({
        format: "jsonv2",
        limit: String(limit),
        addressdetails: "1",
        countrycodes,
        viewbox,
        q: query.trim(),
    });

    const lookup = await apiGet<{ suggestions: GeocodeSuggestion[] }>(
        `/parking-spots/geocode/search?${params.toString()}`,
        token ?? undefined
    );

    return (Array.isArray(lookup.suggestions) ? lookup.suggestions : [])
        .filter((suggestion) => Number.isFinite(Number(suggestion.lat)) && Number.isFinite(Number(suggestion.lon)))
        .slice(0, limit);
}

export function useAddressSuggestions({
    query,
    token,
    limit = 8,
    enabled = true,
    countrycodes = DEFAULT_COUNTRYCODES,
    viewbox = DEFAULT_VIEWBOX,
    manualFallback = null,
    minLength = 3,
}: UseAddressSuggestionsOptions) {
    const deferredQuery = useDeferredValue(query.trim());
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
    const requestRef = useRef(0);

    const fallback = useMemo(() => {
        if (!manualFallback) return null;
        if (!Number.isFinite(manualFallback.lat) || !Number.isFinite(manualFallback.lng)) return null;
        return { lat: manualFallback.lat, lng: manualFallback.lng };
    }, [manualFallback?.lat, manualFallback?.lng]);

    useEffect(() => {
        const nextQuery = deferredQuery;
        requestRef.current += 1;
        const requestId = requestRef.current;

        if (!enabled || !nextQuery || nextQuery.length < minLength) {
            setBusy(false);
            setMessage("");
            setSuggestions([]);
            return;
        }

        const timeout = window.setTimeout(async () => {
            setBusy(true);
            setMessage("");

            try {
                const matches = await fetchAddressSuggestions({
                    query: nextQuery,
                    token,
                    limit,
                    countrycodes,
                    viewbox,
                });
                if (requestRef.current !== requestId) return;

                if (matches.length > 0) {
                    setSuggestions(matches);
                    setMessage("");
                    return;
                }

                if (fallback) {
                    setSuggestions([createManualGeocodeSuggestion(nextQuery, fallback)]);
                    setMessage("");
                    return;
                }

                setSuggestions([]);
                setMessage("No matching addresses found.");
            } catch (error: unknown) {
                if (requestRef.current !== requestId) return;
                setSuggestions([]);
                setMessage(readErrorMessage(error, "Address search is unavailable right now."));
            } finally {
                if (requestRef.current === requestId) {
                    setBusy(false);
                }
            }
        }, 260);

        return () => {
            window.clearTimeout(timeout);
        };
    }, [countrycodes, deferredQuery, enabled, fallback, limit, minLength, token, viewbox]);

    function clear() {
        requestRef.current += 1;
        setBusy(false);
        setMessage("");
        setSuggestions([]);
    }

    return { busy, message, suggestions, clear };
}
