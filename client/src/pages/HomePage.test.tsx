import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, type MockedFunction } from "vitest";
import HomePage from "./HomePage";
import { apiGet } from "../lib/api";

vi.mock("../components/SpotsMap", () => ({
    default: () => <div data-testid="spots-map" />,
}));

vi.mock("../lib/api", () => ({
    apiGet: vi.fn(),
}));

const baseSpot = {
    id: "spot-1",
    owner_user_id: "owner-1",
    title: "Alpha Garage",
    description: "Covered garage",
    mode: "rent" as const,
    price_gbp: 120,
    price_unit: "hour" as const,
    allow_points: false,
    points_cost: 0,
    address_text: "1 Test St",
    lat: 51.5,
    lng: -0.1,
    image_url: null,
    availability_start: null,
    availability_end: null,
    availability_json: { type: "24_7" as const },
    is_active: true,
    created_at: "2026-02-06T00:00:00Z",
    updated_at: "2026-02-06T00:00:00Z",
};

function renderHome() {
    return render(
        <MemoryRouter>
            <HomePage />
        </MemoryRouter>
    );
}

describe("HomePage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("shows listings even when price exceeds the old default max filter", async () => {
        (apiGet as MockedFunction<typeof apiGet>).mockResolvedValue({
            ok: true,
            parking_spots: [baseSpot],
        });

        renderHome();

        expect(await screen.findByText("Alpha Garage")).toBeInTheDocument();
        expect(screen.getByText("£120.00")).toBeInTheDocument();
    });

    it("filters listings by search text", async () => {
        (apiGet as MockedFunction<typeof apiGet>).mockResolvedValue({
            ok: true,
            parking_spots: [
                baseSpot,
                { ...baseSpot, id: "spot-2", title: "Beta Lot", address_text: "2 Test St" },
            ],
        });

        renderHome();
        await screen.findByText("Alpha Garage");
        await screen.findByText("Beta Lot");

        vi.useFakeTimers();
        const input = screen.getAllByPlaceholderText("Try: Upper Street, garage, cheap…")[0];
        await act(async () => {
            fireEvent.change(input, { target: { value: "beta" } });
            vi.advanceTimersByTime(300);
        });

        expect(screen.getByText("Beta Lot")).toBeInTheDocument();
        expect(screen.queryByText("Alpha Garage")).not.toBeInTheDocument();

        vi.useRealTimers();
    });
});
