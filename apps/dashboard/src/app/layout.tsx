import type { Metadata } from "next";
import Nav from "@/components/nav";
import { ErrorBoundary } from "@/components/error-boundary";
import { ThemeProvider } from "@/components/theme-provider";
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('logclaw-theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-screen antialiased bg-[var(--bg)] text-[var(--text)]">
        <ThemeProvider>
          <Nav />
          <main className="mx-auto max-w-[1200px] px-4 py-5 sm:px-6 sm:py-8">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
