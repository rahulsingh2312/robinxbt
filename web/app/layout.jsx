import "./globals.css";
import { Unbounded, Instrument_Sans, IBM_Plex_Mono } from "next/font/google";

const display = Unbounded({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-display" });
const body = Instrument_Sans({ subsets: ["latin"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata = {
  title: "Peterpan — talk to the bot, own the bag",
  description: "Tweet at the bot, it opens you a wallet on Robinhood Chain. Stocks, memecoins, whatever — yours, on-chain, exportable."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
