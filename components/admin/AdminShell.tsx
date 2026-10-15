"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Database, Download, KeyRound, LayoutDashboard, LogOut, MessageSquareQuote, SlidersHorizontal, Users } from "lucide-react";

const NAV = [
  ["/admin", "Dashboard", LayoutDashboard],
  ["/admin/sessions", "Sessions", Users],
  ["/admin/codes", "Access codes", KeyRound],
  ["/admin/feedback", "Feedback", MessageSquareQuote],
  ["/admin/settings", "Settings", SlidersHorizontal],
] as const;

/** The admin panel's frame: a sidebar with the sections, the exports and sign-out; the page on the right. */
export default function AdminShell({ children, store }: { children: React.ReactNode; store: string }) {
  const path = usePathname();
  const router = useRouter();
  return (
    <div className="adm">
      <aside className="adm-side">
        <Link href="/admin" className="brand">
          docendo <span className="adm-tag">admin</span>
        </Link>
        <nav aria-label="Admin sections">
          {NAV.map(([href, label, Icon]) => (
            <Link key={href} href={href} aria-current={(href === "/admin" ? path === href : path.startsWith(href)) ? "page" : undefined}>
              <Icon size={17} strokeWidth={2} aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="adm-side-group">
          <span className="adm-side-h">Export</span>
          <a href="/api/admin/export?table=sessions">
            <Download size={15} aria-hidden="true" /> Sessions (CSV)
          </a>
          <a href="/api/admin/export?table=events">
            <Download size={15} aria-hidden="true" /> All events (JSONL)
          </a>
        </div>
        <div className="adm-side-foot">
          <span className="adm-store" title="Where the research log is read from">
            <Database size={13} aria-hidden="true" /> {store}
          </span>
          <button
            type="button"
            className="btn ghost small"
            onClick={async () => {
              await fetch("/api/admin/logout", { method: "POST" });
              router.replace("/admin/login");
            }}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <main className="adm-main">{children}</main>
    </div>
  );
}
