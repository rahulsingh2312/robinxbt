# xbot

`xbot` replies when users mention the bot on X. Users can opt in to a public
portfolio card, so `@yourbot portfolio` responds with the owner's public URL.
It never publishes data without that opt-in, and it never executes a trade from
a public post.

## What is included

- X mention polling via `GET /2/users/:id/mentions`
- X replies via `POST /2/tweets`
- Owner-authorized portfolio updates and public portfolio pages
- PostgreSQL persistence when `DATABASE_URL` is supplied; a local JSON fallback for development
- `X_DRY_RUN=true` by default, so setup cannot accidentally post on X

Robinhood's Trading MCP is an authenticated, account-specific connection. This
project deliberately does **not** use one shared Robinhood session for all X
users. A production dashboard must establish and retain a separate authorized
connection for each user before syncing their portfolio. The API below provides
the safe public-sharing boundary for that future connection.

## Run locally

```bash
cp .env.example .env
# Set ADMIN_API_KEY to a long random secret.
npm test
npm start
```

Open `http://localhost:3000/health` to verify the server. X polling remains
disabled until each bot has both its user ID and user-context access token set.

## Multiple X bots

One X developer project/app can serve multiple bot accounts. Each bot must
complete authorization separately: its `userAccessToken` is what determines the
account that creates replies. Never use your personal user token for a bot,
unless you intend replies to be posted by your personal account.

Configure a fleet with `X_BOTS_JSON`:

```bash
X_BOTS_JSON='[
  {"username":"alphaBot","userId":"111","userAccessToken":"alpha-token"},
  {"username":"betaBot","userId":"222","userAccessToken":"beta-token"}
]'
```

The service starts one mention worker per configured bot. Portfolio data is
scoped by both bot handle and X username, so the same person can opt in to
different public cards for `@alphaBot` and `@betaBot`.

## PostgreSQL

Set `DATABASE_URL` before starting the service. On startup, it creates the
`xbot_users` and `xbot_state` tables automatically. No secrets are written to
these tables: X credentials remain in your environment or secret manager.

## Provision a portfolio owner

Provisioning returns an owner token once. Keep it outside X and do not expose
it to the browser without a real login/session layer.

```bash
curl -X POST http://localhost:3000/api/bots/yourbot/users \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"xUsername":"alice","displayName":"Alice"}'
```

## Publish an opt-in portfolio

Use the returned `ownerToken`. Setting `publicSharing` to `true` makes only the
submitted holdings visible at `/p/yourbot/alice`. `hideValues` keeps quantities visible
but hides portfolio and holding values.

```bash
curl -X PUT http://localhost:3000/api/bots/yourbot/users/alice \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "publicSharing": true,
    "portfolio": {
      "totalValueUsd": 12500,
      "hideValues": false,
      "holdings": [
        {"symbol":"BTC","name":"Bitcoin","quantity":0.12,"valueUsd":8200},
        {"symbol":"ETH","name":"Ethereum","quantity":1.1,"valueUsd":4300}
      ]
    }
  }'
```

To unpublish it immediately:

```bash
curl -X PUT http://localhost:3000/api/bots/yourbot/users/alice \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"publicSharing":false}'
```

## Connect X

Set these values in `.env`:

- `X_BOT_USER_ID`: the bot account's numeric X user ID (single bot configuration)
- `X_BOT_USERNAME`: bot handle without `@` (single bot configuration)
- `X_BOT_USER_ACCESS_TOKEN`: user-context token for that bot account (single bot configuration)
- `X_BOTS_JSON`: preferred multi-bot configuration
- `PUBLIC_BASE_URL`: deployed public HTTPS URL

Keep `X_DRY_RUN=true` until the bot replies look correct in logs. Then set it
to `false` and restart. The worker stores the latest handled mention ID, so it
does not reply twice after restart.

Commands:

- `@yourbot portfolio` → public card if the author opted in for that bot
- `@yourbot buy ...` / `sell` / `swap` / `trade` → refuses public execution
- Any other mention → help response

## Before production

Add an X login flow, encrypted per-user provider credentials, rate limiting,
audit logging, and a private order-review confirmation flow. Do not store
Robinhood credentials or MCP sessions in the database.
# robinxbt
