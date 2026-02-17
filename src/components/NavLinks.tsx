"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/setup", label: "Settings" },
] as const;

export function NavLinks() {
  const pathname = usePathname();

  return (
    <div className="flex gap-6 text-sm">
      {links.map(({ href, label }) => {
        const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`font-medium transition-colors pb-0.5 ${
              isActive
                ? "text-fg border-b-2 border-accent-fg"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
