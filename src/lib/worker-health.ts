/**
 * Health check for a deployed worker.
 *
 * Deliberately credential-free: reaching a worker's public URL needs no
 * Cloudflare auth, so status stays readable even when nobody is logged in.
 */

const HEALTH_TIMEOUT_MS = 10_000;

export interface WorkerHealth {
  healthy: boolean;
  status?: number;
  error?: string;
}

export async function checkWorkerHealth(
  workerUrl: string
): Promise<WorkerHealth> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    const res = await fetch(workerUrl, { signal: controller.signal });
    clearTimeout(timeout);

    return { healthy: res.ok, status: res.status };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { healthy: false, error: message };
  }
}
