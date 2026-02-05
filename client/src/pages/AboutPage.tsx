import { Link } from "react-router-dom";

export default function AboutPage() {
    return (
        <div className="container">
            <div className="pageHeader">
                <div className="heroKicker">ABOUT</div>
                <div className="heroTitle">What is ParkingBuddies?</div>
                <div className="heroSub muted">
                    A community-driven platform for finding, sharing, and renting parking spaces — built to make city
                    parking simpler, fairer, and more efficient.
                </div>
            </div>

            <div className="aboutGrid">
                <div className="card aboutCard aboutCard--mint">
                    <div className="aboutKicker">THE IDEA</div>
                    <div className="aboutTitle">Parking, without the stress</div>
                    <div className="aboutBody">
                        ParkingBuddies connects drivers with owners who have under‑used parking spaces. Instead of relying
                        only on large commercial car parks, the platform unlocks local, community‑shared options that are
                        often cheaper and closer to your destination.
                    </div>
                    <div className="aboutFoot">Fewer loops. Less congestion. More options.</div>
                </div>

                <div className="card aboutCard aboutCard--sun">
                    <div className="aboutKicker">HOW IT WORKS</div>
                    <div className="aboutTitle">Three roles, one platform</div>
                    <div className="aboutBody">
                        Drivers search by location, price, and time. Owners list private or public spaces with availability.
                        For high‑demand spots, auctions let drivers bid fairly for a slot.
                    </div>
                    <div className="aboutList">
                        <span className="badge badge--accent">Drivers</span>
                        <span className="badge badge--cool">Owners</span>
                        <span className="badge badge--warm">Auctions</span>
                    </div>
                </div>
            </div>

            <div className="aboutGrid" style={{ marginTop: 14 }}>
                <div className="card aboutCard aboutCard--sky">
                    <div className="aboutKicker">WHAT YOU CAN DO</div>
                    <div className="aboutTitle">Plan, book, track</div>
                    <div className="aboutBody">
                        Browse live listings, book in minutes, pay with money or points, and monitor everything from your dashboard.
                        Settings keeps your profile and password up to date.
                    </div>
                    <div className="aboutList">
                        <span className="badge">Map + list views</span>
                        <span className="badge">Rewards & points</span>
                        <span className="badge">Booking history</span>
                    </div>
                </div>

                <div className="card aboutCard aboutCard--rose">
                    <div className="aboutKicker">TRUST & CLARITY</div>
                    <div className="aboutTitle">Transparent by design</div>
                    <div className="aboutBody">
                        Listings show availability windows, pricing, and photos. Owners confirm bookings or bids so both
                        sides stay in control, and drivers always know the time slot they’ve secured.
                    </div>
                    <div className="aboutFoot">Clear listings. Clear outcomes.</div>
                </div>
            </div>

            <div className="card aboutCard aboutCard--nav" style={{ marginTop: 14 }}>
                <div className="aboutKicker">NAVIGATION</div>
                <div className="aboutTitle">Quick guide</div>
                <div className="aboutBody">
                    Home is where you search and compare. Dashboard is where you manage bookings, listings, and rewards.
                    Settings lets you update profile details and password.
                </div>
                <div className="rowInline" style={{ marginTop: 10 }}>
                    <Link to="/" className="btn btn-primary">Browse spots</Link>
                    <Link to="/create-listing" className="btn">Create a listing</Link>
                </div>
            </div>
        </div>
    );
}
