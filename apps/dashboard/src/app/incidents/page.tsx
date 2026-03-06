"use client";

import { useEffect, useState, useCallback } from "react";
import IncidentCard from "@/components/incident-card";
import { IncidentCardSkeleton } from "@/components/skeleton";
import { ErrorBanner } from "@/components/error-boundary";
import { fetchIncidents, batchTransitionIncidents, type Incident } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import {
  ShieldAlert,
  Search,
  RefreshCw,
  Clock,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Eye,
  Download,
  FileText,
  Loader2,
  X,
  CheckSquare,
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

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

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

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<string | null>(null);

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

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => {
    if (selectedIds.size === incidents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(incidents.map((i) => i.id)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const executeBulkAction = async (action: string) => {
    if (selectedIds.size === 0) return;
    setBulkAction(action);
    try {
      await batchTransitionIncidents(Array.from(selectedIds), action);
      setSelectedIds(new Set());
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBulkAction(null);
    }
  };

  // Export CSV
  const exportCSV = () => {
    const rows = incidents.length > 0 ? incidents : [];
    if (rows.length === 0) return;
    const headers = ["ID", "Title", "Severity", "State", "Service", "Priority", "Created", "Assigned To", "MTTR (s)", "Root Cause"];
    const csvLines = [
      headers.join(","),
      ...rows.map((inc) =>
        [
          escapeCSV(inc.id),
          escapeCSV(inc.title),
          inc.severity,
          inc.state,
          escapeCSV(inc.service),
          inc.priority || "",
          inc.created_at,
          inc.assigned_to || "",
          inc.mttr_seconds?.toString() || "",
          escapeCSV(inc.root_cause || ""),
        ].join(",")
      ),
    ];
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logclaw-incidents-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const mttrAvg =
    incidents.filter((i) => i.mttr_seconds).length > 0
      ? incidents
          .filter((i) => i.mttr_seconds)
          .reduce((a, i) => a + (i.mttr_seconds ?? 0), 0) /
        incidents.filter((i) => i.mttr_seconds).length
      : null;

  const hasSelection = selectedIds.size > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in-up flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50">
            <ShieldAlert className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h1 className="text-[18px] font-bold tracking-tight text-[#1d1d1f] sm:text-[22px]">
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
        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            disabled={incidents.length === 0}
            className="hidden items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[12px] font-medium text-[#6e6e73] shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:shadow-md disabled:opacity-40 sm:flex"
            title="Export as CSV"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[12px] font-medium text-[#6e6e73] shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:shadow-md"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {/* Filters */}
      <div className="animate-fade-in space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#aeaeb2]" />
          <input
            type="text"
            placeholder="Search incidents by title, service, description..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="w-full rounded-xl border border-[#e5e5ea] bg-white pl-9 pr-4 py-2.5 text-[13px] text-[#1d1d1f] placeholder:text-[#d1d1d6] focus:border-[#FF5722] focus:outline-none focus:ring-2 focus:ring-orange-100 shadow-sm transition-all sm:w-96"
          />
        </div>

        <div className="flex flex-wrap gap-2 sm:gap-3">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="flex gap-0.5 rounded-xl bg-white p-1 shadow-[0_1px_3px_rgba(0,0,0,0.06)] min-w-max">
              {SEVERITIES.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setSeverity(s);
                    setPage(0);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-[12px] font-medium capitalize transition-all whitespace-nowrap ${
                    severity === s
                      ? "bg-[#FF5722] text-white shadow-sm"
                      : "text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="flex gap-0.5 rounded-xl bg-white p-1 shadow-[0_1px_3px_rgba(0,0,0,0.06)] min-w-max">
              {STATES.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setState(s);
                    setPage(0);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-[12px] font-medium capitalize transition-all whitespace-nowrap ${
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
        </div>
      </div>

      {/* Bulk actions bar */}
      {incidents.length > 0 && (
        <div className="animate-fade-in flex items-center justify-between rounded-xl bg-white px-4 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <button
            onClick={selectAll}
            className="flex items-center gap-1.5 text-[12px] font-medium text-[#6e6e73] transition-colors hover:text-[#1d1d1f]"
          >
            <CheckSquare className={`h-3.5 w-3.5 ${selectedIds.size === incidents.length && incidents.length > 0 ? "text-[#FF5722]" : ""}`} />
            {selectedIds.size === incidents.length && incidents.length > 0 ? "Deselect all" : "Select all"}
          </button>
          {hasSelection && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#aeaeb2]">
                {selectedIds.size} selected
              </span>
              <button
                onClick={() => executeBulkAction("acknowledge")}
                disabled={!!bulkAction}
                className="flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1.5 text-[11px] font-medium text-white transition-all hover:bg-amber-400 disabled:opacity-50"
              >
                {bulkAction === "acknowledge" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                Acknowledge
              </button>
              <button
                onClick={() => executeBulkAction("resolve")}
                disabled={!!bulkAction}
                className="flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-[11px] font-medium text-white transition-all hover:bg-emerald-400 disabled:opacity-50"
              >
                {bulkAction === "resolve" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Resolve
              </button>
              <button
                onClick={clearSelection}
                className="rounded-full p-1.5 text-[#aeaeb2] transition-colors hover:bg-[#f5f5f7] hover:text-[#6e6e73]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* List */}
      <div className="stagger-children space-y-3">
        {loading && incidents.length === 0 ? (
          <>
            <IncidentCardSkeleton />
            <IncidentCardSkeleton />
            <IncidentCardSkeleton />
            <IncidentCardSkeleton />
          </>
        ) : incidents.length === 0 ? (
          <div className="rounded-2xl bg-white p-14 text-center shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <ShieldAlert className="mx-auto mb-2 h-8 w-8 text-emerald-300" />
            <p className="text-[13px] font-medium text-[#6e6e73]">No incidents found</p>
            <p className="mt-1 text-[12px] text-[#aeaeb2]">Try adjusting your filters</p>
          </div>
        ) : (
          incidents.map((inc) => (
            <IncidentCard key={inc.id} incident={inc} selected={selectedIds.has(inc.id)} onSelect={toggleSelect} />
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
