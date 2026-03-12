# ParkingBuddies Client

This frontend is a React + TypeScript single-page application built with Vite.

## Purpose

The client is responsible for:

- rendering the public parking marketplace,
- handling authentication screens,
- allowing owners to create and manage listings,
- allowing drivers to book listings or place auction bids,
- showing dashboard, reward, payment, and Stripe Connect states.

## Main libraries

- `react` and `react-router-dom` for page rendering and routing,
- `@tanstack/react-query` for API loading and caching,
- `react-hook-form` and `zod` for form validation,
- `@stripe/react-stripe-js` and `@stripe/stripe-js` for bid authorization and payment flows,
- `leaflet` and `react-leaflet` for map display.

## Key files

- `src/main.tsx`: app bootstrap, providers, and route registration.
- `src/lib/api.ts`: shared API request helpers.
- `src/lib/auth.tsx`: authentication context and token lifecycle.
- `src/pages/`: page-level flows such as login, signup, listing creation, booking, dashboard, and settings.
- `src/components/`: shared UI pieces such as the navbar, map, and receipt card.

## Running the client

From the `client/` folder:

- `npm.cmd install`
- `npm.cmd run dev`

For a production build:

- `npm.cmd run build`

The client expects the backend API base URL in `VITE_API_URL`.
