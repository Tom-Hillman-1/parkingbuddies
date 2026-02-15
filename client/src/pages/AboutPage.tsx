import { useState } from "react";
import { Link } from "react-router-dom";

const HELP_EMAIL = "parkingbuddiesproject@gmail.com";

export default function AboutPage() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [topic, setTopic] = useState("General question");
    const [message, setMessage] = useState("");
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
            const res = await fetch(`https://formsubmit.co/ajax/${HELP_EMAIL}`, {
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
        <div className="container aboutPage">
            <section className="card aboutHero aboutPanel">
                <div className="aboutKicker">ABOUT THE PROJECT</div>
                <h1 className="aboutTitle">Built to help drivers book parking in minutes.</h1>
                <p className="aboutBody aboutLead">
                    ParkingBuddies was developed by Tom Hillman as a third-year BSc Computer Science dissertation project.
                    If you are here to book a space, this page gives the short version of how the platform works and why it exists.
                </p>
                <div className="aboutHeroActions">
                    <Link to="/" className="btn btn-primary">Browse spots</Link>
                    <Link to="/create-listing" className="btn btn-ghost">Create a listing</Link>
                </div>
            </section>

            <section className="aboutSectionGrid">
                <article className="card aboutPanel">
                    <div className="aboutKicker">FOR DRIVERS</div>
                    <h2 className="aboutCardTitle">How booking works</h2>
                    <p className="aboutCardCopy">
                        The flow is designed to be simple and quick:
                    </p>
                    <ol className="aboutStepList">
                        <li>Search by area and compare nearby options on map or list.</li>
                        <li>Check availability, price, and listing details before you decide.</li>
                        <li>Book directly, or bid if the space is in auction mode.</li>
                    </ol>
                </article>

                <article className="card aboutPanel">
                    <div className="aboutKicker">FOR OWNERS</div>
                    <h2 className="aboutCardTitle">How listings and auctions work</h2>
                    <p className="aboutCardCopy">
                        Owners publish spaces with clear availability and a pricing model. Listings can run as standard
                        booking or as auctions for higher-demand slots.
                    </p>
                    <ul className="aboutListStack">
                        <li>Standard listing: drivers reserve instantly.</li>
                        <li>Auction listing: drivers place bids in a timed window.</li>
                        <li>At close, the highest valid bid wins.</li>
                    </ul>
                </article>

                <article className="card aboutPanel aboutPanel--wide">
                    <div className="aboutKicker">HOW IT CAME TO BE</div>
                    <h2 className="aboutCardTitle">A dissertation project built around a real daily problem</h2>
                    <p className="aboutCardCopy">
                        Parking is a common source of wasted time and stress in urban areas. This project explores how a
                        focused full-stack platform can reduce that friction for everyday users.
                    </p>
                    <p className="aboutCardCopy">
                        The wider goal is community connection: drivers find reliable local spaces, and owners gain value
                        from spare capacity they already have.
                    </p>
                </article>
            </section>

            <section className="card aboutPanel aboutHelpCard">
                <div className="aboutKicker">CONTACT</div>
                <h2 className="aboutCardTitle">Questions about booking, listings, or auctions?</h2>
                <p className="aboutBody">
                    Send a message below. If the form fails, email directly at
                    <a href={`mailto:${HELP_EMAIL}`}> {HELP_EMAIL}</a>.
                </p>

                <form className="aboutHelpForm" onSubmit={submitHelp} noValidate>
                    <div className="aboutHelpRow">
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
                            className="input aboutHelpTextarea"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="Tell us what you need help with"
                            rows={6}
                            required
                        />
                    </label>

                    <div className="aboutHelpActions">
                        <button type="submit" className="btn btn-primary" disabled={sending}>
                            {sending ? "Sending..." : "Send message"}
                        </button>
                        <a className="btn btn-ghost" href={`mailto:${HELP_EMAIL}`}>Email directly</a>
                    </div>

                    {sent && <p className="aboutHelpNotice aboutHelpNotice--ok">Thanks, your message has been sent.</p>}
                    {error && <p className="aboutHelpNotice aboutHelpNotice--err">{error}</p>}
                </form>
            </section>
        </div>
    );
}
