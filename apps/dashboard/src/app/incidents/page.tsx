"use client";

import { useEffect, useState } from "react";
import IncidentCard from "@/components/incident-card";
import { fetchIncidents, type Incident } from "@/lib/api";

const SEVERITIES = ["all", "critical", "high", "medium", "low"] as const;
const STATES = [
  "all",
  "triggered",
  "acknowledged",
  "investigating",
  "resolved",
] as const;

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [total, setTotal] = useState(0);
  const [severity, setSeverity] = useState("all");
  const [state, setState] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  const load = async () => {
    try {
      const res = await fetchIncidents({
        severity: severity === "all" ? undefined : severity,
        state: state === "all" ? undefined : state,
        search: search || undefined,
        limit,
        offset: page * limit,
      });
      setIncidents(res.incidents);
      setTotal(res.total);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, [severity, state, search, page]);

  // Metrics
  const mttrAvg =
    incidents.filter((i) => i.mttr_seconds).length > 0
      ? incidents
          .filter((i) => i.mttr_seconds)
          .reduce((a, i) => a + (i.mttr_seconds ?? 0), 0) /
        incidents.filter((i) => i.mttr_seconds).length
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-200">Incidents</h1>
        {mttrAvg && (
          <div className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-400">
            Avg MTTR:{" "}
            <span className="font-mono text-blue-400">
              {Math.round(mttrAvg / 60)}m
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
          ⚠️ {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search incidents..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-300 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
        />

        <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSeverity(s);
                setPage(0);
              }}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                severity === s
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
          {STATES.map((s) => (
            <button
              key={s}
              onClick={() => {
                setState(s);
                setPage(0);
              }}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                state === s
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <button
          onClick={load}
          className="ml-auto rounded-lg bg-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-600"
        >
          ↻ Refresh
        </button>
      </div>

      {/* List */}
      <div className="space-y-3">
        {incidents.map((inc) => (
          <IncidentCard key={inc.id} incident={inc} />
        ))}
        {incidents.length === 0 && (
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-12 text-center text-slate-500">
            No incidents found
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-slate-300 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-xs text-slate-500">
            Page {page + 1} of {Math.ceil(total / limit)}
          </span>
          <button
            disabled={(page + 1) * limit >= total}
            onClick={() => setPage(page + 1)}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-slate-300 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
