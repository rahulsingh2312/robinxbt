export const metadata = { title: "Terms of Service · Peterpan" };

// Plain-language terms that describe what the service actually does. Legal
// prose is kept honest: custodial wallets, real trades, real risk.
export default function Terms() {
  return (
    <main>
      <nav className="bar">
        <a className="wordmark" href="/"><img src="/pfp-peterpan.jpg" alt="" />peterpan.</a>
        <span className="pill">TERMS</span>
      </nav>

      <header className="hero" style={{ textAlign: "left", alignItems: "flex-start", gap: 10 }}>
        <p className="eyebrow">Terms of Service</p>
        <h1 style={{ fontSize: "2.2rem" }}>The deal, in plain words.</h1>
        <p className="muted" style={{ margin: 0 }}>Last updated July 29, 2026 · Contact: @TryPeterpan on X</p>
      </header>

      <div className="stack" style={{ gap: 26, marginTop: 40, maxWidth: "62ch" }}>
        <section>
          <h2>1 · What this is</h2>
          <p className="muted">
            Peterpan is an automated agent on X. When you interact with it, it
            creates a blockchain wallet associated with your X account on
            Robinhood Chain (chain id 4663). When you instruct it to buy, it
            swaps funds you deposited for tokens through public decentralized
            exchanges. This site displays your wallet and lets you sell,
            withdraw, and export your private key after signing in with X.
          </p>
        </section>
        <section>
          <h2>2 · Custody and your key</h2>
          <p className="muted">
            Until you export your private key, the service holds it for you in
            encrypted form. You can export it at any time and take full,
            exclusive control. We cannot reverse transactions, recover funds
            sent to wrong addresses or wrong networks, or restore keys after a
            catastrophic loss of our systems. Do not deposit more than you can
            afford to lose.
          </p>
        </section>
        <section>
          <h2>3 · Nothing here is advice</h2>
          <p className="muted">
            The bot's replies are entertainment with a rude persona. They are
            not investment advice, a recommendation, or a fiduciary
            relationship. Tokens, including tokenized-equity products, are
            volatile and can go to zero.
          </p>
        </section>
        <section>
          <h2>4 · Eligibility and restricted products</h2>
          <p className="muted">
            You are responsible for the laws of your jurisdiction. Robinhood
            Stock Tokens are not offered to U.S., Canadian, UK, or Swiss
            persons under their issuer's terms; do not use this service to
            acquire products you are not permitted to hold. The service is not
            for persons under 18.
          </p>
        </section>
        <section>
          <h2>5 · Execution</h2>
          <p className="muted">
            Orders execute on-chain at market with a slippage bound and a
            per-order cap. Fills are final when the chain confirms them.
            Network fees, pool fees, and price movement are borne by you. We
            currently charge no service fee; if that changes, it will be
            disclosed before it applies.
          </p>
        </section>
        <section>
          <h2>6 · Acceptable use</h2>
          <p className="muted">
            No use for money laundering, sanctions evasion, market
            manipulation, or acquiring assets illegal where you live. We may
            refuse service, cap orders, or disable the bot at any time.
          </p>
        </section>
        <section>
          <h2>7 · No warranty, limited liability</h2>
          <p className="muted">
            The service is provided as-is, without warranties of any kind. To
            the maximum extent permitted by law, our total liability for any
            claim is limited to the value you deposited in the thirty days
            before the claim arose.
          </p>
        </section>
        <section>
          <h2>8 · Changes</h2>
          <p className="muted">
            We may update these terms; the "last updated" date changes when we
            do. Continued use after a change is acceptance of it.
          </p>
        </section>
      </div>

      <div className="divider" aria-hidden="true"><span>· · ·</span></div>
      <p className="fineprint"><a href="/">Home</a> · <a href="/privacy">Privacy Policy</a></p>
    </main>
  );
}
