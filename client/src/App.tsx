import { useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import NavBar from "./components/NavBar";

export default function App() {
    const location = useLocation();

    useEffect(() => {
        if ("scrollRestoration" in window.history) {
            const previous = window.history.scrollRestoration;
            window.history.scrollRestoration = "manual";

            return () => {
                window.history.scrollRestoration = previous;
            };
        }

        return undefined;
    }, []);

    useEffect(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }, [location.pathname, location.search]);

    useEffect(() => {
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
    }, [location.pathname, location.search]);

    return (
        <div className="app-shell">
            <NavBar />
            <main className="app-main">
                <Outlet />
            </main>
            <footer className="site-footer">
                <p className="site-footer-text">
                    ParkingBuddies project {String.fromCharCode(169)} {new Date().getFullYear()}. All rights reserved.{" "}
                    <Link to="/about#contact-bottom" className="site-footer-link">
                        Contact us.
                    </Link>
                </p>
            </footer>
        </div>
    );
}
