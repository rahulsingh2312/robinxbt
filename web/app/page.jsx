"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// X's verified seal, drawn with the platform's own badge path so it reads as
// the real thing; gold, like an organization account.
function GoldTick() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-label="Verified account" style={{ verticalAlign: "-3px", marginLeft: 2 }}>
      <defs>
        <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4c33f" />
          <stop offset="1" stopColor="#cb8600" />
        </linearGradient>
      </defs>
      <path
        fill="url(#gold)"
        d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"
      />
    </svg>
  );
}

// The hero is the product: an actual conversation, because the entire app IS
// a conversation. The page's one job is to make you go tweet at the bot.
export default function Home() {
  const [handle, setHandle] = useState("");
  const router = useRouter();

  return (
    <main>
      <nav className="bar">
        <a className="wordmark" href="/"><img src="/pfp-peterpan.jpg" alt="" />peterpan.</a>
        <span className="pill"><span className="dot" />ROBINHOOD CHAIN · LIVE</span>
      </nav>

      <header className="hero">
        <p className="eyebrow">The bot that buys when you tell it to</p>
        <h1>Talk trash. Get talked back.<br /><em>Own the bag anyway.</em></h1>
        <p className="sub">
          Mention the bot on X and it opens a wallet in your name on Robinhood
          Chain. Fund it with ETH or USDG, say “buy”, and tokenized stocks or
          memecoins land in a wallet only you can claim.
        </p>
      </header>

      <div className="divider"><span>One real conversation</span></div>

      <section className="thread" aria-label="Example conversation">
        <div className="tweet you">
          <div className="who-row">
            <img src="/pfp-drofagents.jpg" alt="" />
            <div className="who">Dr Of Agents <small>@DrOfAgents</small></div>
          </div>
          <p>@TryPeterpan whats up with todays market, got 10 bucks to invest</p>
        </div>
        <div className="tweet">
          <div className="who-row">
            <img src="/pfp-peterpan.jpg" alt="" />
            <div className="who">Peterpan <GoldTick /> <small>@TryPeterpan</small></div>
          </div>
          <p>that’s a sandwich, not an investment. put it in something stupid enough to match the energy. $CASHCAT maybe.</p>
        </div>
        <div className="tweet you">
          <div className="who-row">
            <img src="/pfp-drofagents.jpg" alt="" />
            <div className="who">Dr Of Agents <small>@DrOfAgents</small></div>
          </div>
          <p>buy it for me</p>
        </div>
        <div className="tweet fill">
          <div className="who-row">
            <img src="/pfp-peterpan.jpg" alt="" />
            <div className="who">Peterpan <GoldTick /> <small>@TryPeterpan</small></div>
          </div>
          <p><strong>Bought ~273 CASHCAT for $10.</strong> It’s in your wallet — check the portfolio link in bio to see and manage your assets.</p>
        </div>
      </section>

      <div className="divider"><span>How it works</span></div>

      <section className="steps-row">
        <div>
          <span className="n">01</span>
          <h2>Talk</h2>
          <p>Mention @TryPeterpan. Ask for a read, get roasted, hear a ticker.</p>
        </div>
        <div>
          <span className="n">02</span>
          <h2>Fund</h2>
          <p>Your wallet exists the moment you tweet. Top it up with ETH or USDG.</p>
        </div>
        <div>
          <span className="n">03</span>
          <h2>Own</h2>
          <p>Say “buy”. The fill lands on-chain in your wallet — not ours.</p>
        </div>
      </section>

      <div className="divider"><span>Your portfolio</span></div>

      <section className="hero" style={{ gap: 14 }}>
        <form
          className="row"
          style={{ justifyContent: "center", width: "100%", maxWidth: 460 }}
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
          <button type="submit">View</button>
        </form>
        <p className="fineprint" style={{ margin: 0 }}>
          Buying only happens by talking to the bot on X. This site shows what you own and lets you manage it —
          sell, withdraw, or export your key any time.
        </p>
      </section>

      <div className="divider" aria-hidden="true"><span>· · ·</span></div>

      <p className="fineprint">
        Not investment advice; tokens can go to zero. Robinhood Stock Tokens are
        not offered to U.S., Canadian, UK, or Swiss persons under the issuer’s
        terms. Wallets are custodial until you export your key — which you can
        do whenever you want.
      </p>
      <p className="fineprint"><a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a></p>
    </main>
  );
}
