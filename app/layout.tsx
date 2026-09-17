import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Presidio | Controlli e documenti",
  description: "Archivio riservato e assistenza organizzativa ai controlli amministrativi.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body className="antialiased">{children}</body>
    </html>
  );
}
