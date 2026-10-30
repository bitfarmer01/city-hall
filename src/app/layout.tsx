import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NYC Service Estimation Assistant",
  description:
    "Turns a goal into cost estimates, ordered steps, and required documents for New York City government services.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-surface-page text-ink">
        <header className="border-b border-line bg-surface-card">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-sm font-semibold tracking-tight text-ink">
              NYC Service Estimation
            </Link>
            <nav aria-label="Main" className="flex items-center gap-5 text-sm">
              <Link href="/" className="text-ink-secondary hover:text-ink">
                Home
              </Link>
              <Link href="/browse" className="text-ink-secondary hover:text-ink">
                Browse services
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>
        <footer className="border-t border-line py-6">
          <div className="mx-auto max-w-5xl px-6 text-xs text-ink-faint">
            Estimates reflect what captured city sources state, with sources and as-of dates on
            every fee. Not legal advice.
          </div>
        </footer>
      </body>
    </html>
  );
}
