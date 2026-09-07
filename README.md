# Smira Club — backend

The API behind the Smira Club travel CRM and admin panel. Node, Express and
MongoDB, in the model / controller / route shape.

It is deliberately standalone: nothing in here knows the admin panel exists,
and the panel has not been wired to it. Point the panel at it when you are
ready.

## Running it

```bash
cd smirabackend
npm install
cp .env.example .env      # then fill in MONGO_URI and JWT_SECRET
npm run seed              # roles, an admin, a desk and some data to look at
npm run dev               # http://localhost:9100
```

`npm run seed:fresh` wipes the collections first. `npm run seed` on its own
only fills in what is missing, so it is safe to re-run.

The seed prints the account it makes. Leave `SEED_ADMIN_PASSWORD` blank in
`.env` and it generates one and shows it once — write it down, because it is
not stored anywhere in the repository.

Staff sign in with a mobile number and a one-time code; the password is only
for the first account and for resets.

## How it is laid out

```
server.js                 boots once the database is up
src/
  app.js                  express, middleware, routes
  config/
    db.js                 the mongo connection
    constants.js          every status, stage and enum the sheets use
  models/                 26 mongoose schemas
  controllers/            29 controllers
  routes/                 one router per module, mounted in routes/index.js
  middleware/
    auth.js               protect + the permission matrix
    scope.js              own / team / branch / all data visibility
    error.js              one error shape for everything
    validate.js           a small request validator
  helpers/
    crud.js               the five handlers every module shares
    query.js              filtering, sorting, paging, search
    money.js              the money rules, in one place
    ids.js                readable codes — LEAD-2291, BKG-8820
    audit.js              every write, logged
  seed/                   roles and a starting dataset
```

## The two rules worth knowing

**Permissions.** Every route is behind `can(module, action)` — the matrix
from the Users & Roles sheet. A role carries which of the ten modules it may
open and which of the eight actions it may take.

**Data visibility.** A role also carries a scope: `own`, `team`, `branch`
or `all`. List endpoints narrow themselves accordingly, so a travel expert
asking for `/api/leads` gets their own leads without having to say so.

## Answers

Everything comes back the same way:

```json
{ "success": true, "data": { } }
{ "success": true, "rows": [], "page": 1, "limit": 25, "total": 0, "pages": 1 }
{ "success": false, "message": "...", "details": [] }
```

## Listing anything

Every list endpoint takes the same query string:

| Parameter | What it does |
|---|---|
| `?q=rohan` | searches the fields that module marks searchable |
| `?status=Active` | any field, exactly |
| `?status=Active,New` | any of |
| `?amount[gte]=1000` | `gt`, `gte`, `lt`, `lte`, `ne`, `in`, `nin` |
| `?from=2026-01-01&to=2026-03-31` | a date window |
| `?dateField=checkIn` | which date the window applies to |
| `?sort=-createdAt,name` | sorting |
| `?page=2&limit=50` | paging |
| `?fields=name,phone` | just those fields |

## The endpoints

```
POST   /api/auth/login                    email + password
GET    /api/auth/me
POST   /api/auth/logout
PATCH  /api/auth/password

GET    /api/dashboard                     the whole business on one page
GET    /api/dashboard/trend
GET    /api/dashboard/needs-attention

CRUD   /api/users                         + /:id/profile, /:id/live, /:id/password,
                                            /:id/status, /workload, /compare
CRUD   /api/roles                         + /matrix, /options

CRUD   /api/leads                         + /funnel, /lost-analysis, /by-source, /today,
                                            /:id/stage, /:id/activity, /:id/convert, /assign
CRUD   /api/tasks                         + /board, /:id/complete
CRUD   /api/customers                     + /:id/money, /special-days, /at-risk

CRUD   /api/membership-plans              + /performance
CRUD   /api/memberships                   + /overview, /renewals, /:id/activate,
                                            /:id/collect, /:id/renew, /:id/benefit

CRUD   /api/bookings                      + /overview, /calendar, /:id/confirm,
                                            /:id/cancel, /:id/reschedule
CRUD   /api/tickets                       + /overview, /:id/assign, /:id/escalate,
                                            /:id/transfer, /:id/note, /:id/resolve,
                                            /:id/close, /:id/rate
CRUD   /api/partners                      + /performance, /payables, /:id/verify,
                                            /:id/approve, /:id/reject
CRUD   /api/inventory                     + /analytics, /alerts, /:id/rates,
                                            /:id/availability, /:id/blackout, /:id/hold,
                                            /holds, /holds/sweep, /holds/:id/release

CRUD   /api/payments                      + /gateways, /ledger
CRUD   /api/invoices                      + /pipeline, /:id/remind
CRUD   /api/refunds                       + /:id/advance, /:id/reject
CRUD   /api/expenses                      + /summary, /:id/advance
CRUD   /api/approvals                     + /mine, /:id/decide

       /api/whatsapp/conversations        + /:id/reply, /:id/assign, /:id/lead, /:id/task
       /api/whatsapp/flows                + /:id/status, /performance
       /api/whatsapp/campaigns            + /:id/send, /results
POST   /api/whatsapp/receive              an inbound message

CRUD   /api/automations                   + /options, /history, /:id/toggle, /:id/run

CRUD   /api/rewards                       + /due, /:id/advance
CRUD   /api/referrals                     + /leaderboard, /:id/pay
CRUD   /api/offers                        + /validate/:couponCode, /:id/redeem

GET    /api/reports/sales-performance
GET    /api/reports/member-growth
GET    /api/reports/retention
GET    /api/reports/builder               ?module=&dimension=&measure=
GET    /api/reports/builder/options

GET    /api/revenue                       money in, money out, what is left
GET    /api/revenue/trend                 ?grain=day|week|month|year
GET    /api/revenue/sources
GET    /api/revenue/compare               ?by=branch|department
GET    /api/revenue/commission

GET    /api/audit-logs
GET    /api/audit-logs/:entity/:id
```

## Rules the API enforces, not the panel

- A ticket cannot be closed without a resolution note.
- A one or two star rating raises a follow-up task on its own.
- A refund walks request → manager → finance → processed, and only a role
  carrying the refund right can move it.
- A membership only activates once the fee is collected in full.
- A partner cannot be approved before its papers are verified.
- Booking a held item takes the units out of stock; cancelling puts them back.
- A hold whose timer has run out releases its units.
- A lead moved to Lost has to say why.
- Five failed sign-ins lock an account for fifteen minutes.

## Still to do

- A worker to actually run the automation rules on a schedule.
- The WhatsApp Business API, the payment gateway and file uploads are modelled
  but not connected — the shapes are there for whichever provider you pick.
