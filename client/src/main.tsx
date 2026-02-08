import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import CreateListingPage from "./pages/CreateListingPage";
import "leaflet/dist/leaflet.css";
import PayBookingPage from "./pages/PayBookingPage";
import SettingsPage from "./pages/SettingsPage";
import App from "./App";
import { AuthProvider } from "./lib/auth";

import HomePage from "./pages/HomePage";
import SpotDetailsPage from "./pages/SpotDetailsPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import DashboardPage from "./pages/DashboardPage";
import AboutPage from "./pages/AboutPage";
import BidReceiptPage from "./pages/BidReceiptPage";
import BidConfirmPage from "./pages/BidConfirmPage";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    <Route element={<App />}>
                        <Route path="/" element={<HomePage />} />
                        <Route path="/spots/:id" element={<SpotDetailsPage />} />
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/signup" element={<SignupPage />} />
                        <Route path="/dashboard" element={<DashboardPage />} />
                        <Route path="/about" element={<AboutPage />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                        <Route path="/create-listing" element={<CreateListingPage />} />
                        <Route path="/pay/:bookingId" element={<PayBookingPage />} />
                        <Route path="/bids/:bidId" element={<BidReceiptPage />} />
                        <Route path="/bids/confirm" element={<BidConfirmPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </AuthProvider>
    </React.StrictMode>
);
