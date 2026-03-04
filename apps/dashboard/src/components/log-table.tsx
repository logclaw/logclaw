"use client";

import { levelColor, timeAgo } from "@/lib/utils";
import type { LogEntry } from "@/lib/api";
import { FileText } from "lucide-react";

interface LogTableProps {
  title: string;
  logs: LogEntry[];
  maxRows?: number;
}

export default function LogTable({ title, logs, maxRows = 50 }: LogTableProps) {
  const rows = logs.slice(0, maxRows);

  return (
    <div className="animate-fade-in-up overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2 border-b border-[#f2f2f7] px-4 py-3 sm:px-5 sm:py-3.5">
        <FileText className="h-4 w-4 text-[#aeaeb2]" />
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
          {title}
        </h3>
        <span className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[10px] font-medium text-[#aeaeb2]">
          {logs.length}
        </span>
      </div>

      {/* Desktop table view */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#f2f2f7] text-left text-[10px] uppercase tracking-wider text-[#aeaeb2]">
              <th className="px-5 py-2.5 font-medium">Time</th>
              <th className="px-5 py-2.5 font-medium">Level</th>
              <th className="px-5 py-2.5 font-medium">Service</th>
              <th className="px-5 py-2.5 font-medium">Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((log, i) => (
              <tr
                key={i}
                className="border-b border-[#f2f2f7]/60 transition-colors duration-150 hover:bg-[#fafafa]"
              >
                <td className="whitespace-nowrap px-5 py-2.5 font-mono text-[11px] text-[#aeaeb2]">
                  {timeAgo(log._source.timestamp)}
                </td>
                <td className="px-5 py-2.5">
                  <span
                    className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${levelColor(log._source.level)}`}
                  >
                    {log._source.level}
                  </span>
                </td>
                <td className="whitespace-nowrap px-5 py-2.5 text-[12px] text-[#6e6e73]">
                  {log._source.service ?? "\u2014"}
                </td>
                <td className="max-w-md truncate px-5 py-2.5 text-[12px] text-[#1d1d1f]">
                  {log._source.message}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-12 text-center text-[13px] text-[#aeaeb2]"
                >
                  No logs found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card view */}
      <div className="divide-y divide-[#f2f2f7] sm:hidden">
        {rows.map((log, i) => (
          <div key={i} className="px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span
                className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${levelColor(log._source.level)}`}
              >
                {log._source.level}
              </span>
              <span className="font-mono text-[10px] text-[#aeaeb2]">
                {timeAgo(log._source.timestamp)}
              </span>
            </div>
            <p className="text-[12px] text-[#1d1d1f] line-clamp-2">
              {log._source.message}
            </p>
            {log._source.service && (
              <p className="text-[11px] text-[#aeaeb2]">{log._source.service}</p>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="px-4 py-12 text-center text-[13px] text-[#aeaeb2]">
            No logs found
          </div>
        )}
      </div>
    </div>
  );
}
