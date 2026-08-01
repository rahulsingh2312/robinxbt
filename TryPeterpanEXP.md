# We put an AI agent on X that trades out of a reply. Here is what actually happened.

@TryPeterpan went live on 29 July and spent 2.7 days executing real trades for
strangers who tweeted at it. This is the writeup: what people did, where they got
stuck, what it cost, and how it died.

Partway through we launched a second, much smaller account, @OptimusAI_BNB, to
see whether the format itself travels or whether Peterpan was a one off. It is
fifteen hours old and holds nothing. It is a side test, not a twin, and it shows
up here only where it tells us something Peterpan alone could not.

This is written up honestly, including the parts where we were wrong about our
own product.

---

## What we ran

**@TryPeterpan** went live on 29 July. It executes trades out of a reply. You
tweet "buy $20 of X" at it and it fills the order from a wallet it generates for
you on Robinhood Chain. It has custody of the keys until you export them.

**@OptimusAI_BNB** went live on 31 July as a much smaller follow on, to test
whether the format travels beyond one account. It is a markets account with a
live data feed, obsessed with SpaceX, carrying its own token on BNB Chain. It
holds nothing and cannot touch anyone's money. It talks. Fifteen hours of it
exist, so nothing here rests on it.

Both have their own memecoin. Both are labelled as automated. Neither is
affiliated with any company they talk about.

---

## The numbers

|  | Peterpan | Optimus |
|---|---|---|
| Live for | 2.7 days | 15 hours |
| Mentions handled | 571 | 152 |
| Replies sent | 521 | 150 |
| Unique users | **108** | **16** |
| Unprompted posts | 54 | 0 |
| Wallets created | 110 | none, by design |
| Wallets ever funded | **2** | n/a |
| Wallets that transacted | 2 (29 transactions) | n/a |
| Scam accusations received | **13** | **0** |

Peterpan's growth by day: 7 replies, then 11, then **503**. Ninety six percent of
everything it ever did happened on its final day, and its busiest hour was the
last full hour before it died. It did not run out of demand. It ran out of X API
credits, mid climb, and stopped answering.

Optimus is fifteen hours old and 46 percent of its traffic is Peterpan. Treat its
numbers as an early signal, not a result.

---

## The twelve minutes that cost us the most

This is the part worth reading in full, because it is the clearest thing in the
data.

On 31 July at 16:45, a user asks a completely reasonable question.

> How can I withraw it? I dont see any button or way to do so and you wont send
> it for me to my wallet

Two minutes later:

> There is no way to export the key. Teach me how I can get my funds off or else
> I will just assume they are stuck forever

Then the screenshots start.

> Where is it? I see no export private key button
> There is no export button, there is no way to sell or withrawl the positions
> Look hard for me. Where is it? This is a scam unless people can withdraw
> There it is again. No withrawl button. NO way to get funds off.

At 16:57, twelve minutes after the first question, it arrives where you knew it
was going.

> your a scam none of that exists so money is stuck forever

And then, at 16:59, a different user answers it for us.

> Hey you didn't sign in your X account in the website. Sign in first then you'll
> see export button. I just checked and there is export

The export button was there the entire time. It was behind an X sign in that we
never mentioned. A bystander did our support for us, two minutes too late, and
the accusation is the thing everyone else in that thread will remember.

Peterpan ran out of API credits an hour later. It spent the last hour of its life
unable to answer a scam accusation that was caused by a missing sentence.

---

## What people actually got stuck on

We pulled 278 real user posts and read them.

| Problem | Posts | Distinct users |
|---|---|---|
| Getting funds out (withdraw, export, sell) | 14 | 5 |
| Calling it a scam or a rug | 13 | 9 |
| Deposit and funding questions | 18 | 8 |
| Cannot find something (link, page, button) | 9 | 5 |
| How do I use this at all | 5 | 4 |

Three users did both. They asked how to withdraw, got nothing useful, then called
it a scam. That order matters more than the totals do. These were not cynics who
arrived expecting a rug. They were people who had already committed and could not
find the door.

The rest of the complaints all point the same direction.

> There is no link in your bio, fix it you stupid

> How do I sign into my portfolio page?

> Ok you got one open for me… how do I access it. I need to find it rightttttt?

> I understand the deposit but how do I sell? And how do I get that money back.

> Where is the deposit address? Can't find it. Show me

At some point the bio link was apparently missing altogether. That link is the
only route to the portfolio page, so for whatever window that was true, a share
of our users had no way to reach their own wallet at all.

---

## What the sibling account hinted at

The small side test did tell us one thing worth writing down.

Peterpan holds keys. It got 13 scam accusations from 9 people. Optimus holds
nothing, and across 79 posts from 15 real users it got **zero** — despite being
ruder, more aggressive, and carrying a token of its own.

Fifteen users is not a control group and we are not going to pretend it is. The
accounts differ in more than custody: different chain, different age, different
audience, and half of Optimus's traffic is Peterpan talking to it. Treat it as a
hint, not a finding.

The reason it is worth mentioning at all is that it points the same way the
Peterpan data already does. We assumed people would not trust an AI with their
money. Nobody in 278 posts said that. What they said, over and over, was a
version of "I cannot find how to get my money out." The distrust was not a belief
anyone showed up with. It was something our interface manufactured, in about
twelve minutes, from a hidden button.

That is much better news than the alternative. A belief problem is hard. A
missing sentence is not.

---

## The funnel, honestly

```
108  people talked to it
110  wallets created automatically
 13  people were told to deposit
  2  actually deposited
  2  of those 2 then used it properly, 29 transactions between them
  5  publicly asked how to get their money back out
  9  called it a scam
```

Almost everything is lost between "told to deposit" and "deposited". Eleven of
thirteen people stopped there.

But look at what happens after. Of the two who got through, both used it heavily.
There is no evidence anywhere in this data that the product is boring once you
are inside it. The evidence is that hardly anyone gets in, and the ones who do
cannot find the exit.

We should also be straight about one correction. An earlier internal version of
this analysis said one trade worth one dollar. That was wrong. It was based on
reply logs that had rotated away. On chain transaction counts show 29
transactions across the two funded wallets. The conversion problem is real and
severe. The engagement of the people who converted was not the problem.

---

## Where the money actually moved

| | $PETERPAN | $OptiCoin |
|---|---|---|
| 24h volume | **$238,540** | $63,296 |
| 24h change | +65.9% | -5.3% |
| Liquidity | $4,289 | $8,392 |
| 24h transactions | 2,335 buys / 1,769 sells | 656 buys / 556 sells |

Three hundred thousand dollars of volume moved through the tokens. Two people
deposited into the actual product.

Peterpan is extremely good at getting attention and extremely bad, so far, at
converting it into product usage. That is worth saying plainly rather than
dressing up.

---

## What it cost to run

X moved to pay per use in February 2026. There is no monthly floor, you just pay
per call: $0.005 for every post read, $0.015 for every post created, and $0.20 if
a post contains a link. We strip links from every outbound post, which was
written as an anti phishing measure but happens to cap that cost too.

Usage pulled from X's own reporting, not estimated:

| | Peterpan | Optimus |
|---|---|---|
| Posts read | 1,343 | 610 |
| Posts created | 575 (521 replies, 54 posts) | 150 |
| Read cost at $0.005 | $6.72 | $3.05 |
| Write cost at $0.015 | $8.63 | $2.25 |
| **Total** | **~$15.35** | **~$5.30** |

**Combined: roughly $20.65 for the entire experiment.**

Two things worth flagging so the numbers are not oversold. About $2.46 of
Optimus's spend is not the bot at all, it is us pulling 492 posts back out of the
API to write this report. So Optimus itself cost around $2.84 to run for fifteen
hours. And the read figures come from X's usage endpoint, which counts posts
retrieved against the project cap. We are assuming that maps one to one onto
billed reads.

Now the uncomfortable part. Peterpan died because its credits ran out, and its
total consumption was about fifteen dollars. Whatever balance was loaded on that
account, it was small enough that roughly fifteen dollars of API calls exhausted
it, in the middle of the best hour the account ever had. The 4,243 failed calls
that followed cost nothing, because failed calls are not billed. They just meant
nobody got an answer.

So the honest accounting is this. We spent about twenty dollars total. It bought
124 unique people talking to two bots, 725 published posts, and around $300,000
of trading volume across the two tokens. It works out to roughly fourteen cents
per unique user reached, with no paid distribution of any kind.

And then the whole thing stopped over an unpaid bill smaller than a dinner.

The lesson is not that it was cheap, although it was. The lesson is that we let
a fifteen dollar failure mode sit in front of the only asset that was working.
There was no billing alert, no credit balance check, and no alarm when 4,243
consecutive API calls failed. That is the cheapest thing on this entire list to
fix and it was the only thing that actually killed us.

---

## What we are changing

**Put the exit in the deposit message.** Any message that gives someone a deposit
address will now also tell them how to take everything back out, in the same
message. That single sentence would have prevented the entire thread above.

**Fix the sign in wall.** The export button exists and people cannot see it
because they are not signed in. Either the signed out page says "sign in with X
to see your wallet and export your key", or the requirement goes.

**Monitor the bio link.** It is the only route to the portfolio. If it breaks, the
product is invisible, and we found out it had broken from an insult.

**Script the withdrawal answer.** We already refuse to let the model improvise a
contract address, for exactly the same reason. A withdrawal question is too
important to improvise. It gets the same correct, calm answer every time, with
the sign in step spelled out, and it never gets a joke.

**Drop the persona when someone says their money is stuck.** Funny reads as
evasive. Evasive reads as guilty.

**Send a receipt after every fill,** with the address and the export instructions.
People asked where their money went because nothing had told them.

---

## What we would tell anyone building one of these

Show the exit before the entrance. If you hold someone's money, lead with how
they take it back. It costs nothing and it removes the only objection anyone
actually raised.

Never make a user ask twice. Every escalation we had went question, no answer,
question again, accusation. The second unanswered question is where trust dies.
Treat it as an incident, not a mention.

Let people verify without asking you. Our strongest fact is that the key is
exportable, so the funds are genuinely theirs. It is currently the hardest thing
on the site to find. It should be the easiest.

Answer accusations with specifics, in public. When somebody said scam, the right
reply was the export button, their address, and the transaction. We had all
three. We used a joke instead.

Be boring about money and funny about everything else. The personality is the
entire reason anyone showed up. It just should not be running the support desk.

---

## What we still do not know

The sample is small and it ended badly. 278 posts over three days, cut off by an
unpaid API bill during the busiest hour the account ever had. Five people
complained about withdrawal, and one of them wrote half of those posts. Optimus
is fifteen hours old and nearly half its traffic is the other bot.

We do not know whether the deposit step converts at all once the exit is visible,
because that version has never run. We do not know what day five looks like,
because there was no day five.

What we are confident about is the direction. Everyone who got stuck got stuck in
the same place. The fix for that place is small. The agent without custody
attracted no distrust at all. And when Peterpan went down, users noticed and
asked us to bring it back, which is not what a dead experiment looks like.

> peterpan went offline, might want to revive the server

That is the most encouraging line in the entire dataset.

---

*Sources: 278 user posts via the X API, on chain balance and transaction counts
across all 110 generated wallets, both agents' reply logs, and our own database.
Written 1 August 2026. Token market data is point in time and moves.*
