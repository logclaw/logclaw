"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShieldAlert,
  Upload,
  Settings,
} from "lucide-react";

const links = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/incidents", label: "Incidents", icon: ShieldAlert },
  { href: "/ingestion", label: "Ingestion", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

function LogClawLogo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Claw marks (3 strokes) */}
      <path d="M8 8 L28 32" stroke="#FF5722" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M14 6 L30 28" stroke="#FF5722" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M20 4 L32 24" stroke="#FF5722" strokeWidth="3.5" strokeLinecap="round" />
      {/* Log line accent */}
      <path d="M6 34 L34 34" stroke="#1d1d1f" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

export default function Nav() {
  const path = usePathname();

  return (
    <header className="glass sticky top-0 z-50 border-b border-black/[0.06]">
      <div className="mx-auto flex h-12 max-w-[1200px] items-center gap-8 px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <LogClawLogo />
          <span className="text-[15px] font-semibold tracking-tight text-[#1d1d1f]">
            LogClaw
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {links.map((l) => {
            const active =
              l.href === "/" ? path === "/" : path.startsWith(l.href);
            const Icon = l.icon;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all duration-200
                  ${
                    active
                      ? "bg-[#FF5722] text-white shadow-sm shadow-[#FF5722]/20"
                      : "text-[#6e6e73] hover:bg-black/[0.04] hover:text-[#1d1d1f]"
                  }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-600">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Pipeline Active
          </div>
        </div>
      </div>
    </header>
  );
}
