# Bug Report: mcp-deploy Project

**Generated:** 2026-02-07 (Updated)
**Total Source Files Analyzed:** ~60 TypeScript files
**Lines of Code:** ~9,500 lines

---

## Status Update: Previously Reported Bugs

Several critical bugs from the previous report have been **FIXED** ✅:

- ✅ **Bug #2 (Shell Injection)** - `setSecrets()` now uses temp file approach (line 243-246 in wrangler.ts)
- ✅ **Bug #3 (Worker Name Validation)** - `validateWorkerName()` function added (lines 22-31 in wrangler.ts)
- ✅ **Bug #7 (Password Timing Attack)** - Now uses `constantTimeCompare()` in oauth/approve/route.ts
- ✅ **Bug #4 (Database Init Error)** - Try-catch wrapper added (lines 37-42 in db.ts)

---

## Critical Bugs

### 🔴 1. Incorrect Worker Name in MCP Removal Route (NEW)
**File:** `src/app/api/mcps/[slug]/remove/route.ts:21`
**Severity:** CRITICAL
**Status:** Active Bug

**Description:** The remove route incorrectly assumes `workerName === slug`, but the actual worker name comes from `metadata.worker.name` in the GitHub release and can be different. This causes:
- Wrong worker to be targeted for deletion
- Worker deletion to fail silently
- Orphaned workers remaining deployed on Cloudflare
- Potential security issue (deployed workers can't be removed)

**Current Code:**
```typescript
const deployment = await getDeployment(slug);
if (deployment?.workerUrl) {
  const workerName = slug;  // ❌ INCORRECT ASSUMPTION
  try {
    await deleteWorker(workerName);
  }
}
```

**Impact:** If `slug !== metadata.worker.name`, the worker won't be deleted, leading to resource leaks and security issues.

**Suggested Fix:**
```typescript
const deployment = await getDeployment(slug);
if (deployment?.workerUrl) {
  const entry = await getStoredMcp(slug);
  if (entry) {
    const resolved = await resolveMcpEntry(entry);
    await deleteWorker(resolved.workerName);
  }
}
```

---

### 🔴 2. Incomplete Cleanup on MCP Removal (PARTIALLY FIXED)
**File:** `src/app/api/mcps/[slug]/remove/route.ts:16`
**Severity:** CRITICAL
**Status:** Partially Fixed (store.ts has removeMcp with cascade deletes, but route doesn't use worker name correctly)

**Description:** While `removeMcp()` in store.ts properly cascades deletes across tables (deployments, secrets, jwt_secrets, metadata_cache, worker_url_mapping), the route still has the wrong worker name bug (#1 above). The cleanup is correct, but the worker deletion fails.

**Current Implementation in store.ts (GOOD):**
```typescript
export async function removeMcp(slug: string): Promise<void> {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM deployments WHERE slug = ?").run(slug);
    db.prepare("DELETE FROM secrets WHERE slug = ?").run(slug);
    db.prepare("DELETE FROM jwt_secrets WHERE slug = ?").run(slug);
    db.prepare("DELETE FROM metadata_cache WHERE slug = ?").run(slug);
    db.prepare("DELETE FROM worker_url_mapping WHERE slug = ?").run(slug);
    db.prepare("DELETE FROM mcps WHERE slug = ?").run(slug);
  });
  tx();
}
```

**Issue:** Route needs to resolve the correct worker name before calling `deleteWorker()` (see Bug #1).

---

### 🔴 3. Missing Secret Name Validation (NEW)
**File:** `src/lib/wrangler.ts:226-238`
**Severity:** HIGH
**Status:** Active Bug

**Description:** While worker names are validated, secret names are NOT validated when setting secrets via `setSecrets()`. Malicious secret names could potentially bypass validation or cause command injection.

**Current Code:**
```typescript
export async function setSecrets(
  workerName: string,
  secrets: Record<string, string>
): Promise<void> {
  validateWorkerName(workerName); // ✅ Worker validated

  const filtered: Record<string, string> = {};
  for (const [name, value] of Object.entries(secrets)) {
    // ❌ Secret name NOT validated
    if (value) {
      filtered[name] = value;
    }
  }
  // ...
}
```

**Note:** Secret names ARE validated in `deleteSecret()` (line 276), but not in `setSecrets()`.

**Suggested Fix:**
```typescript
const SECRET_NAME_RE = /^[a-zA-Z0-9_]+$/;

function validateSecretName(name: string): void {
  if (!SECRET_NAME_RE.test(name)) {
    throw new Error(`Invalid secret name "${name}": must match ${SECRET_NAME_RE}`);
  }
}

// In setSecrets():
for (const [name, value] of Object.entries(secrets)) {
  validateSecretName(name);  // Add validation
  if (value) {
    filtered[name] = value;
  }
}
```

---

### 🔴 4. Migration Race Condition (STILL PRESENT)
**File:** `src/lib/db.ts:183-326`
**Severity:** HIGH
**Status:** Active Bug

**Description:** Despite being documented in previous reports, the migration race condition is NOT fully fixed. Lines 322-325 update the migration marker OUTSIDE the transaction, creating a window where the status is "in_progress" but migration is complete.

**Current Code (lines 188-200):**
```typescript
const migrated = db
  .prepare("SELECT value FROM config WHERE key = 'migrated_from_json'")
  .get() as { value: string } | undefined;
if (migrated) return;  // ⚠️ RACE: Multiple processes can pass this

// Atomically claim migration
const claim = db
  .prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('migrated_from_json', 'in_progress')")
  .run();
if (claim.changes === 0) return;  // ✅ Good, but...
```

**Problem (lines 322-325):**
```typescript
// Mark migration complete — ⚠️ OUTSIDE TRANSACTION
db.prepare(
  "UPDATE config SET value = '1' WHERE key = 'migrated_from_json'"
).run();
```

**Impact:**
- Multiple processes could attempt migration simultaneously
- Data could be inserted multiple times
- Database corruption risk

**Suggested Fix:** Move the final UPDATE inside the transaction or use a single REPLACE statement.

---

## High Severity Bugs

### 🟠 5. Race Condition in Metadata Cache (NEW)
**File:** `src/lib/mcp-registry.ts:71-87`
**Severity:** HIGH
**Status:** Active Bug

**Description:** The `resolveMcpEntry()` function has a classic check-then-act race condition. Multiple concurrent requests can all see an empty cache, all fetch from GitHub, and all try to write the cache.

**Current Code:**
```typescript
let cached = getCachedMetadata(entry.slug);
if (!cached) {
  // ⚠️ RACE: Multiple requests can enter here simultaneously
  const fresh = await fetchMcpMetadata(entry.githubRepo, entry.releaseTag ?? "latest");
  cached = { metadata: fresh.metadata, bundleUrl: fresh.bundleUrl, version: fresh.version };
  setCachedMetadata(entry.slug, cached);
}
```

**Impact:**
- Unnecessary GitHub API calls under load
- Potential GitHub rate limiting (60 requests/hour unauthenticated)
- Database lock contention on cache writes
- Wasted resources

**Suggested Fix:** Use a mutex/lock pattern or make cache writes idempotent with timestamps.

---

### 🟠 6. Synchronous Functions Declared as Async (NEW)
**Files:** `src/lib/store.ts` (multiple functions)
**Severity:** MEDIUM (but widespread)
**Status:** Active Issue

**Description:** Many functions are declared `async` but don't use `await` and could be synchronous. This is misleading and could cause issues if developers expect async behavior.

**Examples:**
```typescript
// Line 6
export async function getDeployment(slug: string): Promise<DeploymentRecord | null> {
  // ❌ No await anywhere
  const row = getDb().prepare("SELECT ...").get(slug) as ...
  // ...
  return row;
}

// Line 38
export async function setDeployment(record: DeploymentRecord): Promise<void> {
  // ❌ No await
  getDb().prepare("INSERT OR REPLACE ...").run(...)
}

// And many more: getMcpSecrets (57), setMcpSecrets (73), getMcpBearerToken (95),
// getMcps (104), setMcps (126), addMcp (146), removeMcp (168), etc.
```

**Impact:**
- Unnecessary promise overhead on every call
- Misleading API (callers expect async behavior)
- Potential bugs during refactoring
- Confusion for developers

**Suggested Fix:** Remove `async` keyword and return types from purely synchronous functions.

---

### 🟠 7. Unsafe Type Assertions in Database Queries (NEW)
**Files:** Multiple in `src/lib/store.ts`, `src/lib/oauth/store.ts`
**Severity:** MEDIUM
**Lines:** 13-23 (store.ts), 34 (oauth/store.ts), 70 (oauth/store.ts), 87 (oauth/store.ts), etc.

**Description:** Database query results are cast with `as` without runtime validation. If the database schema changes or returns unexpected data, this causes runtime type mismatches.

**Example:**
```typescript
const row = getDb()
  .prepare("SELECT slug, status, worker_url, bearer_token, deployed_at, version, error FROM deployments WHERE slug = ?")
  .get(slug) as
  | {
      slug: string;
      status: string;
      worker_url: string | null;
      bearer_token: string | null;
      deployed_at: string | null;
      version: string;
      error: string | null;
    }
  | undefined;  // ⚠️ What if column is missing or wrong type?
```

**Impact:**
- Runtime type mismatches
- Hard-to-debug errors
- Silent data corruption
- Application crashes

**Suggested Fix:** Add runtime validation with a schema validator like Zod or write manual validation:
```typescript
function validateDeploymentRow(row: unknown): DeploymentRecord | null {
  if (!row || typeof row !== 'object') return null;
  // Validate each field...
}
```

---

### 🟠 8. No OAuth Data Cleanup on Startup (NEW)
**File:** `src/lib/oauth/store.ts:13-19`
**Severity:** MEDIUM
**Status:** Active Issue

**Description:** `cleanupExpired()` is only called during read operations. If the service runs for a long time without reads, expired data accumulates indefinitely.

**Current Code:**
```typescript
function cleanupExpired(): void {
  const now = nowSeconds();
  const db = getDb();
  db.prepare("DELETE FROM oauth_clients WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").run(now);
}

// Only called in:
export async function getOAuthClient(clientId: string): Promise<OAuthClient | null> {
  cleanupExpired();  // ⚠️ Only on reads
  // ...
}
```

**Impact:**
- Database bloat over time
- Performance degradation
- Wasted storage
- Slower queries on oauth tables

**Suggested Fix:**
```typescript
// In db.ts getDb() after initialization:
export function getDb(): Database.Database {
  if (db) return db;

  try {
    // ... initialization ...

    // Clean up expired OAuth data on startup
    cleanupExpiredOAuthData();

    return db;
  } catch (err) {
    // ...
  }
}

// Or run a periodic cleanup task
setInterval(() => cleanupExpired(), 5 * 60 * 1000); // Every 5 minutes
```

---

### 🟠 9. Unsafe JSON Parsing in Wrangler KV Output
**File:** `src/lib/wrangler.ts:308-320`
**Severity:** MEDIUM
**Status:** Partially mitigated (try-catch exists but could be better)

**Description:** When parsing wrangler KV namespace list output, the code uses `JSON.parse()` with a try-catch, but the error handling just logs a warning and continues. This could lead to namespace creation failures.

**Current Code:**
```typescript
const jsonMatch = output.match(/\[[\s\S]*\]/);
if (jsonMatch) {
  try {
    const namespaces = JSON.parse(jsonMatch[0]) as {
      id: string;
      title: string;
    }[];
    // ...
  } catch {
    console.warn("[wrangler] Failed to parse KV namespace list, will attempt to create");
  }
}
```

**Status:** This was improved from the previous report (try-catch added), but should validate the parsed structure.

---

## Medium Severity Bugs

### 🟡 10. Missing GitHub API Failure Handling in Route
**File:** `src/app/api/mcps/route.ts:9-61`
**Severity:** MEDIUM
**Status:** Active Issue

**Description:** The GET /api/mcps route uses `Promise.all()`, which fails fast. If ONE MCP has a GitHub API issue (rate limit, network error), the entire route could fail for ALL MCPs.

**Current Code:**
```typescript
const mcps = await Promise.all(
  entries.map(async (entry) => {
    try {
      const resolved = await resolveMcpEntry(entry);
      // ...
    } catch (err) {
      // Error caught and partial data returned
      return { slug: entry.slug, error: ... };
    }
  })
);
```

**Issue:** While individual errors are caught, the route could still have issues if the promise itself rejects.

**Suggested Fix:** Use `Promise.allSettled()` for extra safety:
```typescript
const results = await Promise.allSettled(
  entries.map(async (entry) => {
    // ... resolution logic
  })
);

const mcps = results
  .map((r) => r.status === "fulfilled" ? r.value : { error: r.reason })
  .filter(Boolean);
```

---

### 🟡 11. Missing Database Index on worker_url_mapping.slug (NEW)
**File:** `src/lib/db.ts:116-122`
**Severity:** MEDIUM
**Status:** Active Issue

**Description:** The `worker_url_mapping` table has index on `worker_url` (the PK) but NOT on `slug`, which is queried in delete operations (line 176 in store.ts).

**Current Indexes:**
```sql
CREATE INDEX IF NOT EXISTS idx_deployments_slug ON deployments(slug);
CREATE INDEX IF NOT EXISTS idx_secrets_slug ON secrets(slug);
-- ❌ Missing: idx_worker_url_mapping_slug
```

**Impact:**
- Slow DELETE operations when removing MCPs (O(n) scan instead of O(log n))
- Performance degradation as table grows

**Suggested Fix:**
```sql
CREATE INDEX IF NOT EXISTS idx_worker_url_mapping_slug ON worker_url_mapping(slug);
```

---

### 🟡 12. Potential Memory Leak in wranglerLogin Process (NEW)
**File:** `src/lib/wrangler.ts:77-105`
**Severity:** LOW
**Status:** Active Issue

**Description:** The `wranglerLogin()` function spawns a child process with `exec()` and attaches event listeners, but doesn't clean up if the promise is never resolved or if the process hangs indefinitely.

**Current Code:**
```typescript
export async function wranglerLogin(): Promise<{ success: boolean; error?: string; }> {
  return new Promise((resolve) => {
    const child = exec("npx wrangler login", { timeout: 120000 });

    let output = "";
    child.stdout?.on("data", (data: string) => (output += data));
    child.stderr?.on("data", (data: string) => (output += data));

    child.on("close", (code) => { /* ... */ });
    child.on("error", (err) => { /* ... */ });
    // ⚠️ What if neither event fires within timeout?
  });
}
```

**Impact:**
- Potential memory leak if process hangs
- Event listeners not cleaned up
- Zombie processes

**Suggested Fix:**
```typescript
const timeoutId = setTimeout(() => {
  child.kill();
  resolve({ success: false, error: "Login timeout" });
}, 125000); // Slightly longer than exec timeout

child.on("close", (code) => {
  clearTimeout(timeoutId);
  // ...
});

child.on("error", (err) => {
  clearTimeout(timeoutId);
  // ...
});
```

---

### 🟡 13. Inconsistent Use of slug vs workerName (NEW)
**Files:** Multiple
**Severity:** LOW (naming confusion)
**Status:** Architectural Issue

**Description:** Throughout the codebase, there's confusion between `slug` (the UI identifier) and `workerName` (the actual Cloudflare worker name). While these CAN be the same, they're semantically different concepts.

**Examples:**
- `/api/mcps/[slug]/remove/route.ts:21` assumes `slug === workerName`
- Database uses `slug` as primary key but Cloudflare uses `workerName`
- No documentation of the relationship

**Impact:**
- Developer confusion
- Potential bugs when slug !== workerName
- Hard to maintain

**Suggested Fix:** Document the relationship clearly or enforce that slug === workerName at validation time.

---

### 🟡 14. Hardcoded Timeouts Without Configuration (NEW)
**Files:** Multiple
**Severity:** LOW
**Examples:**
- `wrangler.ts:53` - 15 second timeout for whoami
- `wrangler.ts:83` - 120 second timeout for login
- `wrangler.ts:177` - 120 second timeout for deploy
- `test-runner.ts:72` - 10 second timeout for tests

**Description:** All timeouts are hardcoded magic numbers. They should be configurable via environment variables for different network conditions and deployment sizes.

**Impact:**
- Can't adjust timeouts for slow networks
- Can't increase for large deployments
- Not production-ready for varied environments

**Suggested Fix:**
```typescript
const WRANGLER_TIMEOUT = parseInt(process.env.WRANGLER_TIMEOUT || "120000");
```

---

### 🟡 15. Missing Timeout Validation
**File:** `src/lib/test-runner.ts:72`
**Severity:** MEDIUM
**Description:** The test runner uses a hardcoded 10-second timeout, but there's no validation that the timeout doesn't exceed API route timeouts (which are typically 10s on Vercel Hobby, 15s on Pro).

**Suggested Fix:** Make timeout configurable and add a buffer:
```typescript
const TIMEOUT_MS = 8000; // Leave 2s buffer for API route
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
```

---

### 🟡 16. Inconsistent Error Responses
**Files:** Various API routes
**Severity:** MEDIUM
**Description:** Different API routes return errors in inconsistent formats:
- Some return `{ error: "message" }`
- Some return `{ error: "code", error_description: "message" }`
- Some return status 400, others 500 for similar errors

**Suggested Fix:** Create a standardized error response helper:
```typescript
export function apiError(
  message: string,
  status: number = 500,
  code?: string
): NextResponse {
  return NextResponse.json(
    code ? { error: code, error_description: message } : { error: message },
    { status }
  );
}
```

---

### 🟡 17. Bearer Token Exposure in Logs
**File:** `src/lib/wrangler.ts:179`
**Severity:** MEDIUM
**Description:** The deploy output is logged with `console.log`, which may contain sensitive information including URLs with bearer tokens or secret values.

**Current Code:**
```typescript
console.log("[wrangler] Deploy output:", deployOutput);
```

**Suggested Fix:** Redact sensitive information:
```typescript
const sanitized = deployOutput.replace(/Bearer\s+[a-f0-9]{64}/gi, "Bearer [REDACTED]");
console.log("[wrangler] Deploy output:", sanitized);
```

---

### 🟡 18. Unhandled Promise Rejections in Parallel Operations
**File:** `src/app/api/mcps/route.ts:9`
**Severity:** MEDIUM
**Description:** See Bug #10 above.

---

## Low Severity Issues

### ⚪ 19. Missing Validation for Empty Secrets
**File:** `src/app/api/mcps/[slug]/deploy/route.ts:73-78`
**Severity:** LOW
**Description:** The code sets secrets on the worker even when all values might be empty strings after filtering. While `setSecrets()` checks for empty objects, it doesn't validate that required secrets are actually provided.

**Suggested Fix:** Validate required secrets before deployment:
```typescript
const missingRequired = resolved.secrets
  .filter(s => s.required)
  .filter(s => !allWorkerSecrets[s.key]);

if (missingRequired.length > 0) {
  throw new Error(`Missing required secrets: ${missingRequired.map(s => s.key).join(", ")}`);
}
```

---

### ⚪ 20. Console.log Statements in Production Code
**Files:** Multiple files (50+ occurrences)
**Severity:** LOW
**Description:** There are numerous `console.log()` and `console.error()` statements throughout the codebase. In production, these should use a proper logging framework with log levels.

**Suggested Fix:** Implement a simple logger:
```typescript
// src/lib/logger.ts
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

export const logger = {
  debug: (msg: string, ...args: unknown[]) => {
    if (["debug"].includes(LOG_LEVEL)) console.debug(msg, ...args);
  },
  info: (msg: string, ...args: unknown[]) => {
    if (["debug", "info"].includes(LOG_LEVEL)) console.log(msg, ...args);
  },
  error: (msg: string, ...args: unknown[]) => {
    console.error(msg, ...args);
  },
};
```

---

### ⚪ 21. Unused Legacy Code
**File:** `src/lib/kv.ts`
**Severity:** LOW
**Description:** The entire `kv.ts` file appears to be legacy code for Vercel KV storage, but the project has migrated to SQLite. This file is not imported anywhere and creates confusion.

**Suggested Fix:** Delete the file or add a comment explaining it's kept for future hosted version.

---

### ⚪ 22. Missing CORS Headers
**Files:** API routes
**Severity:** LOW
**Description:** Most API routes don't set CORS headers, which could cause issues if the frontend is hosted separately or if CLI tools need to call the API from different origins.

**Suggested Fix:** Add CORS middleware or headers to API routes:
```typescript
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
```

---

### ⚪ 23. No Rate Limiting on OAuth Endpoints
**Files:** `src/app/api/oauth/*`
**Severity:** LOW
**Description:** OAuth endpoints (token, register, approve) have no rate limiting, making them vulnerable to brute force attacks on the OAuth password or client enumeration.

**Suggested Fix:** Implement basic rate limiting using an in-memory store or Redis.

---

### ⚪ 24. Hardcoded TTLs Without Configuration
**Files:** Multiple
**Severity:** LOW
**Description:** Various TTL values are hardcoded:
- OAuth auth codes: 600s (10 min)
- OAuth clients: 1 year
- Metadata cache: 5 min
- Access tokens: 3600s (1 hour)

**Suggested Fix:** Move to configuration file or environment variables.

---

### ⚪ 25. Missing Validation for GitHub Repository Input
**File:** `src/lib/github-releases.ts:207`
**Severity:** LOW
**Description:** The `parseGitHubRepo()` function accepts any input that matches the pattern `[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+`. This allows potentially dangerous characters like `../` in repository names.

**Current Code:**
```typescript
if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(input)) {
  return input;
}
```

**Suggested Fix:** Add stricter validation:
```typescript
if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(input) && !input.includes('..')) {
  return input;
}
```

---

## Test Coverage Gaps

### 26. Missing Tests for Error Paths
**Severity:** MEDIUM
**Description:** While there are 177 tests covering happy paths, many error scenarios are not tested:
- Database initialization failures
- GitHub API rate limiting
- Wrangler command failures
- Network timeouts
- Invalid metadata formats

**Suggested Fix:** Add error path tests for critical functions.

---

### 27. No Integration Tests for OAuth Flow
**Severity:** MEDIUM
**Description:** OAuth provider tests only cover individual functions, not the full authorization flow including redirect handling, code exchange, and token validation.

**Suggested Fix:** Add end-to-end OAuth flow tests.

---

## Architecture Concerns

### 28. Dual Storage Backends
**File:** `src/lib/store.ts` vs `src/lib/kv.ts`
**Severity:** LOW
**Description:** The codebase has two storage implementations (SQLite and Vercel KV), but only SQLite is actively used. This creates confusion and maintenance burden.

**Recommendation:** Document the architecture decision and clearly mark `kv.ts` as deprecated or for future use.

---

### 29. Cloudflare Deploy Service Not Used
**File:** `src/lib/cloudflare-deploy.ts`
**Severity:** LOW
**Description:** A complete Cloudflare REST API implementation exists but is unused in favor of wrangler CLI. This represents ~300 lines of dead code.

**Recommendation:** Either delete it or document that it's kept for future hosted deployment.

---

## Summary

**Total Issues Found:** 29

### By Severity:
- **Critical:** 4 bugs (1 new)
- **High:** 5 bugs (2 new)
- **Medium:** 10 bugs (5 new)
- **Low:** 10 issues (4 new)

### New Bugs This Report:
- 🔴 **NEW Critical #1:** Incorrect worker name in remove route
- 🟠 **NEW High #3:** Missing secret name validation
- 🟠 **NEW High #5:** Race condition in metadata cache
- 🟠 **NEW Medium #6:** Synchronous functions declared async
- 🟠 **NEW Medium #7:** Unsafe type assertions
- 🟠 **NEW Medium #8:** No OAuth cleanup on startup
- 🟡 **NEW Medium #11:** Missing database index
- 🟡 **NEW Low #12:** Memory leak in wranglerLogin
- 🟡 **NEW Low #13:** Inconsistent slug/workerName usage
- 🟡 **NEW Low #14:** Hardcoded timeouts

### Top Priority Fixes (Recommended Order):

1. **🔴 Fix incorrect worker name in MCP removal** (Critical, NEW) - Security & resource leak
2. **🔴 Add secret name validation** (High, NEW) - Security vulnerability
3. **🔴 Fix migration race condition** (High) - Data integrity
4. **🟠 Fix metadata cache race condition** (High, NEW) - GitHub rate limiting
5. **🟠 Remove unnecessary async keywords** (Medium, NEW) - Code quality & performance
6. **🟡 Add missing database index** (Medium, NEW) - Performance

### Recently Fixed (Good Progress! ✅):
- ✅ Shell injection in setSecrets (temp file approach)
- ✅ Worker name validation (regex validation)
- ✅ Password timing attack (constant-time comparison)
- ✅ Database initialization error handling (try-catch)

### Positive Findings:

- ✅ Good test coverage (177 tests) for core functionality
- ✅ Proper use of TypeScript strict mode
- ✅ Encryption implemented correctly for sensitive data (AES-256-GCM)
- ✅ Good separation of concerns (store, wrangler, oauth modules)
- ✅ Comprehensive OAuth 2.1 implementation with PKCE
- ✅ Migration logic handles legacy data well
- ✅ Recent security improvements show active maintenance
- ✅ Auto-generated encryption keys in .env.local
- ✅ WAL mode enabled for SQLite (better concurrency)

---

**Disclaimer:** This report is based on static code analysis and manual code review. Dynamic testing and runtime profiling may reveal additional issues.
