"use client";

import { levelColor, timeAgo } from "@/lib/utils";
import type { LogEntry } from "@/lib/api";

interface LogTableProps {
  title: string;
  logs: LogEntry[];
  maxRows?: number;
}

export default function LogTable({ title, logs, maxRows = 50 }: LogTableProps) {
  const rows = logs.slice(0, maxRows);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
      <div className="border-b border-slate-700 px-4 py-3">
        <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
          {title}
          <span className="ml-2 text-xs text-slate-500">({logs.length})</span>
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50 text-left text-xs text-slate-500">
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-4 py-2 font-medium">Level</th>
              <th className="px-4 py-2 font-medium">Service</th>
              <th className="px-4 py-2 font-medium">Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((log, i) => (
              <tr
                key={i}
                className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors"
              >
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-500">
                  {timeAgo(log._source.timestamp)}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-xs font-bold ${levelColor(log._source.level)}`}
                  >
                    {log._source.level}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-400">
                  {log._source.service ?? "—"}
                </td>
                <td className="max-w-md truncate px-4 py-2 text-xs text-slate-300">
                  {log._source.message}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No logs found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
