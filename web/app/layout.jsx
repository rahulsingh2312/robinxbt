import "./globals.css";
import { Instrument_Serif, Geist, Geist_Mono } from "next/font/google";

const display = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-display" });
const body = Geist({ subsets: ["latin"], variable: "--font-body" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata = {
  title: "Peterpan",
  description: "Tweet at the bot and it opens you a wallet on Robinhood Chain. Stocks, memecoins, whatever you ask for. Yours, on-chain, exportable."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
