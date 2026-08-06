# Hosted mcp-deploy — Architecture Design

Status: **proposal / decision record**
Question: should mcp-deploy become a hosted web app where users get MCPs
without a Cloudflare account, and if so, where is the boundary between
"I host it" and "you deploy your own"?

---

## 1. The pain we're actually solving

The stated problem is onboarding and updates:

- Lab mates have to `git clone`, `npm install`, `npm link`, install Node 20+.
- Every time the dashboard changes, they have to `git pull` and re-link.
- They also need their own Cloudflare account and to complete a `wrangler login`.

Note that only the *first two* are about the dashboard. The third is about
where the worker runs. **These are separate problems and they have separate
answers.** Conflating them is what makes the design question feel hard.

| Layer | What it is | Who should run it |
|---|---|---|
| **Control plane** | The Next.js dashboard, catalog, secret entry, deploy orchestration | **Always hosted by us.** No exceptions. |
| **Data plane** | The Cloudflare Worker that actually serves `/mcp` and holds API keys | Configurable — see §3 |

Hosting the control plane alone eliminates ~90% of the reported pain. Nobody
installs anything, and updates to the dashboard are a `git push`. That decision
is easy and should not wait on the harder data-plane question.

## 2. What the codebase already supports

This matters, because the hosted design is much closer than it looks.

**The REST deploy path already exists and is not tied to a local machine.**
`src/lib/cloudflare-deploy.ts` (`CloudflareDeployService`) does worker upload,
bulk secrets, health checks, and deletion entirely over the Cloudflare REST API.
It is constructed as `new CloudflareDeployService(apiToken, accountId)` — it has
no opinion about *whose* account that is. `src/app/api/mcps/[slug]/deploy`,
`.../secrets`, and `.../status` already use it, reading credentials from the
`config` table via `store.getCfToken()` / `store.getCfAccountId()`.

**The wrangler shell-out path is the thing that blocks hosting.**
`src/lib/wrangler.ts` runs `npx wrangler` via `child_process`, and
`src/lib/operations.ts` (used by the CLI) imports its `deployWorker`,
`setSecrets`, `deleteWorker`, `ensureKVNamespace`. `src/lib/cloudflare-config.ts`
returns the literal placeholder `"wrangler-managed"` instead of a token. So we
currently have two parallel deploy implementations, and the CLI-facing one
cannot run in a serverless environment.

*Implication:* consolidating on `CloudflareDeployService` is a prerequisite and
also just good hygiene — it removes a duplicated code path.

**Auth wrappers are already spec-correct.** `worker-oauth-wrapper.ts` serves
`/.well-known/oauth-authorization-server` (RFC 8414),
`/.well-known/oauth-protected-resource` (RFC 9728), dynamic client registration,
and returns `WWW-Authenticate: Bearer resource_metadata=...` on 401. That is
exactly what a modern remote MCP server is required to expose. The OAuth flow
runs *inside each deployed worker*, so it does not require an always-on
mcp-deploy server.

**Live credential validation already exists.** `TestSpec` in the MCP metadata
plus `src/lib/test-runner.ts` can verify a user's API key against the real API
at entry time. This is a significant UX asset for self-serve onboarding — it
turns "paste a key and hope" into "paste a key, see a green check".

**Storage is the other blocker.** `src/lib/db.ts` uses `better-sqlite3` against
a local file (`data/mcp-deploy.db`), and every table is keyed by `slug` alone —
`deployments(slug)`, `secrets(slug, key)`. There is no concept of a user
anywhere in the schema. Native SQLite also cannot run on Workers.

## 3. The three data-plane models

### Model A — one shared multi-tenant worker per MCP

One `zotero-assistant` worker serves everyone; the caller's identity comes from
OAuth, and per-user credentials live in KV/D1 keyed by that identity.

- Cheapest: one script per MCP regardless of user count. Instant onboarding.
- **But it requires rewriting every MCP server.** Today the MCP bundles read
  credentials from `env.ZOTERO_API_KEY` — a per-worker secret, resolved once at
  startup. Making them per-user means threading a per-request credential
  lookup through each server's code, which breaks the whole "publish a
  `worker.mjs` to a GitHub release and mcp-deploy just runs it" contract.
- One bad deploy breaks every user at once, and a single compromise exposes
  everyone's keys.

**Rejected for now.** The cost is a rewrite of the thing that currently works.

### Model B — one worker per user, in *our* Cloudflare account ✅ recommended

Alice gets `zotero-assistant-alice.<our-subdomain>.workers.dev`, with her Zotero
key set as a normal Cloudflare secret on *her* worker.

- **Zero changes to the MCP servers.** `env.ZOTERO_API_KEY` keeps working
  exactly as it does today. The release format is unchanged.
- Real isolation: separate script, separate Durable Object, separate secrets.
- **Central updates — the killer feature for the stated pain.** When a new
  release ships, we redeploy every user's worker from the dashboard. Lab mates
  never do anything. This is strictly better than the current model, where
  each person has to notice and click.
- Users never see Cloudflare at all.

Costs and limits:
- Cloudflare allows **100 Worker scripts on the free plan, 500 on paid ($5/mo)**.
  At ~3 MCPs per person that is ~33 users free / ~165 paid. Fine for a lab,
  not fine for a public launch — worth knowing the ceiling exists.
- These workers use SQLite-backed Durable Objects (`new_sqlite_classes`), which
  are available on the free plan.
- We pay for their usage, and we become custodian of their API keys (see §6).

### Model C — bring your own Cloudflare account (today's model)

Keep it. It is the escape hatch for people outside the lab, for anyone who
doesn't want us holding their credentials, and for anyone who outgrows our
account limits.

### The boundary, stated plainly

> **We host the control plane for everyone. The data plane defaults to our
> Cloudflare account ("managed"), with BYO-Cloudflare available as a per-user
> setting.**

The reason this boundary is the right one: **Models B and C are the same code
path.** Both are `new CloudflareDeployService(apiToken, accountId)`. The only
new concept is a per-user deployment target:

```ts
type DeploymentTarget =
  | { mode: "managed" }                              // use the app's own CF creds
  | { mode: "byo"; apiToken: string; accountId: string }; // user's own
```

That is a genuinely small abstraction for how much optionality it buys. We do
not fork the project or maintain two products — the hosted app and the
self-hosted CLI stay one codebase with a parameter.

## 4. Sign-in

**Do not use "Sign in with Cloudflare."** Cloudflare does not offer a general
consumer identity provider. Its OAuth is a device-authorization flow intended
for the `wrangler` CLI, and the token it issues grants broad account access.
Using it as a login button would mean asking every lab mate to hand the app
real Cloudflare credentials — the exact friction we are removing, plus a
liability.

Recommended, in order of preference for a lab:

1. **Google sign-in restricted to the university domain.** Zero new accounts,
   and the domain allowlist *is* the access control.
2. **GitHub OAuth** — good if the group skews technical and the MCP catalog is
   GitHub-centric anyway.
3. **Email magic link + invite code** — simplest to build, no IdP config.

Keep two auth layers mentally separate; both are required:

- **Dashboard auth** (new) — who can log in and manage deployments.
- **MCP endpoint auth** (already built) — bearer / OAuth / open on the deployed
  worker, which is what Claude presents when it connects.

In managed mode, default new deployments to **bearer** (one copy-paste URL, no
password to communicate) and offer OAuth for anyone who wants it.

## 5. Data model changes

The catalog stays global — we curate which MCPs are offered. Only deployment
and secret state becomes per-user:

```
mcps         (slug, github_repo, release_tag, ...)          -- global, curated
users        (id, email, name, created_at)                   -- NEW
deployments  (user_id, slug, status, worker_url, ...)        -- PK becomes (user_id, slug)
secrets      (user_id, slug, key, value)                     -- PK becomes (user_id, slug, key)
```

`worker_url_mapping`, `jwt_secrets`, and the OAuth tables key off the deployed
worker rather than the slug, so they need the same treatment.

Worker names **must** be namespaced in managed mode — `workerName` currently
comes straight from `metadata.worker.name`, so two users would collide on
`zotero-assistant`. Derive it as `${metadata.worker.name}-${user.handle}` at
resolve time in `mcp-registry.ts`. Durable Object migration tags are per-script,
so they need no change.

Storage: replace `better-sqlite3` with **D1** (if the dashboard lands on
Cloudflare) or **Postgres/Neon** (if it lands on Vercel). Note that hosting the
*dashboard* on Cloudflare is optional and the harder path — it needs the
OpenNext adapter, D1, and full removal of the `child_process` wrangler calls.
The workers must be on Cloudflare; the dashboard does not have to be. Pick
whichever gets to a URL fastest.

## 6. Secret custody — read this before committing

In managed mode we hold other people's Zotero and OpenAlex keys. This is
manageable for a lab but should be a deliberate decision, not a side effect.

- Cloudflare worker secrets **cannot be read back** once set. Since we need the
  secrets again to redeploy on update, we must either keep our own encrypted
  copy (what `secrets` table + AES-256-GCM does today) or force re-entry on
  every update. Keeping the encrypted copy is the right call — but it means the
  app's `ENCRYPTION_KEY` is now the crown jewel for everyone, not just one user.
- Put `ENCRYPTION_KEY` in a real secret store, not `.env` on the host.
- Tell users plainly what is stored and where — a short paragraph on the
  settings page is enough for a lab, and it is the honest thing to do.
- Where the upstream API supports it (Zotero does), guide users toward
  **read-only, scoped** keys in the field help text.
- BYO-Cloudflare mode should be presented as the answer for anyone uncomfortable
  with the above, which is another reason to keep Model C alive.

## 7. MCP protocol version — not a blocker

Checked directly against the bundles in `workers/`: both `paper-search-mcp.mjs`
and `zotero-assistant-mcp.mjs` ship an SDK carrying protocol revisions through
`2025-11-25`, and negotiate down to whatever the client requests
(`SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion) ? requestedVersion :
LATEST_PROTOCOL_VERSION`). The OAuth wrapper already implements the
resource-server discovery the newer revisions require.

So the instinct that "these still work with Claude, so I probably don't need to
change much here" is correct. Re-verify against the current spec before any
public launch, but do not sequence any of the work above behind it.

## 8. Target onboarding experience

What a lab mate does, end to end:

1. Open `mcp.ourlab.org`, sign in with their university Google account.
2. See a catalog: *Zotero Assistant*, *Paper Search*.
3. Click **Enable** on Zotero. A form asks for their Zotero API key with a help
   link, and validates it live against the Zotero API (`TestSpec` — already
   built) before allowing submit.
4. We deploy a worker into our account under their namespace.
5. They get a **Add to Claude** panel: the URL with token, a copy button, and
   three lines of instructions.

No clone, no npm, no Node, no Cloudflare account, no wrangler login. When we
ship an MCP update, we redeploy their worker and they notice nothing.

## 9. Suggested sequencing

Each phase is independently shippable and useful on its own.

| Phase | Work | Unblocks |
|---|---|---|
| **1** | Consolidate on `CloudflareDeployService`; retire the `wrangler` shell-out from the deploy path; feed real `cf_token` / `cf_account_id` from env | Anything hosted at all |
| **2** | Move storage off local SQLite to D1/Postgres; deploy the dashboard to a URL | Kills the install/update pain — **biggest win per unit of work** |
| **3** | Add auth + `users` table; add `user_id` to `deployments` / `secrets` | Multi-user |
| **4** | Namespace worker names per user; implement managed deployment target | Model B |
| **5** | Per-user BYO-Cloudflare setting in Settings | Model C preserved |
| **6** | "Update all deployments" — redeploy every user's worker on a new release | The update pain, solved centrally |

Phases 1–2 alone deliver most of the stated value and require no decision about
secret custody. That is a good place to start regardless of how the Model B
question ultimately lands.
