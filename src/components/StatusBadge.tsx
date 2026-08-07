"use client";

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    deployed: "bg-success-mid/15 text-success border-success-mid/30",
    failed: "bg-danger-mid/15 text-danger border-danger-mid/30",
    not_deployed: "bg-fg-faint/15 text-fg-muted border-fg-faint/30",
  };

  const labels: Record<string, string> = {
    deployed: "Deployed",
    failed: "Failed",
    not_deployed: "Not Deployed",
  };

  const dot =
    status === "deployed" ? (
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-30" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
      </span>
    ) : (
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          status === "failed" ? "bg-danger" : "bg-fg-muted"
        }`}
      />
    );

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status] ?? styles.not_deployed}`}
    >
      {dot}
      {labels[status] ?? "Unknown"}
    </span>
  );
}
