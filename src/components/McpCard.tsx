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
      <div className="group border border-gray-800 rounded-xl p-6 bg-gray-900/50 hover:bg-gray-900 hover:border-gray-700 transition-all cursor-pointer">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-semibold text-gray-100 group-hover:text-blue-400 transition-colors">
            {name}
          </h3>
          <div className="flex items-center gap-2">
            {updateAvailable && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Update
              </span>
            )}
            <StatusBadge status={status} />
          </div>
        </div>
        <p className="text-sm text-gray-400 mb-4 line-clamp-2">
          {description}
        </p>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <span>v{version}</span>
            {updateAvailable && deployedVersion && latestVersion && (
              <span className="text-amber-400">
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
