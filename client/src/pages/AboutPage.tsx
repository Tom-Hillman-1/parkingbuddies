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

type FaqItem = {
    id: string;
    question: string;
    answer: string;
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
        description: "Set fixed hourly, daily, or weekly pricing, then let ParkingBuddies mirror that rate into points using the shared exchange model.",
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
        title: "Rewards you can actually understand",
        description: "Points come from clear actions like signup, profile completion, first published listings, and successful paid bookings, all tied to one shared rate.",
        toneClass: "aboutShowcaseCard--cream",
        art: "support",
    },
];

const FAQ_ITEMS: FaqItem[] = [
    {
        id: "faq-search",
        question: "How do I find a parking space quickly?",
        answer: "Use the home search to narrow listings by area, date, time, price, or listing type, then compare the best matches on the map or in the list view.",
    },
    {
        id: "faq-slot",
        question: "How do I choose the exact time I want to park?",
        answer: "Open a listing, pick your start date and end date on the calendar, then choose the exact start and end times that match your stay.",
    },
    {
        id: "faq-rent-auction",
        question: "What is the difference between rent and auction listings?",
        answer: "Rent listings can be booked directly when the slot is available. Auction listings work as offers that the owner reviews and accepts manually.",
    },
    {
        id: "faq-payment-choice",
        question: "Can I choose between card and points?",
        answer: "Yes, when a listing allows points you can choose either card or points during booking. If points are not enabled for that listing, card remains the payment option.",
    },
    {
        id: "faq-owner-start",
        question: "How do I create a listing as an owner?",
        answer: "Go to Create listing, then add a clear title, location, pricing model, availability window, and image so drivers can understand the space quickly.",
    },
    {
        id: "faq-owner-model",
        question: "How do owners control bookings and bids?",
        answer: "Owners decide whether a listing uses direct rent bookings or manual auction approvals, and they can manage incoming activity from the dashboard.",
    },
    {
        id: "faq-overlap",
        question: "How does the platform prevent double-booking?",
        answer: "Availability windows, overlap checks, and listing capacity rules work together to stop bookings or approvals that clash with an already occupied slot.",
    },
    {
        id: "faq-points-rate",
        question: "What is the value of a point?",
        answer: "ParkingBuddies uses one shared rate of 10 points = GBP 1, so the points system stays easier to understand across the whole platform.",
    },
    {
        id: "faq-earn-points",
        question: "How do drivers and owners earn points?",
        answer: "Drivers earn points from signup and successful paid bookings, while owners earn host bonuses when they complete paid stays through the platform.",
    },
    {
        id: "faq-auction-hold",
        question: "When do money or points actually leave the account in auctions?",
        answer: "They do not settle immediately. Money stays as authorization only, and points remain in the balance, until the owner accepts the auction bid.",
    },
    {
        id: "faq-signup-reward",
        question: "How many points do I get for signing up?",
        answer: "New users receive 25 points when they create an account, giving them a starting balance they can build on through platform activity.",
    },
    {
        id: "faq-profile-bonus",
        question: "Do I get a reward for completing my profile?",
        answer: "Yes. The first time you complete and save your profile settings, ParkingBuddies adds a 10 point profile-completion bonus.",
    },
    {
        id: "faq-first-listings",
        question: "Do owners earn points for publishing listings?",
        answer: "Yes. Owners receive 15 points for each of their first 3 published listings, which rewards early activity without making the system too open-ended.",
    },
    {
        id: "faq-cashback-bonus",
        question: "What do cashback and host bonus actually mean?",
        answer: "On successful paid bookings, drivers earn points back as cashback and owners earn a smaller host bonus, so both sides benefit when a money booking is completed.",
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

            <section className="aboutPremiumJourney aboutReveal" aria-labelledby="about-journey-title">
                <div className="aboutJourneyStack">
                    <article className="aboutJourneyIntroTab">
                        <p className="aboutPremiumLabel">How the platform works</p>
                        <h2 id="about-journey-title" className="aboutJourneyIntroTitle">Built for both sides of the parking journey</h2>
                        <p className="aboutJourneyIntroCopy">
                            ParkingBuddies keeps the experience simple for drivers without taking control away from owners. Search, timing, booking,
                            bidding, approvals, and rewards all sit inside one shared flow that feels easier to follow.
                        </p>

                        <div className="aboutJourneyIntroChips">
                            <span className="aboutJourneyChip">Search smarter</span>
                            <span className="aboutJourneyChip">Choose exact timing</span>
                            <span className="aboutJourneyChip">Book or bid</span>
                            <span className="aboutJourneyChip">Shared points model</span>
                        </div>
                    </article>

                    <div className="aboutJourneyRoleGrid">
                        <article className="aboutJourneyRoleCard aboutJourneyRoleCard--driver">
                            <span className="aboutJourneyRoleBadge">For drivers</span>
                            <h3 className="aboutJourneyRoleTitle">Choose your parking space based on what's right for you</h3>
                            <ul className="aboutJourneyRoleList">
                                <li>
                                    <strong>Search faster</strong>
                                    Filter by area, date, time, price, or listing type to narrow the best options quickly.
                                </li>
                                <li>
                                    <strong>Pick exact timing</strong>
                                    Choose a start and end date, then set the exact times that match the stay you need.
                                </li>
                                <li>
                                    <strong>Book or bid</strong>
                                    Reserve instantly on rent listings, or place an offer when the space is listed as an auction.
                                </li>
                            </ul>
                        </article>

                        <article className="aboutJourneyRoleCard aboutJourneyRoleCard--owner">
                            <span className="aboutJourneyRoleBadge">For owners</span>
                            <h3 className="aboutJourneyRoleTitle">Stay in control of bookings, bids, and availability</h3>
                            <ul className="aboutJourneyRoleList">
                                <li>
                                    <strong>Choose the model</strong>
                                    Use rent mode for instant reservations or auction mode when offers should be reviewed first.
                                </li>
                                <li>
                                    <strong>Protect each slot</strong>
                                    Capacity and overlap checks help prevent double-booking across the same time window.
                                </li>
                                <li>
                                    <strong>Approve with confidence</strong>
                                    Money bids stay as authorization only, and points stay in the user balance, until acceptance.
                                </li>
                            </ul>
                        </article>
                    </div>

                    <article className="aboutJourneyPointsCard">
                        <div className="aboutJourneyPointsHead">
                            <span className="aboutJourneyRoleBadge">Points system</span>
                            <h3 className="aboutJourneyRoleTitle">One shared rewards model across the whole platform</h3>
                            <p className="aboutJourneyPointsCopy">
                                ParkingBuddies uses a regulated exchange model so point pricing stays easier to understand for both drivers and owners.
                            </p>
                        </div>

                        <div className="aboutJourneyPointsGrid">
                            <div className="aboutJourneyPointsStat">
                                <span className="aboutJourneyPointsValue">Shared rate</span>
                                <span className="aboutJourneyPointsLabel">ParkingBuddies keeps point value clear with one simple rate of 10 pts = GBP 1.</span>
                            </div>
                            <div className="aboutJourneyPointsStat">
                                <span className="aboutJourneyPointsValue">Signup reward</span>
                                <span className="aboutJourneyPointsLabel">New users receive 25 pts when they create an account.</span>
                            </div>
                            <div className="aboutJourneyPointsStat">
                                <span className="aboutJourneyPointsValue">Profile bonus</span>
                                <span className="aboutJourneyPointsLabel">Users earn 10 pts the first time they save a completed profile.</span>
                            </div>
                            <div className="aboutJourneyPointsStat">
                                <span className="aboutJourneyPointsValue">First 3 listings</span>
                                <span className="aboutJourneyPointsLabel">Owners receive 15 pts for each of their first 3 published listings.</span>
                            </div>
                            <div className="aboutJourneyPointsStat">
                                <span className="aboutJourneyPointsValue">Cashback on bookings</span>
                                <span className="aboutJourneyPointsLabel">Drivers earn points back on successful paid bookings.</span>
                            </div>
                            <div className="aboutJourneyPointsStat">
                                <span className="aboutJourneyPointsValue">Host bonus</span>
                                <span className="aboutJourneyPointsLabel">Owners earn reward points when they complete paid stays.</span>
                            </div>
                            <div className="aboutJourneyPointsStat">
                                <span className="aboutJourneyPointsValue">Fixed point pricing</span>
                                <span className="aboutJourneyPointsLabel">Point prices stay tied to the shared rate so costs remain easier to understand.</span>
                            </div>
                            <div className="aboutJourneyPointsStat">
                                <span className="aboutJourneyPointsValue">Held until accepted</span>
                                <span className="aboutJourneyPointsLabel">Auction bids do not settle until the owner accepts the booking offer.</span>
                            </div>
                        </div>
                    </article>
                </div>
            </section>

            <section className="aboutPremiumGuides aboutReveal" aria-labelledby="about-guides-title">
                <div className="aboutPremiumHead">
                    <p className="aboutPremiumLabel">Using the platform</p>
                    <h2 id="about-guides-title" className="aboutPremiumHeadTitle">Frequently asked questions</h2>
                    <p className="aboutPremiumHeadCopy">
                        The key things drivers and owners usually need to know, explained in one place.
                    </p>
                </div>

                <div className="aboutFaqList">
                    {FAQ_ITEMS.map((item) => (
                        <details key={item.id} className="aboutFaqItem">
                            <summary className="aboutFaqSummary">
                                <span className="aboutFaqGrip" aria-hidden="true">
                                    <span />
                                    <span />
                                    <span />
                                </span>
                                <span className="aboutFaqQuestion">{item.question}</span>
                                <span className="aboutFaqChevron" aria-hidden="true">+</span>
                            </summary>
                            <div className="aboutFaqAnswer">
                                <p>{item.answer}</p>
                            </div>
                        </details>
                    ))}
                </div>
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
            <div id="contact-bottom" aria-hidden="true" />
        </div>
    );
}
