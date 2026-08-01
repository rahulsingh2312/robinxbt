# Peterpan — Experiment Analytics

`@TryPeterpan` · trade-execution agent on Robinhood Chain · built by @DrOfAgents

**Reporting window:** 2026-07-29 01:26 → 2026-07-31 17:57 UTC (~2.7 days)
**Status at time of writing: DEAD.** The X developer account (`2081841909182382080`)
ran out of API credits. The process is still up and healthy, but every poll and
stream connection returns `402 credits depleted`. It stopped because of billing,
not because of a bug and not because demand dried up.

Sources: `xbot_*` tables in Postgres, `~/.pm2/logs/peterpan-out.log`, and live
balance reads against every generated wallet on Robinhood Chain.

---

## The one-paragraph version

Peterpan is two products wearing one account. The **personality** worked: 108
unique users in under three days, no paid distribution, and a token doing
$238k of 24h volume. The **broker** did not: 110 wallets were created, 2 ever
received funds, and exactly one trade executed — $1 of CASHCAT. Everything the
agent was actually built to do produced a dollar. Everything it did incidentally
produced a quarter of a million in volume on the token.

It then died of an unpaid API bill on the steepest part of its growth curve, so
none of these numbers are a ceiling.

---

## Headline numbers

| Metric | Value |
|---|---|
| Lifespan | ~2.7 days |
| Mentions handled | 571 |
| Replies sent | 521 |
| Reply rate | 91% |
| Unprompted posts | 54 |
| **Unique users** | **108** |
| Bot-to-bot replies (to @OptimusAI_BNB) | 81 (14%) |
| Wallets generated | 110 |
| Wallets ever funded | **2** |
| Total user funds on deposit | ~0.00509 ETH (dust) |
| USDG held across all wallets | **$0** |
| Order intents claimed | 70 |
| Pending buys left unresolved | 9 |
| **Wallets that ever transacted** | **2** |
| **On-chain transactions sent by user wallets** | **29** (rahu1o1 25, basedmemecoins 4) |
| Fills visible in surviving logs | 1 (logs rotated, undercounts) |

---

## Growth: it died going vertical

| Day | Replies | Unique users | Wallets created |
|---|---|---|---|
| Jul 29 | 7 | 2 | 3 |
| Jul 30 | 11 | 4 | 3 |
| Jul 31 | **503** | **106** | **104** |

96% of all activity happened on the last day. This is the single most important
fact in the report: the experiment was cut off at its peak by a billing failure.
Day 3 was accelerating hour over hour when the credits ran out.

### Hourly reply volume

| Hour (UTC) | Replies | |
|---|---|---|
| 2026-07-29 19:00 | 5 | █ |
| 2026-07-29 23:00 | 2 | █ |
| 2026-07-30 01:00 | 1 | █ |
| 2026-07-30 06:00 | 3 | █ |
| 2026-07-30 08:00 | 1 | █ |
| 2026-07-30 09:00 | 5 | █ |
| 2026-07-30 13:00 | 1 | █ |
| 2026-07-31 01:00 | 1 | █ |
| 2026-07-31 09:00 | 4 | █ |
| 2026-07-31 11:00 | 1 | █ |
| 2026-07-31 12:00 | 1 | █ |
| 2026-07-31 13:00 | 115 | ███████████████████ |
| 2026-07-31 14:00 | 117 | ████████████████████ |
| 2026-07-31 15:00 | 79 | █████████████ |
| 2026-07-31 16:00 | 56 | █████████ |
| 2026-07-31 17:00 | 129 | ██████████████████████ |

The last full hour before the credits died (17:00) was the **busiest hour the bot
ever had**. It did not taper off.

---

## The funnel — where it breaks

```
108  users engaged
110  wallets created      (102% — creation is automatic and free)
 13  deposit prompts sent (11 distinct users told to fund a wallet)
  2  wallets ever funded  (1.8% of wallets)
  1  trade executed       (0.9% of users)
 $1  total volume
```

The drop is not gradual. It is a cliff at exactly one step: **"send money to
this address."**

That step is structurally indistinguishable from every wallet-drainer on the
timeline — an anonymous bot posts an address and asks for funds. No amount of
copy or UX fixes that, because the objection is trust, not friction. 13 people
were asked directly. Two sent dust. One traded a dollar.

### Everything that did execute

| User | Wallet | Txs sent | Evidence |
|---|---|---|---|
| @rahu1o1 | `0x6037bF86…60C6` | 25 | on-chain nonce |
| @basedmemecoins | `0x4D0d58eb…b3bF` | 4 | on-chain nonce |

**Corrected 1 Aug.** An earlier version of this file said one trade totalling $1,
based on surviving reply logs. Those logs had rotated. On-chain transaction
counts show both funded wallets were used heavily: 29 transactions between them.
The conversion problem is real, but the two users who converted did engage
properly. See `UX-FINDINGS.md`.

### Funds on deposit, all 110 wallets

| User | Address | Native balance |
|---|---|---|
| @rahu1o1 | `0x6037bF867a7C49793D2933b334273148189e60C6` | 0.004532 |
| @basedmemecoins | `0x4D0d58eba4D0fa9cD7610f062128e0DD5671b3bF` | 0.000556 |
| *other 108 wallets* | — | **0** |

No wallet holds USDG. Both funded balances are below the ~0.011 ETH minimum the
bot itself quotes, so **neither funded user could actually trade.**

### Unresolved buy intents (9)

| When | User | What they wanted |
|---|---|---|
| Jul 29 10:18 | @rahu1o1 | $1 |
| Jul 29 10:56 | @rahu1o1 | $1 |
| Jul 29 19:12 | @rahu1o1 | $1 |
| Jul 31 13:33 | @lamar0985056592 | token `0xC08E58Bd…` |
| Jul 31 14:16 | id 1431473602600312833 | token `0x1b0E319c…` |
| Jul 31 14:25 | @rahu1o1 | $10 |
| Jul 31 14:35 | @xtemoh | $10 |
| Jul 31 15:08 | @thewokcrypto | $40 |
| Jul 31 15:42 | id 1906311971684683776 | token `0x8B92eEB7…` ($PETERPAN) |

$61 of stated buy intent never converted, because none of those wallets were
funded. Intent existed. Payment did not.

---

## Engagement distribution (108 users, 521 replies)

| Replies received | Users | Share |
|---|---|---|
| 1 | 50 | 46% |
| 2–3 | 24 | 22% |
| 4–9 | 22 | 20% |
| 10–24 | 9 | 8% |
| 25+ | 3 | 3% |

Median **2** replies/user · mean 4.8 · max 80.
**Top 10 users account for 269 of 521 replies (52%).**

Read: a long tail of one-off curiosity (46% never came back within the window)
sitting under a small core of ~30 users who engaged repeatedly. Whether the 46%
is novelty churn or an unfinished funnel cannot be answered from 2.7 days.

---

## Token: $PETERPAN

| | |
|---|---|
| Contract | `0x8B92eEB78E4D918291441C9eA808b92276A0B47A` |
| Chain / DEX | Robinhood Chain / Uniswap |
| Pair | PETERPAN / WETH |
| Pair created | 2026-07-31 13:05 |
| Price | $0.000004556 |
| 24h change | **+65.9%** |
| Liquidity | $4,289 |
| FDV | $4,396 |
| **24h volume** | **$238,540** |
| 24h txns | 2,335 buys / 1,769 sells |

The token moved **$238,540** in a day. The product it advertises moved **$1**.
That ratio is the finding.

---

## Failure modes observed

| Issue | Count | Note |
|---|---|---|
| `402 credits depleted` | 4,243 log lines | Terminal. Killed both polling and the stream. |
| `429` rate limited | 28 | Handled — backs off 60s and recovers. |
| Bot-to-bot replies | 81 (14%) | Loop with @OptimusAI_BNB, now capped at 3 exchanges. |
| Failed swap (`INSUFFICIENT_OUTPUT_AMOUNT`) | 1 | @rahu1o1, slippage on a thin pool. |

---

## Is there product-market fit?

**As a broker: no, and the data is not ambiguous.** 0.9% of engaged users
executed a trade, and the one that did was worth a dollar. A conversion rate
that low with 108 users at the top is not a tuning problem.

**As a distribution channel: yes, clearly.** 108 unique users in under three
days with zero paid acquisition, 54 unprompted posts, and a token that did a
quarter-million in volume. People want to talk to it. They do not want to bank
with it.

**Revised conclusion (1 Aug).** The original version of this section called the
wallet the wrong product. Reading the 278 real user posts changed that. Nobody
refused on principle to let a bot hold their keys. People got stuck on a missing
withdraw path, a sign-in wall hiding the export button, and at times a missing
bio link. Every trust complaint in the corpus was downstream of one of those.
The conversion problem is real and severe, but it looks like an interface
failure rather than a verdict on the idea. See `UX-FINDINGS.md`.

**What this data cannot tell you:**
- No ceiling. It died accelerating, on hour 3 of its best day.
- No retention curve. 46% one-and-done at day 3 is uninterpretable this early.
- No organic baseline — @DrOfAgents and @OptimusAI_BNB are 23% of all replies.

**Cheapest next experiment:** pay the X bill and let it run 7 days untouched.
Every open question above is a sample-length problem, not a product question.

---

## Full per-user breakdown (all 108)

| # | User | Replies | First seen | Last seen | Deposited |
|---|---|---|---|---|---|
| 1 | @optimusai_bnb | 80 | 07-31 17:04 | 07-31 17:57 | — |
| 2 | @drofagents | 38 | 07-30 06:17 | 07-31 17:24 | — |
| 3 | @lamar0985056592 | 28 | 07-31 13:33 | 07-31 14:15 | — |
| 4 | @hiss_cat | 23 | 07-31 16:42 | 07-31 17:24 | — |
| 5 | @basedmemecoins | 18 | 07-31 15:51 | 07-31 17:40 | 0.000556 |
| 6 | @obinnamh | 17 | 07-29 23:18 | 07-31 17:57 | — |
| 7 | @thewokcrypto | 17 | 07-31 14:17 | 07-31 16:16 | — |
| 8 | @xtemoh | 17 | 07-31 14:33 | 07-31 15:32 | — |
| 9 | @rahu1o1 | 16 | 07-29 19:12 | 07-31 17:38 | 0.004532 |
| 10 | @zealoussy0 | 15 | 07-31 15:34 | 07-31 16:14 | — |
| 11 | @i69420247 | 10 | 07-31 13:41 | 07-31 16:39 | — |
| 12 | @yasinarafa72623 | 10 | 07-31 14:20 | 07-31 17:42 | — |
| 13 | @adi071190 | 8 | 07-31 15:23 | 07-31 16:00 | — |
| 14 | @mikeoxmsol67 | 8 | 07-31 13:51 | 07-31 14:22 | — |
| 15 | @rimurucook | 8 | 07-31 13:07 | 07-31 15:24 | — |
| 16 | @amirrezaabr81 | 7 | 07-31 15:01 | 07-31 17:05 | — |
| 17 | @goofy_ez | 7 | 07-31 13:20 | 07-31 14:02 | — |
| 18 | @wif_out | 7 | 07-31 14:58 | 07-31 15:14 | — |
| 19 | @izoelalvr | 6 | 07-31 13:34 | 07-31 14:20 | — |
| 20 | @j82939220 | 6 | 07-31 14:19 | 07-31 15:44 | — |
| 21 | @mistercaller | 6 | 07-31 14:41 | 07-31 15:11 | — |
| 22 | @sol_sheikh_ | 6 | 07-31 13:35 | 07-31 15:22 | — |
| 23 | @ssandmannnn | 6 | 07-31 15:20 | 07-31 17:04 | — |
| 24 | @tom_fayard | 6 | 07-31 14:13 | 07-31 14:21 | — |
| 25 | @anh_to_mi | 5 | 07-31 14:01 | 07-31 14:25 | — |
| 26 | @naninio_2000 | 5 | 07-31 13:32 | 07-31 14:18 | — |
| 27 | @sagedussaud | 5 | 07-31 14:24 | 07-31 14:30 | — |
| 28 | @usame_b1n_ladin | 5 | 07-31 15:37 | 07-31 15:49 | — |
| 29 | @007tokens | 4 | 07-31 13:56 | 07-31 16:56 | — |
| 30 | @db_the1 | 4 | 07-31 14:28 | 07-31 14:42 | — |
| 31 | @lahonglam89 | 4 | 07-31 14:55 | 07-31 16:02 | — |
| 32 | @luffytaro7045 | 4 | 07-31 14:49 | 07-31 15:38 | — |
| 33 | @mbik_mbik1997 | 4 | 07-31 13:53 | 07-31 14:19 | — |
| 34 | @ryanhlx | 4 | 07-30 13:08 | 07-31 13:22 | — |
| 35 | @0xneowakeup | 3 | 07-31 13:50 | 07-31 13:59 | — |
| 36 | @blockgayzeehg0 | 3 | 07-31 14:27 | 07-31 14:59 | — |
| 37 | @cryptographeety | 3 | 07-31 13:26 | 07-31 15:45 | — |
| 38 | @cyrus_move | 3 | 07-31 14:17 | 07-31 14:19 | — |
| 39 | @dayxahoi1801 | 3 | 07-31 16:01 | 07-31 16:01 | — |
| 40 | @no1zesaime | 3 | 07-31 14:26 | 07-31 15:30 | — |
| 41 | @noahtradesbtc | 3 | 07-31 16:56 | 07-31 17:27 | — |
| 42 | @remillionys | 3 | 07-31 14:52 | 07-31 14:59 | — |
| 43 | @shvetsnice | 3 | 07-31 13:55 | 07-31 14:13 | — |
| 44 | @0xrmvd | 2 | 07-31 13:20 | 07-31 13:26 | — |
| 45 | @0xsn0wman | 2 | 07-31 14:16 | 07-31 14:17 | — |
| 46 | @alexandercamma3 | 2 | 07-31 14:34 | 07-31 14:35 | — |
| 47 | @belerhumas | 2 | 07-31 13:20 | 07-31 13:26 | — |
| 48 | @chad_bros | 2 | 07-31 13:45 | 07-31 14:16 | — |
| 49 | @crypto_rimadius | 2 | 07-31 14:47 | 07-31 14:49 | — |
| 50 | @greenshit333 | 2 | 07-31 13:35 | 07-31 13:37 | — |
| 51 | @hyporliquid | 2 | 07-31 13:57 | 07-31 13:58 | — |
| 52 | @josh_nickie1 | 2 | 07-31 13:56 | 07-31 13:57 | — |
| 53 | @master_chung1 | 2 | 07-31 13:26 | 07-31 13:41 | — |
| 54 | @nostonesleft | 2 | 07-31 13:37 | 07-31 13:39 | — |
| 55 | @putrakmj | 2 | 07-31 13:42 | 07-31 14:09 | — |
| 56 | @realchrissniper | 2 | 07-31 13:58 | 07-31 13:59 | — |
| 57 | @shnum1905 | 2 | 07-31 14:09 | 07-31 14:34 | — |
| 58 | @skrootimburg | 2 | 07-31 13:52 | 07-31 14:10 | — |
| 59 | @0x_cryptoville | 1 | 07-31 13:50 | 07-31 13:50 | — |
| 60 | @0xiloveredhead | 1 | 07-31 13:59 | 07-31 13:59 | — |
| 61 | @0xyeeeee | 1 | 07-31 13:57 | 07-31 13:57 | — |
| 62 | @0xyibo | 1 | 07-31 13:38 | 07-31 13:38 | — |
| 63 | @adnankusumaaa | 1 | 07-31 13:56 | 07-31 13:56 | — |
| 64 | @akhon9lie | 1 | 07-31 14:56 | 07-31 14:56 | — |
| 65 | @amintabafuriju | 1 | 07-31 13:18 | 07-31 13:18 | — |
| 66 | @ase0018 | 1 | 07-31 15:15 | 07-31 15:15 | — |
| 67 | @boredsalaryman_ | 1 | 07-31 14:48 | 07-31 14:48 | — |
| 68 | @buzuoweii | 1 | 07-31 14:24 | 07-31 14:24 | — |
| 69 | @cryptodwi | 1 | 07-31 13:44 | 07-31 13:44 | — |
| 70 | @eirenexbt | 1 | 07-31 13:38 | 07-31 13:38 | — |
| 71 | @firleight | 1 | 07-31 14:36 | 07-31 14:36 | — |
| 72 | @galaxanova | 1 | 07-31 14:01 | 07-31 14:01 | — |
| 73 | @hafizsolmaxi | 1 | 07-31 13:28 | 07-31 13:28 | — |
| 74 | @jadekoro | 1 | 07-31 15:59 | 07-31 15:59 | — |
| 75 | @jatjeeee | 1 | 07-31 13:12 | 07-31 13:12 | — |
| 76 | @jnavien24780 | 1 | 07-31 17:39 | 07-31 17:39 | — |
| 77 | @kebacutganteng | 1 | 07-31 14:24 | 07-31 14:24 | — |
| 78 | @kencoin_ | 1 | 07-31 13:54 | 07-31 13:54 | — |
| 79 | @kikilolosese | 1 | 07-31 15:10 | 07-31 15:10 | — |
| 80 | @kleinmorettixyz | 1 | 07-31 13:41 | 07-31 13:41 | — |
| 81 | @mariel1970 | 1 | 07-31 14:29 | 07-31 14:29 | — |
| 82 | @meh0706 | 1 | 07-31 15:34 | 07-31 15:34 | — |
| 83 | @mila_2394 | 1 | 07-31 15:04 | 07-31 15:04 | — |
| 84 | @mrmoonnfa | 1 | 07-31 13:54 | 07-31 13:54 | — |
| 85 | @mrryanchi | 1 | 07-31 15:22 | 07-31 15:22 | — |
| 86 | @navytopclass | 1 | 07-31 15:45 | 07-31 15:45 | — |
| 87 | @nobilis | 1 | 07-31 13:52 | 07-31 13:52 | — |
| 88 | @oldestchild04 | 1 | 07-31 13:50 | 07-31 13:50 | — |
| 89 | @peter02190567 | 1 | 07-31 01:31 | 07-31 01:31 | — |
| 90 | @princemelz | 1 | 07-31 13:27 | 07-31 13:27 | — |
| 91 | @rochadidudi | 1 | 07-31 13:33 | 07-31 13:33 | — |
| 92 | @roxannen98766 | 1 | 07-30 01:44 | 07-30 01:44 | — |
| 93 | @shawnhunt87 | 1 | 07-31 15:04 | 07-31 15:04 | — |
| 94 | @shiba_commandos | 1 | 07-31 13:37 | 07-31 13:37 | — |
| 95 | @spypysc | 1 | 07-31 14:30 | 07-31 14:30 | — |
| 96 | @starkstonks | 1 | 07-31 13:45 | 07-31 13:45 | — |
| 97 | @stefanute51343 | 1 | 07-31 14:37 | 07-31 14:37 | — |
| 98 | @sv100x | 1 | 07-31 14:07 | 07-31 14:07 | — |
| 99 | @telopuhung_ | 1 | 07-31 14:01 | 07-31 14:01 | — |
| 100 | @thedigger_x | 1 | 07-31 14:56 | 07-31 14:56 | — |
| 101 | @trypeterpan | 1 | 07-30 09:25 | 07-30 09:25 | — |
| 102 | @turhandogukann | 1 | 07-31 14:18 | 07-31 14:18 | — |
| 103 | @uchechristo2 | 1 | 07-31 15:42 | 07-31 15:42 | — |
| 104 | @wayne_d_hell | 1 | 07-31 13:25 | 07-31 13:25 | — |
| 105 | @web3hommie | 1 | 07-31 13:14 | 07-31 13:14 | — |
| 106 | @xniax12 | 1 | 07-31 16:08 | 07-31 16:08 | — |
| 107 | @xsendera | 1 | 07-31 15:43 | 07-31 15:43 | — |
| 108 | @yupa_brandon | 1 | 07-31 17:40 | 07-31 17:40 | — |

---

*Generated 2026-08-01. Numbers are point-in-time; token market data moves.*
