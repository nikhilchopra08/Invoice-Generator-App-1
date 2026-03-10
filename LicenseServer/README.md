# License Server (Stripe-ready)

1) Copy `.env.example` to `.env` and edit values.
2) Install & run:
   ```bash
   npm i
   node -r dotenv/config server.js
   ```
3) When `STRIPE_ENABLED=false`, the server only verifies keys and manual issuing works:
   ```bash
   curl -X POST http://localhost:8787/api/admin/issue -H "Content-Type: application/json" -d '{"planDays":365}'
   ```
4) Flip to `STRIPE_ENABLED=true` + set `STRIPE_*` env to enable checkout pages and (optional) webhooks.
