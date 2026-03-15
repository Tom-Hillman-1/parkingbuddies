import { useEffect, useState } from "react";
import Lottie from "lottie-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import logoNameLongBlue from "./assets/logo_name_long_blue.png";
import NavBar from "./components/NavBar";

const appLoadingAnimationUrl = new URL("./assets/loading.json", import.meta.url).href;
const APP_BOOT_SPLASH_MS = 1500;

export default function App() {
    const [showLoader, setShowLoader] = useState(true);
    const [loadingAnimationData, setLoadingAnimationData] = useState<unknown | null>(null);
    const location = useLocation();

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

    useEffect(() => {
        if (showLoader) return;

        const root = document.querySelector(".app-main");
        if (!root) return;
        const seen = new WeakSet<HTMLElement>();

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    entry.target.classList.add("is-visible");
                    observer.unobserve(entry.target);
                }
            },
            { threshold: 0.03, rootMargin: "0px 0px 20% 0px" }
        );

        const registerTargets = () => {
            const candidates = Array.from(
                root.querySelectorAll<HTMLElement>(
                    ".home-hero, .pageHeader, .card, .spot-card, .dashboardNavBtn, .home-map"
                )
            ).filter((node) => !node.closest(".aboutPremium"));

            candidates.forEach((node) => {
                if (seen.has(node)) return;
                seen.add(node);
                node.classList.add("ui-reveal");
                observer.observe(node);
            });
        };

        registerTargets();
        const domObserver = new MutationObserver(registerTargets);
        domObserver.observe(root, { childList: true, subtree: true });

        return () => {
            domObserver.disconnect();
            observer.disconnect();
        };
    }, [location.pathname, location.search, showLoader]);

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
            <footer className="site-footer">
                <p className="site-footer-text">
                    ParkingBuddies project © {new Date().getFullYear()}. All rights reserved.{" "}
                    <Link to="/about#contact-bottom" className="site-footer-link">
                         Contact us.
                    </Link>
                </p>
            </footer>
        </div>
    );
}
