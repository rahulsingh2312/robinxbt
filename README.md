# xbot

`xbot` replies when users mention the bot on X. Anyone can ask for an opt-in
public portfolio card. Allowlisted accounts can also place **real market orders
by tweeting**, executed against the operator's own Robinhood agentic account.

## What is included

- X mention polling via `GET /2/users/:id/mentions`
- X replies via `POST /2/tweets`, authenticated with OAuth 1.0a
- Tweet-driven market orders through the Robinhood Trading MCP
- Author-ID allowlist, per-order and per-day spend caps, and exactly-once order claiming
- Owner-authorized portfolio updates and public portfolio pages
- PostgreSQL persistence when `DATABASE_URL` is supplied; a local JSON fallback for development
- `X_DRY_RUN=true` by default, so setup can neither post on X nor place an order

## Scope: one account, not many

Robinhood's agentic OAuth uses a **loopback redirect and desktop-only
authentication**, and there is no third-party developer program. A hosted
service therefore cannot hold an authorized Robinhood session on behalf of other
people, so this bot trades **exactly one account: yours**.

Everything under "Provision a portfolio owner" below is unrelated to trading. It
lets other X users publish a read-only portfolio card they enter themselves; it
never touches a brokerage.

Placing orders for other people's accounts would also be regulated activity in
the US. Do not repurpose the allowlist to trade on someone else's behalf.

## On-chain wallets on Robinhood Chain (`ONCHAIN_ENABLED`)

The scope limit above applies to Robinhood *brokerage* accounts. The on-chain
mode is different: every X user who mentions the bot gets their **own wallet on
Robinhood Chain** (Robinhood's Arbitrum-based L2, chain id 4663, mainnet since
July 2026), and buys spend **their** deposited ETH, never yours.

The conversation loop:

1. Any mention lazily creates a wallet for that author (keyed by numeric X
   user ID, so handle changes cannot move funds).
2. The user asks for advice; the bot answers as usual, mentioning tickers.
3. The user replies "buy" — the asset comes from the bot's own advice, a
   `$TICKER`, or a raw contract address. If no size was given the bot asks and
   remembers the ask; a bare `$50` reply then fills it.
4. No funds? The reply contains their deposit address and asks them to send
   ETH on Robinhood Chain.
5. Funded? The bot swaps ETH for the token through Uniswap v4 (verified stock
   tokens and memecoins both resolve through the chain's Blockscout index;
   ambiguous or unverified tickers fail closed) and replies telling them to
   check the portfolio link in bio.

Safety systems: per-order USD cap (`ONCHAIN_MAX_ORDER_USD`), slippage bound
enforced on-chain (`ONCHAIN_SLIPPAGE_BPS`), scam-ticker rejection, exactly-once
fills per tweet, `X_DRY_RUN` honored end to end, and private keys encrypted at
rest with `WALLET_ENC_KEY` (AES-256-GCM).

### The portfolio site (`web/`)

`web/` is a Next.js app: `npm install && npm run dev` inside `web/` (set
`BOT_SERVER_URL` if the bot server is not on `localhost:3000`). Put its public
URL in the bot's X bio — replies deliberately say "link in bio" instead of
carrying a URL (posts with links cost 13x). Anyone can view a handle's
holdings; **Sign in with X** (set `X_CLIENT_ID`, register the redirect URI
`{SITE_BASE_URL}/auth/x/callback`) unlocks withdrawing to any address and
exporting the private key, so users can always exit your custody.

### Running in production

- **PostgreSQL is required.** The JSON store is a development fallback: one
  unsynced file, no backups, and no safety across processes. Set
  `DATABASE_URL`, then `npm run db:migrate` to copy an existing JSON store in
  (idempotent, so a re-run after a partial failure is fine).
- **Back the database up off-host.** `npm run db:backup` writes a `pg_dump`
  to `./backups`. The encrypted wallet keys live only there;
  `WALLET_ENC_KEY` lives only in the environment. Losing either loses the
  wallets, and a backup that never leaves the box is not a backup.
- **Set `PROXY_SHARED_SECRET`** to the same value here and in the site's
  environment. Without it the API answers anyone who finds the port, and
  every visitor shares the proxy's IP in a single rate-limit bucket.
- **Use a dedicated RPC provider.** The public Robinhood Chain endpoint is
  rate limited; reads are batched, retried, and cached for a few seconds, but
  a real user base needs a paid endpoint in `ROBINHOOD_CHAIN_RPC_URL`.
- **Run one bot process.** Wallet signing is serialized per wallet with a
  Postgres advisory lock, so a second instance is safe, but each one polls X
  independently and every poll is billed.
- **Rotate the wallet key without downtime**: set `WALLET_ENC_KEY_PREVIOUS`
  to the old key, put the new one in `WALLET_ENC_KEY`, restart, run
  `npm run wallets:rewrap`, then drop the previous key.

### Read this before enabling

- **You are a custodian.** The store (JSON file or Postgres) plus
  `WALLET_ENC_KEY` together control every user's money. Protect both, back up
  the key offline, and assume a leak of either is a total loss.
- **This is likely regulated activity** (money transmission and possibly
  broker-dealer territory, depending on jurisdiction). Get real legal advice
  before running this for strangers.
- **Robinhood Stock Tokens are not offered to U.S. persons** (nor in Canada,
  the UK, or Switzerland) under the issuer's terms. The site footer says so;
  it is on you to keep your audience compliant.
- The public RPC is rate limited; use a dedicated Robinhood Chain RPC
  provider in production, and prefer Postgres over the JSON store.

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

- `X_BOT_USER_ID`: the bot account's numeric X user ID
- `X_BOT_USERNAME`: bot handle without `@`
- `X_CONSUMER_KEY` / `X_CONSUMER_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET`: OAuth 1.0a, the simplest scheme for a bot posting only as itself
- `PUBLIC_BASE_URL`: deployed public HTTPS URL

An **app-only Bearer token will not work** — it cannot post or read mentions in
user context. In the X developer portal, set app permissions to **Read and
write** *before* generating the access token; tokens generated under read-only
permissions stay read-only and fail with a 403 on reply. `X_BOT_USER_ACCESS_TOKEN`
remains supported if you run an OAuth 2.0 user-context flow instead.

Keep `X_DRY_RUN=true` until the bot replies look correct in logs. Then set it
to `false` and restart. The worker stores the latest handled mention ID, so it
does not reply twice after restart.

Commands:

- `@yourbot portfolio` → inline holdings summary if the author opted in for that bot
- `@yourbot buy 5 AAPL` / `buy $500 of NVDA` / `sell 2 TSLA` → real order, allowlisted authors only
- Any other mention → help response

## Trading setup

Trading is off until you set `TRADING_ENABLED=true`. Connect Robinhood once,
from a machine with a desktop browser:

```bash
npm run robinhood:login
```

This opens Robinhood's consent screen, stores a refresh token at
`ROBINHOOD_TOKEN_FILE` with `0600` permissions, and prints the MCP tool names it
discovered along with how they mapped to `placeOrder`, `quote`, `positions`, and
`account`. If a mapping is wrong or unresolved, pin it with
`ROBINHOOD_TOOL_PLACEORDER` / `ROBINHOOD_TOOL_QUOTE`.

Then set your allowlist and caps:

```bash
TRADING_ENABLED=true
X_TRADE_AUTHOR_IDS=1234567890     # numeric X user IDs, never handles
MAX_ORDER_USD=100
DAILY_MAX_USD=500
```

Leave `X_DRY_RUN=true` for the first run. The bot will log the order it *would*
place without sending it or replying. Set it to `false` only once the parses
look right.

### What protects you

Orders execute instantly with no confirmation reply, so these are the only
guards:

- **Author-ID allowlist.** Authorization is by numeric X user ID. Handles are
  rejected because a released handle can be re-registered by someone else.
- **Spend caps.** Buys over `MAX_ORDER_USD` are refused, and buys are summed per
  UTC day against `DAILY_MAX_USD`.
- **Fail-closed pricing.** A share-quantity buy that cannot be priced from a
  live quote is refused rather than sent unpriced.
- **Strict parsing.** Anything ambiguous returns a syntax hint instead of a
  guess. `buy AAPL` with no quantity is never an order.
- **Exactly-once execution.** A mention is claimed before the broker is called,
  so a crash or a failed reply cannot place the same order twice.

None of this protects against a compromised X account. Anyone who can post from
an allowlisted handle can spend up to your daily cap. Fund the Robinhood agentic
account with only what you are willing to lose, and keep the caps low.

## Costs

X moved to pay-per-use pricing in February 2026. The critical detail: **reads
are metered per resource returned, not per request.** An empty response costs
nothing, and requesting the same post twice inside a UTC day is charged once.

So polling an idle bot is **free** — you pay $0.005 per mention actually
delivered, whether it arrives by poll or by webhook. Poll frequency does not
drive cost; mention volume does.

Writes: $0.015 per post created, but **$0.20 if the post contains a link**,
roughly 13×.

**Replies never contain a URL.** Portfolio replies summarize holdings inline
instead of linking out, and `MentionWorker` is not given `publicBaseUrl` at all
so a link cannot be reintroduced by accident. A test asserts this. The public
pages at `/p/:bot/:user` and `/setup` still work — they're just shared by hand
rather than tweeted.

## Webhooks instead of polling

The bot accepts pushed mentions at `POST /webhooks/x`, which removes the polling
loop entirely and makes replies immediate. Events run through the same worker as
polling, so the allowlist, spend caps, and exactly-once claim apply identically.

The X Activity API is available on pay-per-use, limited to **1 webhook and 3
subscriptions**. Mention events (`post.mention.create`) are *private events* and
require **OAuth 2.0 user context** to subscribe — OAuth 1.0a is not accepted for
the subscription call, which is why `X_CLIENT_ID` / `X_CLIENT_SECRET` exist
alongside the OAuth 1.0a keys used for replies.

Setup needs a public HTTPS URL (any $5–6 VPS with Caddy works; use a tunnel for
local development):

```bash
# 1. Point PUBLIC_BASE_URL at your HTTPS domain and start the server.
# 2. Register the webhook (OAuth 2.0 app-only bearer):
curl -X POST "https://api.x.com/2/webhooks" \
  -H "Authorization: Bearer $X_APP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://yourdomain.com/webhooks/x"}'
# 3. Subscribe the bot account to it (needs OAuth 2.0 user context).
```

X validates the endpoint with a Challenge-Response Check: a `GET` with
`crc_token`, answered with an HMAC-SHA256 of that token keyed by your consumer
secret. Every event `POST` carries an `x-twitter-webhooks-signature` header
validated the same way; unsigned or forged events get a 403. Both behaviors are
covered by tests and were verified against a running server.

Set `X_POLL_INTERVAL_MS` high once webhooks are live, or leave polling on as a
backstop — there are field reports of Activity API delivery lagging by tens of
minutes, and the exactly-once claim means a mention arriving by both routes is
still only acted on once.

## Before production

Add rate limiting, audit logging, and alerting on every placed order. Consider
adding a confirmation step: instant execution means a typo or a joke tweet
becomes a filled order with no undo.
## Persona: Gork

`PERSONA=gork` swaps the answering voice for a parody rage-bait persona (think
"Grok, but it's a jaded Robinhood cultist"). Infrastructure is unchanged —
tools, spend caps, dry run, and the read-only tool filter all still apply; only
the prompts and an optional unprompted-posting loop are new.

```bash
PERSONA=gork
LLM_ENABLED=true          # the persona needs an answering model
GORK_POSTING_ENABLED=true # unprompted posts, ~$0.015 each
GORK_POST_MIN_MINUTES=120
GORK_POST_MAX_MINUTES=360
CORPUS_X_USER_ID=         # optional: numeric ID of the public figure to track
```

Unprompted posts pick a random seed direction every 2–6 hours (configurable)
and respect `X_DRY_RUN`, so the whole persona can be reviewed in logs before it
ever posts. The style corpus pulls the tracked account's recent posts as
cadence reference; the prompt forbids verbatim copying and fabricated quotes.

Non-negotiables baked into the prompt and covered by tests: the account
presents itself as parody, no slurs or protected-class attacks, no self-harm
content, no harassment of private individuals, no guaranteed-return claims.
**Label the X account itself as parody** (name + bio) — X suspends unlabeled
parody accounts under its impersonation policy, and no prompt can save the
project from that.
# robinxbt
