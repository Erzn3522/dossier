"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

type NavItem = {
  href: string;
  label: string;
  /** Whether the item is the current section; defaults to its own path and below. */
  isActive?: (pathname: string) => boolean;
};

const within = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", isActive: (pathname) => pathname === "/" },
  { href: "/profile", label: "Profile" },
  { href: "/resume", label: "Base resume" },
  { href: "/jobs", label: "Find jobs" },
  { href: "/review", label: "Review" },
  {
    href: "/applications",
    label: "Applications",
    // A new application becomes one, so the flow belongs to Applications.
    isActive: (pathname) => within(pathname, "/applications") || within(pathname, "/new"),
  },
  { href: "/settings", label: "Settings" },
];

/** The sidebar's navigation, with the current section highlighted. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, isActive = (path) => within(path, href) }) => {
        const active = isActive(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-control px-2.5 py-[9px] text-sm text-ink hover:bg-hover hover:text-ink",
              active && "bg-selected font-medium hover:bg-selected",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
