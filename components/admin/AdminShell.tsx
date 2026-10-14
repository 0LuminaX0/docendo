"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

const NAV = [
  ["/admin", "Dashboard"],
  ["/admin/sessions", "Sessions"],
  ["/admin/codes", "Access codes"],
  ["/admin/feedback", "Feedback"],
] as const;

/** The admin panel's frame: one header row with the sections and sign-out. */
export default function AdminShell({ children, store }: { children: React.ReactNode; store: string }) {
  const path = usePathname();
  const router = useRouter();
  return (
    <div className="adm">
      <header className="adm-top">
        <Link href="/admin" className="brand">
          docendo <span className="adm-tag">admin</span>
        </Link>
        <nav aria-label="Admin sections">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} aria-current={(href === "/admin" ? path === href : path.startsWith(href)) ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
        <span className="adm-store" title="Where the research log is read from">{store}</span>
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
      </header>
      <main className="adm-main">{children}</main>
    </div>
  );
}
