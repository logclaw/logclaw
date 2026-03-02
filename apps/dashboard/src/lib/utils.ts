/** Severity badge styling for light theme */
export function severityColor(severity: string): string {
  switch (severity?.toLowerCase()) {
    case "critical":
      return "bg-red-50 text-red-600 ring-1 ring-red-200";
    case "high":
      return "bg-orange-50 text-orange-600 ring-1 ring-orange-200";
    case "medium":
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
    case "low":
      return "bg-blue-50 text-blue-600 ring-1 ring-blue-200";
    default:
      return "bg-gray-100 text-gray-600 ring-1 ring-gray-200";
  }
}

/** Log level badge styling */
export function levelColor(level: string): string {
  switch (level?.toUpperCase()) {
    case "FATAL":
    case "CRITICAL":
      return "text-red-600 bg-red-50";
    case "ERROR":
      return "text-red-500 bg-red-50";
    case "WARN":
    case "WARNING":
      return "text-amber-600 bg-amber-50";
    case "INFO":
      return "text-blue-600 bg-blue-50";
    case "DEBUG":
      return "text-emerald-600 bg-emerald-50";
    case "TRACE":
      return "text-gray-500 bg-gray-100";
    default:
      return "text-gray-500 bg-gray-100";
  }
}

/** Incident state badge styling */
export function stateColor(state: string): string {
  switch (state?.toLowerCase()) {
    case "triggered":
      return "bg-red-50 text-red-600 ring-1 ring-red-200";
    case "identified":
      return "bg-red-50 text-red-500 ring-1 ring-red-200";
    case "acknowledged":
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
    case "investigating":
      return "bg-blue-50 text-blue-600 ring-1 ring-blue-200";
    case "mitigated":
      return "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200";
    case "resolved":
      return "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200";
    default:
      return "bg-gray-100 text-gray-600 ring-1 ring-gray-200";
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

/** Format number compactly (1.2K, 3.4M, etc.) */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Format bytes to human-readable (KB, MB, GB) */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Parse OpenSearch size strings like "134.9kb", "1.2mb", "2.5gb" to bytes */
export function parseOsSize(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)\s*(b|kb|mb|gb|tb)$/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  switch (match[2].toLowerCase()) {
    case "tb": return val * 1_099_511_627_776;
    case "gb": return val * 1_073_741_824;
    case "mb": return val * 1_048_576;
    case "kb": return val * 1_024;
    default: return val;
  }
}
