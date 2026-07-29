# Peterpan

**A trading account you talk to. Tweet at it, and it buys.**

---

## The one-liner

Peterpan is an X account that opens a real on-chain wallet for anyone who
mentions it, and buys or sells for them when they ask — in a normal sentence,
in the reply, without an app, a signup, or a seed phrase.

> **@rahu1o1:** hey @TryPeterpan i want you to buy 1 dollar of cashcat
> **@TryPeterpan:** bought you ~24.14 CASHCAT for $1. cost you 4.4% in price impact. it's your bag now, portfolio link in bio.

That exchange is the entire product. Everything else is plumbing.

---

## The problem

Crypto's onboarding is a funnel with a hole at the top. Someone sees a token
mentioned on X and wants in. To act on that impulse they need a wallet, a seed
phrase they will not lose, gas in the right currency, a bridge, a DEX they have
never used, and the confidence to paste a contract address into it. Most people
close the tab. The intent existed for about eleven seconds and then evaporated.

Every launchpad, every token, every chain is fighting for attention on X, and
then sending that attention somewhere else to transact. The gap between "I want
that" and "I own that" is where the market loses its users.

Peterpan closes the gap to one sentence, in the place the intent already
happened.

---

## How it works

**1. Talk.** Mention the bot. It answers in a voice people actually engage
with — a rude, data-grounded markets account, not a support desk. A wallet is
created for you silently on first contact, keyed to your numeric X account.

**2. Fund.** Your portfolio page shows a deposit address and QR. Send ETH or
USDG on Robinhood Chain. Nothing else to configure.

**3. Trade.** Say what you want. "buy $5 of NVDA", "throw 20 bucks at PEPE",
"grab me a buck fifty of that cat coin", "sell half my NVDA", "what do I hold".
It parses intent with a model, verifies the asset on-chain, routes the trade,
and reports the fill with the real numbers.

Buying and selling happen in the conversation. Withdrawing does not — that
requires signing in with X on the site, so no tweet can move funds off a wallet.

---

## What is actually hard about this

The demo is one tweet. The engineering is everything that has to be true for
that tweet to be safe.

**Liquidity on Robinhood Chain is split three ways.** Uniswap v2, v3, and v4 all
run here with no pattern to what lives where: tokenized stocks quote on v3 and
v4, Virtuals agent tokens exist only as v2 pairs, and the deepest memecoin pools
are v3. Peterpan quotes all three on every request and takes the best fill.
Quoting a subset means telling people that tokens with hundreds of millions in
liquidity do not trade.

**Tickers are not identity.** Anyone can deploy a token called NVDA. Resolution
prefers issuer-verified stock tokens, then ranks everything else by the pair
liquidity actually backing it, and refuses ambiguity rather than guessing. A
contract address bypasses the guesswork entirely and buys exactly that contract.

**Quotes lie about taxed tokens.** A router's quote cannot know about a transfer
tax, which is exactly the property the tokens people ask for tend to have. Every
swap is simulated against the live chain before it is signed, widening the
price bound until the chain accepts it or refusing the trade. A failed
simulation costs nothing; a reverted transaction costs the user gas.

**A model reads the request, but code decides.** The model extracts intent from
natural language. It can name an asset; it can never authorise one. Anything it
returns is re-validated against what the person actually typed, and the asset
still passes every on-chain check before a wei moves.

**Custody has to be exitable.** Keys are generated per user and encrypted at
rest. Any user can export their private key from the portfolio page at any
time and walk away with the wallet. Custody you cannot leave is a trap, not a
product.

---

## Where it is today

- **Live** on X as [@TryPeterpan](https://x.com/TryPeterpan), trading real money
  on Robinhood Chain mainnet.
- **Real fills executed** end to end: tweet in, tokens in the wallet, reported
  back in the thread.
- **29 of the 30 most-traded tokens** on the chain buy successfully in the live
  preflight — tokenized stocks, memecoins, and Virtuals agent tokens.
- **Buy, sell, and portfolio** all work by conversation; withdraw and key export
  work on the site behind sign-in with X.
- Backed by PostgreSQL, per-wallet transaction serialisation, exactly-once
  fills per tweet, and a live-chain test suite that simulates real swaps rather
  than mocks.

---

## Why this matters to a launchpad

A launchpad's hardest problem is not deploying tokens. It is converting
attention into holders — and attention lives on X while transacting lives
somewhere else.

Peterpan makes any token on Robinhood Chain buyable **inside the conversation
where it is being discussed**. An agent token launches, someone posts about it,
a reader says "buy me $20 of that" under the post, and thirty seconds later they
hold it. No bridge, no wallet install, no contract address pasted into a
stranger's UI.

For a launchpad that means:

- **Every mention becomes a buy button.** Distribution wherever your community
  already talks, with no integration on your side — new tokens are picked up
  automatically the moment they have liquidity.
- **First-time buyers, not just rotating capital.** The people who convert here
  are the ones who would otherwise have bounced at "install a wallet".
- **Attribution you can see.** Fills are on-chain and public, tied to the post
  that caused them.

The same mechanic works for tokenized equities: someone argues about NVDA
earnings in a thread and buys $5 of it without leaving the argument.

---

## Why now

Robinhood Chain went live this month with tokenized equities and a launchpad
ecosystem forming on top of it. Agent tokens are launching weekly. The assets
are new, the audience is on X, and nobody has connected the two. The window for
being the default way people buy things on this chain is open right now.

---

## What is next

- **Trade receipts as content** — each fill quote-tweets a generated card, so
  every purchase advertises the product.
- **Copy trading** — "copy @someone with $50" buys their book pro-rata.
- **Leaderboards and PnL** — the portfolio page becomes something people share.
- **Launchpad partnerships** — new tokens tradable by tweet from the minute
  they list.

---

## What we are honest about

This is custodial until a user exports their key, which makes key management
the most important thing in the system. Trades are real and irreversible.
Memecoins can go to zero and thin pools cost real money — the bot says so, out
loud, in the fill. Robinhood Stock Tokens are not offered to U.S., Canadian,
UK, or Swiss persons under the issuer's terms. Operating this at scale is
regulated activity and is being treated as such.

---

**Try it:** tweet `@TryPeterpan buy $1 of NVDA`, then check the portfolio link
in the bio.
