# ParkingBuddies

ParkingBuddies is a parking marketplace demo built with:

- `client/` - React + Vite frontend
- `server/` - Express + PostgreSQL API
- `shared/` - shared validation and pricing helpers

Live site:

- [https://parkingbuddies.onrender.com](https://parkingbuddies.onrender.com)

## Submission notes

This folder is ready to run locally.

- The submission copy already includes `client/.env` and `server/.env` for local demo use.
- No extra environment-variable setup is required before first run.
- Local payments use Stripe test keys.
- The local database is provided through Docker and the demo data is created by the seed script.

## Local run guide

### Requirements

- Node.js 20 or newer
- Docker Desktop
- A terminal such as PowerShell or Windows Terminal

### 1. Install dependencies

Open a terminal in the repo root, then run:

```powershell
cd server
npm.cmd install
cd ..\client
npm.cmd install
```

The included `.env` files are already configured for local demo use, so you do not need to create or rename any environment files before starting.

### 2. Start PostgreSQL in Docker

From the repo root:

```powershell
docker compose up -d db
```

### 3. Run migrations and seed the demo database

```powershell
cd server
npm.cmd run db:setup
```

This creates the schema and seeds demo users, listings, bids, and bookings.

The seed currently creates `11` demo listings covering:

- rent, free, and auction listings
- hourly, daily, and weekly pricing
- single-space and multi-space listings
- listings with and without images

### 4. Start the app

Use two terminals.

Terminal 1 - API:

```powershell
cd server
npm.cmd run dev
```

Terminal 2 - frontend:

```powershell
cd client
npm.cmd run dev
```

### 5. Open the app

- Frontend: [http://localhost:5173](http://localhost:5173)
- API health check: [http://localhost:4000/health](http://localhost:4000/health)

## Demo accounts

- Owner: `owner@demo.com` / `demo1234`
- Driver: `driver@demo.com` / `demo1234`

## If you need to reset the local database

From the repo root:

```powershell
docker compose down -v
docker compose up -d db
cd server
npm.cmd run db:setup
```

## Build checks

Frontend:

```powershell
cd client
npm.cmd run build
```

Backend:

```powershell
cd server
npm.cmd run build
```

## Project structure

- `client/public/seed/` contains the seeded demo listing images.
- `server/migrations/` contains the database migrations.
- `server/scripts/seed.js` creates the demo data used for local testing.
- `render.yaml` contains the Render deployment blueprint for the live site.

## Notes

- If PowerShell blocks npm scripts, use `npm.cmd` exactly as shown above.
- To stop the Docker database without deleting the data: `docker compose down`
- To remove the data as well: `docker compose down -v`
