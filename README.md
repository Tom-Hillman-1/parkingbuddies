ParkingBuddies

Quick start (Docker database)
This setup is for a fresh machine with no local PostgreSQL. You only need Docker Desktop, Node.js, and a terminal.

1) Open a terminal
- On Windows: open PowerShell or Windows Terminal.
- All commands below assume you are in the repo root for your local clone.

2) Install dependencies
- Server:
  - `cd server`
  - `npm.cmd install`
- Client:
  - `cd ..\client`
  - `npm.cmd install`

3) Start the database (Docker)
- From the repo root:
  - `docker compose up -d db`

4) Run migrations + seed demo data
- `cd server`
- `npm.cmd run db:setup`

5) Start the app (two terminals)
- Terminal 1 (server):
  - `cd server`
  - `npm.cmd run dev`
- Terminal 2 (client):
  - `cd client`
  - `npm.cmd run dev`

Demo accounts
- owner@demo.com / demo1234
- driver@demo.com / demo1234

Notes
- If PowerShell blocks npm scripts, use `npm.cmd` (as shown).
- To stop the Docker DB: `docker compose down`

Deployment notes
- A Render blueprint file is included at `render.yaml` if you want to create the frontend and API from the same repo.
- The frontend and backend deploy separately.
- Frontend build:
  - `cd client`
  - `npm run build`
- Backend build:
  - `cd server`
  - `npm run build`
- Backend start command:
  - `npm run migrate:up && npm run start`

Minimum production environment variables
- Backend:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `FRONTEND_URL`
  - optional: `SUPPORT_EMAIL`, `CORS_ORIGINS`
- Frontend:
  - `VITE_API_URL`
  - `VITE_STRIPE_PUBLISHABLE_KEY`

Production safeguards
- `DEMO_BYPASS_CONNECT` must stay `false` in production.
- The API now fails fast in production if no frontend origin is configured.
