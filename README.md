# StockSense

A modular inventory management system that replaces registers and spreadsheets with one live stock ledger. Built for the Odoo hackathon problem statement: products, receipts, deliveries, internal transfers, stock adjustments, move history, multi-warehouse, reorder rules and OTP password reset.

**Stack:** React 18 + Vite + Tailwind v4 · Node.js + Express · PostgreSQL (local, no cloud services) · Zod validation · JWT auth · `node:test` + Supertest.

---

## 1. Run it on your laptop (Windows + VS Code)

### Install once
1. **Node.js 20 LTS or newer**: https://nodejs.org (check with `node -v`).
2. **PostgreSQL 16**: https://www.postgresql.org/download/windows/ — during install, set a password for the `postgres` user and **remember it**. Keep port `5432`.

### Set up the project
Open the `stocksense` folder in VS Code, then open a terminal (`` Ctrl+` ``):

```bash
npm run setup
```

This also creates `server/.env` from `server/.env.example`. Open `server/.env` and put your Postgres password in the two URLs:

```
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/stocksense
TEST_DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/stocksense_test
```

Also change `JWT_SECRET` to any long random string.

```bash
npm run db:reset     # creates the database, tables and demo data
npm run dev          # starts the API (port 4000) and the web app (port 5173)
```

Open **http://localhost:5173** and sign in:

| Role | Email | Password |
|---|---|---|
| Inventory Manager | manager@stocksense.dev | Demo@1234 |
| Warehouse Staff | staff@stocksense.dev | Demo@1234 |

> **Forgot password / OTP:** with no SMTP settings, the 6-digit code is printed in the terminal running the API. Add `SMTP_*` values in `server/.env` to send real emails.

### Run the tests
```bash
npm test
```
18 tests, including the concurrency cases (double-clicked Validate, two deliveries racing for the same stock). They use the separate `stocksense_test` database, which is wiped on each run.

### Troubleshooting
| Symptom | Fix |
|---|---|
| `password authentication failed` | Wrong password in `server/.env` |
| `ECONNREFUSED ...5432` | PostgreSQL service isn't running: Windows search → Services → `postgresql-x64-16` → Start |
| Web app says "Cannot reach the server" | The API isn't running; check the `api` output in the terminal |
| Port 5173/4000 in use | Close the other process, or change `PORT` in `server/.env` and the proxy in `client/vite.config.js` |

---

## 2. How it works

### The one idea: every stock change is a move between two locations

This mirrors how Odoo Inventory models stock. There is no special-case code for "receipt adds" or "delivery subtracts"; there are only moves.

```mermaid
flowchart LR
  V([Vendors<br/>virtual]) -- Receipt --> S[WH/Stock]
  S -- Internal transfer --> R[WH/Rack A]
  R -- Delivery --> C([Customers<br/>virtual])
  S <-- Adjustment --> A([Inventory Adjustment<br/>virtual])
```

| Operation | From | To | Effect on total stock |
|---|---|---|---|
| Receipt | Vendors | a warehouse location | + |
| Delivery | a warehouse location | Customers | − |
| Internal transfer | location A | location B | none (only the location changes) |
| Adjustment | location ⇄ Inventory Adjustment | | counted − recorded |

The PDF example (receive 100 kg steel → move to production rack → deliver 20 → 3 kg damaged) is the first test in `server/test/inventory.test.js`, and the ledger balance after each step is asserted: **100 → 100 → 80 → 77**.

### Data integrity guarantees
- **Immutable ledger.** `stock_moves` is append-only, enforced by a PostgreSQL trigger. Mistakes are fixed with a **Return** or a new **count**, never by editing history.
- **Atomic validation.** Validating an operation moves every line or none. One short line rolls back the whole thing, and the user sees every shortage at once.
- **No overselling, even under concurrency.** Validation locks the operation row and the affected stock rows (`SELECT … FOR UPDATE`), in a fixed order to avoid deadlocks. Two people validating at the same moment cannot both take the same units.
- **Stock can't go negative.** Checked in the engine, and backed by a `CHECK (quantity >= 0)` constraint in the database.
- **Validation everywhere.** Zod schemas on every endpoint return field-level messages that the forms display next to the right input.

### Status flow
`Draft → Waiting → Ready → Done` (or `Canceled`). A delivery or transfer is **Waiting** when the source location doesn't have the stock yet, and flips to **Ready by itself** when a receipt brings it in.

### Roles
| | Manager | Staff |
|---|---|---|
| Receipts, deliveries, transfers | ✔ | ✔ |
| Record a stock count | ✔ | ✔ |
| **Apply** a stock count | ✔ | – (a manager reviews it) |
| Products, reorder rules, warehouses, categories | ✔ | view only |

### Project layout
```
server/
  db/migrations/        SQL schema (001) + virtual locations (002)
  db/seed.js            demo data, created THROUGH the stock engine
  src/services/inventory.js   the stock engine: the only code that changes stock
  src/routes/           auth, catalog, warehouses, operations, reports (moves + dashboard)
  src/middleware/       auth (JWT + roles), validation, error → JSON mapping
  test/                 auth + inventory tests
client/
  src/pages/            Dashboard, Products, Operations list/board, Operation form, Moves, Settings, Auth
  src/components/       Layout (sidebar, profile menu, global search), UI primitives
  src/lib/              API client, auth context, toasts, formatting
api.http                try the API from VS Code (REST Client extension)
```

### Database schema (main tables)
```mermaid
erDiagram
  warehouses ||--o{ locations : has
  products }o--|| categories : in
  products ||--o{ reorder_rules : "min/max per warehouse"
  products ||--o{ stock_quants : "on hand per location"
  locations ||--o{ stock_quants : holds
  operations ||--o{ operation_lines : contains
  operations ||--o{ stock_moves : "creates on validate"
  stock_moves }o--|| locations : "from / to"
```

---

## 3. Feature checklist (problem statement → where it is)

| Requirement | Where |
|---|---|
| Sign up / log in, redirect to dashboard | `/signup`, `/login` |
| OTP password reset | `/forgot-password` (hashed code, 10-min expiry, 5 attempts, single use, resend cooldown) |
| Dashboard KPIs: in stock, low/out of stock, pending receipts, pending deliveries, scheduled transfers | Dashboard stock-flow strip |
| Dynamic filters: type, status, warehouse, category | Dashboard + every list |
| Products: create/update, SKU, category, UoM, initial stock | Products (initial stock is logged as an adjustment) |
| Stock per location, categories, reordering rules | Product page, Reordering rules, Categories |
| Receipts, delivery orders, internal transfers, adjustments | Operations (list + board views) |
| Move history / stock ledger | Move history (running balance, CSV export) |
| Multi-warehouse, low-stock alerts | Settings → Warehouses; Dashboard "Needs attention" + one-click Replenish |
| SKU search | Press `/` anywhere; scanner-friendly SKU box on every operation |
| Left sidebar with profile menu (My profile, Log out) | Layout |

---

## 4. Demo video script (5–7 min)

1. **Problem and model (40s).** Show the login page graphic: stock moves between places. Sign in as manager.
2. **Dashboard (60s).** Walk the flow strip left to right. Change the warehouse filter. Click "1 late" on receipts.
3. **Receive (60s).** New receipt → scan `RM-STL-ROD12` in the SKU box → 100 → Validate. Show stock on the product page.
4. **Waiting → Ready (45s).** Open the Waiting delivery WH/OUT/0006, then validate a receipt for that product and show it flip to Ready.
5. **Safety (60s).** Try to deliver 999 chairs: all shortages shown, nothing moved. Mention row locks + the concurrency test.
6. **Transfer + count (45s).** Move stock to Rack A; sign in as staff, record a count; as manager, apply it (see the difference column).
7. **Ledger (45s).** Move history for steel with running balance, then Export CSV. Point out a Return instead of an edit.
8. **Engineering (40s).** Show `npm test` passing, the schema, and the append-only trigger.

---

## 5. Useful commands

| Command | What it does |
|---|---|
| `npm run setup` | Install everything |
| `npm run dev` | API + web app together |
| `npm run db:reset` | Wipe and recreate demo data |
| `npm test` | Backend test suite |
| `npm run build` | Production build of the web app |
