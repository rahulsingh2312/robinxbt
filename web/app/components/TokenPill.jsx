"use client";

import { useEffect, useState } from "react";

// The header slot for the account's own token. Reads from the bot's config
// through the API rather than a second copy in the site's environment: an
// address that exists in two places will eventually disagree with itself.
export default function TokenPill() {
  const [token, setToken] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/token")
      .then((response) => (response.ok ? response.json() : null))
      .then(setToken)
      .catch(() => {});
  }, []);

  if (!token?.launched) {
    return (
      <span className="pill" title="The contract address appears here at launch">
        CA · COMING SOON
      </span>
    );
  }

  const short = `${token.address.slice(0, 6)}…${token.address.slice(-4)}`;
  return (
    <button
      type="button"
      className="pill pill-copy"
      title={token.address}
      onClick={async () => {
        await navigator.clipboard.writeText(token.address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <span className="tick">${token.ticker}</span>
      <span className="num">{short}</span>
      <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
      <span className="sr-only">{copied ? "Address copied" : "Copy contract address"}</span>
    </button>
  );
}
