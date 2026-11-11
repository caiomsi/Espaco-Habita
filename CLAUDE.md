# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**Espaço Habita Admin** — a private booking and finance back office for a space
that rents rooms (a Salão and Salas). It is **not a marketing site**. All
interface text is **pt-BR**. Multi-page static app (HTML + CSS + vanilla JS, no
build step) backed by **Supabase**. Deployed by GitHub Pages from `master` at
`https://caiomsi.github.io/Espaco-Habita/`.

## Running it

Serve the folder (`python3 -m http.server`) and open `http://localhost:8000`.
Do not open pages via `file://`; Supabase auth misbehaves on file origins.

## Structure

- `index.html` only redirects to `login.html`.
- One HTML page per screen, each with a matching script in `js/`: `dashboard`,
  `rooms`, `salas`, `sala`, `clients`, `contratos`, `requests`, `expenses`,
  `financeiro`, `tarifario`.
- Shared scripts: `js/supabase.js` (client, exposes `window.sb`), `js/auth.js`
  (session guard: unauthenticated users go to `login.html`, authenticated users
  on the login page go to `dashboard.html`), `js/ui.js`, `js/calendar.js`,
  `js/bookings.js`, `js/series.js`, `js/blocked.js`, `js/overlap.js`,
  `js/bk-picker.js`, `js/pricing.js`, `js/email.js`.
- `css/style.css` — one stylesheet; tokens at the top (forest greens
  `--forest-*`, parchment neutrals `--warm-*`, terracotta accent `--terra-*`).

## Data

Supabase tables used from the client: `bookings`, `rooms`, `clients`,
`blocked_times`, `client_plans`, `client_hour_packages`, `expenses`,
`booking_series`, `settings`, and the pricing tables `salao_rate_tiers`,
`salao_aula_tiers`, `sala_period_tiers`, `sala_marginal_rates`,
`sala_hour_package_tiers`, `sala_contracts`.

The anon key in `js/supabase.js` is public by design; security must come from
Supabase Auth + RLS. Never put a service key in this repo. Inspect the existing
tables before any schema change.

## Care points

- Pricing and revenue logic (`js/pricing.js`, `js/financeiro.js`,
  `js/tarifario.js`) has had real bugs fixed; change it carefully and re-check
  totals against the pricing sheet.
- Booking overlap rules live in `js/overlap.js`; keep series and blocked times
  consistent with them.
- `robots.txt` exists to keep the app out of search; keep it that way.
