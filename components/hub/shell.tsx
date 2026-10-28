"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Layers3,
  CalendarClock,
  ClipboardCheck,
  ChartNoAxesCombined,
  Users,
  Settings,
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  ArrowUpRight,
} from "lucide-react";
import { useState } from "react";
import type { Profile } from "@/lib/domain";
import { adminRole, financeRole, roleLabels } from "@/lib/domain";
import { logout } from "@/app/auth/actions";
import { Brand } from "@/components/hub/brand";
import { HelpCenter } from "@/components/hub/help-center";
const navigation = [
  ["Dashboard", "/dashboard", LayoutDashboard],
  ["Software Inventory", "/software", Layers3],
  ["Upcoming Renewals", "/renewals", CalendarClock],
  ["Usage Reviews", "/reviews", ClipboardCheck],
  ["Finance Centre", "/finance", ChartNoAxesCombined],
  ["Team Management", "/team", Users],
  ["Settings", "/settings", Settings],
] as const;
export function Shell({
  profile,
  notifications,
  children,
}: {
  profile: Profile;
  notifications: number;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const items = navigation.filter(
    (item) =>
      (item[1] !== "/finance" || financeRole(profile.role)) &&
      (item[1] !== "/team" || adminRole(profile.role)),
  );
  const active = navigation.find((item) => path.startsWith(item[1]));
  return (
    <div className="workspace">
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <aside className={`sidebar ${open ? "mobile-open" : ""}`}>
        <Brand href="/dashboard" compact />
        <div className="workspace-label">ARCHDIOCESE WORKSPACE</div>
        <nav id="workspace-navigation" aria-label="Main navigation">
          {items.map(([label, href, Icon]) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={
                path.startsWith(href) ? "nav-item selected" : "nav-item"
              }
              aria-current={path.startsWith(href) ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
              {href === "/reviews" && notifications > 0 && (
                <span className="nav-count">{notifications}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="stewardship">
            <span className="tiny-label">BUILT FOR BETTER STEWARDSHIP</span>
            <p>Clarity in every commitment.</p>
            <span className="text-xs text-slate-400">
              Catholic Archdiocese of Edmonton
            </span>
          </div>
          <div className="sidebar-user">
            <span className="avatar">
              {profile.full_name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{profile.full_name}</strong>
              <span>{roleLabels[profile.role]} workspace</span>
            </div>
            <form action={logout}>
              <button aria-label="Sign out" title="Sign out">
                <LogOut size={17} />
              </button>
            </form>
          </div>
        </div>
      </aside>
      {open && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="workspace-main">
        <header className="topbar">
          <div className="flex items-center gap-3">
            <button
              className="mobile-menu"
              aria-label="Toggle navigation"
              aria-expanded={open}
              aria-controls="workspace-navigation"
              onClick={() => setOpen(!open)}
            >
              <Menu size={22} />
            </button>
            <span className="text-slate-400 text-sm hidden sm:inline">
              Workspace
            </span>
            <span className="text-slate-300 hidden sm:inline">/</span>
            <strong>{active?.[0] || "Software Hub"}</strong>
          </div>
          <div className="topbar-actions">
            <HelpCenter role={profile.role} />
            <Link
              href="/reviews"
              className="notification-button"
              aria-label={`${notifications} pending usage reviews`}
            >
              <Bell size={19} />
              {notifications > 0 && <i />}
            </Link>
            <details className="account-menu">
              <summary>
                <span className="avatar small">
                  {profile.full_name.slice(0, 2).toUpperCase()}
                </span>
                <span className="hidden sm:inline">
                  {profile.full_name.split(" ")[0]}
                </span>
                <ChevronDown size={14} />
              </summary>
              <div className="menu-panel">
                <span>{profile.email}</span>
                <Link href="/settings">
                  Account settings <ArrowUpRight size={14} />
                </Link>
                <form action={logout}>
                  <button>Sign out</button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <main id="content" className="page-content">
          {children}
        </main>
        <footer className="page-footer">
          CAEDM Software Hub{" "}
          <span>America/Edmonton · Financial stewardship, together.</span>
        </footer>
      </div>
    </div>
  );
}
