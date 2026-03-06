"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

interface Props {
  title: string;
  icon?: ReactNode;
  badge?: string | number;
  badgeColor?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

export default function CollapsibleSection({
  title,
  icon,
  badge,
  badgeColor = "bg-[#f5f5f7] text-[#6e6e73]",
  defaultOpen = false,
  children,
  className = "",
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] ${className}`}>
      {/* Header */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-5 py-4 text-left transition-colors hover:bg-[#fafafa]"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-[#aeaeb2] transition-transform duration-200 ${
            open ? "rotate-90" : ""
          }`}
        />
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
          {title}
        </span>
        {badge != null && (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeColor}`}
          >
            {badge}
          </span>
        )}
      </button>

      {/* Content */}
      <div
        className={`grid transition-all duration-300 ease-in-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-[#f2f2f7] px-5 py-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
