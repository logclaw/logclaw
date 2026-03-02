/** Severity badge color classes */
export function severityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "bg-red-600 text-white";
    case "high":
      return "bg-orange-500 text-white";
    case "medium":
      return "bg-yellow-500 text-black";
    case "low":
      return "bg-blue-500 text-white";
    default:
      return "bg-slate-500 text-white";
  }
}

/** Log level color classes */
export function levelColor(level: string): string {
  switch (level?.toUpperCase()) {
    case "FATAL":
    case "CRITICAL":
      return "text-red-400 bg-red-950";
    case "ERROR":
      return "text-red-400 bg-red-950/50";
    case "WARN":
    case "WARNING":
      return "text-yellow-400 bg-yellow-950/50";
    case "INFO":
      return "text-blue-400 bg-blue-950/50";
    case "DEBUG":
      return "text-green-400 bg-green-950/50";
    default:
      return "text-slate-400 bg-slate-800";
  }
}

/** Incident state badge color */
export function stateColor(state: string): string {
  switch (state) {
    case "triggered":
      return "bg-red-600 text-white animate-pulse";
    case "acknowledged":
      return "bg-yellow-500 text-black";
    case "investigating":
      return "bg-blue-500 text-white";
    case "resolved":
      return "bg-green-600 text-white";
    default:
      return "bg-slate-500 text-white";
  }
}

/** Format relative time */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Format duration in seconds to human-readable */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** Format number with commas */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}
