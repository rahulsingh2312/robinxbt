"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const [handle, setHandle] = useState("");
  const router = useRouter();

  return (
    <main>
      <p className="eyebrow">XBOT · ROBINHOOD CHAIN</p>
      <h1>Talk to the bot. Own the bag.</h1>
      <p className="muted">
        Mention the bot on X and it opens a wallet for you on Robinhood Chain.
        Fund it with ETH, tell the bot to buy, and everything it fills — tokenized
        stocks, memecoins, whatever — lands here, in a wallet only you can claim.
      </p>
      <div className="card">
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
          />
          <button type="submit">View portfolio</button>
        </form>
      </div>
      <p className="risk">
        Buying happens only by talking to the bot on X. This site is where you see
        and manage what you own: withdraw to any address or export your key.
      </p>
    </main>
  );
}
