import "./globals.css";

export const metadata = {
  title: "xbot portfolio",
  description: "Your on-chain portfolio from talking to the bot on X"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
