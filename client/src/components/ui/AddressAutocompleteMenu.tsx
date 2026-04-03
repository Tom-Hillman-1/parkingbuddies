import type { GeocodeSuggestion } from "../../lib/geocode";

type AddressAutocompleteMenuProps = {
    open: boolean;
    suggestions: GeocodeSuggestion[];
    busy?: boolean;
    message?: string;
    ariaLabel?: string;
    onSelect: (suggestion: GeocodeSuggestion) => void;
    className?: string;
};

export function AddressAutocompleteMenu({
    open,
    suggestions,
    busy = false,
    message = "",
    ariaLabel = "Address suggestions",
    onSelect,
    className = "",
}: AddressAutocompleteMenuProps) {
    if (!open) return null;

    return (
        <div className={`addressAutocompleteMenu ${className}`.trim()} role="listbox" aria-label={ariaLabel}>
            {busy ? (
                <div className="addressAutocompleteStatus">Searching...</div>
            ) : suggestions.length > 0 ? (
                suggestions.map((suggestion, index) => {
                    const label =
                        suggestion.kind === "manual"
                            ? `Use "${suggestion.display_name}"`
                            : suggestion.display_name;
                    return (
                        <button
                            key={`${suggestion.display_name}-${suggestion.lat}-${suggestion.lon}-${index}`}
                            type="button"
                            role="option"
                            className="addressAutocompleteOption"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onSelect(suggestion)}
                        >
                            <span className="addressAutocompletePrimary" title={label}>{label}</span>
                        </button>
                    );
                })
            ) : message ? (
                <div className="addressAutocompleteStatus">{message}</div>
            ) : null}
        </div>
    );
}
