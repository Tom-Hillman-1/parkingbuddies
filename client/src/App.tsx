import { useEffect, useState } from "react";

export default function App() {
    const [message, setMessage] = useState<string>("Loading...");

    useEffect(() => {
        fetch(`${import.meta.env.VITE_API_URL}/health`)
            .then((r) => r.json())
            .then((data) => setMessage(data.message))
            .catch(() => setMessage("Failed to reach backend API"));
    }, []);

    return (
        <div style={{ padding: 24, fontFamily: "system-ui" }}>
            <h1>ParkingBuddies</h1>
            <p>{message}</p>
        </div>
    );
}