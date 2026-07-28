export const metadata = { title: "Privacy Policy · Peterpan" };

export default function Privacy() {
  return (
    <main>
      <nav className="bar">
        <a className="wordmark" href="/"><img src="/pfp-peterpan.jpg" alt="" />peterpan.</a>
        <span className="pill">PRIVACY</span>
      </nav>

      <header className="hero" style={{ textAlign: "left", alignItems: "flex-start", gap: 10 }}>
        <p className="eyebrow">Privacy Policy</p>
        <h1 style={{ fontSize: "2.2rem" }}>What we know, and what we don’t.</h1>
        <p className="muted" style={{ margin: 0 }}>Last updated July 29, 2026 · Contact: @TryPeterpan on X</p>
      </header>

      <div className="stack" style={{ gap: 26, marginTop: 40, maxWidth: "62ch" }}>
        <section>
          <h2>What we collect</h2>
          <p className="muted">
            Your X numeric user ID and handle (that pair is your wallet's
            identity), the public posts in which you mention the bot (read to
            answer and to execute your instructions), your wallet address and
            its on-chain activity (public on the blockchain by nature), and,
            when you sign in on this site, a session cookie tied to your X
            account.
          </p>
        </section>
        <section>
          <h2>What we hold carefully</h2>
          <p className="muted">
            Your wallet's private key is stored encrypted (AES-256-GCM) and is
            used only to sign the transactions you ask for: buys from the bot,
            and sells or withdrawals you trigger here after signing in. It is
            shown in plaintext exactly once per request when you export it.
          </p>
        </section>
        <section>
          <h2>What we don’t collect</h2>
          <p className="muted">
            No email, no phone number, no password, no government ID. X OAuth
            access tokens are used once to confirm who you are and are not
            stored. No analytics trackers, no advertising cookies. The only
            cookies are the essential sign-in ones.
          </p>
        </section>
        <section>
          <h2>Who else is involved</h2>
          <p className="muted">
            The service talks to the X API (reading mentions, posting replies,
            sign-in), Robinhood Chain RPC nodes and the Blockscout explorer
            (balances, prices, transactions), unavatar.io (fetching public
            profile pictures), and Vercel (hosting this site). Each sees what
            such a request necessarily contains; none receive your private key.
          </p>
        </section>
        <section>
          <h2>Retention and deletion</h2>
          <p className="muted">
            Wallet records persist while the service operates so your funds
            stay reachable. If you want out: export your key or withdraw, then
            message @TryPeterpan from your account and we will delete the
            stored record. On-chain history is public and permanent; we cannot
            delete the blockchain.
          </p>
        </section>
        <section>
          <h2>Changes</h2>
          <p className="muted">
            If this policy changes, the date above changes with it.
          </p>
        </section>
      </div>

      <div className="divider" aria-hidden="true"><span>· · ·</span></div>
      <p className="fineprint"><a href="/">Home</a> · <a href="/terms">Terms of Service</a></p>
    </main>
  );
}
