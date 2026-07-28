# Peterpan portfolio site

Next.js front end for the bot's on-chain wallets. It holds no keys and no
sessions — every `/api/onchain/*` and `/auth/*` request is rewritten
(proxied) to the bot server, so cookies live on THIS site's origin while all
signing and OAuth stays in the bot process.

## Deploy on Vercel

1. Import the repo in Vercel, set the project **Root Directory** to `web/`.
2. Set one environment variable:
   - `BOT_SERVER_URL` — the public https URL of the bot server (expose port
     3000 behind a domain or tunnel; Vercel's proxy must be able to reach it).
3. Deploy. Note the site URL, e.g. `https://peterpan.vercel.app`.

Then on the **bot server** `.env`:

```
SITE_BASE_URL=https://peterpan.vercel.app
```

and in the X developer portal add the OAuth 2.0 redirect URI:

```
https://peterpan.vercel.app/auth/x/callback
```

Restart the bot (`pm2 restart peterpan --update-env`) and put the site URL in
the bot's X bio — replies say "link in bio" on purpose (posts with links cost
13x, and X blocks raw crypto addresses in posts).

## Why the proxy matters for auth

"Sign in with X" is a full OAuth 2.0 PKCE round trip handled by the bot
server, but through the site's own domain:

- `/auth/x/login` (proxied) sets the PKCE cookie on the site origin and
  redirects to X.
- X redirects back to `{SITE_BASE_URL}/auth/x/callback`, which the rewrite
  hands to the bot server; it exchanges the code, verifies the X account, and
  sets a signed, `HttpOnly`, `Secure` session cookie — again on the site
  origin.
- Manage calls (`/api/onchain/sell`, `withdraw`, `export-key`) ride the same
  origin, so the browser attaches the session cookie automatically. No CORS,
  no tokens in JavaScript, nothing sensitive stored client-side.

## Local dev

```bash
npm install
BOT_SERVER_URL=http://localhost:3000 npm run dev   # site on :3200
```
