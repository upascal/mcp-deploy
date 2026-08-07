"use client";

import Link from "next/link";
import { StatusBadge } from "./StatusBadge";

interface McpCardProps {
  slug: string;
  name: string;
  description: string;
  version: string;
  deployedVersion?: string | null;
  latestVersion?: string | null;
  updateAvailable?: boolean;
  status: string;
  workerUrl: string | null;
  deployedAt: string | null;
}

export function McpCard({
  slug,
  name,
  description,
  version,
  deployedVersion,
  latestVersion,
  updateAvailable,
  status,
  deployedAt,
}: McpCardProps) {
  return (
    <Link href={`/mcps/${slug}`}>
      <div className="group border border-edge rounded-xl p-6 bg-surface hover:border-edge-subtle transition-colors cursor-pointer overflow-hidden">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-semibold text-fg group-hover:text-accent-fg transition-colors line-clamp-1">
            {name}
          </h3>
          <div className="flex items-center gap-2">
            {updateAvailable && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-info-mid/10 text-info border border-info-mid/20">
                Update
              </span>
            )}
            <StatusBadge status={status} />
          </div>
        </div>
        <p className="text-sm text-fg-muted mb-4 line-clamp-2 min-h-[2.5rem]">
          {description}
        </p>
        <div className="flex items-center justify-between text-xs text-fg-faint">
          <div className="flex items-center gap-2">
            <span>v{version}</span>
            {updateAvailable && deployedVersion && latestVersion && (
              <span className="text-info">
                ({deployedVersion} → {latestVersion})
              </span>
            )}
          </div>
          {deployedAt && (
            <span>
              Deployed{" "}
              {new Date(deployedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
