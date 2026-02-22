import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SUPPORT_EMAIL } from "./pagesShared";

type ShowcaseCard = {
    id: string;
    title: string;
    description: string;
    toneClass: string;
    art: "map" | "approval" | "pricing" | "availability" | "support";
};

const SHOWCASE_CARDS: ShowcaseCard[] = [
    {
        id: "drivers",
        title: "Find spots in seconds",
        description: "Search nearby listings, compare details quickly, and reserve a slot with less back-and-forth.",
        toneClass: "aboutShowcaseCard--blue",
        art: "map",
    },
    {
        id: "owners",
        title: "Approve offers your way",
        description: "Owners review incoming bids per time slot and accept only the offers that fit availability.",
        toneClass: "aboutShowcaseCard--lavender",
        art: "approval",
    },
    {
        id: "pricing",
        title: "Flexible pricing models",
        description: "Set fixed hourly, daily, or weekly pricing, start auctions from your minimum offer, and optionally allow point payments.",
        toneClass: "aboutShowcaseCard--mint",
        art: "pricing",
    },
    {
        id: "availability",
        title: "Flexible availability windows",
        description: "Choose exactly when your listing is active and when drivers can book, from 24/7 to fully custom day and time ranges.",
        toneClass: "aboutShowcaseCard--blue",
        art: "availability",
    },
    {
        id: "support",
        title: "Honest point system model",
        description: "Owners can book spots by using points earned from listings with enabled point payment.",
        toneClass: "aboutShowcaseCard--cream",
        art: "support",
    },
];

function ShowcaseCornerIcon({ kind }: { kind: ShowcaseCard["art"] }) {
    if (kind === "map") {
        return (
            <svg viewBox="0 0 24 24" className="aboutShowcaseArrowIcon" aria-hidden="true">
                <path d="M12 21s6.5-4.1 6.5-9.8a6.5 6.5 0 1 0-13 0c0 5.7 6.5 9.8 6.5 9.8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="11.2" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
        );
    }
    if (kind === "approval") {
        return (
            <svg viewBox="0 0 24 24" className="aboutShowcaseArrowIcon" aria-hidden="true">
                <circle cx="12" cy="12" r="8.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="m8.9 12 2.1 2.2 4.3-4.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    if (kind === "pricing") {
        return (
            <svg viewBox="0 0 24 24" className="aboutShowcaseArrowIcon" aria-hidden="true">
                <path d="M7.2 16.7V10m4.8 6.7V7.6m4.8 9.1v-4.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M5.6 18.7h12.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
        );
    }
    if (kind === "availability") {
        return (
            <svg viewBox="0 0 24 24" className="aboutShowcaseArrowIcon" aria-hidden="true">
                <rect x="4.2" y="6" width="15.6" height="13.2" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M8 4.8v2.6M16 4.8v2.6M4.2 9.4h15.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
        );
    }
    return (
        <svg viewBox="0 0 24 24" className="aboutShowcaseArrowIcon" aria-hidden="true">
            <circle cx="12" cy="12" r="8.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="12" cy="12" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 7.2v1.4M16.1 9l-1 1M17.8 12h-1.4M16.1 15l-1-1M12 16.8v-1.4M7.9 15l1-1M6.2 12h1.4M7.9 9l1 1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    );
}

function ShowcaseIllustration({ kind }: { kind: ShowcaseCard["art"] }) {
    if (kind === "map") {
        return (
            <svg viewBox="0 0 260 130" className="aboutShowcaseArt" aria-hidden="true">
                <rect x="8" y="14" width="244" height="106" rx="18" fill="rgba(255,255,255,0.64)" />
                <path d="M26 94c22-24 48-38 78-42 26-3 51 3 77 18 20 11 37 14 54 10" stroke="rgba(50,84,128,0.34)" strokeWidth="6" fill="none" strokeLinecap="round" />
                <circle cx="124" cy="58" r="13" fill="rgba(46,122,214,0.82)" />
                <circle cx="124" cy="58" r="5" fill="#fff" />
            </svg>
        );
    }
    if (kind === "approval") {
        return (
            <svg viewBox="0 0 260 130" className="aboutShowcaseArt" aria-hidden="true">
                <rect x="20" y="18" width="146" height="86" rx="16" fill="rgba(255,255,255,0.6)" />
                <rect x="36" y="34" width="114" height="14" rx="7" fill="rgba(71,84,126,0.24)" />
                <rect x="36" y="56" width="86" height="12" rx="6" fill="rgba(71,84,126,0.2)" />
                <circle cx="196" cy="66" r="30" fill="rgba(109,173,145,0.74)" />
                <path d="m182 66 10 10 18-18" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    if (kind === "pricing") {
        return (
            <svg viewBox="0 0 260 130" className="aboutShowcaseArt" aria-hidden="true">
                <rect x="14" y="16" width="232" height="100" rx="18" fill="rgba(255,255,255,0.6)" />
                <rect x="34" y="76" width="34" height="24" rx="8" fill="rgba(72,125,110,0.66)" />
                <rect x="76" y="62" width="34" height="38" rx="8" fill="rgba(72,125,110,0.54)" />
                <rect x="118" y="48" width="34" height="52" rx="8" fill="rgba(72,125,110,0.44)" />
                <circle cx="192" cy="54" r="22" fill="rgba(255,255,255,0.86)" />
                <text x="192" y="60" textAnchor="middle" fontSize="17" fontWeight="700" fill="rgba(54,88,76,0.78)">&#163;</text>
                <circle cx="220" cy="82" r="16" fill="rgba(255,255,255,0.82)" />
                <text x="220" y="87" textAnchor="middle" fontSize="13" fontWeight="700" fill="rgba(54,88,76,0.76)">pts</text>
            </svg>
        );
    }
    if (kind === "availability") {
        return (
            <svg viewBox="0 0 260 130" className="aboutShowcaseArt" aria-hidden="true">
                <rect x="16" y="16" width="228" height="98" rx="16" fill="rgba(255,255,255,0.62)" />
                <rect x="32" y="30" width="108" height="16" rx="8" fill="rgba(42,92,156,0.2)" />
                <rect x="32" y="56" width="86" height="12" rx="6" fill="rgba(42,92,156,0.18)" />
                <rect x="32" y="74" width="126" height="12" rx="6" fill="rgba(42,92,156,0.16)" />
                <rect x="170" y="36" width="56" height="56" rx="12" fill="rgba(255,255,255,0.82)" />
                <rect x="178" y="48" width="40" height="30" rx="8" fill="rgba(67,131,205,0.24)" />
                <path d="m184 64 8 8 14-14" stroke="rgba(35,96,168,0.86)" strokeWidth="4.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    if (kind === "support") {
        return (
            <svg viewBox="0 0 260 130" className="aboutShowcaseArt" aria-hidden="true">
                <rect x="16" y="14" width="228" height="102" rx="18" fill="rgba(255,255,255,0.62)" />
                <circle cx="88" cy="74" r="24" fill="rgba(194,166,97,0.42)" />
                <circle cx="130" cy="64" r="28" fill="rgba(184,153,82,0.5)" />
                <circle cx="174" cy="74" r="24" fill="rgba(194,166,97,0.42)" />
                <circle cx="130" cy="64" r="19" fill="rgba(255,255,255,0.82)" />
                <text x="130" y="69" textAnchor="middle" fontSize="14" fontWeight="800" fill="rgba(114,88,35,0.78)">PTS</text>
                <rect x="54" y="32" width="152" height="12" rx="6" fill="rgba(122,98,43,0.18)" />
            </svg>
        );
    }
    return (
        <svg viewBox="0 0 260 130" className="aboutShowcaseArt" aria-hidden="true">
            <rect x="16" y="14" width="228" height="102" rx="18" fill="rgba(255,255,255,0.62)" />
            <path d="M64 88c0-21 14-34 34-34 11 0 18 4 26 12 8-8 15-12 26-12 20 0 34 13 34 34" stroke="rgba(122,98,43,0.52)" strokeWidth="6" fill="none" strokeLinecap="round" />
            <circle cx="96" cy="60" r="8" fill="rgba(122,98,43,0.44)" />
            <circle cx="164" cy="60" r="8" fill="rgba(122,98,43,0.44)" />
        </svg>
    );
}

export default function AboutPage() {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const railRef = useRef<HTMLDivElement | null>(null);
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [topic, setTopic] = useState("General question");
    const [message, setMessage] = useState("");
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        root.classList.add("about--reveal-ready");
        const nodes = Array.from(root.querySelectorAll<HTMLElement>(".aboutReveal"));
        if (!nodes.length) return;

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    entry.target.classList.add("is-visible");
                    observer.unobserve(entry.target);
                }
            },
            { threshold: 0.05, rootMargin: "0px 0px 16% 0px" }
        );

        nodes.forEach((node) => observer.observe(node));
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const rail = railRef.current;
        if (!rail) return;
        const railEl = rail;

        let dragging = false;
        let startX = 0;
        let startScroll = 0;

        function onPointerDown(event: PointerEvent) {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            dragging = true;
            startX = event.clientX;
            startScroll = railEl.scrollLeft;
            railEl.classList.add("is-dragging");
            railEl.setPointerCapture(event.pointerId);
        }

        function onPointerMove(event: PointerEvent) {
            if (!dragging) return;
            railEl.scrollLeft = startScroll - (event.clientX - startX);
        }

        function stopDrag(event: PointerEvent) {
            if (!dragging) return;
            dragging = false;
            railEl.classList.remove("is-dragging");
            if (railEl.hasPointerCapture(event.pointerId)) {
                railEl.releasePointerCapture(event.pointerId);
            }
        }

        railEl.addEventListener("pointerdown", onPointerDown);
        railEl.addEventListener("pointermove", onPointerMove);
        railEl.addEventListener("pointerup", stopDrag);
        railEl.addEventListener("pointercancel", stopDrag);
        railEl.addEventListener("lostpointercapture", () => {
            dragging = false;
            railEl.classList.remove("is-dragging");
        });

        return () => {
            railEl.removeEventListener("pointerdown", onPointerDown);
            railEl.removeEventListener("pointermove", onPointerMove);
            railEl.removeEventListener("pointerup", stopDrag);
            railEl.removeEventListener("pointercancel", stopDrag);
        };
    }, []);

    async function submitHelp(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setSending(true);
        setSent(false);
        setError(null);

        const formData = new FormData();
        formData.append("name", name.trim());
        formData.append("email", email.trim());
        formData.append("topic", topic);
        formData.append("message", message.trim());
        formData.append("_subject", `ParkingBuddies help request: ${topic}`);
        formData.append("_captcha", "false");
        formData.append("_template", "table");

        try {
            const res = await fetch(`https://formsubmit.co/ajax/${SUPPORT_EMAIL}`, {
                method: "POST",
                headers: { Accept: "application/json" },
                body: formData,
            });

            if (!res.ok) throw new Error("Could not send your message right now.");

            setSent(true);
            setName("");
            setEmail("");
            setTopic("General question");
            setMessage("");
        } catch {
            setError("Message failed to send. Please try again or use direct email.");
        } finally {
            setSending(false);
        }
    }

    return (
        <div ref={rootRef} className="container aboutPremium">
            <header className="aboutPremiumHero aboutReveal">
                <p className="aboutPremiumKicker">About ParkingBuddies</p>
                <h1 className="aboutPremiumTitle">Project set to solve real world parking problems</h1>
                <p className="aboutPremiumSub">
                    Built as a final-year BSc Computer Science project, ParkingBuddies helps drivers book faster
                    and gives owners clear control over approvals, pricing, and availability.
                </p>
                <div className="aboutPremiumActions">
                    <Link to="/" className="aboutPremiumBtn aboutPremiumBtn--primary">Browse spots</Link>
                    <Link to="/create-listing" className="aboutPremiumBtn aboutPremiumBtn--secondary">Create listing</Link>
                </div>
            </header>

            <div className="aboutPremiumDivider" aria-hidden="true" />

            <section className="aboutPremiumShowcase aboutReveal" aria-labelledby="about-showcase-title">
                <div className="aboutPremiumHead">
                    <p className="aboutPremiumLabel">Platform highlights</p>
                    <h2 id="about-showcase-title" className="aboutPremiumHeadTitle">
                        The people's platform
                    </h2>
                    <p className="aboutPremiumHeadCopy">
                        ParkingBuddies was built so that drivers and owners have total control
                    </p>
                </div>

                <div ref={railRef} className="aboutShowcaseRail" role="list" aria-label="ParkingBuddies feature cards">
                    {SHOWCASE_CARDS.map((card) => (
                        <article key={card.id} className={`aboutShowcaseCard ${card.toneClass}`} role="listitem">
                            <span className="aboutShowcaseArrow">
                                <ShowcaseCornerIcon kind={card.art} />
                            </span>
                            <h3 className="aboutShowcaseTitle">{card.title}</h3>
                            <p className="aboutShowcaseCopy">{card.description}</p>
                            <div className="aboutShowcaseArtWrap">
                                <ShowcaseIllustration kind={card.art} />
                            </div>
                        </article>
                    ))}
                </div>
            </section>

            <div className="aboutPremiumDivider" aria-hidden="true" />

            <section className="aboutPremiumInfoGrid aboutReveal" aria-labelledby="about-info-title">
                <article className="aboutPremiumInfoCard">
                    <p className="aboutPremiumLabel">How booking works</p>
                    <h2 id="about-info-title" className="aboutPremiumInfoTitle">Simple flow for drivers</h2>
                    <ol className="aboutPremiumSteps">
                        <li>Search by area and compare nearby listings on map or list.</li>
                        <li>Pick a slot, review availability, and check payment options.</li>
                        <li>Book instantly or submit an offer in auction mode.</li>
                    </ol>
                </article>

                <article className="aboutPremiumInfoCard">
                    <p className="aboutPremiumLabel">How owner approvals work</p>
                    <h2 className="aboutPremiumInfoTitle">Control stays with the owner</h2>
                    <ul className="aboutPremiumBullets">
                        <li>Rent listings can be reserved directly when slots are available.</li>
                        <li>Auction listings accept offers that owners review manually.</li>
                        <li>Approvals are capped by slot overlap and listing capacity.</li>
                    </ul>
                </article>
            </section>

            <section id="contact-us" className="aboutPremiumContact aboutReveal">
                <div className="aboutPremiumContactHead">
                    <p className="aboutPremiumLabel">Contact support</p>
                    <h2 className="aboutPremiumInfoTitle">Need help with booking or listings?</h2>
                    <p className="aboutPremiumHeadCopy">
                        Send a message below. If needed, email us directly at{" "}
                        <a href={`mailto:${SUPPORT_EMAIL}`} className="aboutPremiumInlineLink">{SUPPORT_EMAIL}</a>.
                    </p>
                </div>

                <form className="aboutPremiumForm" onSubmit={submitHelp} noValidate>
                    <div className="aboutPremiumFormRow">
                        <label className="field">
                            <span>Full name</span>
                            <input
                                className="input"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Your name"
                                required
                            />
                        </label>

                        <label className="field">
                            <span>Email</span>
                            <input
                                className="input"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@example.com"
                                required
                            />
                        </label>
                    </div>

                    <label className="field">
                        <span>Topic</span>
                        <select className="input" value={topic} onChange={(e) => setTopic(e.target.value)}>
                            <option>General question</option>
                            <option>Booking support</option>
                            <option>Listing support</option>
                            <option>Account issue</option>
                            <option>Payments and rewards</option>
                        </select>
                    </label>

                    <label className="field">
                        <span>Message</span>
                        <textarea
                            className="input aboutPremiumTextarea"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="Tell us what you need help with"
                            rows={6}
                            required
                        />
                    </label>

                    <div className="aboutPremiumFormActions">
                        <button type="submit" className="aboutPremiumBtn aboutPremiumBtn--primary" disabled={sending}>
                            {sending ? "Sending..." : "Send message"}
                        </button>
                        <a className="aboutPremiumBtn aboutPremiumBtn--secondary" href={`mailto:${SUPPORT_EMAIL}`}>
                            Email directly
                        </a>
                    </div>

                    {sent && <p className="aboutPremiumNotice aboutPremiumNotice--ok">Thanks, your message has been sent.</p>}
                    {error && <p className="aboutPremiumNotice aboutPremiumNotice--err">{error}</p>}
                </form>
            </section>
        </div>
    );
}
