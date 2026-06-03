"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/m", icon: "🏠", label: "Feed" },
  { href: "/m/search", icon: "🔍", label: "Search" },
  { href: "/m/groups", icon: "👥", label: "Groups" },
  { href: "/m/notifications", icon: "🔔", label: "Alerts" },
  { href: "/m/profile", icon: "👤", label: "Profile" },
] as const;

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="mdot-nav">
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === "/m"
            ? pathname === "/m"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`mdot-nav-item ${isActive ? "active" : ""}`}
          >
            <span className="mdot-nav-icon">{item.icon}</span>
            <span className="mdot-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
