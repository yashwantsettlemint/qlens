"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import {
  IconDashboard,
  IconInvoice,
  IconVendor,
  IconUpload,
} from "@/components/ui/icons";
import { RoleSwitcher } from "./RoleSwitcher";

const NAV = [
  { href: "/", label: "Dashboard", icon: IconDashboard, exact: true },
  { href: "/invoices", label: "Invoices", icon: IconInvoice },
  { href: "/vendors", label: "Vendors", icon: IconVendor },
  { href: "/upload", label: "Upload", icon: IconUpload },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex w-[216px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="px-4 py-4">
        <div className="text-sm font-semibold text-ink">Payables Desk</div>
        <div className="text-2xs text-ink-muted">Invoice &amp; vendor payments</div>
      </div>
      <ul className="flex-1 px-2">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "relative flex items-center gap-2.5 rounded px-2.5 py-2 text-sm",
                  active
                    ? "font-medium text-accent"
                    : "text-ink-muted hover:bg-ground hover:text-ink",
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-0.5 rounded-full bg-accent" />
                )}
                <Icon width={17} height={17} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <RoleSwitcher />
    </nav>
  );
}
