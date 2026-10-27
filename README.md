# Mechanic shop booking site

A small website where customers book a car appointment, and the owner sets his opening
hours and sees bookings at `/admin`. It runs on the Cloudflare free tier: one Worker
(serves the pages and the API) and one D1 database. No framework and no build step.

## Run it on your computer

```
npm install
cp .dev.vars.example .dev.vars     # then edit .dev.vars and choose a password
npm run db:migrate:local
npm run dev
```

Open http://localhost:8787 for the customer page and http://localhost:8787/admin for the owner page.

Run the tests with `npm test`.

## Put it online (Cloudflare free plan)

1. `npx wrangler login`
2. `npx wrangler d1 create mechanic-db` and paste the `database_id` it prints into `wrangler.jsonc`.
3. In `wrangler.jsonc`, set `TIMEZONE` to the shop's time zone (for example `America/Chicago`).
4. `npm run db:migrate:remote`
5. `npx wrangler secret put ADMIN_PASSWORD` and type the owner's password.
6. `npm run deploy`

The site is now live on a `*.workers.dev` address.

### Custom domain

In the Cloudflare dashboard go to Workers & Pages, open `mechanic-shop`, then
Settings, Domains & Routes, and add your domain.

### Automatic deploys (optional)

In the same Worker's Settings, open Builds and connect the GitHub repository, with `main`
as the production branch. Every merge to `main` then deploys by itself.

## The owner page

The owner opens `/admin` and logs in with the password. From there he can see and cancel
appointments, set the opening days and hours, mark days off, and change the shop's name,
phone number and address. Changing the `ADMIN_PASSWORD` secret logs everyone out.

## Branches

Do the work on `secondary`. When it is ready to go live, merge `secondary` into `main`.

## Layout

- `src/worker.js` the API and routing
- `src/schedule.js` booking-time rules and checks (no Cloudflare code, fully unit tested)
- `src/auth.js` owner login cookie
- `public/` the two pages, styles and scripts
- `migrations/` database setup
