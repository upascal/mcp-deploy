"use client";

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    deployed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    failed: "bg-red-500/15 text-red-400 border-red-500/30",
    not_deployed: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  };

  const labels: Record<string, string> = {
    deployed: "Deployed",
    failed: "Failed",
    not_deployed: "Not Deployed",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status] ?? styles.not_deployed}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          status === "deployed"
            ? "bg-emerald-400"
            : status === "failed"
              ? "bg-red-400"
              : "bg-gray-400"
        }`}
      />
      {labels[status] ?? "Unknown"}
    </span>
  );
}
