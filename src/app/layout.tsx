import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Morrow — A calm view of what matters",
  description:
    "A private, connector-ready work-life tracker for prioritizing today, this week, and this month.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
