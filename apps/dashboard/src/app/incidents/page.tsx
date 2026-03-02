"use client";

import { useEffect, useState } from "react";
import IncidentCard from "@/components/incident-card";
import { fetchIncidents, type Incident } from "@/lib/api";
import {
  ShieldAlert,
  Search,
  RefreshCw,
  Clock,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from "lucide-react";

const SEVERITIES = ["all", "critical", "high", "medium", "low"] as const;
const STATES = [
  "all",
  "triggered",
  "identified",
  "acknowledged",
  "investigating",
  "mitigated",
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
  const [loading, setLoading] = useState(true);
  const limit = 20;

  const load = async () => {
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [severity, state, search, page]);

  const mttrAvg =
    incidents.filter((i) => i.mttr_seconds).length > 0
      ? incidents
          .filter((i) => i.mttr_seconds)
          .reduce((a, i) => a + (i.mttr_seconds ?? 0), 0) /
        incidents.filter((i) => i.mttr_seconds).length
      : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in-up flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50">
            <ShieldAlert className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-[#1d1d1f]">
              Incidents
            </h1>
            <p className="text-[13px] text-[#6e6e73]">
              {total} total
              {mttrAvg != null && (
                <span className="ml-2">
                  <Clock className="mr-1 inline h-3 w-3" />
                  Avg MTTR:{" "}
                  <span className="font-mono text-[#FF5722]">
                    {Math.round(mttrAvg / 60)}m
                  </span>
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[12px] font-medium text-[#6e6e73] shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:shadow-md"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="animate-fade-in flex items-center gap-2.5 rounded-xl bg-red-50 px-4 py-3.5 text-[13px] font-medium text-red-500">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="animate-fade-in flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#aeaeb2]" />
          <input
            type="text"
            placeholder="Search incidents..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="rounded-xl border border-[#e5e5ea] bg-white pl-9 pr-4 py-2.5 text-[13px] text-[#1d1d1f] placeholder:text-[#d1d1d6] focus:border-[#FF5722] focus:outline-none focus:ring-2 focus:ring-orange-100 shadow-sm transition-all"
          />
        </div>

        <div className="flex gap-0.5 rounded-xl bg-white p-1 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSeverity(s);
                setPage(0);
              }}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-medium capitalize transition-all ${
                severity === s
                  ? "bg-[#FF5722] text-white shadow-sm"
                  : "text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex gap-0.5 rounded-xl bg-white p-1 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          {STATES.map((s) => (
            <button
              key={s}
              onClick={() => {
                setState(s);
                setPage(0);
              }}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-medium capitalize transition-all ${
                state === s
                  ? "bg-[#FF5722] text-white shadow-sm"
                  : "text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="stagger-children space-y-3">
        {loading && incidents.length === 0 ? (
          <div className="rounded-2xl bg-white p-14 text-center text-[13px] text-[#aeaeb2] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            Loading incidents...
          </div>
        ) : incidents.length === 0 ? (
          <div className="rounded-2xl bg-white p-14 text-center text-[13px] text-[#aeaeb2] shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            No incidents found
          </div>
        ) : (
          incidents.map((inc) => (
            <IncidentCard key={inc.id} incident={inc} />
          ))
        )}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-center gap-3">
          <button
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            className="flex items-center gap-1 rounded-full bg-white px-4 py-2 text-[13px] font-medium text-[#6e6e73] shadow-sm transition-all hover:shadow-md disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </button>
          <span className="text-[12px] text-[#aeaeb2]">
            Page {page + 1} of {Math.ceil(total / limit)}
          </span>
          <button
            disabled={(page + 1) * limit >= total}
            onClick={() => setPage(page + 1)}
            className="flex items-center gap-1 rounded-full bg-white px-4 py-2 text-[13px] font-medium text-[#6e6e73] shadow-sm transition-all hover:shadow-md disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
