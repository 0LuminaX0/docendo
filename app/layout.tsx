import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree, Shantell_Sans } from "next/font/google";
import "./globals.css";
import Telemetry from "@/components/Telemetry";
import { SettingsProvider } from "@/components/SettingsContext";
import SessionGuard from "@/components/SessionGuard";
import { currentStudy } from "@/lib/server/study";
import { publicOf } from "@/lib/settings";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });
const body = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });
// Kai's handwriting in its notebook: an informal hand-drawn sans, so the notebook reads as written by hand but
// still belongs with Bricolage and Figtree (a script face looked pasted in)
const hand = Shantell_Sans({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-hand", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const { pack } = await currentStudy();
  return { title: "Docendo", description: pack.copy.description, robots: { index: false, follow: false } };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export const dynamic = "force-dynamic"; // the study settings can change at any time (admin panel)

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { settings, pack } = await currentStudy();
  return (
    // Browser extensions (Grammarly, password managers…) add attributes to <html>/<body> before React
    // hydrates; suppressHydrationWarning ignores attribute differences on these two elements only.
    <html lang="en" className={`${display.variable} ${body.variable} ${hand.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <SettingsProvider value={publicOf(settings, pack)}>{children}</SettingsProvider>
        <Telemetry />
        <SessionGuard />
      </body>
    </html>
  );
}
