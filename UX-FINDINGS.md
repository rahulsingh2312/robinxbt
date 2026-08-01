# What users actually told us, and what we should fix

Peterpan, 29 to 31 July 2026. Based on 278 real user posts pulled from the X API,
every wallet checked on chain, and the reply logs.

---

## First, a correction

In the earlier analytics file I concluded that people would not fund a wallet a
bot gave them, and that the problem was trust at the deposit step. Reading the
actual messages, that is wrong, or at least it is only half the story.

Two things I had missed.

The first is that I only checked native and USDG balances. I never checked
transaction counts. When you look at those, both funded wallets were used
heavily. @rahu1o1 sent 25 transactions and @basedmemecoins sent 4. That is 29
transactions between them, not the single fill I reported. The reply logs had
rotated, so the log based count was simply incomplete.

The second is the more important one. The loudest complaints in the whole corpus
are not about depositing. They are about getting money back out. People did put
funds in. Then they could not work out how to take them out, and that is when
they started shouting.

So the corrected read is this. Almost nobody deposited, but the handful who did
used the product properly. The thing that turned into a public mess was not the
way in. It was the way out.

---

## The twelve minutes that did the most damage

This is worth reading in order, because it is the clearest thing in the data.

On 31 July at 16:45, @basedmemecoins asks a reasonable question.

> How can I withraw it? I dont see any button or way to do so and you wont send
> it for me to my wallet

Two minutes later:

> There is no way to export the key. Teach me how I can get my funds off or else
> I will just assume they are stuck forever

Then screenshots start.

> Where is it? I see no export private key button
> That is a screenshot from my laptop. There is no export button
> Look hard for me. Where is it? This is a scam unless people can withdraw
> There it is again. No withrawl button. NO way to get funds off. Show me where
> or this is cooked.

At 16:57, twelve minutes after the first question, it becomes:

> your a scam none of that exists so money is stuck forever

And then at 16:59, another user answers it for us.

> Hey you didn't sign in your X account in the website. Sign in first then you'll
> see export button. I just checked and there is export

The export button was there the whole time. It was behind an X sign in that
nobody told him about. A bystander did our support for us, two minutes after the
accusation had already gone public, and the accusation is what everyone else
reading the thread will remember.

Peterpan ran out of API credits an hour later, so it spent the last hour of its
life unable to answer a scam accusation that was caused by a missing sentence.

---

## What people actually got stuck on

Out of 278 user posts:

| Problem | Posts | Distinct users |
|---|---|---|
| Getting funds out (withdraw, export key, sell) | 14 | 5 |
| Calling it a scam or a rug | 13 | 9 |
| Deposit and funding questions | 18 | 8 |
| Cannot find something (link, page, button) | 9 | 5 |
| How do I use this at all | 5 | 4 |

Three users did both. They asked how to withdraw, got no clear answer, and then
called it a scam. That sequence matters more than the totals. The scam
accusations were not people being cynical from the start. They were people who
had already committed, could not get out, and reasonably assumed the worst.

The other complaints all point the same way.

> There is no link in your bio, fix it you stupid
> (@YasinArafa72623)

> How do I sign into my portfolio page?
> (@i69420247)

> Ok you got one open for me… how do I access it. I need to find it rightttttt?
> (@i69420247)

> I understand the deposit but how do I sell? And how do I get that money back.
> (@TheWokCrypto)

> Where is the deposit address? Can't find it. Show me
> (@Zealoussy0)

At one point the bio link was apparently missing altogether. If that is true for
even part of the run, then a share of our 110 wallet holders had no route to
their own portfolio at all, which is exactly what you suspected.

---

## So was it trust, or was it UX

It was both, and they were the same thing.

Nobody in this corpus objected to the idea of a bot holding their keys. Nobody
said "I do not trust an AI with my money" as a starting position. What actually
happened is that people tried it, hit a wall, and then reached for the word scam
because that is the only word available on crypto Twitter for "I cannot get my
money out and nobody is explaining why".

Trust here was not a belief people held before they arrived. It was an outcome of
the interface. Every trust problem in this dataset was manufactured by a missing
button, a missing link, or a missing sentence.

That is much better news than the alternative. A belief problem is hard to fix.
A missing sentence is not.

---

## What the funnel really looks like

```
108  users talked to it
110  wallets created automatically
 13  people were told to deposit
  2  actually deposited
  2  of those 2 then used it properly (29 transactions between them)
  5  people publicly asked how to get their money out
  9  people called it a scam
```

The conversion problem is entirely between "told to deposit" and "deposited".
That step lost 11 of 13 people. But notice the bit after it. Of the two who got
through, both used it a lot. There is no evidence at all that the product is
boring once you are in. The evidence is that almost nobody gets in, and the ones
who do cannot find the exit.

---

## What I would change, in order

**1. Put the withdraw and export path in front of people before they deposit.**
Not after. The single most effective change available is that the deposit message
should say how to get money out, in the same message. Something like: "your
wallet is at 0x… Send funds there. You can export the private key any time from
your portfolio page after signing in with X, and take everything with you." That
one sentence would have prevented the entire BasedMemeCoins thread.

**2. Fix the sign in wall on the portfolio page, or at least explain it.**
The export button exists and people cannot see it because they are not signed in.
Either show a signed out state that says "sign in with X to see your wallet and
export your key", or drop the requirement. Right now the page silently looks like
a product with no exit.

**3. Check the bio link, and keep checking it.**
At least one user reported it missing. This is the only route to the portfolio,
so if it breaks, the whole product is invisible. It should be monitored, not
assumed.

**4. Make the bot answer "how do I withdraw" from a fixed script, not the model.**
We already do this for the contract address, and for exactly the same reason. It
is too important to improvise. A withdrawal question should always get the same
correct, calm, step by step answer with the sign in step spelled out. It should
not get a roast.

**5. Drop the persona when someone says their money is stuck.**
The floor already covers grief and real life. It should cover this too. When
somebody thinks they have lost money, being funny reads as being evasive, and
evasive reads as guilty. One straight answer, then back to normal.

**6. Send a receipt after every fill.**
"Bought X for $Y. It is in your wallet at 0x… Export your key any time from your
portfolio page." People asked where their money went because nothing ever told
them where it went.

---

## How to make people trust us more

The pattern in the data is simple. People trusted us right up until they could
not verify something for themselves. So the fix is to make everything verifiable
without asking us.

**Show the exit before the entrance.** Any product holding somebody's money
should lead with how they take it back. We buried it behind a sign in. Leading
with it costs nothing and removes the only real objection anybody raised.

**Never make a user ask twice.** Every escalation in this dataset went the same
way. Question, no useful answer, question again, accusation. The second
unanswered question is where trust dies. If somebody asks about withdrawal twice,
that should be treated as an incident, not a mention.

**Let them prove it themselves.** The strongest thing we have is that the key is
exportable, so the funds are genuinely theirs. That is a real answer to "is this
a rug" and it is currently the hardest thing on the site to find. It should be
the easiest.

**Answer the accusation in public, with specifics.** When someone said scam, the
right reply was not a joke. It was "here is the export button, here is your
address, here is the transaction". We had all three and used none of them.

**Be boring about money and funny about everything else.** The personality is the
reason anyone showed up, and it should stay exactly as it is for market takes. It
just should not be running the support desk.

**Publish the wallet addresses and let people check the chain.** Everything the
bot does is on a public chain. Making that easy to audit turns "trust me" into
"go look", which is the only version of trust that survives crypto Twitter.

---

## What we still cannot say

The sample is small and it ended badly. 278 posts over three days, and the run
was cut off by an unpaid API bill on its busiest hour. Five people complaining
about withdrawal is five people, not a statistically meaningful cohort, and one
of them accounted for seven of the fourteen posts.

What I am confident about is the direction. Every single person who got stuck got
stuck in the same place, the fix for that place is small, and the two people who
made it past it used the product a lot. That is a much better position than the
earlier report suggested.

What we cannot know until it runs again with the fixes in is whether the deposit
step converts at all once the exit is visible. That is the real experiment, and
it has not been run yet.

---

*Written 1 August 2026. Sources: 278 user posts via X API recent search, on chain
balance and nonce reads across all 110 wallets, peterpan reply logs, and the
xbot_ tables in Postgres.*
