import "./globals.css";
import "./nav-premium.css";
import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { PHProvider } from "./providers";
import PostHogPageView from "./PostHogPageView";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Plus Jakarta Sans — loaded app-wide as a CSS variable, but ONLY applied
// visually under the `.po-premium` scope (Production Order page). The global
// `font-sans` stays Inter; nothing else changes.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SOLUX",
  description: "Operations platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`}>
      <body className="font-sans antialiased">
        {/* PostHog: inert without NEXT_PUBLIC_POSTHOG_KEY (local dev). */}
        <PHProvider>
          <PostHogPageView />
          {children}
        </PHProvider>
      </body>
    </html>
  );
}
