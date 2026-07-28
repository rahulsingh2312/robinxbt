"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The hero is the product: an actual conversation, because the entire app IS
// a conversation. The page's one job is to make you go tweet at the bot.
export default function Home() {
  const [handle, setHandle] = useState("");
  const router = useRouter();

  return (
    <main className="stack" style={{ gap: 36 }}>
      <nav className="spread">
        <a className="wordmark" href="/">peterpan<span>.</span></a>
        <span className="pill live">ROBINHOOD CHAIN · LIVE</span>
      </nav>

      <header className="stack" style={{ gap: 12 }}>
        <p className="eyebrow">The bot that buys when you tell it to</p>
        <h1>Talk trash. Get talked back. Own the bag anyway.</h1>
        <p className="muted" style={{ maxWidth: "56ch", margin: 0 }}>
          Mention the bot on X and it opens a wallet in your name on Robinhood
          Chain. Fund it with ETH or USDG, say “buy”, and tokenized stocks or
          memecoins land in a wallet only you can claim — sell, withdraw, or
          export the key any time, right here.
        </p>
      </header>

      <section className="thread" aria-label="Example conversation">
        <div className="tweet you">
          <div className="who">rahul. <small>@rahu1o1</small></div>
          <p>@TryPeterpan whats up with todays market, got 10 bucks to invest</p>
        </div>
        <div className="tweet">
          <div className="who">Peterpan <small>@TryPeterpan</small></div>
          <p>that’s a sandwich, not an investment. put it in something stupid enough to match the energy. $CASHCAT maybe.</p>
        </div>
        <div className="tweet you">
          <div className="who">rahul. <small>@rahu1o1</small></div>
          <p>buy it for me</p>
        </div>
        <div className="tweet fill">
          <div className="who">Peterpan <small>@TryPeterpan</small></div>
          <p><strong>Bought ~273 CASHCAT for $10.</strong> It’s in your wallet — check the portfolio link in bio to see and manage your assets.</p>
        </div>
      </section>

      <section className="steps">
        <div className="card">
          <h2>1 · Talk</h2>
          <p>Mention @TryPeterpan. Ask for a read, get roasted, hear a ticker.</p>
        </div>
        <div className="card">
          <h2>2 · Fund</h2>
          <p>Your wallet exists the moment you tweet. Top it up with ETH or USDG on Robinhood Chain.</p>
        </div>
        <div className="card">
          <h2>3 · Own</h2>
          <p>Say “buy”. The fill lands on-chain in your wallet — not ours. Manage everything here.</p>
        </div>
      </section>

      <section className="card stack" style={{ gap: 12 }}>
        <h2>Find your portfolio</h2>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            const cleaned = handle.trim().replace(/^@/, "").toLowerCase();
            if (cleaned) router.push(`/u/${encodeURIComponent(cleaned)}`);
          }}
        >
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="@your_x_handle"
            aria-label="X handle"
            style={{ flex: 1 }}
          />
          <button type="submit">View portfolio</button>
        </form>
        <p className="fineprint" style={{ margin: 0 }}>
          Buying only happens by talking to the bot on X. This site shows what you own and lets you manage it.
        </p>
      </section>

      <p className="fineprint">
        Not investment advice; tokens can go to zero. Robinhood Stock Tokens are
        not offered to U.S., Canadian, UK, or Swiss persons under the issuer’s
        terms. Wallets are custodial until you export your key — which you can
        do whenever you want.
      </p>
    </main>
  );
}
