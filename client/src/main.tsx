import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import "leaflet/dist/leaflet.css";
import "react-day-picker/style.css";
import "timepicker-ui/index.css";
import App from "./App";
import { AuthProvider } from "./lib/auth";
const HomePage = lazy(() => import("./pages/HomePage"));
const SpotDetailsPage = lazy(() => import("./pages/SpotDetailsPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const SignupPage = lazy(() => import("./pages/SignupPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const CreateListingPage = lazy(() => import("./pages/CreateListingPage"));
const PayBookingPage = lazy(() => import("./pages/PayBookingPage"));
const BookingConfirmPage = lazy(() => import("./pages/BookingConfirmPage"));
const BidReceiptPage = lazy(() => import("./pages/BidReceiptPage"));
const BidConfirmPage = lazy(() => import("./pages/BidConfirmPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

const queryClient = new QueryClient();
ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                <BrowserRouter>
                    <Suspense fallback={null}>
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
                                <Route path="/bookings/confirm" element={<BookingConfirmPage />} />
                                <Route path="/bids/:bidId" element={<BidReceiptPage />} />
                                <Route path="/bids/confirm" element={<BidConfirmPage />} />
                                <Route path="/settings" element={<SettingsPage />} />
                            </Route>
                        </Routes>
                    </Suspense>
                </BrowserRouter>
            </AuthProvider>
        </QueryClientProvider>
    </React.StrictMode>
);
