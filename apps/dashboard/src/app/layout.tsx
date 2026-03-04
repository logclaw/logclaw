import type { Metadata } from "next";
import Nav from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "LogClaw — AI Incident Command Center",
  description:
    "Real-time observability dashboard for the LogClaw log analytics platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body className="min-h-screen antialiased">
        <Nav />
        <main className="mx-auto max-w-[1200px] px-4 py-5 sm:px-6 sm:py-8">{children}</main>
      </body>
    </html>
  );
}
