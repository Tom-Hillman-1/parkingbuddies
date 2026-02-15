import { useEffect, useState } from "react";
import Lottie from "lottie-react";
import { Outlet } from "react-router-dom";
import logoNameLongBlue from "./assets/logo_name_long_blue.png";
import NavBar from "./components/NavBar";

const appLoadingAnimationUrl = new URL("./assets/loading.json", import.meta.url).href;
const APP_BOOT_SPLASH_MS = 1500;

export default function App() {
    const [showLoader, setShowLoader] = useState(true);
    const [loadingAnimationData, setLoadingAnimationData] = useState<unknown | null>(null);

    useEffect(() => {
        let active = true;
        const timer = window.setTimeout(() => {
            if (active) setShowLoader(false);
        }, APP_BOOT_SPLASH_MS);

        fetch(appLoadingAnimationUrl)
            .then((response) => {
                if (!response.ok) throw new Error("Loading animation file failed to load.");
                return response.json();
            })
            .then((json) => {
                if (active) setLoadingAnimationData(json);
            })
            .catch(() => {
                if (active) setLoadingAnimationData(null);
            });

        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, []);

    if (showLoader) {
        return (
            <div className="app-loader" role="status" aria-live="polite" aria-label="Loading ParkingBuddies">
                <div className="app-loader-card">
                    {loadingAnimationData ? (
                        <Lottie
                            className="app-loader-animation"
                            animationData={loadingAnimationData}
                            loop
                            autoplay
                            aria-hidden="true"
                        />
                    ) : (
                        <div className="app-loader-animation app-loader-animation--fallback" aria-hidden="true" />
                    )}
                    <img className="app-loader-logo" src={logoNameLongBlue} alt="ParkingBuddies" />
                </div>
            </div>
        );
    }

    return (
        <div className="app-shell">
            <NavBar />
            <main className="app-main">
                <Outlet />
            </main>
        </div>
    );
}
