/**
 * Optional worker-name namespace for a request.
 *
 * The local tool deploys one worker per MCP, named straight from
 * `metadata.worker.name`. A multi-tenant host needs each user's worker to be
 * distinct — `zotero-assistant-alice` rather than `zotero-assistant` — or two
 * users collide on the same Cloudflare script.
 *
 * Rather than thread a suffix through deploy / undeploy / remove / status, the
 * host wraps a request in `withWorkerNamespace(handle, ...)`, and
 * `resolveMcpEntry` appends it once. Every operation resolves through there, so
 * the namespaced name is applied consistently with no per-operation plumbing.
 * With no namespace set (the local tool), names are unchanged.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<{ suffix: string }>();

/** Run `fn` with every resolved worker name suffixed by `suffix`. */
export function withWorkerNamespace<T>(suffix: string, fn: () => T): T {
  return storage.run({ suffix }, fn);
}

/** The active worker-name suffix, or null (the local, un-namespaced case). */
export function currentWorkerSuffix(): string | null {
  return storage.getStore()?.suffix ?? null;
}

/** Apply the active namespace to a base worker name. */
export function namespaceWorkerName(baseName: string): string {
  const suffix = currentWorkerSuffix();
  return suffix ? `${baseName}-${suffix}` : baseName;
}
